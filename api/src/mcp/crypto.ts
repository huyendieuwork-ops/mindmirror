/** Mã hoá token connector bằng AES-GCM (WebCrypto — có sẵn trong Workers và Node 20+). */

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(secretB64: string): Promise<CryptoKey> {
  const raw = fromB64(secretB64);
  if (raw.length !== 32) throw new Error("CONNECTOR_ENC_KEY phải là 32 byte base64 (openssl rand -base64 32)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secretB64), enc.encode(plain)));
  return `v1.${toB64(iv)}.${toB64(ct)}`;
}

export async function decryptSecret(blob: string, secretB64: string): Promise<string> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("bad secret format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(secretB64), fromB64(ct));
  return dec.decode(pt);
}

/**
 * Chặn SSRF: URL MCP do người dùng nhập ⇒ chỉ cho https, không cho IP nội bộ / localhost.
 * Có thể giới hạn thêm bằng MCP_ALLOWED_HOSTS (danh sách host, phân tách dấu phẩy).
 */
export function checkMcpUrl(raw: string, opts: { allowedHosts?: string | null; allowLocal?: boolean } = {}): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid_url"); }
  const host = u.hostname.toLowerCase();
  const local = host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host) || /^0\./.test(host);
  const privateIp = /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || /^\[?f[cd]/.test(host);
  if (opts.allowLocal && local && (u.protocol === "http:" || u.protocol === "https:")) return u;
  if (u.protocol !== "https:") throw new Error("https_required");
  if (local || privateIp) throw new Error("private_host_blocked");
  const allow = (opts.allowedHosts ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error("host_not_allowed");
  return u;
}
