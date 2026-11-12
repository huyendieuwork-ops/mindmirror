import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, explain, type LearnerLevel, type Mode } from "../lib/api";
import { LEVELS } from "../lib/labels";
import { ASK_PLACEHOLDER, deriveTitle, invalidate, MODE_PAGE, sessionPath, useLearningData } from "../lib/data";
import { Card, Empty, FOLDER_TONE, Icon, SelectBox, timeAgo } from "../components/ui";

const MODES: { mode: Mode; title: string; text: string; icon: "check" | "compass" }[] = [
  { mode: "reunderstand", title: "Kiểm tra hiểu biết", text: "Bạn tự trình bày, AI đặt câu hỏi vào những điểm còn chưa chắc chắn. Không chấm điểm.", icon: "check" },
  { mode: "explore", title: "Khám phá", text: "Học từ đầu theo dàn ý: AI giải thích từng phần kèm ví dụ, cuối mỗi phần có câu kiểm tra nhanh.", icon: "compass" },
];

/** Trang chủ: một ô bắt đầu (chủ đề → cách học → thư mục tài liệu tuỳ chọn), rồi "Tiếp tục học" và danh sách thư mục. */
export default function Home({ name }: { name: string }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { sessions, docs, folders } = useLearningData();
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [mode, setMode] = useState<Mode>(params.get("mode") === "explore" ? "explore" : "reunderstand");
  const [folder, setFolder] = useState<string>(params.get("folder") ?? "none");
  const [level, setLevel] = useState<LearnerLevel | "free">((params.get("level") as LearnerLevel | null) ?? "beginner");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const f = params.get("folder"); if (f) setFolder(f);
    const t = params.get("topic"); if (t) setTopic(t);
    const m = params.get("mode"); if (m === "explore" || m === "reunderstand") setMode(m);
    const l = params.get("level"); if (l === "beginner" || l === "some" || l === "review") setLevel(l);
  }, [params]);

  const first = name.split(/\s+/).slice(-2).join(" ");
  const current = folders.find((f) => f.id === folder) ?? null;
  // "unfiled" = học với các tài liệu chưa xếp vào thư mục nào (người dùng không bắt buộc tạo thư mục).
  const unfiled = docs.filter((d) => !d.folderId);
  const folderDocs = current ? docs.filter((d) => d.folderId === current.id) : folder === "unfiled" ? unfiled : [];
  const recent = sessions.slice(0, 4);

  async function start() {
    if (!topic.trim() || starting) return;
    setStarting(true); setError(null);
    try {
      const q = topic.trim();
      const free = mode === "explore" && level === "free";
      const s = await api.createSession({ mode, topic: deriveTitle(q), question: q, document_ids: folderDocs.slice(0, 5).map((d) => d.id), folder_id: current?.id, level: mode === "explore" && level !== "free" ? level : null });
      invalidate();
      // Hỏi đáp tự do: gửi luôn câu hỏi làm lượt đầu để AI trả lời ngay, không hỏi lại.
      nav(sessionPath({ id: s.id, mode }), { state: free ? { autoSend: q } : null });
    } catch (e) { setError(explain(e)); setStarting(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-muted">Chào {first}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-[1.9rem]">Hôm nay bạn muốn học gì?</h1>
      </div>

      <section className="panel space-y-5 p-5 sm:p-7" aria-label="Bắt đầu phiên học">
        <label className="block text-sm font-semibold text-ink/80">Bạn muốn học hoặc hỏi gì?
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1000} rows={2} placeholder={ASK_PLACEHOLDER[mode]}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }}
            onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 240)}px`; }}
            className="mt-2 block min-h-[3.5rem] w-full resize-none rounded-xl border border-line bg-paper/40 px-4 py-3 text-lg font-normal leading-snug text-ink outline-none placeholder:text-muted/70 focus:border-mirror" />
          <span className="mt-1.5 flex justify-between gap-3 text-xs font-normal text-muted">
            <span>Gõ một chủ đề, một câu hỏi, hoặc chỗ bạn đang vướng. Shift + Enter để xuống dòng.</span>
            {topic.length > 800 && <span>{topic.length}/1000</span>}
          </span>
        </label>

        <div role="radiogroup" aria-label="Cách học" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const on = mode === m.mode;
            return (
              <button key={m.mode} role="radio" aria-checked={on} onClick={() => setMode(m.mode)}
                className={`flex flex-col items-start gap-1.5 rounded-2xl border p-4 text-left transition-colors ${on ? "border-2 border-mirror bg-mist/60" : "border-line bg-sheet hover:border-mirror/50"}`}>
                <span className="flex items-center gap-2 font-bold text-ink"><Icon name={m.icon} className="h-5 w-5 text-mirror" /> {m.title}</span>
                <span className="text-sm leading-relaxed text-muted">{m.text}</span>
              </button>
            );
          })}
        </div>

        {mode === "explore" && (
          <div>
            <p className="text-sm font-semibold text-ink/80">Trình độ của bạn với chủ đề này</p>
            <div role="radiogroup" aria-label="Trình độ" className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {LEVELS.map((l) => {
                const on = level === l.value;
                return (
                  <button key={l.value} role="radio" aria-checked={on} onClick={() => setLevel(l.value)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? "border-mirror bg-mist/60" : "border-line bg-sheet hover:border-mirror/50"}`}>
                    <span className={`block text-sm font-semibold ${on ? "text-mirror" : "text-ink"}`}>{l.label}</span>
                    <span className="block text-xs text-muted">{l.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold text-ink/80">Thư mục tài liệu <span className="font-normal text-muted">(không bắt buộc)</span></p>
            <SelectBox label="Thư mục tài liệu (không bắt buộc)" value={folder} onChange={setFolder} className="w-full sm:w-72"
              options={[{ value: "none", label: "Không dùng tài liệu" }, ...(unfiled.length ? [{ value: "unfiled", label: `Tài liệu chưa xếp thư mục (${unfiled.length})` }] : []), ...folders.map((f) => ({ value: f.id, label: `${f.name} (${docs.filter((d) => d.folderId === f.id).length} tài liệu)` }))]} />
            <p className="text-xs text-muted">
              {current
                ? current.goal ? <>Mục tiêu học của thư mục: <span className="text-ink">{current.goal}</span></> : folderDocs.length ? `AI đối chiếu với ${Math.min(5, folderDocs.length)} tài liệu trong thư mục.` : "Thư mục chưa có tài liệu — bạn vẫn học được bình thường."
                : folderDocs.length ? `AI đối chiếu với ${Math.min(5, folderDocs.length)} tài liệu bạn đã tải lên (chưa xếp thư mục).` : "Có tài liệu, câu trả lời sẽ bám sát giáo trình của bạn."}
            </p>
          </div>
          <button onClick={start} disabled={!topic.trim() || starting}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-mirror px-7 font-semibold text-white shadow-sm hover:bg-mirror/90 disabled:opacity-40">
            {starting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
            {starting ? (mode === "explore" && level !== "free" ? "Đang lập dàn ý…" : folderDocs.length ? "Đang đọc tài liệu…" : "Đang mở phiên…") : <>Bắt đầu <Icon name="arrowRight" /></>}
          </button>
        </div>
        {error && <p className="rounded-lg bg-rust/10 px-4 py-2.5 text-sm text-rust">{error}</p>}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card title="Tiếp tục học" action={<Link to="/history" className="inline-flex items-center gap-1 text-sm font-medium text-mirror hover:text-ink">Xem tất cả <Icon name="arrowRight" /></Link>} bodyClass="px-5 pb-3 pt-2">
          {recent.length === 0 ? (
            <div className="py-3"><Empty icon="chat" title="Chưa có phiên học nào">Nhập một chủ đề ở trên để bắt đầu phiên đầu tiên.</Empty></div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link to={sessionPath(s)} className="group flex items-center gap-4 py-3.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-mirror"><Icon name={s.mode === "explore" ? "compass" : "check"} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink group-hover:text-mirror">{s.topic}</span>
                      <span className="block text-xs text-muted">{MODE_PAGE[s.mode].short} · {timeAgo(s.updatedAt)} · {s.status === "finished" ? "Hoàn thành" : "Chưa hoàn thành"}</span>
                    </span>
                    <Icon name="chevronRight" className="h-4 w-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Thư mục của bạn" action={<Link to="/folders" className="inline-flex items-center gap-1 text-sm font-medium text-mirror hover:text-ink">Quản lý <Icon name="arrowRight" /></Link>} bodyClass="px-5 pb-4 pt-2">
          {folders.length === 0 ? (
            <div className="py-3"><Empty icon="folder" title="Chưa có thư mục" action={<Link to="/folders?new=1" className="text-sm font-medium text-mirror">Tạo thư mục →</Link>}>Gom tài liệu và phiên học theo môn. Không bắt buộc.</Empty></div>
          ) : (
            <ul className="divide-y divide-line">
              {folders.slice(0, 4).map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${FOLDER_TONE[f.color] ?? FOLDER_TONE.blue}`}><Icon name="folder" /></span>
                  <Link to={`/folders?f=${f.id}`} className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink hover:text-mirror">{f.name}</span>
                    <span className="block truncate text-xs text-muted">{docs.filter((d) => d.folderId === f.id).length} tài liệu{f.goal ? ` · ${f.goal}` : ""}</span>
                  </Link>
                  <button onClick={() => { setFolder(f.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-mirror hover:bg-mist">Học</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
