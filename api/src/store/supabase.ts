import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Chunk, Evidence, Gap, LibraryDocument, Message, MirrorCard, RetrievedChunk, Session, TurnResult, UserSettings } from "../agent/types";
import type { ChunkQuery, ConnectorRecord, FolderRecord, NoteRecord, SessionListItem, Store, TraceRecord, UsageEntry } from "./types";
import { searchText } from "../rag/text";
import type { WebPassage } from "../web/search";

/**
 * Store Supabase Postgres (schema: supabase/migrations/0001_init.sql).
 * Dùng service-role key ở server ⇒ vượt RLS ⇒ MỌI truy vấn tự lọc user_id.
 */
export class SupabaseStore implements Store {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    // Bỏ khoảng trắng/ký tự vô hình (hay dính khi copy-paste secret) — tránh lỗi "Invalid header value".
    const key = serviceRoleKey.replace(/[^\x21-\x7E]/g, "");
    this.db = createClient(url.trim(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async createSession(s: Session) {
    await this.saveSession(s);
  }

  async getSession(id: string, userId: string): Promise<Session | null> {
    const { data: row, error } = await this.db
      .from("learning_sessions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw asError(error);
    if (!row) return null;
    const [msgs, gaps, ev] = await Promise.all([
      this.db.from("messages").select("*").eq("session_id", id).eq("user_id", userId).order("seq", { ascending: true }),
      this.db.from("knowledge_gaps").select("*").eq("session_id", id).eq("user_id", userId),
      this.db.from("evidence").select("*").eq("session_id", id).eq("user_id", userId).order("created_at", { ascending: true }),
    ]);
    for (const r of [msgs, gaps, ev]) if (r.error) throw asError(r.error);
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status,
      state: row.state,
      settings: row.settings,
      documentIds: row.document_ids ?? [],
      rubric: row.rubric ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: (msgs.data ?? []).map((m: any): Message => ({
        id: m.id, role: m.role, text: m.text, action: m.action, intent: m.intent, citations: m.citations ?? [], webCitations: m.web_citations ?? [], createdAt: m.created_at,
      })),
      gaps: (gaps.data ?? []).map((g: any): Gap => ({ id: g.id, concept: g.concept, status: g.status, supportLevel: g.support_level })),
      evidence: (ev.data ?? []).map((e: any): Evidence => ({
        id: e.id, messageId: e.message_id, criterion: e.criterion, claim: e.claim, quote: e.quote, status: e.status,
        assisted: e.assisted, supportLevelAtTime: e.support_level_at_time,
        criterionId: e.criterion_id ?? null, sourceCitation: e.source_citation ?? null, context: e.context ?? "other", createdAt: e.created_at,
      })),
    };
  }

  async listSessions(userId: string, limit: number): Promise<SessionListItem[]> {
    const { data, error } = await this.db
      .from("learning_sessions").select("id, mode, topic, phase, status, updated_at")
      .eq("user_id", userId).order("updated_at", { ascending: false }).limit(limit);
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({ id: r.id, mode: r.mode, topic: r.topic, phase: r.phase, status: r.status, updatedAt: r.updated_at }));
  }

  async saveSession(s: Session) {
    const u = s.userId;
    const { error } = await this.db.from("learning_sessions").upsert({
      id: s.id, user_id: u, mode: s.state.mode, topic: s.state.topic, goal: s.state.goal, phase: s.state.phase,
      status: s.status, state: s.state, settings: s.settings, document_ids: s.documentIds, rubric: s.rubric, summary: s.state.summary,
      created_at: s.createdAt, updated_at: s.updatedAt,
    });
    if (error) throw asError(error);

    // Phiên MVP ≤ ~26 tin nhắn ⇒ upsert toàn bộ là chấp nhận được.
    // Thứ tự quan trọng: messages trước (evidence có FK tới message_id).
    const m = await this.db.from("messages").upsert(
      s.messages.map((m, i) => ({ id: m.id, session_id: s.id, user_id: u, seq: i, role: m.role, text: m.text, action: m.action, intent: m.intent, citations: m.citations ?? [], web_citations: m.webCitations ?? [], created_at: m.createdAt })),
    );
    if (m.error) throw asError(m.error);
    if (s.gaps.length) {
      const g = await this.db.from("knowledge_gaps").upsert(
        s.gaps.map((g) => ({ id: g.id, session_id: s.id, user_id: u, concept: g.concept, status: g.status, support_level: g.supportLevel })),
      );
      if (g.error) throw asError(g.error);
    }
    if (s.evidence.length) {
      const e = await this.db.from("evidence").upsert(
        s.evidence.map((e) => ({
          id: e.id, session_id: s.id, user_id: u, message_id: e.messageId, criterion: e.criterion, claim: e.claim,
          quote: e.quote, status: e.status, assisted: e.assisted, support_level_at_time: e.supportLevelAtTime,
          criterion_id: e.criterionId, source_citation: e.sourceCitation, context: e.context, created_at: e.createdAt,
        })),
      );
      if (e.error) throw asError(e.error);
    }
  }

  async saveCard(sessionId: string, userId: string, card: MirrorCard) {
    const { error } = await this.db.from("session_cards").upsert({ session_id: sessionId, user_id: userId, card_json: card });
    if (error) throw asError(error);
  }
  async getCard(sessionId: string, userId: string) {
    const { data, error } = await this.db.from("session_cards").select("card_json").eq("session_id", sessionId).eq("user_id", userId).maybeSingle();
    if (error) throw asError(error);
    return (data?.card_json as MirrorCard) ?? null;
  }

  async getTurnResult(sessionId: string, clientTurnId: string) {
    const { data, error } = await this.db.from("turn_requests").select("response")
      .eq("session_id", sessionId).eq("client_turn_id", clientTurnId).maybeSingle();
    if (error) throw asError(error);
    return (data?.response as TurnResult) ?? null;
  }
  async saveTurnResult(sessionId: string, clientTurnId: string, r: TurnResult) {
    const { data: s } = await this.db.from("learning_sessions").select("user_id").eq("id", sessionId).maybeSingle();
    const { error } = await this.db.from("turn_requests").upsert({ session_id: sessionId, client_turn_id: clientTurnId, user_id: s?.user_id, response: r });
    if (error) throw asError(error);
  }

  async countSessionsSince(userId: string, sinceIso: string) {
    const { count, error } = await this.db.from("learning_sessions").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", sinceIso);
    if (error) throw asError(error);
    return count ?? 0;
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    const { data, error } = await this.db.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw asError(error);
    if (!data) return null;
    return {
      aiStyle: data.ai_style, supportPreference: data.support_preference,
      challengeLevel: data.challenge_level, selfAssessment: data.self_assessment,
    };
  }
  async saveSettings(userId: string, s: UserSettings) {
    const { error } = await this.db.from("user_settings").upsert({
      user_id: userId, ai_style: s.aiStyle, support_preference: s.supportPreference,
      challenge_level: s.challengeLevel, self_assessment: s.selfAssessment, updated_at: new Date().toISOString(),
    });
    if (error) throw asError(error);
  }

  // ---- Nguồn web chính thống (bảng ở migration 0004; không mở cho client đọc) ----
  async getWebCache(key: string, nowIso: string): Promise<WebPassage[] | null> {
    const { data, error } = await this.db.from("web_source_cache").select("results,expires_at").eq("key", key).gt("expires_at", nowIso).maybeSingle();
    if (error) throw asError(error);
    return (data?.results as WebPassage[] | undefined) ?? null;
  }
  async putWebCache(key: string, passages: WebPassage[], fetchedAtIso: string, expiresAtIso: string) {
    const { error } = await this.db.from("web_source_cache").upsert({ key, results: passages, fetched_at: fetchedAtIso, expires_at: expiresAtIso });
    if (error) throw asError(error);
  }
  async countWebSearchesSince(userId: string, sinceIso: string) {
    const { count, error } = await this.db.from("web_search_log").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", sinceIso);
    if (error) throw asError(error);
    return count ?? 0;
  }
  async logWebSearch(userId: string, atIso: string) {
    const { error } = await this.db.from("web_search_log").insert({ user_id: userId, created_at: atIso });
    if (error) throw asError(error);
  }

  async logUsage(e: UsageEntry) {
    // Chỉ metadata — không lưu prompt/nội dung học.
    await this.db.from("ai_call_usage").insert({
      user_id: e.userId, session_id: e.sessionId, provider: e.provider, model: e.model, status: e.status,
      http_status: e.httpStatus ?? null, input_tokens: e.inputTokens, output_tokens: e.outputTokens,
      latency_ms: e.latencyMs, fallback: e.fallback, cost_usd: e.costUsd ?? 0,
    });
  }

  async deleteUserData(userId: string, scope: "sessions" | "all") {
    // ON DELETE CASCADE xoá messages/gaps/evidence/cards/turn_requests theo session.
    const { error } = await this.db.from("learning_sessions").delete().eq("user_id", userId);
    if (error) throw asError(error);
    if (scope === "all") {
      await this.db.from("user_settings").delete().eq("user_id", userId);
      await this.db.from("ai_call_usage").delete().eq("user_id", userId);
      await this.db.from("web_search_log").delete().eq("user_id", userId);
      await this.db.from("graph_build_log").delete().eq("user_id", userId);
      await this.db.from("documents").delete().eq("user_id", userId); // cascade chunks
      await this.db.from("folders").delete().eq("user_id", userId);
      await this.db.from("notes").delete().eq("user_id", userId);
      await this.db.from("connectors").delete().eq("user_id", userId);
      await this.db.from("agent_traces").delete().eq("user_id", userId);
    }
  }

  // ---------- Thư viện ----------
  async saveDocument(doc: LibraryDocument, chunks: Chunk[]) {
    const d = await this.db.from("documents").insert({
      id: doc.id, user_id: doc.userId, title: doc.title, kind: doc.kind, origin: doc.origin, page_count: doc.pageCount,
      chunk_count: doc.chunkCount, embedded: doc.embedded, content_hash: doc.contentHash, warnings: doc.warnings, created_at: doc.createdAt,
    });
    if (d.error) throw asError(d.error);
    for (let i = 0; i < chunks.length; i += 200) {
      const r = await this.db.from("chunks").insert(
        chunks.slice(i, i + 200).map((c) => ({
          id: c.id, document_id: c.documentId, user_id: c.userId, ordinal: c.ordinal, page: c.page, heading: c.heading,
          text: c.text, search_text: c.searchText, suspicious: c.suspicious,
          embedding: c.embedding ? JSON.stringify(c.embedding) : null, // pgvector nhận chuỗi "[...]"
        })),
      );
      if (r.error) {
        await this.db.from("documents").delete().eq("id", doc.id); // không để tài liệu dở dang
        throw asError(r.error);
      }
    }
  }

  async listDocuments(userId: string) {
    const { data, error } = await this.db.from("documents").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw asError(error);
    return (data ?? []).map(docFromRow);
  }
  async getDocuments(userId: string, ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.db.from("documents").select("*").eq("user_id", userId).in("id", ids);
    if (error) throw asError(error);
    return (data ?? []).map(docFromRow);
  }
  async findDocumentByHash(userId: string, hash: string) {
    const { data, error } = await this.db.from("documents").select("*").eq("user_id", userId).eq("content_hash", hash).maybeSingle();
    if (error) throw asError(error);
    return data ? docFromRow(data) : null;
  }
  async deleteDocument(userId: string, id: string) {
    const { data, error } = await this.db.from("documents").delete().eq("user_id", userId).eq("id", id).select("id");
    if (error) throw asError(error);
    return (data ?? []).length > 0;
  }
  async listChunks(userId: string, documentId: string): Promise<Chunk[]> {
    const { data, error } = await this.db
      .from("chunks")
      .select("id,document_id,ordinal,page,heading,text,search_text,suspicious")
      .eq("user_id", userId).eq("document_id", documentId)
      .order("ordinal", { ascending: true }).limit(2000);
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({
      id: r.id, documentId: r.document_id, userId, ordinal: r.ordinal, page: r.page, heading: r.heading, text: r.text,
      searchText: r.search_text, embedding: null, suspicious: r.suspicious,
    }));
  }
  async countGraphBuildsSince(userId: string, sinceIso: string) {
    const { count, error } = await this.db.from("graph_build_log").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", sinceIso);
    if (error) throw asError(error);
    return count ?? 0;
  }
  async logGraphBuild(userId: string, atIso: string, pages: number) {
    const { error } = await this.db.from("graph_build_log").insert({ user_id: userId, created_at: atIso, pages });
    if (error) throw asError(error);
  }

  async getChunks(userId: string, ids: string[]): Promise<RetrievedChunk[]> {
    if (!ids.length) return [];
    const { data, error } = await this.db
      .from("chunks")
      .select("id,document_id,ordinal,page,heading,text,search_text,suspicious,documents(title)")
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({
      chunk: {
        id: r.id, documentId: r.document_id, userId, ordinal: r.ordinal, page: r.page, heading: r.heading, text: r.text,
        searchText: r.search_text, embedding: null, suspicious: r.suspicious,
      },
      documentTitle: (Array.isArray(r.documents) ? r.documents[0]?.title : r.documents?.title) ?? "", score: 1, lexicalRank: null, vectorRank: null,
    }));
  }

  async searchChunks(userId: string, documentIds: string[], q: ChunkQuery, k: number): Promise<RetrievedChunk[]> {
    if (!documentIds.length) return [];
    const { data, error } = await this.db.rpc("match_chunks", {
      p_user: userId, p_doc_ids: documentIds, p_query: searchText(q.text),
      p_embedding: q.embedding ? JSON.stringify(q.embedding) : null, p_k: k,
    });
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({
      chunk: {
        id: r.id, documentId: r.document_id, userId, ordinal: r.ordinal, page: r.page, heading: r.heading, text: r.text,
        searchText: r.search_text, embedding: null, suspicious: r.suspicious,
      },
      documentTitle: r.document_title, score: r.score, lexicalRank: r.lexical_rank, vectorRank: r.vector_rank,
    }));
  }

  // ---------- Connectors ----------
  // ---- Thư mục (My Folder) ----
  async listFolders(userId: string): Promise<FolderRecord[]> {
    const { data, error } = await this.db.from("folders").select("*").eq("user_id", userId).order("created_at", { ascending: true });
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({ id: r.id, userId: r.user_id, name: r.name, color: r.color, goal: r.goal ?? null, createdAt: r.created_at }));
  }
  async saveFolder(f: FolderRecord) {
    const { error } = await this.db.from("folders").upsert({ id: f.id, user_id: f.userId, name: f.name, color: f.color, goal: f.goal ?? null, created_at: f.createdAt });
    if (error) throw asError(error);
  }
  async listNotes(userId: string): Promise<NoteRecord[]> {
    const { data, error } = await this.db.from("notes").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(200);
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({ id: r.id, userId: r.user_id, title: r.title ?? "", body: r.body ?? "", createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  async saveNote(n: NoteRecord) {
    const { error } = await this.db.from("notes").upsert({ id: n.id, user_id: n.userId, title: n.title, body: n.body, created_at: n.createdAt, updated_at: n.updatedAt });
    if (error) throw asError(error);
  }
  async deleteNote(userId: string, id: string) {
    const { data, error } = await this.db.from("notes").delete().eq("user_id", userId).eq("id", id).select("id");
    if (error) throw asError(error);
    return (data ?? []).length > 0;
  }
  async deleteFolder(userId: string, id: string) {
    const { data, error } = await this.db.from("folders").delete().eq("user_id", userId).eq("id", id).select("id");
    if (error) throw asError(error);
    return (data ?? []).length > 0;
  }
  async setDocumentFolder(userId: string, documentId: string, folderId: string | null) {
    const { data, error } = await this.db.from("documents").update({ folder_id: folderId }).eq("user_id", userId).eq("id", documentId).select("id");
    if (error) throw asError(error);
    return (data ?? []).length > 0;
  }

  async saveConnector(c: ConnectorRecord) {
    const { error } = await this.db.from("connectors").upsert({
      id: c.id, user_id: c.userId, name: c.name, url: c.url, preset: c.preset, token_enc: c.tokenEnc, tools: c.tools, created_at: c.createdAt,
    });
    if (error) throw asError(error);
  }
  async listConnectors(userId: string) {
    const { data, error } = await this.db.from("connectors").select("*").eq("user_id", userId);
    if (error) throw asError(error);
    return (data ?? []).map(connFromRow);
  }
  async getConnector(userId: string, id: string) {
    const { data, error } = await this.db.from("connectors").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
    if (error) throw asError(error);
    return data ? connFromRow(data) : null;
  }
  async deleteConnector(userId: string, id: string) {
    const { error } = await this.db.from("connectors").delete().eq("user_id", userId).eq("id", id);
    if (error) throw asError(error);
  }

  // ---------- Traces ----------
  async saveTrace(t: TraceRecord) {
    await this.db.from("agent_traces").insert({
      trace_id: t.traceId, user_id: t.userId, session_id: t.sessionId, name: t.name, summary: t.summary, created_at: t.createdAt,
    });
  }
  async listTraces(userId: string, sessionId: string) {
    const { data, error } = await this.db.from("agent_traces").select("*").eq("user_id", userId).eq("session_id", sessionId).order("created_at");
    if (error) throw asError(error);
    return (data ?? []).map((r: any) => ({ traceId: r.trace_id, userId: r.user_id, sessionId: r.session_id, name: r.name, summary: r.summary, createdAt: r.created_at }));
  }
}

function docFromRow(r: any): LibraryDocument {
  return {
    id: r.id, userId: r.user_id, title: r.title, kind: r.kind, origin: r.origin, pageCount: r.page_count, chunkCount: r.chunk_count,
    embedded: r.embedded, contentHash: r.content_hash, warnings: r.warnings ?? [], createdAt: r.created_at,
    folderId: r.folder_id ?? null,
  };
}
function connFromRow(r: any): ConnectorRecord {
  return { id: r.id, userId: r.user_id, name: r.name, url: r.url, preset: r.preset, tokenEnc: r.token_enc, tools: r.tools, createdAt: r.created_at };
}

/** PostgrestError của supabase-js là object thường, không phải Error → Hono không bắt được và Worker trả trang lỗi 500 trống. */
function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  const o = (e ?? {}) as { message?: string; code?: string };
  const err = new Error(o.message || "database_error");
  (err as Error & { code?: string }).code = o.code;
  return err;
}
