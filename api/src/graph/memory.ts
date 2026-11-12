import { pageKey, rankSeeds, type ConceptNode, type GraphRelation, type GraphStore, type GraphView, type GraphWrite, type NeighborhoodResult } from "./types";

/** Đồ thị trong bộ nhớ — cho test, eval offline và chạy local khi chưa có Neo4j. Cùng hợp đồng với Neo4jGraphStore. */
export class MemoryGraphStore implements GraphStore {
  readonly kind = "memory";
  concepts = new Map<string, ConceptNode & { userId: string }>();           // userId|key
  documents = new Map<string, { userId: string; id: string; title: string }>(); // userId|id
  pages = new Map<string, { userId: string; documentId: string; page: number | null; v?: number }>(); // userId|pageKey
  relations: (GraphRelation & { userId: string })[] = [];
  mentions: { userId: string; concept: string; pageKey: string; chunkId: string; quote: string }[] = [];

  async ping() { return true; }
  async ensureSchema() {}

  async write(w: GraphWrite) {
    const u = w.userId;
    for (const d of w.documents) this.documents.set(`${u}|${d.id}`, { userId: u, ...d });
    for (const p of w.pages) this.pages.set(`${u}|${pageKey(p.documentId, p.page)}`, { userId: u, ...p });
    for (const c of w.concepts) {
      const k = `${u}|${c.key}`;
      const old = this.concepts.get(k);
      this.concepts.set(k, old ? { ...old, description: old.description || c.description, aliases: [...new Set([...old.aliases, ...c.aliases])], parent: old.parent ?? c.parent ?? null } : { userId: u, ...c });
    }
    for (const m of w.mentions) {
      const pk = pageKey(m.evidence.documentId, m.evidence.page);
      if (!this.mentions.some((x) => x.userId === u && x.concept === m.concept && x.pageKey === pk))
        this.mentions.push({ userId: u, concept: m.concept, pageKey: pk, chunkId: m.evidence.chunkId, quote: m.evidence.quote });
    }
    for (const r of w.relations) {
      const i = this.relations.findIndex((x) => x.userId === u && x.from === r.from && x.to === r.to && x.type === r.type);
      if (i >= 0) this.relations[i] = { userId: u, ...r };
      else this.relations.push({ userId: u, ...r });
    }
  }

  async extractedPages(userId: string, documentIds: string[], minVersion = 0) {
    return new Set([...this.pages.values()].filter((p) => p.userId === userId && documentIds.includes(p.documentId) && (p.v ?? 1) >= minVersion).map((p) => pageKey(p.documentId, p.page)));
  }

  private name(userId: string, key: string) { return this.concepts.get(`${userId}|${key}`)?.name ?? key; }

  async neighborhood(userId: string, documentIds: string[], q: { keys: string[]; pageKeys: string[] }, limit = 20): Promise<NeighborhoodResult> {
    const mine = [...this.concepts.values()].filter((c) => c.userId === userId);
    const nameHit = (c: ConceptNode) => q.keys.some((k) => c.key === k || c.aliases.includes(k) || (k.length >= 3 && c.key.length >= 3 && (c.key.includes(k) || k.includes(c.key))));
    const pageRank = (c: ConceptNode) => {
      const ranks = this.mentions.filter((m) => m.userId === userId && m.concept === c.key).map((m) => q.pageKeys.indexOf(m.pageKey)).filter((i) => i >= 0);
      return ranks.length ? Math.min(...ranks) : null;
    };
    const seeds = rankSeeds(mine.map((c) => ({ c, byName: nameHit(c), pageRank: pageRank(c) })).filter((x) => x.byName || x.pageRank !== null))
      .map((x) => ({ key: x.c.key, name: x.c.name, byName: x.byName, pageRank: x.pageRank }));
    const seedKeys = new Set(seeds.map((s) => s.key));
    const relations = this.relations
      .filter((r) => r.userId === userId && (seedKeys.has(r.from) || seedKeys.has(r.to)))
      .filter((r) => !documentIds.length || documentIds.includes(r.evidence.documentId))
      .slice(0, limit)
      .map(({ userId: _u, ...r }) => ({ ...r, fromName: this.name(userId, r.from), toName: this.name(userId, r.to) }));
    return { seeds, relations };
  }

  async view(userId: string, documentIds: string[], limit = 150, minVersion = 0): Promise<GraphView> {
    const inDocs = (docId: string) => !documentIds.length || documentIds.includes(docId);
    const mentions = this.mentions.filter((m) => m.userId === userId && inDocs(m.pageKey.split(":")[0]!));
    const relations = this.relations.filter((r) => r.userId === userId && inDocs(r.evidence.documentId));
    const keys = new Set([...mentions.map((m) => m.concept), ...relations.flatMap((r) => [r.from, r.to])]);
    const concepts = [...keys].slice(0, limit).map((k) => {
      const c = this.concepts.get(`${userId}|${k}`)!;
      const ms = mentions.filter((m) => m.concept === k);
      return {
        key: c.key, name: c.name, description: c.description, aliases: c.aliases, parent: c.parent ?? null,
        pages: [...new Set(ms.map((m) => this.pages.get(`${userId}|${m.pageKey}`)?.page ?? null))],
        documentIds: [...new Set(ms.map((m) => m.pageKey.split(":")[0]!))],
      };
    });
    const shown = new Set(concepts.map((c) => c.key));
    const docs = [...this.documents.values()].filter((d) => d.userId === userId && inDocs(d.id));
    return {
      concepts,
      relations: relations.filter((r) => shown.has(r.from) && shown.has(r.to)).map(({ userId: _u, ...r }) => ({ ...r, fromName: this.name(userId, r.from), toName: this.name(userId, r.to) })),
      documents: docs.map((d) => ({ id: d.id, title: d.title, extractedPages: [...this.pages.values()].filter((p) => p.userId === userId && p.documentId === d.id && (p.v ?? 1) >= minVersion).length })),
    };
  }

  async deleteDocument(userId: string, documentId: string) {
    for (const [k, p] of this.pages) if (p.userId === userId && p.documentId === documentId) this.pages.delete(k);
    this.documents.delete(`${userId}|${documentId}`);
    this.mentions = this.mentions.filter((m) => !(m.userId === userId && m.pageKey.startsWith(`${documentId}:`)));
    this.relations = this.relations.filter((r) => !(r.userId === userId && r.evidence.documentId === documentId));
    const used = new Set([...this.mentions.filter((m) => m.userId === userId).map((m) => m.concept), ...this.relations.filter((r) => r.userId === userId).flatMap((r) => [r.from, r.to])]);
    for (const [k, c] of this.concepts) if (c.userId === userId && !used.has(c.key)) this.concepts.delete(k);
  }

  async deleteUser(userId: string) {
    for (const m of [this.concepts, this.documents, this.pages] as Map<string, { userId: string }>[]) for (const [k, v] of m) if (v.userId === userId) m.delete(k);
    this.relations = this.relations.filter((r) => r.userId !== userId);
    this.mentions = this.mentions.filter((m) => m.userId !== userId);
  }
}
