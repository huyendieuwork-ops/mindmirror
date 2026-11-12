/**
 * Xử lý văn bản tiếng Việt cho RAG.
 * - Chuẩn hoá Unicode NFC + vị trí dấu thanh kiểu cũ/mới (hoá ↔ hóa, thuỷ ↔ thủy) để tìm kiếm không trượt.
 * - Token = âm tiết + cặp âm tiết liền kề (bigram) vì từ tiếng Việt thường gồm 2 âm tiết ("chuẩn hóa", "phụ thuộc").
 */

// Đưa mọi biến thể đặt dấu về cùng một dạng (chỉ cần NHẤT QUÁN giữa truy vấn và tài liệu).
const TONE_MAP: [RegExp, string][] = [
  [/oá/g, "óa"], [/oà/g, "òa"], [/oả/g, "ỏa"], [/oã/g, "õa"], [/oạ/g, "ọa"],
  [/oé/g, "óe"], [/oè/g, "òe"], [/oẻ/g, "ỏe"], [/oẽ/g, "õe"], [/oẹ/g, "ọe"],
  [/uý/g, "úy"], [/uỳ/g, "ùy"], [/uỷ/g, "ủy"], [/uỹ/g, "ũy"], [/uỵ/g, "ụy"],
];

export function normalizeVi(s: string): string {
  let t = s.normalize("NFC").toLowerCase();
  for (const [re, rep] of TONE_MAP) t = t.replace(re, rep);
  return t;
}

// Hư từ rất phổ biến — bỏ khỏi unigram để BM25 tập trung vào thuật ngữ.
const STOP = new Set([
  "và", "là", "của", "có", "các", "những", "một", "cho", "trong", "được", "khi", "với", "thì", "này", "đó", "để",
  "không", "nào", "gì", "ra", "vào", "từ", "theo", "như", "nếu", "mà", "thế", "sao", "vì", "bị", "đã", "sẽ", "cần",
  "the", "a", "an", "of", "to", "in", "is", "and", "or",
]);

export function syllables(s: string): string[] {
  return normalizeVi(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function tokenize(s: string): string[] {
  const syl = syllables(s);
  const out: string[] = [];
  for (let i = 0; i < syl.length; i++) {
    const w = syl[i]!;
    if (!STOP.has(w) && w.length > 0) out.push(w);
    if (i + 1 < syl.length) out.push(`${w}_${syl[i + 1]}`);
  }
  return out;
}

export function searchText(s: string): string {
  return syllables(s).join(" ");
}

/** Quote có nằm trong văn bản không (bỏ qua hoa/thường, dấu câu, khoảng trắng, kiểu đặt dấu). Hỗ trợ "...". */
export function containsQuote(haystack: string, quote: string, minWords = 3): boolean {
  const hay = syllables(haystack).join(" ");
  const parts = quote.split(/\.\.\.|…/).map((p) => syllables(p).join(" ")).filter(Boolean);
  if (parts.length === 0 || parts.join(" ").split(" ").length < minWords) return false;
  let from = 0;
  for (const p of parts) {
    const i = hay.indexOf(p, from);
    if (i < 0) return false;
    from = i + p.length;
  }
  return true;
}

/** Tách đoạn thành câu (giữ nguyên chữ gốc) — để lấy câu căn cứ thật thay cho quote model chép lệch. */
export function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?…;])\s+|\n+/).map((s) => s.trim()).filter((s) => syllables(s).length >= 3);
}

/**
 * Quote model chép LỆCH vài chữ (đổi từ, bỏ dấu câu, đảo nhẹ) → tìm câu THẬT trong đoạn khớp nhất.
 * Chỉ nhận khi ≥ `min` âm tiết khác nhau của quote có trong câu VÀ ≥ `min - 0.2` cặp âm tiết liền kề (giữ thứ tự) cũng có.
 * Trả về câu gốc (chữ thật của tài liệu) — không bao giờ trả lại chữ của model.
 */
export function repairQuote(haystack: string, quote: string, min = 0.8): string | null {
  const q = syllables(quote);
  const qs = new Set(q);
  if (qs.size < 4) return null;
  const qb = new Set(q.slice(1).map((w, i) => `${q[i]} ${w}`));
  let best: string | null = null, score = 0;
  for (const s of sentencesOf(haystack)) {
    const t = syllables(s);
    const ts = new Set(t);
    const tb = new Set(t.slice(1).map((w, i) => `${t[i]} ${w}`));
    let hit = 0, bhit = 0;
    for (const w of qs) if (ts.has(w)) hit++;
    for (const b of qb) if (tb.has(b)) bhit++;
    const sc = hit / qs.size;
    if (sc > score && (!qb.size || bhit / qb.size >= min - 0.2)) { score = sc; best = s; }
  }
  return best && score >= min ? best.slice(0, 400) : null;
}

/** Câu đầu tiên trong đoạn có chứa thuật ngữ (so theo âm tiết, đúng ranh giới từ). */
export function sentenceWithTerms(text: string, terms: string[][]): string | null {
  const keys = terms.map((alts) => alts.map((t) => syllables(t).join(" ")).filter((k) => k.length >= 2));
  if (keys.some((alts) => !alts.length)) return null;
  for (const s of sentencesOf(text)) {
    const hay = ` ${syllables(s).join(" ")} `;
    if (keys.every((alts) => alts.some((k) => hay.includes(` ${k} `)))) return s.slice(0, 400);
  }
  return null;
}

// Câu có dạng chỉ thị cho AI → đánh dấu đoạn nghi prompt injection (vẫn lưu, nhưng cảnh báo).
const INJECTION = [
  /ignore (all )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the )?(system|previous)/i,
  /you are now|act as (an?|the) /i,
  /(bỏ qua|phớt lờ) (mọi|tất cả|các) (hướng dẫn|chỉ dẫn|chỉ thị)/i,
  /(hãy|phải) (chấm|đánh giá|cho) (người học|sinh viên|tôi|em)? ?(đúng|điểm tối đa|100)/i,
  /system prompt|<\/?system>/i,
];
export function looksLikeInjection(s: string): boolean {
  return INJECTION.some((re) => re.test(s));
}

export interface PageInput {
  page: number | null;
  text: string;
}

export interface ChunkDraft {
  ordinal: number;
  page: number | null;
  heading: string | null;
  text: string;
}

/**
 * Cắt tài liệu thành đoạn ~maxChars, giữ số trang và tiêu đề gần nhất.
 * Slide thường ngắn → mỗi slide 1 đoạn. Đoạn dài → cắt theo đoạn văn/câu, có chồng lấn nhỏ.
 */
export function chunkPages(pages: PageInput[], opts: { maxChars?: number; overlap?: number } = {}): ChunkDraft[] {
  const max = opts.maxChars ?? 900;
  const overlap = opts.overlap ?? 120;
  const out: ChunkDraft[] = [];
  let heading: string | null = null;

  for (const pg of pages) {
    const clean = pg.text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) continue;
    const lines = clean.split("\n");
    const h = lines.find((l) => isHeading(l));
    if (h) heading = h.trim().slice(0, 120);

    if (clean.length <= max) {
      out.push({ ordinal: out.length, page: pg.page, heading, text: clean });
      continue;
    }
    const units = clean
      .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÀ-Ỹ0-9“"(])/u)
      .map((u) => u.trim())
      .filter(Boolean)
      .flatMap((u) => (u.length > max ? splitByWords(u, max) : [u])); // không bao giờ cắt cụt mất chữ
    let buf = "";
    for (const piece of units) {
      if (buf && (buf + " " + piece).length > max) {
        out.push({ ordinal: out.length, page: pg.page, heading, text: buf });
        buf = buf.slice(Math.max(0, buf.length - overlap)).replace(/^\S*\s/, "") + " " + piece;
      } else buf = buf ? `${buf} ${piece}` : piece;
    }
    if (buf.trim()) out.push({ ordinal: out.length, page: pg.page, heading, text: buf.trim() });
  }
  return out;
}

function splitByWords(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/)) {
    if (cur && (cur + " " + w).length > max) { out.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

function isHeading(l: string): boolean {
  const t = l.trim();
  if (t.length < 3 || t.length > 90 || /[.,;:]$/.test(t)) return false;
  return /^(chương|bài|phần|mục|chapter|section)\b/i.test(t) || /^\d+(\.\d+)*\.?\s+\S/.test(t) || (t === t.toUpperCase() && /\p{L}/u.test(t));
}
