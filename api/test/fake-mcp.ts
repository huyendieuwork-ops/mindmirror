/** MCP server giả lập (Streamable HTTP) giống một Drive connector: search + read_file + 1 tool nguy hiểm. */
export function fakeDriveMcp(files: Record<string, { title: string; text: string }>, opts: { requireToken?: string } = {}) {
  const log: { method: string; session: string | null; auth: string | null; args?: any }[] = [];
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const h = init.headers as Record<string, string>;
    log.push({ method: body.method, session: h["mcp-session-id"] ?? null, auth: h.authorization ?? null, args: body.params?.arguments });
    if (opts.requireToken && h.authorization !== `Bearer ${opts.requireToken}`) return new Response("unauthorized", { status: 401 });
    if (!("id" in body)) return new Response(null, { status: 202 }); // notification
    const reply = (result: unknown, sse = false, headers: Record<string, string> = {}) => {
      const msg = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
      return sse
        ? new Response(`event: message\ndata: ${msg}\n\n`, { headers: { "content-type": "text/event-stream", ...headers } })
        : new Response(msg, { headers: { "content-type": "application/json", ...headers } });
    };
    switch (body.method) {
      case "initialize":
        return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-drive" } }, false, { "mcp-session-id": "sess-123" });
      case "tools/list":
        return reply({ tools: [
          { name: "delete_file", description: "Xoá file", inputSchema: { properties: { fileId: {} } }, annotations: { destructiveHint: true } },
          { name: "search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
          { name: "read_file", inputSchema: { type: "object", properties: { fileId: { type: "string" } } }, annotations: { readOnlyHint: true } },
        ] });
      case "tools/call": {
        const { name, arguments: a } = body.params;
        if (name === "search") {
          const q = String(a.query ?? "").toLowerCase();
          const items = Object.entries(files).filter(([, f]) => f.title.toLowerCase().includes(q)).map(([id, f]) => ({ id, name: f.title, mimeType: "application/pdf" }));
          return reply({ content: [{ type: "text", text: JSON.stringify({ files: items }) }] }, true);
        }
        if (name === "read_file") {
          const f = files[a.fileId];
          return reply(f ? { content: [{ type: "text", text: f.text }] } : { content: [{ type: "text", text: "not found" }], isError: true }, true);
        }
        return reply({ content: [{ type: "text", text: "unknown tool" }], isError: true });
      }
      default:
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } }), { headers: { "content-type": "application/json" } });
    }
  }) as unknown as typeof fetch;
  return { fetchImpl, log };
}
