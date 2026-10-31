import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { DemoProvider } from "./providers/mock";
import { ModelRouter, type CallLog } from "./providers/router";
import type { LLMProvider } from "./providers/types";
import { GeminiEmbedder, type Embedder } from "./rag/embeddings";
import { ConsoleExporter, LangfuseExporter, LangSmithExporter } from "./obs/exporters";
import type { ContentMode, TraceExporter } from "./obs/tracer";
import { loadPrices } from "./obs/pricing";

export interface Env {
  APP_ENV?: string;
  CF_ACCOUNT_ID?: string;
  CF_GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_API_VERSION?: string;
  GROQ_API_KEY?: string;
  MODEL_CORE?: string;
  MODEL_LIGHT?: string;
  MODEL_FALLBACK?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_JWT_SECRET?: string;   // chỉ cần nếu dự án Supabase còn dùng HS256
  ALLOWED_ORIGIN?: string;
  DEV_AUTH_BYPASS?: string;
  LIMIT_SESSIONS_PER_DAY?: string;
  LIMIT_TURNS_PER_SESSION?: string;
  LIMIT_INPUT_CHARS?: string;
  // RAG
  MODEL_EMBED?: string;
  EMBED_DIMS?: string;
  // Observability
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_HOST?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_PROJECT?: string;
  LANGSMITH_ENDPOINT?: string;
  TRACE_CONTENT?: string;   // metadata (mặc định) | redacted | full
  TRACE_CONSOLE?: string;
  PRICING_JSON?: string;
  // MCP
  CONNECTOR_ENC_KEY?: string;
  MCP_ALLOWED_HOSTS?: string;
}

export function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/**
 * Dựng router model từ biến môi trường.
 * - Có CF_ACCOUNT_ID + CF_GATEWAY_ID → gọi qua AI Gateway (provider-native, vẫn dùng free quota của key).
 * - Không có GEMINI_API_KEY và đang development → DemoProvider offline.
 */
function gatewayOf(env: Env) {
  return env.CF_ACCOUNT_ID && env.CF_GATEWAY_ID
    ? { accountId: env.CF_ACCOUNT_ID, gatewayId: env.CF_GATEWAY_ID, token: env.CF_AIG_TOKEN }
    : undefined;
}

/** Embedder cho RAG; không có key → null (RAG chạy bằng tìm kiếm từ khoá BM25). */
export function buildEmbedder(env: Env): Embedder | null {
  if (!env.GEMINI_API_KEY) return null;
  return new GeminiEmbedder({
    apiKey: env.GEMINI_API_KEY, model: env.MODEL_EMBED ?? "gemini-embedding-001", dims: num(env.EMBED_DIMS, 768),
    apiVersion: env.GEMINI_API_VERSION, gateway: gatewayOf(env),
  });
}

export function buildExporters(env: Env): TraceExporter[] {
  const out: TraceExporter[] = [];
  if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY)
    out.push(new LangfuseExporter({ publicKey: env.LANGFUSE_PUBLIC_KEY, secretKey: env.LANGFUSE_SECRET_KEY, host: env.LANGFUSE_HOST }));
  if (env.LANGSMITH_API_KEY)
    out.push(new LangSmithExporter({ apiKey: env.LANGSMITH_API_KEY, project: env.LANGSMITH_PROJECT, endpoint: env.LANGSMITH_ENDPOINT }));
  if (env.TRACE_CONSOLE === "true") out.push(new ConsoleExporter());
  return out;
}

export function contentMode(env: Env): ContentMode {
  return env.TRACE_CONTENT === "full" || env.TRACE_CONTENT === "redacted" ? env.TRACE_CONTENT : "metadata";
}

export function buildRouters(env: Env, onCall?: (c: CallLog) => void): { core: ModelRouter; light: ModelRouter | null; offline: boolean } {
  const gateway = gatewayOf(env);
  const prices = loadPrices(env.PRICING_JSON);

  if (!env.GEMINI_API_KEY) {
    if (env.APP_ENV === "production") throw new Error("GEMINI_API_KEY missing");
    const demo = new DemoProvider();
    return { core: new ModelRouter(demo, null, { onCall, prices }), light: null, offline: true };
  }

  const core: LLMProvider = new GeminiProvider({
    apiKey: env.GEMINI_API_KEY, model: env.MODEL_CORE ?? "gemini-3.8-flash", apiVersion: env.GEMINI_API_VERSION, gateway,
  });
  const light: LLMProvider = new GeminiProvider({
    apiKey: env.GEMINI_API_KEY, model: env.MODEL_LIGHT ?? "gemini-3.5-flash-lite", apiVersion: env.GEMINI_API_VERSION, gateway,
  });
  const fallback: LLMProvider | null = env.GROQ_API_KEY
    ? new GroqProvider({ apiKey: env.GROQ_API_KEY, model: env.MODEL_FALLBACK ?? "openai/gpt-oss-120b", gateway })
    : null;

  return {
    core: new ModelRouter(core, fallback, { onCall, prices }),
    light: new ModelRouter(light, null, { onCall, timeoutMs: 12_000, prices }),
    offline: false,
  };
}
