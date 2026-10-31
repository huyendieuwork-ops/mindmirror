import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { authenticate } from "../src/http/auth";
import { createApp } from "../src/http/app";
import { MemoryStore } from "../src/store/memory";

const SUPA = "https://abc.supabase.co";
const SECRET = "super-secret-jwt-token-with-at-least-32-characters";
const sign = (o: { aud?: string; iss?: string; secret?: string } = {}) =>
  new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    .setIssuer(o.iss ?? `${SUPA}/auth/v1`).setAudience(o.aud ?? "authenticated").setExpirationTime("1h")
    .sign(new TextEncoder().encode(o.secret ?? SECRET));
const reqWith = (t: string) => new Request("https://x/api", { headers: { authorization: `Bearer ${t}` } });

describe("xác thực Supabase (HS256 cho dự án cũ)", () => {
  const env = { SUPABASE_URL: SUPA, SUPABASE_JWT_SECRET: SECRET };
  it("chấp nhận token hợp lệ", async () => {
    expect(await authenticate(reqWith(await sign()), env)).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
  it("từ chối sai chữ ký / sai issuer / sai audience", async () => {
    await expect(authenticate(reqWith(await sign({ secret: "x".repeat(40) })), env)).rejects.toThrow();
    await expect(authenticate(reqWith(await sign({ iss: "https://evil/auth/v1" })), env)).rejects.toThrow();
    await expect(authenticate(reqWith(await sign({ aud: "anon" })), env)).rejects.toThrow();
  });
  it("dev bypass chỉ hoạt động khi APP_ENV=development", async () => {
    const r = new Request("https://x/api", { headers: { "x-dev-user": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
    await expect(authenticate(r, { APP_ENV: "production", DEV_AUTH_BYPASS: "true", SUPABASE_URL: SUPA })).rejects.toThrow();
    expect(await authenticate(r, { APP_ENV: "development", DEV_AUTH_BYPASS: "true" })).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});

describe("CORS nhiều origin + /api/config công khai", () => {
  const app = createApp({ store: new MemoryStore() });
  const env = { ALLOWED_ORIGIN: "https://mindmirror.pages.dev,http://localhost:5173" };
  it("cho phép origin trong danh sách, chặn origin lạ", async () => {
    const ok = await app.request("/health", { headers: { origin: "https://mindmirror.pages.dev" } }, env);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://mindmirror.pages.dev");
    const bad = await app.request("/health", { headers: { origin: "https://evil.com" } }, env);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("/api/config không cần đăng nhập và không lộ bí mật", async () => {
    const r = await app.request("/api/config", {}, { ...env, GEMINI_API_KEY: "AIzaSECRET", APP_ENV: "production" });
    const body = await r.text();
    expect(r.status).toBe(200);
    expect(body).not.toContain("AIzaSECRET");
  });
});
