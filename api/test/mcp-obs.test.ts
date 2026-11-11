import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createApp } from "../src/http/app";
import { MemoryStore } from "../src/store/memory";
import { ModelRouter } from "../src/providers/router";
import { DemoProvider, ScriptedProvider } from "../src/providers/mock";
import { McpClient, parseSse } from "../src/mcp/client";
import { discoverTools, isReadSafe } from "../src/mcp/library-source";
import type { McpTool } from "../src/mcp/client";
import { checkMcpUrl, decryptSecret, encryptSecret } from "../src/mcp/crypto";
import { LangfuseExporter, LangSmithExporter } from "../src/obs/exporters";
import { Trace, type TraceData, type TraceExporter } from "../src/obs/tracer";
import { AuthError } from "../src/http/auth";
import { fakeDriveMcp } from "./fake-mcp";
import { turnOut } from "./helpers";

const corpus = JSON.parse(readFileSync("eval/fixtures/csdl-chuan-hoa.json", "utf8"));
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const driveText = corpus.pages.map((p: any) => p.text).join("\f");

class CaptureExporter implements TraceExporter {
  readonly name = "capture";
  traces: TraceData[] = [];
  async export(t: TraceData) { this.traces.push(structuredClone(t)); }
}

function setup(provider: any = new DemoProvider()) {
  const store = new MemoryStore();
  const mcp = fakeDriveMcp({ "f-csdl": { title: "Bai giang CSDL - Chuan hoa", text: driveText }, "f-other": { title: "Lịch thi", text: "Thi ngày 20/12" } }, { requireToken: "drive-token" });
  const exporter = new CaptureExporter();
  const app = createApp({
    store, embedder: null, exporters: [exporter], mcpFetch: mcp.fetchImpl, allowLocalMcp: true,
    authenticate: async (req) => { const u = req.headers.get("x-user"); if (!u) throw new AuthError("no"); return u; },
    routers: (onCall) => ({ core: new ModelRouter(provider, null, { sleep: async () => {}, onCall }), light: null }),
  });
  const env = { CONNECTOR_ENC_KEY: KEY, LIMIT_SESSIONS_PER_DAY: "10" };
  const call = async (user: string, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", "x-user": user }, body: body ? JSON.stringify(body) : undefined }, env);
    return { status: r.status, json: (await r.json()) as any };
  };
  return { store, mcp, exporter, call };
}

describe("MCP client & adapter", () => {
  it("handshake, giữ mcp-session-id, đọc phản hồi SSE", async () => {
    const { fetchImpl, log } = fakeDriveMcp({ x: { title: "A", text: "hello" } });
    const c = new McpClient("http://localhost:9/mcp", { fetchImpl });
    const info = await c.initialize();
    expect(info.serverName).toBe("fake-drive");
    const r = await c.callTool("read_file", { fileId: "x" });
    expect(r.content[0]!.text).toBe("hello");
    expect(log.map((l) => l.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(log[2]!.session).toBe("sess-123");
  });
  it("chỉ chọn tool chỉ-đọc; tool có destructiveHint bị loại", async () => {
    const tools: McpTool[] = [
      { name: "delete_file", annotations: { destructiveHint: true } },
      { name: "update_page" },
      { name: "search", inputSchema: { properties: { query: {} } } },
      { name: "read_file", inputSchema: { properties: { fileId: {} } } },
    ];
    expect(tools.filter(isReadSafe).map((t) => t.name)).toEqual(["search", "read_file"]);
    expect(discoverTools(tools, "google_drive")).toMatchObject({ search: "search", fetch: "read_file", queryArg: "query", idArg: "fileId" });
  });
  it("parseSse đọc nhiều event", () => {
    expect(parseSse('data: {"a":1}\n\nevent: x\ndata: {"b":2}\n\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it("chặn SSRF: http, IP nội bộ, metadata cloud", () => {
    expect(() => checkMcpUrl("http://example.com/mcp")).toThrow("https_required");
    expect(() => checkMcpUrl("https://169.254.169.254/latest")).toThrow("private_host_blocked");
    expect(() => checkMcpUrl("https://10.0.0.5/mcp")).toThrow("private_host_blocked");
    expect(() => checkMcpUrl("https://evil.com/mcp", { allowedHosts: "mcp.notion.com" })).toThrow("host_not_allowed");
    expect(checkMcpUrl("https://mcp.notion.com/mcp", { allowedHosts: "mcp.notion.com" }).host).toBe("mcp.notion.com");
  });
  it("token mã hoá AES-GCM, giải mã đúng", async () => {
    const enc = await encryptSecret("secret-token", KEY);
    expect(enc).not.toContain("secret-token");
    expect(await decryptSecret(enc, KEY)).toBe("secret-token");
  });
});

describe("Luồng Drive → thư viện → phiên kiểm tra (HTTP)", () => {
  it("kết nối, tìm, nhập file đã chọn rồi bắt đầu phiên bám tài liệu", async () => {
    const { call, store, mcp } = setup();
    const conn = await call(A, "POST", "/api/connectors", { name: "Drive", url: "http://localhost:9/mcp", preset: "google_drive", token: "drive-token" });
    expect(conn.status).toBe(201);
    expect(conn.json.tools).toMatchObject({ search: "search", fetch: "read_file" });
    expect(JSON.stringify([...store.connectors.values()])).not.toContain("drive-token"); // không lưu token thô

    const items = await call(A, "GET", `/api/connectors/${conn.json.id}/items?q=csdl`);
    expect(items.json.items).toEqual([{ id: "f-csdl", title: "Bai giang CSDL - Chuan hoa", mimeType: "application/pdf", url: null }]);

    const imp = await call(A, "POST", `/api/connectors/${conn.json.id}/import`, { items: [{ id: "f-csdl", title: "Bài giảng CSDL" }] });
    const doc = imp.json.results[0].document;
    expect(doc.kind).toBe("mcp");
    expect(doc.pageCount).toBe(corpus.pages.length);
    expect(doc.origin).toEqual({ connectorId: conn.json.id, externalId: "f-csdl" });
    expect(mcp.log.some((l) => l.method === "tools/call" && l.args?.fileId === "f-csdl")).toBe(true);
    expect(mcp.log.every((l) => l.method !== "tools/call" || l.args?.fileId !== "f-other")).toBe(true); // không tự đọc file khác

    const s = await call(A, "POST", "/api/sessions", { mode: "reunderstand", topic: "Dạng chuẩn 2 (2NF)", document_ids: [doc.id] });
    expect(s.status).toBe(201);
    expect(s.json.rubric.length).toBeGreaterThan(0);
    expect(s.json.rubric[0].citation.documentTitle).toBe("Bài giảng CSDL");
  });

  it("người dùng khác không dùng được connector / tài liệu của A", async () => {
    const { call } = setup();
    const conn = await call(A, "POST", "/api/connectors", { name: "Drive", url: "http://localhost:9/mcp", preset: "google_drive", token: "drive-token" });
    expect((await call(B, "GET", `/api/connectors/${conn.json.id}/items?q=x`)).status).toBe(404);
    const d = await call(A, "POST", "/api/documents", corpus);
    expect((await call(B, "POST", "/api/sessions", { mode: "reunderstand", topic: "2NF", document_ids: [d.json.document.id] })).status).toBe(404);
  });

  it("MCP sai token → 502 rõ ràng, không lưu connector", async () => {
    const { call, store } = setup();
    const r = await call(A, "POST", "/api/connectors", { name: "Drive", url: "http://localhost:9/mcp", preset: "google_drive", token: "wrong" });
    expect(r.status).toBe(502);
    expect(store.connectors.size).toBe(0);
  });
});

describe("Observability", () => {
  it("mỗi lượt có trace: truy xuất tài liệu nào, model nào, token, lỗi — không chứa văn bản người học", async () => {
    const prov = new ScriptedProvider([turnOut({ assistant_text: "Cậu dựa vào đâu?" })], "google-ai-studio", "gemini-3.8-flash");
    const { call, store, exporter } = setup(prov);
    const d = await call(A, "POST", "/api/documents", corpus);
    // tạo phiên không qua planner để kịch bản đơn giản: không gắn tài liệu → rồi gắn trực tiếp
    const s = await call(A, "POST", "/api/sessions", { mode: "reunderstand", topic: "2NF" });
    const sess = (await store.getSession(s.json.id, A))!;
    sess.documentIds = [d.json.document.id];
    await store.saveSession(sess);

    const secret = "Mật khẩu của em là hunter2, 2NF là phụ thuộc bắc cầu";
    const t = await call(A, "POST", `/api/sessions/${s.json.id}/turn`, { text: secret, client_turn_id: "ct-obs-0001" });
    expect(t.status).toBe(200);
    expect(t.json.traceId).toBeTruthy();

    const tr = exporter.traces.find((x) => x.id === t.json.traceId)!;
    const names = tr.spans.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["agent.turn", "policy.decide", "rag.retrieve", "agent.respond", "llm.google-ai-studio", "validate.output"]));
    const gen = tr.spans.find((x) => x.kind === "generation")!;
    expect(gen.model).toBe("gemini-3.8-flash");
    expect(gen.usage).toEqual({ input: 10, output: 10 });
    expect(gen.costUsd).toBeGreaterThan(0);
    const rag = tr.spans.find((x) => x.name === "rag.retrieve")!;
    expect((rag.attrs.results as any[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(tr)).not.toContain("hunter2"); // mặc định chỉ metadata

    const list = await call(A, "GET", `/api/sessions/${s.json.id}/traces`);
    const summary = list.json.items.at(-1).summary;
    expect(summary.llmCalls).toBe(1);
    expect(summary.steps.length).toBeGreaterThan(4);
  });

  it("lỗi model được ghi vào trace (bước nào, mã HTTP)", async () => {
    const { ProviderError } = await import("../src/providers/types");
    const prov = new ScriptedProvider([new ProviderError("down", 503, "g"), new ProviderError("down", 503, "g")]);
    const { call, exporter } = setup(prov);
    const s = await call(A, "POST", "/api/sessions", { mode: "explore", topic: "x" });
    const t = await call(A, "POST", `/api/sessions/${s.json.id}/turn`, { text: "hello there", client_turn_id: "ct-obs-0002" });
    expect(t.status).toBe(503);
    const tr = exporter.traces.find((x) => x.id === t.json.traceId)!;
    const errs = tr.spans.filter((x) => x.status === "error");
    expect(errs.map((e) => e.attrs.http_status)).toContain(503);
    expect(errs.some((e) => e.name === "agent.turn")).toBe(true);
  });

  it("định dạng Langfuse & LangSmith", () => {
    const t = new Trace("agent.turn", { userId: A, sessionId: "s1" });
    const root = t.start("agent.turn");
    root.child("llm.groq", "generation").gen({ model: "m", provider: "groq", usage: { input: 5, output: 7 }, costUsd: 0.001 }).end();
    root.end();
    t.finish();
    const lf = new LangfuseExporter({ publicKey: "pk", secretKey: "sk" }).toOtlp(t.data);
    const spans = lf.resourceSpans[0]!.scopeSpans[0]!.spans;
    const a = (s: any, k: string) => s.attributes.find((x: any) => x.key === k)?.value;
    expect(spans).toHaveLength(2);
    expect(spans[0]!.traceId).toBe(t.id.replace(/-/g, ""));
    expect(spans[0]!.parentSpanId).toBeUndefined();
    expect(a(spans[0], "langfuse.trace.name")).toEqual({ stringValue: "agent.turn" });
    expect(a(spans[0], "langfuse.user.id")).toEqual({ stringValue: A });
    expect(a(spans[0], "langfuse.session.id")).toEqual({ stringValue: "s1" });
    expect(spans[1]!.parentSpanId).toBe(spans[0]!.spanId);
    expect(spans[1]!.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(a(spans[1], "langfuse.observation.type")).toEqual({ stringValue: "generation" });
    expect(a(spans[1], "langfuse.observation.model.name")).toEqual({ stringValue: "m" });
    expect(JSON.parse(a(spans[1], "langfuse.observation.usage_details").stringValue)).toEqual({ input: 5, output: 7 });
    expect(BigInt(spans[1]!.endTimeUnixNano) >= BigInt(spans[1]!.startTimeUnixNano)).toBe(true);
    expect(lf.resourceSpans[0]!.resource.attributes[0]).toEqual({ key: "service.name", value: { stringValue: "mindmirror" } });
    const ls = new LangSmithExporter({ apiKey: "k" }).toBatch(t.data);
    const [r0, r1, r2] = ls.post;
    expect(r1.dotted_order.startsWith(r0.dotted_order + ".")).toBe(true);
    expect(r2.dotted_order.startsWith(r1.dotted_order + ".")).toBe(true);
    expect(r2.run_type).toBe("llm");
    expect(r0.dotted_order).toMatch(/^\d{8}T\d{6}\d{6}Z[0-9a-f-]{36}$/);
  });

  it("Langfuse export: gửi OTLP tới /api/public/otel/v1/traces kèm x-langfuse-ingestion-version: 4, báo lỗi khi bị từ chối", async () => {
    const t = new Trace("agent.turn", { userId: A });
    t.start("agent.turn").end();
    t.finish();
    const calls: { url: string; init: any }[] = [];
    let reply: Response = new Response("{}", { status: 200 });
    const fetchImpl = (async (url: string, init: any) => { calls.push({ url, init }); return reply; }) as unknown as typeof fetch;
    const ex = new LangfuseExporter({ publicKey: "pk-lf-x", secretKey: "sk-lf-y", host: "https://jp.cloud.langfuse.com/", fetchImpl });
    await ex.export(t.data);
    expect(calls[0]!.url).toBe("https://jp.cloud.langfuse.com/api/public/otel/v1/traces");
    expect(calls[0]!.init.headers["x-langfuse-ingestion-version"]).toBe("4");
    expect(calls[0]!.init.headers.authorization).toBe(`Basic ${btoa("pk-lf-x:sk-lf-y")}`);
    expect(JSON.parse(calls[0]!.init.body).resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    reply = new Response("unauthorized", { status: 401 });
    await expect(ex.export(t.data)).rejects.toThrow(/401/);
    reply = new Response(JSON.stringify({ partialSuccess: { rejectedSpans: 1, errorMessage: "bad span" } }), { status: 200 });
    await expect(ex.export(t.data)).rejects.toThrow(/rejected 1/);
  });
});
