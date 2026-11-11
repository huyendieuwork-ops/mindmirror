import { supabase, DEV_USER } from "./supabase";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

// ---------- kiểu dữ liệu trả về từ backend ----------
export type Mode = "explore" | "reunderstand";
export type Intent = "hint" | "show_answer" | "explain_more" | "give_example" | "try" | "skip" | "change_topic" | "switch_mode" | "finish";
export interface Citation { chunkId: string; documentId: string; documentTitle: string; page: number | null; quote: string }
export interface Criterion { id: string; concept: string; expectation: string; citation: Citation }
export interface WebCitation { url: string; siteName: string; title: string; quote: string }
export interface Msg { id: string; role: "user" | "assistant"; text: string; action: string | null; citations: Citation[]; webCitations?: WebCitation[] }
export interface Evidence { id: string; criterion: string; claim: string; quote: string; status: "observed" | "unclear" | "contradicted"; assisted: boolean; criterionId: string | null; sourceCitation: Citation | null; context: string }
export interface Gap { id: string; concept: string; status: string; supportLevel: number }
export type CriterionStatus = "demonstrated_independent" | "demonstrated_with_support" | "needs_practice" | "insufficient_evidence";
export interface Assessment {
  grounded: boolean; note: string;
  criteria: { criterionId: string | null; concept: string; status: CriterionStatus; applied: boolean; evidenceIds: string[]; sourceCitation: Citation | null }[];
  counts: Record<CriterionStatus, number>;
}
export interface MirrorCard {
  topic: string; mode: Mode; initialThought: string | null;
  demonstrated: { text: string; evidenceIds: string[]; assisted: boolean }[];
  changed: string | null; unresolved: string[]; nextStep: string; insufficientEvidence: boolean;
  assessment: Assessment; generatedBy: "model" | "rules";
}
export interface SessionView {
  id: string; status: "active" | "paused" | "finished"; mode: Mode; phase: string; topic: string; goal: string | null;
  hintLevel: number; turnCount: number; messages: Msg[]; gaps: Gap[]; evidence: Evidence[];
  documentIds: string[]; rubric: Criterion[]; card?: MirrorCard | null; traceId?: string;
}
export interface TurnResult {
  turnId: string; phase: string; action: string; assistantText: string; hintLevel: number; gaps: Gap[];
  newEvidence: Evidence[]; suggestModeSwitch: Mode | null; quickReplies: Intent[]; isFinished: boolean;
  card?: MirrorCard; citations: Citation[]; webCitations?: WebCitation[]; sourceTier?: "documents" | "web" | "general" | null;
  traceId: string | null; modelInfo: { provider: string; model: string } | null;
}
export interface LibraryDoc { id: string; title: string; kind: string; pageCount: number; chunkCount: number; embedded: boolean; warnings: string[]; createdAt: string; origin: unknown; folderId?: string | null }
export interface Folder { id: string; name: string; color: string; goal?: string | null; createdAt: string }
export interface Connector { id: string; name: string; preset: string; host: string; hasToken: boolean; tools: { search: string; fetch: string } }
export interface Settings { aiStyle: "friendly" | "concise" | "academic"; supportPreference: "socratic_first" | "direct" | "flexible"; challengeLevel: "gentle" | "balanced" | "deep"; selfAssessment: boolean }
export interface AppConfig { env: string; devAuth: boolean; model: string; embeddings: boolean; tracing: string[]; limits: { sessionsPerDay: number; turnsPerSession: number; inputChars: number } }
export interface TraceRecord {
  traceId: string; name: string; createdAt: string;
  summary: {
    totalMs: number | null; llmCalls: number; llmErrors: number; fallbacks: number; inputTokens: number; outputTokens: number; costUsd: number;
    errors: { span: string; error?: string }[]; steps: { name: string; kind: string; ms: number; status: string }[];
    workflow?: { step: string; ms: number; status: string }[];
    tools?: { name: string; initiator: string | null; ok: boolean; ms: number; error: string | null }[];
    guardrails?: string[]; retrieval?: { purpose: string | null; method: string | null; hits: number; ms: number }[];
    retries?: number; models?: string[];
    web?: { method: string | null; fromCache: boolean; pages: string[]; rejected: number; note: string | null }[];
  };
}

// ---- Đợt 3: bản đồ khái niệm (GraphRAG) ----
export type GraphRelType = "CAN_BIET_TRUOC" | "LIEN_QUAN";
export interface GraphConcept { key: string; name: string; description: string; aliases: string[]; pages: (number | null)[]; documentIds: string[] }
export interface GraphRel { from: string; to: string; fromName: string; toName: string; type: GraphRelType; evidence: { documentId: string; documentTitle: string; page: number | null; chunkId: string; quote: string } }
export interface GraphViewData { concepts: GraphConcept[]; relations: GraphRel[]; documents: { id: string; title: string; extractedPages: number }[] }
export interface GraphStatus { configured: boolean; connected: boolean; kind: string | null; error?: string; limits: { pagesPerBuild: number; buildsPerDay: number } }
export interface GraphBuildResult { processedPages: number; remainingPages: number; totalPages: number; concepts: number; relations: number; mentions: number; dropped: { relations: number; mentions: number; batches: number }; llmCalls: number; done: boolean }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: any) { super(code); }
}

/** Thông báo lỗi bằng lời người dùng hiểu được (không xin lỗi, nói rõ cần làm gì). */
export function explain(e: unknown): string {
  if (!(e instanceof ApiError)) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  const m: Record<string, string> = {
    unauthorized: "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.",
    session_quota_reached: `Đã dùng hết ${e.body?.limit ?? ""} phiên của hôm nay. Mai bạn quay lại nhé.`,
    input_too_long: `Tin nhắn dài quá ${e.body?.max ?? 3000} ký tự. Rút gọn hoặc tách làm hai.`,
    agent_unavailable: "MindMirror tạm thời chưa phản hồi được. Tin nhắn vẫn còn — bấm Gửi lại sau vài giây.",
    session_finished: "Phiên này đã kết thúc. Mở phiên mới để học tiếp.",
    document_not_found: "Có tài liệu đã bị xoá khỏi thư viện. Chọn lại tài liệu.",
    ingest_scanned_only: "File này chỉ có ảnh scan, chưa đọc được chữ. Thử bản PDF có thể chọn chữ.",
    ingest_too_large: "Tài liệu quá lớn (tối đa 400 trang). Tách thành nhiều file nhỏ hơn.",
    ingest_empty: "File không có nội dung chữ.",
    invalid_mcp_url: "Địa chỉ MCP không hợp lệ: cần https và không phải địa chỉ nội bộ.",
    mcp_unreachable: "Không kết nối được MCP server. Kiểm tra địa chỉ và token.",
    no_search_tool: "MCP server này không có công cụ tìm kiếm tài liệu.",
    connector_encryption_not_configured: "Máy chủ chưa đặt khoá mã hoá token (CONNECTOR_ENC_KEY).",
    folder_limit: "Đã đạt tối đa 50 thư mục.",
    folder_not_found: "Thư mục không còn tồn tại. Tải lại trang rồi thử lại.",
    goal_rejected: "Mục tiêu học có nội dung giống chỉ thị cho AI hoặc yêu cầu thông tin hệ thống. Hãy viết mục tiêu học tập của bạn, ví dụ: “Ôn thi cuối kỳ chương 4–6”.",
    graph_not_configured: "Máy chủ chưa kết nối Neo4j nên chưa tạo được bản đồ khái niệm.",
    graph_daily_limit: "Hôm nay bạn đã tạo bản đồ đủ số lần cho phép. Mai bạn bấm tiếp nhé.",
    graph_forbidden: "Có tài liệu không thuộc thư viện của bạn.",
    graph_graph_unavailable: "Chưa kết nối được cơ sở dữ liệu đồ thị. Thử lại sau ít phút.",
  };
  return m[e.code] ?? `Lỗi ${e.status}: ${e.code}`;
}

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) h.authorization = `Bearer ${data.session.access_token}`;
  } else h["x-dev-user"] = DEV_USER;
  return h;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method, headers: await headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data?.error ?? "error", data);
  return data as T;
}

export const api = {
  config: () => req<AppConfig>("GET", "/api/config"),
  createSession: (b: { mode: Mode; topic: string; goal?: string; self_confidence?: string | null; document_ids?: string[]; folder_id?: string }) => req<SessionView>("POST", "/api/sessions", b),
  listSessions: () => req<{ items: { id: string; mode: Mode; topic: string; phase: string; status: string; updatedAt: string }[] }>("GET", "/api/sessions"),
  getSession: (id: string) => req<SessionView>("GET", `/api/sessions/${id}`),
  turn: (id: string, b: { text: string; intent?: Intent | null; client_turn_id: string }) => req<TurnResult>("POST", `/api/sessions/${id}/turn`, b),
  finish: (id: string) => req<TurnResult>("POST", `/api/sessions/${id}/finish`, { client_turn_id: `finish-${id}` }),
  pause: (id: string) => req<{ status: string }>("POST", `/api/sessions/${id}/pause`, {}),
  assessment: (id: string) => req<Assessment>("GET", `/api/sessions/${id}/assessment`),
  traces: (id: string) => req<{ items: TraceRecord[] }>("GET", `/api/sessions/${id}/traces`),
  documents: () => req<{ items: LibraryDoc[] }>("GET", "/api/documents"),
  uploadDocument: (b: { title: string; kind: string; pages: { page: number | null; text: string }[] }) => req<{ document: LibraryDoc; duplicate: boolean }>("POST", "/api/documents", b),
  deleteDocument: (id: string) => req("DELETE", `/api/documents/${id}`),
  moveDocument: (id: string, folderId: string | null) => req<{ id: string; folderId: string | null }>("PATCH", `/api/documents/${id}`, { folder_id: folderId }),
  folders: () => req<{ items: Folder[] }>("GET", "/api/folders"),
  createFolder: (b: { name: string; color?: string; goal?: string | null }) => req<Folder>("POST", "/api/folders", b),
  updateFolder: (id: string, b: { name?: string; color?: string; goal?: string | null }) => req<Folder>("PATCH", `/api/folders/${id}`, b),
  deleteFolder: (id: string) => req("DELETE", `/api/folders/${id}`),
  connectors: () => req<{ items: Connector[] }>("GET", "/api/connectors"),
  addConnector: (b: { name: string; url: string; preset: string; token?: string }) => req<Connector>("POST", "/api/connectors", b),
  deleteConnector: (id: string) => req("DELETE", `/api/connectors/${id}`),
  connectorItems: (id: string, q: string) => req<{ items: { id: string; title: string; mimeType?: string | null }[] }>("GET", `/api/connectors/${id}/items?q=${encodeURIComponent(q)}`),
  importItems: (id: string, items: { id: string; title: string }[]) => req<{ results: { item: { id: string; title: string }; document?: LibraryDoc; error?: string }[] }>("POST", `/api/connectors/${id}/import`, { items }),
  settings: () => req<Settings>("GET", "/api/me/settings"),
  saveSettings: (s: Partial<Settings>) => req<Settings>("PATCH", "/api/me/settings", s),
  deleteData: (scope: "sessions" | "all") => req("DELETE", "/api/me/data", { scope, confirm: "XOA" }),
  graphStatus: () => req<GraphStatus>("GET", "/api/graph/status"),
  buildGraph: (documentIds: string[]) => req<GraphBuildResult>("POST", "/api/graph/build", { document_ids: documentIds }),
  graph: (documentIds: string[]) => req<GraphViewData>("GET", `/api/graph?document_ids=${documentIds.join(",")}`),
};

export const newTurnId = () => (crypto.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);
