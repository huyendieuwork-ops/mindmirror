import { CardOutputSchema, extractJson } from "./schema";
import { cardPrompt } from "./prompts";
import { stripForbiddenClaims } from "./guardrails";
import type { MirrorCard, MirrorCardItem, Session } from "./types";
import type { ModelRouter } from "../providers/router";
import { assessLearner } from "./assessment";
import type { SpanHandle } from "../obs/tracer";

/**
 * Thẻ Gương Hiểu Biết.
 * - Trạng thái từng khái niệm được tính bằng CODE từ evidence đã xác thực.
 * - Model (nếu có) chỉ viết lời văn, và mọi mục "đã thể hiện" phải dẫn evidence_id hợp lệ.
 * - Không đủ bằng chứng → không gọi model, ghi rõ "chưa đủ căn cứ".
 */
export async function buildMirrorCard(session: Session, router: ModelRouter | null, parent: SpanHandle | null = null): Promise<MirrorCard> {
  const base = rulesCard(session);
  const observed = session.evidence.filter((e) => e.status === "observed");
  parent?.set({ evidence_total: session.evidence.length, evidence_observed: observed.length, assessment: base.assessment.counts });
  if (!router || observed.length === 0) {
    parent?.set({ card_by: "rules", model_called: false });
    return base;
  }

  try {
    const p = cardPrompt(session);
    const res = await router.generate({ system: p.system, user: p.user, maxOutputTokens: 900, temperature: 0.3, purpose: "card" }, parent);
    const parsed = CardOutputSchema.safeParse(extractJson(res.text));
    if (!parsed.success) return base;
    const out = parsed.data;

    const byId = new Map(session.evidence.map((e) => [e.id, e]));
    const demonstrated: MirrorCardItem[] = [];
    for (const item of out.demonstrated) {
      const ids = item.evidence_ids.filter((id) => byId.get(id)?.status === "observed");
      if (ids.length === 0) continue; // không có bằng chứng thật → bỏ
      const clean = stripForbiddenClaims(item.text);
      if (clean.removed > 0 || !clean.text) continue;
      demonstrated.push({ text: clean.text, evidenceIds: ids, assisted: ids.some((id) => byId.get(id)!.assisted) });
    }

    parent?.set({ card_by: "model", items_proposed: out.demonstrated.length, items_kept: demonstrated.length });
    const nextStep = stripForbiddenClaims(out.next_step);
    return {
      ...base,
      initialThought: base.initialThought, // luôn là trích dẫn thật, không để model viết lại
      demonstrated: demonstrated.length ? demonstrated : base.demonstrated,
      changed: out.changed ? stripForbiddenClaims(out.changed).text || base.changed : base.changed,
      unresolved: out.unresolved.length ? out.unresolved : base.unresolved,
      nextStep: nextStep.removed ? base.nextStep : nextStep.text || base.nextStep,
      generatedBy: "model",
    };
  } catch {
    return base; // model lỗi → vẫn có thẻ từ luật, không tuyên bố đã "đánh giá" thêm
  }
}

export function rulesCard(s: Session): MirrorCard {
  const observed = s.evidence.filter((e) => e.status === "observed");
  const firstEv = s.evidence[0];
  const firstUser = s.messages.find((m) => m.role === "user");
  const assessment = assessLearner(s);

  const conceptStatus = assessment.criteria.map((c) => ({
    concept: c.concept,
    status: (c.status.startsWith("demonstrated") ? "demonstrated" : c.status) as MirrorCard["conceptStatus"][number]["status"],
  }));

  const demonstrated: MirrorCardItem[] = observed.slice(-4).map((e) => ({
    text: e.assisted ? `${e.claim} (sau khi được gợi ý/ví dụ)` : e.claim,
    evidenceIds: [e.id],
    assisted: e.assisted,
  }));

  const resolvedAfter = s.gaps.filter((g) => g.status === "resolved_after_support");
  const withSupport = assessment.criteria.filter((c) => c.status === "demonstrated_with_support");
  const changed = resolvedAfter.length || withSupport.length
    ? `Sau khi được hỗ trợ, bạn đã diễn đạt lại được: ${[...new Set([...resolvedAfter.map((g) => g.concept), ...withSupport.map((c) => c.concept)])].join("; ")}.`
    : null;

  const unresolved = [...new Set([
    ...s.gaps.filter((g) => g.status === "open" || g.status === "skipped").map((g) => readableConcept(g.concept)),
    ...assessment.criteria.filter((c) => c.status === "needs_practice" || (assessment.grounded && c.status === "insufficient_evidence")).map((c) => c.concept),
  ])];
  const insufficient = observed.length === 0;

  let nextStep: string;
  if (insufficient) nextStep = "Phiên này mình chưa đủ căn cứ để ghi nhận điều bạn đã thể hiện. Lần sau thử tự giải thích một ví dụ nhé.";
  else if (unresolved.length) nextStep = `Thử thêm một tình huống nhỏ về: ${unresolved[0]}.`;
  else if (withSupport.length || resolvedAfter.length) nextStep = "Hãy thử lại một câu tương tự sau vài ngày, không xem gợi ý, để kiểm tra độc lập.";
  else nextStep = "Thử áp dụng vào một bài tập mới có điều kiện khác để kiểm tra khả năng vận dụng.";

  return {
    topic: s.state.topic,
    mode: s.state.mode,
    initialThought: firstEv?.quote ?? (firstUser ? firstUser.text.slice(0, 300) : null),
    demonstrated,
    changed,
    unresolved,
    nextStep,
    insufficientEvidence: insufficient,
    conceptStatus,
    assessment,
    generatedBy: "rules",
  };
}

export function sameConcept(a: string, b: string): boolean {
  const n = (x: string) => x.normalize("NFC").toLowerCase().replace(/[_\-]/g, " ").replace(/\s+/g, " ").trim();
  const x = n(a), y = n(b);
  return x === y || (x.length > 6 && y.includes(x)) || (y.length > 6 && x.includes(y));
}

/** Tên lỗ hổng model ghi kiểu mã ("ket_qua_left_join") → dạng đọc được ("ket qua left join"); tên thường giữ nguyên. */
export function readableConcept(c: string): string {
  return /^[a-z0-9]+(_[a-z0-9]+)+$/i.test(c.trim()) ? c.trim().replace(/_/g, " ") : c;
}
