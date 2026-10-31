/**
 * Gemini chặn một số vùng (vd trạm Cloudflare ở Hồng Kông → 400 "User location is not supported").
 * Durable Object này được tạo ở Bắc Mỹ (locationHint "wnam") và chỉ chuyển tiếp request tới Google AI.
 */

// Giữ fetch gốc trước khi index.ts bọc lại globalThis.fetch.
export const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

const ALLOWED = "https://generativelanguage.googleapis.com/";

export class GeoProxy {
  constructor(_state: unknown, _env: unknown) {}

  async fetch(req: Request): Promise<Response> {
    const target = req.headers.get("x-target-url") ?? "";
    if (!target.startsWith(ALLOWED)) return new Response("forbidden", { status: 403 });
    const headers = new Headers(req.headers);
    headers.delete("x-target-url");
    return nativeFetch(target, { method: req.method, headers, body: req.method === "GET" ? undefined : req.body });
  }
}

/** URL có cần đi qua proxy không. */
export function needsGeoProxy(url: string): boolean {
  return url.startsWith(ALLOWED);
}
