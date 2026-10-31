import { McpClient, type McpCallResult, type McpTool } from "./client";
import type { ConnectorRecord } from "../store/types";

/**
 * Biến một MCP server (Google Drive, Notion, LMS…) thành "nguồn học liệu" CHỈ ĐỌC:
 *   discover() → tìm tool tìm kiếm + tool đọc nội dung (qua tools/list)
 *   search()   → liệt kê tài liệu người dùng được cấp quyền
 *   fetch()    → lấy văn bản để đưa vào thư viện RAG
 * Mọi nội dung lấy về là DỮ LIỆU KHÔNG TIN CẬY (có thể chứa prompt injection).
 */

export type Preset = ConnectorRecord["preset"];

// Gợi ý tên tool theo server phổ biến — vẫn kiểm tra lại bằng tools/list vì tên có thể đổi theo phiên bản.
export const PRESETS: Record<Preset, { search: string[]; fetch: string[] }> = {
  google_drive: { search: ["search", "gdrive_search", "search_files", "drive_search"], fetch: ["read_file", "gdrive_read_file", "get_file_content", "fetch"] },
  notion: { search: ["notion-search", "search", "API-post-search"], fetch: ["notion-fetch", "fetch", "API-retrieve-a-page"] },
  generic: { search: ["search"], fetch: ["fetch", "read", "get"] },
};

const QUERY_ARGS = ["query", "q", "search", "searchQuery", "text", "keyword"];
const ID_ARGS = ["id", "fileId", "file_id", "documentId", "page_id", "pageId", "uri", "url"];

export interface DiscoveredTools {
  search: string;
  fetch: string;
  queryArg: string;
  idArg: string;
  fetchMode: "tool" | "resource";
}

export class ConnectorError extends Error {
  constructor(readonly code: "no_search_tool" | "no_fetch_tool" | "unsafe_tool" | "tool_error" | "empty_content", message?: string) {
    super(message ?? code);
  }
}

/** Tool chỉ được dùng nếu KHÔNG khai báo là có thể ghi/xoá. */
export function isReadSafe(t: McpTool): boolean {
  if (t.annotations?.destructiveHint === true) return false;
  if (t.annotations?.readOnlyHint === false) return false;
  return !/(delete|remove|create|update|write|upload|move|share|trash|append|insert|post-page|patch)/i.test(t.name.replace(/^API-post-search$/, "search"));
}

export function discoverTools(tools: McpTool[], preset: Preset): DiscoveredTools {
  const safe = tools.filter(isReadSafe);
  const byName = (names: string[]) => names.map((n) => safe.find((t) => t.name === n)).find(Boolean);
  const search = byName(PRESETS[preset].search) ?? safe.find((t) => /search|find|query|list/i.test(t.name));
  if (!search) throw new ConnectorError("no_search_tool");
  const fetchTool = byName(PRESETS[preset].fetch) ?? safe.find((t) => t !== search && /(fetch|read|get|retrieve|content|download|export)/i.test(t.name));
  // Không có tool đọc → dùng resources/read với URI do tool tìm kiếm trả về (vd gdrive:///<id>)
  if (!fetchTool) return { search: search.name, fetch: "", queryArg: argOfSearch(search), idArg: "uri", fetchMode: "resource" };
  function argOfSearch(t: McpTool) { return argOf(t, QUERY_ARGS); }
  function argOf(t: McpTool, cands: string[]) {
    const props = Object.keys(t.inputSchema?.properties ?? {});
    return cands.find((c) => props.includes(c)) ?? t.inputSchema?.required?.[0] ?? props[0] ?? cands[0]!;
  }
  return { search: search.name, fetch: fetchTool.name, queryArg: argOf(search, QUERY_ARGS), idArg: argOf(fetchTool, ID_ARGS), fetchMode: "tool" };
}

export interface RemoteItem {
  id: string;
  title: string;
  mimeType?: string | null;
  url?: string | null;
}

export class McpLibrarySource {
  constructor(private client: McpClient, private tools: DiscoveredTools) {}

  async search(query: string, limit = 20): Promise<RemoteItem[]> {
    const res = await this.client.callTool(this.tools.search, { [this.tools.queryArg]: query });
    if (res.isError) throw new ConnectorError("tool_error", textOf(res).slice(0, 200));
    return parseItems(res).slice(0, limit);
  }

  async fetch(item: Pick<RemoteItem, "id">): Promise<{ text: string; truncated: boolean }> {
    let text = "";
    if (this.tools.fetchMode === "resource") {
      const contents = await this.client.readResource(item.id);
      text = contents.map((c) => c.text ?? "").join("\n\n");
    } else {
      const res = await this.client.callTool(this.tools.fetch, { [this.tools.idArg]: item.id });
      if (res.isError) throw new ConnectorError("tool_error", textOf(res).slice(0, 200));
      text = textOf(res);
      // Một số server trả JSON {content|text|markdown}
      const asJson = tryJson(text);
      if (asJson && typeof asJson === "object") {
        const v = (asJson as any).text ?? (asJson as any).content ?? (asJson as any).markdown;
        if (typeof v === "string") text = v;
      }
    }
    const MAX = 300_000;
    if (!text.trim()) throw new ConnectorError("empty_content");
    return { text: text.slice(0, MAX), truncated: text.length > MAX };
  }
}

function textOf(r: McpCallResult): string {
  return r.content
    .map((c) => c.text ?? c.resource?.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function tryJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Đọc danh sách kết quả từ structuredContent / JSON / resource_link / dòng văn bản. */
export function parseItems(r: McpCallResult): RemoteItem[] {
  const fromObj = (o: any): RemoteItem | null => {
    if (!o || typeof o !== "object") return null;
    const id = o.id ?? o.fileId ?? o.uri ?? o.url ?? o.page_id;
    const title = o.title ?? o.name ?? o.filename ?? (typeof id === "string" ? id : null);
    return id && title ? { id: String(id), title: String(title), mimeType: o.mimeType ?? o.mime_type ?? null, url: o.url ?? o.webViewLink ?? null } : null;
  };
  const fromAny = (v: any): RemoteItem[] => {
    if (Array.isArray(v)) return v.map(fromObj).filter((x): x is RemoteItem => !!x);
    if (v && typeof v === "object") {
      for (const k of ["results", "files", "items", "documents", "pages", "data"]) if (Array.isArray(v[k])) return fromAny(v[k]);
      const one = fromObj(v);
      return one ? [one] : [];
    }
    return [];
  };

  const structured = fromAny(r.structuredContent);
  if (structured.length) return structured;

  const out: RemoteItem[] = [];
  for (const c of r.content) {
    if (c.type === "resource_link" && c.uri) out.push({ id: c.uri, title: c.name ?? c.uri, mimeType: (c as any).mimeType ?? null });
    if (c.type === "resource" && c.resource?.uri) out.push({ id: c.resource.uri, title: c.resource.uri, mimeType: c.resource.mimeType ?? null });
    if (c.type === "text" && c.text) {
      const j = tryJson(c.text);
      if (j) out.push(...fromAny(j));
      else {
        // "Tên tài liệu (id: abc123)" hoặc "abc123 — Tên tài liệu"
        for (const line of c.text.split("\n")) {
          const m = /^\s*[-*]?\s*(.+?)\s*\((?:id|ID)[:=]\s*([\w\-:/.]+)\)/.exec(line) ?? /^\s*[-*]?\s*([\w\-]{10,})\s+[—-]\s+(.+)$/.exec(line);
          if (m) out.push(m[0].includes("(") ? { id: m[2]!, title: m[1]! } : { id: m[1]!, title: m[2]! });
        }
      }
    }
  }
  return out;
}
