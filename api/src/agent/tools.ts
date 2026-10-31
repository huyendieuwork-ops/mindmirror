/**
 * TOOL REGISTRY — một nguồn duy nhất cho mọi công cụ của Agent.
 *
 *  - Native tool calling: engine khai báo một tập con công cụ (chỉ-đọc) cho Gemini ở lượt cần thiết,
 *    model TỰ quyết định có gọi hay không; backend chạy công cụ qua executeTool().
 *  - Policy (code) cũng gọi công cụ qua executeTool() khi việc đó là bắt buộc (vd lấy ngữ cảnh tài liệu của phiên,
 *    lưu thẻ tổng kết) — trace ghi rõ initiator = "policy" | "model" | "mcp".
 *  - MCP server (src/mcp/server.ts) phơi bày CÙNG registry này cho client bên ngoài → không có hai hệ thống trùng lặp.
 *
 * Mỗi công cụ: input schema (zod) + output schema (zod) + kiểm tra quyền theo userId + xử lý lỗi có mã.
 * Không ghi nội dung học tập vào trace (chỉ độ dài/số lượng).
 */
import { z } from "zod";
import type { Citation, MirrorCard, RetrievedChunk, Session } from "./types";
import type { Store } from "../store/types";
import type { Retriever } from "../rag/retriever";
import type { ToolDeclaration } from "../providers/types";
import { NoopTrace, type SpanHandle, type Trace } from "../obs/tracer";
import { assessLearner } from "./assessment";

export type ToolInitiator = "model" | "policy" | "mcp";

export interface ToolContext {
  userId: string;
  store: Store;
  retriever: Retriever | null;
  session?: Session | null;
  trace?: Trace;
  parent?: SpanHandle | null;
  initiator: ToolInitiator;
  /** Nhãn nguồn bắt đầu từ S{sourceOffset+1} để model trích dẫn đúng đoạn trả về. */
  sourceOffset?: number;
}

export type ToolErrorCode = "invalid_input" | "forbidden" | "not_found" | "unavailable" | "internal";

export type ToolResult<O = unknown> =
  | { ok: true; data: O; chunks?: RetrievedChunk[] }
  | { ok: false; error: { code: ToolErrorCode; message: string } };

export class ToolError extends Error {
  constructor(readonly code: ToolErrorCode, message: string) {
    super(message);
  }
}

interface ToolDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  name: string;
  description: string;
  input: I;
  output: O;
  readOnly: boolean;
  /** Có cho model tự gọi không (save_session_summary chỉ do workflow gọi). */
  modelCallable: boolean;
  parameters: ToolDeclaration["parameters"];
  run(ctx: ToolContext, input: z.infer<I>): Promise<{ data: z.infer<O>; chunks?: RetrievedChunk[] }>;
}

const uuid = z.string().uuid();
const SourceItem = z.object({
  source_id: z.string(),
  document_id: z.string(),
  document_title: z.string(),
  page: z.number().nullable(),
  heading: z.string().nullable(),
  excerpt: z.string(),
  suspicious: z.boolean(),
});
const SearchOutput = z.object({ results: z.array(SourceItem), searched_documents: z.number(), note: z.string().nullable() });

const EXCERPT = 600;

function toSources(chunks: RetrievedChunk[], offset: number) {
  return chunks.map((r, i) => ({
    source_id: `S${offset + i + 1}`,
    document_id: r.chunk.documentId,
    document_title: r.documentTitle,
    page: r.chunk.page,
    heading: r.chunk.heading,
    // Nội dung tài liệu là DỮ KIỆN: đoạn nghi chứa chỉ thị được đánh dấu để model không làm theo.
    excerpt: r.chunk.text.slice(0, EXCERPT),
    suspicious: r.chunk.suspicious,
  }));
}

// ---------------- 1. search_learning_materials ----------------
const searchLearningMaterials: ToolDef<any, typeof SearchOutput> = {
  name: "search_learning_materials",
  description:
    "Tìm đoạn liên quan trong THƯ VIỆN TÀI LIỆU của chính người học (mọi tài liệu đã tải lên, hoặc lọc theo thư mục/tài liệu). " +
    "Dùng khi cần kiểm chứng một nhận định bằng tài liệu của người học hoặc khi người học nhắc tới tài liệu/slide của họ. Không dùng cho kiến thức phổ thông.",
  input: z.object({
    query: z.string().trim().min(2).max(300),
    folder_id: uuid.optional().nullable(),
    document_ids: z.array(uuid).max(10).optional().nullable(),
    k: z.number().int().min(1).max(6).optional().nullable(),
  }),
  output: SearchOutput,
  readOnly: true,
  modelCallable: true,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Câu truy vấn ngắn, tiếng Việt, nêu khái niệm cần kiểm chứng" },
      folder_id: { type: "string", description: "(tuỳ chọn) chỉ tìm trong một thư mục" },
      document_ids: { type: "array", items: { type: "string" }, description: "(tuỳ chọn) chỉ tìm trong các tài liệu này" },
      k: { type: "integer", description: "Số đoạn cần lấy (1–6, mặc định 4)" },
    },
    required: ["query"],
  },
  async run(ctx, input) {
    const all = await ctx.store.listDocuments(ctx.userId);
    let docs = all;
    if (input.document_ids?.length) {
      const owned = new Set(all.map((d) => d.id));
      // Không tiết lộ tài liệu tồn tại hay không: id lạ = không có quyền.
      if (input.document_ids.some((id: string) => !owned.has(id))) throw new ToolError("forbidden", "document_not_accessible");
      docs = all.filter((d) => input.document_ids!.includes(d.id));
    }
    if (input.folder_id) {
      const folders = (await ctx.store.listFolders?.(ctx.userId)) ?? [];
      if (!folders.some((f) => f.id === input.folder_id)) throw new ToolError("forbidden", "folder_not_accessible");
      docs = docs.filter((d) => d.folderId === input.folder_id);
    }
    if (!docs.length) return { data: { results: [], searched_documents: 0, note: all.length ? "no_documents_in_scope" : "user_has_no_documents" } };
    if (!ctx.retriever) throw new ToolError("unavailable", "retriever_not_configured");
    const chunks = await ctx.retriever.search(ctx.userId, docs.map((d) => d.id), input.query, input.k ?? 4, {
      trace: ctx.trace, parent: ctx.parent, purpose: `tool:${ctx.initiator}`,
    });
    return {
      data: { results: toSources(chunks, ctx.sourceOffset ?? 0), searched_documents: docs.length, note: chunks.length ? null : "no_relevant_passage" },
      chunks,
    };
  },
};

// ---------------- 2. retrieve_document_context ----------------
const retrieveDocumentContext: ToolDef<any, typeof SearchOutput> = {
  name: "retrieve_document_context",
  description: "Lấy các đoạn liên quan nhất trong những tài liệu ĐÃ GẮN VỚI PHIÊN HỌC hiện tại.",
  input: z.object({ query: z.string().trim().min(2).max(600), k: z.number().int().min(1).max(6).optional().nullable() }),
  output: SearchOutput,
  readOnly: true,
  modelCallable: true,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Điều cần tìm trong tài liệu của phiên" }, k: { type: "integer" } },
    required: ["query"],
  },
  async run(ctx, input) {
    const s = ctx.session;
    if (!s) throw new ToolError("not_found", "no_active_session");
    if (s.userId !== ctx.userId) throw new ToolError("forbidden", "session_not_accessible");
    if (!s.documentIds.length) return { data: { results: [], searched_documents: 0, note: "session_has_no_documents" } };
    if (!ctx.retriever) throw new ToolError("unavailable", "retriever_not_configured");
    // Retriever/Store luôn lọc theo userId → tài liệu người khác không bao giờ lọt vào.
    const chunks = await ctx.retriever.search(ctx.userId, s.documentIds, input.query, input.k ?? 4, {
      trace: ctx.trace, parent: ctx.parent, purpose: `tool:${ctx.initiator}`,
    });
    return {
      data: { results: toSources(chunks, ctx.sourceOffset ?? 0), searched_documents: s.documentIds.length, note: chunks.length ? null : "no_relevant_passage" },
      chunks,
    };
  },
};

// ---------------- 3. get_learning_history ----------------
const HistoryOutput = z.object({
  sessions: z.array(z.object({
    session_id: z.string(), topic: z.string(), mode: z.string(), status: z.string(), updated_at: z.string(),
    open_gaps: z.array(z.string()), next_step: z.string().nullable(),
  })),
});
const getLearningHistory: ToolDef<any, typeof HistoryOutput> = {
  name: "get_learning_history",
  description: "Xem các phiên học gần đây của CHÍNH người học (chủ đề, trạng thái, điểm còn vướng). Dùng khi người học nhắc tới buổi học trước hoặc muốn ôn lại.",
  input: z.object({ limit: z.number().int().min(1).max(10).optional().nullable(), topic_contains: z.string().trim().max(100).optional().nullable() }),
  output: HistoryOutput,
  readOnly: true,
  modelCallable: true,
  parameters: {
    type: "object",
    properties: { limit: { type: "integer", description: "1–10, mặc định 5" }, topic_contains: { type: "string", description: "(tuỳ chọn) lọc theo chủ đề" } },
  },
  async run(ctx, input) {
    const limit = input.limit ?? 5;
    const needle = input.topic_contains ? fold(input.topic_contains) : null;
    const items = (await ctx.store.listSessions(ctx.userId, 30))
      .filter((x) => x.id !== ctx.session?.id && (!needle || fold(x.topic).includes(needle)))
      .slice(0, limit);
    const sessions = [];
    for (const it of items) {
      const s = await ctx.store.getSession(it.id, ctx.userId);
      if (!s) continue;
      const card = s.status === "finished" ? await ctx.store.getCard(s.id, ctx.userId) : null;
      sessions.push({
        session_id: s.id, topic: s.state.topic, mode: s.state.mode, status: s.status, updated_at: s.updatedAt,
        open_gaps: s.gaps.filter((g) => g.status === "open").map((g) => g.concept).slice(0, 5),
        next_step: card?.nextStep ?? null,
      });
    }
    return { data: { sessions } };
  },
};

// ---------------- 4. get_knowledge_gaps ----------------
const GapsOutput = z.object({
  gaps: z.array(z.object({ concept: z.string(), topic: z.string(), status: z.string(), session_id: z.string(), last_seen: z.string() })),
});
const getKnowledgeGaps: ToolDef<any, typeof GapsOutput> = {
  name: "get_knowledge_gaps",
  description: "Lấy các lỗ hổng kiến thức đã ghi nhận của CHÍNH người học ở các phiên trước (chưa giải quyết hoặc cần luyện thêm). Dùng để nối tiếp điểm còn yếu.",
  input: z.object({ topic: z.string().trim().max(100).optional().nullable(), limit: z.number().int().min(1).max(15).optional().nullable() }),
  output: GapsOutput,
  readOnly: true,
  modelCallable: true,
  parameters: {
    type: "object",
    properties: { topic: { type: "string", description: "(tuỳ chọn) chỉ lấy gap liên quan chủ đề" }, limit: { type: "integer" } },
  },
  async run(ctx, input) {
    const needle = input.topic ? fold(input.topic) : null;
    const out: z.infer<typeof GapsOutput>["gaps"] = [];
    const seen = new Set<string>();
    for (const it of (await ctx.store.listSessions(ctx.userId, 15)).slice(0, 8)) {
      const s = await ctx.store.getSession(it.id, ctx.userId);
      if (!s) continue;
      const push = (concept: string, status: string) => {
        const key = fold(concept);
        if (seen.has(key)) return;
        if (needle && !fold(`${concept} ${s.state.topic}`).includes(needle)) return;
        seen.add(key);
        out.push({ concept, topic: s.state.topic, status, session_id: s.id, last_seen: s.updatedAt });
      };
      for (const g of s.gaps) if (g.status === "open") push(g.concept, "open");
      for (const c of assessLearner(s).criteria) if (c.status === "needs_practice") push(c.concept, "needs_practice");
    }
    return { data: { gaps: out.slice(0, input.limit ?? 8) } };
  },
};

// ---------------- 5. save_session_summary (workflow, không cho model gọi) ----------------
const SaveInput = z.object({ session_id: uuid, card: z.custom<MirrorCard>((v) => !!v && typeof v === "object" && "assessment" in (v as object)) });
const SaveOutput = z.object({ saved: z.boolean(), session_id: z.string(), demonstrated: z.number(), unresolved: z.number() });
const saveSessionSummary: ToolDef<typeof SaveInput, typeof SaveOutput> = {
  name: "save_session_summary",
  description: "Lưu Thẻ Gương Hiểu Biết (tổng kết phiên) của phiên hiện tại.",
  input: SaveInput,
  output: SaveOutput,
  readOnly: false,
  modelCallable: false,
  parameters: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] },
  async run(ctx, input) {
    const s = ctx.session ?? (await ctx.store.getSession(input.session_id, ctx.userId));
    if (!s || s.id !== input.session_id || s.userId !== ctx.userId) throw new ToolError("forbidden", "session_not_accessible");
    await ctx.store.saveCard(s.id, ctx.userId, input.card);
    return { data: { saved: true, session_id: s.id, demonstrated: input.card.demonstrated.length, unresolved: input.card.unresolved.length } };
  },
};

export const TOOLS = {
  search_learning_materials: searchLearningMaterials,
  retrieve_document_context: retrieveDocumentContext,
  get_learning_history: getLearningHistory,
  get_knowledge_gaps: getKnowledgeGaps,
  save_session_summary: saveSessionSummary,
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(n: string): n is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, n);
}

/** Khai báo function-calling cho model (chỉ công cụ modelCallable, chỉ-đọc). */
export function toolDeclarations(names: ToolName[]): ToolDeclaration[] {
  return names
    .map((n) => TOOLS[n])
    .filter((t) => t.modelCallable && t.readOnly)
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Mô tả cho MCP tools/list (JSON Schema). */
export function mcpToolList(names: ToolName[]) {
  return names.map((n) => {
    const t = TOOLS[n];
    return { name: t.name, description: t.description, inputSchema: t.parameters, annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false } };
  });
}

/**
 * Chạy một công cụ: validate input → kiểm tra quyền (bên trong tool, luôn theo ctx.userId) → chạy có timeout →
 * validate output → ghi span "tool.<name>". Không bao giờ ném lỗi ra ngoài: trả { ok:false, error } để Agent xử lý.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext, timeoutMs = 8000): Promise<ToolResult> {
  const trace = ctx.trace ?? new NoopTrace();
  const span = trace.start(`tool.${name}`, "tool", ctx.parent ?? null, { tool: name, initiator: ctx.initiator, arg_keys: argKeys(rawArgs) });
  const t0 = Date.now();
  try {
    if (!isToolName(name)) throw new ToolError("not_found", "unknown_tool");
    const tool = TOOLS[name] as ToolDef<z.ZodTypeAny, z.ZodTypeAny>;
    if (ctx.initiator === "model" && !tool.modelCallable) throw new ToolError("forbidden", "tool_not_callable_by_model");
    if (ctx.initiator === "mcp" && !tool.readOnly) throw new ToolError("forbidden", "tool_not_exposed_over_mcp");
    const parsed = tool.input.safeParse(rawArgs ?? {});
    if (!parsed.success) throw new ToolError("invalid_input", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 200));
    const run = tool.run({ ...ctx, parent: span }, parsed.data);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new ToolError("unavailable", "tool_timeout")), timeoutMs); });
    const out = await Promise.race([run, timeout]).finally(() => clearTimeout(timer));
    const checked = tool.output.safeParse(out.data);
    if (!checked.success) throw new ToolError("internal", "tool_output_schema_violation");
    span.set({ ok: true, ms: Date.now() - t0, result_count: countOf(checked.data), retrieved_chunks: out.chunks?.length ?? 0 });
    return { ok: true, data: checked.data, chunks: out.chunks };
  } catch (e) {
    const err = e instanceof ToolError ? e : new ToolError("internal", "tool_failed");
    span.set({ ok: false, ms: Date.now() - t0, error_code: err.code, error: err.message }).fail(err);
    return { ok: false, error: { code: err.code, message: err.message } };
  } finally {
    span.end();
  }
}

/** Citation hợp lệ cho đoạn mà công cụ trả về (dùng khi cần hiển thị nguồn ngoài lượt hội thoại). */
export function citationOf(r: RetrievedChunk, quote: string): Citation {
  return { chunkId: r.chunk.id, documentId: r.chunk.documentId, documentTitle: r.documentTitle, page: r.chunk.page, quote };
}

function argKeys(a: unknown): string[] {
  return a && typeof a === "object" ? Object.keys(a as object).slice(0, 8) : [];
}
function countOf(d: unknown): number | null {
  if (!d || typeof d !== "object") return null;
  for (const k of ["results", "sessions", "gaps"]) if (Array.isArray((d as any)[k])) return (d as any)[k].length;
  return null;
}
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
}
