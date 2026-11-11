/**
 * Tải một trang trong danh sách nguồn chính thống — code tự tải, không tin đoạn tóm tắt của dịch vụ tìm kiếm.
 *  - L5: tự xử lý chuyển hướng (tối đa 3 lần); mỗi địa chỉ trung gian và địa chỉ cuối phải qua L1–L4.
 *  - Quá 5 giây thì bỏ; đọc tối đa 500 KB; chỉ nhận HTML hoặc text; không đi theo link bên trong trang.
 */
import { checkUrl, DEFAULT_SUBJECT, type AllowEntry } from "./allowlist";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class WebFetchError extends Error {
  constructor(readonly code: "L1" | "L2" | "L3" | "L4" | "L5" | "timeout" | "http" | "content_type" | "empty" | "network", message: string) {
    super(message);
  }
}

export interface FetchedPage {
  url: string;        // địa chỉ CUỐI mà code đã tải (L6: link hiển thị lấy từ đây)
  title: string;
  text: string;       // phần chữ của trang (đã bỏ thẻ, script, style)
  entry: AllowEntry;
  truncated: boolean;
}

export interface FetchOptions {
  fetch?: FetchFn;
  subject?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

export const USER_AGENT = "MindMirrorBot/1.0 (+https://mindmirror-vn.pages.dev; education)";

export async function fetchAllowedPage(raw: string, o: FetchOptions = {}): Promise<FetchedPage> {
  const doFetch = o.fetch ?? ((u, i) => fetch(u, i));
  const subject = o.subject ?? DEFAULT_SUBJECT;
  const maxRedirects = o.maxRedirects ?? 3;
  let current = raw;
  for (let hop = 0; ; hop++) {
    const chk = checkUrl(current, subject);
    if (!chk.ok) throw new WebFetchError(hop === 0 ? chk.code : "L5", hop === 0 ? chk.reason : `redirect_${chk.reason}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 5000);
    let res: Response;
    try {
      res = await doFetch(chk.url.toString(), {
        redirect: "manual", signal: ctrl.signal,
        headers: { "user-agent": o.userAgent ?? USER_AGENT, accept: "text/html,text/plain;q=0.9", "accept-language": "vi,en;q=0.8" },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new WebFetchError(ctrl.signal.aborted ? "timeout" : "network", (e as Error).message?.slice(0, 80) ?? "fetch_failed");
    }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) throw new WebFetchError("http", "redirect_without_location");
      if (hop >= maxRedirects) throw new WebFetchError("L5", "too_many_redirects");
      current = new URL(loc, chk.url).toString();
      continue;
    }
    try {
      if (!res.ok) throw new WebFetchError("http", `status_${res.status}`);
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const isHtml = ct.includes("text/html") || ct.includes("application/xhtml");
      if (!isHtml && !ct.includes("text/plain")) throw new WebFetchError("content_type", ct.split(";")[0] || "unknown");
      const { body, truncated } = await readCapped(res, o.maxBytes ?? 500_000);
      const { title, text } = isHtml ? htmlToText(body) : { title: "", text: body.trim() };
      if (text.length < 80) throw new WebFetchError("empty", "no_text");
      return { url: chk.url.toString(), title: title || chk.entry.name, text, entry: chk.entry, truncated };
    } catch (e) {
      if (e instanceof WebFetchError) throw e;
      throw new WebFetchError(ctrl.signal.aborted ? "timeout" : "network", (e as Error).message?.slice(0, 80) ?? "read_failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readCapped(res: Response, max: number): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) {
    const t = await res.text();
    return { body: t.slice(0, max), truncated: t.length > max };
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
    if (size >= max) { truncated = true; await reader.cancel().catch(() => {}); break; }
  }
  const buf = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const p of parts) { const n = Math.min(p.byteLength, buf.length - off); buf.set(p.subarray(0, n), off); off += n; if (off >= buf.length) break; }
  return { body: new TextDecoder("utf-8").decode(buf), truncated };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → chữ thuần: bỏ script/style/điều hướng/chú thích, giữ ngắt đoạn. Không chạy bất kỳ mã nào của trang. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const body = html.replace(/<head[\s>][\s\S]*?<\/head>/i, " ").replace(/<title[^>]*>[\s\S]*?<\/title>/gi, " ");
  const main = /<main[\s>][\s\S]*?<\/main>/i.exec(body)?.[0] ?? /<article[\s>][\s\S]*?<\/article>/i.exec(body)?.[0] ?? body;
  let t = main
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, "")       // [1] chú thích Wikipedia
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|li|tr|h[1-6]|pre|blockquote|table|dd|dt)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(t)
    .replace(/\[(sửa|edit|sửa mã nguồn|cần dẫn nguồn)\]/gi, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text: t };
}
