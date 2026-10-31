export interface LLMRequest {
  system: string;
  user: string;
  /** Gợi ý độ dài output; provider có thể bỏ qua. */
  maxOutputTokens?: number;
  temperature?: number;
  /** Nhãn mục đích để trace/eval: turn | plan | card | summary | judge */
  purpose?: string;
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
}

export interface LLMProvider {
  readonly provider: string;
  readonly model: string;
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
