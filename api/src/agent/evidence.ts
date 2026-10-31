import type { Message } from "./types";

/**
 * Chuẩn hoá để so khớp trích dẫn: NFC, chữ thường, bỏ dấu câu/ngoặc kép,
 * gộp khoảng trắng. KHÔNG bỏ dấu tiếng Việt (tránh khớp nhầm nghĩa).
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[“”"'‘’`«»„]/g, "")
    .replace(/[.,;:!?()\[\]{}<>…–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kiểm tra quote do model đưa ra có THỰC SỰ nằm trong lời người học không.
 * - Chỉ đối chiếu với tin nhắn role=user (không chấp nhận trích lời AI).
 * - Hỗ trợ trích có "..." : mọi đoạn phải xuất hiện theo thứ tự trong cùng 1 tin.
 * - Đoạn quá ngắn (< 2 từ) bị loại để tránh "khớp" vô nghĩa.
 * Trả về messageId nếu hợp lệ, ngược lại null.
 */
export function findQuoteSource(quote: string, messages: Message[]): string | null {
  const parts = quote
    .split(/\.\.\.|…/)
    .map(normalizeForMatch)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const wordCount = parts.join(" ").split(" ").length;
  if (wordCount < 2) return null;

  // Ưu tiên tin nhắn mới nhất.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const hay = normalizeForMatch(m.text);
    let from = 0;
    let ok = true;
    for (const p of parts) {
      const idx = hay.indexOf(p, from);
      if (idx < 0) {
        ok = false;
        break;
      }
      from = idx + p.length;
    }
    if (ok) return m.id;
  }
  return null;
}
