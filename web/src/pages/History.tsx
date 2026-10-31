import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Mode } from "../lib/api";
import { MODE_PAGE, sessionPath, useLearningData } from "../lib/data";
import { PHASE_LABEL } from "../lib/labels";
import { Empty, Icon, PageHeader, SelectBox, timeAgo } from "../components/ui";

export default function History() {
  const { sessions, loading } = useLearningData();
  const [mode, setMode] = useState<"all" | Mode>("all");
  const [q, setQ] = useState("");
  const items = useMemo(() => sessions.filter((s) => (mode === "all" || s.mode === mode) && s.topic.toLowerCase().includes(q.toLowerCase())), [sessions, mode, q]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Lịch sử học tập" subtitle="Mọi phiên Kiểm tra và Khám phá kiến thức của bạn. Mở lại để tiếp tục hoặc xem thẻ tổng kết." />
      <section className="panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo chủ đề…" className="w-full rounded-lg border border-line bg-sheet py-2 pl-9 pr-3 text-sm outline-none focus:border-mirror" />
          </div>
          <SelectBox label="Chế độ" value={mode} onChange={setMode} className="sm:w-52" options={[{ value: "all", label: "Tất cả chế độ" }, { value: "reunderstand", label: "Kiểm tra kiến thức" }, { value: "explore", label: "Khám phá kiến thức" }]} />
        </div>
        {!loading && items.length === 0 ? (
          <div className="p-5"><Empty icon="clock" title="Chưa có phiên nào" action={<Link to="/check" className="text-sm font-medium text-mirror">Bắt đầu phiên đầu tiên →</Link>}>Các phiên học sẽ được lưu lại ở đây.</Empty></div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((s) => (
              <li key={s.id}>
                <Link to={sessionPath(s)} className="group flex items-center gap-4 px-5 py-4 hover:bg-paper/60">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${s.mode === "explore" ? "bg-[#F1ECFF] text-[#8B6FE0]" : "bg-mist text-mirror"}`}><Icon name={s.mode === "explore" ? "compass" : "check"} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink group-hover:text-mirror">{s.topic}</span>
                    <span className="block text-xs text-muted">{MODE_PAGE[s.mode].short} · {s.status === "finished" ? "Đã có thẻ tổng kết" : s.status === "paused" ? "Tạm dừng" : PHASE_LABEL[s.phase] ?? s.phase} · {timeAgo(s.updatedAt)}</span>
                  </span>
                  {s.status === "finished" ? <span className="hidden rounded-full bg-moss/10 px-2.5 py-1 text-xs font-medium text-moss sm:inline">Hoàn thành</span> : <span className="hidden rounded-full bg-mist px-2.5 py-1 text-xs font-medium text-mirror sm:inline">Tiếp tục</span>}
                  <Icon name="chevronRight" className="h-4 w-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
