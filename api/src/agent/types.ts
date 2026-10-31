// Kiểu dữ liệu lõi của Agent MindMirror.
// Nguyên tắc: state machine (code) quyết định "bước nào", LLM chỉ đề xuất "nói gì".

export type SessionMode = "explore" | "reunderstand";

export type Phase =
  | "entry"      // vừa tạo phiên, chưa có câu trả lời của người học
  | "baseline"   // đã ghi nhận cách hiểu ban đầu
  | "probe"      // hỏi sâu / khám phá
  | "repair"     // đang hỗ trợ một điểm vướng
  | "transfer"   // thử tình huống mới
  | "reflect"    // đủ bằng chứng, gợi ý tổng kết
  | "finished";

export type Action =
  | "ask_clarification"
  | "ask_explain"        // mời người học giải thích bằng lời mình
  | "ask_why"
  | "suggest_directions" // khám phá: đề xuất 2–4 hướng
  | "give_hint"
  | "explain_foundation"
  | "give_example"
  | "transfer_question"
  | "show_answer"
  | "acknowledge"        // ghi nhận + câu hỏi tiếp theo nhẹ nhàng
  | "summarize";

// Ý định do nút bấm trên UI gửi lên (frontend KHÔNG gửi action trực tiếp).
export type UserIntent =
  | "hint"           // Gợi ý
  | "show_answer"    // Giải thích luôn / Đáp án
  | "explain_more"   // Giải thích rõ hơn
  | "give_example"   // Cho ví dụ
  | "try"            // Tớ muốn thử
  | "skip"           // Bỏ qua
  | "change_topic"   // Đổi chủ đề
  | "switch_mode"    // Đổi chế độ
  | "finish";        // Kết thúc

export type EvidenceStatus = "observed" | "unclear" | "contradicted";

export interface Evidence {
  id: string;
  messageId: string;
  criterion: string;     // vd "where_vs_having" hoặc mô tả ngắn
  claim: string;         // điều quan sát được
  quote: string;         // trích nguyên văn từ lời người học (đã xác thực)
  status: EvidenceStatus;
  assisted: boolean;     // xuất hiện SAU khi đã nhận hỗ trợ?
  supportLevelAtTime: number;
  criterionId: string | null;        // tiêu chí rubric (bám tài liệu) mà bằng chứng này thuộc về
  sourceCitation: Citation | null;   // đoạn tài liệu làm căn cứ cho phán đoán (đã xác thực)
  context: "explain" | "transfer" | "other"; // trả lời cho câu tự giải thích hay câu vận dụng mới
  createdAt: string;
}

export type GapStatus = "open" | "resolved_after_support" | "resolved" | "skipped";

export interface Gap {
  id: string;
  concept: string;
  status: GapStatus;
  supportLevel: number;  // mức hỗ trợ cao nhất đã dùng cho gap này
}

// ---------- RAG ----------
export type DocumentKind = "pdf" | "slides" | "text" | "mcp";

export interface LibraryDocument {
  id: string;
  userId: string;
  title: string;
  kind: DocumentKind;
  origin: { connectorId: string; externalId: string; url?: string | null } | null;
  pageCount: number;
  chunkCount: number;
  embedded: boolean;           // false = chỉ tìm kiếm từ khoá (chưa có embedding)
  contentHash: string;
  warnings: string[];          // vd "scanned_pages:3,7", "suspicious_instructions"
  createdAt: string;
  folderId?: string | null;    // thư mục (My Folder), null = chưa xếp
}

export interface Chunk {
  id: string;
  documentId: string;
  userId: string;
  ordinal: number;
  page: number | null;
  heading: string | null;
  text: string;
  searchText: string;          // văn bản đã chuẩn hoá cho tìm kiếm từ khoá
  embedding: number[] | null;
  suspicious: boolean;         // có câu dạng "chỉ thị" (nghi prompt injection)
}

export interface RetrievedChunk {
  chunk: Chunk;
  documentTitle: string;
  score: number;
  lexicalRank: number | null;
  vectorRank: number | null;
}

/** Trích dẫn đã được backend kiểm chứng: quote có thật trong đoạn tài liệu. */
export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  page: number | null;
  quote: string;
}

/** Tiêu chí kiểm tra rút ra TỪ tài liệu (không phải câu hỏi chung chung). */
export interface Criterion {
  id: string;             // "C1", "C2"...
  concept: string;        // vd "Dạng chuẩn 2 (2NF)"
  expectation: string;    // người học cần thể hiện điều gì
  citation: Citation;     // căn cứ trong tài liệu
}

export interface UserSettings {
  aiStyle: "friendly" | "concise" | "academic";
  supportPreference: "socratic_first" | "direct" | "flexible";
  challengeLevel: "gentle" | "balanced" | "deep";
  selfAssessment: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  aiStyle: "friendly",
  supportPreference: "socratic_first",
  challengeLevel: "balanced",
  selfAssessment: true,
};

export interface LearningState {
  mode: SessionMode;
  phase: Phase;
  topic: string;
  goal: string | null;
  currentGapId: string | null;
  hintLevel: 0 | 1 | 2 | 3;
  roundOnSameGap: number;
  supportCount: number;          // tổng số lần đã hỗ trợ (hint/ví dụ/nền/đáp án)
  answerShown: boolean;
  turnCount: number;             // số lượt người dùng đã gửi
  agentLedRounds: number;        // số vòng agent tự dẫn dắt liên tiếp
  selfConfidence: "unsure" | "somewhat" | "confident" | null;
  summary: string;               // short memory do hệ thống quản lý
  pendingModeSuggestion: SessionMode | null;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  action: Action | null;
  intent: UserIntent | null;
  citations?: Citation[];
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  status: "active" | "paused" | "finished";
  state: LearningState;
  gaps: Gap[];
  evidence: Evidence[];
  messages: Message[];
  documentIds: string[];   // tài liệu (upload hoặc MCP) gắn với phiên
  rubric: Criterion[];     // kế hoạch kiểm tra bám tài liệu
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
}

export interface MirrorCardItem {
  text: string;
  evidenceIds: string[];
  assisted: boolean;
}

export interface MirrorCard {
  topic: string;
  mode: SessionMode;
  initialThought: string | null;     // trích lời người học ở lần giải thích đầu
  demonstrated: MirrorCardItem[];
  changed: string | null;
  unresolved: string[];
  nextStep: string;
  insufficientEvidence: boolean;
  conceptStatus: { concept: string; status: "demonstrated" | "needs_practice" | "insufficient_evidence" }[];
  assessment: LearnerAssessment;
  generatedBy: "model" | "rules";
}

// ---------- Learner Assessment (sản phẩm đánh giá NGƯỜI HỌC) ----------
// Khác Agent Evals (đánh giá chính AI) — xem eval/ và scripts/eval.ts.
export type CriterionStatus =
  | "demonstrated_independent"     // tự thể hiện đúng, chưa nhận hỗ trợ
  | "demonstrated_with_support"    // đúng sau gợi ý/ví dụ/đáp án
  | "needs_practice"               // có bằng chứng nhầm/thiếu, chưa sửa được
  | "insufficient_evidence";       // chưa đủ căn cứ để nói gì

export interface CriterionAssessment {
  criterionId: string | null;
  concept: string;
  status: CriterionStatus;
  applied: boolean;              // đã đúng ở câu vận dụng (transfer) hay chưa
  evidenceIds: string[];
  sourceCitation: Citation | null;
}

export interface LearnerAssessment {
  grounded: boolean;             // có dựa trên tài liệu của người học không
  criteria: CriterionAssessment[];
  counts: Record<CriterionStatus, number>;
  note: string;                  // luôn nhắc: quan sát trong phiên, không phải điểm năng lực
}

export interface TurnResult {
  turnId: string;
  phase: Phase;
  action: Action | "pause" | "skip" | "switch_mode" | "limit_reached" | "finish";
  assistantText: string;
  hintLevel: number;
  gaps: Gap[];
  newEvidence: Evidence[];
  suggestModeSwitch: SessionMode | null;
  quickReplies: UserIntent[];
  isFinished: boolean;
  card?: MirrorCard;
  citations: Citation[];
  traceId: string | null;
  modelInfo: { provider: string; model: string } | null;
}
