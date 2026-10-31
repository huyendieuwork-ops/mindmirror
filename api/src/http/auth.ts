import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";
import type { Env } from "../env";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl = "";

export class AuthError extends Error {}

/**
 * Xác thực Supabase access token (chữ ký JWKS, issuer, audience, exp).
 * Dev bypass: chỉ khi APP_ENV=development VÀ DEV_AUTH_BYPASS=true → dùng header X-Dev-User.
 */
export async function authenticate(req: Request, env: Env): Promise<string> {
  // development: dev local; demo: web công khai chưa nối Supabase (mỗi trình duyệt một mã ngẫu nhiên)
  if ((env.APP_ENV === "development" || env.APP_ENV === "demo") && env.DEV_AUTH_BYPASS === "true") {
    const dev = req.headers.get("x-dev-user");
    if (dev && /^[0-9a-f-]{36}$/i.test(dev)) return dev;
  }

  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new AuthError("missing token");
  if (!env.SUPABASE_URL) throw new AuthError("auth not configured");

  const opts = { issuer: `${env.SUPABASE_URL}/auth/v1`, audience: "authenticated" };

  // Dự án Supabase cũ ký token bằng HS256 (JWT secret dùng chung) — hỗ trợ cả hai kiểu.
  let alg = "";
  try { alg = decodeProtectedHeader(token).alg ?? ""; } catch { throw new AuthError("invalid token"); }
  if (alg === "HS256") {
    if (!env.SUPABASE_JWT_SECRET) throw new AuthError("SUPABASE_JWT_SECRET missing for HS256 project");
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), opts);
      if (!payload.sub) throw new AuthError("no sub");
      return payload.sub;
    } catch {
      throw new AuthError("invalid token");
    }
  }

  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, opts);
    if (!payload.sub) throw new AuthError("no sub");
    return payload.sub;
  } catch {
    throw new AuthError("invalid token");
  }
}
