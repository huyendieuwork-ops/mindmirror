/**
 * search_trusted_sources — phần lõi (Đợt 2).
 *
 *  Dịch vụ tìm kiếm: có TAVILY_API_KEY → Tavily (tìm trong toàn bộ danh sách); chưa có khoá → Wikipedia API (miễn phí).
 *  Dịch vụ chỉ GỢI Ý link; code kiểm tra lại từng link (L1–L5), tự tải trang và chỉ dùng chữ của trang đã tải.
 *  Đoạn tóm tắt (snippet) của dịch vụ tìm kiếm KHÔNG bao giờ là nguồn.
 *
 *  C2–C4: tra bộ nhớ lưu trước (khoá = băm(môn + truy vấn chuẩn hoá), lưu 7 ngày, dùng chung, không lưu câu hỏi gốc).
 *  C6: hạn mức lượt tìm thật (không tính lượt lấy từ bộ nhớ) mỗi người mỗi ngày.
 *  Chỉ gửi ra ngoài: truy vấn đã cắt ≤ 200 ký tự, đã bỏ email/số dài. Không gửi tài liệu, tên hay email.
 */
import { checkUrl, DEFAULT_SUBJECT, searchDomains, TIER_RANK, type SourceTier } from "./allowlist";
import { fetchAllowedPage, USER_AGENT, WebFetchError, type FetchFn } from "./fetch";
import { looksLikeInjection, syllables, tokenize } from "../rag/text";
import type { Store } from "../store/types";

export interface WebPassage {
  url: string;          // địa chỉ cuối code đã tải
  title: string;
  siteName: string;
  tier: SourceTier;
  text: string;         // đoạn chữ lấy từ trang đã tải — dùng để đối chiếu trích dẫn
  suspicious: boolean;  // nghi chứa câu lệnh cho AI
}

export interface WebSearchOutcome {
  passages: WebPassage[];
  fromCache: boolean;
  provider: string;
  candidates: number;
  rejected: { url: string; code: string }[];
  note: string | null;   // no_results | all_rejected | null
}

export interface SearchHit { url: string; title?: string }

export interface SearchProvider {
  readonly name: string;
  search(query: string, domains: string[]): Promise<SearchHit[]>;
}

export class WebSearchError extends Error {
  constructor(readonly code: "quota_exceeded" | "unavailable", message: string) {
    super(message);
  }
}

// ---------------- dịch vụ tìm kiếm ----------------
export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  constructor(private apiKey: string, private doFetch: FetchFn = (u, i) => fetch(u, i)) {}
  async search(query: string, domains: string[]): Promise<SearchHit[]> {
    const r = await this.doFetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey.trim()}` },
      body: JSON.stringify({ query, max_results: 6, search_depth: "basic", include_domains: domains, include_answer: false, include_raw_content: false }),
    });
    if (!r.ok) throw new WebSearchError("unavailable", `tavily_${r.status}`);
    const j = (await r.json()) as { results?: { url?: string; title?: string }[] };
    return (j.results ?? []).filter((x) => typeof x.url === "string").map((x) => ({ url: x.url!, title: x.title }));
  }
}

/** Không cần khoá: tìm tiêu đề bài trên Wikipedia (tiếng Việt trước, tiếng Anh sau). */
export class WikipediaProvider implements SearchProvider {
  readonly name = "wikipedia";
  constructor(private doFetch: FetchFn = (u, i) => fetch(u, i), private langs = ["vi", "en"]) {}
  async search(query: string): Promise<SearchHit[]> {
    // Wikipedia tìm theo MỌI từ: câu dài thường không ra gì → thử lại với từ khoá ngắn (bỏ từ hỏi/hư từ).
    const attempts = [...new Set([query, keywordQuery(query)].filter((q) => q && q.length >= 2))];
    for (const lang of this.langs) {
      for (const q of attempts) {
        const u = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=3&srprop=&srsearch=${encodeURIComponent(q)}`;
        const r = await this.doFetch(u, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
        if (!r.ok) throw new WebSearchError("unavailable", `wikipedia_${r.status}`);
        const j = (await r.json()) as { query?: { search?: { title: string }[] } };
        const hits = (j.query?.search ?? []).map((x) => ({ url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`, title: x.title }));
        if (hits.length) return hits;
      }
    }
    return [];
  }
}

// ---------------- truy vấn & đoạn trích ----------------
/** Truy vấn gửi ra ngoài: bỏ email/số dài/link, gộp khoảng trắng, tối đa 200 ký tự. */
export function sanitizeQuery(q: string): string {
  return q
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\d{6,}/g, " ")
    .replace(/[<>{}[\]"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// Cụm từ hỏi/xã giao không mang nội dung tra cứu.
// Ranh giới theo chữ cái Unicode (\b của JS không hiểu chữ có dấu: "hả" không được khớp trong "nhả").
const QUESTION_PHRASES = /(?<!\p{L})(cho (mình|em|tôi|tớ) hỏi|giúp (mình|em|tôi|tớ)|giải thích( giúp)?|hoạt động (như )?thế nào|như thế nào|thế nào|là gì|là sao|ra sao|vì sao|tại sao|để làm gì|khác (nhau )?(ở )?(điểm )?(nào|gì)|khác nhau|(ở )?điểm nào|so sánh|có nghĩa là|nghĩa là gì|hả|nhỉ|vậy|ạ|ơi|với)(?!\p{L})/giu;
const FILLER = new Set(["mình", "em", "tôi", "tớ", "bạn", "cậu", "ơi", "nhé", "nha", "thì", "là", "của", "và", "các", "những", "một", "cái", "về", "trong", "cho", "có", "không", "gì", "nào", "này", "đó", "được", "hãy", "muốn", "biết", "hiểu"]);

/** Từ khoá ngắn từ câu hỏi tự nhiên: "Chỉ mục B-tree hoạt động thế nào?" → "Chỉ mục B-tree" (tối đa 6 từ). */
export function keywordQuery(text: string): string {
  const words = text
    .replace(QUESTION_PHRASES, " ")
    .replace(/[?!.,;:()"“”'`]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  return words.slice(0, 6).join(" ").trim();
}

export function normalizeQuery(q: string): string {
  return syllables(q).join(" ");
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PASSAGE = 900;

/** Chọn tối đa `n` đoạn liên quan nhất trong trang (điểm = số token truy vấn có trong đoạn). */
export function pickPassages(text: string, query: string, n = 2): string[] {
  const q = new Set(tokenize(query));
  if (!q.size) return [];
  const paras = text
    .split(/\n{2,}|\n(?=- )/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 60)
    .filter((p) => !/(Bài viết này|This article) (cần|needs|có thể|may)/i.test(p))      // hộp bảo trì của Wikipedia
    .filter((p) => (p.match(/\|/g)?.length ?? 0) / p.length < 0.02);                 // hộp điều hướng / bảng danh mục
  const windows: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n" + p).length > PASSAGE && buf) { windows.push(buf); buf = ""; }
    buf = buf ? `${buf}\n${p}` : p;
    while (buf.length > PASSAGE * 1.5) { windows.push(buf.slice(0, PASSAGE)); buf = buf.slice(PASSAGE); }
  }
  if (buf) windows.push(buf);
  return windows
    .map((w, i) => {
      const toks = new Set(tokenize(w));
      let score = 0;
      for (const t of q) if (toks.has(t)) score += t.includes("_") ? 2 : 1;
      return { w, i, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.w);
}

// ---------------- WebSearcher ----------------
export interface WebSearcherOptions {
  provider: SearchProvider;
  fetch?: FetchFn;
  store?: Store | null;
  dailyLimit?: number;   // C6
  cacheDays?: number;    // C4
  maxPages?: number;     // mỗi lượt tải tối đa 3 trang
  now?: () => Date;
}

export class WebSearcher {
  constructor(private o: WebSearcherOptions) {}
  get providerName() { return this.o.provider.name; }

  async search(userId: string, rawQuery: string, subject = DEFAULT_SUBJECT): Promise<WebSearchOutcome> {
    const query = sanitizeQuery(rawQuery);
    const now = (this.o.now ?? (() => new Date()))();
    const key = await sha256Hex(`${subject}|${normalizeQuery(query)}`);
    const store = this.o.store ?? null;

    // C2: bộ nhớ lưu trước — lấy từ cache vẫn là lượt tìm của lượt này (C5) nhưng không gọi dịch vụ ngoài.
    try {
      const cached = await store?.getWebCache?.(key, now.toISOString());
      if (cached) {
        const passages = cached.filter((p) => checkUrl(p.url, subject).ok); // danh sách đổi sau khi lưu → vẫn lọc lại
        return { passages, fromCache: true, provider: "cache", candidates: passages.length, rejected: [], note: passages.length ? null : "no_results" };
      }
    } catch { /* cache lỗi → tìm như bình thường */ }

    // C6: hạn mức theo ngày (chỉ tính lượt gọi dịch vụ ngoài).
    const limit = this.o.dailyLimit ?? 20;
    if (store?.countWebSearchesSince) {
      const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
      const used = await store.countWebSearchesSince(userId, since).catch(() => 0);
      if (used >= limit) throw new WebSearchError("quota_exceeded", `daily_limit_${limit}`);
    }
    await store?.logWebSearch?.(userId, now.toISOString()).catch(() => {});

    let hits: SearchHit[];
    try {
      hits = await this.o.provider.search(query, searchDomains(subject));
    } catch (e) {
      throw e instanceof WebSearchError ? e : new WebSearchError("unavailable", (e as Error).message?.slice(0, 80) ?? "search_failed");
    }

    // Kiểm tra L1–L4 TRƯỚC khi tải; bỏ trùng; ưu tiên tài liệu chính thức.
    const rejected: WebSearchOutcome["rejected"] = [];
    const seen = new Set<string>();
    const allowed: { url: string; rank: number; order: number }[] = [];
    hits.forEach((h, order) => {
      const c = checkUrl(h.url, subject);
      if (!c.ok) { rejected.push({ url: safeUrlForTrace(h.url), code: c.code }); return; }
      const u = c.url.toString();
      if (seen.has(u)) return;
      seen.add(u);
      allowed.push({ url: u, rank: TIER_RANK[c.entry.tier], order });
    });
    allowed.sort((a, b) => a.rank - b.rank || a.order - b.order);

    const pages = await Promise.all(
      allowed.slice(0, this.o.maxPages ?? 3).map((a) =>
        fetchAllowedPage(a.url, { fetch: this.o.fetch, subject }).catch((e) => {
          rejected.push({ url: safeUrlForTrace(a.url), code: e instanceof WebFetchError ? e.code : "network" });
          return null;
        }),
      ),
    );
    const passages: WebPassage[] = [];
    for (const p of pages) {
      if (!p) continue;
      for (const text of pickPassages(p.text, query, 2)) {
        passages.push({ url: p.url, title: p.title, siteName: p.entry.name, tier: p.entry.tier, text, suspicious: looksLikeInjection(text) });
      }
      if (passages.length >= 4) break;
    }
    const out = passages.slice(0, 4);
    if (out.length) await store?.putWebCache?.(key, out, now.toISOString(), new Date(now.getTime() + (this.o.cacheDays ?? 7) * 86400_000).toISOString()).catch(() => {});
    return {
      passages: out, fromCache: false, provider: this.o.provider.name, candidates: hits.length, rejected,
      note: out.length ? null : hits.length ? "all_rejected_or_irrelevant" : "no_results",
    };
  }
}

/** Trace chỉ ghi máy chủ + đường dẫn (trang công khai), bỏ query string. */
export function safeUrlForTrace(raw: string): string {
  try { const u = new URL(raw); return `${u.protocol}//${u.host}${u.pathname}`.slice(0, 160); } catch { return "(invalid)"; }
}
