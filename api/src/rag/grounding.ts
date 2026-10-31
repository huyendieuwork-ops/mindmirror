import type { Citation, RetrievedChunk } from "../agent/types";
import { containsQuote } from "./text";

/** Đặt nhãn S1..Sk cho các đoạn truy xuất được — model chỉ thấy nhãn, không thấy id thật. */
export function aliasMap(retrieved: RetrievedChunk[]): Map<string, RetrievedChunk> {
  return new Map(retrieved.map((r, i) => [`S${i + 1}`, r]));
}

export function toCitation(r: RetrievedChunk, quote: string): Citation {
  return { chunkId: r.chunk.id, documentId: r.chunk.documentId, documentTitle: r.documentTitle, page: r.chunk.page, quote };
}

/** Trích dẫn hợp lệ khi: nhãn tồn tại trong lượt này VÀ quote có nguyên văn trong đoạn đó. */
export function validateCitation(alias: string | null | undefined, quote: string | null | undefined, map: Map<string, RetrievedChunk>): Citation | null {
  if (!alias || !quote) return null;
  const r = map.get(alias.trim().toUpperCase());
  if (!r) return null;
  return containsQuote(r.chunk.text, quote) ? toCitation(r, quote) : null;
}

/**
 * Đổi [S2] trong lời AI thành [1], [2]... theo thứ tự xuất hiện; bỏ nhãn không có trích dẫn hợp lệ.
 * Trả về văn bản đã đổi + danh sách trích dẫn đúng thứ tự số.
 */
export function renderCitationMarkers(text: string, valid: Map<string, Citation>): { text: string; citations: Citation[] } {
  const order: string[] = [];
  const out = text.replace(/\[\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\]/gi, (_m, group: string) => {
    const nums = group
      .split(/[,;]/)
      .map((a) => a.trim().toUpperCase())
      .filter((a) => valid.has(a))
      .map((a) => {
        if (!order.includes(a)) order.push(a);
        return order.indexOf(a) + 1;
      });
    return nums.length ? `[${[...new Set(nums)].join(", ")}]` : "";
  });
  // Chỉ dọn khoảng trắng thừa do bỏ nhãn (giữa chữ trên cùng dòng) — không đụng thụt lề code/bảng markdown.
  const tidy = out.replace(/(\S)[ \t]+([.,;!?])(?=\s|$)/g, "$1$2").replace(/(\S) {2,}(?=\S)/g, "$1 ");
  return { text: tidy.trim(), citations: order.map((a) => valid.get(a)!) };
}
