import type { RetrievedChunk } from "../agent/types";
import type { Store } from "../store/types";
import type { Embedder } from "./embeddings";
import { NoopTrace, type SpanHandle, type Trace } from "../obs/tracer";

/** Truy xuất lai: BM25 (luôn có) + vector (nếu có embedder và tài liệu đã embedding), gộp bằng RRF. */
export class Retriever {
  constructor(private store: Store, private embedder: Embedder | null) {}

  async search(
    userId: string, documentIds: string[], query: string, k = 4,
    opts: { trace?: Trace; parent?: SpanHandle | null; purpose?: string } = {},
  ): Promise<RetrievedChunk[]> {
    const trace = opts.trace ?? new NoopTrace();
    if (documentIds.length === 0 || !query.trim()) return [];
    return trace.run("rag.retrieve", "retriever", opts.parent ?? null, async (span) => {
      let embedding: number[] | null = null;
      let method = "lexical";
      if (this.embedder) {
        try {
          embedding = (await this.embedder.embed([query], "RETRIEVAL_QUERY"))[0] ?? null;
          method = "hybrid";
        } catch (e) {
          span.set({ embed_error: (e as Error).message }); // không chặn lượt: lùi về từ khoá
        }
      }
      const res = await this.store.searchChunks(userId, documentIds, { text: query, embedding }, k);
      span.set({
        purpose: opts.purpose ?? "turn", method, k, documents: documentIds.length,
        results: res.map((r) => ({
          chunk_id: r.chunk.id, document_id: r.chunk.documentId, page: r.chunk.page, score: round(r.score),
          lexical_rank: r.lexicalRank, vector_rank: r.vectorRank, suspicious: r.chunk.suspicious,
        })),
      }).io(trace.content(query), { hits: res.length });
      return res;
    });
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
