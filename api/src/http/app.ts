import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { AgentUnavailableError, createSession, prepareGroundedSession, prepareLearningPath, runTurn } from "../agent/engine";
import { assessLearner } from "../agent/assessment";
import { checkUserInput } from "../agent/input-guard";
import { DEFAULT_SETTINGS, type Session } from "../agent/types";
import { buildEmbedder, buildExporters, buildFallbacks, buildGraphStore, buildRouters, buildWebSearcher, contentMode, num, type Env } from "../env";
import type { GraphStore } from "../graph/types";
import { MemoryGraphStore } from "../graph/memory";
import { buildConceptGraph, EXTRACTOR_VERSION, GraphBuildError } from "../graph/build";
import type { WebSearcher } from "../web/search";
import type { ModelRouter, CallLog } from "../providers/router";
import { MemoryStore } from "../store/memory";
import { SupabaseStore } from "../store/supabase";
import type { ConnectorRecord, Store } from "../store/types";
import { AuthError, authenticate } from "./auth";
import type { Embedder } from "../rag/embeddings";
import { IngestError, ingestDocument } from "../rag/ingest";
import { Retriever } from "../rag/retriever";
import { exportTrace, Trace, type TraceExporter } from "../obs/tracer";
import { McpClient, McpError } from "../mcp/client";
import { ConnectorError, McpLibrarySource, discoverTools } from "../mcp/library-source";
import { checkMcpUrl, decryptSecret, encryptSecret } from "../mcp/crypto";
import { handleMcp } from "../mcp/server";

type Vars = { userId: string; store: Store };

export interface AppOverrides {
  store?: Store;
  routers?: (onCall: (c: CallLog) => void) => { core: ModelRouter; light: ModelRouter | null };
  authenticate?: (req: Request, env: Env) => Promise<string>;
  embedder?: Embedder | null;
  exporters?: TraceExporter[];
  mcpFetch?: typeof fetch;      // test: giả lập MCP server
  allowLocalMcp?: boolean;      // dev/test: cho phép MCP chạy ở localhost
  web?: WebSearcher | null;     // test: tìm nguồn web giả lập (mặc định tắt khi routers bị thay)
  graph?: GraphStore | null;    // test: đồ thị giả lập
}

// Khoá dev cố định — CHỈ dùng khi APP_ENV=development và chưa đặt CONNECTOR_ENC_KEY.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEV_ENC_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const devMemory = new MemoryStore(); // chỉ dùng khi chưa cấu hình Supabase (dev)
const devGraph = new MemoryGraphStore(); // dev: đồ thị trong RAM khi chưa có Neo4j (chỉ đi cùng devMemory)

const INTENTS = ["hint", "show_answer", "explain_more", "give_example", "try", "skip", "change_topic", "switch_mode", "finish"] as const;

const CreateSessionBody = z.object({
  mode: z.enum(["explore", "reunderstand"]),
  topic: z.string().trim().min(1).max(200),
  goal: z.string().trim().max(300).optional().nullable(),
  self_confidence: z.enum(["unsure", "somewhat", "confident"]).optional().nullable(),
  source_text: z.string().max(20_000).optional().nullable(),
  document_ids: z.array(z.string().uuid()).max(5).optional(),
  folder_id: z.string().uuid().optional().nullable(),
  /** Câu hỏi đầy đủ người học gõ (topic là tiêu đề rút gọn để hiện trong danh sách). */
  question: z.string().trim().max(1000).optional().nullable(),
  /** Khám phá "học từ đầu": trình độ → dàn ý + điểm kiểm tra. */
  level: z.enum(["beginner", "some", "review"]).optional().nullable(),
});

const DocumentBody = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["pdf", "slides", "text"]),
  pages: z.array(z.object({ page: z.number().int().positive().nullable(), text: z.string().max(60_000) })).min(1).max(400),
});

const ConnectorBody = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url(),
  preset: z.enum(["google_drive", "notion", "generic"]).default("generic"),
  token: z.string().max(4000).optional().nullable(),
});

const TurnBody = z.object({
  text: z.string().default(""),
  intent: z.enum(INTENTS).optional().nullable(),
  client_turn_id: z.string().min(8).max(64),
});

const SettingsBody = z.object({
  aiStyle: z.enum(["friendly", "concise", "academic"]),
  supportPreference: z.enum(["socratic_first", "direct", "flexible"]),
  challengeLevel: z.enum(["gentle", "balanced", "deep"]),
  selfAssessment: z.boolean(),
}).partial();

export function createApp(over: AppOverrides = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();
  // Giá trị ném ra không phải Error (vd PostgrestError dạng object) lọt qua onError của Hono → Worker sập, client chỉ thấy "Lỗi 500".
  // Đổi thành Error để onError trả JSON {error:"internal_error"}.
  app.use("*", async (_c, next) => {
    try { await next(); } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error((e as { message?: string } | null)?.message ?? String(e));
    }
  });

  // ALLOWED_ORIGIN có thể là danh sách phân tách dấu phẩy (vd domain Pages + localhost)
  app.use("*", async (c, next) => {
    const allowed = (c.env?.ALLOWED_ORIGIN ?? "*").split(",").map((o) => o.trim()).filter(Boolean);
    return cors({
      origin: (origin) => (allowed.includes("*") ? origin || "*" : allowed.includes(origin) ? origin : null),
      allowHeaders: ["authorization", "content-type", "x-dev-user", "mcp-protocol-version", "mcp-session-id"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    })(c, next);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Frontend dùng để biết backend đang ở chế độ nào (không lộ bí mật)
  app.get("/api/config", (c) => {
    const env: Env = c.env ?? {};
    return c.json({
      env: env.APP_ENV ?? "development",
      devAuth: (env.APP_ENV === "development" || env.APP_ENV === "demo") && env.DEV_AUTH_BYPASS === "true",
      model: env.GEMINI_API_KEY ? env.MODEL_CORE ?? "gemini-3.8-flash" : "demo-offline",
      fallbacks: env.GEMINI_API_KEY ? buildFallbacks(env).map((p) => `${p.provider}:${p.model}`) : [],
      embeddings: !!env.GEMINI_API_KEY,
      tracing: [env.LANGFUSE_PUBLIC_KEY ? "langfuse" : null, env.LANGSMITH_API_KEY ? "langsmith" : null].filter(Boolean),
      webSearch: (env.WEB_SEARCH ?? "").toLowerCase() === "off" ? null : env.TAVILY_API_KEY ? "tavily" : "wikipedia",
      limits: { sessionsPerDay: num(env.LIMIT_SESSIONS_PER_DAY, 3), turnsPerSession: num(env.LIMIT_TURNS_PER_SESSION, 12), inputChars: num(env.LIMIT_INPUT_CHARS, 3000) },
    });
  });

  // ---------- MCP server: công cụ chỉ-đọc của MindMirror cho MCP client bên ngoài ----------
  app.get("/mcp", (c) => c.json({ error: "method_not_allowed", hint: "POST JSON-RPC 2.0 (MCP Streamable HTTP, không hỗ trợ SSE stream)" }, 405));
  app.post("/mcp", async (c) => {
    const env: Env = c.env ?? {};
    let userId: string;
    try {
      userId = await (over.authenticate ?? authenticate)(c.req.raw, env);
    } catch (e) {
      if (e instanceof AuthError) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }, 401);
      throw e;
    }
    const store = over.store ?? (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : devMemory);
    const body = await c.req.json().catch(() => null);
    if (body === null) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    const trace = new Trace("mcp.request", { userId, tags: [env.APP_ENV ?? "dev", "mcp"], contentMode: contentMode(env) });
    try {
      const r = await handleMcp(body, { userId, store, retriever: new Retriever(store, embedderFor(env)), session: null, trace, graph: graphFor(env, store) });
      if (r.body === null) return c.body(null, 202);
      return c.json(r.body, r.status as 200);
    } finally {
      trace.finish();
      await store.saveTrace({ traceId: trace.id, userId, sessionId: null, name: "mcp.request", summary: trace.summary(), createdAt: new Date().toISOString() }).catch(() => {});
      const p = exportTrace(trace, over.exporters ?? buildExporters(env));
      try { c.executionCtx.waitUntil(p); } catch { await p; }
    }
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/config") return next();
    try {
      c.set("userId", await (over.authenticate ?? authenticate)(c.req.raw, c.env ?? {}));
    } catch (e) {
      if (e instanceof AuthError) return c.json({ error: "unauthorized" }, 401);
      throw e;
    }
    const env = c.env ?? {};
    c.set("store", over.store ?? (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : devMemory));
    await next();
  });

  const routersFor = (env: Env, store: Store, userId: string, sessionId: string | null) => {
    const onCall = (l: CallLog) => {
      store.logUsage({ userId, sessionId, ...l }).catch(() => {});
    };
    return over.routers ? over.routers(onCall) : buildRouters(env, onCall);
  };
  const embedderFor = (env: Env) => (over.embedder !== undefined ? over.embedder : buildEmbedder(env));
  const graphFor = (env: Env, store: Store): GraphStore | null =>
    over.graph !== undefined ? over.graph : buildGraphStore(env) ?? (store === devMemory ? devGraph : null);
  const newTrace = (env: Env, name: string, userId: string, sessionId: string | null, tags: string[] = []) =>
    new Trace(name, { userId, sessionId, tags: [env.APP_ENV ?? "dev", ...tags], contentMode: contentMode(env) });

  /** Lưu tóm tắt trace (luôn) + đẩy sang Langfuse/LangSmith (nền, không chặn phản hồi). */
  async function flushTrace(c: any, trace: Trace) {
    const env: Env = c.env ?? {};
    trace.finish();
    await (c.var.store as Store).saveTrace({
      traceId: trace.id, userId: trace.data.userId, sessionId: trace.data.sessionId, name: trace.data.name,
      summary: trace.summary(), createdAt: new Date().toISOString(),
    }).catch(() => {});
    const p = exportTrace(trace, over.exporters ?? buildExporters(env));
    try { c.executionCtx.waitUntil(p); } catch { await p; }
  }

  // ---------- Phiên ----------
  app.post("/api/sessions", async (c) => {
    const body = CreateSessionBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body", details: body.error.flatten() }, 400);
    const { userId, store } = c.var;
    const env = c.env ?? {};

    // Câu hỏi đi vào prompt của mọi lượt → cùng lớp chặn với mục tiêu thư mục (chỉ thị cài cắm, đòi chấm hộ, đòi bí mật).
    if (body.data.question && goalProblem(body.data.question, 1000)) return c.json({ error: "question_rejected" }, 422);
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const used = await store.countSessionsSince(userId, since.toISOString());
    const limit = num(env.LIMIT_SESSIONS_PER_DAY, 3);
    if (used >= limit) return c.json({ error: "session_quota_reached", limit }, 429);

    // Tài liệu: chỉ nhận id thuộc chính người dùng; văn bản dán vào → nhập thành 1 tài liệu
    const docIds = [...new Set(body.data.document_ids ?? [])];
    const owned = await store.getDocuments(userId, docIds);
    if (owned.length !== docIds.length) return c.json({ error: "document_not_found" }, 404);

    // Mục tiêu học của thư mục: folder_id chỉ định rõ, hoặc mọi tài liệu của phiên cùng nằm trong một thư mục.
    const folders = (await store.listFolders?.(userId)) ?? [];
    let folderGoal: string | null = null;
    if (body.data.folder_id) {
      const f = folders.find((x) => x.id === body.data.folder_id);
      if (!f) return c.json({ error: "folder_not_found" }, 404);
      folderGoal = f.goal ?? null;
    } else if (owned.length) {
      const ids = new Set(owned.map((d) => d.folderId ?? null));
      const only = ids.size === 1 ? [...ids][0] : null;
      folderGoal = (only && folders.find((x) => x.id === only)?.goal) || null;
    }

    const settings = (await store.getSettings(userId)) ?? DEFAULT_SETTINGS;
    const trace = newTrace(env, "session.create", userId, null, ["create"]);
    const embedder = embedderFor(env);
    try {
      if (body.data.source_text?.trim()) {
        const { document } = await ingestDocument(
          { userId, title: `Ghi chú: ${body.data.topic}`.slice(0, 200), kind: "text", pages: [{ page: null, text: body.data.source_text }] },
          { store, embedder, trace },
        );
        if (!docIds.includes(document.id)) docIds.push(document.id);
      }
      let session = createSession({
        userId, mode: body.data.mode, topic: body.data.topic, goal: body.data.goal ?? null, folderGoal,
        selfConfidence: settings.selfAssessment ? body.data.self_confidence ?? null : null,
        documentIds: docIds, settings, level: body.data.mode === "explore" ? body.data.level ?? null : null, request: body.data.question ?? null,
      });
      trace.data.sessionId = session.id;
      if (session.state.path) {
        const { core } = routersFor(env, store, userId, session.id);
        session = await prepareLearningPath(session, { core, retriever: docIds.length ? new Retriever(store, embedder) : null, trace });
      } else if (docIds.length) {
        const { core } = routersFor(env, store, userId, session.id);
        session = await prepareGroundedSession(session, { core, retriever: new Retriever(store, embedder), trace });
      }
      await store.createSession(session);
      return c.json({ ...publicSession(session), traceId: trace.id }, 201);
    } catch (e) {
      if (e instanceof IngestError) return c.json({ error: `ingest_${e.code}` }, 422);
      throw e;
    } finally {
      await flushTrace(c, trace);
    }
  });

  app.get("/api/sessions", async (c) => {
    const { userId, store } = c.var;
    return c.json({ items: await store.listSessions(userId, 30) });
  });

  // Trang Tiến độ: chi tiết + thẻ đánh giá của nhiều phiên trong MỘT yêu cầu (thay cho 2 yêu cầu mỗi phiên).
  // Đặt trước "/api/sessions/:id" để không bị khớp nhầm. Không trả tin nhắn (trang Tiến độ không cần).
  app.get("/api/sessions/summaries", async (c) => {
    const { userId, store } = c.var;
    const raw = (c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const ids = [...new Set(raw)].filter((x) => UUID_RE.test(x)).slice(0, 40);
    if (!ids.length) return c.json({ items: [] });
    const rows = store.getSessionSummaries
      ? await store.getSessionSummaries(ids, userId)
      : (await Promise.all(ids.map(async (id) => {
          const session = await store.getSession(id, userId);
          if (!session) return null;
          return { session: { ...session, messages: [] }, card: session.status === "finished" ? await store.getCard(id, userId) : null };
        }))).filter((x): x is NonNullable<typeof x> => !!x);
    return c.json({ items: rows.map(({ session, card }) => ({ id: session.id, view: { ...publicSession(session), card }, assessment: assessLearner(session) })) });
  });

  app.get("/api/sessions/:id", async (c) => {
    const { userId, store } = c.var;
    const s = await store.getSession(c.req.param("id"), userId);
    if (!s) return c.json({ error: "not_found" }, 404); // không phân biệt "không tồn tại" và "không phải của bạn"
    const card = s.status === "finished" ? await store.getCard(s.id, userId) : null;
    return c.json({ ...publicSession(s), card });
  });

  app.post("/api/sessions/:id/turn", async (c) => {
    const body = TurnBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body", details: body.error.flatten() }, 400);
    return handleTurn(c, body.data.text, body.data.intent ?? null, body.data.client_turn_id);
  });

  app.post("/api/sessions/:id/finish", async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    return handleTurn(c, "", "finish", String(b?.client_turn_id ?? `finish-${c.req.param("id")}`));
  });

  app.post("/api/sessions/:id/pause", async (c) => {
    const { userId, store } = c.var;
    const s = await store.getSession(c.req.param("id"), userId);
    if (!s) return c.json({ error: "not_found" }, 404);
    if (s.status !== "finished") {
      s.status = "paused";
      s.updatedAt = new Date().toISOString();
      await store.saveSession(s);
    }
    return c.json({ status: s.status });
  });

  async function handleTurn(c: any, text: string, intent: (typeof INTENTS)[number] | null, clientTurnId: string) {
    const { userId, store } = c.var as Vars;
    const env: Env = c.env ?? {};
    const id = c.req.param("id");
    const maxChars = num(env.LIMIT_INPUT_CHARS, 3000);
    if (text.length > maxChars) return c.json({ error: "input_too_long", max: maxChars }, 413);
    if (!text.trim() && !intent) return c.json({ error: "empty_turn" }, 400);

    const session = await store.getSession(id, userId);
    if (!session) return c.json({ error: "not_found" }, 404);

    const cached = await store.getTurnResult(id, clientTurnId);
    if (cached) return c.json(cached); // idempotency: gửi lại do mất mạng

    if (session.status === "finished") return c.json({ error: "session_finished" }, 409);

    const { core, light } = routersFor(env, store, userId, id);
    const trace = newTrace(env, "agent.turn", userId, id, intent ? [`intent:${intent}`] : []);
    try {
      const { session: next, result } = await runTurn(session, { text, intent }, {
        core, light, trace, retriever: new Retriever(store, embedderFor(env)),
        tools: { store }, maxInputChars: maxChars,
        web: over.web !== undefined ? over.web : over.routers ? null : buildWebSearcher(env, store),
        graph: graphFor(env, store),
        maxToolRounds: num(env.MAX_TOOL_ROUNDS, 1), maxLlmCallsPerTurn: num(env.MAX_LLM_CALLS_PER_TURN, 3),
        limits: { turnsPerSession: num(env.LIMIT_TURNS_PER_SESSION, 12), maxRoundsSameGap: 2, maxAgentLedRounds: 6 },
      });
      await store.saveSession(next);
      if (result.card && !result.cardSaved) await store.saveCard(next.id, userId, result.card);
      await store.saveTurnResult(id, clientTurnId, result);
      return c.json(result);
    } catch (e) {
      if (e instanceof AgentUnavailableError) {
        // Không lưu gì: client giữ nguyên tin nhắn và thử lại với cùng client_turn_id.
        return c.json({ error: "agent_unavailable", retryable: true, traceId: trace.id, message: "Tạm thời chưa thể phản hồi. Cậu thử gửi lại sau ít giây nhé." }, 503);
      }
      throw e;
    } finally {
      await flushTrace(c, trace);
    }
  }

  // ---------- Đánh giá người học & observability của phiên ----------
  app.get("/api/sessions/:id/assessment", async (c) => {
    const { userId, store } = c.var;
    const s = await store.getSession(c.req.param("id"), userId);
    if (!s) return c.json({ error: "not_found" }, 404);
    return c.json(assessLearner(s));
  });

  app.get("/api/sessions/:id/traces", async (c) => {
    const { userId, store } = c.var;
    const s = await store.getSession(c.req.param("id"), userId);
    if (!s) return c.json({ error: "not_found" }, 404);
    return c.json({ items: await store.listTraces(userId, s.id) });
  });

  // ---------- Thư viện tài liệu (RAG) ----------
  // Văn bản đã được trích ở client (pdf.js cho PDF, đọc XML cho .pptx) và gửi lên theo trang.
  app.post("/api/documents", async (c) => {
    const body = DocumentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body", details: body.error.flatten() }, 400);
    const { userId, store } = c.var;
    const env: Env = c.env ?? {};
    const trace = newTrace(env, "document.ingest", userId, null, [body.data.kind]);
    try {
      const r = await ingestDocument({ userId, ...body.data }, { store, embedder: embedderFor(env), trace });
      return c.json(r, r.duplicate ? 200 : 201);
    } catch (e) {
      if (e instanceof IngestError) return c.json({ error: `ingest_${e.code}` }, e.code === "too_large" ? 413 : 422);
      throw e;
    } finally {
      await flushTrace(c, trace);
    }
  });

  // ---------- Thư mục tài liệu (My Folder) ----------
  const FOLDER_COLORS = ["blue", "purple", "green", "amber", "pink", "teal"] as const;
  const FolderBody = z.object({
    name: z.string().trim().min(1).max(80),
    color: z.enum(FOLDER_COLORS).optional(),
    goal: z.string().trim().max(500).optional().nullable(), // "" hoặc null = xoá mục tiêu
  });
  const publicFolder = (f: { id: string; name: string; color: string; goal?: string | null; createdAt: string }) => ({ id: f.id, name: f.name, color: f.color, goal: f.goal ?? null, createdAt: f.createdAt });
  /** Mục tiêu học đi vào prompt → chặn chỉ thị cài cắm / đòi bí mật ngay khi lưu (cùng lớp guardrail với tin nhắn). */
  const goalProblem = (goal: string | null | undefined, maxChars = 500) => {
    if (!goal) return null;
    const v = checkUserInput(goal, { maxChars, hasIntent: false });
    return v.kind !== "ok" || v.flags.some((f) => f === "prompt_injection" || f === "grading_manipulation") ? "goal_rejected" : null;
  };

  app.get("/api/folders", async (c) => {
    const items = (await c.var.store.listFolders?.(c.var.userId)) ?? [];
    return c.json({ items: items.map(publicFolder) });
  });

  app.post("/api/folders", async (c) => {
    const b = FolderBody.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { store, userId } = c.var;
    if (!store.saveFolder || !store.listFolders) return c.json({ error: "not_supported" }, 501);
    if ((await store.listFolders(userId)).length >= 50) return c.json({ error: "folder_limit" }, 400);
    if (goalProblem(b.data.goal)) return c.json({ error: "goal_rejected" }, 422);
    const f = { id: crypto.randomUUID(), userId, name: b.data.name, color: b.data.color ?? "blue", goal: b.data.goal || null, createdAt: new Date().toISOString() };
    await store.saveFolder(f);
    return c.json(publicFolder(f), 201);
  });

  app.patch("/api/folders/:id", async (c) => {
    const b = FolderBody.partial().safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { store, userId } = c.var;
    if (!store.saveFolder || !store.listFolders) return c.json({ error: "not_supported" }, 501);
    const f = (await store.listFolders(userId)).find((x) => x.id === c.req.param("id"));
    if (!f) return c.json({ error: "not_found" }, 404);
    if (goalProblem(b.data.goal)) return c.json({ error: "goal_rejected" }, 422);
    const next = { ...f, name: b.data.name ?? f.name, color: b.data.color ?? f.color, goal: b.data.goal === undefined ? f.goal ?? null : b.data.goal || null };
    await store.saveFolder(next);
    return c.json(publicFolder(next));
  });

  app.delete("/api/folders/:id", async (c) => {
    const { store, userId } = c.var;
    if (!store.deleteFolder) return c.json({ error: "not_supported" }, 501);
    const ok = await store.deleteFolder(userId, c.req.param("id"));
    return ok ? c.json({ deleted: true }) : c.json({ error: "not_found" }, 404);
  });

  // ---- Ghi chú cá nhân (trợ lý ghi chú ở chân trang). Văn bản thuần, chỉ chủ tài khoản đọc/ghi. ----
  const NoteBody = z.object({ title: z.string().max(120), body: z.string().max(20000) });
  const MAX_NOTES = 200;
  app.get("/api/notes", async (c) => {
    const { store, userId } = c.var;
    if (!store.listNotes) return c.json({ items: [] });
    return c.json({ items: (await store.listNotes(userId)).map(publicNote) });
  });
  app.post("/api/notes", async (c) => {
    const b = NoteBody.partial().safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { store, userId } = c.var;
    if (!store.saveNote || !store.listNotes) return c.json({ error: "not_supported" }, 501);
    if ((await store.listNotes(userId)).length >= MAX_NOTES) return c.json({ error: "too_many_notes" }, 409);
    const now = new Date().toISOString();
    const n = { id: crypto.randomUUID(), userId, title: (b.data.title ?? "").trim(), body: b.data.body ?? "", createdAt: now, updatedAt: now };
    await store.saveNote(n);
    return c.json(publicNote(n), 201);
  });
  app.patch("/api/notes/:id", async (c) => {
    const b = NoteBody.partial().safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { store, userId } = c.var;
    if (!store.saveNote || !store.listNotes) return c.json({ error: "not_supported" }, 501);
    const n = (await store.listNotes(userId)).find((x) => x.id === c.req.param("id"));
    if (!n) return c.json({ error: "not_found" }, 404);
    const next = { ...n, title: b.data.title === undefined ? n.title : b.data.title.trim(), body: b.data.body ?? n.body, updatedAt: new Date().toISOString() };
    await store.saveNote(next);
    return c.json(publicNote(next));
  });
  app.delete("/api/notes/:id", async (c) => {
    const { store, userId } = c.var;
    if (!store.deleteNote) return c.json({ error: "not_supported" }, 501);
    const ok = await store.deleteNote(userId, c.req.param("id"));
    return ok ? c.json({ deleted: true }) : c.json({ error: "not_found" }, 404);
  });

  /** Chuyển tài liệu vào thư mục (folder_id = null để bỏ khỏi thư mục). */
  app.patch("/api/documents/:id", async (c) => {
    const b = z.object({ folder_id: z.string().uuid().nullable() }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { store, userId } = c.var;
    if (!store.setDocumentFolder || !store.listFolders) return c.json({ error: "not_supported" }, 501);
    const folderId = b.data.folder_id;
    if (folderId && !(await store.listFolders(userId)).some((f) => f.id === folderId)) return c.json({ error: "folder_not_found" }, 404);
    const ok = await store.setDocumentFolder(userId, c.req.param("id"), folderId);
    return ok ? c.json({ id: c.req.param("id"), folderId }) : c.json({ error: "not_found" }, 404);
  });

  app.get("/api/documents", async (c) => c.json({ items: await c.var.store.listDocuments(c.var.userId) }));

  app.delete("/api/documents/:id", async (c) => {
    const ok = await c.var.store.deleteDocument(c.var.userId, c.req.param("id"));
    // Xoá luôn phần đồ thị dựng từ tài liệu này (lỗi Neo4j không chặn việc xoá tài liệu).
    if (ok) await graphFor(c.env ?? {}, c.var.store)?.deleteDocument(c.var.userId, c.req.param("id")).catch(() => {});
    return ok ? c.json({ deleted: true }) : c.json({ error: "not_found" }, 404);
  });

  // ---------- Đợt 3: Bản đồ khái niệm (GraphRAG, Neo4j) ----------
  app.get("/api/graph/status", async (c) => {
    const env: Env = c.env ?? {};
    const graph = graphFor(env, c.var.store);
    const limits = { pagesPerBuild: num(env.GRAPH_MAX_PAGES_PER_BUILD, 40), buildsPerDay: num(env.GRAPH_BUILDS_PER_DAY, 10) };
    if (!graph) return c.json({ configured: false, connected: false, kind: null, limits });
    try {
      const connected = await graph.ping();
      return c.json({ configured: true, connected, kind: graph.kind, limits });
    } catch (e) {
      return c.json({ configured: true, connected: false, kind: graph.kind, error: ((e as { code?: string }).code ?? "error").slice(0, 80), limits });
    }
  });

  app.post("/api/graph/build", async (c) => {
    const b = z.object({ document_ids: z.array(z.string().uuid()).min(1).max(5) }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { userId, store } = c.var;
    const env: Env = c.env ?? {};
    const graph = graphFor(env, store);
    if (!graph) return c.json({ error: "graph_not_configured" }, 503);
    const trace = newTrace(env, "graph.build", userId, null, ["graph"]);
    try {
      const { core } = routersFor(env, store, userId, null);
      const r = await buildConceptGraph({
        userId, documentIds: b.data.document_ids, store, graph, router: core, trace,
        // v2: mỗi lần bấm đọc tới 40 trang, gộp thành ≤ 4 lô lớn (~12.000 ký tự/lô) — vẫn ≤ 4 lời gọi AI mỗi lần bấm.
        maxPages: num(env.GRAPH_MAX_PAGES_PER_BUILD, 40), maxCalls: num(env.GRAPH_MAX_CALLS_PER_BUILD, 4), charsPerBatch: num(env.GRAPH_CHARS_PER_BATCH, 6000), buildsPerDay: num(env.GRAPH_BUILDS_PER_DAY, 10),
      });
      return c.json(r);
    } catch (e) {
      if (e instanceof GraphBuildError) {
        const status = e.code === "forbidden" ? 403 : e.code === "daily_limit" ? 429 : e.code === "graph_unavailable" ? 503 : 400;
        return c.json({ error: `graph_${e.code}` }, status);
      }
      throw e;
    } finally {
      await flushTrace(c, trace);
    }
  });

  app.get("/api/graph", async (c) => {
    const { userId, store } = c.var;
    const graph = graphFor(c.env ?? {}, store);
    if (!graph) return c.json({ error: "graph_not_configured" }, 503);
    const wanted = (c.req.query("document_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10);
    const owned = new Set((await store.listDocuments(userId)).map((d) => d.id));
    if (wanted.some((id) => !owned.has(id))) return c.json({ error: "document_not_found" }, 404);
    try {
      return c.json(await graph.view(userId, wanted.length ? wanted : [...owned], 150, EXTRACTOR_VERSION));
    } catch {
      return c.json({ error: "graph_graph_unavailable" }, 503);
    }
  });

  app.post("/api/documents/search", async (c) => {
    const b = z.object({ query: z.string().min(1).max(500), document_ids: z.array(z.string().uuid()).min(1).max(10), k: z.number().int().min(1).max(10).default(4) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { userId, store } = c.var;
    const hits = await new Retriever(store, embedderFor(c.env ?? {})).search(userId, b.data.document_ids, b.data.query, b.data.k);
    return c.json({
      items: hits.map((h) => ({ chunkId: h.chunk.id, documentId: h.chunk.documentId, title: h.documentTitle, page: h.chunk.page, heading: h.chunk.heading, preview: h.chunk.text.slice(0, 300), score: h.score })),
    });
  });

  // ---------- MCP connectors ----------
  /** Khoá mã hoá token connector: CONNECTOR_ENC_KEY, hoặc dẫn xuất từ service-role key (cùng là bí mật phía server). */
  const encKey = async (env: Env): Promise<string | null> => {
    if (env.CONNECTOR_ENC_KEY) return env.CONNECTOR_ENC_KEY;
    if (env.SUPABASE_SERVICE_ROLE_KEY) {
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mindmirror-connector-v1:${env.SUPABASE_SERVICE_ROLE_KEY}`)));
      return btoa(String.fromCharCode(...d));
    }
    return env.APP_ENV === "development" || env.APP_ENV === "demo" || !env.APP_ENV ? DEV_ENC_KEY : null;
  };

  async function openSource(c: any, conn: ConnectorRecord) {
    const env: Env = c.env ?? {};
    const key = await encKey(env);
    const token = conn.tokenEnc && key ? await decryptSecret(conn.tokenEnc, key) : null;
    const client = new McpClient(conn.url, { token, fetchImpl: over.mcpFetch });
    return new McpLibrarySource(client, conn.tools);
  }

  app.post("/api/connectors", async (c) => {
    const b = ConnectorBody.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { userId, store } = c.var;
    const env: Env = c.env ?? {};
    try {
      checkMcpUrl(b.data.url, { allowedHosts: env.MCP_ALLOWED_HOSTS, allowLocal: over.allowLocalMcp || env.APP_ENV === "development" });
    } catch (e) {
      return c.json({ error: "invalid_mcp_url", reason: (e as Error).message }, 400);
    }
    const key = await encKey(env);
    if (b.data.token && !key) return c.json({ error: "connector_encryption_not_configured" }, 500);

    const trace = newTrace(env, "connector.connect", userId, null, [b.data.preset]);
    const span = trace.start("mcp.discover", "tool", null, { preset: b.data.preset, host: new URL(b.data.url).host });
    try {
      const client = new McpClient(b.data.url, { token: b.data.token, fetchImpl: over.mcpFetch });
      const info = await client.initialize();
      const tools = await client.listTools();
      const picked = discoverTools(tools, b.data.preset);
      span.set({ server: info.serverName, protocol: info.protocolVersion, tools_total: tools.length, picked });
      const rec: ConnectorRecord = {
        id: crypto.randomUUID(), userId, name: b.data.name, url: b.data.url, preset: b.data.preset,
        tokenEnc: b.data.token ? await encryptSecret(b.data.token, key!) : null, tools: picked, createdAt: new Date().toISOString(),
      };
      await store.saveConnector(rec);
      return c.json(publicConnector(rec), 201);
    } catch (e) {
      span.fail(e);
      if (e instanceof ConnectorError) return c.json({ error: e.code }, 422);
      if (e instanceof McpError) return c.json({ error: "mcp_unreachable", status: e.httpStatus }, 502);
      throw e;
    } finally {
      span.end();
      await flushTrace(c, trace);
    }
  });

  app.get("/api/connectors", async (c) => c.json({ items: (await c.var.store.listConnectors(c.var.userId)).map(publicConnector) }));

  app.delete("/api/connectors/:id", async (c) => {
    await c.var.store.deleteConnector(c.var.userId, c.req.param("id"));
    return c.json({ deleted: true });
  });

  app.get("/api/connectors/:id/items", async (c) => {
    const { userId, store } = c.var;
    const conn = await store.getConnector(userId, c.req.param("id"));
    if (!conn) return c.json({ error: "not_found" }, 404);
    try {
      const items = await (await openSource(c, conn)).search((c.req.query("q") ?? "").slice(0, 200));
      return c.json({ items });
    } catch (e) {
      if (e instanceof McpError || e instanceof ConnectorError) return c.json({ error: "mcp_error", message: (e as Error).message.slice(0, 200) }, 502);
      throw e;
    }
  });

  // Người dùng CHỌN tài liệu cụ thể để nhập — agent không tự duyệt toàn bộ Drive/Notion.
  app.post("/api/connectors/:id/import", async (c) => {
    const b = z.object({ items: z.array(z.object({ id: z.string().min(1).max(500), title: z.string().min(1).max(200) })).min(1).max(10) })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_body" }, 400);
    const { userId, store } = c.var;
    const env: Env = c.env ?? {};
    const conn = await store.getConnector(userId, c.req.param("id"));
    if (!conn) return c.json({ error: "not_found" }, 404);
    const trace = newTrace(env, "connector.import", userId, null, [conn.preset]);
    const source = await openSource(c, conn);
    const results: unknown[] = [];
    try {
      for (const item of b.data.items) {
        const span = trace.start("mcp.fetch", "tool", null, { tool: conn.tools.fetch || "resources/read", connector: conn.id });
        try {
          const { text, truncated } = await source.fetch(item);
          span.set({ chars: text.length, truncated });
          const pages = text.split("\f").map((t, i, arr) => ({ page: arr.length > 1 ? i + 1 : null, text: t }));
          const r = await ingestDocument(
            { userId, title: item.title, kind: "mcp", pages, origin: { connectorId: conn.id, externalId: item.id } },
            { store, embedder: embedderFor(env), trace, parent: span },
          );
          results.push({ item, document: r.document, duplicate: r.duplicate, truncated });
        } catch (e) {
          span.fail(e);
          results.push({ item, error: e instanceof IngestError ? `ingest_${e.code}` : (e as Error).message.slice(0, 200) });
        } finally {
          span.end();
        }
      }
      return c.json({ results });
    } finally {
      await flushTrace(c, trace);
    }
  });

  // ---------- Cài đặt / dữ liệu ----------
  // Hạn mức hôm nay (cùng cách đếm với chặn tạo phiên: từ 0h UTC = 7h sáng giờ Việt Nam).
  app.get("/api/me/usage", async (c) => {
    const { userId, store } = c.var;
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const reset = new Date(since.getTime() + 86_400_000);
    const used = await store.countSessionsSince(userId, since.toISOString());
    return c.json({ sessionsToday: used, sessionsPerDay: num((c.env ?? {}).LIMIT_SESSIONS_PER_DAY, 3), resetAt: reset.toISOString() });
  });

  app.get("/api/me/settings", async (c) => {
    const { userId, store } = c.var;
    return c.json((await store.getSettings(userId)) ?? DEFAULT_SETTINGS);
  });

  app.patch("/api/me/settings", async (c) => {
    const body = SettingsBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const { userId, store } = c.var;
    const merged = { ...((await store.getSettings(userId)) ?? DEFAULT_SETTINGS), ...body.data };
    await store.saveSettings(userId, merged);
    return c.json(merged);
  });

  app.delete("/api/me/data", async (c) => {
    const b = z.object({ scope: z.enum(["sessions", "all"]), confirm: z.literal("XOA") }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "confirmation_required" }, 400);
    const { userId, store } = c.var;
    await store.deleteUserData(userId, b.data.scope);
    if (b.data.scope === "all") await graphFor(c.env ?? {}, store)?.deleteUser(userId).catch(() => {});
    return c.json({ deleted: b.data.scope });
  });

  app.onError((err, c) => {
    console.error(JSON.stringify({ level: "error", path: c.req.path, msg: err.message })); // không log nội dung người dùng
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

function publicNote(n: import("../store/types").NoteRecord) {
  return { id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, updatedAt: n.updatedAt };
}

/** Chỉ trả những gì frontend cần; không lộ state nội bộ thừa. */
function publicSession(s: Session) {
  return {
    id: s.id,
    status: s.status,
    mode: s.state.mode,
    phase: s.state.phase,
    topic: s.state.topic,
    goal: s.state.goal,
    folderGoal: s.state.folderGoal ?? null,
    path: s.state.path ?? null,
    request: s.state.request ?? null,
    hintLevel: s.state.hintLevel,
    turnCount: s.state.turnCount,
    messages: s.messages.map((m) => ({ id: m.id, role: m.role, text: m.text, action: m.action, citations: m.citations ?? [], webCitations: m.webCitations ?? [] })),
    gaps: s.gaps,
    evidence: s.evidence,
    documentIds: s.documentIds,
    rubric: s.rubric,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function publicConnector(c: ConnectorRecord) {
  return { id: c.id, name: c.name, preset: c.preset, host: new URL(c.url).host, tools: c.tools, hasToken: !!c.tokenEnc, createdAt: c.createdAt };
}
