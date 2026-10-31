import { GeoProxy, nativeFetch, needsGeoProxy } from "./geo-proxy";
import { createApp } from "./http/app";

export { GeoProxy };

const app = createApp();
let geo: DurableObjectNamespace | undefined;

// Gemini chặn vùng Hồng Kông (trạm Cloudflare gần Việt Nam) → gọi Google AI qua Durable Object đặt ở Bắc Mỹ.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!geo || !needsGeoProxy(url)) return nativeFetch(input as any, init);
  const req = new Request(input as any, init);
  const headers = new Headers(req.headers);
  headers.set("x-target-url", url);
  const stub = geo.get(geo.idFromName("google-ai-na"), { locationHint: "wnam" });
  return stub.fetch("https://geo-proxy.internal/", { method: req.method, headers, body: req.method === "GET" ? undefined : req.body });
}) as typeof fetch;

// Entry cho Cloudflare Workers
export default {
  fetch(request: Request, env: any, ctx: ExecutionContext) {
    geo = env?.GEO_PROXY;
    return app.fetch(request, env, ctx);
  },
};
