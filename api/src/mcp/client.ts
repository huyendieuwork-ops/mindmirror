/**
 * MCP client tối giản (JSON-RPC 2.0 qua Streamable HTTP) — chạy được trong Cloudflare Workers.
 * Hỗ trợ: initialize, tools/list, tools/call, resources/read. Phản hồi có thể là JSON hoặc SSE.
 * Chỉ dùng chiều ĐỌC; MindMirror không gọi tool có khả năng ghi/xoá.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean; title?: string };
}

export interface McpContent {
  type: string;
  text?: string;
  resource?: { uri: string; mimeType?: string; text?: string };
  uri?: string;
  name?: string;
}

export interface McpCallResult {
  content: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export class McpError extends Error {
  constructor(message: string, readonly code: number | null = null, readonly httpStatus: number | null = null) {
    super(message);
    this.name = "McpError";
  }
}

export interface McpClientOptions {
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  clientName?: string;
}

export class McpClient {
  private sessionId: string | null = null;
  private negotiatedVersion: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(readonly url: string, private opts: McpClientOptions = {}) {}

  async initialize(): Promise<{ serverName: string | null; protocolVersion: string }> {
    const res: any = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.opts.clientName ?? "mindmirror", version: "0.2.0" },
    });
    this.negotiatedVersion = res?.protocolVersion ?? MCP_PROTOCOL_VERSION;
    this.initialized = true;
    await this.notify("notifications/initialized");
    return { serverName: res?.serverInfo?.name ?? null, protocolVersion: this.negotiatedVersion! };
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureInit();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res: any = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(res?.tools ?? []));
      cursor = res?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.ensureInit();
    const res: any = await this.request("tools/call", { name, arguments: args });
    return { content: res?.content ?? [], structuredContent: res?.structuredContent, isError: !!res?.isError };
  }

  async readResource(uri: string): Promise<{ uri: string; mimeType?: string; text?: string }[]> {
    await this.ensureInit();
    const res: any = await this.request("resources/read", { uri });
    return res?.contents ?? [];
  }

  private async ensureInit() {
    if (!this.initialized) await this.initialize();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.opts.token) h.authorization = `Bearer ${this.opts.token}`;
    if (this.sessionId) h["mcp-session-id"] = this.sessionId;
    if (this.negotiatedVersion) h["mcp-protocol-version"] = this.negotiatedVersion;
    return h;
  }

  private async notify(method: string, params?: unknown) {
    const r = await this.post({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
    if (!r.ok && r.status !== 202) throw new McpError(`notify ${method} HTTP ${r.status}`, null, r.status);
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const r = await this.post({ jsonrpc: "2.0", id, method, params });
    if (!r.ok) throw new McpError(`${method} HTTP ${r.status}`, null, r.status);
    const sid = r.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    const ctype = r.headers.get("content-type") ?? "";
    const messages: any[] = ctype.includes("text/event-stream") ? parseSse(await r.text()) : [await r.json()];
    const msg = messages.flat().find((m) => m && m.id === id);
    if (!msg) throw new McpError(`${method}: không có phản hồi cho id ${id}`);
    if (msg.error) throw new McpError(msg.error.message ?? "MCP error", msg.error.code ?? null);
    return msg.result;
  }

  private async post(body: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
    try {
      return await (this.opts.fetchImpl ?? fetch)(this.url, { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new McpError((e as Error).name === "AbortError" ? "timeout" : "network error");
    } finally {
      clearTimeout(t);
    }
  }
}

export function parseSse(body: string): unknown[] {
  const out: unknown[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { /* bỏ qua event không phải JSON */ }
  }
  return out;
}
