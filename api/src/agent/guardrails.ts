/**
 * Guardrails hậu kiểm trên output của model (chạy bằng code, không tin model).
 */

// Câu khẳng định "% hiểu", chẩn đoán năng lực, "hiểu hoàn toàn"... bị loại.
const FORBIDDEN_SENTENCE = [
  /(hiểu|nắm|thành thạo|thông thạo)[^.!?\n]{0,30}\d{1,3}\s?%/i,
  /\d{1,3}\s?%[^.!?\n]{0,30}(hiểu|nắm|kiến thức)/i,
  /(đã|hoàn toàn) (hiểu|nắm vững) (hết|hoàn toàn|100)/i,
  /(não|trí tuệ|năng lực nhận thức) (của )?(cậu|bạn) (kém|yếu)/i,
];

export function stripForbiddenClaims(text: string): { text: string; removed: number } {
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  let removed = 0;
  const kept = sentences.filter((s) => {
    const bad = FORBIDDEN_SENTENCE.some((re) => re.test(s));
    if (bad) removed++;
    return !bad;
  });
  return { text: kept.join(" ").trim(), removed };
}

/** Giới hạn độ dài hiển thị để tránh "bài giảng tràn lan". */
export function clampLength(text: string, max = 1800): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut) + " …";
}

export function sanitizeAssistantText(text: string, fallback: string): string {
  const { text: t } = stripForbiddenClaims(text);
  const out = clampLength(t);
  return out.length > 0 ? out : fallback;
}
