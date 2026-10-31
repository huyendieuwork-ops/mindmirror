import { ProviderError } from "../providers/types";

export type EmbedTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(texts: string[], task: EmbedTask): Promise<number[][]>;
}

/**
 * Gemini embeddings (batchEmbedContents), đi qua AI Gateway nếu có cấu hình.
 * outputDimensionality = 768 để khớp cột vector(768) trong Postgres.
 */
export class GeminiEmbedder implements Embedder {
  readonly dims: number;
  constructor(
    private cfg: {
      apiKey: string; model: string; dims?: number; apiVersion?: string;
      gateway?: { accountId: string; gatewayId: string; token?: string }; fetchImpl?: typeof fetch;
    },
  ) {
    this.dims = cfg.dims ?? 768;
  }
  get model() { return this.cfg.model; }

  async embed(texts: string[], task: EmbedTask): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) out.push(...(await this.batch(texts.slice(i, i + 64), task)));
    return out;
  }

  private async batch(texts: string[], task: EmbedTask): Promise<number[][]> {
    const v = this.cfg.apiVersion ?? "v1beta";
    const path = `${v}/models/${this.cfg.model}:batchEmbedContents`;
    const g = this.cfg.gateway;
    const url = g
      ? `https://gateway.ai.cloudflare.com/v1/${g.accountId}/${g.gatewayId}/google-ai-studio/${path}`
      : `https://generativelanguage.googleapis.com/${path}`;
    const headers: Record<string, string> = { "content-type": "application/json", "x-goog-api-key": (this.cfg.apiKey ?? "").replace(/[^\x21-\x7E]/g, "") };
    if (g) {
      headers["cf-aig-collect-log"] = "false";
      if (g.token) headers["cf-aig-authorization"] = `Bearer ${g.token}`;
    }
    const r = await (this.cfg.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: `models/${this.cfg.model}`,
          content: { parts: [{ text: t.slice(0, 8000) }] },
          taskType: task,
          outputDimensionality: this.dims,
        })),
      }),
    });
    if (!r.ok) {
      let reason = "";
      try { const e: any = await r.clone().json(); reason = e?.error?.details?.find((d: any) => d?.reason)?.reason ?? e?.error?.status ?? ""; } catch {}
      throw new ProviderError(`Embed HTTP ${r.status}${reason ? " " + reason : ""}`, r.status, "google-ai-studio");
    }
    const data: any = await r.json();
    return (data.embeddings ?? []).map((e: any) => normalize(e.values as number[]));
  }
}

/** Chuẩn hoá L2 (khi giảm chiều, vector Gemini không còn đơn vị). */
export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
