import type { Chunk, DocumentKind, LibraryDocument } from "../agent/types";
import type { Store } from "../store/types";
import type { Embedder } from "./embeddings";
import { chunkPages, looksLikeInjection, searchText, type PageInput } from "./text";
import { fnv1a, NoopTrace, type SpanHandle, type Trace } from "../obs/tracer";

export const INGEST_LIMITS = { maxPages: 400, maxChars: 600_000, maxChunks: 1500 };

/**
 * Làm sạch văn bản trích từ PDF trước khi lưu: Postgres không nhận ký tự NUL (\u0000) và chuỗi UTF-16 hỏng
 * (lỗi "unsupported Unicode escape sequence" → 500). Bỏ ký tự điều khiển (trừ tab, xuống dòng, ngắt trang) và surrogate lẻ.
 */
export function cleanText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, " ")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/[\uFFFE\uFFFF]/g, "");
}

export class IngestError extends Error {
  constructor(readonly code: "empty" | "too_large" | "scanned_only") { super(code); }
}

export interface IngestInput {
  userId: string;
  title: string;
  kind: DocumentKind;
  pages: PageInput[];
  origin?: LibraryDocument["origin"];
}

export interface IngestDeps {
  store: Store;
  embedder: Embedder | null;
  trace?: Trace;
  parent?: SpanHandle | null;
  id?: () => string;
}

/**
 * Nhập tài liệu vào thư viện: làm sạch → cắt đoạn (giữ trang) → đánh dấu nghi injection → embedding → lưu.
 * Văn bản PDF/slide được trích ở CLIENT (pdf.js / đọc XML pptx) — Worker Free chỉ có 10 ms CPU/request.
 * Embedding lỗi KHÔNG làm hỏng việc nhập: tài liệu vẫn tìm được bằng từ khoá (embedded=false).
 */
export async function ingestDocument(input: IngestInput, deps: IngestDeps): Promise<{ document: LibraryDocument; duplicate: boolean }> {
  const trace = deps.trace ?? new NoopTrace();
  const id = deps.id ?? (() => crypto.randomUUID());
  return trace.run("rag.ingest", "chain", deps.parent ?? null, async (span) => {
    const pages = input.pages.slice(0, INGEST_LIMITS.maxPages + 1).map((p) => ({ ...p, text: cleanText(p.text) }));
    if (pages.length > INGEST_LIMITS.maxPages) throw new IngestError("too_large");
    const total = pages.reduce((a, p) => a + p.text.length, 0);
    if (total > INGEST_LIMITS.maxChars) throw new IngestError("too_large");
    if (total === 0) throw new IngestError("empty");

    const warnings: string[] = [];
    const scanned = pages.filter((p) => p.text.trim().length < 20).map((p) => p.page);
    if (scanned.length === pages.length) throw new IngestError("scanned_only");
    if (scanned.length) warnings.push(`scanned_pages:${scanned.slice(0, 20).join(",")}`);

    const contentHash = fnv1a(pages.map((p) => p.text).join("\f"));
    const dup = await deps.store.findDocumentByHash(input.userId, contentHash);
    if (dup) {
      span.set({ duplicate: true, document_id: dup.id });
      return { document: dup, duplicate: true };
    }

    const drafts = chunkPages(pages).slice(0, INGEST_LIMITS.maxChunks);
    const docId = id();
    const chunks: Chunk[] = drafts.map((d) => ({
      id: id(), documentId: docId, userId: input.userId, ordinal: d.ordinal, page: d.page, heading: d.heading,
      text: d.text, searchText: searchText(`${d.heading ?? ""} ${d.text}`), embedding: null, suspicious: looksLikeInjection(d.text),
    }));
    const suspicious = chunks.filter((c) => c.suspicious).length;
    if (suspicious) warnings.push("suspicious_instructions");

    let embedded = false;
    if (deps.embedder && chunks.length) {
      const es = span.child("rag.embed", "tool", { model: deps.embedder.model, chunks: chunks.length });
      try {
        const vecs = await deps.embedder.embed(chunks.map((c) => `${c.heading ? c.heading + "\n" : ""}${c.text}`), "RETRIEVAL_DOCUMENT");
        vecs.forEach((v, i) => { if (chunks[i]) chunks[i]!.embedding = v; });
        embedded = vecs.length === chunks.length;
      } catch (e) {
        es.fail(e);
        warnings.push("embedding_failed");
      } finally {
        es.end();
      }
    }

    const doc: LibraryDocument = {
      id: docId, userId: input.userId, title: cleanText(input.title).trim().slice(0, 200) || "Tài liệu", kind: input.kind,
      origin: input.origin ?? null, pageCount: pages.length, chunkCount: chunks.length, embedded, contentHash, warnings,
      createdAt: new Date().toISOString(),
    };
    await deps.store.saveDocument(doc, chunks);
    span.set({ document_id: docId, pages: pages.length, chunks: chunks.length, embedded, suspicious_chunks: suspicious, warnings });
    return { document: doc, duplicate: false };
  });
}
