import { describe, expect, it } from "vitest";
import { createApp } from "../src/http/app";
import { MemoryStore } from "../src/store/memory";

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
  });
  const call = (user: string | null, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined }, {});
  return { store, call };
}

describe("Ghi chú cá nhân", () => {
  it("tạo / sửa / liệt kê / xoá; chỉ chủ tài khoản thấy", async () => {
    const { call } = setup();
    expect((await call(null, "GET", "/api/notes")).status).toBe(401);
    const n = await (await call(A, "POST", "/api/notes", { title: "  Ôn 3NF ", body: "Phụ thuộc bắc cầu\nví dụ" })).json() as any;
    expect(n.title).toBe("Ôn 3NF");
    const upd = await (await call(A, "PATCH", `/api/notes/${n.id}`, { body: "đã sửa" })).json() as any;
    expect(upd.body).toBe("đã sửa");
    expect(upd.title).toBe("Ôn 3NF");
    expect(((await (await call(A, "GET", "/api/notes")).json()) as any).items).toHaveLength(1);
    // Người khác không đọc, sửa, xoá được
    expect(((await (await call(B, "GET", "/api/notes")).json()) as any).items).toHaveLength(0);
    expect((await call(B, "PATCH", `/api/notes/${n.id}`, { body: "x" })).status).toBe(404);
    expect((await call(B, "DELETE", `/api/notes/${n.id}`)).status).toBe(404);
    expect((await call(A, "DELETE", `/api/notes/${n.id}`)).status).toBe(200);
    expect(((await (await call(A, "GET", "/api/notes")).json()) as any).items).toHaveLength(0);
  });

  it("giới hạn độ dài; xoá toàn bộ dữ liệu xoá cả ghi chú", async () => {
    const { call, store } = setup();
    expect((await call(A, "POST", "/api/notes", { title: "x".repeat(121) })).status).toBe(400);
    expect((await call(A, "POST", "/api/notes", { body: "x".repeat(20001) })).status).toBe(400);
    await call(A, "POST", "/api/notes", { title: "a", body: "b" });
    await call(B, "POST", "/api/notes", { title: "của B", body: "" });
    expect((await call(A, "DELETE", "/api/me/data", { scope: "all", confirm: "XOA" })).status).toBe(200);
    expect(await store.listNotes(A)).toHaveLength(0);
    expect(await store.listNotes(B)).toHaveLength(1);
  });
});
