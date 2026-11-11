/**
 * Neo4j (Aura Free) qua Query API HTTP v2 — chạy được trong Cloudflare Worker (không cần driver Bolt/TCP).
 *   POST https://<host>/db/<database>/query/v2   { statement, parameters }   Basic auth
 * Mọi câu Cypher đều có điều kiện userId = $userId (userId lấy từ phiên đăng nhập ở backend).
 * Kiểu quan hệ không tham số hoá được trong Cypher → chỉ chèn từ danh sách cố định REL_TYPES (không từ dữ liệu người dùng).
 */
import { pageKey, rankSeeds, REL_TYPES, type GraphStore, type GraphView, type GraphWrite, type NeighborhoodResult, type RelType } from "./types";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class Neo4jError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
  }
}

export interface Neo4jConfig {
  uri: string;          // neo4j+s://xxxx.databases.neo4j.io hoặc https://...
  username: string;
  password: string;
  database?: string;    // mặc định "neo4j"
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** neo4j+s://host:7687 → https://host */
export function queryEndpoint(uri: string, database = "neo4j"): string {
  const u = new URL(uri.trim().replace(/^neo4j(\+s|\+ssc)?:\/\//, "https://").replace(/^bolt(\+s|\+ssc)?:\/\//, "https://"));
  if (u.protocol !== "https:") throw new Neo4jError("config", "neo4j_uri_must_be_tls");
  return `https://${u.hostname}/db/${encodeURIComponent(database)}/query/v2`;
}

export class Neo4jGraphStore implements GraphStore {
  readonly kind = "neo4j";
  private endpoint: string;
  private auth: string;
  private doFetch: FetchFn;
  private schemaReady = false;

  constructor(private cfg: Neo4jConfig) {
    this.endpoint = queryEndpoint(cfg.uri, cfg.database?.trim() || "neo4j");
    const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "").trim(); // bỏ ký tự vô hình khi copy secret
    this.auth = `Basic ${btoa(`${clean(cfg.username)}:${clean(cfg.password)}`)}`;
    this.doFetch = cfg.fetch ?? ((u, i) => fetch(u, i));
  }

  /** Chạy một câu Cypher, trả về mảng object theo tên cột. */
  async run<T = Record<string, unknown>>(statement: string, parameters: Record<string, unknown> = {}): Promise<T[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await this.doFetch(this.endpoint, {
        method: "POST", signal: ctrl.signal,
        headers: { authorization: this.auth, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ statement, parameters }),
      });
    } catch (e) {
      throw new Neo4jError(ctrl.signal.aborted ? "timeout" : "network", (e as Error).message?.slice(0, 100) ?? "fetch_failed");
    } finally {
      clearTimeout(timer);
    }
    const body = (await res.json().catch(() => ({}))) as { data?: { fields: string[]; values: unknown[][] }; errors?: { code: string; message: string }[] };
    if (!res.ok || body.errors?.length) {
      const err = body.errors?.[0];
      throw new Neo4jError(err?.code ?? `http_${res.status}`, (err?.message ?? res.statusText).slice(0, 200), res.status);
    }
    const fields = body.data?.fields ?? [];
    return (body.data?.values ?? []).map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])) as T);
  }

  async ping() {
    const r = await this.run<{ ok: number }>("RETURN 1 AS ok");
    return r[0]?.ok === 1;
  }

  async ensureSchema() {
    if (this.schemaReady) return;
    for (const s of [
      "CREATE INDEX khainiem_user_key IF NOT EXISTS FOR (c:KhaiNiem) ON (c.userId, c.key)",
      "CREATE INDEX tailieu_user_id IF NOT EXISTS FOR (t:TaiLieu) ON (t.userId, t.id)",
      "CREATE INDEX trang_user_key IF NOT EXISTS FOR (g:Trang) ON (g.userId, g.key)",
    ]) await this.run(s);
    this.schemaReady = true;
  }

  async write(w: GraphWrite) {
    await this.ensureSchema();
    const userId = w.userId;
    if (w.documents.length)
      await this.run("UNWIND $documents AS d MERGE (t:TaiLieu {userId: $userId, id: d.id}) SET t.title = d.title", { userId, documents: w.documents });
    if (w.pages.length)
      await this.run(
        `UNWIND $pages AS p
         MATCH (t:TaiLieu {userId: $userId, id: p.documentId})
         MERGE (g:Trang {userId: $userId, key: p.key})
         SET g.documentId = p.documentId, g.page = p.page, g.extracted = true
         MERGE (g)-[:THUOC]->(t)`,
        { userId, pages: w.pages.map((p) => ({ ...p, key: pageKey(p.documentId, p.page) })) },
      );
    if (w.concepts.length)
      await this.run(
        `UNWIND $concepts AS c
         MERGE (k:KhaiNiem {userId: $userId, key: c.key})
         ON CREATE SET k.name = c.name, k.description = c.description, k.aliases = c.aliases
         ON MATCH SET k.description = coalesce(k.description, c.description),
                      k.aliases = [a IN coalesce(k.aliases, []) WHERE NOT a IN c.aliases] + c.aliases`,
        { userId, concepts: w.concepts },
      );
    if (w.mentions.length)
      await this.run(
        `UNWIND $mentions AS m
         MATCH (k:KhaiNiem {userId: $userId, key: m.concept})
         MATCH (g:Trang {userId: $userId, key: m.pageKey})
         MERGE (k)-[r:XUAT_HIEN_O]->(g)
         SET r.chunkId = m.chunkId, r.quote = m.quote`,
        { userId, mentions: w.mentions.map((m) => ({ concept: m.concept, pageKey: pageKey(m.evidence.documentId, m.evidence.page), chunkId: m.evidence.chunkId, quote: m.evidence.quote })) },
      );
    for (const type of REL_TYPES) {
      const rels = w.relations.filter((r) => r.type === type);
      if (!rels.length) continue;
      await this.run(
        `UNWIND $rels AS r
         MATCH (a:KhaiNiem {userId: $userId, key: r.from})
         MATCH (b:KhaiNiem {userId: $userId, key: r.to})
         MERGE (a)-[x:${relLiteral(type)}]->(b)
         SET x.documentId = r.documentId, x.documentTitle = r.documentTitle, x.page = r.page, x.chunkId = r.chunkId, x.quote = r.quote`,
        { userId, rels: rels.map((r) => ({ from: r.from, to: r.to, ...r.evidence })) },
      );
    }
  }

  async extractedPages(userId: string, documentIds: string[]) {
    const rows = await this.run<{ key: string }>(
      "MATCH (g:Trang {userId: $userId}) WHERE g.documentId IN $documentIds AND g.extracted RETURN g.key AS key",
      { userId, documentIds },
    );
    return new Set(rows.map((r) => r.key));
  }

  async neighborhood(userId: string, documentIds: string[], q: { keys: string[]; pageKeys: string[] }, limit = 20): Promise<NeighborhoodResult> {
    const cand = await this.run<{ key: string; name: string; byName: boolean; pages: string[] }>(
      `MATCH (s:KhaiNiem {userId: $userId})
       WITH s, (s.key IN $keys
          OR any(a IN coalesce(s.aliases, []) WHERE a IN $keys)
          OR any(k IN $keys WHERE size(k) >= 3 AND size(s.key) >= 3 AND (s.key CONTAINS k OR k CONTAINS s.key))) AS byName,
          [(s)-[:XUAT_HIEN_O]->(g:Trang {userId: $userId}) WHERE g.key IN $pageKeys | g.key] AS pages
       WHERE byName OR size(pages) > 0
       RETURN s.key AS key, s.name AS name, byName, pages LIMIT 25`,
      { userId, keys: q.keys, pageKeys: q.pageKeys },
    );
    const seeds = rankSeeds(cand.map((c) => {
      const ranks = c.pages.map((p) => q.pageKeys.indexOf(p)).filter((i) => i >= 0);
      return { key: c.key, name: c.name, byName: !!c.byName, pageRank: ranks.length ? Math.min(...ranks) : null };
    }));
    if (!seeds.length) return { seeds: [], relations: [] };
    const rows = await this.run<Record<string, any>>(
      `MATCH (s:KhaiNiem {userId: $userId}) WHERE s.key IN $seedKeys
       MATCH (s)-[r:CAN_BIET_TRUOC|LIEN_QUAN]-(o:KhaiNiem {userId: $userId})
       WHERE size($documentIds) = 0 OR r.documentId IN $documentIds
       WITH DISTINCT r
       RETURN startNode(r).key AS from, startNode(r).name AS fromName, endNode(r).key AS to, endNode(r).name AS toName,
              type(r) AS type, r.documentId AS documentId, r.documentTitle AS documentTitle, r.page AS page, r.chunkId AS chunkId, r.quote AS quote
       LIMIT $limit`,
      { userId, seedKeys: seeds.map((s) => s.key), documentIds, limit },
    );
    return { seeds, relations: rows.map(toRelation) };
  }

  async view(userId: string, documentIds: string[], limit = 60): Promise<GraphView> {
    const concepts = await this.run<Record<string, any>>(
      `MATCH (k:KhaiNiem {userId: $userId})-[:XUAT_HIEN_O]->(g:Trang {userId: $userId})
       WHERE size($documentIds) = 0 OR g.documentId IN $documentIds
       WITH k, collect(DISTINCT g.page) AS pages, collect(DISTINCT g.documentId) AS documentIds
       RETURN k.key AS key, k.name AS name, coalesce(k.description, '') AS description, coalesce(k.aliases, []) AS aliases, pages, documentIds
       ORDER BY size(pages) DESC LIMIT $limit`,
      { userId, documentIds, limit },
    );
    const keys = concepts.map((c) => c.key as string);
    const rels = await this.run<Record<string, any>>(
      `MATCH (a:KhaiNiem {userId: $userId})-[r:CAN_BIET_TRUOC|LIEN_QUAN]->(b:KhaiNiem {userId: $userId})
       WHERE a.key IN $keys AND b.key IN $keys AND (size($documentIds) = 0 OR r.documentId IN $documentIds)
       RETURN a.key AS from, a.name AS fromName, b.key AS to, b.name AS toName, type(r) AS type,
              r.documentId AS documentId, r.documentTitle AS documentTitle, r.page AS page, r.chunkId AS chunkId, r.quote AS quote
       LIMIT 200`,
      { userId, keys, documentIds },
    );
    const docs = await this.run<{ id: string; title: string; extractedPages: number }>(
      `MATCH (t:TaiLieu {userId: $userId}) WHERE size($documentIds) = 0 OR t.id IN $documentIds
       OPTIONAL MATCH (g:Trang {userId: $userId})-[:THUOC]->(t)
       RETURN t.id AS id, t.title AS title, count(g) AS extractedPages`,
      { userId, documentIds },
    );
    return {
      concepts: concepts.map((c) => ({ key: c.key, name: c.name, description: c.description, aliases: c.aliases, pages: c.pages, documentIds: c.documentIds })),
      relations: rels.map(toRelation),
      documents: docs.map((d) => ({ id: d.id, title: d.title, extractedPages: Number(d.extractedPages) })),
    };
  }

  async deleteDocument(userId: string, documentId: string) {
    await this.run("MATCH (a:KhaiNiem {userId: $userId})-[r:CAN_BIET_TRUOC|LIEN_QUAN]->(:KhaiNiem {userId: $userId}) WHERE r.documentId = $documentId DELETE r", { userId, documentId });
    await this.run("MATCH (g:Trang {userId: $userId, documentId: $documentId}) DETACH DELETE g", { userId, documentId });
    await this.run("MATCH (t:TaiLieu {userId: $userId, id: $documentId}) DETACH DELETE t", { userId, documentId });
    await this.run("MATCH (k:KhaiNiem {userId: $userId}) WHERE NOT (k)--() DELETE k", { userId });
  }

  async deleteUser(userId: string) {
    await this.run("MATCH (n {userId: $userId}) DETACH DELETE n", { userId });
  }
}

function relLiteral(t: RelType): string {
  if (!REL_TYPES.includes(t)) throw new Neo4jError("invalid_rel", "rel_type_not_allowed");
  return t;
}

function toRelation(r: Record<string, any>) {
  return {
    from: r.from, to: r.to, fromName: r.fromName, toName: r.toName, type: r.type as RelType,
    evidence: { documentId: r.documentId, documentTitle: r.documentTitle ?? "", page: r.page ?? null, chunkId: r.chunkId, quote: r.quote },
  };
}
