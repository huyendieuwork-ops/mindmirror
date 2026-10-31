import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, explain, type Mode, type Settings } from "../lib/api";
import { MODE_LABEL } from "../lib/labels";
import { UploadButton, kindLabel, useLibrary } from "../components/DocPicker";

const CHOICES: { mode: Mode; emoji: string; title: string; prompt: string; placeholder: string }[] = [
  { mode: "explore", emoji: "🧭", title: "Khám phá kiến thức", prompt: "Có điều gì cậu đang tò mò?", placeholder: "Vì sao đại dương có màu xanh?" },
  { mode: "reunderstand", emoji: "🪞", title: "Hiểu lại kiến thức", prompt: "Phần nào cậu học rồi mà còn vướng?", placeholder: "Dạng chuẩn 2 (2NF) trong cơ sở dữ liệu" },
];
const CONF = [["unsure", "🤔 Chưa chắc"], ["somewhat", "🙂 Tạm hiểu"], ["confident", "😎 Khá tự tin"]] as const;

export default function Home() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("reunderstand");
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [conf, setConf] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [demoModel, setDemoModel] = useState(false);
  const [recent, setRecent] = useState<{ id: string; topic: string; mode: Mode; status: string }[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lib = useLibrary();
  const choice = CHOICES.find((c) => c.mode === mode)!;

  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
    api.config().then((c) => setDemoModel(c.model === "demo-offline")).catch(() => {});
    api.listSessions().then((r) => setRecent(r.items.slice(0, 4))).catch(() => {});
  }, []);

  async function start() {
    if (!topic.trim()) return;
    setStarting(true); setError(null);
    try {
      const s = await api.createSession({ mode, topic: topic.trim(), goal: goal.trim() || undefined, self_confidence: conf, document_ids: picked });
      nav(`/s/${s.id}`);
    } catch (e) { setError(explain(e)); setStarting(false); }
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      {demoModel && (
        <p className="mb-6 text-sm text-muted rounded-xl bg-mist px-4 py-3">
          Bản demo: chưa nối mô hình AI thật nên câu hỏi là mẫu cố định. Luồng, tài liệu, trích dẫn và thẻ tổng kết vẫn hoạt động thật.
        </p>
      )}
      <p className="text-sm font-semibold text-mirror">Phiên học mới</p>
      <h1 className="mt-1 font-serif font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Hôm nay cậu muốn làm gì?</h1>

      {/* Bước 1: chọn chế độ */}
      <div role="radiogroup" aria-label="Chế độ" className="mt-6 grid sm:grid-cols-2 gap-3">
        {CHOICES.map((c) => {
          const on = mode === c.mode;
          return (
            <button key={c.mode} role="radio" aria-checked={on} onClick={() => setMode(c.mode)}
              className={`text-left rounded-2xl border-2 p-4 transition-all ${on ? "border-mirror bg-sheet shadow-[0_10px_30px_-18px_rgb(63_122_212/0.7)]" : "border-line bg-sheet/60 hover:border-mirror/50"}`}>
              <span className="flex items-center gap-3">
                <span className={`grid h-10 w-10 place-items-center rounded-xl text-xl ${on ? "bg-mist" : "bg-paper"}`}>{c.emoji}</span>
                <span className="font-semibold">{c.title}</span>
                <span className={`ml-auto h-5 w-5 rounded-full border-2 grid place-items-center ${on ? "border-mirror" : "border-line"}`}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-mirror" />}
                </span>
              </span>
              <span className="mt-2 block text-sm text-muted">{c.prompt}</span>
            </button>
          );
        })}
      </div>

      {/* Bước 2: chủ đề */}
      <div className="mt-5 card p-5">
        <label className="block">
          <span className="text-sm font-semibold">Chủ đề</span>
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} maxLength={200} placeholder={choice.placeholder}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }}
            className="mt-2 w-full resize-none rounded-xl bg-paper border border-line px-4 py-3 font-serif text-xl leading-snug placeholder:text-muted/60 outline-none focus:border-mirror focus:ring-4 focus:ring-mirror/15" />
        </label>

        <details className="mt-3 group">
          <summary className="cursor-pointer text-sm text-mirror hover:text-ink select-none list-none inline-flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90">›</span> Thêm mục tiêu (không bắt buộc)
          </summary>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="Ví dụ: phân biệt được 2NF và 3NF trước buổi thi"
            className="mt-2 w-full bg-paper border border-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-mirror focus:ring-4 focus:ring-mirror/15" />
        </details>

        {settings?.selfAssessment !== false && mode === "reunderstand" && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Cậu thấy mình đang ở đâu? <span className="font-normal text-xs text-muted">(chỉ để so sánh sau, không phải điểm)</span></p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CONF.map(([v, l]) => (
                <button key={v} onClick={() => setConf(conf === v ? null : v)} aria-pressed={conf === v}
                  className={`chip ${conf === v ? "!border-mirror !bg-mist text-mirror font-medium" : ""}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bước 3: tài liệu */}
      <section className="mt-5 card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">📚 Đối chiếu với tài liệu của cậu</p>
            <p className="text-xs text-muted">Slide, giáo trình, ghi chú — tối đa 5</p>
          </div>
          <UploadButton onFiles={async (f) => { const added = await lib.upload(f); setPicked((p) => [...p, ...added.map((d) => d.id)].slice(0, 5)); }} />
        </div>
        {lib.busy && <p className="mt-3 text-sm text-mirror">{lib.busy}</p>}
        {lib.error && <p className="mt-3 text-sm text-rust">{lib.error}</p>}
        {lib.docs.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {lib.docs.map((d) => {
              const on = picked.includes(d.id);
              return (
                <li key={d.id}>
                  <button onClick={() => toggle(d.id)} aria-pressed={on}
                    className={`chip max-w-[18rem] ${on ? "!border-mirror !bg-mist" : ""}`}>
                    <span className={`h-4 w-4 shrink-0 rounded border grid place-items-center text-[10px] ${on ? "bg-mirror border-mirror text-white" : "border-line"}`}>{on ? "✓" : ""}</span>
                    <span className="truncate">{d.title}</span>
                    <span className="text-muted text-xs shrink-0">· {kindLabel(d)}, {d.pageCount} tr.</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted rounded-xl border border-dashed border-line px-4 py-3">Chưa có tài liệu. Không có cũng được — MindMirror vẫn trò chuyện, chỉ là chưa trích dẫn được trang cụ thể.</p>
        )}
      </section>

      {error && <p className="mt-5 text-sm text-rust rounded-xl bg-rust/10 px-4 py-3">{error}</p>}
      <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={start} disabled={!topic.trim() || starting} className="btn-primary text-base sm:min-w-[14rem]">
          {starting ? (picked.length ? "Đang đọc tài liệu và lập câu hỏi…" : "Đang mở phiên…") : "Bắt đầu trò chuyện →"}
        </button>
        <span className="text-xs text-muted">Mẹo: nhấn Enter để bắt đầu nhanh.</span>
      </div>

      {recent.length > 0 && (
        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif font-bold text-lg">Tiếp tục học</h2>
            <Link to="/history" className="text-sm text-mirror hover:text-ink">Xem tất cả</Link>
          </div>
          <ul className="mt-3 grid sm:grid-cols-2 gap-3">
            {recent.map((r) => (
              <li key={r.id}>
                <Link to={`/s/${r.id}`} className="card block p-4 hover:border-mirror/60 hover:-translate-y-0.5 transition-all">
                  <span className="block truncate font-semibold">{r.topic}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="rounded-full bg-mist text-mirror px-2 py-0.5">{MODE_LABEL[r.mode]}</span>
                    {r.status === "finished" ? <span className="text-moss">✓ Đã xong</span> : <span>Đang dở</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
