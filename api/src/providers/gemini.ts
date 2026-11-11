import { type LLMProvider, type LLMRequest, type LLMResponse, ProviderError, parseRetryAfter } from "./types";

/** Seed cố định cho các lời gọi temperature 0 (chấm điểm) — giảm dao động nhãn giữa các lần chạy. */
export const GRADING_SEED = 20261111;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  apiVersion?: string; // "v1beta" mặc định
  /** Nếu có: gọi qua Cloudflare AI Gateway (provider-native). */
  gateway?: { accountId: string; gatewayId: string; token?: string };
  fetchImpl?: typeof fetch;
}

export class GeminiProvider implements LLMProvider {
  readonly supportsTools = true;
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

  /**
   * Request body. Khi có tools: dùng function calling native của Gemini; KHÔNG đặt responseMimeType JSON
   * (Gemini không cho dùng chung) — prompt vẫn yêu cầu JSON và extractJson() bóc ra.
   * Vòng trả kết quả tool gửi lại nguyên parts của model (giữ thoughtSignature của Gemini 3).
   */
  body(req: LLMRequest): Record<string, unknown> {
    const contents: unknown[] = [{ role: "user", parts: [{ text: req.user }] }];
    for (const ex of req.toolExchanges ?? []) {
      contents.push({ role: "model", parts: ex.rawModelParts ?? ex.calls.map((c) => ({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } })) });
      contents.push({ role: "user", parts: ex.results.map((r) => ({ functionResponse: { name: r.name, ...(r.id ? { id: r.id } : {}), response: { result: r.response } } })) });
    }
    const hasTools = !!req.tools?.length;
    return {
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      ...(hasTools ? { tools: [{ functionDeclarations: req.tools }], toolConfig: { functionCallingConfig: { mode: req.toolMode ?? "AUTO" } } } : {}),
      generationConfig: {
        ...(hasTools ? {} : { responseMimeType: "application/json" }),
        temperature: req.temperature ?? 0.4,
        // Bước cần ổn định (chấm điểm, temperature 0): cố định seed để cùng đầu vào cho cùng nhãn nhiều nhất có thể.
        ...(req.temperature === 0 ? { seed: GRADING_SEED } : {}),
        maxOutputTokens: req.maxOutputTokens ?? 1024,
      },
    };
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
      body: JSON.stringify(this.body(req)),
    });
    if (!r.ok) {
      // Không đẩy body lỗi (có thể chứa prompt) ra ngoài.
      // Chỉ lấy mã lý do của Google (vd API_KEY_INVALID), không lấy nội dung.
      let reason = "";
      try { const e: any = await r.clone().json(); reason = e?.error?.details?.find((d: any) => d?.reason)?.reason ?? e?.error?.status ?? ""; if (e?.error?.status === "FAILED_PRECONDITION") reason += ": " + String(e?.error?.message ?? "").slice(0, 120); } catch {}
      throw new ProviderError(`Gemini HTTP ${r.status}${reason ? " " + reason : ""}`, r.status, this.provider, parseRetryAfter(r.headers.get("retry-after")));
    }
    const obj: any = await r.json();
    const parts: any[] = obj.candidates?.[0]?.content?.parts ?? [];
    const text: string = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    const toolCalls = parts
      .filter((p) => p.functionCall?.name)
      .map((p) => ({ id: p.functionCall.id, name: String(p.functionCall.name), args: (p.functionCall.args ?? {}) as Record<string, unknown> }));
    if (!text && !toolCalls.length) throw new ProviderError("Gemini empty response", 502, this.provider);
    return {
      text,
      ...(toolCalls.length ? { toolCalls, rawModelParts: parts } : {}),
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
