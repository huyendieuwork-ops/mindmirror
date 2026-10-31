import { type LLMProvider, type LLMRequest, type LLMResponse, ProviderError, parseRetryAfter } from "./types";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  apiVersion?: string; // "v1beta" mặc định
  /** Nếu có: gọi qua Cloudflare AI Gateway (provider-native). */
  gateway?: { accountId: string; gatewayId: string; token?: string };
  fetchImpl?: typeof fetch;
}

export class GeminiProvider implements LLMProvider {
  readonly provider = "google-ai-studio";
  constructor(private cfg: GeminiConfig) {
    // Bỏ ký tự vô hình dính khi copy-paste API key.
    this.cfg = { ...cfg, apiKey: (cfg.apiKey ?? "").replace(/[^\x21-\x7E]/g, "") };
  }
  get model() {
    return this.cfg.model;
  }

  url(): string {
    const v = this.cfg.apiVersion ?? "v1beta";
    const path = `${v}/models/${this.cfg.model}:generateContent`;
    const g = this.cfg.gateway;
    return g
      ? `https://gateway.ai.cloudflare.com/v1/${g.accountId}/${g.gatewayId}/google-ai-studio/${path}`
      : `https://generativelanguage.googleapis.com/${path}`;
  }

  async generateJSON(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-goog-api-key": this.cfg.apiKey,
    };
    if (this.cfg.gateway) {
      headers["cf-aig-collect-log"] = "false"; // không log nội dung học tập
      if (this.cfg.gateway.token) headers["cf-aig-authorization"] = `Bearer ${this.cfg.gateway.token}`;
    }
    const t0 = Date.now();
    const f = this.cfg.fetchImpl ?? fetch;
    const r = await f(this.url(), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: req.temperature ?? 0.4,
          maxOutputTokens: req.maxOutputTokens ?? 1024,
        },
      }),
    });
    if (!r.ok) {
      // Không đẩy body lỗi (có thể chứa prompt) ra ngoài.
      // Chỉ lấy mã lý do của Google (vd API_KEY_INVALID), không lấy nội dung.
      let reason = "";
      try { const e: any = await r.clone().json(); reason = e?.error?.details?.find((d: any) => d?.reason)?.reason ?? e?.error?.status ?? ""; if (e?.error?.status === "FAILED_PRECONDITION") reason += ": " + String(e?.error?.message ?? "").slice(0, 120); } catch {}
      throw new ProviderError(`Gemini HTTP ${r.status}${reason ? " " + reason : ""}`, r.status, this.provider, parseRetryAfter(r.headers.get("retry-after")));
    }
    const obj: any = await r.json();
    const text: string =
      obj.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    if (!text) throw new ProviderError("Gemini empty response", 502, this.provider);
    return {
      text,
      provider: this.provider,
      model: this.cfg.model,
      latencyMs: Date.now() - t0,
      usage: {
        inputTokens: obj.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: obj.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
