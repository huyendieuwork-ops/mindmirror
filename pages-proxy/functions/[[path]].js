// Tên miền ngắn *.pages.dev: chuyển tiếp mọi request sang Worker MindMirror (giao diện + API).
import TARGET from "../target.js";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const dest = new URL(url.pathname + url.search, TARGET);
  const res = await fetch(new Request(dest, request), { redirect: "manual" });
  const out = new Response(res.body, res);
  const loc = res.headers.get("location");
  if (loc && loc.startsWith(TARGET)) out.headers.set("location", url.origin + loc.slice(TARGET.length));
  return out;
}
