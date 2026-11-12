import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, explain, type Folder, type GraphConcept, type GraphRel, type GraphStatus, type GraphViewData, type LibraryDoc } from "../lib/api";
import { knowledgeGaps, useLearningData } from "../lib/data";
import { keysOf } from "./KnowledgeGraph";
import { Empty, Icon } from "./ui";

type StepStatus = "solid" | "needs" | "new";
interface Step { concept: GraphConcept; pre: GraphRel[]; status: StepStatus; depth: number; chapter: string }

const STATUS: Record<StepStatus, { label: string; tone: string; dot: string }> = {
  solid: { label: "Đã nắm vững", tone: "bg-[#E3F5EC] text-[#2E8B66]", dot: "bg-moss" },
  needs: { label: "Cần ôn lại", tone: "bg-[#FFF3D6] text-[#B07A12]", dot: "bg-[#E0A526]" },
  new: { label: "Chưa học", tone: "bg-paper text-muted", dot: "bg-line" },
};

const firstPage = (c: GraphConcept) => Math.min(...c.pages.filter((p): p is number => typeof p === "number"), 1e6);

/**
 * Thứ tự học = sắp xếp tô-pô ổn định trên hai loại ràng buộc:
 *  - quan hệ CẦN BIẾT TRƯỚC có căn cứ (A → B: học A trước B);
 *  - khái niệm cha trước khái niệm con (chương/mục trước ý con).
 * Giữa các khái niệm "đến lượt" cùng lúc: theo thứ tự xuất hiện trong tài liệu (trang đầu tiên), rồi mục lớn trước.
 * Vòng lặp (dữ liệu lỗi) thì cắt: lấy khái niệm còn lại xuất hiện sớm nhất.
 */
export function orderConcepts(concepts: GraphConcept[], relations: GraphRel[]): { concept: GraphConcept; pre: GraphRel[]; depth: number }[] {
  const byKey = new Map(concepts.map((c) => [c.key, c]));
  const cbt = relations.filter((r) => r.type === "CAN_BIET_TRUOC" && byKey.has(r.from) && byKey.has(r.to) && r.from !== r.to);
  const pre = new Map<string, GraphRel[]>();
  for (const r of cbt) pre.set(r.to, [...(pre.get(r.to) ?? []), r]);
  const parentOf = (c: GraphConcept) => (c.parent && c.parent !== c.key && byKey.has(c.parent) ? c.parent : null);
  const level = (c: GraphConcept) => { let n = 0, k = parentOf(c); const seen = new Set([c.key]); while (k && !seen.has(k)) { seen.add(k); n++; k = parentOf(byKey.get(k)!); } return n; };

  const after = new Map<string, Set<string>>(); // key → các key phải học trước
  for (const c of concepts) after.set(c.key, new Set());
  for (const r of cbt) after.get(r.to)!.add(r.from);
  for (const c of concepts) { const p = parentOf(c); if (p) after.get(c.key)!.add(p); }

  const rank = (c: GraphConcept) => [firstPage(c), level(c), c.name] as const;
  const cmp = (a: GraphConcept, b: GraphConcept) => {
    const x = rank(a), y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], "vi");
  };
  const done = new Set<string>();
  const depth = new Map<string, number>();
  const out: { concept: GraphConcept; pre: GraphRel[]; depth: number }[] = [];
  let left = [...concepts];
  while (left.length) {
    const ready = left.filter((c) => [...after.get(c.key)!].every((k) => done.has(k)));
    const pick = (ready.length ? ready : left).sort(cmp)[0]!;
    const d = Math.max(-1, ...[...after.get(pick.key)!].map((k) => depth.get(k) ?? -1)) + 1;
    depth.set(pick.key, d);
    done.add(pick.key);
    out.push({ concept: pick, pre: pre.get(pick.key) ?? [], depth: d });
    left = left.filter((c) => c !== pick);
  }
  return out;
}

/** Tên chương = khái niệm gốc của cây cha–con (khái niệm gốc là chương của chính nó) để nhóm các bước. */
function chapterOf(c: GraphConcept, byKey: Map<string, GraphConcept>): string {
  let cur = c; const seen = new Set<string>();
  while (cur.parent && byKey.has(cur.parent) && !seen.has(cur.parent)) { seen.add(cur.key); cur = byKey.get(cur.parent)!; }
  return cur.name;
}

/**
 * Tab "Lộ trình" của thư mục: thứ tự học suy ra từ sơ đồ khái niệm (quan hệ "cần biết trước" có câu căn cứ + cây chương/mục)
 * và trạng thái từ kết quả các phiên học. Không gọi AI. Trong tab chỉ là thẻ tóm tắt gọn; bấm để mở lộ trình toàn màn hình,
 * đi từng bước một.
 */
export default function FolderRoadmap({ folder, docs, onOpenGraph }: { folder: Folder | null; docs: LibraryDoc[]; onOpenGraph: () => void }) {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [view, setView] = useState<GraphViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const data = useLearningData({ details: 40 });
  const ids = docs.slice(0, 5).map((d) => d.id);

  useEffect(() => { api.graphStatus().then(setStatus).catch(() => setStatus({ configured: false, connected: false, kind: null, limits: { pagesPerBuild: 6, buildsPerDay: 10 } })); }, []);
  useEffect(() => {
    setView(null); setError(null);
    if (!status?.connected || !ids.length) return;
    api.graph(ids).then(setView).catch((e) => setError(explain(e)));
  }, [status?.connected, ids.join(",")]);

  const marks = useMemo(() => knowledgeGaps(data.details), [data.details]);
  const steps: Step[] = useMemo(() => {
    if (!view) return [];
    const byKey = new Map(view.concepts.map((c) => [c.key, c]));
    const markOf = (c: GraphConcept): StepStatus => {
      const ks = keysOf(c.name);
      const hit = marks.filter((m) => keysOf(m.concept).some((k) => ks.includes(k)));
      return hit.some((m) => m.status === "needs") ? "needs" : hit.some((m) => m.status === "solid") ? "solid" : "new";
    };
    return orderConcepts(view.concepts, view.relations).slice(0, 60).map((o) => ({ ...o, status: markOf(o.concept), chapter: chapterOf(o.concept, byKey) }));
  }, [view, marks]);

  if (!docs.length) return <div className="p-5"><Empty icon="upload" title="Chưa có tài liệu">Lộ trình được sắp từ các khái niệm trong tài liệu của thư mục. Tải tài liệu lên để bắt đầu.</Empty></div>;
  if (!status) return <p className="p-6 text-center text-sm text-muted">Đang tải lộ trình…</p>;
  if (!status.connected) return <p className="p-6 text-center text-sm text-muted">Chưa kết nối được cơ sở dữ liệu đồ thị nên chưa sắp được lộ trình. Thử lại sau ít phút.</p>;
  if (error) return <p className="m-5 rounded-lg bg-rust/10 px-4 py-2.5 text-sm text-rust">{error}</p>;
  if (!view) return <p className="p-6 text-center text-sm text-muted">Đang tải lộ trình…</p>;

  const read = view.documents.reduce((a, d) => a + d.extractedPages, 0);
  const total = docs.slice(0, 5).reduce((a, d) => a + d.pageCount, 0);
  if (!steps.length)
    return (
      <div className="p-5">
        <Empty icon="bulb" title="Chưa có lộ trình" action={<button onClick={onOpenGraph} className="text-sm font-medium text-mirror">Mở Sơ đồ khái niệm →</button>}>
          Lộ trình được sắp từ sơ đồ khái niệm của thư mục. Mở tab Sơ đồ khái niệm và bấm “Tạo bản đồ khái niệm” để MindMirror đọc tài liệu trước.
        </Empty>
      </div>
    );

  const solid = steps.filter((s) => s.status === "solid").length;
  const nextIdx = nextStepIndex(steps);
  const next = steps[nextIdx]!;
  const pct = Math.round((solid / steps.length) * 100);
  // Cửa sổ 7 bước quanh bước tiếp theo cho dải xem trước.
  const from = Math.max(0, Math.min(nextIdx - 2, steps.length - 7));
  const strip = steps.slice(from, from + 7);
  const title = folder?.name ?? "Lộ trình";

  return (
    <div className="p-5">
      <RoadmapStyles />
      <div className="relative overflow-hidden rounded-2xl border border-mirror/30 bg-gradient-to-br from-mist via-sheet to-sheet p-5 shadow-sm">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-skyish/20 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <ProgressRing value={pct} label={`${solid}/${steps.length}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mirror">Lộ trình {steps.length} bước · {title}</p>
            <p className="mt-1 text-sm text-muted">Bước tiếp theo <span className="font-medium text-ink">({nextIdx + 1}/{steps.length})</span></p>
            <p className="line-clamp-2 text-xl font-bold text-ink sm:truncate" title={next.concept.name}>{next.concept.name}</p>
            {next.concept.description && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{next.concept.description}</p>}
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col">
            <Link to={stepHref(next, folder)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-mirror px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-mirror/90">
              {stepAction(next)} <Icon name="arrowRight" />
            </Link>
            <button onClick={() => setOpen(nextIdx)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-mirror/40 bg-sheet px-4 py-2.5 text-sm font-semibold text-mirror hover:border-mirror">
              <Icon name="compass" /> Xem lộ trình đầy đủ
            </button>
          </div>
        </div>

        {/* Dải xem trước: bấm bước bất kỳ để mở toàn màn hình tại bước đó. */}
        <button onClick={() => setOpen(nextIdx)} className="relative mt-5 block w-full text-left" aria-label="Mở lộ trình đầy đủ">
          <div className="absolute left-4 right-4 top-4 h-0.5 bg-line" />
          <ol className="relative flex gap-1">
            {strip.map((s, j) => {
              const i = from + j;
              const cur = i === nextIdx;
              return (
                <li key={s.concept.key} className={`${j >= 5 ? "hidden sm:flex" : "flex"} min-w-0 flex-1 flex-col items-center gap-1.5`} onClick={(e) => { e.stopPropagation(); setOpen(i); }}>
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ring-4 ring-sheet transition ${s.status === "solid" ? "bg-moss text-white" : cur ? "bg-mirror text-white mm-pulse" : s.status === "needs" ? "bg-[#FFF3D6] text-[#B07A12]" : "bg-paper text-ink border border-line"}`}>
                    {s.status === "solid" ? "✓" : i + 1}
                  </span>
                  <span className={`w-full truncate text-center text-[11px] ${cur ? "font-semibold text-ink" : "text-muted"}`}>{s.concept.name}</span>
                </li>
              );
            })}
            {from + 5 < steps.length && (
              <li className={`${from + 7 < steps.length ? "flex" : "flex sm:hidden"} min-w-0 flex-1 flex-col items-center gap-1.5`}>
                <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-mirror/50 bg-sheet text-[11px] font-semibold text-mirror ring-4 ring-sheet">
                  <span className="sm:hidden">+{steps.length - from - Math.min(5, strip.length)}</span><span className="hidden sm:inline">+{Math.max(0, steps.length - from - 7)}</span>
                </span>
                <span className="text-[11px] text-muted">bước nữa</span>
              </li>
            )}
          </ol>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>Sắp theo quan hệ “cần biết trước” có câu trích làm căn cứ và theo chương/mục của tài liệu · tạo từ {read}/{total} trang.</span>
        {read < total && <button onClick={onOpenGraph} className="font-medium text-mirror">Đọc thêm trang để cập nhật →</button>}
      </div>

      {open !== null && <RoadmapFullscreen steps={steps} start={open} title={title} folder={folder} onClose={() => setOpen(null)} />}
    </div>
  );
}

function nextStepIndex(steps: Step[]): number {
  const solidKeys = new Set(steps.filter((s) => s.status === "solid").map((s) => s.concept.key));
  const i = steps.findIndex((s) => s.status !== "solid" && s.pre.every((r) => solidKeys.has(r.from)));
  if (i >= 0) return i;
  const j = steps.findIndex((s) => s.status !== "solid");
  return j >= 0 ? j : 0;
}

function stepHref(s: Step, folder: Folder | null) {
  const q = new URLSearchParams({ topic: s.concept.name, ...(folder ? { folder: folder.id } : {}) });
  if (s.status === "solid") q.set("mode", "reunderstand");
  else { q.set("mode", "explore"); q.set("level", s.status === "needs" ? "review" : "beginner"); }
  return `/?${q.toString()}`;
}
const stepAction = (s: Step) => (s.status === "solid" ? "Tự kiểm tra" : s.status === "needs" ? "Ôn lại" : "Học từ đầu");
const checkHref = (s: Step, folder: Folder | null) => `/?${new URLSearchParams({ topic: s.concept.name, mode: "reunderstand", ...(folder ? { folder: folder.id } : {}) })}`;

function ProgressRing({ value, label, size = 76 }: { value: number; label: string; size?: number }) {
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={7} className="stroke-line" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={7} strokeLinecap="round" className="stroke-moss transition-all duration-700"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <span><span className="block text-base font-bold text-ink">{label}</span><span className="text-[10px] text-muted">đã vững</span></span>
      </div>
    </div>
  );
}

function RoadmapStyles() {
  return (
    <style>{`
      @keyframes mmStepIn { from { opacity: 0; transform: translateY(10px) scale(.99); } to { opacity: 1; transform: none; } }
      .mm-step-in { animation: mmStepIn .28s ease-out both; }
      @keyframes mmPulse { 0%,100% { box-shadow: 0 0 0 0 rgb(var(--mirror) / .45); } 50% { box-shadow: 0 0 0 7px rgb(var(--mirror) / 0); } }
      .mm-pulse { animation: mmPulse 2s ease-in-out infinite; }
    `}</style>
  );
}

/** Lộ trình toàn màn hình: cột bước bên trái (theo chương), một bước lớn ở giữa, đi tới/lui bằng nút hoặc phím ← →. */
function RoadmapFullscreen({ steps, start, title, folder, onClose }: { steps: Step[]; start: number; title: string; folder: Folder | null; onClose: () => void }) {
  const [i, setI] = useState(start);
  const s = steps[i]!;
  const railRef = useRef<HTMLOListElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const indexOf = useMemo(() => new Map(steps.map((x, k) => [x.concept.key, k])), [steps]);
  const go = useCallback((k: number) => setI(Math.max(0, Math.min(steps.length - 1, k))), [steps.length]);
  const solid = steps.filter((x) => x.status === "solid").length;
  const nextIdx = nextStepIndex(steps);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setI((k) => Math.min(steps.length - 1, k + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setI((k) => Math.max(0, k - 1)); }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose, steps.length]);
  useEffect(() => {
    railRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    stripRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [i]);

  const unlocks = steps.filter((x) => x.pre.some((r) => r.from === s.concept.key));
  const children = steps.filter((x) => x.concept.parent === s.concept.key);
  const parent = s.concept.parent ? steps.find((x) => x.concept.key === s.concept.parent) : undefined;
  const pages = [...new Set(s.concept.pages.filter((p): p is number => typeof p === "number"))].sort((a, b) => a - b);
  const chip = (x: Step) => (
    <button key={x.concept.key} onClick={() => go(indexOf.get(x.concept.key)!)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-sheet px-3 py-1 text-xs text-ink hover:border-mirror/60 hover:text-mirror">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS[x.status].dot}`} />
      <span className="truncate">{indexOf.get(x.concept.key)! + 1}. {x.concept.name}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-label={`Lộ trình: ${title}`}>
      <RoadmapStyles />
      <header className="border-b border-line bg-sheet px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mirror/10 text-mirror"><Icon name="compass" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">Lộ trình · {title}</p>
            <p className="text-[11px] text-muted">{steps.length} bước · {solid} đã nắm vững<span className="hidden sm:inline"> · dùng phím ← → để chuyển bước</span></p>
          </div>
          <button onClick={() => go(nextIdx)} className="hidden rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-mirror hover:border-mirror/60 sm:block">Tới bước tiếp theo</button>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-mist hover:text-ink" aria-label="Đóng (Esc)"><Icon name="x" /></button>
        </div>
        {/* Thanh tiến độ theo từng bước. */}
        <div className="mt-3 flex gap-0.5" aria-hidden>
          {steps.map((x, k) => (
            <button key={x.concept.key} tabIndex={-1} onClick={() => go(k)} title={`${k + 1}. ${x.concept.name}`}
              className={`h-1.5 flex-1 rounded-full transition-all ${x.status === "solid" ? "bg-moss" : x.status === "needs" ? "bg-[#E0A526]" : "bg-line"} ${k === i ? "scale-y-[2] !bg-mirror" : ""}`} />
          ))}
        </div>
      </header>

      {/* Điện thoại: dải số bước cuộn ngang. */}
      <div ref={stripRef} className="flex gap-2 overflow-x-auto border-b border-line bg-sheet px-4 py-2 md:hidden">
        {steps.map((x, k) => (
          <button key={x.concept.key} data-i={k} onClick={() => go(k)}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${k === i ? "bg-mirror text-white" : x.status === "solid" ? "bg-moss text-white" : "border border-line bg-paper text-ink"}`}>
            {x.status === "solid" && k !== i ? "✓" : k + 1}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Cột bước (máy tính): nhóm theo chương, cuộn riêng trong khung. */}
        <nav className="hidden w-72 shrink-0 overflow-y-auto border-r border-line bg-sheet md:block" aria-label="Các bước">
          <ol ref={railRef} className="relative py-3">
            {steps.map((x, k) => {
              const head = k === 0 || steps[k - 1]!.chapter !== x.chapter ? x.chapter : null;
              const active = k === i;
              return (
                <li key={x.concept.key} data-i={k}>
                  {head && <p className="px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">{head}</p>}
                  <button onClick={() => go(k)}
                    className={`group relative flex w-full items-center gap-3 px-4 py-2 text-left ${active ? "bg-mist/70" : "hover:bg-mist/40"}`}>
                    {active && <span className="absolute left-0 top-1 bottom-1 w-1 rounded-r bg-mirror" />}
                    <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${x.status === "solid" ? "bg-moss text-white" : active ? "bg-mirror text-white" : x.status === "needs" ? "bg-[#FFF3D6] text-[#B07A12]" : "border border-line bg-paper text-ink"}`}>
                      {x.status === "solid" ? "✓" : k + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${active ? "font-semibold text-ink" : "text-ink/80"}`}>{x.concept.name}</span>
                      {k === nextIdx && <span className="text-[10px] font-semibold text-mirror">Bước tiếp theo</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 py-6 sm:px-8 sm:py-10">
            <article key={s.concept.key} className="mm-step-in overflow-hidden rounded-3xl border border-line bg-sheet shadow-[0_12px_40px_-18px_rgb(var(--mirror)/0.45)]">
              <div className="relative bg-gradient-to-br from-mirror to-skyish px-6 py-6 text-white sm:px-8">
                <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15" />
                <div className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-white/10" />
                <p className="relative text-xs font-semibold uppercase tracking-[0.18em] text-white/85">Bước {i + 1} / {steps.length}{s.chapter !== s.concept.name ? ` · ${s.chapter}` : ""}</p>
                <h2 className="relative mt-2 text-2xl font-bold leading-tight sm:text-3xl">{s.concept.name}</h2>
                <div className="relative mt-3 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[s.status].tone}`}>{STATUS[s.status].label}</span>
                  {i === nextIdx && <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">Nên học bây giờ</span>}
                  {pages.length > 0 && <span className="text-xs text-white/85">Có trong tr. {pages.slice(0, 6).join(", ")}{pages.length > 6 ? "…" : ""}</span>}
                </div>
              </div>

              <div className="space-y-5 px-6 py-6 sm:px-8">
                {s.concept.description
                  ? <p className="text-[15px] leading-relaxed text-ink">{s.concept.description}</p>
                  : <p className="text-sm text-muted">Tài liệu chưa có câu định nghĩa ngắn cho khái niệm này — bấm “{stepAction(s)}” để AI giải thích theo tài liệu.</p>}

                {(s.pre.length > 0 || parent) && (
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Cần nắm trước</p>
                    <div className="flex flex-wrap gap-2">
                      {s.pre.map((r) => steps[indexOf.get(r.from)!]).filter(Boolean).map((x) => chip(x!))}
                      {parent && !s.pre.some((r) => r.from === parent.concept.key) && chip(parent)}
                    </div>
                  </section>
                )}
                {s.pre[0] && (
                  <blockquote className="rounded-2xl border-l-4 border-mirror bg-mist/50 px-4 py-3">
                    <p className="text-sm italic text-ink/90">“{s.pre[0].evidence.quote}”</p>
                    <p className="mt-1 text-[11px] text-muted">Căn cứ: {s.pre[0].evidence.documentTitle}{s.pre[0].evidence.page ? `, tr.${s.pre[0].evidence.page}` : ""}</p>
                  </blockquote>
                )}
                {(unlocks.length > 0 || children.length > 0) && (
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Học xong sẽ mở đường cho</p>
                    <div className="flex flex-wrap gap-2">{[...new Map([...unlocks, ...children].map((x) => [x.concept.key, x])).values()].slice(0, 8).map(chip)}</div>
                  </section>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Link to={stepHref(s, folder)} className="inline-flex items-center gap-2 rounded-xl bg-mirror px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-mirror/90">
                    <Icon name={s.status === "solid" ? "check" : "book"} /> {stepAction(s)}
                  </Link>
                  {s.status !== "solid" && (
                    <Link to={checkHref(s, folder)} className="inline-flex items-center gap-2 rounded-xl border border-line px-5 py-3 text-sm font-semibold text-ink hover:border-mirror/60">
                      <Icon name="check" /> Tự kiểm tra
                    </Link>
                  )}
                </div>
              </div>
            </article>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button onClick={() => go(i - 1)} disabled={i === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-sheet px-4 py-2.5 text-sm font-medium text-ink hover:border-mirror/60 disabled:opacity-40">
                <span className="rotate-180"><Icon name="arrowRight" /></span>
                <span className="hidden sm:inline">{i > 0 ? steps[i - 1]!.concept.name : "Bước trước"}</span>
                <span className="sm:hidden">Trước</span>
              </button>
              <span className="text-xs text-muted">{i + 1} / {steps.length}</span>
              <button onClick={() => go(i + 1)} disabled={i === steps.length - 1}
                className="inline-flex max-w-[45%] items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-40">
                <span className="hidden truncate sm:inline">{i < steps.length - 1 ? steps[i + 1]!.concept.name : "Bước sau"}</span>
                <span className="sm:hidden">Sau</span>
                <Icon name="arrowRight" />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
