import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument, IngestError } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { chunkPages, containsQuote, normalizeVi, tokenize } from "../src/rag/text";
import { aliasMap, renderCitationMarkers, validateCitation } from "../src/rag/grounding";
import { rrf } from "../src/rag/hybrid";
import type { Embedder } from "../src/rag/embeddings";

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const U = "11111111-1111-4111-8111-111111111111";

async function lib(embedder: Embedder | null = null) {
  const store = new MemoryStore();
  const { document } = await ingestDocument({ userId: U, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder });
  return { store, document, retriever: new Retriever(store, embedder) };
}

describe("xử lý tiếng Việt", () => {
  it("thống nhất kiểu đặt dấu: hoá = hóa, thuỷ = thủy", () => {
    expect(normalizeVi("Chuẩn hoá")).toBe(normalizeVi("chuẩn hóa"));
    expect(tokenize("thuỷ")).toEqual(tokenize("thủy"));
  });
  it("token gồm âm tiết và cặp âm tiết", () => {
    expect(tokenize("phụ thuộc hàm")).toEqual(expect.arrayContaining(["phụ", "phụ_thuộc", "thuộc_hàm"]));
  });
  it("cắt đoạn giữ số trang", () => {
    const ch = chunkPages([{ page: 5, text: "A ".repeat(800) }, { page: 6, text: "Ngắn gọn." }], { maxChars: 500 });
    expect(ch.length).toBeGreaterThan(2);
    expect(ch.at(-1)!.page).toBe(6);
  });
  it("containsQuote chịu được khác biệt dấu câu / kiểu đặt dấu, từ chối quote bịa", () => {
    const t = "Một quan hệ ở dạng chuẩn 2 khi nó đạt 1NF và mọi thuộc tính không khóa đều phụ thuộc đầy đủ vào khóa chính.";
    expect(containsQuote(t, "mọi thuộc tính không khoá đều phụ thuộc đầy đủ")).toBe(true);
    expect(containsQuote(t, "không có phụ thuộc bắc cầu vào khóa")).toBe(false);
  });
});

describe("nhập tài liệu", () => {
  it("đánh dấu đoạn nghi prompt injection, chống nhập trùng", async () => {
    const { store, document } = await lib();
    expect(document.warnings).toContain("suspicious_instructions");
    expect(store.chunks.get(document.id)!.some((c) => c.page === 60 && c.suspicious)).toBe(true);
    const again = await ingestDocument({ userId: U, title: "x", kind: "pdf", pages: corpus.pages }, { store, embedder: null });
    expect(again.duplicate).toBe(true);
  });
  it("PDF scan (không có chữ) → báo lỗi rõ ràng", async () => {
    await expect(ingestDocument({ userId: U, title: "scan", kind: "pdf", pages: [{ page: 1, text: " " }, { page: 2, text: "" }] }, { store: new MemoryStore(), embedder: null }))
      .rejects.toBeInstanceOf(IngestError);
  });
  it("embedding lỗi không làm hỏng việc nhập (lùi về từ khoá)", async () => {
    const broken: Embedder = { model: "x", dims: 3, embed: async () => { throw new Error("quota"); } };
    const { document, retriever } = await lib(broken);
    expect(document.embedded).toBe(false);
    expect(document.warnings).toContain("embedding_failed");
    const hits = await retriever.search(U, [document.id], "dạng chuẩn 2", 2);
    expect(hits[0]!.chunk.page).toBe(44);
  });
});

describe("truy xuất", () => {
  it("BM25 tìm đúng trang cho câu hỏi diễn đạt khác tài liệu", async () => {
    const { document, retriever } = await lib();
    const hits = await retriever.search(U, [document.id], "phụ thuộc vào một phần của khóa chính là vi phạm gì", 3);
    expect(hits[0]!.chunk.page).toBe(44);
  });
  it("chỉ tìm trong tài liệu của chính người dùng", async () => {
    const { store, document } = await lib();
    const other = await new Retriever(store, null).search("22222222-2222-4222-8222-222222222222", [document.id], "dạng chuẩn 2", 4);
    expect(other).toHaveLength(0);
  });
  it("hybrid: vector giúp kéo đúng đoạn khi không trùng từ khoá", async () => {
    // embedder giả: vector theo chủ đề để kiểm tra đường RRF
    const topic = (t: string) => [/2NF|chuẩn 2|một phần/.test(t) ? 1 : 0, /index|chỉ mục|tra cứu nhanh/i.test(t) ? 1 : 0, 0.1];
    const fake: Embedder = { model: "fake", dims: 3, embed: async (ts) => ts.map(topic) };
    const { document, retriever } = await lib(fake);
    expect(document.embedded).toBe(true);
    const hits = await retriever.search(U, [document.id], "làm sao tra cứu nhanh mà khỏi duyệt hết", 2);
    expect(hits[0]!.chunk.page).toBe(52);
    expect(hits[0]!.vectorRank).toBe(1);
  });
  it("RRF cộng điểm khi xuất hiện ở cả hai danh sách", () => {
    const c = (id: string) => ({ chunk: { id } as any, score: 1 });
    const r = rrf([[c("a"), c("b")], [c("b"), c("c")]]);
    expect(r[0]!.chunk.id).toBe("b");
  });
});

describe("trích dẫn", () => {
  it("chỉ chấp nhận trích dẫn có nguyên văn trong đoạn; đánh số lại [S2]→[1], bỏ nhãn không hợp lệ", async () => {
    const { document, retriever } = await lib();
    const hits = await retriever.search(U, [document.id], "dạng chuẩn 3 phụ thuộc bắc cầu", 3);
    const map = aliasMap(hits);
    const i3 = [...map.entries()].find(([, r]) => r.chunk.page === 45)![0];
    const ok = validateCitation(i3, "không có thuộc tính không khóa nào phụ thuộc bắc cầu", map);
    expect(ok?.page).toBe(45);
    expect(validateCitation(i3, "3NF yêu cầu khóa chính chỉ có một cột", map)).toBeNull();
    expect(validateCitation("S9", "bất kỳ", map)).toBeNull();
    const out = renderCitationMarkers(`Tài liệu nói rõ điều này [${i3}]. Còn đây là bịa [S9].`, new Map([[i3, ok!]]));
    expect(out.text).toBe("Tài liệu nói rõ điều này [1]. Còn đây là bịa.");
    expect(out.citations).toHaveLength(1);
  });
});
