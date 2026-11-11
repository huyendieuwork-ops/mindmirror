import type { Action, LearningState, Session, UserIntent } from "./types";

/** Nhận diện ý định bằng luật (0 API call). Chỉ áp cho câu ngắn để tránh hiểu nhầm. */
export function detectIntent(text: string): UserIntent | null {
  const t = text.normalize("NFC").toLowerCase().trim();
  if (t.length === 0) return null;
  const short = t.length <= 60;

  if (/(cho\s+(em|tớ|mình|tôi|t)\s+(xin\s+)?(đáp án|lời giải|kết quả))|giải thích luôn|nói luôn đi|đáp án (đi|luôn)|bí quá|chịu rồi|xem đáp án/.test(t))
    return "show_answer";
  if (short && /(^|\s)(bỏ qua|bỏ câu này|skip|câu khác đi|qua câu khác)/.test(t)) return "skip";
  if (short && /^(kết thúc|dừng( lại)?|thôi( nhé| nha)?|end|kết thúc phiên|tổng kết( đi)?)[.!\s]*$/.test(t)) return "finish";
  if (short && /đổi chủ đề/.test(t)) return "change_topic";
  if (short && /(gợi ý|hint)( (đi|với|chút|nhé))?[.!?\s]*$/.test(t)) return "hint";
  if (short && /cho\s+((em|tớ|mình|tôi|t)\s+)?(xin\s+)?(một |1 )?ví dụ/.test(t)) return "give_example";
  if (short && /(giải thích rõ hơn|chưa hiểu lắm|nói rõ hơn)/.test(t)) return "explain_more";
  return null;
}

export interface Limits {
  turnsPerSession: number;
  maxRoundsSameGap: number;   // số vòng hỏi trên cùng 1 điểm vướng trước khi đổi cách
  maxAgentLedRounds: number;  // số vòng agent tự dẫn dắt trước khi nhường quyền
}

export const DEFAULT_LIMITS: Limits = { turnsPerSession: 12, maxRoundsSameGap: 2, maxAgentLedRounds: 6 };

export type PolicyDecision =
  | { kind: "finish" }
  | { kind: "deterministic"; action: "skip" | "limit_reached" | "switch_mode"; text: string; quickReplies: UserIntent[] }
  | {
      kind: "llm";
      allowedActions: Action[];
      forcedAction: Action | null;
      directive: string;          // chỉ thị bổ sung cho model ở lượt này (sinh bởi code)
      targetHintLevel: 0 | 1 | 2 | 3;
    };

const SOCRATIC: Action[] = ["ask_clarification", "ask_explain", "ask_why", "acknowledge", "transfer_question"];
const SUPPORT: Action[] = ["give_hint", "give_example", "explain_foundation"];

/**
 * Bộ điều phối chạy bằng code. Quyết định:
 *  - lượt nào xử lý không cần LLM (skip, hết lượt, đổi chế độ, kết thúc)
 *  - tập hành động hợp lệ mà LLM được chọn
 *  - mức gợi ý mục tiêu
 */
export function decide(session: Session, intent: UserIntent | null, limits: Limits = DEFAULT_LIMITS): PolicyDecision {
  const s = session.state;

  if (intent === "finish") return { kind: "finish" };

  if (intent === "skip") {
    return {
      kind: "deterministic",
      action: "skip",
      text: "Ok, mình bỏ qua câu này nhé — không sao cả. Bạn muốn đi tiếp phần khác, đổi chủ đề hay tổng kết luôn?",
      quickReplies: ["try", "change_topic", "finish"],
    };
  }

  if (intent === "switch_mode") {
    const to = s.mode === "explore" ? "Hiểu lại" : "Khám phá";
    return {
      kind: "deterministic",
      action: "switch_mode",
      text:
        to === "Hiểu lại"
          ? "Mình chuyển sang chế độ Hiểu lại nhé. Bạn thử giải thích điểm này theo cách bạn đang hiểu xem?"
          : "Mình chuyển sang chế độ Khám phá nhé. Bạn đang tò mò điều gì nhất quanh chủ đề này?",
      quickReplies: ["give_example", "finish"],
    };
  }

  // Hết lượt: không gọi LLM, không mất lịch sử.
  if (s.turnCount >= limits.turnsPerSession) {
    return {
      kind: "deterministic",
      action: "limit_reached",
      text: "Phiên này đã đạt số lượt tối đa của bản demo. Mình đã lưu lại mọi thứ — bạn có thể tạo thẻ Gương Hiểu Biết hoặc tạm dừng để tiếp tục sau.",
      quickReplies: ["finish"],
    };
  }

  // ---- Các ý định cần LLM nhưng hành động bị ép ----
  if (intent === "show_answer") {
    return {
      kind: "llm",
      allowedActions: ["show_answer"],
      forcedAction: "show_answer",
      directive:
        "Người dùng xin đáp án/giải thích trực tiếp. Hãy giải thích rõ ràng, đầy đủ, KHÔNG hỏi vặn thêm. Cuối cùng có thể hỏi (tùy chọn) một câu kiểm chứng ngắn nếu họ muốn thử.",
      targetHintLevel: 3,
    };
  }
  if (intent === "hint") {
    const lvl = Math.min(3, s.hintLevel + 1) as 1 | 2 | 3;
    return {
      kind: "llm",
      allowedActions: lvl === 3 ? ["explain_foundation", "give_example"] : ["give_hint"],
      forcedAction: lvl === 3 ? "explain_foundation" : "give_hint",
      directive: hintDirective(lvl),
      targetHintLevel: lvl,
    };
  }
  if (intent === "give_example") {
    return { kind: "llm", allowedActions: ["give_example"], forcedAction: "give_example",
      directive: "Đưa MỘT ví dụ nhỏ, cụ thể (ưu tiên dữ liệu/bảng tí hon hoặc tình huống đời thường), rồi mời người học tự rút ra nhận xét.",
      targetHintLevel: Math.max(2, s.hintLevel) as 2 | 3 };
  }
  if (intent === "explain_more") {
    return { kind: "llm", allowedActions: ["explain_foundation"], forcedAction: "explain_foundation",
      directive: "Giải thích rõ hơn phần kiến thức nền đang vướng, ngắn gọn (≤ 6 câu), sau đó mời người học diễn đạt lại.",
      targetHintLevel: 3 };
  }
  if (intent === "try") {
    return { kind: "llm", allowedActions: ["transfer_question"], forcedAction: "transfer_question",
      directive: "Đưa một tình huống/câu hỏi MỚI tương đương nhưng không giống hệt những gì đã gặp trong phiên. Không đưa đáp án.",
      targetHintLevel: s.hintLevel };
  }
  if (intent === "change_topic") {
    return { kind: "llm", allowedActions: ["ask_clarification", "suggest_directions"], forcedAction: null,
      directive: "Người dùng muốn đổi chủ đề. Hỏi ngắn họ muốn chuyển sang đâu, hoặc gợi 2–3 hướng liên quan. Không tiếp tục điểm cũ.",
      targetHintLevel: 0 };
  }

  // ---- Lượt tự do: code giới hạn tập hành động theo phase ----
  const lastUser = [...session.messages].reverse().find((m) => m.role === "user")?.text ?? "";
  return freeTurn(s, session.settings.supportPreference, limits, CONCRETE_QUESTION.test(lastUser));
}

/** Câu hỏi kiến thức cụ thể ("… là gì?", "… hoạt động thế nào?") — Khám phá nên trả lời luôn thay vì hỏi lại. */
const CONCRETE_QUESTION = /\?|\b(là gì|thế nào|như thế nào|ra sao|vì sao|tại sao|khác (gì|nhau|ở)|so sánh)\b/i;

function freeTurn(s: LearningState, pref: Session["settings"]["supportPreference"], limits: Limits, concreteQuestion = false): PolicyDecision {
  const directives: string[] = [];
  let allowed: Action[];
  let target = s.hintLevel;

  if (s.mode === "reunderstand" && (s.phase === "entry" || s.phase === "baseline") && s.turnCount <= 1) {
    // Hiểu lại: luôn mời tự giải thích trước, không giảng.
    allowed = ["ask_explain", "ask_clarification", "ask_why"];
    directives.push("Đây là đầu phiên Hiểu lại: mời người học tự giải thích bằng lời của họ trước. KHÔNG giảng bài.");
  } else if (s.mode === "explore" && s.phase === "entry" && concreteQuestion) {
    // Đợt 2: người học đã hỏi một câu cụ thể → trả lời câu đó (theo thứ tự nguồn), rồi mới gợi hướng tiếp.
    allowed = ["explain_foundation", "give_example", "suggest_directions", "acknowledge"];
    directives.push("Đầu phiên Khám phá và người học đã hỏi một câu cụ thể: trả lời ngắn gọn đúng câu đó trước (theo thứ tự nguồn E4), rồi gợi 2–3 hướng tìm hiểu tiếp. Không ép kiểm tra.");
  } else if (s.mode === "explore" && s.phase === "entry") {
    allowed = ["ask_clarification", "suggest_directions", "acknowledge"];
    directives.push("Đầu phiên Khám phá: làm rõ điều muốn tìm hiểu hoặc đề xuất 2–4 hướng để chọn. Không ép kiểm tra.");
  } else if (s.phase === "repair" && s.roundOnSameGap >= limits.maxRoundsSameGap) {
    // Đã hỏi ≥ 2 vòng trên cùng điểm mà chưa tiến triển → đổi dạng hỗ trợ.
    allowed = ["explain_foundation", "give_example"];
    target = Math.max(2, s.hintLevel) as 2 | 3;
    directives.push(
      `Đã ${s.roundOnSameGap} vòng trên cùng một điểm vướng mà chưa tiến triển. KHÔNG hỏi thêm câu Socratic; hãy đổi cách: cho ví dụ đơn giản hoặc kiến thức nền ngắn, rồi mời người học thử diễn đạt lại.`,
    );
  } else if (s.phase === "repair") {
    // transfer_question/acknowledge: khi người học tự sửa được ở lượt này thì cho thử tình huống mới ngay.
    allowed = pref === "direct"
      ? [...SUPPORT, "ask_why", "transfer_question", "acknowledge"]
      : ["ask_why", "give_hint", "give_example", "ask_clarification", "transfer_question", "acknowledge"];
    directives.push("Đang có điểm vướng: tập trung MỘT điểm, chỉ ra chỗ chưa khớp kèm trích lời người học, chọn hỗ trợ vừa đủ.");
  } else if (s.phase === "transfer" || s.phase === "reflect") {
    allowed = ["transfer_question", "acknowledge", "ask_why", "summarize"];
    directives.push("Người học đã thể hiện ý chính. Có thể thử tình huống mới hoặc gợi ý tổng kết — để người dùng chọn.");
  } else {
    allowed = s.mode === "explore"
      ? ["ask_why", "acknowledge", "suggest_directions", "give_example", "explain_foundation", "ask_clarification", "transfer_question"]
      : [...SOCRATIC, "give_hint", "give_example"];
  }

  if (s.agentLedRounds >= limits.maxAgentLedRounds) {
    directives.push("Agent đã dẫn dắt nhiều vòng liên tiếp: hãy nhường quyền — hỏi người dùng muốn tiếp tục, đổi hướng hay tổng kết.");
    if (!allowed.includes("acknowledge")) allowed.push("acknowledge");
  }

  if (pref === "direct") directives.push("Người dùng thích giải thích trực tiếp: đừng kéo dài chuỗi chất vấn.");

  return { kind: "llm", allowedActions: allowed, forcedAction: null, directive: directives.join(" "), targetHintLevel: target };
}

export function hintDirective(level: 1 | 2 | 3): string {
  switch (level) {
    case 1:
      return "Gợi ý MỨC 1: chỉ đặt một câu hỏi gợi mở hướng người học tới chỗ chưa khớp. Không nêu đáp án.";
    case 2:
      return "Gợi ý MỨC 2: đưa một ví dụ đơn giản hơn / trường hợp nhỏ để người học tự nhận ra. Không nêu kết luận.";
    case 3:
      return "Gợi ý MỨC 3: nhắc ngắn kiến thức nền cần thiết (≤ 5 câu), rồi mời người học tự áp dụng lại.";
  }
}

export function isSupportAction(a: Action): boolean {
  return a === "give_hint" || a === "give_example" || a === "explain_foundation" || a === "show_answer";
}
