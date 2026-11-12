import type { Chunk, LibraryDocument, MirrorCard, RetrievedChunk, Session, TurnResult, UserSettings } from "../agent/types";
import type { WebPassage } from "../web/search";

export interface SessionListItem {
  id: string;
  mode: Session["state"]["mode"];
  topic: string;
  phase: Session["state"]["phase"];
  status: Session["status"];
  updatedAt: string;
}

export interface UsageEntry {
  userId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  status: "ok" | "error";
  httpStatus?: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  fallback: boolean;
  costUsd?: number;
}

/** Kết nối MCP của người dùng. Token luôn được mã hoá (AES-GCM) trước khi lưu. */
export interface ConnectorRecord {
  id: string;
  userId: string;
  name: string;
  url: string;
  preset: "google_drive" | "notion" | "generic";
  tokenEnc: string | null;
  tools: { search: string; fetch: string; queryArg: string; idArg: string; fetchMode: "tool" | "resource" };
  createdAt: string;
}

/** Thư mục tài liệu (My Folder). */
export interface FolderRecord {
  id: string;
  userId: string;
  name: string;
  color: string;
  /** Mục tiêu học do người học đặt (≤ 500 ký tự), null = chưa đặt. Đưa vào prompt như DỮ LIỆU, không phải chỉ thị. */
  goal?: string | null;
  createdAt: string;
}

/** Ghi chú cá nhân của người học (trợ lý ghi chú ở chân trang). */
export interface NoteRecord {
  id: string;
  userId: string;
  title: string;   // ≤ 120 ký tự
  body: string;    // ≤ 20.000 ký tự, văn bản thuần (xuống dòng giữ nguyên)
  createdAt: string;
  updatedAt: string;
}

export interface TraceRecord {
  traceId: string;
  userId: string | null;
  sessionId: string | null;
  name: string;
  summary: unknown;          // Trace.summary(): token, chi phí, độ trễ từng bước, lỗi — KHÔNG có nội dung học
  createdAt: string;
}

export interface ChunkQuery {
  text: string;
  embedding: number[] | null;
}

/**
 * Lớp lưu trữ. MỌI hàm đọc/ghi đều nhận userId và phải lọc theo owner
 * (backend dùng service role nên KHÔNG được dựa vào RLS).
 */
export interface Store {
  createSession(s: Session): Promise<void>;
  getSession(id: string, userId: string): Promise<Session | null>;
  listSessions(userId: string, limit: number): Promise<SessionListItem[]>;
  saveSession(s: Session): Promise<void>;
  saveCard(sessionId: string, userId: string, card: MirrorCard): Promise<void>;
  getCard(sessionId: string, userId: string): Promise<MirrorCard | null>;
  /** Đọc nhiều phiên một lượt cho trang Tiến độ (không kèm tin nhắn để nhẹ). Bỏ qua id không thuộc userId. */
  getSessionSummaries?(ids: string[], userId: string): Promise<{ session: Session; card: MirrorCard | null }[]>;
  getTurnResult(sessionId: string, clientTurnId: string): Promise<TurnResult | null>;
  saveTurnResult(sessionId: string, clientTurnId: string, r: TurnResult): Promise<void>;
  countSessionsSince(userId: string, sinceIso: string): Promise<number>;
  getSettings(userId: string): Promise<UserSettings | null>;
  saveSettings(userId: string, s: UserSettings): Promise<void>;
  logUsage(e: UsageEntry): Promise<void>;
  deleteUserData(userId: string, scope: "sessions" | "all"): Promise<void>;

  // ---- Thư viện tài liệu (RAG) ----
  saveDocument(doc: LibraryDocument, chunks: Chunk[]): Promise<void>;
  listDocuments(userId: string): Promise<LibraryDocument[]>;
  getDocuments(userId: string, ids: string[]): Promise<LibraryDocument[]>;
  findDocumentByHash(userId: string, hash: string): Promise<LibraryDocument | null>;
  deleteDocument(userId: string, id: string): Promise<boolean>;

  // ---- Thư mục (tuỳ chọn: store cũ/test không cần cài) ----
  listFolders?(userId: string): Promise<FolderRecord[]>;
  saveFolder?(f: FolderRecord): Promise<void>;
  deleteFolder?(userId: string, id: string): Promise<boolean>;
  setDocumentFolder?(userId: string, documentId: string, folderId: string | null): Promise<boolean>;

  // ---- Ghi chú (tuỳ chọn) ----
  listNotes?(userId: string): Promise<NoteRecord[]>;
  saveNote?(n: NoteRecord): Promise<void>;
  deleteNote?(userId: string, id: string): Promise<boolean>;
  /** Lấy đúng các đoạn theo id (chỉ của userId) — dùng để luôn gửi kèm đoạn tài liệu gắn với tiêu chí đang chấm. */
  getChunks?(userId: string, ids: string[]): Promise<RetrievedChunk[]>;
  /** Mọi đoạn của MỘT tài liệu (chỉ của userId), theo thứ tự — dùng khi dựng đồ thị khái niệm. */
  listChunks?(userId: string, documentId: string): Promise<Chunk[]>;
  /** Đợt 3: đếm/ghi lượt dựng đồ thị (giới hạn theo ngày để giữ hạn mức Gemini). */
  countGraphBuildsSince?(userId: string, sinceIso: string): Promise<number>;
  logGraphBuild?(userId: string, atIso: string, pages: number): Promise<void>;
  /** Tìm kiếm lai (từ khoá + vector) CHỈ trong tài liệu của userId. */
  searchChunks(userId: string, documentIds: string[], q: ChunkQuery, k: number): Promise<RetrievedChunk[]>;

  // ---- Nguồn web chính thống (Đợt 2, tuỳ chọn) ----
  /** Kết quả đã kiểm tra còn hạn cho khoá băm (dùng chung mọi người dùng — nội dung công khai). */
  getWebCache?(key: string, nowIso: string): Promise<WebPassage[] | null>;
  putWebCache?(key: string, passages: WebPassage[], fetchedAtIso: string, expiresAtIso: string): Promise<void>;
  /** Số lượt gọi dịch vụ tìm kiếm ngoài của người dùng từ thời điểm sinceIso (hạn mức theo ngày). */
  countWebSearchesSince?(userId: string, sinceIso: string): Promise<number>;
  logWebSearch?(userId: string, atIso: string): Promise<void>;

  // ---- MCP connectors ----
  saveConnector(c: ConnectorRecord): Promise<void>;
  listConnectors(userId: string): Promise<ConnectorRecord[]>;
  getConnector(userId: string, id: string): Promise<ConnectorRecord | null>;
  deleteConnector(userId: string, id: string): Promise<void>;

  // ---- Observability ----
  saveTrace(t: TraceRecord): Promise<void>;
  listTraces(userId: string, sessionId: string): Promise<TraceRecord[]>;
}
