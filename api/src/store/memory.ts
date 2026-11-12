import type { Chunk, LibraryDocument, MirrorCard, RetrievedChunk, Session, TurnResult, UserSettings } from "../agent/types";
import type { ChunkQuery, ConnectorRecord, FolderRecord, NoteRecord, SessionListItem, Store, TraceRecord, UsageEntry } from "./types";
import { bm25Rank, rrf, vectorRank } from "../rag/hybrid";
import type { WebPassage } from "../web/search";

/** Store trong bộ nhớ — cho test, CLI và `wrangler dev` khi chưa nối Supabase. */
export class MemoryStore implements Store {
  sessions = new Map<string, Session>();
  cards = new Map<string, MirrorCard>();
  turns = new Map<string, TurnResult>();
  settings = new Map<string, UserSettings>();
  usage: UsageEntry[] = [];
  documents = new Map<string, LibraryDocument>();
  chunks = new Map<string, Chunk[]>(); // documentId → chunks
  connectors = new Map<string, ConnectorRecord>();
  folders = new Map<string, FolderRecord>();
  notes = new Map<string, NoteRecord>();
  traces: TraceRecord[] = [];
  webCache = new Map<string, { passages: WebPassage[]; expiresAt: string }>();
  webSearches: { userId: string; at: string }[] = [];

  async getWebCache(key: string, nowIso: string) {
    const c = this.webCache.get(key);
    return c && c.expiresAt > nowIso ? structuredClone(c.passages) : null;
  }
  async putWebCache(key: string, passages: WebPassage[], _fetchedAt: string, expiresAt: string) {
    this.webCache.set(key, { passages: structuredClone(passages), expiresAt });
  }
  async countWebSearchesSince(userId: string, sinceIso: string) {
    return this.webSearches.filter((x) => x.userId === userId && x.at >= sinceIso).length;
  }
  async logWebSearch(userId: string, atIso: string) { this.webSearches.push({ userId, at: atIso }); }

  async createSession(s: Session) { this.sessions.set(s.id, structuredClone(s)); }
  async getSession(id: string, userId: string) {
    const s = this.sessions.get(id);
    return s && s.userId === userId ? structuredClone(s) : null;
  }
  async listSessions(userId: string, limit: number): Promise<SessionListItem[]> {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => ({ id: s.id, mode: s.state.mode, topic: s.state.topic, phase: s.state.phase, status: s.status, updatedAt: s.updatedAt }));
  }
  async saveSession(s: Session) { this.sessions.set(s.id, structuredClone(s)); }
  async saveCard(sessionId: string, userId: string, card: MirrorCard) {
    if (this.sessions.get(sessionId)?.userId === userId) this.cards.set(sessionId, card);
  }
  async getCard(sessionId: string, userId: string) {
    return this.sessions.get(sessionId)?.userId === userId ? this.cards.get(sessionId) ?? null : null;
  }
  async getTurnResult(sessionId: string, clientTurnId: string) { return this.turns.get(`${sessionId}:${clientTurnId}`) ?? null; }
  async saveTurnResult(sessionId: string, clientTurnId: string, r: TurnResult) { this.turns.set(`${sessionId}:${clientTurnId}`, r); }
  async countSessionsSince(userId: string, sinceIso: string) {
    return [...this.sessions.values()].filter((s) => s.userId === userId && s.createdAt >= sinceIso).length;
  }
  async getSettings(userId: string) { return this.settings.get(userId) ?? null; }
  async saveSettings(userId: string, s: UserSettings) { this.settings.set(userId, s); }
  async logUsage(e: UsageEntry) { this.usage.push(e); }
  async deleteUserData(userId: string, scope: "sessions" | "all") {
    for (const [id, s] of this.sessions) if (s.userId === userId) { this.sessions.delete(id); this.cards.delete(id); }
    if (scope === "all") {
      this.settings.delete(userId);
      for (const d of await this.listDocuments(userId)) await this.deleteDocument(userId, d.id);
      for (const c of await this.listConnectors(userId)) this.connectors.delete(c.id);
      for (const [id, f] of this.folders) if (f.userId === userId) this.folders.delete(id);
      for (const [id, n] of this.notes) if (n.userId === userId) this.notes.delete(id);
      this.traces = this.traces.filter((t) => t.userId !== userId);
    }
  }

  async saveDocument(doc: LibraryDocument, chunks: Chunk[]) {
    this.documents.set(doc.id, structuredClone(doc));
    this.chunks.set(doc.id, structuredClone(chunks));
  }
  async listDocuments(userId: string) {
    return [...this.documents.values()].filter((d) => d.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getDocuments(userId: string, ids: string[]) {
    return ids.map((id) => this.documents.get(id)).filter((d): d is LibraryDocument => !!d && d.userId === userId);
  }
  async findDocumentByHash(userId: string, hash: string) {
    return [...this.documents.values()].find((d) => d.userId === userId && d.contentHash === hash) ?? null;
  }
  async deleteDocument(userId: string, id: string) {
    const d = this.documents.get(id);
    if (!d || d.userId !== userId) return false;
    this.documents.delete(id);
    this.chunks.delete(id);
    return true;
  }
  graphBuilds: { userId: string; at: string; pages: number }[] = [];
  async listChunks(userId: string, documentId: string) {
    return (this.chunks.get(documentId) ?? []).filter((c) => c.userId === userId).sort((a, b) => a.ordinal - b.ordinal);
  }
  async countGraphBuildsSince(userId: string, sinceIso: string) {
    return this.graphBuilds.filter((x) => x.userId === userId && x.at >= sinceIso).length;
  }
  async logGraphBuild(userId: string, atIso: string, pages: number) { this.graphBuilds.push({ userId, at: atIso, pages }); }

  async getChunks(userId: string, ids: string[]): Promise<RetrievedChunk[]> {
    const want = new Set(ids);
    const out: RetrievedChunk[] = [];
    for (const list of this.chunks.values())
      for (const c of list)
        if (want.has(c.id) && c.userId === userId)
          out.push({ chunk: c, documentTitle: this.documents.get(c.documentId)?.title ?? "", score: 1, lexicalRank: null, vectorRank: null });
    return out;
  }

  async searchChunks(userId: string, documentIds: string[], q: ChunkQuery, k: number): Promise<RetrievedChunk[]> {
    const docs = await this.getDocuments(userId, documentIds);
    const titles = new Map(docs.map((d) => [d.id, d.title]));
    const pool = docs.flatMap((d) => this.chunks.get(d.id) ?? []).filter((c) => c.userId === userId);
    const lists = [bm25Rank(q.text, pool)];
    if (q.embedding) lists.push(vectorRank(q.embedding, pool));
    return rrf(lists).slice(0, k).map((r) => ({
      chunk: r.chunk, documentTitle: titles.get(r.chunk.documentId) ?? "", score: r.score,
      lexicalRank: r.ranks[0] ?? null, vectorRank: r.ranks[1] ?? null,
    }));
  }

  // ---- Thư mục ----
  async listFolders(userId: string) {
    return [...this.folders.values()].filter((f) => f.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((f) => structuredClone(f));
  }
  async saveFolder(f: FolderRecord) { this.folders.set(f.id, structuredClone(f)); }
  async listNotes(userId: string) {
    return [...this.notes.values()].filter((n) => n.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((n) => structuredClone(n));
  }
  async saveNote(n: NoteRecord) {
    const old = this.notes.get(n.id);
    if (old && old.userId !== n.userId) throw new Error("note belongs to another user");
    this.notes.set(n.id, structuredClone(n));
  }
  async deleteNote(userId: string, id: string) {
    const n = this.notes.get(id);
    if (!n || n.userId !== userId) return false;
    return this.notes.delete(id);
  }
  async deleteFolder(userId: string, id: string) {
    const f = this.folders.get(id);
    if (!f || f.userId !== userId) return false;
    this.folders.delete(id);
    for (const d of this.documents.values()) if (d.userId === userId && d.folderId === id) d.folderId = null;
    return true;
  }
  async setDocumentFolder(userId: string, documentId: string, folderId: string | null) {
    const d = this.documents.get(documentId);
    if (!d || d.userId !== userId) return false;
    d.folderId = folderId;
    return true;
  }

  async saveConnector(c: ConnectorRecord) { this.connectors.set(c.id, structuredClone(c)); }
  async listConnectors(userId: string) { return [...this.connectors.values()].filter((c) => c.userId === userId); }
  async getConnector(userId: string, id: string) {
    const c = this.connectors.get(id);
    return c && c.userId === userId ? structuredClone(c) : null;
  }
  async deleteConnector(userId: string, id: string) {
    if (this.connectors.get(id)?.userId === userId) this.connectors.delete(id);
  }

  async saveTrace(t: TraceRecord) { this.traces.push(t); }
  async listTraces(userId: string, sessionId: string) {
    return this.traces.filter((t) => t.userId === userId && t.sessionId === sessionId);
  }
}
