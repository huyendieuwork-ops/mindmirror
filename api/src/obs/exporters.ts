import type { SpanData, TraceData, TraceExporter } from "./tracer";

const b64 = (s: string) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64"));

/**
 * Langfuse — Ingestion API (POST /api/public/ingestion, Basic auth publicKey:secretKey).
 * span → "span-create", generation → "generation-create" (có model, token, chi phí).
 */
export class LangfuseExporter implements TraceExporter {
  readonly name = "langfuse";
  constructor(private cfg: { publicKey: string; secretKey: string; host?: string; release?: string; fetchImpl?: typeof fetch }) {}

  toBatch(t: TraceData) {
    const ts = new Date().toISOString();
    const batch: any[] = [{
      id: crypto.randomUUID(), timestamp: ts, type: "trace-create",
      body: {
        id: t.id, name: t.name, userId: t.userId, sessionId: t.sessionId, tags: t.tags,
        timestamp: t.startTime, metadata: t.metadata, release: this.cfg.release,
      },
    }];
    for (const s of t.spans) {
      const common = {
        id: s.id, traceId: t.id, parentObservationId: s.parentId, name: s.name,
        startTime: s.startTime, endTime: s.endTime, input: s.input, output: s.output,
        metadata: { kind: s.kind, ...s.attrs },
        level: s.status === "error" ? "ERROR" : "DEFAULT", statusMessage: s.error,
      };
      batch.push(
        s.kind === "generation"
          ? {
              id: crypto.randomUUID(), timestamp: ts, type: "generation-create",
              body: {
                ...common, model: s.model,
                usageDetails: s.usage ? { input: s.usage.input, output: s.usage.output } : undefined,
                costDetails: s.costUsd !== undefined ? { total: s.costUsd } : undefined,
              },
            }
          : { id: crypto.randomUUID(), timestamp: ts, type: "span-create", body: common },
      );
    }
    return { batch };
  }

  async export(t: TraceData) {
    const host = (this.cfg.host ?? "https://cloud.langfuse.com").replace(/\/$/, "");
    const r = await (this.cfg.fetchImpl ?? fetch)(`${host}/api/public/ingestion`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${b64(`${this.cfg.publicKey}:${this.cfg.secretKey}`)}` },
      body: JSON.stringify(this.toBatch(t)),
    });
    if (!r.ok && r.status !== 207) throw new Error(`Langfuse HTTP ${r.status}`);
  }
}

/**
 * LangSmith — POST /runs/batch (header x-api-key). Mỗi trace = 1 run gốc (id = trace id),
 * span → run con; dotted_order theo định dạng LangSmith.
 */
export class LangSmithExporter implements TraceExporter {
  readonly name = "langsmith";
  constructor(private cfg: { apiKey: string; project?: string; endpoint?: string; fetchImpl?: typeof fetch }) {}

  toBatch(t: TraceData) {
    const order = new Map<string, string>();
    const stamp = (iso: string, id: string) => iso.replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, (_m, ms) => `${ms}000Z`) + id;
    const rootOrder = stamp(t.startTime, t.id);
    order.set(t.id, rootOrder);
    const runType = (s: SpanData) => (s.kind === "generation" ? "llm" : s.kind === "retriever" ? "retriever" : s.kind === "tool" ? "tool" : "chain");
    const post: any[] = [{
      id: t.id, trace_id: t.id, dotted_order: rootOrder, name: t.name, run_type: "chain",
      start_time: t.startTime, end_time: t.endTime, inputs: {}, outputs: {},
      session_name: this.cfg.project ?? "mindmirror", tags: t.tags,
      extra: { metadata: { ...t.metadata, user_id: t.userId, session_id: t.sessionId } },
    }];
    // span cha luôn được tạo trước con → duyệt theo thứ tự là đủ
    for (const s of t.spans) {
      const parent = s.parentId ?? t.id;
      const d = `${order.get(parent) ?? rootOrder}.${stamp(s.startTime, s.id)}`;
      order.set(s.id, d);
      post.push({
        id: s.id, trace_id: t.id, parent_run_id: parent, dotted_order: d, name: s.name, run_type: runType(s),
        start_time: s.startTime, end_time: s.endTime,
        inputs: { value: s.input ?? null }, outputs: { value: s.output ?? null }, error: s.error,
        session_name: this.cfg.project ?? "mindmirror",
        extra: {
          metadata: {
            ...s.attrs, ls_model_name: s.model, ls_provider: s.provider,
            usage_metadata: s.usage ? { input_tokens: s.usage.input, output_tokens: s.usage.output, total_tokens: s.usage.input + s.usage.output } : undefined,
            cost_usd: s.costUsd,
          },
        },
      });
    }
    return { post };
  }

  async export(t: TraceData) {
    const ep = (this.cfg.endpoint ?? "https://api.smith.langchain.com").replace(/\/$/, "");
    const r = await (this.cfg.fetchImpl ?? fetch)(`${ep}/runs/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.cfg.apiKey },
      body: JSON.stringify(this.toBatch(t)),
    });
    if (!r.ok) throw new Error(`LangSmith HTTP ${r.status}`);
  }
}

/** In tóm tắt ra console — tiện khi dev với `wrangler dev`. */
export class ConsoleExporter implements TraceExporter {
  readonly name = "console";
  async export(t: TraceData) {
    const gens = t.spans.filter((s) => s.kind === "generation");
    console.log(JSON.stringify({
      trace: t.name, id: t.id, spans: t.spans.length,
      llm: gens.map((g) => `${g.provider}/${g.model}:${g.status}`),
      tokens: gens.reduce((a, g) => a + (g.usage?.input ?? 0) + (g.usage?.output ?? 0), 0),
    }));
  }
}
