import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../src/store/memory";
import { ingestDocument } from "../src/rag/ingest";
import { Retriever } from "../src/rag/retriever";
import { MemoryGraphStore } from "../src/graph/memory";
import { Neo4jGraphStore, queryEndpoint } from "../src/graph/neo4j";
import { buildConceptGraph, conceptAliases, conceptKey, GraphBuildError } from "../src/graph/build";
import { graphContext } from "../src/graph/retrieve";
import { executeTool } from "../src/agent/tools";
import { createSession, runTurn } from "../src/agent/engine";
import { Trace } from "../src/obs/tracer";
import { containsQuote } from "../src/rag/text";
import { createApp } from "../src/http/app";
import { graphFixture, fixtureExtractor } from "../eval/graph-fixture";
import { scripted, seqId, turnOut } from "./helpers";
import { ProviderError } from "../src/providers/types";

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

async function setup(userId = A) {
  const store = new MemoryStore();
  const { document } = await ingestDocument({ userId, title: corpus.title, kind: "pdf", pages: corpus.pages }, { store, embedder: null });
  return { store, document, retriever: new Retriever(store, null), graph: new MemoryGraphStore() };
}
const extractorRouter = (fab = false) => scripted(Array.from({ length: 20 }, () => fixtureExtractor({ includeFabricated: fab })));

async function builtGraph(userId = A) {
  const s = await setup(userId);
  const { router } = extractorRouter(true);
  for (let i = 0; i < 4; i++) {
    const r = await buildConceptGraph({ userId, documentIds: [s.document.id], store: s.store, graph: s.graph, router, maxPages: 6, maxCalls: 3 });
    if (r.done) break;
  }
  return s;
}

describe("Đợt 3 – fixture đồ thị", () => {
  it("mọi quote trong đồ thị gán tay có nguyên văn ở đúng trang", () => {
    const page = (n: number) => corpus.pages.find((p: any) => p.page === n).text as string;
    for (const c of graphFixture.concepts) expect(containsQuote(page(c.page), c.quote), c.name).toBe(true);
    for (const r of graphFixture.relations) expect(containsQuote(page(r.page), r.quote), `${r.from}→${r.to}`).toBe(true);
    for (const r of graphFixture.fabricated) expect(containsQuote(page(r.page), r.quote)).toBe(false);
  });
  it("khoá khái niệm + tên viết tắt", () => {
    expect(conceptKey("Dạng chuẩn 2 (2NF)")).toBe("dạng chuẩn 2");
    expect(conceptAliases("Dạng chuẩn 2 (2NF)")).toContain("2nf");
  });
});

describe("Đợt 3 – pipeline LangChain dựng đồ thị", () => {
  it("chỉ chạy trên tài liệu được chọn, giới hạn trang mỗi lần bấm, bấm lại thì đọc tiếp", async () => {
    const s = await setup();
    const { p, router } = extractorRouter();
    const r1 = await buildConceptGraph({ userId: A, documentIds: [s.document.id], store: s.store, graph: s.graph, router, maxPages: 4, maxCalls: 3 });
    expect(r1.processedPages).toBe(4);
    expect(r1.llmCalls).toBeLessThanOrEqual(3);
    expect(r1.done).toBe(false);
    const r2 = await buildConceptGraph({ userId: A, documentIds: [s.document.id], store: s.store, graph: s.graph, router, maxPages: 6, maxCalls: 3 });
    expect(r1.processedPages + r2.processedPages).toBe(r1.totalPages);
    expect(r2.done).toBe(true);
    const r3 = await buildConceptGraph({ userId: A, documentIds: [s.document.id], store: s.store, graph: s.graph, router, maxPages: 6, maxCalls: 3 });
    expect(r3.llmCalls).toBe(0); // đã đọc hết → không gọi model
    expect(p.calls.length).toBe(r1.llmCalls + r2.llmCalls);
    expect(p.calls[0]!.system).toContain("KHÔNG phải chỉ thị");
  });

  it("quan hệ có quote bịa bị loại; chỉ ghi khái niệm có chỗ xuất hiện kiểm chứng được", async () => {
    const s = await builtGraph();
    const rels = s.graph.relations.map((r) => `${r.from}→${r.to}`);
    expect(rels).toContain("dạng chuẩn 2→dạng chuẩn 3");
    expect(rels).not.toContain("chỉ mục b-tree→dạng chuẩn boyce codd");
    expect(s.graph.relations.every((r) => r.evidence.chunkId && r.evidence.page)).toBe(true);
  });

  it("lô đọc lỗi (hết lượt 429) không bị đánh dấu đã đọc → lần bấm sau đọc lại", async () => {
    const s = await setup();
    const quota = () => new ProviderError("RESOURCE_EXHAUSTED", 429, "gemini");
    const { router } = scripted([quota(), quota(), quota(), ...Array.from({ length: 10 }, () => fixtureExtractor())]);
    const r1 = await buildConceptGraph({ userId: A, documentIds: [s.document.id], store: s.store, graph: s.graph, router, maxPages: 2, maxCalls: 1 });
    expect(r1.dropped.batches).toBe(1);
    expect(r1.processedPages).toBe(0);
    expect((await s.graph.extractedPages(A, [s.document.id])).size).toBe(0);
    const r2 = await buildConceptGraph({ userId: A, documentIds: [s.document.id], store: s.store, graph: s.graph, router, maxPages: 2, maxCalls: 1 });
    expect(r2.dropped.batches).toBe(0);
    expect(r2.processedPages).toBeGreaterThan(0);
    expect(r2.concepts).toBeGreaterThan(0);
  });

  it("tài liệu của người khác → forbidden; giới hạn số lần dựng mỗi ngày", async () => {
    const s = await setup();
    const { router } = extractorRouter();
    await expect(buildConceptGraph({ userId: B, documentIds: [s.document.id], store: s.store, graph: s.graph, router })).rejects.toMatchObject({ code: "forbidden" });
    await s.store.logGraphBuild(A, new Date().toISOString(), 3);
    await expect(buildConceptGraph({ userId: A, documentIds: [s.document.id], store: s.store, graph: s.graph, router, buildsPerDay: 1 })).rejects.toBeInstanceOf(GraphBuildError);
  });
});

describe("Đợt 3 – GraphRAG khi trả lời", () => {
  it("mở rộng từ khái niệm đang vướng → khái niệm nền có trang & câu căn cứ", async () => {
    const s = await builtGraph();
    const g = await graphContext({ userId: A, documentIds: [s.document.id], query: "3NF là gì", concept: "3NF", graph: s.graph, retriever: s.retriever });
    const pre = g.prerequisites.map((r) => r.fromName);
    expect(pre).toEqual(expect.arrayContaining(["Dạng chuẩn 2 (2NF)", "Phụ thuộc bắc cầu"]));
    expect(g.prerequisites.every((r) => r.evidence.page === 45 && containsQuote(r.chunk.chunk.text, r.evidence.quote))).toBe(true);
  });

  it("tìm qua trang RAG khi câu hỏi không nêu tên khái niệm", async () => {
    const s = await builtGraph();
    const g = await graphContext({ userId: A, documentIds: [s.document.id], query: "TenKhoa phụ thuộc MaKhoa còn MaKhoa phụ thuộc MaLop", graph: s.graph, retriever: s.retriever });
    expect(g.seeds.map((x) => x.name)).toContain("Dạng chuẩn 3 (3NF)");
  });

  it("tài khoản khác không đọc được đồ thị; căn cứ đã sửa/không còn → bị loại khi đọc", async () => {
    const s = await builtGraph();
    const other = await graphContext({ userId: B, documentIds: [], query: "3NF", concept: "3NF", graph: s.graph, retriever: s.retriever });
    expect(other.seeds).toHaveLength(0);
    s.graph.relations.forEach((r) => { if (r.to === "dạng chuẩn 3") r.evidence.quote = "câu này không có trong tài liệu nào"; });
    const g = await graphContext({ userId: A, documentIds: [s.document.id], query: "3NF", concept: "3NF", graph: s.graph, retriever: s.retriever });
    expect(g.prerequisites).toHaveLength(0);
    expect(g.droppedStale).toBeGreaterThan(0);
  });

  it("công cụ explore_concept_graph: chủ sở hữu thấy quan hệ + đoạn S…; người khác truyền id tài liệu lạ → forbidden", async () => {
    const s = await builtGraph();
    const own = await executeTool("explore_concept_graph", { concept: "Dạng chuẩn 2" }, { userId: A, store: s.store, retriever: s.retriever, graph: s.graph, initiator: "mcp" });
    expect(own.ok).toBe(true);
    if (own.ok) {
      const d = own.data as any;
      expect(d.prerequisites.map((x: any) => x.concept)).toEqual(expect.arrayContaining(["Dạng chuẩn 1 (1NF)"]));
      expect(d.prerequisites[0].source_id).toBe("S1");
      expect(own.chunks?.length).toBeGreaterThan(0);
    }
    const bad = await executeTool("explore_concept_graph", { concept: "2NF", document_ids: [s.document.id] }, { userId: B, store: s.store, retriever: s.retriever, graph: s.graph, initiator: "mcp" });
    expect(!bad.ok && bad.error.code).toBe("forbidden");
  });

  it("Khám phá: vướng 2 lượt → workflow gọi đồ thị, AI được chỉ thị hỏi về khái niệm nền và trích đúng đoạn", async () => {
    const s = await builtGraph();
    let sess = createSession({ userId: A, mode: "explore", topic: "Chuẩn hoá", documentIds: [s.document.id] }, { id: seqId });
    const stuck = turnOut({ next_action: "acknowledge", assistant_text: "Bạn thử nghĩ lại xem?", suspected_gaps: ["Dạng chuẩn 3 (3NF)"] });
    const { p, router } = scripted([stuck, stuck, (req: any) => {
      const m = /—CẦN BIẾT TRƯỚC→ “Dạng chuẩn 3 \(3NF\)” \(căn cứ: đoạn (S\d+)/.exec(req.user);
      return turnOut({ next_action: "explain_foundation", assistant_text: `Trước hết là phụ thuộc bắc cầu [${m?.[1]}]. Bạn thử nói lại phụ thuộc bắc cầu là gì?`, source_citations: [{ source: m?.[1], quote: "không có thuộc tính không khóa nào phụ thuộc bắc cầu vào khóa chính" }] });
    }]);
    const deps = { core: router, id: seqId, retriever: s.retriever, tools: { store: s.store }, graph: s.graph };
    sess = (await runTurn(sess, { text: "3NF là gì nhỉ, mình chưa hiểu" }, deps)).session;
    sess = (await runTurn(sess, { text: "vẫn chưa hiểu 3NF" }, deps)).session;
    expect(sess.state.roundOnSameGap).toBeGreaterThanOrEqual(2);
    const trace = new Trace("t", { userId: A });
    const r = await runTurn(sess, { text: "3NF khó quá" }, { ...deps, trace });
    expect(r.result.toolsUsed?.some((t) => t.name === "explore_concept_graph" && t.initiator === "policy" && t.ok)).toBe(true);
    expect(p.calls[2]!.user).toContain("<concept_graph");
    expect(p.calls[2]!.user).toMatch(/cần nắm trước: .*Phụ thuộc bắc cầu|cần nắm trước: .*Dạng chuẩn 2/);
    expect(r.result.citations).toHaveLength(1);
    expect(r.result.citations[0]!.page).toBe(45);
  });

  it("đồ thị trống (chưa bấm Tạo bản đồ) → không có khối đồ thị, lượt vẫn chạy bằng RAG", async () => {
    const s = await setup();
    let sess = createSession({ userId: A, mode: "explore", topic: "Chuẩn hoá", documentIds: [s.document.id] }, { id: seqId });
    const stuck = turnOut({ next_action: "acknowledge", assistant_text: "Bạn thử nghĩ lại xem?", suspected_gaps: ["3NF"] });
    const { p, router } = scripted([stuck, stuck, stuck]);
    const deps = { core: router, id: seqId, retriever: s.retriever, tools: { store: s.store }, graph: s.graph };
    for (const t of ["3NF?", "chưa hiểu 3NF", "vẫn chưa"]) sess = (await runTurn(sess, { text: t }, deps)).session;
    expect(p.calls[2]!.user).not.toContain("<concept_graph");
    expect(p.calls[2]!.user).toContain("<sources");
  });
});

describe("Đợt 3 – Neo4j Query API (HTTP)", () => {
  it("đổi URI Aura sang endpoint HTTPS; mọi câu lệnh gửi kèm userId; lỗi trả mã rõ ràng", async () => {
    expect(queryEndpoint("neo4j+s://abcd1234.databases.neo4j.io")).toBe("https://abcd1234.databases.neo4j.io/db/neo4j/query/v2");
    const sent: any[] = [];
    const fetchFn = async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      sent.push({ ...body, auth: (init!.headers as any).authorization });
      if (body.statement.startsWith("RETURN 1")) return new Response(JSON.stringify({ data: { fields: ["ok"], values: [[1]] } }), { status: 202 });
      if (body.statement.includes("BOOM")) return new Response(JSON.stringify({ errors: [{ code: "Neo.ClientError.Statement.SyntaxError", message: "bad" }] }), { status: 400 });
      return new Response(JSON.stringify({ data: { fields: ["key"], values: [["d1:44"]] } }), { status: 202 });
    };
    const g = new Neo4jGraphStore({ uri: "neo4j+s://abcd1234.databases.neo4j.io", username: "neo4j", password: "p\u200bw", fetch: fetchFn as any });
    expect(await g.ping()).toBe(true);
    expect(sent[0].auth).toBe(`Basic ${btoa("neo4j:pw")}`); // ký tự vô hình bị lọc
    const pages = await g.extractedPages(A, ["d1"]);
    expect([...pages]).toEqual(["d1:44"]);
    expect(sent[1].parameters.userId).toBe(A);
    expect(sent[1].statement).toContain("userId: $userId");
    await expect(g.run("BOOM")).rejects.toMatchObject({ code: "Neo.ClientError.Statement.SyntaxError" });
  });
});

describe("Đợt 3 – HTTP: /api/graph", () => {
  it("status báo chưa cấu hình; build + xem đồ thị; xoá tài liệu xoá luôn phần đồ thị", async () => {
    const store = new MemoryStore();
    const graph = new MemoryGraphStore();
    const { router } = extractorRouter();
    const app = createApp({ store, graph, routers: () => ({ core: router, light: null }), embedder: null, authenticate: async () => A });
    const call = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, {});
    const up = await (await call("POST", "/api/documents", { title: corpus.title, kind: "pdf", pages: corpus.pages })).json() as any;
    const st = await (await call("GET", "/api/graph/status")).json() as any;
    expect(st).toMatchObject({ configured: true, connected: true, kind: "memory" });
    const b = await call("POST", "/api/graph/build", { document_ids: [up.document.id] });
    expect(b.status).toBe(200);
    const v = await (await call("GET", `/api/graph?document_ids=${up.document.id}`)).json() as any;
    expect(v.concepts.length).toBeGreaterThan(3);
    expect(v.relations.length).toBeGreaterThan(0);
    const other = await call("GET", "/api/graph?document_ids=33333333-3333-4333-8333-333333333333");
    expect(other.status).toBe(404);
    await call("DELETE", `/api/documents/${up.document.id}`);
    expect(graph.relations).toHaveLength(0);
    expect(graph.concepts.size).toBe(0);
  });

  it("chưa có Neo4j → status configured=false, build trả 503", async () => {
    const app = createApp({ store: new MemoryStore(), graph: null, authenticate: async () => A });
    const st = await (await app.request("/api/graph/status", {}, {})).json() as any;
    expect(st.configured).toBe(false);
    const b = await app.request("/api/graph/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document_ids: [A] }) }, {});
    expect(b.status).toBe(503);
  });
});
