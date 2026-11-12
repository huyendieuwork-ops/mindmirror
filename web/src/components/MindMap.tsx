import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GraphConcept, GraphRel, GraphViewData } from "../lib/api";
import { Icon } from "./ui";

/** Trạng thái học của khái niệm (từ các phiên đã làm) để tô viền nút. */
export type ConceptMark = { concept: string; status: "needs" | "solid" };

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
export const keysOf = (name: string) => {
  const base = norm(name.replace(/\([^)]*\)/g, " "));
  const inner = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => norm(m[1]!));
  return [base, ...inner].filter(Boolean);
};

/** Màu nhánh cấp 1 — mỗi nhánh một màu để mắt bám theo nhánh. */
const BRANCH = ["#4F7CF7", "#16A085", "#E67E22", "#8E44AD", "#D35480", "#2E86AB", "#B7950B", "#C0392B"];

export interface MindNode {
  id: string;
  label: string;
  concept: GraphConcept | null;
  children: MindNode[];
}

/**
 * Cây mind map: gốc = tên tài liệu/thư mục; con = khái niệm theo "khái niệm cha" AI sắp khi đọc tài liệu.
 * Cha không có trong bản đồ hoặc tạo vòng → treo vào gốc. Con xếp theo trang xuất hiện đầu tiên.
 */
export function buildMindTree(view: GraphViewData, rootLabel: string): MindNode {
  const byKey = new Map(view.concepts.map((c) => [c.key, c]));
  const parentOf = (k: string) => {
    const p = byKey.get(k)?.parent;
    return p && p !== k && byKey.has(p) ? p : null;
  };
  // Cắt vòng: đi ngược lên cha, gặp lại chính mình → bỏ liên kết cha.
  const parent = new Map<string, string | null>();
  for (const c of view.concepts) {
    let p = parentOf(c.key);
    const seen = new Set([c.key]);
    for (let cur = p; cur; cur = parentOf(cur)) {
      if (seen.has(cur)) { p = null; break; }
      seen.add(cur);
    }
    parent.set(c.key, p);
  }
  const firstPage = (c: GraphConcept) => Math.min(...c.pages.map((x) => x ?? 9999), 9999);
  const nodes = new Map<string, MindNode>(view.concepts.map((c) => [c.key, { id: c.key, label: c.name, concept: c, children: [] }]));
  const root: MindNode = { id: "__root", label: rootLabel, concept: null, children: [] };
  for (const c of [...view.concepts].sort((a, b) => firstPage(a) - firstPage(b) || a.name.localeCompare(b.name, "vi"))) {
    const p = parent.get(c.key);
    (p ? nodes.get(p)! : root).children.push(nodes.get(c.key)!);
  }
  return root;
}

interface Placed { node: MindNode; x: number; y: number; w: number; h: number; lines: string[]; side: -1 | 0 | 1; depth: number; branch: number; parent: Placed | null; hidden: number }

const FONT = 13, CHAR_W = 7.1, PAD_X = 14, GAP_X = 56, GAP_Y = 12;

function wrap(label: string, max = 28): string[] {
  if (label.length <= max) return [label];
  const words = label.split(" ");
  let a = "";
  while (words.length && (a + " " + words[0]).trim().length <= Math.ceil(label.length / 2) + 4) a = (a + " " + words.shift()).trim();
  const b = words.join(" ");
  return [a || label.slice(0, max), b.length > max + 6 ? b.slice(0, max + 4) + "…" : b].filter(Boolean);
}

/** Bố cục hai phía: nhánh cấp 1 chia trái/phải cho cân, mỗi nhánh xếp dọc theo số lá. */
function layout(root: MindNode, collapsed: Set<string>) {
  const size = (n: MindNode, depth: number) => {
    const lines = depth === 0 ? wrap(n.label, 26) : wrap(n.label);
    const cw = depth === 0 ? CHAR_W * 1.3 : CHAR_W;
    const w = Math.min(depth === 0 ? 300 : 230, Math.max(depth === 0 ? 140 : 70, Math.max(...lines.map((l) => l.length)) * cw + PAD_X * 2));
    const h = depth === 0 ? (lines.length > 1 ? 62 : 48) : lines.length > 1 ? 50 : 34;
    return { lines, w, h };
  };
  const kids = (n: MindNode) => (collapsed.has(n.id) ? [] : n.children);
  const span = new Map<string, number>();
  const measure = (n: MindNode, depth: number): number => {
    const own = size(n, depth).h;
    const ks = kids(n);
    const total = ks.length ? ks.reduce((a, k) => a + measure(k, depth + 1), 0) + GAP_Y * (ks.length - 1) : 0;
    const v = Math.max(own, total);
    span.set(n.id, v);
    return v;
  };
  const top = root.children;
  top.forEach((k) => measure(k, 1));
  // Chia nhánh cấp 1 hai bên cho cân chiều cao.
  const right: MindNode[] = [], left: MindNode[] = [];
  let hr = 0, hl = 0;
  for (const k of top) { if (hr <= hl) { right.push(k); hr += span.get(k.id)! + GAP_Y * 2; } else { left.push(k); hl += span.get(k.id)! + GAP_Y * 2; } }
  const out: Placed[] = [];
  const r0 = size(root, 0);
  const rootP: Placed = { node: root, x: 0, y: 0, w: r0.w, h: r0.h, lines: r0.lines, side: 0, depth: 0, branch: -1, parent: null, hidden: 0 };
  out.push(rootP);
  const place = (n: MindNode, parent: Placed, side: -1 | 1, depth: number, branch: number, yTop: number) => {
    const s = size(n, depth);
    const sp = span.get(n.id)!;
    const x = parent.x + side * (parent.w / 2 + GAP_X + s.w / 2);
    const p: Placed = { node: n, x, y: yTop + sp / 2, w: s.w, h: s.h, lines: s.lines, side, depth, branch, parent, hidden: collapsed.has(n.id) ? n.children.length : 0 };
    out.push(p);
    const ks = kids(n);
    const total = ks.reduce((a, k) => a + span.get(k.id)!, 0) + GAP_Y * Math.max(0, ks.length - 1);
    let y = yTop + (sp - total) / 2;
    for (const k of ks) { place(k, p, side, depth + 1, branch, y); y += span.get(k.id)! + GAP_Y; }
  };
  const column = (list: MindNode[], side: -1 | 1) => {
    const total = list.reduce((a, k) => a + span.get(k.id)!, 0) + GAP_Y * 2 * Math.max(0, list.length - 1);
    let y = -total / 2;
    for (const k of list) { place(k, rootP, side, 1, top.indexOf(k), y); y += span.get(k.id)! + GAP_Y * 2; }
  };
  column(right, 1);
  column(left, -1);
  const xs = out.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]), ys = out.flatMap((p) => [p.y - p.h / 2, p.y + p.h / 2]);
  const bounds = { x: Math.min(...xs) - 30, y: Math.min(...ys) - 30, w: Math.max(...xs) - Math.min(...xs) + 60, h: Math.max(...ys) - Math.min(...ys) + 60 };
  return { placed: out, bounds };
}

const colorOf = (p: Placed) => (p.branch < 0 ? "rgb(var(--mirror))" : BRANCH[p.branch % BRANCH.length]!);

function MapSvg({ placed, bounds, view, marks, selected, matches, showPrereq, onSelect, onToggle, transform, interactive }: {
  placed: Placed[]; bounds: { x: number; y: number; w: number; h: number }; view: GraphViewData; marks: ConceptMark[];
  selected: string | null; matches: Set<string>; showPrereq: boolean; onSelect?: (k: string | null) => void; onToggle?: (k: string) => void;
  transform?: string; interactive: boolean;
}) {
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const markOf = (c: GraphConcept | null) => {
    if (!c) return null;
    const ks = keysOf(c.name);
    return marks.find((m) => keysOf(m.concept).some((k) => ks.includes(k)))?.status ?? null;
  };
  const edge = (a: Placed, b: Placed) => {
    const x1 = a.x + b.side * a.w / 2, x2 = b.x - b.side * b.w / 2;
    const dx = (x2 - x1) / 2;
    return `M${x1} ${a.y} C ${x1 + dx} ${a.y}, ${x2 - dx} ${b.y}, ${x2} ${b.y}`;
  };
  const prereqs = showPrereq ? view.relations.filter((r) => r.type === "CAN_BIET_TRUOC" && byId.has(r.from) && byId.has(r.to)) : [];
  return (
    <svg viewBox={interactive ? undefined : `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`} className="h-full w-full select-none" role="img" aria-label="Bản đồ khái niệm dạng mind map">
      <defs>
        <marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#E2A63B" />
        </marker>
      </defs>
      <g transform={transform}>
        {placed.filter((p) => p.parent).map((p) => (
          <path key={`e-${p.node.id}`} d={edge(p.parent!, p)} fill="none" stroke={colorOf(p)} strokeOpacity={0.55} strokeWidth={p.depth === 1 ? 2.6 : 1.6} />
        ))}
        {prereqs.map((r, i) => {
          const a = byId.get(r.from)!, b = byId.get(r.to)!;
          return <path key={`p-${i}`} d={`M${a.x} ${a.y + a.h / 2} Q ${(a.x + b.x) / 2} ${Math.max(a.y, b.y) + 60}, ${b.x} ${b.y + b.h / 2}`} fill="none" stroke="#E2A63B" strokeWidth={1.4} strokeDasharray="5 4" markerEnd="url(#mm-arrow)" opacity={0.85} />;
        })}
        {placed.map((p) => {
          const root = p.depth === 0;
          const c = colorOf(p);
          const m = markOf(p.node.concept);
          const sel = selected === p.node.id;
          const hit = matches.has(p.node.id);
          const dim = matches.size > 0 && !hit && !root;
          return (
            <g key={p.node.id} opacity={dim ? 0.35 : 1} className={interactive ? "cursor-pointer" : undefined}
              onClick={interactive ? (e) => { e.stopPropagation(); onSelect?.(root ? null : sel ? null : p.node.id); } : undefined}>
              <title>{p.node.label}{p.node.concept?.description ? ` — ${p.node.concept.description}` : ""}</title>
              <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={root ? 14 : 10}
                fill={root ? "rgb(var(--mirror))" : c} fillOpacity={root ? 1 : p.depth === 1 ? 0.18 : 0.08}
                stroke={sel || hit ? "rgb(var(--ink))" : m === "needs" ? "#E2A63B" : m === "solid" ? "#3FA77F" : c}
                strokeWidth={sel || hit ? 2.4 : m ? 2 : p.depth === 1 ? 1.6 : 1} strokeDasharray={m === "needs" ? "4 3" : undefined} />
              {p.lines.map((l, i) => (
                <text key={i} x={p.x} y={p.y + (i - (p.lines.length - 1) / 2) * (root ? 20 : 16) + (root ? 5.5 : 4.5)} textAnchor="middle"
                  fontSize={root ? 16 : FONT} fontWeight={root || p.depth === 1 ? 700 : 500} fill={root ? "#fff" : "rgb(var(--ink))"}>{l}</text>
              ))}
              {interactive && p.node.children.length > 0 && !root && (
                <g onClick={(e) => { e.stopPropagation(); onToggle?.(p.node.id); }} className="cursor-pointer">
                  <circle cx={p.x + p.side * (p.w / 2 + 10)} cy={p.y} r={8} fill="rgb(var(--sheet))" stroke={c} strokeWidth={1.4} />
                  <text x={p.x + p.side * (p.w / 2 + 10)} y={p.y + 4} textAnchor="middle" fontSize={p.hidden > 9 ? 8 : 11} fontWeight={700} fill={c}>{p.hidden ? (p.hidden > 9 ? "9+" : `+${p.hidden}`) : "−"}</text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function useInitialCollapsed(root: MindNode) {
  return useMemo(() => {
    let count = 0;
    const walk = (n: MindNode) => { count++; n.children.forEach(walk); };
    walk(root);
    const set = new Set<string>();
    if (count > 45) {
      // Bản đồ lớn: mở sẵn tới cấp 2, các nhánh sâu hơn thu gọn (bấm dấu + để mở).
      const fold = (n: MindNode, d: number) => { if (d >= 2 && n.children.length) set.add(n.id); n.children.forEach((k) => fold(k, d + 1)); };
      fold(root, 0);
    }
    return set;
  }, [root]);
}

/** Ô xem trước: vừa khung, không cuộn; bấm để mở toàn màn hình. */
export function MindMapPreview({ view, title, marks, onOpen }: { view: GraphViewData; title: string; marks: ConceptMark[]; onOpen: () => void }) {
  const root = useMemo(() => buildMindTree(view, title), [view, title]);
  const collapsed = useInitialCollapsed(root);
  const { placed, bounds } = useMemo(() => layout(root, collapsed), [root, collapsed]);
  return (
    <button type="button" onClick={onOpen} aria-label="Mở bản đồ khái niệm toàn màn hình"
      className="group relative block h-[22rem] w-full overflow-hidden rounded-xl border border-line bg-paper/40 text-left transition hover:border-mirror/60">
      <div className="pointer-events-none h-full w-full p-2">
        <MapSvg placed={placed} bounds={bounds} view={view} marks={marks} selected={null} matches={new Set()} showPrereq={false} interactive={false} />
      </div>
      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-mirror px-3 py-1.5 text-xs font-semibold text-white shadow-md group-hover:bg-mirror/90">
        <Icon name="external" className="h-3.5 w-3.5" /> Mở toàn màn hình
      </span>
    </button>
  );
}

/** Xem toàn màn hình: kéo để di chuyển, cuộn chuột / nút để phóng to, bấm khái niệm để xem căn cứ. */
export function MindMapFullscreen({ view, title, marks, onClose }: { view: GraphViewData; title: string; marks: ConceptMark[]; onClose: () => void }) {
  const root = useMemo(() => buildMindTree(view, title), [view, title]);
  const initial = useInitialCollapsed(root);
  const [collapsed, setCollapsed] = useState<Set<string>>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showPrereq, setShowPrereq] = useState(false);
  const { placed, bounds } = useMemo(() => layout(root, collapsed), [root, collapsed]);
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(1.4, Math.max(0.2, Math.min(width / bounds.w, height / bounds.h)));
    setT({ k, x: width / 2 - (bounds.x + bounds.w / 2) * k, y: height / 2 - (bounds.y + bounds.h / 2) * k });
  }, [bounds]);
  useEffect(() => { fit(); }, [root]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    setT((o) => {
      const k = Math.min(3, Math.max(0.15, o.k * factor));
      return { k, x: px - ((px - o.x) / o.k) * k, y: py - ((py - o.y) / o.k) * k };
    });
  };
  const centerOn = (id: string) => {
    const p = placed.find((x) => x.node.id === id);
    const el = box.current;
    if (!p || !el) return;
    const r = el.getBoundingClientRect();
    setT((o) => ({ ...o, x: r.width / 2 - p.x * o.k, y: r.height / 2 - p.y * o.k }));
  };

  // Tìm: so không dấu; mở các nhánh chứa kết quả.
  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (q.length < 2) return new Set<string>();
    return new Set(view.concepts.filter((c) => fold(c.name).includes(q) || fold(c.description).includes(q)).map((c) => c.key));
  }, [query, view]);
  useEffect(() => {
    if (!matches.size) return;
    const parents = new Map<string, string>();
    const walk = (n: MindNode) => n.children.forEach((k) => { parents.set(k.id, n.id); walk(k); });
    walk(root);
    setCollapsed((old) => {
      const next = new Set(old);
      for (const m of matches) for (let p = parents.get(m); p; p = parents.get(p)) next.delete(p);
      return next;
    });
  }, [matches, root]);

  // Mở khung chi tiết làm hẹp vùng vẽ → đưa khái niệm đang chọn về giữa phần còn thấy.
  useEffect(() => { if (selected) { const h = setTimeout(() => centerOn(selected), 30); return () => clearTimeout(h); } }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setCollapsed((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sel = view.concepts.find((c) => c.key === selected) ?? null;
  const total = view.concepts.length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-label={`Bản đồ khái niệm: ${title}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-sheet px-4 py-2.5">
        <div className="mr-2 min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="text-[11px] text-muted">{total} khái niệm · {view.relations.length} quan hệ có căn cứ</p>
        </div>
        <label className="relative ml-auto">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" className="h-3.5 w-3.5" /></span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm khái niệm…" aria-label="Tìm khái niệm"
            onKeyDown={(e) => { if (e.key === "Enter" && matches.size) setSelected([...matches][0]!); }}
            className="w-44 rounded-lg border border-line bg-paper py-1.5 pl-8 pr-2 text-sm outline-none focus:border-mirror sm:w-56" />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showPrereq} onChange={(e) => setShowPrereq(e.target.checked)} /> Hiện “cần biết trước”
        </label>
        <div className="flex items-center gap-1">
          <button onClick={() => zoomAt(1 / 1.25)} className="rounded-lg border border-line px-2.5 py-1 text-sm" aria-label="Thu nhỏ">−</button>
          <button onClick={() => zoomAt(1.25)} className="rounded-lg border border-line px-2.5 py-1 text-sm" aria-label="Phóng to">+</button>
          <button onClick={fit} className="rounded-lg border border-line px-2.5 py-1 text-xs">Vừa màn hình</button>
          <button onClick={() => setCollapsed(new Set())} className="hidden rounded-lg border border-line px-2.5 py-1 text-xs sm:inline">Mở hết</button>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-paper hover:text-ink" aria-label="Đóng"><Icon name="x" /></button>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div ref={box} className="relative min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing" style={{ touchAction: "none" }}
          onWheel={(e) => { const r = box.current!.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false }; }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
            if (d.moved) setT((o) => ({ ...o, x: d.tx + e.clientX - d.x, y: d.ty + e.clientY - d.y }));
          }}
          onPointerUp={() => { justDragged.current = !!drag.current?.moved; drag.current = null; setTimeout(() => { justDragged.current = false; }, 0); }}
          onPointerLeave={() => { drag.current = null; }}
          onClickCapture={(e) => { if (justDragged.current) e.stopPropagation(); }}
          onClick={() => setSelected(null)}>
          <MapSvg placed={placed} bounds={bounds} view={view} marks={marks} selected={selected} matches={matches} showPrereq={showPrereq}
            onSelect={setSelected} onToggle={toggle} transform={`translate(${t.x} ${t.y}) scale(${t.k})`} interactive />
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-sheet/90 px-3 py-2 text-[11px] text-muted shadow-sm">
            <span>Kéo để di chuyển · cuộn chuột để phóng to · bấm dấu +/− để mở/thu nhánh</span>
            {showPrereq && <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-[#E2A63B]" />cần biết trước</span>}
            {marks.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border-2 border-dashed border-[#E2A63B]" />cần ôn · <span className="h-2.5 w-2.5 rounded-sm border-2 border-[#3FA77F]" />đã vững</span>}
          </div>
        </div>
        {sel && <ConceptPanel concept={sel} view={view} onClose={() => setSelected(null)} onPick={(k) => setSelected(k)} />}
      </div>
    </div>
  );
}

function ConceptPanel({ concept, view, onClose, onPick }: { concept: GraphConcept; view: GraphViewData; onClose: () => void; onPick: (k: string) => void }) {
  const name = (k: string) => view.concepts.find((c) => c.key === k)?.name ?? k;
  const parent = concept.parent && view.concepts.some((c) => c.key === concept.parent) ? concept.parent : null;
  const children = view.concepts.filter((c) => c.parent === concept.key);
  const groups: [string, GraphRel[], (r: GraphRel) => string][] = [
    ["Cần biết trước", view.relations.filter((r) => r.type === "CAN_BIET_TRUOC" && r.to === concept.key), (r) => r.from],
    ["Là nền cho", view.relations.filter((r) => r.type === "CAN_BIET_TRUOC" && r.from === concept.key), (r) => r.to],
    ["Liên quan", view.relations.filter((r) => r.type === "LIEN_QUAN" && (r.from === concept.key || r.to === concept.key)), (r) => (r.from === concept.key ? r.to : r.from)],
  ];
  const pages = concept.pages.filter(Boolean);
  return (
    <aside className="absolute inset-y-0 right-0 z-10 w-full max-w-sm overflow-y-auto border-l border-line bg-sheet p-4 shadow-xl sm:static sm:shadow-none">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-ink">{concept.name}</p>
          {pages.length > 0 && <p className="text-[11px] text-muted">Xuất hiện ở tr. {pages.slice(0, 6).join(", ")}{pages.length > 6 ? "…" : ""}</p>}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink" aria-label="Đóng chi tiết"><Icon name="x" className="h-4 w-4" /></button>
      </div>
      {concept.description && <p className="mt-2 text-sm leading-relaxed text-ink/80">{concept.description}</p>}
      {(parent || children.length > 0) && (
        <div className="mt-3 text-xs text-muted">
          {parent && <p>Thuộc: <button onClick={() => onPick(parent)} className="font-medium text-mirror">{name(parent)}</button></p>}
          {children.length > 0 && <p className="mt-1">Gồm: {children.slice(0, 8).map((c, i) => <span key={c.key}>{i ? ", " : ""}<button onClick={() => onPick(c.key)} className="font-medium text-mirror">{c.name}</button></span>)}</p>}
        </div>
      )}
      {groups.map(([label, rs, other]) => rs.length ? (
        <div key={label} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
          <ul className="mt-1.5 space-y-2">
            {rs.map((r, i) => (
              <li key={i} className="rounded-lg border border-line p-2.5">
                <button onClick={() => onPick(other(r))} className="text-sm font-medium text-ink hover:text-mirror">{name(other(r))}</button>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">“{r.evidence.quote}”</p>
                <p className="text-[11px] text-muted">{r.evidence.documentTitle}{r.evidence.page ? `, tr. ${r.evidence.page}` : ""}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null)}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link to={`/?topic=${encodeURIComponent(concept.name)}&mode=explore&level=beginner`} className="rounded-lg bg-mirror px-3 py-1.5 text-xs font-semibold text-white">Học từ đầu</Link>
        <Link to={`/?topic=${encodeURIComponent(concept.name)}&mode=reunderstand`} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-mirror">Tự kiểm tra</Link>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted">Cách xếp nhánh (khái niệm nào thuộc mục nào) do AI sắp khi đọc tài liệu. Quan hệ “cần biết trước” và “liên quan” luôn kèm câu nguyên văn trong tài liệu.</p>
    </aside>
  );
}
