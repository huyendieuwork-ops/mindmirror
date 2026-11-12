import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, explain, type GraphBuildResult, type GraphStatus, type GraphViewData, type LibraryDoc } from "../lib/api";
import { MindMapFullscreen, MindMapPreview, type ConceptMark } from "./MindMap";
import { Icon } from "./ui";

export { keysOf, type ConceptMark } from "./MindMap";

/**
 * Bản đồ khái niệm dạng mind map, dựng từ đồ thị thật (Neo4j): chọn tài liệu → "Đọc tài liệu" (mỗi lần tới N trang)
 * hoặc "Đọc hết" (tự bấm tiếp tới khi hết trang / hết lượt trong ngày). Ô xem trước vừa khung; bấm để mở toàn màn hình.
 */
export default function KnowledgeGraph({ docs, marks, title }: { docs: LibraryDoc[]; marks: ConceptMark[]; title?: string }) {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<GraphViewData | null>(null);
  const [busy, setBusy] = useState<null | "one" | "all">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const stop = useRef(false);

  useEffect(() => { api.graphStatus().then(setStatus).catch(() => setStatus({ configured: false, connected: false, kind: null, limits: { pagesPerBuild: 40, buildsPerDay: 10 } })); }, []);
  useEffect(() => { if (!selected.length && docs.length) setSelected(docs.slice(0, 5).map((d) => d.id)); }, [docs, selected.length]);
  useEffect(() => {
    if (!status?.connected || !selected.length) return;
    setView(null);
    api.graph(selected).then(setView).catch((e) => setError(explain(e)));
  }, [status?.connected, selected.join(",")]);

  const totalPages = (id: string) => docs.find((d) => d.id === id)?.pageCount ?? 0;
  const read = (id: string) => view?.documents.find((d) => d.id === id)?.extractedPages ?? 0;
  const total = selected.reduce((a, id) => a + totalPages(id), 0);
  const done = selected.reduce((a, id) => a + Math.min(totalPages(id), read(id)), 0);
  const remaining = Math.max(0, total - done);
  const mapTitle = title ?? (selected.length === 1 ? docs.find((d) => d.id === selected[0])?.title ?? "Bản đồ khái niệm" : "Bản đồ khái niệm");

  const describe = (r: GraphBuildResult) => {
    const failed = r.dropped.batches ? ` ${r.dropped.batches} phần chưa đọc được (thường do hết lượt AI) — sẽ đọc lại ở lần sau.` : "";
    return r.processedPages === 0
      ? (failed ? `Chưa đọc được trang nào.${failed}` : "Đã đọc hết các trang của tài liệu đã chọn.")
      : `Đã đọc ${r.processedPages} trang: thêm ${r.concepts} khái niệm, ${r.relations} quan hệ có căn cứ.${r.remainingPages ? ` Còn ${r.remainingPages} trang.` : " Đã đọc hết tài liệu."}${failed}`;
  };

  async function build(all: boolean) {
    setBusy(all ? "all" : "one"); setError(null); setMsg(null); stop.current = false;
    let pages = 0, concepts = 0, relations = 0;
    try {
      for (let round = 0; round < (all ? 10 : 1); round++) {
        const r = await api.buildGraph(selected);
        pages += r.processedPages; concepts += r.concepts; relations += r.relations;
        setView(await api.graph(selected));
        if (!all) { setMsg(describe(r)); break; }
        setMsg(`Đang đọc… đã xong ${pages} trang, ${concepts} khái niệm, ${relations} quan hệ${r.remainingPages ? ` · còn ${r.remainingPages} trang` : ""}.`);
        if (r.done || r.processedPages === 0 || stop.current) {
          setMsg(r.done ? `Đã đọc hết tài liệu: ${pages} trang, thêm ${concepts} khái niệm và ${relations} quan hệ có căn cứ.` : describe(r));
          break;
        }
      }
    } catch (e) {
      setError(explain(e));
      if (pages) setMsg(`Đã đọc được ${pages} trang trước khi dừng.`);
    } finally { setBusy(null); }
  }

  if (!status) return <p className="py-6 text-center text-sm text-muted">Đang kiểm tra kết nối đồ thị…</p>;
  if (!status.configured || !status.connected)
    return (
      <div className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
        <p className="font-medium text-ink">Bản đồ khái niệm chưa bật</p>
        <p className="mt-1">{status.configured ? "Máy chủ chưa kết nối được cơ sở dữ liệu đồ thị. Thử lại sau ít phút." : "Máy chủ chưa được cấu hình Neo4j (NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD)."}</p>
      </div>
    );
  if (!docs.length) return <p className="py-6 text-center text-sm text-muted">Tải tài liệu lên thư viện để tạo bản đồ khái niệm. <Link to="/folders" className="font-medium text-mirror">Thư mục →</Link></p>;

  const hasMap = !!view && view.concepts.length > 0;
  return (
    <div className="space-y-4">
      {docs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Tài liệu:</span>
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
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
        <div className="min-w-[10rem] flex-1">
          <div className="flex items-baseline justify-between text-xs text-muted">
            <span>Đã đọc {done}/{total} trang</span>
            {hasMap && <span>{view!.concepts.length} khái niệm · {view!.relations.length} quan hệ</span>}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper">
            <div className="h-full rounded-full bg-mirror transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>
        </div>
        {busy === "all" ? (
          <button onClick={() => { stop.current = true; }} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink">Dừng sau lượt này</button>
        ) : (
          <>
            <button onClick={() => build(true)} disabled={!!busy || !selected.length || (hasMap && !remaining)}
              className="inline-flex items-center gap-2 rounded-lg bg-mirror px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              <Icon name="bulb" /> {hasMap ? (remaining ? `Đọc hết phần còn lại (~${remaining} trang)` : "Đã đọc hết") : "Tạo bản đồ khái niệm"}
            </button>
            {remaining > status.limits.pagesPerBuild && (
              <button onClick={() => build(false)} disabled={!!busy} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-50">
                {busy === "one" ? "Đang đọc…" : `Chỉ đọc ${status.limits.pagesPerBuild} trang`}
              </button>
            )}
          </>
        )}
      </div>
      <p className="-mt-2 text-[11px] text-muted">Mỗi lượt đọc tới {status.limits.pagesPerBuild} trang · {status.limits.buildsPerDay} lượt/ngày. “Đọc hết” tự đọc tiếp tới khi xong hoặc hết lượt trong ngày.</p>
      {busy === "all" && <p className="rounded-lg bg-mist/60 px-3 py-2 text-sm text-ink">{msg ?? "Đang đọc tài liệu…"}</p>}
      {busy !== "all" && msg && <p className="rounded-lg bg-paper px-3 py-2 text-sm text-ink">{msg}</p>}
      {error && <p className="rounded-lg bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p>}

      {hasMap ? (
        <>
          <MindMapPreview view={view!} title={mapTitle} marks={marks} onOpen={() => setFull(true)} />
          {full && <MindMapFullscreen view={view!} title={mapTitle} marks={marks} onClose={() => setFull(false)} />}
        </>
      ) : view ? (
        <p className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-muted">Chưa có bản đồ cho tài liệu này. Bấm “Tạo bản đồ khái niệm” để MindMirror đọc tài liệu và sắp các ý chính thành sơ đồ.</p>
      ) : (
        <p className="py-6 text-center text-sm text-muted">Đang tải bản đồ…</p>
      )}
    </div>
  );
}
