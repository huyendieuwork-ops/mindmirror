import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { avg, folderProgress, MODE_PAGE, sessionPath, sessionScore, useLearningData, within } from "../lib/data";
import { Card, Donut, Empty, FOLDER_TONE, Icon, Progress, SelectBox, timeAgo } from "../components/ui";

export default function Home({ name }: { name: string }) {
  const data = useLearningData({ details: 20 });
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const inRange = useMemo(() => data.details.filter((d) => within(d.item.updatedAt, Number(range))), [data.details, range]);
  const overall = avg(inRange.map((d) => sessionScore(d.assessment)));
  const byFolder = folderProgress(inRange, data.docs, data.folders).slice(0, 5);
  const recent = data.sessions.slice(0, 4);
  const first = name.split(/\s+/).slice(-2).join(" ");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-ink">Chào bạn, {first} 👋</h1>
          <p className="mt-1 text-sm text-muted">Mỗi ngày một chút, hiểu sâu hơn những điều bạn đã học.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/check" className="inline-flex items-center gap-2 rounded-lg bg-mirror px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-mirror/90"><Icon name="check" /> Kiểm tra kiến thức</Link>
          <Link to="/explore" className="inline-flex items-center gap-2 rounded-lg border border-line bg-sheet px-4 py-2 text-sm font-medium text-ink hover:border-mirror/60 hover:text-mirror"><Icon name="compass" /> Khám phá kiến thức</Link>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card title="Lịch sử gần đây" action={<Link to="/history" className="inline-flex items-center gap-1 text-sm font-medium text-mirror hover:text-ink">Xem tất cả <Icon name="arrowRight" /></Link>} bodyClass="px-5 pb-3 pt-2">
          {recent.length === 0 ? (
            <div className="py-3"><Empty icon="chat" title="Chưa có phiên học nào" action={<Link to="/check" className="text-sm font-medium text-mirror">Bắt đầu phiên đầu tiên →</Link>}>Phiên học của bạn sẽ hiện ở đây để tiếp tục bất cứ lúc nào.</Empty></div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link to={sessionPath(s)} className="group flex items-center gap-4 py-3.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-mirror"><Icon name="file" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink group-hover:text-mirror">{s.topic}</span>
                      <span className="block text-xs text-muted">{MODE_PAGE[s.mode].short} • {timeAgo(s.updatedAt)}{s.status === "finished" ? " • Đã tổng kết" : ""}</span>
                    </span>
                    <Icon name="chevronRight" className="h-4 w-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Tiến độ học tập" action={<SelectBox label="Khoảng thời gian" value={range} onChange={setRange} className="w-44" options={[{ value: "7", label: "7 ngày gần đây" }, { value: "30", label: "30 ngày gần đây" }, { value: "90", label: "90 ngày gần đây" }]} />}>
          {overall === null ? (
            <Empty icon="chart" title="Chưa đủ dữ liệu">Hoàn thành một phiên Kiểm tra kiến thức để MindMirror ước tính mức độ hiểu của bạn.</Empty>
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <Donut value={overall} label="Mức độ hiểu ước tính" />
              <div className="w-full flex-1 space-y-4">
                {byFolder.length === 0 && <p className="text-sm text-muted">Gắn tài liệu từ My Folder khi học để xem tiến độ theo từng thư mục.</p>}
                {byFolder.map((f) => (
                  <div key={f.folder.id}>
                    <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium text-ink">{f.folder.name}</span><span className="font-semibold text-mirror">{Math.round(f.value)}%</span></div>
                    <Progress value={f.value} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="My Folder" action={<Link to="/folders" className="inline-flex items-center gap-1 text-sm font-medium text-mirror hover:text-ink">Quản lý thư mục <Icon name="arrowRight" /></Link>}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {data.folders.slice(0, 4).map((f) => (
            <Link key={f.id} to={`/folders?f=${f.id}`} className="rounded-xl border border-line p-4 transition-all hover:-translate-y-0.5 hover:border-mirror/50 hover:shadow-sm">
              <span className={`grid h-9 w-9 place-items-center rounded-lg ${FOLDER_TONE[f.color] ?? FOLDER_TONE.blue}`}><Icon name="folder" className="h-5 w-5" /></span>
              <p className="mt-4 truncate font-semibold text-ink">{f.name}</p>
              <p className="text-xs text-muted">{data.docs.filter((d) => d.folderId === f.id).length} tài liệu</p>
            </Link>
          ))}
          <Link to="/folders?new=1" className="flex min-h-[7.5rem] items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-medium text-mirror hover:border-mirror hover:bg-mist/40">
            <Icon name="plus" /> Tạo thư mục
          </Link>
        </div>
      </Card>
      <p className="text-xs text-muted">* Mức độ hiểu được ước tính từ thẻ tổng kết của các phiên học, không phải điểm số.</p>
    </div>
  );
}
