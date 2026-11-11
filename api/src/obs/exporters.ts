import type { SpanData, TraceData, TraceExporter } from "./tracer";

const b64 = (s: string) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64"));

/**
 * Langfuse — OpenTelemetry (OTLP/HTTP JSON) tại POST {host}/api/public/otel/v1/traces, Basic auth publicKey:secretKey,
 * header `x-langfuse-ingestion-version: 4` để trace hiện ngay (không có header này Langfuse v4 có thể trễ tới 15 phút).
 * API cũ /api/public/ingestion bị Langfuse Cloud gỡ ngày 16/11/2026 nên không dùng nữa.
 * Mỗi span của MindMirror → 1 OTel span; span gốc mang thuộc tính cấp trace (tên, user, session, tags, metadata).
 */
type OtlpAttr = { key: string; value: { stringValue?: string; boolValue?: boolean; doubleValue?: number; arrayValue?: { values: { stringValue: string }[] } } };

const hex = (id: string, len: number) => {
  const h = id.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (h.length >= len) return h.slice(0, len);
  // id không phải UUID (hiếm) → băm FNV-1a lặp cho đủ độ dài
  let out = "";
  let seed = 0x811c9dc5;
  while (out.length < len) {
    for (let i = 0; i < id.length; i++) { seed ^= id.charCodeAt(i); seed = Math.imul(seed, 0x01000193) >>> 0; }
    out += seed.toString(16).padStart(8, "0");
  }
  return out.slice(0, len);
};
const nanos = (iso: string | null | undefined, fallback: string) => {
  const ms = Date.parse(iso || fallback);
  return (BigInt(Number.isFinite(ms) ? ms : Date.now()) * 1000000n).toString();
};
const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
const attr = (key: string, v: unknown): OtlpAttr | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return { key, value: { boolValue: v } };
  if (typeof v === "number" && Number.isFinite(v)) return { key, value: { doubleValue: v } };
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return { key, value: { arrayValue: { values: v.map((x) => ({ stringValue: x })) } } };
  return { key, value: { stringValue: str(v).slice(0, 4000) } };
};
const obsType = (s: SpanData) =>
  s.kind === "generation" ? "generation" : s.kind === "tool" ? "tool" : s.kind === "retriever" ? "retriever" : s.kind === "guardrail" ? "guardrail" : s.kind === "chain" ? "chain" : s.kind === "event" ? "event" : "span";

export class LangfuseExporter implements TraceExporter {
  readonly name = "langfuse";
  constructor(private cfg: { publicKey: string; secretKey: string; host?: string; release?: string; fetchImpl?: typeof fetch }) {}

  toOtlp(t: TraceData) {
    const traceId = hex(t.id, 32);
    const now = new Date().toISOString();
    const spans = t.spans.map((s) => {
      const attrs: (OtlpAttr | null)[] = [
        attr("langfuse.observation.type", obsType(s)),
        attr("langfuse.observation.input", s.input),
        attr("langfuse.observation.output", s.output),
        ...Object.entries({ kind: s.kind, ...s.attrs }).map(([k, v]) => attr(`langfuse.observation.metadata.${k}`, v)),
      ];
      if (s.status === "error") attrs.push(attr("langfuse.observation.level", "ERROR"), attr("langfuse.observation.status_message", s.error ?? "error"));
      if (s.kind === "generation") {
        attrs.push(attr("langfuse.observation.model.name", s.model), attr("gen_ai.system", s.provider));
        if (s.usage) attrs.push(attr("langfuse.observation.usage_details", { input: s.usage.input, output: s.usage.output }));
        if (s.costUsd !== undefined) attrs.push(attr("langfuse.observation.cost_details", { total: s.costUsd }));
      }
      if (!s.parentId) {
        attrs.push(
          attr("langfuse.trace.name", t.name), attr("langfuse.user.id", t.userId), attr("langfuse.session.id", t.sessionId),
          attr("langfuse.trace.tags", t.tags), attr("langfuse.release", this.cfg.release),
          ...Object.entries(t.metadata ?? {}).map(([k, v]) => attr(`langfuse.trace.metadata.${k}`, v)),
        );
      }
      return {
        traceId, spanId: hex(s.id, 16), ...(s.parentId ? { parentSpanId: hex(s.parentId, 16) } : {}),
        name: s.name, kind: 1,
        startTimeUnixNano: nanos(s.startTime, now), endTimeUnixNano: nanos(s.endTime ?? t.endTime, now),
        attributes: attrs.filter((a): a is OtlpAttr => a !== null),
        status: s.status === "error" ? { code: 2, message: s.error ?? "error" } : { code: 1 },
      };
    });
    return {
      resourceSpans: [{
        resource: { attributes: [attr("service.name", "mindmirror")!] },
        scopeSpans: [{ scope: { name: "mindmirror", version: "1" }, spans }],
      }],
    };
  }

  async export(t: TraceData) {
    const host = (this.cfg.host ?? "https://cloud.langfuse.com").replace(/\/$/, "");
    const r = await (this.cfg.fetchImpl ?? fetch)(`${host}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-langfuse-ingestion-version": "4",
        authorization: `Basic ${b64(`${this.cfg.publicKey}:${this.cfg.secretKey}`)}`,
      },
      body: JSON.stringify(this.toOtlp(t)),
    });
    if (!r.ok) throw new Error(`Langfuse HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const body: any = await r.json().catch(() => null);
    if (body?.partialSuccess?.rejectedSpans) throw new Error(`Langfuse rejected ${body.partialSuccess.rejectedSpans} spans: ${body.partialSuccess.errorMessage ?? ""}`);
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
