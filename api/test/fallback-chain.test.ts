import { describe, expect, it } from "vitest";
import { ModelRouter } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";
import { ProviderError } from "../src/providers/types";
import { OpenAICompatProvider, PRESETS } from "../src/providers/openai-compat";
import { buildFallbacks } from "../src/env";

const req = { system: "s", user: "u" };
const ok = { a: 1 };

describe("Chuỗi mô hình dự phòng (Gemini → Mistral → Cerebras → Groq)", () => {
  it("Gemini quá tải, dự phòng thứ nhất cũng quá tải → chuyển sang nhà kế tiếp", async () => {
    const p = new ScriptedProvider([new ProviderError("rl", 429, "gemini", 60)], "gemini", "core");
    const m = new ScriptedProvider([new ProviderError("rl", 429, "mistral", 60)], "mistral", "m");
    const c = new ScriptedProvider([ok], "cerebras", "c");
    const g = new ScriptedProvider([ok], "groq", "g");
    const logs: any[] = [];
    const r = new ModelRouter(p, [m, c, g], { sleep: async () => {}, onCall: (l) => logs.push(l) });
    expect((await r.generate(req)).provider).toBe("cerebras");
    expect(g.calls).toHaveLength(0);
    expect(logs.map((l) => `${l.provider}:${l.status}`)).toEqual(["gemini:error", "mistral:error", "cerebras:ok"]);
  });

  it("khoá dự phòng sai (401) → bỏ qua nhà đó; tất cả hỏng → báo lỗi của nhà cuối", async () => {
    const p = new ScriptedProvider([new ProviderError("x", 503, "gemini"), new ProviderError("x", 503, "gemini"), new ProviderError("x", 503, "gemini")], "gemini", "core");
    const m = new ScriptedProvider([new ProviderError("auth", 401, "mistral")], "mistral", "m");
    const c = new ScriptedProvider([new ProviderError("rl", 429, "cerebras")], "cerebras", "c");
    const r = new ModelRouter(p, [m, c], { sleep: async () => {} });
    await expect(r.generate(req)).rejects.toMatchObject({ status: 429, provider: "cerebras" });
  });

  it("Gemini lỗi khoá (401) → không dùng dự phòng (tránh che lỗi cấu hình)", async () => {
    const p = new ScriptedProvider([new ProviderError("auth", 401, "gemini")], "gemini", "core");
    const m = new ScriptedProvider([ok], "mistral", "m");
    await expect(new ModelRouter(p, [m], { sleep: async () => {} }).generate(req)).rejects.toMatchObject({ status: 401 });
    expect(m.calls).toHaveLength(0);
  });

  it("buildFallbacks: chỉ bật nhà có khoá, theo FALLBACK_ORDER, bỏ ký tự vô hình trong khoá", () => {
    expect(buildFallbacks({}).length).toBe(0);
    const d = buildFallbacks({ GROQ_API_KEY: "g", CEREBRAS_API_KEY: "c", MISTRAL_API_KEY: "m\u200b " });
    expect(d.map((p) => p.provider)).toEqual(["mistral", "cerebras", "groq"]);
    expect(d.map((p) => p.model)).toEqual(["mistral-small-latest", "gpt-oss-120b", "openai/gpt-oss-120b"]);
    const o = buildFallbacks({ CEREBRAS_API_KEY: "c", MISTRAL_API_KEY: "m", FALLBACK_ORDER: "cerebras, abc ,mistral", MODEL_MISTRAL: "open-mistral-nemo" });
    expect(o.map((p) => `${p.provider}:${p.model}`)).toEqual(["cerebras:gpt-oss-120b", "mistral:open-mistral-nemo"]);
  });
});

describe("OpenAICompatProvider", () => {
  const fake = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const calls: { url: string; init: any }[] = [];
    const f = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status, headers }); }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("Mistral: gửi đúng URL, khoá, JSON mode và max_tokens", async () => {
    const { f, calls } = fake(200, { choices: [{ message: { content: "{\"x\":1}" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const p = new OpenAICompatProvider({ provider: "mistral", ...PRESETS.mistral!, apiKey: "KEY", fetchImpl: f });
    const res = await p.generateJSON({ system: "sys", user: "hi", maxOutputTokens: 300 });
    expect(calls[0]!.url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(calls[0]!.init.headers.Authorization).toBe("Bearer KEY");
    const body = JSON.parse(calls[0]!.init.body);
    expect(body).toMatchObject({ model: "mistral-small-latest", response_format: { type: "json_object" }, max_tokens: 300 });
    expect(body.max_completion_tokens).toBeUndefined();
    expect(res).toMatchObject({ text: "{\"x\":1}", provider: "mistral", usage: { inputTokens: 10, outputTokens: 5 } });
    expect(res.truncated).toBeUndefined();
  });

  it("Cerebras: max_completion_tokens, reasoning_effort low khi trích xuất đồ thị, báo bị cắt", async () => {
    const { f, calls } = fake(200, { choices: [{ message: { content: "{" }, finish_reason: "length" }] });
    const p = new OpenAICompatProvider({ provider: "cerebras", ...PRESETS.cerebras!, apiKey: "K", fetchImpl: f });
    const res = await p.generateJSON({ system: "s", user: "u", purpose: "graph_extract", maxOutputTokens: 8192 } as any);
    expect(calls[0]!.url).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ model: "gpt-oss-120b", max_completion_tokens: 8192, reasoning_effort: "low" });
    expect(res.truncated).toBe(true);
  });

  it("429 → ProviderError có Retry-After để router chuyển nhà", async () => {
    const { f } = fake(429, { error: "rate" }, { "retry-after": "20" });
    const p = new OpenAICompatProvider({ provider: "cerebras", ...PRESETS.cerebras!, apiKey: "K", fetchImpl: f });
    await expect(p.generateJSON(req)).rejects.toMatchObject({ status: 429, provider: "cerebras", retryAfterSec: 20 });
  });
});
