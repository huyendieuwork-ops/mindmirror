import { describe, expect, it } from "vitest";
import { createApp } from "../src/http/app";
import { MemoryStore } from "../src/store/memory";
import { ModelRouter } from "../src/providers/router";
import { ScriptedProvider } from "../src/providers/mock";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setup() {
  const store = new MemoryStore();
  const app = createApp({
    store,
    authenticate: async (req) => {
      const u = req.headers.get("x-user");
      if (!u) throw new (await import("../src/http/auth")).AuthError("no");
      return u;
    },
    routers: (onCall) => ({ core: new ModelRouter(new ScriptedProvider([]), null, { sleep: async () => {}, onCall }), light: null }),
  });
  const env = { LIMIT_SESSIONS_PER_DAY: "10" };
  const call = async (user: string | null, method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined }, env);
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };
  return { store, call };
}

describe("Tiến độ: tải chi tiết nhiều phiên trong một yêu cầu", () => {
  it("trả view + assessment giống API từng phiên (trừ tin nhắn); chỉ phiên của chính mình", async () => {
    const { call } = setup();
    const s1 = (await call(A, "POST", "/api/sessions", { mode: "explore", topic: "Chỉ mục" })).json;
    const s2 = (await call(A, "POST", "/api/sessions", { mode: "reunderstand", topic: "3NF" })).json;
    const other = (await call(B, "POST", "/api/sessions", { mode: "explore", topic: "Khoá ngoại" })).json;
    expect(s1.id && s2.id && other.id).toBeTruthy();

    expect((await call(null, "GET", `/api/sessions/summaries?ids=${s1.id}`)).status).toBe(401);
    const r = await call(A, "GET", `/api/sessions/summaries?ids=${s1.id},${s2.id},${other.id},khong-phai-uuid,${s1.id}`);
    expect(r.status).toBe(200);
    expect(r.json.items.map((x: any) => x.id).sort()).toEqual([s1.id, s2.id].sort());

    const one = (await call(A, "GET", `/api/sessions/${s1.id}`)).json;
    const oneA = (await call(A, "GET", `/api/sessions/${s1.id}/assessment`)).json;
    const got = r.json.items.find((x: any) => x.id === s1.id);
    expect(got.view.messages).toEqual([]);
    expect({ ...got.view, messages: one.messages }).toEqual(one);
    expect(got.assessment).toEqual(oneA);

    expect((await call(A, "GET", "/api/sessions/summaries")).json.items).toEqual([]);
    // Route chi tiết từng phiên vẫn hoạt động bình thường
    expect((await call(A, "GET", `/api/sessions/${s2.id}`)).status).toBe(200);
  });
});
