import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, explain, type Mode, type Settings } from "../lib/api";
import { invalidate, MODE_PAGE, sessionPath, useLearningData } from "../lib/data";
import { Logo } from "../components/Layout";
import { Icon, PageHeader, SelectBox, timeAgo } from "../components/ui";

const CONF = [["unsure", "🤔 Chưa chắc"], ["somewhat", "🙂 Tạm hiểu"], ["confident", "😎 Khá tự tin"]] as const;
const EXAMPLES: Record<Mode, string[]> = {
  reunderstand: ["Chuẩn hoá cơ sở dữ liệu (1NF, 2NF, 3NF)", "Khoá chính và khoá ngoại", "Overfitting trong Machine Learning"],
  explore: ["Transformer xử lý ngôn ngữ như thế nào?", "Vì sao đại dương có màu xanh?", "Chiến lược marketing 4P"],
};

/** Màn hình bắt đầu cho "Kiểm tra kiến thức" (reunderstand) và "Khám phá kiến thức" (explore). */
export default function Learn({ mode }: { mode: Mode }) {
  const page = MODE_PAGE[mode];
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { docs, folders, sessions } = useLearningData();
  const [source, setSource] = useState<string>(params.get("folder") ?? "none"); // none | folder id | custom
  const [picked, setPicked] = useState<string[]>([]);
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [goal, setGoal] = useState("");
  const [conf, setConf] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.settings().then(setSettings).catch(() => {}); }, []);
  useEffect(() => { const f = params.get("folder"); if (f) setSource(f); }, [params]);

  const folderDocs = useMemo(() => docs.filter((d) => d.folderId === source), [docs, source]);
  const documentIds = source === "custom" ? picked : source === "none" ? [] : folderDocs.slice(0, 5).map((d) => d.id);
  const recent = sessions.filter((s) => s.mode === mode).slice(0, 6);
  const options = [
    { value: "none", label: "Không gắn học liệu" },
    ...folders.map((f) => ({ value: f.id, label: `${f.name} (${docs.filter((d) => d.folderId === f.id).length})` })),
    ...(docs.length ? [{ value: "custom", label: "Tự chọn tài liệu…" }] : []),
  ];

  async function start(t = topic) {
    if (!t.trim() || starting) return;
    setStarting(true); setError(null);
    try {
      const s = await api.createSession({ mode, topic: t.trim(), goal: goal.trim() || undefined, self_confidence: conf, document_ids: documentIds });
      invalidate();
      nav(sessionPath({ id: s.id, mode }));
    } catch (e) { setError(explain(e)); setStarting(false); }
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={page.title} subtitle={page.subtitle}
        actions={<Link to="/folders" className="inline-flex items-center gap-2 rounded-lg border border-line bg-sheet px-3.5 py-2 text-sm font-medium text-ink hover:border-mirror/60 hover:text-mirror"><Icon name="folder" /> My Folder</Link>} />

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-ink">{mode === "reunderstand" ? "Cuộc trò chuyện mới" : "Chủ đề mới"}</p>
          <div className="flex items-center gap-2">
            <Icon name="folder" className="h-4 w-4 text-mirror" />
            <SelectBox label="Học liệu" value={source} onChange={setSource} options={options} className="w-60" />
          </div>
        </div>

        <div className="px-5 py-8 sm:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <Logo size={56} className="mx-auto" />
            <h2 className="mt-4 text-xl font-bold text-ink">{mode === "reunderstand" ? "Bạn muốn kiểm tra chủ đề nào?" : "Bạn đang tò mò điều gì?"}</h2>
            <p className="mt-1 text-sm text-muted">{mode === "reunderstand" ? "Nêu chủ đề, rồi giải thích theo cách bạn hiểu. MindMirror sẽ hỏi lại và chỉ ra chỗ còn thiếu." : "Đặt câu hỏi, MindMirror sẽ dẫn bạn tự tìm ra câu trả lời qua từng gợi ý."}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {EXAMPLES[mode].map((e) => <button key={e} onClick={() => setTopic(e)} className="chip">{e}</button>)}
            </div>
          </div>

          {source !== "none" && (
            <div className="mx-auto mt-6 max-w-3xl rounded-xl bg-paper/70 p-4">
              {source === "custom" ? (
                <>
                  <p className="text-xs font-semibold text-muted">Chọn tối đa 5 tài liệu để đối chiếu</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {docs.map((d) => (
                      <button key={d.id} onClick={() => toggle(d.id)} aria-pressed={picked.includes(d.id)} className={`chip max-w-[16rem] ${picked.includes(d.id) ? "!border-mirror !bg-mist text-mirror" : ""}`}>
                        <Icon name="file" className="h-3.5 w-3.5" /><span className="truncate">{d.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : folderDocs.length ? (
                <p className="text-sm text-muted"><Icon name="folder" className="mr-1 inline h-4 w-4 text-mirror" /> Đối chiếu với {Math.min(5, folderDocs.length)} tài liệu trong thư mục{folderDocs.length > 5 ? " (5 tài liệu mới nhất)" : ""}: <span className="text-ink">{folderDocs.slice(0, 5).map((d) => d.title).join(", ")}</span></p>
              ) : (
                <p className="text-sm text-muted">Thư mục này chưa có tài liệu. <Link to={`/folders?f=${source}`} className="font-medium text-mirror">Tải tài liệu lên</Link> hoặc bắt đầu không cần học liệu.</p>
              )}
            </div>
          )}

          <div className="mx-auto mt-6 max-w-3xl space-y-3">
            {mode === "reunderstand" && settings?.selfAssessment !== false && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Bạn thấy mình đang ở đâu?</span>
                {CONF.map(([v, l]) => <button key={v} onClick={() => setConf(conf === v ? null : v)} aria-pressed={conf === v} className={`chip ${conf === v ? "!border-mirror !bg-mist text-mirror" : ""}`}>{l}</button>)}
              </div>
            )}
            <details className="group text-sm">
              <summary className="cursor-pointer list-none text-mirror"><span className="inline-block transition-transform group-open:rotate-90">›</span> Thêm mục tiêu (không bắt buộc)</summary>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="Ví dụ: phân biệt được 2NF và 3NF trước buổi thi"
                className="mt-2 w-full rounded-lg border border-line bg-sheet px-3 py-2 outline-none focus:border-mirror" />
            </details>
            {error && <p className="rounded-lg bg-rust/10 px-4 py-2.5 text-sm text-rust">{error}</p>}
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-sheet p-2 shadow-sm focus-within:border-mirror">
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} maxLength={200}
                placeholder={mode === "reunderstand" ? "Nhập chủ đề bạn muốn kiểm tra…" : "Nhập câu hỏi hoặc chủ đề bạn muốn khám phá…"}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }}
                className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[0.95rem] outline-none placeholder:text-muted/70" />
              <button onClick={() => start()} disabled={!topic.trim() || starting} aria-label="Bắt đầu"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mirror text-white disabled:opacity-40">
                {starting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Icon name="send" />}
              </button>
            </div>
            <p className="text-center text-xs text-muted">{starting ? (documentIds.length ? "Đang đọc tài liệu và lập câu hỏi…" : "Đang mở phiên…") : "Nhấn Enter để bắt đầu · MindMirror có thể mắc lỗi, hãy kiểm tra thông tin quan trọng."}</p>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-ink">Cuộc trò chuyện gần đây</h2>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((s) => (
              <Link key={s.id} to={sessionPath(s)} className="panel block p-4 transition-all hover:-translate-y-0.5 hover:border-mirror/50">
                <p className="truncate font-semibold text-ink">{s.topic}</p>
                <p className="mt-1 text-xs text-muted">{timeAgo(s.updatedAt)} · {s.status === "finished" ? <span className="text-moss">Đã tổng kết</span> : "Đang dở"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
