import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, explain, type Note } from "../lib/api";
import { pref, setPref } from "../lib/data";
import { Icon } from "./ui";

/**
 * Trợ lý ghi chú: một nhân vật nhỏ đi dạo (hoặc đứng yên) ở chân trang; bấm vào để mở sổ ghi chú.
 * Ghi chú lưu trên tài khoản (API /api/notes), tải về PDF hoặc Word.
 * Cài đặt (Cài đặt → Giao diện): đi dạo / đứng yên / ẩn; ảnh nhân vật riêng (lưu trên trình duyệt này).
 */

export type MascotMode = "walk" | "stand" | "hidden";
export const MASCOT_EVENT = "mm:mascot";
export const mascotMode = (): MascotMode => pref<MascotMode>("mascot-mode", "walk");
export const mascotImage = (): string | null => pref<string | null>("mascot-img", null);
export function setMascot(p: { mode?: MascotMode; img?: string | null }) {
  if (p.mode) setPref("mascot-mode", p.mode);
  if (p.img !== undefined) setPref("mascot-img", p.img);
  window.dispatchEvent(new Event(MASCOT_EVENT));
}

const SIZE = 76;

export default function Mascot({ collapsed }: { collapsed: boolean }) {
  const loc = useLocation();
  const [wide, setWide] = useState(() => window.innerWidth >= 1024);
  useEffect(() => { const r = () => setWide(window.innerWidth >= 1024); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const sidebarWidth = wide ? (collapsed ? 76 : 256) : 0;
  const [mode, setMode] = useState<MascotMode>(mascotMode);
  const [img, setImg] = useState<string | null>(mascotImage);
  const [open, setOpen] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const h = () => { setMode(mascotMode()); setImg(mascotImage()); };
    window.addEventListener(MASCOT_EVENT, h);
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReduced(!!mq?.matches);
    return () => window.removeEventListener(MASCOT_EVENT, h);
  }, []);
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("mm:notes", h);
    return () => window.removeEventListener("mm:notes", h);
  }, []);

  if (mode === "hidden") return open ? <><style>{CSS}</style><NotesPanel onClose={() => setOpen(false)} /></> : null;
  // Trong phiên học: đứng yên ở góc trái để không che ô trả lời.
  const inSession = /^\/(check|explore|s)\//.test(loc.pathname);
  const walking = mode === "walk" && !reduced && !inSession && !open;

  return (
    <>
      <style>{CSS}</style>
      <div className="pointer-events-none fixed bottom-2 right-3 z-30 hidden sm:block" style={{ left: sidebarWidth + 12 }} aria-hidden={false}>
        <div className={`relative h-[96px] ${walking ? "mm-track" : ""}`} style={{ width: walking ? undefined : "100%" }}>
          <button onClick={() => setOpen((o) => !o)} title="Mở ghi chú" aria-label="Mở sổ ghi chú"
            className={`group pointer-events-auto absolute bottom-0 ${walking ? "mm-walker" : inSession ? "left-0" : "right-0"}`}
            style={{ width: SIZE, height: SIZE + 18 }}>
            <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-paper shadow group-hover:block">Ghi chú nhanh ✎</span>
            <span className={`block h-full w-full ${walking ? "mm-flip" : ""}`}>
              <span className={`block h-full w-full ${walking ? "mm-bob" : "mm-idle"}`}>
                {img ? <img src={img} alt="" className="h-full w-full object-contain drop-shadow-md" draggable={false} /> : <Buddy walking={walking} />}
              </span>
            </span>
          </button>
        </div>
      </div>
      {/* Điện thoại: nút nhỏ cố định góc phải dưới. */}
      <button onClick={() => setOpen(true)} aria-label="Mở sổ ghi chú" className="fixed bottom-3 right-3 z-30 h-14 w-14 rounded-full bg-sheet shadow-lg ring-1 ring-line sm:hidden">
        {img ? <img src={img} alt="" className="h-full w-full rounded-full object-contain p-1" /> : <span className="block h-full w-full p-1"><Buddy walking={false} /></span>}
      </button>
      {open && <NotesPanel onClose={() => setOpen(false)} />}
    </>
  );
}

const CSS = `
@keyframes mmTrack { from { left: 0; } to { left: calc(100% - ${SIZE}px); } }
.mm-track { width: 100%; }
.mm-walker { animation: mmTrack 26s linear infinite alternate; }
.mm-walker:hover, .mm-walker:focus-visible { animation-play-state: paused; }
.mm-walker:hover .mm-flip, .mm-walker:hover .mm-bob, .mm-walker:hover .mm-leg { animation-play-state: paused; }
@keyframes mmFlip { 0%, 49.99% { transform: scaleX(1); } 50%, 100% { transform: scaleX(-1); } }
.mm-flip { animation: mmFlip 52s step-end infinite; }
@keyframes mmBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.mm-bob { animation: mmBob .5s ease-in-out infinite; }
@keyframes mmIdle { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-2px) rotate(-2deg); } }
.mm-idle { animation: mmIdle 2.6s ease-in-out infinite; transform-origin: 50% 100%; }
@keyframes mmLegA { 0%, 100% { transform: rotate(18deg); } 50% { transform: rotate(-18deg); } }
@keyframes mmLegB { 0%, 100% { transform: rotate(-18deg); } 50% { transform: rotate(18deg); } }
.mm-leg { transform-box: fill-box; transform-origin: 50% 0; }
.mm-walking .mm-leg-a { animation: mmLegA .5s ease-in-out infinite; }
.mm-walking .mm-leg-b { animation: mmLegB .5s ease-in-out infinite; }
@keyframes mmBlink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
.mm-eye { transform-box: fill-box; transform-origin: center; animation: mmBlink 4s infinite; }
@keyframes mmPanelIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
.mm-panel { animation: mmPanelIn .2s ease-out both; }
@media (prefers-reduced-motion: reduce) { .mm-walker, .mm-flip, .mm-bob, .mm-idle, .mm-leg, .mm-eye { animation: none !important; } }
`;

/** Nhân vật mặc định do MindMirror tự thiết kế: "Mochi" — một bé tròn xanh, cầm bút chì. */
function Buddy({ walking }: { walking: boolean }) {
  return (
    <svg viewBox="0 0 80 96" className={`h-full w-full drop-shadow-md ${walking ? "mm-walking" : ""}`} aria-hidden>
      <ellipse cx="40" cy="92" rx="20" ry="3.5" fill="#1f2a44" opacity=".12" />
      <g fill="#3f6fb8">
        <rect className="mm-leg mm-leg-a" x="27" y="72" width="9" height="16" rx="4.5" />
        <rect className="mm-leg mm-leg-b" x="44" y="72" width="9" height="16" rx="4.5" />
      </g>
      <path d="M40 10c-17 0-29 13-29 31v16c0 11 9 19 20 19h18c11 0 20-8 20-19V41c0-18-12-31-29-31z" fill="#7db6f7" />
      <path d="M40 10c-17 0-29 13-29 31v4c4-15 15-25 29-25s25 10 29 25v-4c0-18-12-31-29-31z" fill="#a9d0fb" />
      <path d="M40 12c2-6 8-9 13-8-2 5-7 8-13 8z" fill="#5fc28f" />
      <path d="M40 12c-1-5-5-8-9-8 1 4 5 7 9 8z" fill="#7fd7a6" />
      <g fill="#1f2a44">
        <ellipse className="mm-eye" cx="31" cy="44" rx="3.6" ry="4.4" />
        <ellipse className="mm-eye" cx="49" cy="44" rx="3.6" ry="4.4" />
      </g>
      <circle cx="32.3" cy="42.4" r="1.2" fill="#fff" />
      <circle cx="50.3" cy="42.4" r="1.2" fill="#fff" />
      <ellipse cx="25" cy="53" rx="4.5" ry="2.6" fill="#f7a8b8" opacity=".8" />
      <ellipse cx="55" cy="53" rx="4.5" ry="2.6" fill="#f7a8b8" opacity=".8" />
      <path d="M35 53c2 3 8 3 10 0" stroke="#1f2a44" strokeWidth="2" fill="none" strokeLinecap="round" />
      <g transform="rotate(-28 62 58)">
        <rect x="58" y="44" width="6" height="24" rx="1.5" fill="#ffcf5a" />
        <path d="M58 68h6l-3 6z" fill="#f2c9a0" />
        <path d="M60.2 72.4h1.6l-.8 1.6z" fill="#1f2a44" />
        <rect x="58" y="44" width="6" height="4" rx="1.5" fill="#f28b9b" />
      </g>
      <ellipse cx="63" cy="62" rx="5" ry="4.2" fill="#7db6f7" />
    </svg>
  );
}

/* ---------------- Sổ ghi chú ---------------- */
type SaveState = "idle" | "saving" | "saved" | "error";

function NotesPanel({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const [save, setSave] = useState<SaveState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<null | "pdf" | "docx">(null);
  const [scope, setScope] = useState<"one" | "all">("one");
  const [confirmDel, setConfirmDel] = useState(false);
  const timer = useRef<number | null>(null);
  const dirty = useRef(false);
  const current = notes?.find((n) => n.id === sel) ?? null;

  useEffect(() => {
    api.notes().then((r) => { setNotes(r.items); if (r.items[0]) pick(r.items[0]); }).catch((e) => { setErr(explain(e)); setNotes([]); });
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    if (!sel || !dirty.current) return;
    dirty.current = false;
    setSave("saving");
    try {
      const n = await api.updateNote(sel, draft);
      setNotes((xs) => [n, ...(xs ?? []).filter((x) => x.id !== n.id)]);
      setSave("saved");
    } catch (e) { setSave("error"); setErr(explain(e)); dirty.current = true; }
  }, [sel, draft]);
  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [draft, flush]);

  function pick(n: Note) { setSel(n.id); setDraft({ title: n.title, body: n.body }); dirty.current = false; setSave("idle"); setConfirmDel(false); }
  async function switchTo(n: Note) { await flush(); pick(n); }
  async function create() {
    await flush(); setErr(null);
    try { const n = await api.createNote({ title: "", body: "" }); setNotes((xs) => [n, ...(xs ?? [])]); pick(n); }
    catch (e) { setErr(explain(e)); }
  }
  async function remove() {
    if (!sel) return;
    try {
      await api.deleteNote(sel);
      const rest = (notes ?? []).filter((n) => n.id !== sel);
      setNotes(rest); dirty.current = false;
      if (rest[0]) pick(rest[0]); else { setSel(null); setDraft({ title: "", body: "" }); }
    } catch (e) { setErr(explain(e)); }
  }
  async function exportAs(kind: "pdf" | "docx") {
    await flush();
    const list = scope === "all" ? (notes ?? []) : current ? [{ ...current, ...draft }] : [];
    if (!list.length) return;
    setBusy(kind); setErr(null);
    try {
      const m = await import("../lib/noteExport");
      await (kind === "pdf" ? m.exportPdf(list) : m.exportDocx(list));
    } catch { setErr("Chưa tạo được tệp. Thử lại sau ít giây."); } finally { setBusy(null); }
  }

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (notes ?? []).filter((n) => !t || `${n.title} ${n.body}`.toLowerCase().includes(t));
  }, [notes, q]);
  const label = (n: Note) => (n.id === sel ? draft.title : n.title).trim() || "Ghi chú không tên";
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-ink/20 sm:bg-transparent sm:p-4" onMouseDown={() => { void flush(); onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Sổ ghi chú" onMouseDown={(e) => e.stopPropagation()}
        className="mm-panel flex h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-sheet shadow-2xl sm:h-[min(36rem,85vh)] sm:w-[44rem] sm:rounded-3xl">
        <header className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-mist to-sheet px-4 py-3">
          <span className="h-10 w-10 shrink-0"><Buddy walking={false} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Sổ ghi chú</p>
            <p className="text-[11px] text-muted">Lưu trên tài khoản của bạn · tự lưu khi gõ</p>
          </div>
          <button onClick={create} className="inline-flex items-center gap-1.5 rounded-lg bg-mirror px-3 py-1.5 text-sm font-semibold text-white hover:bg-mirror/90"><Icon name="plus" /> Mới</button>
          <button onClick={() => { void flush(); onClose(); }} className="rounded-lg p-2 text-muted hover:bg-mist hover:text-ink" aria-label="Đóng"><Icon name="x" /></button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-52 shrink-0 flex-col border-r border-line sm:flex">
            <div className="p-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm ghi chú…" aria-label="Tìm ghi chú"
                className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs outline-none focus:border-mirror" />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {notes === null && <li className="px-2 py-3 text-xs text-muted">Đang tải…</li>}
              {notes?.length === 0 && <li className="px-2 py-3 text-xs text-muted">Chưa có ghi chú. Bấm “Mới” để viết.</li>}
              {shown.map((n) => (
                <li key={n.id}>
                  <button onClick={() => switchTo(n)} className={`w-full rounded-lg px-2.5 py-2 text-left ${n.id === sel ? "bg-mist" : "hover:bg-mist/50"}`}>
                    <span className={`block truncate text-sm ${n.id === sel ? "font-semibold text-ink" : "text-ink/85"}`}>{label(n)}</span>
                    <span className="block truncate text-[11px] text-muted">{new Date(n.updatedAt).toLocaleDateString("vi-VN")} · {(n.id === sel ? draft.body : n.body).slice(0, 40) || "Trống"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Điện thoại: chọn ghi chú bằng ô chọn. */}
            {notes && notes.length > 1 && (
              <select value={sel ?? ""} onChange={(e) => { const n = notes.find((x) => x.id === e.target.value); if (n) void switchTo(n); }}
                className="m-2 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm sm:hidden" aria-label="Chọn ghi chú">
                {notes.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
              </select>
            )}
            {sel ? (
              <>
                <input value={draft.title} maxLength={120} onChange={(e) => { dirty.current = true; setDraft((d) => ({ ...d, title: e.target.value })); }}
                  placeholder="Tiêu đề ghi chú" aria-label="Tiêu đề" className="focus:outline-none focus:ring-0 border-b border-line bg-transparent px-4 py-3 text-lg font-bold text-ink outline-none placeholder:text-muted/60" />
                <textarea value={draft.body} maxLength={20000} onChange={(e) => { dirty.current = true; setDraft((d) => ({ ...d, body: e.target.value })); }}
                  placeholder={"Ghi lại điều vừa học, câu hỏi còn thắc mắc, công thức cần nhớ…"} aria-label="Nội dung ghi chú"
                  className="focus:outline-none focus:ring-0 min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted/60" />
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div>
                  <span className="mx-auto block h-20 w-20"><Buddy walking={false} /></span>
                  <p className="mt-3 font-semibold text-ink">Chưa có ghi chú nào</p>
                  <p className="mt-1 text-sm text-muted">Ghi lại ý chính sau mỗi phiên học, rồi tải về PDF hoặc Word khi cần.</p>
                  <button onClick={create} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-mirror px-4 py-2 text-sm font-semibold text-white"><Icon name="plus" /> Viết ghi chú đầu tiên</button>
                </div>
              </div>
            )}

            {err && <p className="mx-4 mb-2 rounded-lg bg-rust/10 px-3 py-1.5 text-xs text-rust">{err}</p>}
            <footer className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
              <span className="mr-auto text-[11px] text-muted">
                {save === "saving" ? "Đang lưu…" : save === "saved" ? "Đã lưu ✓" : save === "error" ? "Chưa lưu được" : sel ? `${words} từ` : ""}
              </span>
              {sel && (confirmDel
                ? <span className="flex items-center gap-1.5 text-xs"><span className="text-muted">Xoá ghi chú này?</span>
                    <button onClick={remove} className="rounded-md bg-rust px-2 py-1 font-semibold text-white">Xoá</button>
                    <button onClick={() => setConfirmDel(false)} className="rounded-md border border-line px-2 py-1">Huỷ</button></span>
                : <button onClick={() => setConfirmDel(true)} className="rounded-lg p-1.5 text-muted hover:bg-rust/10 hover:text-rust" aria-label="Xoá ghi chú" title="Xoá ghi chú"><Icon name="trash" /></button>)}
              {(notes?.length ?? 0) > 0 && (
                <>
                  <select value={scope} onChange={(e) => setScope(e.target.value as "one" | "all")} aria-label="Phạm vi tải về" className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs">
                    <option value="one">Ghi chú này</option>
                    <option value="all">Tất cả ({notes?.length})</option>
                  </select>
                  <button onClick={() => exportAs("pdf")} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-mirror/60 disabled:opacity-50">
                    <Icon name="file" className="h-3.5 w-3.5" /> {busy === "pdf" ? "Đang tạo…" : "Tải PDF"}
                  </button>
                  <button onClick={() => exportAs("docx")} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:border-mirror/60 disabled:opacity-50">
                    <Icon name="file" className="h-3.5 w-3.5" /> {busy === "docx" ? "Đang tạo…" : "Tải Word"}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
