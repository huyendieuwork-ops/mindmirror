/**
 * Tracing cho Agent: mỗi lượt/phiên là 1 Trace gồm nhiều Span lồng nhau.
 * Mặc định KHÔNG ghi nội dung học tập thô (chỉ metadata) — xem ContentMode.
 * Exporter: Langfuse, LangSmith, console, hoặc bảng agent_traces (Supabase).
 */

export type SpanKind = "chain" | "generation" | "retriever" | "tool" | "guardrail" | "event";
export type ContentMode = "metadata" | "redacted" | "full";

export interface SpanData {
  id: string;
  traceId: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  startTime: string;
  endTime: string | null;
  attrs: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  model?: string;
  provider?: string;
  usage?: { input: number; output: number };
  costUsd?: number;
  status: "ok" | "error";
  error?: string;
}

export interface TraceData {
  id: string;
  name: string;
  userId: string | null;
  sessionId: string | null;
  tags: string[];
  startTime: string;
  endTime: string | null;
  spans: SpanData[];
  metadata: Record<string, unknown>;
}

export interface SpanHandle {
  readonly id: string;
  set(attrs: Record<string, unknown>): SpanHandle;
  io(input?: unknown, output?: unknown): SpanHandle;
  gen(info: { model: string; provider: string; usage: { input: number; output: number }; costUsd?: number }): SpanHandle;
  fail(err: unknown): SpanHandle;
  end(): void;
  child(name: string, kind?: SpanKind, attrs?: Record<string, unknown>): SpanHandle;
}

export interface TraceExporter {
  readonly name: string;
  export(t: TraceData): Promise<void>;
}

const newId = () => crypto.randomUUID();

export class Trace {
  readonly data: TraceData;
  constructor(
    name: string,
    opts: { userId?: string | null; sessionId?: string | null; tags?: string[]; metadata?: Record<string, unknown>; contentMode?: ContentMode; id?: string } = {},
    readonly contentMode: ContentMode = opts.contentMode ?? "metadata",
  ) {
    this.data = {
      id: opts.id ?? newId(), name, userId: opts.userId ?? null, sessionId: opts.sessionId ?? null,
      tags: opts.tags ?? [], startTime: new Date().toISOString(), endTime: null, spans: [], metadata: opts.metadata ?? {},
    };
  }

  get id() { return this.data.id; }
  get enabled() { return true; }

  start(name: string, kind: SpanKind = "chain", parent: SpanHandle | null = null, attrs: Record<string, unknown> = {}): SpanHandle {
    const span: SpanData = {
      id: newId(), traceId: this.data.id, parentId: parent?.id ?? null, name, kind,
      startTime: new Date().toISOString(), endTime: null, attrs: { ...attrs }, status: "ok",
    };
    this.data.spans.push(span);
    return makeHandle(this, span);
  }

  /** Chạy fn trong 1 span; tự đóng span, ghi lỗi nếu có. */
  async run<T>(name: string, kind: SpanKind, parent: SpanHandle | null, fn: (s: SpanHandle) => Promise<T>): Promise<T> {
    const s = this.start(name, kind, parent);
    try {
      return await fn(s);
    } catch (e) {
      s.fail(e);
      throw e;
    } finally {
      s.end();
    }
  }

  /** Nội dung người học/tài liệu đi qua đây trước khi vào trace. */
  content(text: string | null | undefined): unknown {
    if (text == null) return null;
    if (this.contentMode === "full") return text;
    if (this.contentMode === "redacted") return { preview: text.slice(0, 40) + (text.length > 40 ? "…" : ""), chars: text.length };
    return { chars: text.length, hash: fnv1a(text) };
  }

  finish(metadata: Record<string, unknown> = {}) {
    this.data.endTime = new Date().toISOString();
    Object.assign(this.data.metadata, metadata);
    for (const s of this.data.spans) if (!s.endTime) s.endTime = this.data.endTime;
  }

  /** Tóm tắt nhanh để lưu DB / trả về API: tổng token, chi phí, độ trễ theo bước. */
  summary() {
    const gens = this.data.spans.filter((s) => s.kind === "generation");
    const dur = (s: SpanData) => (s.endTime ? Date.parse(s.endTime) - Date.parse(s.startTime) : 0);
    return {
      traceId: this.data.id,
      name: this.data.name,
      sessionId: this.data.sessionId,
      totalMs: this.data.endTime ? Date.parse(this.data.endTime) - Date.parse(this.data.startTime) : null,
      llmCalls: gens.length,
      llmErrors: gens.filter((g) => g.status === "error").length,
      fallbacks: gens.filter((g) => g.attrs.fallback === true).length,
      inputTokens: sum(gens.map((g) => g.usage?.input ?? 0)),
      outputTokens: sum(gens.map((g) => g.usage?.output ?? 0)),
      costUsd: round6(sum(gens.map((g) => g.costUsd ?? 0))),
      errors: this.data.spans.filter((s) => s.status === "error").map((s) => ({ span: s.name, error: s.error })),
      steps: this.data.spans.map((s) => ({ name: s.name, kind: s.kind, ms: dur(s), status: s.status, parent: s.parentId })),
      // ---- bổ sung cho demo kỹ thuật (không chứa nội dung học tập) ----
      workflow: this.data.spans.filter((s) => s.name.startsWith("step.")).map((s) => ({ step: s.name.slice(5), ms: dur(s), status: s.status })),
      tools: this.data.spans
        .filter((s) => s.kind === "tool" && s.name.startsWith("tool."))
        .map((s) => ({ name: s.name.slice(5), initiator: s.attrs.initiator ?? null, ok: s.attrs.ok !== false && s.status === "ok", ms: dur(s), error: s.attrs.error_code ?? null })),
      guardrails: [...new Set(this.data.spans.filter((s) => s.kind === "guardrail" && Array.isArray(s.attrs.flags)).flatMap((s) => s.attrs.flags as string[]))],
      retrieval: this.data.spans
        .filter((s) => s.kind === "retriever")
        .map((s) => ({ purpose: s.attrs.purpose ?? null, method: s.attrs.method ?? null, hits: Array.isArray(s.attrs.results) ? s.attrs.results.length : 0, ms: dur(s) })),
      retries: this.data.spans.filter((s) => s.name === "llm.retry").length,
      models: [...new Set(gens.map((g) => g.model).filter(Boolean))],
      costNote: "Chi phí ƯỚC TÍNH theo bảng giá công khai (obs/pricing.ts); free tier không bị tính phí — hoá đơn thật xem ở Google AI Studio.",
    };
  }
}

/** Trace rỗng — dùng khi không bật tracing, để code không phải kiểm tra null. */
export class NoopTrace extends Trace {
  constructor() { super("noop"); }
  override get enabled() { return false; }
  override start(name: string, kind: SpanKind = "chain"): SpanHandle {
    const span: SpanData = { id: "noop", traceId: "noop", parentId: null, name, kind, startTime: "", endTime: null, attrs: {}, status: "ok" };
    return makeHandle(this, span, true);
  }
}

function makeHandle(trace: Trace, span: SpanData, noop = false): SpanHandle {
  const h: SpanHandle = {
    id: span.id,
    set(a) { if (!noop) Object.assign(span.attrs, a); return h; },
    io(i, o) { if (!noop) { if (i !== undefined) span.input = i; if (o !== undefined) span.output = o; } return h; },
    gen(g) { if (!noop) { span.model = g.model; span.provider = g.provider; span.usage = g.usage; span.costUsd = g.costUsd; } return h; },
    fail(e) { span.status = "error"; span.error = (e as Error)?.message ?? String(e); return h; },
    end() { if (!span.endTime) span.endTime = new Date().toISOString(); },
    child(name, kind = "chain", attrs = {}) { return trace.start(name, kind, h, attrs); },
  };
  return h;
}

export async function exportTrace(t: Trace, exporters: TraceExporter[]): Promise<void> {
  if (!t.enabled || exporters.length === 0) return;
  if (!t.data.endTime) t.finish();
  await Promise.all(exporters.map((e) => e.export(t.data).catch((err) => console.warn(`[trace] ${e.name} export failed: ${(err as Error).message}`))));
}

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
