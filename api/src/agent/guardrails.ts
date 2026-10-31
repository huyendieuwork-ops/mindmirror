/**
 * Guardrails hậu kiểm trên output của model (chạy bằng code, không tin model).
 */

// Câu khẳng định "% hiểu", chẩn đoán năng lực, "hiểu hoàn toàn"... bị loại.
const FORBIDDEN_SENTENCE = [
  /(hiểu|nắm|thành thạo|thông thạo)[^.!?\n]{0,30}\d{1,3}\s?%/i,
  /\d{1,3}\s?%[^.!?\n]{0,30}(hiểu|nắm|kiến thức)/i,
  /(đã|hoàn toàn) (hiểu|nắm vững) (hết|hoàn toàn|100)/i,
  /(não|trí tuệ|năng lực nhận thức) (của )?(cậu|bạn) (kém|yếu)/i,
  /(cậu|bạn|em) (học|tiếp thu|tư duy) (kém|chậm|yếu)/i,
  /(cậu|bạn|em) không có (khả năng|năng lực)/i,
];

/** Lọc câu theo điều kiện nhưng GIỮ cấu trúc dòng (bảng, danh sách, khối code markdown). */
export function filterSentences(text: string, bad: (sentence: string) => boolean): { text: string; removed: number } {
  let removed = 0;
  let inFence = false;
  const lines = text.split("\n").map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence || /^\s*\|/.test(line)) return line; // không sửa trong code/bảng
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((p) => { const b = bad(p); if (b) removed++; return !b; });
    return kept.join(" ");
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

export function stripForbiddenClaims(text: string): { text: string; removed: number } {
  return filterSentences(text, (s) => FORBIDDEN_SENTENCE.some((re) => re.test(s)));
}

/** Giới hạn độ dài hiển thị để tránh "bài giảng tràn lan". */
export function clampLength(text: string, max = 1800): string {
  if (text.length <= max) return text;
  // Không cắt giữa bảng/khối code: lùi về trước khối đang mở.
  const fence = text.lastIndexOf("```", max);
  if (fence > max * 0.5 && (text.slice(0, fence).match(/```/g)?.length ?? 0) % 2 === 0) return text.slice(0, fence).trimEnd() + "\n…";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut) + " …";
}

export function sanitizeAssistantText(text: string, fallback: string, max = 1800): string {
  const { text: t } = stripForbiddenClaims(text);
  const out = clampLength(t, max);
  return out.length > 0 ? out : fallback;
}

// ---------------- Output guardrails bổ sung (đều deterministic, có test) ----------------

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_\-]{30,}/g,                                  // Google API key
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}/g, // JWT
  /\b(sk|gsk|pk|lf)[-_][A-Za-z0-9_\-]{16,}/g,                  // khoá dạng sk-… (OpenAI/Groq/Langfuse)
];

/** Che mọi chuỗi giống khoá bí mật (phòng model lặp lại thứ nó thấy trong tài liệu/hội thoại). */
export function redactSecrets(text: string): { text: string; redacted: number } {
  let n = 0;
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, () => { n++; return "[đã ẩn]"; });
  return { text: out, redacted: n };
}

// Cụm từ chỉ có trong system prompt — xuất hiện trong câu trả lời = rò rỉ chỉ dẫn hệ thống.
const PROMPT_MARKERS = [/QUY TẮC BẮT BUỘC/, /allowed_actions/, /ĐẦU RA: chỉ trả về/, /observed_evidence/, /<\/?(sources|rubric|session|history)\b/];

export function leaksSystemPrompt(text: string): boolean {
  return PROMPT_MARKERS.filter((re) => re.test(text)).length >= 1;
}

// Khẳng định "đã hiểu/đúng hoàn toàn" khi lượt này KHÔNG có bằng chứng observed → không được phép.
const OVERCLAIM = [
  /(bạn|cậu|em) (đã )?(hiểu|nắm) (rất )?(rõ|đúng|vững|chắc|hoàn toàn|hết)( rồi)?/i,
  /(hoàn toàn|rất|cực kỳ) chính xác/i,
  /(bạn|cậu|em) (đã )?(nắm vững|thành thạo|làm chủ)/i,
];

export function stripUnsupportedPraise(text: string, hasObservedEvidence: boolean): { text: string; removed: number } {
  if (hasObservedEvidence) return { text, removed: 0 };
  return filterSentences(text, (s) => OVERCLAIM.some((re) => re.test(s)));
}

/** Độ trùng (trigram âm tiết) giữa câu trả lời và đáp án mẫu — đo "lộ đáp án quá sớm". 0..1 */
export function answerOverlap(text: string, reference: string): number {
  const grams = (s: string) => {
    const w = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9đ\s]/g, " ").split(/\s+/).filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return out;
  };
  const ref = grams(reference);
  if (ref.size < 3) return 0;
  const got = grams(text);
  let hit = 0;
  for (const g of ref) if (got.has(g)) hit++;
  return hit / ref.size;
}

/** Câu hỏi lặp lại gần như nguyên văn một lượt trước của chính agent (Jaccard âm tiết ≥ 0.8). */
export function isRepeatedQuestion(text: string, previous: string[]): boolean {
  const toks = (s: string) => new Set(s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1));
  const a = toks(text);
  if (a.size < 6) return false;
  return previous.some((p) => {
    const b = toks(p);
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    return inter / (a.size + b.size - inter) >= 0.8;
  });
}
