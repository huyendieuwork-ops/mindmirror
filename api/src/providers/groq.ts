import { type LLMProvider, type LLMRequest, type LLMResponse, ProviderError, parseRetryAfter } from "./types";

export interface GroqConfig {
  apiKey: string;
  model: string; // vd "openai/gpt-oss-120b"
  gateway?: { accountId: string; gatewayId: string; token?: string };
  fetchImpl?: typeof fetch;
}

export class GroqProvider implements LLMProvider {
  readonly provider = "groq";
  constructor(private cfg: GroqConfig) {}
  get model() {
    return this.cfg.model;
  }

  url(): string {
    const g = this.cfg.gateway;
    return g
      ? `https://gateway.ai.cloudflare.com/v1/${g.accountId}/${g.gatewayId}/groq/chat/completions`
      : "https://api.groq.com/openai/v1/chat/completions";
  }

  async generateJSON(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      Authorization: `Bearer ${this.cfg.apiKey}`,
    };
    if (this.cfg.gateway) {
      headers["cf-aig-collect-log"] = "false";
      if (this.cfg.gateway.token) headers["cf-aig-authorization"] = `Bearer ${this.cfg.gateway.token}`;
    }
    const t0 = Date.now();
    const f = this.cfg.fetchImpl ?? fetch;
    const r = await f(this.url(), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [
          { role: "system", content: req.system + "\nReturn valid JSON only." },
          { role: "user", content: req.user },
        ],
        response_format: { type: "json_object" },
        temperature: req.temperature ?? 0.4,
        max_completion_tokens: req.maxOutputTokens ?? 1024,
        // gpt-oss là model suy luận: token suy luận ăn chung ngân sách max_completion_tokens. Trích xuất đồ thị cần
        // nhiều chữ ra, ít suy luận → đặt "low" để JSON không bị cắt cụt giữa chừng.
        ...(/gpt-oss/.test(this.cfg.model) && req.purpose === "graph_extract" ? { reasoning_effort: "low" } : {}),
      }),
    });
    if (!r.ok) {
      throw new ProviderError(`Groq HTTP ${r.status}`, r.status, this.provider, parseRetryAfter(r.headers.get("retry-after")));
    }
    const data: any = await r.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    if (!text) throw new ProviderError("Groq empty response", 502, this.provider);
    return {
      text,
      provider: this.provider,
      model: this.cfg.model,
      latencyMs: Date.now() - t0,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      ...(data.choices?.[0]?.finish_reason === "length" ? { truncated: true } : {}),
    };
  }
}
