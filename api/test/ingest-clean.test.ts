import { describe, expect, it } from "vitest";
import { cleanText, ingestDocument } from "../src/rag/ingest";
import { MemoryStore } from "../src/store/memory";
import { createApp } from "../src/http/app";

describe("Nhập PDF có ký tự Postgres không nhận (lỗi 500 ngày 12/11)", () => {
  it("cleanText bỏ NUL, ký tự điều khiển và surrogate lẻ; giữ tiếng Việt, xuống dòng, ngắt trang, emoji", () => {
    const raw = "Kỹ\u0000 nghệ\u0001 phần mềm\n\fTrang\u000B2 📄 lẻ:\uD800 cuối\uDC00";
    const out = cleanText(raw);
    expect(out).not.toMatch(/[\u0000\u0001\u000B]/);
    expect(out).toContain("Kỹ  nghệ  phần mềm\n\fTrang 2");
    expect(out).toContain("📄");
    expect(out).not.toMatch(/\uD800(?![\uDC00-\uDFFF])/);
    expect(out.endsWith("cuối")).toBe(true);
  });

  it("ingestDocument lưu văn bản đã làm sạch", async () => {
    const store = new MemoryStore();
    const r = await ingestDocument({ userId: "u1", title: "Đề\u0000 thi", kind: "pdf", pages: [{ page: 1, text: "Câu 1:\u0000 Quy trình phần mềm gồm những hoạt động nào? Đặc tả, phát triển, thẩm định, tiến hoá." }] }, { store, embedder: null });
    expect(r.document.title).toBe("Đề  thi");
    const all = JSON.stringify(await store.listChunks("u1", r.document.id));
    expect(all).toContain("Quy trình phần mềm");
    expect(all).not.toContain("\\u0000");
  });

  it("lỗi CSDL dạng object (không phải Error) vẫn trả JSON 500 internal_error thay vì làm sập Worker", async () => {
    const store = new MemoryStore();
    (store as any).saveDocument = async () => { throw { message: "unsupported Unicode escape sequence", code: "22P05" }; };
    const app = createApp({ store, authenticate: async () => "u1" });
    const r = await app.request("/api/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "x", kind: "pdf", pages: [{ page: 1, text: "Nội dung đủ dài để không bị coi là trang scan." }] }) }, {});
    // MemoryStore không bọc lỗi → kiểm tra lớp an toàn ở app.onError nhận được mọi giá trị ném ra.
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "internal_error" });
  });
});
