import type { Citation, RetrievedChunk, WebCitation } from "../agent/types";
import type { WebPassage } from "../web/search";
import { containsQuote, repairQuote } from "./text";

/** Đặt nhãn S1..Sk cho các đoạn truy xuất được — model chỉ thấy nhãn, không thấy id thật. */
export function aliasMap(retrieved: RetrievedChunk[]): Map<string, RetrievedChunk> {
  return new Map(retrieved.map((r, i) => [`S${i + 1}`, r]));
}

/** Nhãn W1..Wn cho đoạn web — tách khỏi nhãn S của tài liệu người học. */
export function webAliasMap(passages: WebPassage[]): Map<string, WebPassage> {
  return new Map(passages.map((p, i) => [`W${i + 1}`, p]));
}

export function toCitation(r: RetrievedChunk, quote: string): Citation {
  return { chunkId: r.chunk.id, documentId: r.chunk.documentId, documentTitle: r.documentTitle, page: r.chunk.page, quote };
}

/** Trích dẫn hợp lệ khi: nhãn tồn tại trong lượt này VÀ quote có nguyên văn trong đoạn đó. */
export function validateCitation(alias: string | null | undefined, quote: string | null | undefined, map: Map<string, RetrievedChunk>): Citation | null {
  if (!alias || !quote) return null;
  const r = map.get(alias.trim().toUpperCase());
  if (!r) return null;
  if (containsQuote(r.chunk.text, quote)) return toCitation(r, quote);
  // Model chép lệch vài chữ: nhận khi câu THẬT trong đúng đoạn đó khớp ≥ 80% — hiển thị câu thật, không phải chữ của model.
  const real = repairQuote(r.chunk.text, quote, 0.8);
  return real ? toCitation(r, real) : null;
}

/**
 * Trích dẫn web hợp lệ khi: nhãn W có trong lượt này VÀ quote có nguyên văn trong chữ của trang code đã tải.
 * url / tên trang / tiêu đề lấy từ dữ liệu (L6), không lấy từ câu chữ của model.
 */
export function validateWebCitation(alias: string | null | undefined, quote: string | null | undefined, map: Map<string, WebPassage>): WebCitation | null {
  if (!alias || !quote) return null;
  const p = map.get(alias.trim().toUpperCase());
  if (!p) return null;
  return containsQuote(p.text, quote) ? { url: p.url, siteName: p.siteName, title: p.title, quote } : null;
}

const MARKER = /\[\s*([SW]\d+(?:\s*[,;]\s*[SW]\d+)*)\s*\]/gi;
const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+/;

export interface RenderedText {
  text: string;
  citations: Citation[];
  webCitations: WebCitation[];
  /** Số câu khẳng định bị xoá vì nhãn trích dẫn không hợp lệ. */
  removedClaims: number;
  /** Số câu được GIỮ (bỏ nhãn) vì nếu xoá thì câu trả lời mất quá nửa — người gọi phải ghi rõ "chưa đối chiếu được". */
  unverifiedKept?: number;
}

export interface RenderOptions {
  /** Nhãn S có thật trong lượt này (đoạn tài liệu đã đưa cho model) — chỉ những nhãn này mới được "giữ câu, ghi chú chưa đối chiếu". */
  realAliases?: Set<string>;
  /** Xoá câu làm mất ≥ tỉ lệ này phần nội dung (không tính câu hỏi) → chuyển sang giữ câu + ghi chú. Mặc định 0,5. */
  keepIfLosing?: number;
}

/**
 * Đổi [S2] → [1], [2]... và [W3] → [W1], [W2]... theo thứ tự xuất hiện.
 * Nhãn KHÔNG có trích dẫn hợp lệ: xoá nhãn VÀ câu khẳng định chứa nó (sửa lỗ hổng B-1), trừ khi câu đó là câu hỏi
 * hoặc còn nhãn hợp lệ khác. Không đụng khối ```code```. Nếu xoá xong không còn chữ → chỉ xoá nhãn như cũ.
 */
export function renderCitationMarkers(text: string, valid: Map<string, Citation>, validWeb: Map<string, WebCitation> = new Map(), opts: RenderOptions = {}): RenderedText {
  const strict = renderPass(text, valid, validWeb, false);
  const real = opts.realAliases;
  if (!real?.size || !strict.out.removedClaims || !strict.onlyRealRemoved(real)) return strict.out;
  // Câu bị xoá đều trích một đoạn CÓ THẬT trong lượt (chỉ chép lệch câu căn cứ) và xoá thì mất quá nửa câu trả lời
  // → giữ câu, bỏ nhãn, báo cho người gọi ghi chú "chưa đối chiếu được nguyên văn" (không để câu trả lời trống rỗng).
  const plain = (t: string) => t.replace(MARKER, "").split(/(?<=[.!?…])\s+|\n+/).filter((x) => !/\?\s*$/.test(x.trim())).join(" ").replace(/\s+/g, " ").trim().length;
  const before = plain(text), after = plain(strict.out.text);
  if (!before || (before - after) / before < (opts.keepIfLosing ?? 0.5)) return strict.out;
  const lenient = renderPass(text, valid, validWeb, true, real);
  return { ...lenient.out, removedClaims: 0, unverifiedKept: strict.out.removedClaims };
}

function renderPass(text: string, valid: Map<string, Citation>, validWeb: Map<string, WebCitation>, keepReal: boolean, real?: Set<string>) {
  const isValid = (a: string) => (a[0] === "W" ? validWeb.has(a) : valid.has(a));
  const parts = (group: string) => group.split(/[,;]/).map((a) => a.trim().toUpperCase());
  const removedAliases: string[][] = [];

  let removedClaims = 0;
  let inCode = false;
  const lines = text.split("\n").map((line) => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return line; }
    if (inCode) return line;
    const marks = [...line.matchAll(MARKER)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, ok: parts(m[1]!).some(isValid) }));
    if (!marks.some((m) => !m.ok)) return line;
    let out = line;
    const prefixLen = LIST_PREFIX.exec(line)?.[0].length ?? 0;
    for (const m of [...marks].reverse()) {
      if (m.ok) continue;
      const span = sentenceAround(out, m.start, m.end, prefixLen);
      const sentence = out.slice(span.start, span.end);
      const hasValidOther = marks.some((o) => o !== m && o.ok && o.start >= span.start && o.end <= span.end);
      const question = /\?\s*(\[[^\]]*\]\s*)*[.!]?\s*$/.test(sentence) || /\?/.test(sentence.replace(MARKER, ""));
      const aliases = parts(line.slice(m.start + 1, m.end - 1));
      if (hasValidOther || question || (keepReal && real && aliases.every((a) => real.has(a)))) {
        out = out.slice(0, m.start) + out.slice(m.end);
      } else {
        out = out.slice(0, span.start) + out.slice(span.end);
        removedClaims++;
        removedAliases.push(aliases);
      }
    }
    return out.slice(prefixLen).trim() || !prefixLen ? out : ""; // gạch đầu dòng chỉ còn ký hiệu → bỏ
  });
  let body = lines.filter((l, i) => !(l === "" && text.split("\n")[i] !== "")).join("\n");
  if (!body.replace(MARKER, "").trim()) {
    body = text; // xoá hết thì giữ chữ, chỉ bỏ nhãn (không để trống câu trả lời)
    removedClaims = 0;
  }

  const order: string[] = [];
  const webOrder: string[] = [];
  const rendered = body.replace(MARKER, (_m, group: string) => {
    const docs: number[] = [];
    const webs: number[] = [];
    for (const a of parts(group).filter(isValid)) {
      if (a[0] === "W") { if (!webOrder.includes(a)) webOrder.push(a); webs.push(webOrder.indexOf(a) + 1); }
      else { if (!order.includes(a)) order.push(a); docs.push(order.indexOf(a) + 1); }
    }
    const d = docs.length ? `[${[...new Set(docs)].join(", ")}]` : "";
    const w = [...new Set(webs)].map((n) => `[W${n}]`).join("");
    return d + w;
  });
  // Chỉ dọn khoảng trắng thừa do bỏ nhãn/câu (giữa chữ trên cùng dòng) — không đụng thụt lề code/bảng markdown.
  const tidy = rendered.replace(/(\S)[ \t]+([.,;!?])(?=\s|$)/g, "$1$2").replace(/(\S) {2,}(?=\S)/g, "$1 ");
  return {
    out: { text: tidy.trim(), citations: order.map((a) => valid.get(a)!), webCitations: webOrder.map((a) => validWeb.get(a)!), removedClaims } as RenderedText,
    onlyRealRemoved: (realSet: Set<string>) => removedAliases.every((as) => as.every((a) => realSet.has(a))),
  };
}

/** Phạm vi câu chứa nhãn [start,end): từ sau dấu kết câu trước đó tới hết dấu kết câu ngay sau nhãn. */
function sentenceAround(line: string, mStart: number, mEnd: number, minStart: number): { start: number; end: number } {
  // Nhãn đứng sau dấu chấm ("... đúng. [S2]") thuộc về câu trước nó.
  let core = mStart;
  while (core > minStart && /[\s.!?…]/.test(line[core - 1]!)) core--;
  let start = minStart;
  const re = /[.!?…]+["”)]?\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.slice(0, core)))) if (m.index + m[0].length > start) start = m.index + m[0].length;
  let end = mEnd;
  const tail = /^[ \t]*[.!?…]*["”)]?/.exec(line.slice(end));
  end += tail?.[0].length ?? 0;
  // Nhãn đặt giữa câu ("A [S2] nên B.") → kéo tới hết câu.
  if (!/[.!?…]["”)]?$/.test(line.slice(start, end).trimEnd())) {
    const next = /[.!?…]+["”)]?(\s|$)/.exec(line.slice(end));
    end = next ? end + next.index + next[0].length : line.length;
  }
  while (end < line.length && /\s/.test(line[end]!)) end++;
  return { start, end };
}

/**
 * L7: xoá mọi link trong lời model không thuộc kết quả web của CHÍNH lượt này (link tự thêm theo trí nhớ).
 * Link markdown [chữ](url) không hợp lệ → giữ chữ, bỏ link.
 */
export function stripUnlistedLinks(text: string, allowed: Iterable<string>): { text: string; removed: number } {
  const ok = new Set([...allowed].map(normUrl));
  let removed = 0;
  let inCode = false;
  const out = text.split("\n").map((line) => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return line; }
    if (inCode) return line;
    return line
      .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (m, label: string, url: string) => (ok.has(normUrl(url)) ? m : (removed++, label)))
      .replace(/(?<!\]\()(?<![\w/])https?:\/\/[^\s<>()\]"']+/g, (url) => {
        const clean = url.replace(/[.,;:!?]+$/, "");
        return ok.has(normUrl(clean)) ? url : (removed++, url.slice(clean.length));
      });
  });
  return { text: out.join("\n").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " "), removed };
}

function normUrl(u: string): string {
  try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return u; }
}
