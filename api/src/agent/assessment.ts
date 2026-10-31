import type { CriterionAssessment, CriterionStatus, Evidence, LearnerAssessment, Session } from "./types";

/**
 * LEARNER ASSESSMENT — MindMirror đánh giá NGƯỜI HỌC trong phiên.
 *
 * Tính hoàn toàn bằng code từ bằng chứng đã được kiểm chứng (quote thật của người học,
 * căn cứ thật trong tài liệu). Model không được tự gán trạng thái.
 *  - Lấy bằng chứng "quyết định" gần nhất (observed/contradicted) của mỗi tiêu chí.
 *  - observed chưa từng nhận hỗ trợ → demonstrated_independent; sau hỗ trợ → demonstrated_with_support.
 *  - contradicted → needs_practice. Chỉ có "unclear" hoặc không có gì → insufficient_evidence.
 *  - applied = đã đúng ở câu vận dụng tình huống mới.
 *
 * Việc kiểm tra xem CHÍNH PHẦN NÀY có chấm đúng không là Agent Evals (scripts/eval.ts).
 */
export function assessLearner(s: Session): LearnerAssessment {
  const grounded = s.rubric.length > 0;
  const units: { criterionId: string | null; concept: string; ev: Evidence[]; citation: CriterionAssessment["sourceCitation"] }[] = [];

  if (grounded) {
    for (const c of s.rubric) {
      units.push({ criterionId: c.id, concept: c.concept, ev: s.evidence.filter((e) => e.criterionId === c.id), citation: c.citation });
    }
    // bằng chứng không gắn tiêu chí → gom theo mã criterion tự do (không bỏ sót)
    const loose = s.evidence.filter((e) => !e.criterionId || !s.rubric.some((c) => c.id === e.criterionId));
    for (const code of [...new Set(loose.map((e) => e.criterion))]) {
      units.push({ criterionId: null, concept: humanize(code), ev: loose.filter((e) => e.criterion === code), citation: null });
    }
  } else {
    for (const code of [...new Set(s.evidence.map((e) => e.criterion))]) {
      units.push({ criterionId: null, concept: humanize(code), ev: s.evidence.filter((e) => e.criterion === code), citation: null });
    }
    // gap đang mở nhưng chưa có bằng chứng gắn với nó
    for (const g of s.gaps.filter((g) => g.status === "open" || g.status === "skipped")) {
      if (!units.some((u) => u.concept.toLowerCase() === g.concept.toLowerCase())) {
        units.push({ criterionId: null, concept: g.concept, ev: [], citation: null });
      }
    }
  }

  const criteria: CriterionAssessment[] = units.map((u) => {
    const decisive = u.ev.filter((e) => e.status !== "unclear");
    const last = decisive.at(-1);
    let status: CriterionStatus = "insufficient_evidence";
    if (last?.status === "observed") status = last.assisted ? "demonstrated_with_support" : "demonstrated_independent";
    else if (last?.status === "contradicted") status = "needs_practice";
    else if (!grounded && u.ev.length === 0) status = "needs_practice"; // gap mở do agent phát hiện
    return {
      criterionId: u.criterionId,
      concept: u.concept,
      status,
      applied: u.ev.some((e) => e.status === "observed" && e.context === "transfer"),
      evidenceIds: u.ev.map((e) => e.id),
      sourceCitation: last?.sourceCitation ?? u.citation,
    };
  });

  const counts: Record<CriterionStatus, number> = {
    demonstrated_independent: 0, demonstrated_with_support: 0, needs_practice: 0, insufficient_evidence: 0,
  };
  for (const c of criteria) counts[c.status]++;

  return {
    grounded,
    criteria,
    counts,
    note: "Đây là quan sát trong phiên này dựa trên câu trả lời của bạn" + (grounded ? " và tài liệu bạn cung cấp" : "") +
      " — không phải điểm số hay đánh giá năng lực tổng thể.",
  };
}

function humanize(code: string): string {
  return code.replace(/_/g, " ").trim();
}
