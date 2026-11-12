import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, prepareGroundedSession, runTurn } from "../src/agent/engine";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { renderCitationMarkers } from "../src/rag/grounding";
import { repairQuote, sentenceWithTerms } from "../src/rag/text";
import { readableConcept } from "../src/agent/mirror-card";
import { MemoryGraphStore } from "../src/graph/memory";
import { buildConceptGraph, EXTRACTOR_VERSION } from "../src/graph/build";
import { normalizeExtraction } from "../src/graph/langchain";
import { aliasForPage, scripted, seqId, turnOut } from "./helpers";

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const U = "11111111-1111-4111-8111-111111111111";
const P44 = corpus.pages.find((p: any) => p.page === 44).text as string;

async function lib() {
  const store = new MemoryStore();
  const { document } = await ingestDocument({ userId: U, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder: null });
  return { store, document, retriever: new Retriever(store, null) };
}

describe("Rà soát 12/11 – trích dẫn chép lệch không làm rỗng câu trả lời", () => {
  it("repairQuote: chép lệch vài chữ → trả về CÂU THẬT; câu bịa → null", () => {
    const real = repairQuote(P44, "quan hệ ở dạng chuẩn 2 khi đạt 1NF và mọi thuộc tính không khoá phụ thuộc đầy đủ vào khoá chính");
    expect(real).toMatch(/^Một quan hệ ở dạng chuẩn 2 khi nó đạt 1NF/);
    expect(repairQuote(P44, "2NF yêu cầu không có phụ thuộc bắc cầu")).toBeNull();
    expect(sentenceWithTerms(P44, [["dạng chuẩn 2"], ["1nf"]])).toMatch(/đạt 1NF/);
  });

  it("mọi câu khẳng định trích một đoạn CÓ THẬT nhưng chép lệch → giữ câu, bỏ nhãn, báo unverifiedKept; nhãn không tồn tại vẫn bị xoá", () => {
    const text = "Bảng đạt 2NF vẫn có thể còn phụ thuộc bắc cầu [S1]. Ví dụ TenKhoa phụ thuộc MaKhoa [S1]. Bạn thử nghĩ cách tách bảng?";
    const out = renderCitationMarkers(text, new Map(), new Map(), { realAliases: new Set(["S1"]) });
    expect(out.text).toBe("Bảng đạt 2NF vẫn có thể còn phụ thuộc bắc cầu. Ví dụ TenKhoa phụ thuộc MaKhoa. Bạn thử nghĩ cách tách bảng?");
    expect(out.removedClaims).toBe(0);
    expect(out.unverifiedKept).toBe(2);
    const fake = renderCitationMarkers(text.replace(/S1/g, "S9"), new Map(), new Map(), { realAliases: new Set(["S1"]) });
    expect(fake.text).toBe("Bạn thử nghĩ cách tách bảng?");
    expect(fake.removedClaims).toBe(2);
  });

  it("lượt Khám phá: model chép lệch câu căn cứ → câu trả lời vẫn đủ ý, có trích dẫn câu thật hoặc ghi chú chưa đối chiếu", async () => {
    const { document, retriever } = await lib();
    const s = createSession({ userId: U, mode: "explore", topic: "Vì sao 2NF vẫn có dị thường?", request: "Vì sao 2NF vẫn có dị thường?", documentIds: [document.id] }, { id: seqId });
    const { router } = scripted([(req) => {
      const a = aliasForPage(req.user, 45);
      return turnOut({
        next_action: "explain_foundation",
        assistant_text: `Bảng 2NF vẫn có thể có phụ thuộc bắc cầu [${a}]. Đó là lý do cần 3NF [${a}]. Bạn muốn xem ví dụ không?`,
        source_citations: [{ source: a, quote: "quan hệ ở dạng chuẩn 3 khi đã đạt 2NF và không có thuộc tính không khoá nào phụ thuộc bắc cầu vào khoá chính" }],
      });
    }]);
    const r = await runTurn(s, { text: "Vì sao 2NF vẫn có dị thường?" }, { core: router, retriever, id: seqId });
    expect(r.result.assistantText).toMatch(/phụ thuộc bắc cầu/);
    expect(r.result.assistantText).toMatch(/3NF/);
    expect(r.result.citations[0]?.quote).toMatch(/^Một quan hệ ở dạng chuẩn 3 khi nó đạt 2NF/); // câu thật, không phải chữ của model
  });
});

describe("Rà soát 12/11 – Hỏi đáp tự do và câu mở đầu Khám phá", () => {
  it("câu hỏi ngắn trùng tiêu đề vẫn được giữ làm request (để giao diện gửi luôn)", () => {
    const q = "Vì sao bảng 2NF vẫn có dị thường?";
    const s = createSession({ userId: U, mode: "explore", topic: q, request: q }, { id: seqId });
    expect(s.state.request).toBe(q);
    expect(s.messages[0]!.text).toMatch(/trả lời câu hỏi của bạn ngay/);
    // Kiểm tra hiểu biết: chủ đề trùng câu → không có "câu hỏi" riêng (giữ hành vi cũ).
    expect(createSession({ userId: U, mode: "reunderstand", topic: "3NF", request: "3NF" }).state.request).toBeNull();
  });

  it("Khám phá có tài liệu: không biến câu mở đầu thành yêu cầu 'tự giải thích'", async () => {
    const { document, retriever } = await lib();
    const q = "Vì sao bảng 2NF vẫn có dị thường?";
    const s0 = createSession({ userId: U, mode: "explore", topic: q, request: q, documentIds: [document.id] }, { id: seqId });
    const { router } = scripted([{ criteria: [{ concept: "3NF", expectation: "x", source: "S1", quote: "không có thuộc tính không khóa nào phụ thuộc bắc cầu vào khóa chính" }], opening_question: "Bạn thử giải thích theo cách bạn hiểu?" }]);
    const s = await prepareGroundedSession(s0, { core: router, retriever });
    expect(s.messages[0]!.text).toMatch(/Mình đã đọc phần liên quan/);
    expect(s.messages[0]!.text).toMatch(/trả lời câu hỏi của bạn ngay/);
    expect(s.messages[0]!.text).not.toMatch(/giải thích theo cách bạn hiểu/);
  });
});

describe("Rà soát 12/11 – chấm theo tiêu chí và đếm 'vướng 2 lượt'", () => {
  it("bằng chứng ghi mã tiêu chí ở 'criterion' (không có criterion_id) vẫn gắn đúng tiêu chí, không bị hạ 'unclear'", async () => {
    const { document, retriever } = await lib();
    const plan = { criteria: [{ concept: "Dạng chuẩn 2 (2NF)", expectation: "phụ thuộc đầy đủ vào khóa", source: "S1", quote: "mọi thuộc tính không khóa đều phụ thuộc đầy đủ vào khóa chính" }], opening_question: "Giải thích 2NF?" };
    const s0 = createSession({ userId: U, mode: "reunderstand", topic: "Dạng chuẩn 2 (2NF)", documentIds: [document.id] }, { id: seqId });
    const s = await prepareGroundedSession(s0, { core: scripted([plan]).router, retriever });
    const said = "2NF là khi mọi thuộc tính không khóa phụ thuộc đầy đủ vào toàn bộ khóa chính.";
    const { router } = scripted([turnOut({ next_action: "acknowledge", assistant_text: "Đúng ý chính rồi.", observed_evidence: [{ criterion: "C1", claim: "nêu đúng", quote: said, status: "observed" }] })]);
    const r = await runTurn(s, { text: said }, { core: router, retriever, id: seqId });
    const ev = r.session.evidence.at(-1)!;
    expect(ev.criterionId).toBe("C1");
    expect(ev.status).toBe("observed");
  });

  it("model đổi tên cùng một chỗ vướng giữa các lượt → vẫn đếm là cùng chỗ (vướng 2 lượt)", async () => {
    const s0 = createSession({ userId: U, mode: "explore", topic: "3NF" }, { id: seqId });
    let turn = 0;
    const { p, router } = scripted(Array.from({ length: 8 }, () => () => turnOut({
      next_action: "ask_clarification", assistant_text: "Chưa khớp lắm. Bạn thử nói lại xem?",
      suspected_gaps: [turn === 0 ? "hieu_nham_dieu_kien_3nf" : "cach_khac_phuc_phu_thuoc_bac_cau"],
    })));
    const a = await runTurn(s0, { text: "3NF là mọi cột đều là khóa." }, { core: router, id: seqId });
    turn = 1;
    const b = await runTurn(a.session, { text: "Chắc là thêm cột vào khóa." }, { core: router, id: seqId });
    expect(p.calls.length).toBeGreaterThanOrEqual(2);
    expect(b.session.gaps.filter((g) => g.status === "open")).toHaveLength(1);
    expect(b.session.state.roundOnSameGap).toBe(2);
    expect(readableConcept("hieu_nham_dieu_kien_3nf")).toBe("hieu nham dieu kien 3nf");
    expect(readableConcept("Điều kiện của 3NF")).toBe("Điều kiện của 3NF");
  });
});

describe("Rà soát 12/11 – bản đồ khái niệm v2", () => {
  it("trích xuất khoan dung: một mục sai khuôn không làm hỏng cả lô; thừa thì cắt", () => {
    const r = normalizeExtraction({ concepts: [{ name: "3NF", parent: null }, { ten: "sai" }], relations: [{ from: "a" }], mentions: [] });
    expect(r.ok).toBe(true);
    expect(r.concepts.map((c) => c.name)).toEqual(["3NF"]);
    expect(r.relations).toHaveLength(0);
  });

  it("quote chép lệch → câu thật; khái niệm thiếu mention → tự tìm câu chứa tên; ghi khái niệm cha; trang có phiên bản", async () => {
    const { store, document } = await lib();
    const graph = new MemoryGraphStore();
    const extractor = (req: { user: string }) => {
      const a = /<source id="(S\d+)"[^>]*page="44"/.exec(req.user)?.[1];
      if (!a) return { concepts: [], relations: [], mentions: [] };
      return {
        concepts: [
          { name: "Chuẩn hóa cơ sở dữ liệu", description: "Chương 4", parent: null },
          { name: "Dạng chuẩn 1 (1NF)", description: "", parent: "Chuẩn hóa cơ sở dữ liệu" },
          { name: "Dạng chuẩn 2 (2NF)", description: "Không phụ thuộc một phần khóa", parent: "Chuẩn hóa cơ sở dữ liệu" },
        ],
        relations: [{ from: "Dạng chuẩn 1 (1NF)", to: "Dạng chuẩn 2 (2NF)", type: "CAN_BIET_TRUOC", source: a, quote: "quan hệ ở dạng chuẩn 2 khi đã đạt 1NF và mọi thuộc tính không khoá phụ thuộc đầy đủ vào khoá chính" }],
        mentions: [],
      };
    };
    const { router } = scripted(Array.from({ length: 10 }, () => extractor));
    const r = await buildConceptGraph({ userId: U, documentIds: [document.id], store, graph, router, maxPages: 40, maxCalls: 4, charsPerBatch: 12000 });
    expect(r.done).toBe(true);
    expect(r.llmCalls).toBeLessThanOrEqual(2);
    const rel = graph.relations.find((x) => x.from === "dạng chuẩn 1" && x.to === "dạng chuẩn 2")!;
    expect(rel.evidence.quote).toMatch(/^Một quan hệ ở dạng chuẩn 2 khi nó đạt 1NF/);
    const v = await graph.view(U, [document.id]);
    const two = v.concepts.find((c) => c.key === "dạng chuẩn 2")!;
    expect(two.parent).toBe("chuẩn hóa cơ sở dữ liệu");
    expect(v.concepts.map((c) => c.key)).toContain("chuẩn hóa cơ sở dữ liệu"); // có mention tự tìm (tiêu đề chương)
    expect((await graph.extractedPages(U, [document.id], EXTRACTOR_VERSION)).size).toBe(r.totalPages);
  });

  it("lô bị cắt cụt (hết token): chỉ đánh dấu trang đã trích được, trang còn lại đọc lại ở lần sau", async () => {
    const { store, document } = await lib();
    const graph = new MemoryGraphStore();
    // JSON bị cắt giữa chừng: chỉ kịp có khái niệm của trang 44 (giống production 12/11: Groq hết 4096 token).
    const cutJson = '{"concepts":[{"name":"Dạng chuẩn 2 (2NF)","description":"x","parent":null},{"name":"Dạng chuẩn 1 (1NF)","description":"y","parent":null}],"relations":[{"from":"Dạng chuẩn 1 (1NF)","to":"Dạng chu';
    const { router } = scripted([{ __truncated: true, text: cutJson }, ...Array.from({ length: 10 }, () => ({ concepts: [], relations: [], mentions: [] }))]);
    const r = await buildConceptGraph({ userId: U, documentIds: [document.id], store, graph, router, maxPages: 40, maxCalls: 1, charsPerBatch: 100000 });
    expect(r.llmCalls).toBe(1);
    expect(r.concepts).toBeGreaterThan(0);
    expect(r.processedPages).toBeGreaterThan(0);
    expect(r.processedPages).toBeLessThan(r.totalPages); // trang chưa kịp trích KHÔNG bị đánh dấu đã đọc
    expect(r.remainingPages).toBe(r.totalPages - r.processedPages);
    expect(r.done).toBe(false);
  });

  it("trang đọc bằng bộ trích xuất cũ (v1) được đọc lại", async () => {
    const graph = new MemoryGraphStore();
    await graph.write({ userId: U, documents: [{ id: "d1", title: "T" }], pages: [{ documentId: "d1", page: 1 }, { documentId: "d1", page: 2, v: EXTRACTOR_VERSION }], concepts: [], relations: [], mentions: [] });
    expect((await graph.extractedPages(U, ["d1"])).size).toBe(2);
    expect([...(await graph.extractedPages(U, ["d1"], EXTRACTOR_VERSION))]).toEqual(["d1:2"]);
  });
});
