import { type LLMProvider, type LLMRequest, type LLMResponse, ProviderError, parseRetryAfter } from "./types";

/**
 * Nhà cung cấp dùng chuẩn Chat Completions của OpenAI (Cerebras, Mistral, DeepSeek, OpenRouter…).
 * Dùng làm mô hình DỰ PHÒNG khi Gemini quá tải; không gọi công cụ (router tự bỏ tools).
 */
export interface OpenAICompatConfig {
  provider: string;              // tên ghi vào nhật ký/trace, vd "cerebras"
  baseUrl: string;               // vd "https://api.cerebras.ai/v1"
  apiKey: string;
  model: string;
  /** Tên tham số trần token đầu ra: Cerebras/OpenAI dùng max_completion_tokens, Mistral dùng max_tokens. */
  maxTokensParam?: "max_completion_tokens" | "max_tokens";
  fetchImpl?: typeof fetch;
}

export const PRESETS: Record<string, { baseUrl: string; model: string; maxTokensParam: "max_completion_tokens" | "max_tokens" }> = {
  cerebras: { baseUrl: "https://api.cerebras.ai/v1", model: "gpt-oss-120b", maxTokensParam: "max_completion_tokens" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", maxTokensParam: "max_tokens" },
};

export class OpenAICompatProvider implements LLMProvider {
  constructor(private cfg: OpenAICompatConfig) {}
  get provider() { return this.cfg.provider; }
  get model() { return this.cfg.model; }
  url() { return `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`; }

  async generateJSON(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const t0 = Date.now();
    const f = this.cfg.fetchImpl ?? fetch;
    const r = await f(this.url(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
      signal,
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: "system", content: req.system + "\nReturn valid JSON only." },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_object" },
        temperature: req.temperature ?? 0.4,
        [this.cfg.maxTokensParam ?? "max_completion_tokens"]: req.maxOutputTokens ?? 1024,
        // gpt-oss là model suy luận: token suy luận ăn chung trần → giảm khi trích xuất đồ thị (cần nhiều chữ ra).
        ...(/gpt-oss/.test(this.cfg.model) && req.purpose === "graph_extract" ? { reasoning_effort: "low" } : {}),
      }),
    });
    if (!r.ok) {
      throw new ProviderError(`${this.cfg.provider} HTTP ${r.status}`, r.status, this.cfg.provider, parseRetryAfter(r.headers.get("retry-after")));
    }
    const data: any = await r.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    if (!text) throw new ProviderError(`${this.cfg.provider} empty response`, 502, this.cfg.provider);
    return {
      text,
      provider: this.cfg.provider,
      model: this.cfg.model,
      latencyMs: Date.now() - t0,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      ...(data.choices?.[0]?.finish_reason === "length" ? { truncated: true } : {}),
    };
  }
}
