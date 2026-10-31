import { describe, expect, it } from "vitest";
import { ModelRouter } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";
import { ProviderError } from "../src/providers/types";

const ok = { a: 1 };
const mk = (primary: any[], fb: any[] | null) => {
  const p = new ScriptedProvider(primary, "gemini", "core");
  const f = fb ? new ScriptedProvider(fb, "groq", "fb") : null;
  const logs: any[] = [];
  return { p, f, logs, r: new ModelRouter(p, f, { sleep: async () => {}, onCall: (l) => logs.push(l) }) };
};
const req = { system: "s", user: "u" };

describe("fallback policy", () => {
  it("429 Retry-After dài → chuyển Groq ngay", async () => {
    const { r, f, logs } = mk([new ProviderError("rl", 429, "gemini", 30)], [ok]);
    const res = await r.generate(req);
    expect(res.provider).toBe("groq");
    expect(f!.calls).toHaveLength(1);
    expect(logs.at(-1).fallback).toBe(true);
  });
  it("429 Retry-After ngắn → chờ rồi thử lại 1 lần", async () => {
    const { r, p } = mk([new ProviderError("rl", 429, "gemini", 1), ok], []);
    expect((await r.generate(req)).provider).toBe("gemini");
    expect(p.calls).toHaveLength(2);
  });
  it("5xx → retry tối đa 2 lần (backoff) rồi fallback", async () => {
    const e = () => new ProviderError("x", 503, "gemini");
    const { r, p, f } = mk([e(), e(), e()], [ok]);
    expect((await r.generate(req)).provider).toBe("groq");
    expect(p.calls).toHaveLength(3);
    expect(f!.calls).toHaveLength(1);
  });
  it("401 → KHÔNG fallback (tránh che lỗi key)", async () => {
    const { r, f } = mk([new ProviderError("auth", 401, "gemini")], [ok]);
    await expect(r.generate(req)).rejects.toMatchObject({ status: 401 });
    expect(f!.calls).toHaveLength(0);
  });

  it("429 không có Retry-After → backoff luỹ thừa, giới hạn số lần, hết lượt thì báo lỗi", async () => {
    const waits: number[] = [];
    const p = new ScriptedProvider([429, 429, 429, 429].map(() => new ProviderError("rl", 429, "gemini")), "gemini", "core");
    const r = new ModelRouter(p, null, { sleep: async (ms) => { waits.push(ms); }, baseDelayMs: 1000, maxRetries: 2 });
    await expect(r.generate(req)).rejects.toMatchObject({ status: 429 });
    expect(p.calls).toHaveLength(3); // 1 lần + 2 lần thử lại, không lặp vô hạn
    expect(waits).toHaveLength(2);
    expect(waits[0]!).toBeGreaterThanOrEqual(1000);
    expect(waits[1]!).toBeGreaterThanOrEqual(2000); // luỹ thừa
  });
  it("429 rồi thành công ở lần thử lại → trả kết quả, ghi span llm.retry", async () => {
    const { Trace } = await import("../src/obs/tracer");
    const t = new Trace("t");
    const root = t.start("root");
    const p = new ScriptedProvider([new ProviderError("rl", 429, "gemini"), ok], "gemini", "core");
    const r = new ModelRouter(p, null, { sleep: async () => {} });
    expect((await r.generate(req, root)).provider).toBe("gemini");
    expect(t.data.spans.filter((s) => s.name === "llm.retry")).toHaveLength(1);
    expect(t.data.spans.filter((s) => s.kind === "generation")).toHaveLength(2);
  });
});
