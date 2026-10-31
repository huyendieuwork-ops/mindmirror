import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, explain, type Mode, type Settings } from "../lib/api";
import { MODE_LABEL } from "../lib/labels";
import { UploadButton, kindLabel, useLibrary } from "../components/DocPicker";

const CHOICES: { mode: Mode; title: string; prompt: string; placeholder: string }[] = [
  { mode: "explore", title: "Khám phá kiến thức", prompt: "Có điều gì cậu đang tò mò?", placeholder: "Vì sao đại dương có màu xanh?" },
  { mode: "reunderstand", title: "Hiểu lại kiến thức", prompt: "Phần nào cậu học rồi mà còn vướng?", placeholder: "Dạng chuẩn 2 (2NF) trong cơ sở dữ liệu" },
];
const CONF = [["unsure", "Chưa chắc"], ["somewhat", "Tạm hiểu"], ["confident", "Khá tự tin"]] as const;

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
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      {demoModel && (
        <p className="mb-6 text-sm text-muted border-l-2 border-marker pl-3">
          Bản demo: chưa nối mô hình AI thật nên câu hỏi là mẫu cố định. Luồng, tài liệu, trích dẫn và thẻ tổng kết vẫn hoạt động thật.
        </p>
      )}
      <h1 className="font-serif text-4xl sm:text-5xl leading-[1.1] tracking-tight">Hôm nay cậu muốn làm gì?</h1>

      <div role="radiogroup" className="mt-8 grid sm:grid-cols-2 border-y border-line divide-y sm:divide-y-0 sm:divide-x divide-line">
        {CHOICES.map((c) => (
          <button key={c.mode} role="radio" aria-checked={mode === c.mode} onClick={() => setMode(c.mode)}
            className={`text-left px-1 sm:px-5 py-5 transition-colors ${mode === c.mode ? "" : "opacity-55 hover:opacity-80"}`}>
            <span className="flex items-center gap-2 font-semibold">
              <span className={`h-2.5 w-2.5 rounded-full border-2 ${mode === c.mode ? "bg-ink border-ink" : "border-muted"}`} />
              {c.title}
            </span>
            <span className="mt-1 block font-serif text-lg text-muted">{c.prompt}</span>
          </button>
        ))}
      </div>

      <label className="block mt-8">
        <span className="sr-only">Chủ đề</span>
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} maxLength={200} placeholder={choice.placeholder}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }}
          className="w-full resize-none bg-transparent font-serif text-2xl leading-snug placeholder:text-muted/60 border-b-2 border-ink/80 focus:border-mirror outline-none pb-2" />
      </label>

      <details className="mt-4 group">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink select-none">Thêm mục tiêu (không bắt buộc)</summary>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="Ví dụ: phân biệt được 2NF và 3NF trước buổi thi"
          className="mt-2 w-full bg-sheet border border-line rounded-md px-3 py-2 text-sm outline-none focus:border-mirror" />
      </details>

      {settings?.selfAssessment !== false && mode === "reunderstand" && (
        <div className="mt-6">
          <p className="text-sm text-muted">Cậu thấy mình đang ở đâu? <span className="text-xs">(chỉ để so sánh sau, không phải điểm)</span></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CONF.map(([v, l]) => (
              <button key={v} onClick={() => setConf(conf === v ? null : v)}
                className={`px-3 py-1.5 rounded-full text-sm border ${conf === v ? "bg-ink text-paper border-ink" : "border-line hover:border-ink"}`}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-muted">Đối chiếu với tài liệu của cậu <span className="text-xs">(slide, giáo trình, ghi chú — tối đa 5)</span></p>
          <UploadButton onFiles={async (f) => { const added = await lib.upload(f); setPicked((p) => [...p, ...added.map((d) => d.id)].slice(0, 5)); }} />
        </div>
        {lib.busy && <p className="mt-2 text-sm text-mirror">{lib.busy}</p>}
        {lib.error && <p className="mt-2 text-sm text-rust">{lib.error}</p>}
        {lib.docs.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {lib.docs.map((d) => (
              <li key={d.id}>
                <button onClick={() => toggle(d.id)} aria-pressed={picked.includes(d.id)}
                  className={`max-w-[18rem] truncate px-3 py-1.5 rounded-md text-sm border ${picked.includes(d.id) ? "border-ink bg-marker/40" : "border-line hover:border-ink"}`}>
                  {d.title} <span className="text-muted text-xs">· {kindLabel(d)}, {d.pageCount} tr.</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Chưa có tài liệu. Không có cũng được — MindMirror vẫn trò chuyện, chỉ là chưa trích dẫn được trang cụ thể.</p>
        )}
      </section>

      {error && <p className="mt-6 text-sm text-rust">{error}</p>}
      <button onClick={start} disabled={!topic.trim() || starting}
        className="mt-8 rounded-lg bg-ink text-paper px-6 py-3 font-semibold disabled:opacity-40 hover:opacity-90">
        {starting ? (picked.length ? "Đang đọc tài liệu và lập câu hỏi…" : "Đang mở phiên…") : "Bắt đầu trò chuyện"}
      </button>

      {recent.length > 0 && (
        <section className="mt-16">
          <h2 className="text-sm text-muted">Tiếp tục</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {recent.map((r) => (
              <li key={r.id}>
                <Link to={`/s/${r.id}`} className="flex justify-between gap-4 py-3 hover:text-mirror">
                  <span className="truncate font-serif">{r.topic}</span>
                  <span className="shrink-0 text-xs text-muted">{MODE_LABEL[r.mode]}{r.status === "finished" ? ", đã xong" : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
