export interface LLMRequest {
  system: string;
  user: string;
  /** Gợi ý độ dài output; provider có thể bỏ qua. */
  maxOutputTokens?: number;
  temperature?: number;
  /** Nhãn mục đích để trace/eval: turn | plan | card | summary | judge */
  purpose?: string;
  /** Tool calling (native): khai báo công cụ model ĐƯỢC PHÉP gọi ở lượt này. */
  tools?: ToolDeclaration[];
  /** Vòng trao đổi tool trước đó (model đã gọi → backend đã chạy) để model viết câu trả lời cuối. */
  toolExchanges?: ToolExchange[];
  /** AUTO: model tự quyết; NONE: cấm gọi thêm (vòng cuối, buộc trả lời). */
  toolMode?: "AUTO" | "NONE";
}

/** Khai báo công cụ theo JSON Schema (tập con OpenAPI mà Gemini/OpenAI đều hiểu). */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolExchange {
  calls: ToolCall[];
  /** Phần trả lời thô của model (giữ nguyên thought signature của Gemini 3 khi gửi lại). */
  rawModelParts?: unknown[];
  results: { name: string; id?: string; response: unknown }[];
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  text: string;
  usage: LLMUsage;
  provider: string;
  model: string;
  latencyMs: number;
  /** Model yêu cầu gọi công cụ thay vì trả lời ngay (text có thể rỗng). */
  toolCalls?: ToolCall[];
  rawModelParts?: unknown[];
  /** Model dừng vì hết maxOutputTokens (Groq finish_reason=length, Gemini MAX_TOKENS) — JSON có thể bị cắt cụt. */
  truncated?: boolean;
}

export interface LLMProvider {
  readonly provider: string;
  readonly model: string;
  /** true nếu provider hiểu req.tools (function calling native). */
  readonly supportsTools?: boolean;
  generateJSON(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
}

/** Lỗi từ nhà cung cấp, mang mã HTTP để router quyết định retry/fallback. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get kind(): "rate_limit" | "server" | "auth" | "bad_request" | "timeout" {
    if (this.status === 429) return "rate_limit";
    if (this.status === 401 || this.status === 403) return "auth";
    if (this.status === 408 || this.status === 0) return "timeout";
    if (this.status >= 500) return "server";
    return "bad_request";
  }
}

export function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}
