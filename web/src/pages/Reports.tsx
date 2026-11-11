import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { avg, folderProgress, knowledgeGaps, MODE_PAGE, sessionPath, sessionScore, useLearningData, weeklyTrend, within } from "../lib/data";
import { Card, Empty, FOLDER_TONE, Icon, LineChart, PageHeader, Progress, SelectBox, timeAgo, type IconName } from "../components/ui";
import KnowledgeGraph from "../components/KnowledgeGraph";

export default function Reports() {
  const data = useLearningData({ details: 40 });
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [tab, setTab] = useState<"needs" | "solid">("needs");
  const days = Number(range);

  const sessions = useMemo(() => data.sessions.filter((s) => within(s.updatedAt, days)), [data.sessions, days]);
  const details = useMemo(() => data.details.filter((d) => within(d.item.updatedAt, days)), [data.details, days]);
  const finished = sessions.filter((s) => s.status === "finished").length;
  const overall = avg(details.map((d) => sessionScore(d.assessment)));
  const gaps = knowledgeGaps(details);
  const needs = gaps.filter((g) => g.status === "needs");
  const solid = gaps.filter((g) => g.status === "solid");
  const trend = weeklyTrend(data.details, days <= 7 ? 4 : days <= 30 ? 5 : 12);
  const byFolder = folderProgress(details, data.docs, data.folders);
  const turns = details.reduce((a, d) => a + (d.view?.turnCount ?? 0), 0);
  const next = details.filter((d) => d.view?.card?.nextStep).slice(0, 4);
  const empty = !data.loading && sessions.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Báo cáo của tôi" subtitle="Theo dõi tiến độ, nhìn ra điểm mạnh và những nội dung nên ôn lại — tính từ chính các phiên học của bạn."
        actions={<SelectBox label="Khoảng thời gian" value={range} onChange={setRange} className="w-44" options={[{ value: "7", label: "7 ngày gần đây" }, { value: "30", label: "30 ngày gần đây" }, { value: "90", label: "90 ngày gần đây" }]} />} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon="chat" tone="bg-mist text-mirror" label="Phiên học" value={sessions.length} hint={`${finished} phiên đã tổng kết`} />
        <Stat icon="chart" tone="bg-[#E6F6F0] text-[#2E9F7E]" label="Mức độ hiểu ước tính" value={overall === null ? "—" : `${Math.round(overall)}%`} hint="Từ thẻ tổng kết" />
        <Stat icon="bulb" tone="bg-[#FFF5E0] text-[#D8961E]" label="Cần ôn tập" value={needs.length} hint="Khái niệm còn vướng" />
        <Stat icon="pencil" tone="bg-[#F1ECFF] text-[#8B6FE0]" label="Lượt giải thích" value={turns} hint="Số lần bạn trả lời" />
      </div>

      <Card title="Bản đồ kiến thức" subtitle="Vẽ từ đồ thị khái niệm thật (Neo4j) dựng từ tài liệu bạn chọn — mỗi quan hệ có câu căn cứ trong tài liệu. Màu nút theo kết quả các phiên học của bạn.">
        <KnowledgeGraph docs={data.docs} marks={gaps.map((g) => ({ concept: g.concept, status: g.status }))} />
      </Card>

      {empty ? (
        <section className="panel p-5"><Empty icon="chart" title="Chưa có dữ liệu trong khoảng này" action={<Link to="/check" className="text-sm font-medium text-mirror">Bắt đầu Kiểm tra kiến thức →</Link>}>Sau mỗi phiên học, MindMirror ghi nhận phần bạn tự giải thích được và phần cần ôn thêm để lập báo cáo.</Empty></section>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Xu hướng mức độ hiểu" subtitle="Trung bình theo tuần, từ các phiên đã có tiêu chí đánh giá">
              {trend.some((p) => p.value !== null) ? <LineChart points={trend} /> : <p className="py-10 text-center text-sm text-muted">Hoàn thành vài phiên Kiểm tra kiến thức để thấy xu hướng.</p>}
            </Card>
            <Card title="Tiến độ theo thư mục" action={<Link to="/folders" className="text-sm font-medium text-mirror">My Folder</Link>}>
              {byFolder.length === 0 ? (
                <p className="text-sm text-muted">Chọn học liệu từ một thư mục khi bắt đầu phiên để theo dõi tiến độ từng môn.</p>
              ) : (
                <div className="space-y-4">
                  {byFolder.map((f) => (
                    <div key={f.folder.id}>
                      <div className="mb-1.5 flex items-center gap-2 text-sm">
                        <span className={`grid h-6 w-6 place-items-center rounded-md ${FOLDER_TONE[f.folder.color] ?? FOLDER_TONE.blue}`}><Icon name="folder" className="h-3.5 w-3.5" /></span>
                        <span className="flex-1 truncate font-medium text-ink">{f.folder.name}</span>
                        <span className="font-semibold text-mirror">{Math.round(f.value)}%</span>
                      </div>
                      <Progress value={f.value} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <Card title="Khái niệm theo kết quả học" subtitle="Rút ra từ tiêu chí đánh giá và phần còn bỏ ngỏ"
              action={
                <div className="flex rounded-lg bg-paper p-0.5 text-xs font-medium">
                  <button onClick={() => setTab("needs")} className={`rounded-md px-2.5 py-1.5 ${tab === "needs" ? "bg-sheet text-ink shadow-sm" : "text-muted"}`}>Cần ôn ({needs.length})</button>
                  <button onClick={() => setTab("solid")} className={`rounded-md px-2.5 py-1.5 ${tab === "solid" ? "bg-sheet text-ink shadow-sm" : "text-muted"}`}>Đã vững ({solid.length})</button>
                </div>
              } bodyClass="px-5 pb-4 pt-3">
              {(tab === "needs" ? needs : solid).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">{tab === "needs" ? "Chưa ghi nhận chỗ hổng nào. Tuyệt!" : "Chưa có khái niệm nào được ghi nhận là tự giải thích được."}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {(tab === "needs" ? needs : solid).slice(0, 8).map((g) => (
                    <li key={g.key}>
                      <Link to={`${MODE_PAGE[g.mode].path}/${g.sessionId}`} className="group flex items-center gap-3 py-3">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${g.status === "needs" ? "bg-[#F0B44C]" : "bg-moss"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink group-hover:text-mirror">{g.concept}</span>
                          <span className="block truncate text-xs text-muted">{g.topic}</span>
                        </span>
                        <Icon name="chevronRight" className="h-4 w-4 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Đề xuất ôn tập" subtitle="Bước tiếp theo MindMirror gợi ý sau mỗi phiên" bodyClass="px-5 pb-4 pt-3">
              {next.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Kết thúc một phiên để nhận đề xuất ôn tập.</p>
              ) : (
                <ul className="space-y-3">
                  {next.map((d) => (
                    <li key={d.item.id} className="rounded-xl border border-line p-3.5">
                      <p className="text-xs font-medium text-muted">{d.item.topic} · {timeAgo(d.item.updatedAt)}</p>
                      <p className="mt-1 text-sm text-ink">{d.view!.card!.nextStep}</p>
                      <div className="mt-2 flex gap-3 text-xs font-medium">
                        <Link to={sessionPath(d.item)} className="text-mirror">Xem lại phiên</Link>
                        <Link to={`/check?topic=${encodeURIComponent(d.item.topic)}`} className="text-mirror">Kiểm tra lại →</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      <p className="text-xs text-muted">* Mức độ hiểu = (tiêu chí tự thể hiện + 0,6 × tiêu chí đúng sau gợi ý) / tổng tiêu chí. Đây là ước tính để tự theo dõi, không phải điểm số.</p>
    </div>
  );
}

function Stat({ icon, tone, label, value, hint }: { icon: IconName; tone: string; label: string; value: string | number; hint: string }) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon name={icon} className="h-5 w-5" /></span>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold text-ink">{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}
