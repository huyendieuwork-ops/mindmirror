import { tokenize } from "./text";
import type { Chunk } from "../agent/types";

/** BM25 trên tập ứng viên (thường chỉ vài trăm đoạn của các tài liệu đã chọn). */
export function bm25Rank(query: string, chunks: Chunk[], k1 = 1.2, b = 0.75): { chunk: Chunk; score: number }[] {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0 || chunks.length === 0) return [];
  const docs = chunks.map((c) => tokenize(`${c.heading ?? ""} ${c.searchText}`));
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const boost = t.includes("_") ? 1.5 : 1; // khớp cụm 2 âm tiết đáng tin hơn
      score += boost * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return { chunk: chunks[i]!, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function vectorRank(qv: number[], chunks: Chunk[]): { chunk: Chunk; score: number }[] {
  return chunks
    .filter((c) => c.embedding && c.embedding.length === qv.length)
    .map((c) => ({ chunk: c, score: cosine(qv, c.embedding!) }))
    .sort((a, b) => b.score - a.score);
}

/** Reciprocal Rank Fusion: gộp thứ hạng từ khoá + ngữ nghĩa, không cần chuẩn hoá điểm. */
export function rrf(
  lists: { chunk: Chunk; score: number }[][],
  k = 60,
): { chunk: Chunk; score: number; ranks: (number | null)[] }[] {
  const acc = new Map<string, { chunk: Chunk; score: number; ranks: (number | null)[] }>();
  lists.forEach((list, li) => {
    list.forEach((item, rank) => {
      const e = acc.get(item.chunk.id) ?? { chunk: item.chunk, score: 0, ranks: lists.map(() => null) };
      e.score += 1 / (k + rank + 1);
      e.ranks[li] = rank + 1;
      acc.set(item.chunk.id, e);
    });
  });
  return [...acc.values()].sort((a, b) => b.score - a.score);
}
