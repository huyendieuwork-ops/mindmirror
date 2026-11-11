/**
 * GraphRAG khi trả lời: tìm đoạn tài liệu (RAG) → lấy khái niệm xuất hiện ở các trang đó + khái niệm theo tên
 * → mở rộng theo đồ thị: khái niệm NỀN (CAN_BIET_TRUOC → khái niệm đang vướng) và khái niệm LIÊN QUAN.
 * Mỗi quan hệ chỉ được dùng khi đoạn căn cứ vẫn còn trong tài liệu được phép và quote vẫn có nguyên văn trong đó
 * (kiểm lại lúc đọc — phòng đồ thị cũ hoặc bị sửa).
 */
import type { RetrievedChunk } from "../agent/types";
import type { Retriever } from "../rag/retriever";
import { containsQuote, syllables } from "../rag/text";
import { pageKey, type GraphRelation, type GraphStore } from "./types";
import { conceptKey } from "./build";

export interface GraphContextRelation extends GraphRelation {
  fromName: string;
  toName: string;
  chunk: RetrievedChunk;   // đoạn căn cứ đã kiểm lại
}

export interface GraphContext {
  seeds: { key: string; name: string; byName: boolean; pageRank: number | null }[];
  prerequisites: GraphContextRelation[];  // X —CAN_BIET_TRUOC→ (khái niệm đang vướng)
  related: GraphContextRelation[];
  ragPages: number;
  droppedStale: number;
}

export async function graphContext(o: {
  userId: string; documentIds: string[]; query: string; concept?: string | null;
  graph: GraphStore; retriever: Retriever | null; limit?: number;
}): Promise<GraphContext> {
  // 1. RAG trước: trang chứa đoạn liên quan nhất.
  const rag = o.retriever && o.documentIds.length ? await o.retriever.search(o.userId, o.documentIds, o.query, 4) : [];
  const pageKeys = rag.map((r) => pageKey(r.chunk.documentId, r.chunk.page));
  // 2. Khái niệm theo tên (khái niệm đang vướng hoặc câu hỏi).
  const keys = [...new Set([o.concept, o.concept ? conceptKey(o.concept) : null].filter(Boolean).map((x) => syllables(x!).join(" ")).filter((k) => k.length >= 2))];
  const nb = await o.graph.neighborhood(o.userId, o.documentIds, { keys, pageKeys }, o.limit ?? 20);
  // 3. Kiểm lại căn cứ: đoạn còn tồn tại, thuộc tài liệu cho phép, quote còn nguyên văn.
  const ids = [...new Set(nb.relations.map((r) => r.evidence.chunkId))];
  const chunks = o.retriever && ids.length ? await o.retriever.getChunks(o.userId, ids) : [];
  const byId = new Map(chunks.map((c) => [c.chunk.id, c]));
  let droppedStale = 0;
  const verified: GraphContextRelation[] = [];
  for (const r of nb.relations) {
    const c = byId.get(r.evidence.chunkId);
    if (!c || (o.documentIds.length && !o.documentIds.includes(c.chunk.documentId)) || !containsQuote(c.chunk.text, r.evidence.quote)) { droppedStale++; continue; }
    verified.push({ ...r, chunk: c });
  }
  // Ưu tiên khái niệm đang vướng (theo tên) làm "đích" của quan hệ cần-biết-trước.
  // Không nêu tên → khái niệm ở trang RAG xếp cao nhất là đích.
  const focus = nb.seeds.filter((s) => s.byName).map((s) => s.key);
  const top = nb.seeds.filter((s) => s.pageRank !== null).sort((a, b) => a.pageRank! - b.pageRank!)[0]?.pageRank ?? null;
  const targets = new Set(focus.length ? focus : nb.seeds.filter((s) => s.pageRank === top).map((s) => s.key));
  return {
    seeds: nb.seeds,
    prerequisites: verified.filter((r) => r.type === "CAN_BIET_TRUOC" && targets.has(r.to)),
    related: verified.filter((r) => r.type === "LIEN_QUAN" || (r.type === "CAN_BIET_TRUOC" && !targets.has(r.to))),
    ragPages: new Set(pageKeys).size,
    droppedStale,
  };
}
