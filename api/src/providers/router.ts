import { type LLMProvider, type LLMRequest, type LLMResponse, ProviderError } from "./types";
import type { SpanHandle } from "../obs/tracer";
import { costUsd, DEFAULT_PRICES, type PriceTable } from "../obs/pricing";

export interface RouterOptions {
  timeoutMs?: number;          // mặc định 25s
  maxRetryAfterSec?: number;   // 429: chỉ chờ nếu Retry-After ≤ ngưỡng này, ngược lại fallback ngay
  sleep?: (ms: number) => Promise<void>;
  onCall?: (info: CallLog) => void; // ghi metadata (không ghi prompt)
  prices?: PriceTable;
}

export interface CallLog {
  provider: string;
  model: string;
  status: "ok" | "error";
  httpStatus?: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  fallback: boolean;
  costUsd: number;
}

/**
 * Chính sách (theo tài liệu kỹ thuật, Phần 07):
 *  - 429: đọc Retry-After; nếu ngắn thì chờ 1 lần, sau đó chuyển fallback. Không retry dây chuyền.
 *  - 5xx/timeout: 1 lần retry có jitter, sau đó fallback.
 *  - 401/403: lỗi cấu hình → ném luôn, KHÔNG fallback (tránh che lỗi key).
 *  - Không gọi song song 2 model.
 */
export class ModelRouter {
  constructor(
    private primary: LLMProvider,
    private fallback: LLMProvider | null,
    private opts: RouterOptions = {},
  ) {}

  /** parent: span cha trong trace — mỗi lần thử (retry/fallback) thành 1 generation span. */
  async generate(req: LLMRequest, parent?: SpanHandle | null): Promise<LLMResponse> {
    try {
      return await this.tryWithRetry(this.primary, req, false, parent ?? null);
    } catch (e) {
      if (!(e instanceof ProviderError) || e.kind === "auth" || e.kind === "bad_request" || !this.fallback) throw e;
      return await this.call(this.fallback, req, true, parent ?? null, 1);
    }
  }

  private async tryWithRetry(p: LLMProvider, req: LLMRequest, isFallback: boolean, parent: SpanHandle | null): Promise<LLMResponse> {
    try {
      return await this.call(p, req, isFallback, parent, 1);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      const sleep = this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      if (e.kind === "rate_limit") {
        const ra = e.retryAfterSec;
        if (ra !== null && ra <= (this.opts.maxRetryAfterSec ?? 2)) {
          await sleep(ra * 1000);
          return await this.call(p, req, isFallback, parent, 2);
        }
        throw e;
      }
      if (e.kind === "server" || e.kind === "timeout") {
        await sleep(300 + Math.floor(Math.random() * 400));
        return await this.call(p, req, isFallback, parent, 2);
      }
      throw e;
    }
  }

  private async call(p: LLMProvider, req: LLMRequest, isFallback: boolean, parent: SpanHandle | null, attempt: number): Promise<LLMResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 25_000);
    const t0 = Date.now();
    const span = parent?.child(`llm.${p.provider}`, "generation", { attempt, fallback: isFallback, purpose: req.purpose ?? "turn" });
    try {
      const res = await p.generateJSON(req, ctrl.signal);
      const cost = costUsd(res.model, res.usage.inputTokens, res.usage.outputTokens, this.opts.prices ?? DEFAULT_PRICES);
      span?.gen({ model: res.model, provider: res.provider, usage: { input: res.usage.inputTokens, output: res.usage.outputTokens }, costUsd: cost })
        .set({ latency_ms: res.latencyMs });
      this.opts.onCall?.({
        provider: res.provider, model: res.model, status: "ok", latencyMs: res.latencyMs,
        inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, fallback: isFallback, costUsd: cost,
      });
      return res;
    } catch (e) {
      const err =
        e instanceof ProviderError
          ? e
          : (e as Error)?.name === "AbortError"
            ? new ProviderError("timeout", 408, p.provider)
            : new ProviderError("network error", 0, p.provider);
      span?.gen({ model: p.model, provider: p.provider, usage: { input: 0, output: 0 } }).set({ http_status: err.status, error_kind: err.kind }).fail(err);
      this.opts.onCall?.({
        provider: p.provider, model: p.model, status: "error", httpStatus: err.status,
        latencyMs: Date.now() - t0, inputTokens: 0, outputTokens: 0, fallback: isFallback, costUsd: 0,
      });
      throw err;
    } finally {
      clearTimeout(timer);
      span?.end();
    }
  }
}
