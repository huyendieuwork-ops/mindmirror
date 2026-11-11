import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, explain, type Folder, type GraphConcept, type GraphRel, type GraphStatus, type GraphViewData, type LibraryDoc } from "../lib/api";
import { knowledgeGaps, useLearningData } from "../lib/data";
import { keysOf } from "./KnowledgeGraph";
import { Empty, Icon } from "./ui";

type StepStatus = "solid" | "needs" | "new";
interface Step { concept: GraphConcept; pre: GraphRel[]; status: StepStatus; depth: number }

const STATUS: Record<StepStatus, { label: string; tone: string }> = {
  solid: { label: "Đã nắm vững", tone: "bg-[#E3F5EC] text-[#2E8B66]" },
  needs: { label: "Cần ôn lại", tone: "bg-[#FFF3D6] text-[#B07A12]" },
  new: { label: "Chưa học", tone: "bg-paper text-muted" },
};

/** Sắp khái niệm theo quan hệ CẦN BIẾT TRƯỚC (A → B: học A trước B). Vòng lặp thì cắt; nút không có quan hệ xếp cuối. */
export function orderConcepts(concepts: GraphConcept[], relations: GraphRel[]): { concept: GraphConcept; pre: GraphRel[]; depth: number }[] {
  const keys = new Set(concepts.map((c) => c.key));
  const cbt = relations.filter((r) => r.type === "CAN_BIET_TRUOC" && keys.has(r.from) && keys.has(r.to) && r.from !== r.to);
  const pre = new Map<string, GraphRel[]>();
  for (const r of cbt) pre.set(r.to, [...(pre.get(r.to) ?? []), r]);
  const inCbt = new Set(cbt.flatMap((r) => [r.from, r.to]));
  const depth = new Map<string, number>();
  const visit = (k: string, stack: Set<string>): number => {
    if (depth.has(k)) return depth.get(k)!;
    if (stack.has(k)) return 0;
    stack.add(k);
    const d = Math.max(-1, ...(pre.get(k) ?? []).map((r) => visit(r.from, stack))) + 1;
    stack.delete(k);
    depth.set(k, d);
    return d;
  };
  concepts.filter((c) => inCbt.has(c.key)).forEach((c) => visit(c.key, new Set()));
  // Khái niệm chỉ có quan hệ LIÊN QUAN: đứng ngay sau khái niệm liên quan đã xếp; không có quan hệ nào → cuối danh sách.
  for (let changed = true; changed;) {
    changed = false;
    for (const c of concepts) {
      if (depth.has(c.key)) continue;
      const near = relations.filter((r) => r.type !== "CAN_BIET_TRUOC" && (r.from === c.key || r.to === c.key)).map((r) => (r.from === c.key ? r.to : r.from)).filter((k) => depth.has(k));
      if (near.length) { depth.set(c.key, Math.max(...near.map((k) => depth.get(k)!)) + 0.5); changed = true; }
    }
  }
  concepts.forEach((c) => { if (!depth.has(c.key)) depth.set(c.key, 1000); });
  const dependents = (k: string) => cbt.filter((r) => r.from === k).length;
  return [...concepts]
    .sort((a, b) => depth.get(a.key)! - depth.get(b.key)! || dependents(b.key) - dependents(a.key) || a.name.localeCompare(b.name, "vi"))
    .map((c) => ({ concept: c, pre: pre.get(c.key) ?? [], depth: Math.floor(depth.get(c.key) ?? 0) }));
}

/**
 * Tab "Lộ trình" của thư mục: thứ tự học suy ra từ sơ đồ khái niệm (quan hệ "cần biết trước" có câu căn cứ trong tài liệu)
 * + trạng thái từ kết quả các phiên học. Không gọi AI — chỉ đọc đồ thị đã dựng và lịch sử học.
 */
export default function FolderRoadmap({ folder, docs, onOpenGraph }: { folder: Folder | null; docs: LibraryDoc[]; onOpenGraph: () => void }) {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [view, setView] = useState<GraphViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    const markOf = (c: GraphConcept): StepStatus => {
      const ks = keysOf(c.name);
      const hit = marks.filter((m) => keysOf(m.concept).some((k) => ks.includes(k)));
      return hit.some((m) => m.status === "needs") ? "needs" : hit.some((m) => m.status === "solid") ? "solid" : "new";
    };
    return orderConcepts(view.concepts, view.relations).slice(0, 15).map((o) => ({ ...o, status: markOf(o.concept) }));
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
  const solidKeys = new Set(steps.filter((s) => s.status === "solid").map((s) => s.concept.key));
  const next = steps.find((s) => s.status !== "solid" && s.pre.every((r) => solidKeys.has(r.from))) ?? steps.find((s) => s.status !== "solid") ?? null;
  const href = (s: Step) => {
    const q = new URLSearchParams({ topic: s.concept.name, ...(folder ? { folder: folder.id } : {}) });
    if (s.status === "solid") q.set("mode", "reunderstand");
    else { q.set("mode", "explore"); q.set("level", s.status === "needs" ? "review" : "beginner"); }
    return `/?${q.toString()}`;
  };
  const action = (s: Step) => (s.status === "solid" ? "Tự kiểm tra" : s.status === "needs" ? "Ôn lại" : "Học từ đầu");

  return (
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <p className="mb-4 rounded-xl bg-mist/50 px-4 py-3 text-sm text-ink/80">
          Lộ trình được sắp theo quan hệ “cần biết trước” tìm thấy trong tài liệu của thư mục; mỗi quan hệ có câu trích nguyên văn làm căn cứ. Trạng thái lấy từ kết quả các phiên học của bạn.
        </p>
        <ol className="space-y-3">
          {steps.map((s, i) => {
            const ev = s.pre[0]?.evidence;
            return (
              <li key={s.concept.key} className={`flex gap-3 rounded-xl border p-4 ${next?.concept.key === s.concept.key ? "border-mirror bg-mist/30" : "border-line bg-sheet"}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${s.status === "solid" ? "bg-moss text-white" : "bg-paper text-ink"}`}>{s.status === "solid" ? "✓" : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{s.concept.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[s.status].tone}`}>{STATUS[s.status].label}</span>
                  </div>
                  {s.concept.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{s.concept.description}</p>}
                  {s.pre.length > 0 && (
                    <p className="mt-1.5 text-xs text-muted">
                      Cần biết trước: <span className="text-ink">{s.pre.map((r) => r.fromName).join(", ")}</span>
                      {ev && <> · Căn cứ: “{ev.quote.length > 120 ? ev.quote.slice(0, 120) + "…" : ev.quote}” — {ev.documentTitle}{ev.page ? `, tr.${ev.page}` : ""}</>}
                    </p>
                  )}
                </div>
                <Link to={href(s)} className="shrink-0 self-center rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-mirror hover:border-mirror/60">{action(s)}</Link>
              </li>
            );
          })}
        </ol>
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl border border-line p-4">
          <p className="text-sm font-semibold text-ink">Tiến độ lộ trình</p>
          <p className="mt-2 text-2xl font-bold text-ink">{solid}/{steps.length}</p>
          <p className="text-xs text-muted">khái niệm đã nắm vững</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-moss" style={{ width: `${Math.round((solid / steps.length) * 100)}%` }} /></div>
        </section>
        {next && (
          <section className="rounded-xl border border-mirror/40 bg-mist/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mirror">Bước tiếp theo</p>
            <p className="mt-1 font-semibold text-ink">{next.concept.name}</p>
            <p className="mt-1 text-xs text-muted">
              {steps.filter((x) => x.pre.some((r) => r.from === next.concept.key)).length
                ? `Là điều kiện cần trước khi học ${steps.filter((x) => x.pre.some((r) => r.from === next.concept.key)).map((x) => x.concept.name).slice(0, 2).join(", ")}.`
                : "Chưa có khái niệm nào phụ thuộc vào phần này."}
            </p>
            <Link to={href(next)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-mirror px-3 py-2 text-sm font-semibold text-white hover:bg-mirror/90">{action(next)} <Icon name="arrowRight" /></Link>
          </section>
        )}
        <section className="rounded-xl border border-line p-4 text-xs text-muted">
          <p>Tạo từ {read}/{total} trang của {Math.min(5, docs.length)} tài liệu.</p>
          {read < total && <button onClick={onOpenGraph} className="mt-2 font-medium text-mirror">Đọc thêm trang để cập nhật lộ trình →</button>}
        </section>
      </aside>
    </div>
  );
}
