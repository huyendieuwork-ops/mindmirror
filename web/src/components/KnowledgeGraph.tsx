import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, explain, type GraphConcept, type GraphRel, type GraphStatus, type GraphViewData, type LibraryDoc } from "../lib/api";
import { Icon } from "./ui";

/** Trạng thái học của khái niệm (từ các phiên đã làm) để tô màu nút. */
export type ConceptMark = { concept: string; status: "needs" | "solid" };

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
export const keysOf = (name: string) => {
  const base = norm(name.replace(/\([^)]*\)/g, " "));
  const inner = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => norm(m[1]!));
  return [base, ...inner].filter(Boolean);
};

/**
 * Bản đồ kiến thức vẽ từ đồ thị thật (Neo4j): chọn tài liệu → "Tạo bản đồ khái niệm" (mỗi lần đọc ≤ N trang).
 * Cột trái → phải theo quan hệ CẦN BIẾT TRƯỚC; nét đứt = LIÊN QUAN. Bấm nút để xem câu căn cứ trong tài liệu.
 */
export default function KnowledgeGraph({ docs, marks }: { docs: LibraryDoc[]; marks: ConceptMark[] }) {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<GraphViewData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => { api.graphStatus().then(setStatus).catch(() => setStatus({ configured: false, connected: false, kind: null, limits: { pagesPerBuild: 6, buildsPerDay: 10 } })); }, []);
  useEffect(() => { if (!selected.length && docs.length) setSelected([docs[0]!.id]); }, [docs, selected.length]);
  useEffect(() => {
    if (!status?.connected || !selected.length) return;
    api.graph(selected).then(setView).catch((e) => setError(explain(e)));
  }, [status?.connected, selected.join(",")]);

  const totalPages = (id: string) => docs.find((d) => d.id === id)?.pageCount ?? 0;
  const read = (id: string) => view?.documents.find((d) => d.id === id)?.extractedPages ?? 0;
  const remaining = selected.reduce((a, id) => a + Math.max(0, totalPages(id) - read(id)), 0);

  async function build() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api.buildGraph(selected);
      const failed = r.dropped.batches ? ` ${r.dropped.batches} phần chưa đọc được (thường do hết lượt AI hoặc AI trả lời lỗi) — các trang đó sẽ được đọc lại ở lần bấm sau.` : "";
      setMsg(r.processedPages === 0 ? (failed ? `Chưa đọc được trang nào.${failed}` : "Đã đọc hết các trang của tài liệu đã chọn.") :
        `Đã đọc ${r.processedPages} trang: thêm ${r.concepts} khái niệm, ${r.relations} quan hệ có căn cứ${r.dropped.relations ? ` (bỏ ${r.dropped.relations} quan hệ không tìm thấy câu căn cứ)` : ""}.${r.remainingPages ? ` Còn ${r.remainingPages} trang — bấm tiếp để đọc.` : ""}${failed}`);
      setView(await api.graph(selected));
    } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }

  if (!status) return <p className="py-6 text-center text-sm text-muted">Đang kiểm tra kết nối đồ thị…</p>;
  if (!status.configured || !status.connected)
    return (
      <div className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
        <p className="font-medium text-ink">Bản đồ khái niệm chưa bật</p>
        <p className="mt-1">{status.configured ? "Máy chủ chưa kết nối được Neo4j. Thử lại sau ít phút." : "Máy chủ chưa được cấu hình Neo4j (NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD)."}</p>
      </div>
    );
  if (!docs.length) return <p className="py-6 text-center text-sm text-muted">Tải tài liệu lên thư viện để tạo bản đồ khái niệm. <Link to="/library" className="font-medium text-mirror">Thư viện →</Link></p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {docs.slice(0, 12).map((d) => {
          const on = selected.includes(d.id);
          return (
            <button key={d.id} onClick={() => setSelected(on ? selected.filter((x) => x !== d.id) : selected.length >= 5 ? selected : [...selected, d.id])}
              className={`max-w-[16rem] truncate rounded-full border px-3 py-1 text-xs ${on ? "border-mirror bg-mist font-medium text-mirror" : "border-line text-muted hover:border-mirror/50"}`} title={d.title}>
              {on ? "✓ " : ""}{d.title}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={build} disabled={busy || !selected.length}
          className="inline-flex items-center gap-2 rounded-lg bg-mirror px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <Icon name="bulb" /> {busy ? "Đang đọc tài liệu…" : view?.concepts.length ? (remaining ? `Đọc tiếp (còn ~${remaining} trang)` : "Cập nhật bản đồ") : "Tạo bản đồ khái niệm"}
        </button>
        <span className="text-xs text-muted">Mỗi lần đọc tối đa {status.limits.pagesPerBuild} trang · {status.limits.buildsPerDay} lần/ngày · chỉ tài liệu bạn chọn</span>
      </div>
      {msg && <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">{msg}</p>}
      {error && <p className="rounded-lg bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p>}
      {view && view.concepts.length ? (
        <GraphCanvas view={view} marks={marks} focus={focus} onFocus={setFocus} />
      ) : (
        <p className="py-6 text-center text-sm text-muted">Chưa có bản đồ cho tài liệu này. Bấm “Tạo bản đồ khái niệm” để MindMirror đọc tài liệu và rút ra các khái niệm cùng quan hệ giữa chúng.</p>
      )}
    </div>
  );
}

function GraphCanvas({ view, marks, focus, onFocus }: { view: GraphViewData; marks: ConceptMark[]; focus: string | null; onFocus: (k: string | null) => void }) {
  const layout = useMemo(() => layoutGraph(view.concepts, view.relations), [view]);
  const markOf = (c: GraphConcept) => {
    const ks = keysOf(c.name);
    return marks.find((m) => keysOf(m.concept).some((k) => ks.includes(k)))?.status ?? null;
  };
  const sel = view.concepts.find((c) => c.key === focus) ?? null;
  const W = 150, H = 48, GX = 44, GY = 14;
  const width = layout.columns * (W + GX) - GX + 40;
  const height = layout.rows * (H + GY) - GY + 20;
  const pos = (k: string) => layout.pos.get(k)!;
  const nodeX = (col: number) => 10 + col * (W + GX);
  const nodeY = (row: number) => 10 + row * (H + GY);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-mirror" />→ cần biết trước</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-5 border-t border-dashed border-mirror" />liên quan</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-[#E2A63B] bg-[#FFF3D6]" />cần ôn</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-[#3FA77F] bg-[#E3F5EC]" />đã vững</span>
      </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="overflow-x-auto rounded-xl border border-line bg-paper/40 p-1">
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", minWidth: Math.min(width, 560), maxWidth: width }} role="img" aria-label="Bản đồ khái niệm">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="rgb(var(--mirror))" />
            </marker>
          </defs>
          {view.relations.map((r, i) => {
            let a = pos(r.from), b = pos(r.to);
            if (!a || !b) return null;
            const dim = focus && r.from !== focus && r.to !== focus;
            const cbt = r.type === "CAN_BIET_TRUOC";
            // LIÊN QUAN không có chiều → luôn vẽ từ cột trái sang cột phải.
            if (!cbt && a.col > b.col) [a, b] = [b, a];
            let d: string;
            if (a.col === b.col) {
              // Cùng cột: cung vòng bên phải nút, nằm trong khoảng trống giữa hai cột (không đè lên nút).
              const x = nodeX(a.col) + W, ya = nodeY(a.row) + H / 2, yb = nodeY(b.row) + H / 2;
              const bulge = Math.min(GX - 10, 18 + Math.abs(a.row - b.row) * 8);
              d = `M${x} ${ya} C ${x + bulge} ${ya}, ${x + bulge} ${yb}, ${x} ${yb}`;
            } else {
              const x1 = nodeX(a.col) + W, y1 = nodeY(a.row) + H / 2;
              const x2 = nodeX(b.col), y2 = nodeY(b.row) + H / 2;
              const dx = Math.max(GX / 2, (x2 - x1) / 2);
              d = `M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            }
            return <path key={i} d={d} fill="none" stroke="rgb(var(--mirror))" strokeOpacity={dim ? 0.12 : 0.65} strokeWidth={cbt ? 1.6 : 1.2}
              strokeDasharray={cbt ? undefined : "5 4"} markerEnd={cbt ? "url(#arrow)" : undefined} />;
          })}
          {view.concepts.map((c) => {
            const p = pos(c.key);
            if (!p) return null;
            const m = markOf(c);
            const x = nodeX(p.col), y = nodeY(p.row);
            const fill = m === "needs" ? "#FFF3D6" : m === "solid" ? "#E3F5EC" : "rgb(var(--sheet))";
            const stroke = focus === c.key ? "rgb(var(--mirror))" : m === "needs" ? "#E2A63B" : m === "solid" ? "#3FA77F" : "rgb(var(--line))";
            return (
              <g key={c.key} onClick={() => onFocus(focus === c.key ? null : c.key)} className="cursor-pointer" opacity={focus && focus !== c.key && !view.relations.some((r) => (r.from === focus && r.to === c.key) || (r.to === focus && r.from === c.key)) ? 0.45 : 1}>
                <title>{c.name}</title>
                <rect x={x} y={y} width={W} height={H} rx={10} fill={fill} stroke={stroke} strokeWidth={focus === c.key ? 2 : 1} />
                <text x={x + W / 2} y={y + H / 2 - 3} textAnchor="middle" fontSize="12.5" fontWeight={600} fill="rgb(var(--ink))">{c.name.length > 20 ? c.name.slice(0, 19) + "…" : c.name}</text>
                <text x={x + W / 2} y={y + H / 2 + 12} textAnchor="middle" fontSize="11" fill="rgb(var(--muted))">{c.pages.filter(Boolean).length ? `tr. ${c.pages.filter(Boolean).slice(0, 3).join(", ")}` : ""}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <aside className="text-sm">
        {sel ? (
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-ink">{sel.name}</p>
              {sel.description && <p className="text-xs text-muted">{sel.description}</p>}
            </div>
            {(["CAN_BIET_TRUOC_IN", "CAN_BIET_TRUOC_OUT", "LIEN_QUAN"] as const).map((kind) => {
              const rs = view.relations.filter((r) => kind === "CAN_BIET_TRUOC_IN" ? r.type === "CAN_BIET_TRUOC" && r.to === sel.key : kind === "CAN_BIET_TRUOC_OUT" ? r.type === "CAN_BIET_TRUOC" && r.from === sel.key : r.type === "LIEN_QUAN" && (r.from === sel.key || r.to === sel.key));
              if (!rs.length) return null;
              return (
                <div key={kind}>
                  <p className="text-xs font-semibold text-muted">{kind === "CAN_BIET_TRUOC_IN" ? "Cần biết trước" : kind === "CAN_BIET_TRUOC_OUT" ? "Là nền cho" : "Liên quan"}</p>
                  <ul className="mt-1 space-y-2">
                    {rs.map((r, i) => <RelItem key={i} r={r} other={kind === "CAN_BIET_TRUOC_IN" ? r.fromName : kind === "CAN_BIET_TRUOC_OUT" ? r.toName : r.from === sel.key ? r.toName : r.fromName} />)}
                  </ul>
                </div>
              );
            })}
            <Link to={`/explore?topic=${encodeURIComponent(sel.name)}`} className="inline-block text-xs font-medium text-mirror">Khám phá “{sel.name}” →</Link>
          </div>
        ) : (
          <p className="text-muted">{view.concepts.length} khái niệm · {view.relations.length} quan hệ. Bấm một khái niệm để xem khái niệm nền và câu căn cứ trong tài liệu.</p>
        )}
      </aside>
    </div>
    </div>
  );
}

function RelItem({ r, other }: { r: GraphRel; other: string }) {
  return (
    <li className="rounded-lg border border-line p-2">
      <p className="font-medium text-ink">{other}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">“{r.evidence.quote}”</p>
      <p className="text-[11px] text-muted">{r.evidence.documentTitle}{r.evidence.page ? `, tr. ${r.evidence.page}` : ""}</p>
    </li>
  );
}

/**
 * Xếp cột theo độ sâu CẦN BIẾT TRƯỚC (khái niệm nền ở trái). Khái niệm chỉ có quan hệ LIÊN QUAN đứng cùng cột với
 * khái niệm nó liên quan. Thứ tự trong cột theo trọng tâm (barycenter) của các nút đã xếp — giảm đường cắt nhau;
 * khái niệm không nối với gì xuống cuối.
 */
function layoutGraph(concepts: GraphConcept[], relations: GraphRel[]) {
  const keys = new Set(concepts.map((c) => c.key));
  const rels = relations.filter((r) => keys.has(r.from) && keys.has(r.to) && r.from !== r.to);
  const pre = new Map<string, string[]>();
  const hasCbt = new Set<string>();
  for (const r of rels) if (r.type === "CAN_BIET_TRUOC") { pre.set(r.to, [...(pre.get(r.to) ?? []), r.from]); hasCbt.add(r.from); hasCbt.add(r.to); }
  const depth = new Map<string, number>();
  const visit = (k: string, stack: Set<string>): number => {
    if (depth.has(k)) return depth.get(k)!;
    if (stack.has(k)) return 0; // vòng → cắt
    stack.add(k);
    const d = Math.max(-1, ...(pre.get(k) ?? []).map((p) => visit(p, stack))) + 1;
    stack.delete(k);
    depth.set(k, d);
    return d;
  };
  for (const k of hasCbt) visit(k, new Set());
  // Nút chỉ có LIÊN QUAN: theo cột của nút liên quan đã xếp (lan dần), còn lại cột 0.
  const neighbors = new Map<string, string[]>();
  for (const r of rels) { neighbors.set(r.from, [...(neighbors.get(r.from) ?? []), r.to]); neighbors.set(r.to, [...(neighbors.get(r.to) ?? []), r.from]); }
  for (let changed = true; changed;) {
    changed = false;
    for (const c of concepts) {
      if (depth.has(c.key)) continue;
      const placed = (neighbors.get(c.key) ?? []).filter((n) => depth.has(n));
      if (placed.length) { depth.set(c.key, Math.min(...placed.map((n) => depth.get(n)!))); changed = true; }
    }
  }
  const MAX_COL = 5;
  const colOf = (k: string) => Math.min(depth.get(k) ?? 0, MAX_COL);
  const cols: string[][] = [];
  for (const c of concepts) (cols[colOf(c.key)] ??= []).push(c.key);
  for (let i = 0; i < cols.length; i++) cols[i] ??= [];
  const row = new Map<string, number>();
  const assign = () => cols.forEach((ks) => ks.forEach((k, i) => row.set(k, i)));
  assign();
  const bary = (k: string, from: (n: string) => boolean) => {
    const ns = (neighbors.get(k) ?? []).filter((n) => from(n) && row.has(n));
    return ns.length ? ns.reduce((a, n) => a + row.get(n)!, 0) / ns.length : Number.POSITIVE_INFINITY;
  };
  const sortCol = (i: number, from: (n: string) => boolean) => {
    const ks = cols[i]!;
    const score = new Map(ks.map((k, idx) => [k, bary(k, from) === Number.POSITIVE_INFINITY ? (neighbors.get(k)?.length ? 1e6 + idx : 2e6 + idx) : bary(k, from)]));
    ks.sort((a, b) => score.get(a)! - score.get(b)!);
    assign();
  };
  // Hai lượt quét: trái → phải theo nút ở cột trước (và cùng cột đã xếp), rồi phải → trái theo nút ở cột sau.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < cols.length; i++) sortCol(i, (n) => colOf(n) < i);
    for (let i = cols.length - 2; i >= 0; i--) sortCol(i, (n) => colOf(n) > i);
  }
  const pos = new Map<string, { col: number; row: number }>();
  cols.forEach((ks, col) => ks.forEach((k, r) => pos.set(k, { col, row: r })));
  return { pos, columns: Math.max(cols.length, 1), rows: Math.max(1, ...cols.map((c) => c.length)) };
}
