import { decide, detectIntent, isSupportAction, DEFAULT_LIMITS, type Limits } from "./policy";
import { systemPrompt, turnPrompt, summaryPrompt, planPrompt } from "./prompts";
import { TurnOutputSchema, SummaryOutputSchema, PlanOutputSchema, extractJson, type TurnOutput } from "./schema";
import { findQuoteSource } from "./evidence";
import { sanitizeAssistantText } from "./guardrails";
import { buildMirrorCard, sameConcept } from "./mirror-card";
import type {
  Action, Citation, Criterion, Evidence, Gap, LearningState, Message, RetrievedChunk, Session, SessionMode, TurnResult, UserIntent, UserSettings,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import type { ModelRouter } from "../providers/router";
import type { Retriever } from "../rag/retriever";
import { aliasMap, renderCitationMarkers, validateCitation } from "../rag/grounding";
import { NoopTrace, type SpanHandle, type Trace } from "../obs/tracer";

export interface EngineDeps {
  core: ModelRouter;           // Gemini core (+ Groq fallback)
  light?: ModelRouter | null;  // Flash-Lite cho tóm tắt
  limits?: Limits;
  now?: () => Date;
  id?: () => string;
  retriever?: Retriever | null; // RAG: tìm đoạn liên quan trong tài liệu của phiên
  trace?: Trace;                // Observability: mọi bước ghi thành span
}

/** Ném khi model không chạy được — HTTP layer trả 503 "thử lại", KHÔNG lưu gì. */
export class AgentUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Agent unavailable: ${reason}`);
  }
}

export interface NewSessionInput {
  userId: string;
  mode: SessionMode;
  topic: string;
  goal?: string | null;
  selfConfidence?: LearningState["selfConfidence"];
  documentIds?: string[];
  settings?: UserSettings;
}

const uid = () => crypto.randomUUID();

/** Tạo phiên + câu mở đầu deterministic (0 API call). */
export function createSession(input: NewSessionInput, deps: Pick<EngineDeps, "now" | "id"> = {}): Session {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const id = deps.id ?? uid;
  const topic = input.topic.trim().slice(0, 200);
  const opening =
    input.mode === "reunderstand"
      ? `Mình cùng nhìn lại “${topic}” nhé. Cậu thử giải thích theo cách cậu đang hiểu xem — không cần chính xác từng chữ. Chỗ nào cậu thấy hay vướng nhất?`
      : `Hay đấy! Về “${topic}”, cậu đang tò mò nhất điều gì — muốn hiểu nguyên lý, xem ví dụ đời thường, hay thử tự đoán xem vì sao trước?`;
  return {
    id: id(),
    userId: input.userId,
    status: "active",
    state: {
      mode: input.mode,
      phase: "entry",
      topic,
      goal: input.goal?.trim() || null,
      currentGapId: null,
      hintLevel: 0,
      roundOnSameGap: 0,
      supportCount: 0,
      answerShown: false,
      turnCount: 0,
      agentLedRounds: 0,
      selfConfidence: input.selfConfidence ?? null,
      summary: "",
      pendingModeSuggestion: null,
    },
    gaps: [],
    evidence: [],
    messages: [{ id: id(), role: "assistant", text: opening, action: input.mode === "reunderstand" ? "ask_explain" : "ask_clarification", intent: null, createdAt: now }],
    documentIds: input.documentIds ?? [],
    rubric: [],
    settings: input.settings ?? DEFAULT_SETTINGS,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Phiên có tài liệu: truy xuất đoạn liên quan tới chủ đề → model đề xuất 2–5 tiêu chí kèm trích dẫn
 * → backend giữ lại tiêu chí có quote thật trong tài liệu → câu mở đầu bám tiêu chí đầu tiên.
 * Model lỗi thì phiên vẫn chạy (không rubric), không chặn người dùng.
 */
export async function prepareGroundedSession(session: Session, deps: Pick<EngineDeps, "core" | "retriever" | "trace">): Promise<Session> {
  const s = structuredClone(session);
  if (!deps.retriever || s.documentIds.length === 0) return s;
  const trace = deps.trace ?? new NoopTrace();
  return trace.run("agent.plan", "chain", null, async (span) => {
    const query = [s.state.topic, s.state.goal].filter(Boolean).join(". ");
    const retrieved = await deps.retriever!.search(s.userId, s.documentIds, query, 6, { trace, parent: span, purpose: "plan" });
    span.set({ retrieved: retrieved.length });
    const docTitle = retrieved[0]?.documentTitle;
    const fallbackOpening = retrieved.length
      ? `Mình đã xem phần liên quan trong “${docTitle}”${retrieved[0]!.chunk.page ? ` (tr. ${retrieved[0]!.chunk.page})` : ""}. Cậu thử giải thích “${s.state.topic}” theo cách cậu hiểu trước nhé — chưa cần mở tài liệu ra.`
      : `Mình chưa tìm thấy đoạn nào trong tài liệu nói về “${s.state.topic}”. Cậu thử giải thích theo cách cậu hiểu, mình sẽ đối chiếu khi có căn cứ nhé.`;
    if (retrieved.length === 0) {
      s.messages[0]!.text = fallbackOpening;
      return s;
    }
    try {
      const p = planPrompt(s.state.topic, s.state.goal, retrieved);
      const res = await deps.core.generate({ system: p.system, user: p.user, maxOutputTokens: 900, temperature: 0.2, purpose: "plan" }, span);
      const parsed = PlanOutputSchema.safeParse(extractJson(res.text));
      if (!parsed.success) throw new Error("PLAN_SCHEMA");
      const map = aliasMap(retrieved);
      const rubric: Criterion[] = [];
      for (const c of parsed.data.criteria) {
        const cit = validateCitation(c.source, c.quote, map);
        if (!cit) continue; // tiêu chí không có căn cứ thật → bỏ
        rubric.push({ id: `C${rubric.length + 1}`, concept: c.concept, expectation: c.expectation, citation: cit });
        if (rubric.length >= 5) break;
      }
      s.rubric = rubric;
      span.set({ criteria_proposed: parsed.data.criteria.length, criteria_kept: rubric.length });
      const opening = sanitizeAssistantText(parsed.data.opening_question.replace(/\[S\d+\]/g, ""), fallbackOpening);
      s.messages[0]!.text = rubric.length ? `Mình đã đọc phần liên quan trong “${docTitle}”. ${opening}` : fallbackOpening;
      s.messages[0]!.action = "ask_explain";
    } catch (e) {
      span.set({ plan_error: (e as Error).message });
      s.messages[0]!.text = fallbackOpening;
    }
    return s;
  });
}

export interface TurnInput {
  text: string;
  intent?: UserIntent | null;
}

/**
 * Một lượt Agent: Quan sát → Ra quyết định (code) → (LLM đề xuất lời) → Kiểm chứng → Cập nhật state.
 * Trả về session MỚI (không mutate input) — chỉ lưu khi thành công.
 */
export async function runTurn(
  input: Session,
  turn: TurnInput,
  deps: EngineDeps,
): Promise<{ session: Session; result: TurnResult }> {
  const s: Session = structuredClone(input);
  const id = deps.id ?? uid;
  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const limits = deps.limits ?? DEFAULT_LIMITS;

  if (s.status === "finished") throw new Error("SESSION_FINISHED");
  s.status = "active";
  const trace = deps.trace ?? new NoopTrace();
  const root = trace.start("agent.turn", "chain", null, { mode: s.state.mode, phase_before: s.state.phase, turn: s.state.turnCount + 1, grounded: s.documentIds.length > 0 });
  try {
    const out = await runTurnInner(s, turn, deps, trace, root, id, nowIso, limits);
    root.set({ phase_after: out.session.state.phase, action: out.result.action, hint_level: out.result.hintLevel });
    out.result.traceId = trace.enabled ? trace.id : null;
    return out;
  } catch (e) {
    root.fail(e);
    throw e;
  } finally {
    root.end();
  }
}

async function runTurnInner(
  s: Session, turn: TurnInput, deps: EngineDeps, trace: Trace, root: SpanHandle, id: () => string, nowIso: string, limits: Limits,
): Promise<{ session: Session; result: TurnResult }> {
  const text = turn.text.trim();
  const intent: UserIntent | null = turn.intent ?? detectIntent(text);
  root.set({ intent, intent_source: turn.intent ? "button" : intent ? "rule" : null }).io(trace.content(text));

  if (text) {
    s.messages.push({ id: id(), role: "user", text, action: null, intent, createdAt: nowIso });
    s.state.turnCount += 1;
  }

  const decision = decide(s, intent, limits);
  trace.start("policy.decide", "guardrail", root, {
    kind: decision.kind,
    ...(decision.kind === "llm" ? { allowed_actions: decision.allowedActions, forced_action: decision.forcedAction, target_hint: decision.targetHintLevel } : {}),
    ...(decision.kind === "deterministic" ? { action: decision.action } : {}),
    round_on_same_gap: s.state.roundOnSameGap, agent_led_rounds: s.state.agentLedRounds,
  }).end();

  // ---------- 1. Kết thúc → thẻ Gương Hiểu Biết ----------
  if (decision.kind === "finish") {
    const cardSpan = root.child("card.build", "chain");
    const card = await buildMirrorCard(s, deps.core, cardSpan).finally(() => cardSpan.end());
    s.status = "finished";
    s.state.phase = "finished";
    const msg = card.insufficientEvidence
      ? "Mình tổng kết phiên ở đây nhé. Phiên này còn ngắn nên mình chưa đủ căn cứ để ghi nhận nhiều — thẻ dưới đây chỉ ghi những gì thực sự có trong cuộc trò chuyện."
      : "Mình tổng kết phiên ở đây nhé. Đây là Gương Hiểu Biết của cậu hôm nay.";
    s.messages.push({ id: id(), role: "assistant", text: msg, action: "summarize", intent: null, createdAt: nowIso });
    s.updatedAt = nowIso;
    return {
      session: s,
      result: baseResult(s, id(), "finish", msg, [], null, { isFinished: true, card, quickReplies: [] }),
    };
  }

  // ---------- 2. Hành động deterministic (0 API call) ----------
  if (decision.kind === "deterministic") {
    if (decision.action === "skip") {
      const g = s.gaps.find((x) => x.id === s.state.currentGapId);
      if (g && g.status === "open") g.status = "skipped";
      s.state.currentGapId = null;
      s.state.hintLevel = 0;
      s.state.roundOnSameGap = 0;
      s.state.agentLedRounds = 0;
      if (s.state.phase === "repair") s.state.phase = "probe";
    } else if (decision.action === "switch_mode") {
      s.state.mode = s.state.mode === "explore" ? "reunderstand" : "explore";
      s.state.pendingModeSuggestion = null;
      s.state.phase = "baseline";
      s.state.agentLedRounds = 0;
    }
    s.messages.push({ id: id(), role: "assistant", text: decision.text, action: null, intent: null, createdAt: nowIso });
    s.updatedAt = nowIso;
    return {
      session: s,
      result: baseResult(s, id(), decision.action, decision.text, [], null, { quickReplies: decision.quickReplies }),
    };
  }

  // ---------- 3. Lượt cần LLM ----------
  await maybeSummarize(s, deps, root);

  // 3.0 RAG: truy xuất đoạn tài liệu liên quan tới điểm đang xét
  let retrieved: RetrievedChunk[] = [];
  if (deps.retriever && s.documentIds.length) {
    const gap = s.gaps.find((g) => g.id === s.state.currentGapId)?.concept;
    const query = [gap, text || s.messages.at(-1)?.text, s.state.topic].filter(Boolean).join(" \n ");
    retrieved = await deps.retriever.search(s.userId, s.documentIds, query, 4, { trace, parent: root, purpose: "turn" });
  }
  const grounded = retrieved.length > 0 || s.rubric.length > 0;

  const sys = systemPrompt(s.settings, grounded);
  const user = turnPrompt({
    session: text ? { ...s, messages: s.messages.slice(0, -1) } : s, // tin hiện tại đưa riêng
    retrieved,
    userText: text || `(người dùng bấm nút: ${intent})`,
    allowedActions: decision.allowedActions,
    directive: decision.directive,
    targetHintLevel: decision.targetHintLevel,
  });

  const llmSpan = root.child("agent.respond", "chain", { prompt_chars: sys.length + user.length });
  const { output, provider, model, attempts } = await callTurnModel(deps.core, sys, user, decision.allowedActions, llmSpan).finally(() => llmSpan.end());
  llmSpan.set({ model_action: output.next_action, repair_attempts: attempts - 1 });
  const vSpan = root.child("validate.output", "guardrail");

  // 3a. Hành động: phải thuộc tập code cho phép
  let action: Action = output.next_action;
  const coerced = !decision.allowedActions.includes(action) || (!!decision.forcedAction && decision.forcedAction !== action);
  if (!decision.allowedActions.includes(action)) action = decision.forcedAction ?? decision.allowedActions[0]!;
  if (decision.forcedAction) action = decision.forcedAction;

  // 3b. Trích dẫn tài liệu: nhãn phải có trong lượt này VÀ quote có nguyên văn trong đoạn
  const aliases = aliasMap(retrieved);
  const validCites = new Map<string, Citation>();
  for (const c of output.source_citations) {
    const v = validateCitation(c.source, c.quote, aliases);
    if (v) validCites.set(c.source.trim().toUpperCase(), v);
  }

  // 3c. Bằng chứng về người học: quote thật + (khi có tài liệu) phán đoán phải có căn cứ
  const supportBefore = s.state.supportCount;
  const newEvidence: Evidence[] = [];
  let dropped = 0, downgraded = 0;
  const rubricIds = new Set(s.rubric.map((c) => c.id));
  for (const e of output.observed_evidence) {
    const msgId = findQuoteSource(e.quote, s.messages);
    if (!msgId) { dropped++; continue; }
    const criterionId = e.criterion_id && rubricIds.has(e.criterion_id.trim().toUpperCase()) ? e.criterion_id.trim().toUpperCase() : null;
    const sourceCitation = e.source_ref ? validateCitation(e.source_ref.source, e.source_ref.quote, aliases) : null;
    if (sourceCitation && e.source_ref) validCites.set(e.source_ref.source.trim().toUpperCase(), sourceCitation);
    let status = e.status;
    if (grounded) {
      // Nói người học SAI thì phải chỉ ra được tài liệu nói gì; nói ĐÚNG thì phải gắn tiêu chí hoặc nguồn.
      if (status === "contradicted" && !sourceCitation) { status = "unclear"; downgraded++; }
      else if (status === "observed" && !criterionId && !sourceCitation) { status = "unclear"; downgraded++; }
    }
    if (s.evidence.some((x) => x.messageId === msgId && x.criterion === e.criterion && x.status === status)) continue;
    newEvidence.push({
      id: id(), messageId: msgId, criterion: e.criterion, claim: e.claim, quote: e.quote, status,
      assisted: supportBefore > 0, supportLevelAtTime: s.state.hintLevel,
      criterionId, sourceCitation, context: answerContext(s.messages, msgId), createdAt: nowIso,
    });
  }
  s.evidence.push(...newEvidence);
  const observedNow = newEvidence.some((e) => e.status === "observed");

  // 3c. Gap: tạo/khớp gap; chỉ cho "resolved" khi có observed evidence thật ở lượt này
  if (observedNow) {
    for (const r of output.resolved_gaps) {
      const g = s.gaps.find((x) => x.status === "open" && sameConcept(x.concept, r));
      if (g) g.status = g.supportLevel > 0 || supportBefore > 0 ? "resolved_after_support" : "resolved";
    }
  }
  let focusGap: Gap | null = null;
  for (const c of output.suspected_gaps) {
    let g = s.gaps.find((x) => sameConcept(x.concept, c) && x.status !== "resolved" && x.status !== "resolved_after_support");
    if (!g) {
      g = { id: id(), concept: c, status: "open", supportLevel: 0 };
      s.gaps.push(g);
    } else if (g.status === "skipped") {
      g.status = "open";
    }
    focusGap ??= g;
  }

  const st = s.state;
  const prevGapId = st.currentGapId;
  if (focusGap) {
    if (focusGap.id === prevGapId) {
      st.roundOnSameGap = observedNow ? 0 : st.roundOnSameGap + 1;
    } else {
      st.currentGapId = focusGap.id;
      st.roundOnSameGap = 1;
      st.hintLevel = 0; // điểm vướng mới → bắt đầu lại từ gợi ý mức thấp
    }
  } else if (prevGapId && s.gaps.find((g) => g.id === prevGapId)?.status !== "open") {
    st.currentGapId = null;
    st.roundOnSameGap = 0;
  }

  // 3d. Mức hỗ trợ — tăng dần, không nhảy cóc trừ khi người dùng yêu cầu
  if (isSupportAction(action)) {
    const implied = action === "give_hint" ? Math.max(1, Math.min(2, output.hint_level)) : action === "give_example" ? 2 : 3;
    st.hintLevel = Math.min(3, Math.max(st.hintLevel, decision.targetHintLevel, implied)) as 0 | 1 | 2 | 3;
    st.supportCount += 1;
    const g = s.gaps.find((x) => x.id === st.currentGapId);
    if (g) g.supportLevel = Math.max(g.supportLevel, st.hintLevel);
    if (action === "show_answer") st.answerShown = true;
    st.roundOnSameGap = 0; // đã đổi sang hình thức hỗ trợ → đếm lại số vòng "chưa tiến triển"
  }

  // 3e. Chuyển phase (code quyết định, model chỉ gợi ý ready_for_transfer)
  const openGaps = s.gaps.filter((g) => g.status === "open");
  if (st.currentGapId && openGaps.length) st.phase = "repair";
  else if (output.ready_for_transfer && observedNow) st.phase = st.phase === "transfer" ? "reflect" : "transfer";
  else if (st.phase === "transfer" && observedNow && openGaps.length === 0) st.phase = "reflect";
  else if (st.phase === "entry") st.phase = st.mode === "reunderstand" ? "baseline" : "probe";
  else if (st.phase === "baseline" || st.phase === "repair") st.phase = "probe";

  st.agentLedRounds = intent ? 0 : st.agentLedRounds + 1;
  st.pendingModeSuggestion = output.suggest_mode_switch && output.suggest_mode_switch !== st.mode ? output.suggest_mode_switch : null;

  const fallbackText = "Mình chưa diễn đạt được ý này. Cậu thử nói lại cách cậu đang hiểu nhé?";
  const rendered = renderCitationMarkers(sanitizeAssistantText(output.assistant_text, fallbackText), validCites);
  const assistantText = rendered.text || fallbackText;
  s.messages.push({ id: id(), role: "assistant", text: assistantText, action, intent: null, citations: rendered.citations, createdAt: nowIso });
  s.updatedAt = nowIso;

  vSpan.set({
    action_coerced: coerced, final_action: action,
    evidence_proposed: output.observed_evidence.length, evidence_kept: newEvidence.length, evidence_dropped_fake_quote: dropped,
    evidence_downgraded_no_source: downgraded,
    citations_proposed: output.source_citations.length, citations_valid: validCites.size, citations_rendered: rendered.citations.length,
    gaps_open: s.gaps.filter((g) => g.status === "open").length,
  }).end();

  return {
    session: s,
    result: baseResult(s, id(), action, assistantText, newEvidence, { provider, model }, {
      quickReplies: quickRepliesFor(s),
      citations: rendered.citations,
    }),
  };
}

/** Câu trả lời này đáp lại câu hỏi gì của agent: tự giải thích hay vận dụng tình huống mới? */
function answerContext(messages: Message[], userMsgId: string): Evidence["context"] {
  const i = messages.findIndex((m) => m.id === userMsgId);
  for (let j = i - 1; j >= 0; j--) {
    const m = messages[j]!;
    if (m.role !== "assistant") continue;
    if (m.action === "transfer_question") return "transfer";
    if (m.action === "ask_explain" || m.action === "ask_why") return "explain";
    return "other";
  }
  return "other";
}

async function callTurnModel(
  router: ModelRouter, system: string, user: string, allowed: Action[], span: SpanHandle,
): Promise<{ output: TurnOutput; provider: string; model: string; attempts: number }> {
  let res;
  try {
    res = await router.generate({ system, user, maxOutputTokens: 900, purpose: "turn" }, span);
  } catch (e) {
    throw new AgentUnavailableError((e as Error).message);
  }
  const first = tryParse(res.text);
  if (first && allowed.includes(first.next_action)) return { output: first, provider: res.provider, model: res.model, attempts: 1 };
  span.set({ repair_reason: first ? "action_not_allowed" : "invalid_json" });

  // Một lần sửa: JSON hỏng hoặc chọn hành động ngoài tập cho phép (theo fallback policy).
  try {
    const fix = first
      ? await router.generate({
          system,
          user: `${user}\n\nLần trước bạn chọn next_action="${first.next_action}" — KHÔNG hợp lệ. Viết lại toàn bộ lượt với next_action thuộc ${JSON.stringify(allowed)}.`,
          maxOutputTokens: 900,
          purpose: "repair",
        }, span)
      : await router.generate({
          system: "Sửa đoạn sau thành MỘT object JSON hợp lệ đúng schema đã yêu cầu. Chỉ trả JSON.",
          user: `${system.slice(system.indexOf("ĐẦU RA"))}\nallowed_actions: ${JSON.stringify(allowed)}\n\nĐOẠN CẦN SỬA:\n${res.text.slice(0, 3000)}`,
          maxOutputTokens: 900,
          temperature: 0,
          purpose: "repair",
        }, span);
    const second = tryParse(fix.text);
    if (second) return { output: second, provider: fix.provider, model: fix.model, attempts: 2 };
  } catch {
    /* rơi xuống bên dưới */
  }
  // Còn bản parse được nhưng sai action → dùng, engine sẽ ép nhãn về tập hợp lệ.
  if (first) return { output: first, provider: res.provider, model: res.model, attempts: 2 };
  throw new AgentUnavailableError("INVALID_MODEL_OUTPUT");
}

function tryParse(text: string): TurnOutput | null {
  try {
    const r = TurnOutputSchema.safeParse(extractJson(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Khi lịch sử dài: tóm tắt phần cũ bằng model nhẹ; lỗi thì bỏ qua (không chặn lượt). */
async function maybeSummarize(s: Session, deps: EngineDeps, parent: SpanHandle): Promise<void> {
  const KEEP = 6, THRESHOLD = 14;
  if (!deps.light || s.messages.length < THRESHOLD) return;
  const older = s.messages.slice(0, -KEEP);
  try {
    const p = summaryPrompt(s, older);
    const res = await deps.light.generate({ system: p.system, user: p.user, maxOutputTokens: 300, temperature: 0.2, purpose: "summary" }, parent);
    const parsed = SummaryOutputSchema.safeParse(extractJson(res.text));
    if (parsed.success) s.state.summary = parsed.data.summary;
  } catch {
    /* tóm tắt là tối ưu hoá, không bắt buộc */
  }
}

function quickRepliesFor(s: Session): UserIntent[] {
  const st = s.state;
  let q: UserIntent[];
  if (st.phase === "repair") q = ["hint", "give_example", "show_answer", "skip"];
  else if (st.phase === "transfer" || st.phase === "reflect") q = ["try", "explain_more", "finish"];
  else if (st.mode === "explore") q = ["explain_more", "give_example", "try", "change_topic", "finish"];
  else q = ["hint", "give_example", "show_answer", "finish"];
  if (st.pendingModeSuggestion) q = ["switch_mode", ...q];
  return q;
}

function baseResult(
  s: Session, turnId: string, action: TurnResult["action"], text: string, newEvidence: Evidence[],
  modelInfo: TurnResult["modelInfo"], extra: Partial<TurnResult>,
): TurnResult {
  return {
    turnId,
    phase: s.state.phase,
    action,
    assistantText: text,
    hintLevel: s.state.hintLevel,
    gaps: s.gaps,
    newEvidence,
    suggestModeSwitch: s.state.pendingModeSuggestion,
    quickReplies: [],
    isFinished: s.status === "finished",
    citations: [],
    traceId: null,
    modelInfo,
    ...extra,
  };
}

export type { Message };
