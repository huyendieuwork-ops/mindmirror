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
  it("5xx → retry 1 lần rồi fallback", async () => {
    const { r, p, f } = mk([new ProviderError("x", 503, "gemini"), new ProviderError("x", 503, "gemini")], [ok]);
    expect((await r.generate(req)).provider).toBe("groq");
    expect(p.calls).toHaveLength(2);
    expect(f!.calls).toHaveLength(1);
  });
  it("401 → KHÔNG fallback (tránh che lỗi key)", async () => {
    const { r, f } = mk([new ProviderError("auth", 401, "gemini")], [ok]);
    await expect(r.generate(req)).rejects.toMatchObject({ status: 401 });
    expect(f!.calls).toHaveLength(0);
  });
});
