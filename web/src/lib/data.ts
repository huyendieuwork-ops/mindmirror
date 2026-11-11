import { useCallback, useEffect, useState } from "react";
import { api, type Assessment, type Folder, type LibraryDoc, type Mode, type SessionView } from "./api";

export interface SessionItem { id: string; mode: Mode; topic: string; phase: string; status: string; updatedAt: string }
export interface SessionDetail { item: SessionItem; view: SessionView | null; assessment: Assessment | null }

export const MODE_PAGE: Record<Mode, { title: string; short: string; path: string; subtitle: string }> = {
  reunderstand: { title: "Kiểm tra hiểu biết", short: "Kiểm tra hiểu biết", path: "/check", subtitle: "Bạn tự trình bày điều mình hiểu, MindMirror đặt câu hỏi vào những điểm còn chưa chắc chắn." },
  explore: { title: "Khám phá", short: "Khám phá", path: "/explore", subtitle: "Học từ đầu: MindMirror giải thích từ khái niệm cơ bản, kèm ví dụ và nguồn tham khảo." },
};
export const sessionPath = (s: { id: string; mode: Mode }) => `${MODE_PAGE[s.mode].path}/${s.id}`;

/** Tiêu đề ngắn cho danh sách phiên, rút từ câu người học gõ (câu đầy đủ vẫn gửi riêng cho AI). */
export function deriveTitle(text: string, max = 80): string {
  const first = text.trim().split(/\n+/)[0]!.replace(/\s+/g, " ").trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 15)).replace(/[,;:–-]+$/, "")}…`;
}

/** Gợi ý trong ô nhập theo cách học. */
export const ASK_PLACEHOLDER: Record<Mode, string> = {
  reunderstand: "Ví dụ: Dạng chuẩn 3 (3NF) — hoặc: em hay nhầm 2NF với 3NF, nhất là phụ thuộc bắc cầu",
  explore: "Ví dụ: Vì sao đánh chỉ mục giúp truy vấn nhanh hơn?",
};

/* ---------- bộ nhớ đệm dùng chung giữa các trang (30 giây) ---------- */
let cache: { at: number; sessions: SessionItem[]; docs: LibraryDoc[]; folders: Folder[] } | null = null;
const detailCache = new Map<string, { at: string; d: SessionDetail }>();
const listeners = new Set<() => void>();
export function invalidate() { cache = null; listeners.forEach((l) => l()); }

async function loadBase(force = false) {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache;
  const [s, d, f] = await Promise.all([
    api.listSessions().catch(() => ({ items: [] })),
    api.documents().catch(() => ({ items: [] })),
    api.folders().catch(() => ({ items: [] })),
  ]);
  cache = { at: Date.now(), sessions: s.items as SessionItem[], docs: d.items, folders: f.items };
  return cache;
}

async function loadDetail(item: SessionItem): Promise<SessionDetail> {
  const hit = detailCache.get(item.id);
  if (hit && hit.at === item.updatedAt) return hit.d;
  const [view, assessment] = await Promise.all([
    api.getSession(item.id).catch(() => null),
    api.assessment(item.id).catch(() => null),
  ]);
  const d = { item, view, assessment };
  detailCache.set(item.id, { at: item.updatedAt, d });
  return d;
}

/** Dữ liệu học tập thật của người dùng: phiên, tài liệu, thư mục và (tuỳ chọn) chi tiết các phiên gần nhất. */
export function useLearningData(opts: { details?: number } = {}) {
  const want = opts.details ?? 0;
  const [state, setState] = useState<{ loading: boolean; sessions: SessionItem[]; docs: LibraryDoc[]; folders: Folder[]; details: SessionDetail[]; error: boolean }>(
    { loading: true, sessions: cache?.sessions ?? [], docs: cache?.docs ?? [], folders: cache?.folders ?? [], details: [], error: false },
  );
  const load = useCallback(async (force = false) => {
    try {
      const b = await loadBase(force);
      setState((s) => ({ ...s, sessions: b.sessions, docs: b.docs, folders: b.folders, loading: want > 0, error: false }));
      if (want > 0) {
        const details = await Promise.all(b.sessions.slice(0, want).map(loadDetail));
        setState((s) => ({ ...s, details, loading: false }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false, error: true }));
    }
  }, [want]);
  useEffect(() => {
    load();
    const l = () => load(true);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [load]);
  return { ...state, reload: () => load(true) };
}

/* ---------- chỉ số (tính từ thẻ đánh giá thật) ---------- */
/** Điểm hiểu của một phiên: tự thể hiện = 1, đúng sau gợi ý = 0.6, còn lại = 0. null nếu chưa có tiêu chí. */
export function sessionScore(a: Assessment | null): number | null {
  if (!a) return null;
  const c = a.counts;
  const total = (c.demonstrated_independent ?? 0) + (c.demonstrated_with_support ?? 0) + (c.needs_practice ?? 0) + (c.insufficient_evidence ?? 0);
  if (!total) return null;
  return (100 * ((c.demonstrated_independent ?? 0) + 0.6 * (c.demonstrated_with_support ?? 0))) / total;
}
export function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export function within(iso: string, days: number) { return Date.now() - new Date(iso).getTime() <= days * 86400_000; }

/** Tiến độ theo thư mục: trung bình điểm các phiên có gắn tài liệu thuộc thư mục đó. */
export function folderProgress(details: SessionDetail[], docs: LibraryDoc[], folders: Folder[]) {
  const docFolder = new Map(docs.map((d) => [d.id, d.folderId ?? null]));
  const scores = new Map<string, (number | null)[]>();
  for (const d of details) {
    const sc = sessionScore(d.assessment);
    const fids = new Set((d.view?.documentIds ?? []).map((id) => docFolder.get(id)).filter((x): x is string => !!x));
    fids.forEach((f) => scores.set(f, [...(scores.get(f) ?? []), sc]));
  }
  return folders.map((f) => ({ folder: f, value: avg(scores.get(f.id) ?? []) })).filter((x) => x.value !== null) as { folder: Folder; value: number }[];
}

/** Điểm trung bình theo từng tuần (n tuần gần nhất). */
export function weeklyTrend(details: SessionDetail[], weeks = 5) {
  const now = Date.now();
  return Array.from({ length: weeks }, (_, k) => {
    const i = weeks - 1 - k;
    const start = now - (i + 1) * 7 * 86400_000, end = now - i * 7 * 86400_000;
    const v = avg(details.filter((d) => { const t = new Date(d.item.updatedAt).getTime(); return t > start && t <= end; }).map((d) => sessionScore(d.assessment)));
    return { label: i === 0 ? "Tuần này" : `${i} tuần trước`, value: v };
  });
}

export interface KnowledgeGap { key: string; concept: string; topic: string; sessionId: string; mode: Mode; status: "needs" | "solid" }
export function knowledgeGaps(details: SessionDetail[]): KnowledgeGap[] {
  const out: KnowledgeGap[] = [];
  const seen = new Set<string>();
  for (const d of details) {
    for (const c of d.assessment?.criteria ?? []) {
      const status = c.status === "needs_practice" ? "needs" : c.status === "demonstrated_independent" ? "solid" : null;
      if (!status) continue;
      const key = `${status}:${c.concept.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, concept: c.concept, topic: d.item.topic, sessionId: d.item.id, mode: d.item.mode, status });
    }
    for (const u of d.view?.card?.unresolved ?? []) {
      const key = `needs:${u.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, concept: u, topic: d.item.topic, sessionId: d.item.id, mode: d.item.mode, status: "needs" });
    }
  }
  return out;
}

/* ---------- thông báo (suy ra từ dữ liệu thật) ---------- */
export interface Notice { id: string; kind: "gap" | "unfinished" | "weekly"; title: string; body: string; at: string; href: string }
export function buildNotices(sessions: SessionItem[], details: SessionDetail[]): Notice[] {
  const n: Notice[] = [];
  for (const g of knowledgeGaps(details).filter((g) => g.status === "needs").slice(0, 3)) {
    const d = details.find((x) => x.item.id === g.sessionId)!;
    n.push({ id: `gap-${g.sessionId}-${g.concept}`, kind: "gap", title: "Có kiến thức cần củng cố", body: `Bạn còn một điểm chưa rõ về “${g.concept}”. Hãy tiếp tục phiên học để kiểm chứng lại nhé.`, at: d.item.updatedAt, href: sessionPath(d.item) });
  }
  for (const s of sessions.filter((s) => s.status !== "finished" && !within(s.updatedAt, 1)).slice(0, 2)) {
    n.push({ id: `open-${s.id}`, kind: "unfinished", title: "Phiên học còn dang dở", body: `“${s.topic}” đang chờ bạn quay lại.`, at: s.updatedAt, href: sessionPath(s) });
  }
  const week = sessions.filter((s) => within(s.updatedAt, 7));
  if (week.length) {
    n.push({ id: `week-${new Date().toISOString().slice(0, 10)}`, kind: "weekly", title: "Tiến độ học tập tuần này", body: `Bạn đã học ${week.length} phiên trong 7 ngày qua. Xem những nội dung nên ôn tập.`, at: week[0]!.updatedAt, href: "/reports" });
  }
  return n.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------- tuỳ chọn lưu trên trình duyệt ---------- */
export function pref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`mm-${key}`); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
export function setPref(key: string, v: unknown) {
  try { localStorage.setItem(`mm-${key}`, JSON.stringify(v)); } catch { /* bỏ qua */ }
}
