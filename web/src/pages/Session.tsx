import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, explain, newTurnId, type Assessment, type Citation, type Intent, type LearningPath, type MirrorCard, type Msg, type SessionView, type WebCitation } from "../lib/api";
import { HINT_LABEL, INTENT_LABEL, LEVELS, PART_STATUS, PATH_INTENT_LABEL, PHASE_LABEL, STATUS_COLOR, STATUS_LABEL } from "../lib/labels";
import { invalidate, MODE_PAGE, useLearningData } from "../lib/data";
import MirrorCardView from "../components/MirrorCardView";
import TracePanel from "../components/TracePanel";
import RichText from "../components/RichText";
import { pref } from "../lib/data";
import { Logo } from "../components/Layout";
import { Icon, PageHeader } from "../components/ui";

const DEFAULT_REPLIES: Intent[] = ["hint", "give_example", "show_answer", "skip", "finish"];
/** Nút gợi ý khi mở lại phiên theo dàn ý (giống quickRepliesFor ở backend). */
const pathReplies = (p: LearningPath): Intent[] =>
  p.stage === "check" ? ["hint", "give_example", "show_answer", "skip"] : p.stage === "done" ? ["try", "explain_more", "finish"] : ["explain_more", "give_example", "skip", "finish"];

export default function SessionPage() {
  const { id = "" } = useParams();
  const [s, setS] = useState<SessionView | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ text: string; intent: Intent | null; turnId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<Intent[]>(DEFAULT_REPLIES);
  const [modeHint, setModeHint] = useState<string | null>(null);
  const [card, setCard] = useState<MirrorCard | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState<"sources" | "trace">("sources");
  const [panel, setPanel] = useState(false);
  // "Agent đã làm gì" (trace kỹ thuật) chỉ hiện ở Chế độ kỹ thuật — bật trong Cài đặt, dành cho demo/phát triển.
  const devMode = pref<boolean>("devMode", false);
  const fontCls = ({ sm: "text-[0.88rem]", md: "text-[0.95rem]", lg: "text-[1.06rem]" } as const)[pref<"sm" | "md" | "lg">("chatFont", "md")] ?? "text-[0.95rem]";
  const [version, setVersion] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const { docs, folders } = useLearningData();

  async function load() {
    try {
      const v = await api.getSession(id);
      setS((prev) => { if (!prev && v.path) setReplies(pathReplies(v.path)); return v; });
      setCard(v.card ?? null);
      api.assessment(id).then(setAssessment).catch(() => {});
    } catch (e) { setError(explain(e)); }
  }
  useEffect(() => { load(); }, [id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [s?.messages.length, pending, card]);

  async function send(t: string, intent: Intent | null, retryId?: string) {
    if (!s || sending || (!t.trim() && !intent)) return;
    const turnId = retryId ?? newTurnId();
    setSending(true); setError(null);
    setPending({ text: t, intent, turnId });
    try {
      const r = await api.turn(id, { text: t, intent, client_turn_id: turnId });
      setText(""); setPending(null);
      setReplies(r.quickReplies.length ? r.quickReplies : DEFAULT_REPLIES);
      setModeHint(r.suggestModeSwitch ? MODE_PAGE[r.suggestModeSwitch].title : null);
      if (r.card) setCard(r.card);
      await load();
      invalidate();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(explain(e)); // giữ pending để bấm "Gửi lại" với cùng client_turn_id
    } finally { setSending(false); }
  }

  const allCitations = useMemo(() => {
    const out: { key: string; c: Citation; msgId: string; n: number }[] = [];
    s?.messages.forEach((m) => m.citations?.forEach((c, i) => out.push({ key: `${m.id}:${i + 1}`, c, msgId: m.id, n: i + 1 })));
    return out.reverse();
  }, [s]);
  const allWeb = useMemo(() => {
    const out: { key: string; c: WebCitation; n: number }[] = [];
    s?.messages.forEach((m) => m.webCitations?.forEach((c, i) => out.push({ key: `${m.id}:W${i + 1}`, c, n: i + 1 })));
    return out.reverse();
  }, [s]);

  if (!s) return <div className="mx-auto max-w-6xl py-16 text-center text-muted">{error ?? "Đang mở phiên…"}</div>;
  const page = MODE_PAGE[s.mode];
  const finished = s.status === "finished";
  const rubricStatus = new Map(assessment?.criteria.map((c) => [c.criterionId, c.status]) ?? []);
  const attached = docs.filter((d) => s.documentIds.includes(d.id));
  const folderNames = Array.from(new Set(attached.map((d) => folders.find((f) => f.id === d.folderId)?.name).filter(Boolean)));
  const sourceLabel = s.documentIds.length === 0 ? "Không gắn học liệu" : folderNames.length === 1 ? folderNames[0] : `${s.documentIds.length} tài liệu`;
  const path = s.mode === "explore" ? s.path ?? null : null;
  const label = (r: Intent) => (path ? PATH_INTENT_LABEL[r] : undefined) ?? INTENT_LABEL[r];
  const shownIdeas = s.rubric.filter((c) => (rubricStatus.get(c.id) ?? "").startsWith("demonstrated")).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={page.title} subtitle={page.subtitle}
        actions={<Link to={page.path} className="inline-flex items-center gap-2 rounded-lg border border-line bg-sheet px-3.5 py-2 text-sm font-medium text-mirror hover:border-mirror/60"><Icon name="plus" /> {s.mode === "reunderstand" ? "Cuộc trò chuyện mới" : "Chủ đề mới"}</Link>} />

      <div className="flex gap-6">
        <section className="panel flex min-w-0 flex-1 flex-col overflow-hidden" style={{ minHeight: "calc(100vh - 15rem)" }}>
          <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-ink">{s.topic}</h2>
              {path ? (
                <p className="mt-1 text-xs text-muted">
                  {LEVELS.find((l) => l.value === path.level)?.label} · {path.stage === "done" ? "Đã đi hết dàn ý" : `Phần ${path.current + 1}/${path.parts.length}: ${path.parts[path.current]?.title ?? ""}`}
                </p>
              ) : s.rubric.length > 0 ? (
                <p className="mt-1 text-xs text-muted">Đã trình bày <b className="text-ink">{shownIdeas}/{s.rubric.length}</b> ý chính · {PHASE_LABEL[s.phase] ?? s.phase}</p>
              ) : (
                <HintLadder level={s.hintLevel} phase={PHASE_LABEL[s.phase] ?? s.phase} />
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-mirror/25 bg-mist/60 px-3 py-1.5 text-sm font-medium text-mirror" title={attached.map((d) => d.title).join("\n")}>
                <Icon name="folder" className="h-4 w-4" /> {sourceLabel}
              </span>
              <button onClick={() => setPanel((p) => !p)} aria-pressed={panel} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${panel ? "border-mirror text-mirror" : "border-line text-ink hover:border-mirror/60"}`}>
                <Icon name="panel" className="h-4 w-4" /> Chi tiết phiên
              </button>
            </div>
          </header>

          {path && <PathBar path={path} />}
          <ol className="flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-10" aria-live="polite">
            {s.messages.map((m) => <Message key={m.id} m={m} fontCls={fontCls} active={active} onCite={(k) => { setActive(k); setTab("sources"); setPanel(true); }} />)}
            {pending && (
              <li className="flex justify-end"><p className="max-w-[80%] rounded-2xl bg-mist px-4 py-3 text-[0.95rem] text-ink opacity-70">{pending.text || label(pending.intent!)}</p></li>
            )}
            {sending && (
              <li className="flex items-center gap-3 text-sm text-muted"><Logo size={28} /><span className="flex gap-1"><Dot /><Dot d={150} /><Dot d={300} /></span> MindMirror đang suy nghĩ…</li>
            )}
            {card && <li><MirrorCardView card={card} /></li>}
            <div ref={endRef} />
          </ol>

          {!finished ? (
            <div className="border-t border-line px-5 pb-4 pt-3 sm:px-10" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
              {error && (
                <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg bg-rust/10 px-3 py-2 text-sm text-rust">
                  <span>{error}</span>
                  {pending && <button className="font-semibold underline" onClick={() => send(pending.text, pending.intent, pending.turnId)}>Gửi lại</button>}
                </div>
              )}
              {modeHint && (
                <p className="mb-2 text-sm text-ink">MindMirror gợi ý chuyển sang <b>{modeHint}</b> cho điểm này.{" "}
                  <button className="font-medium text-mirror underline" onClick={() => send("", "switch_mode")}>Chuyển</button>{" "}
                  <button className="text-muted underline" onClick={() => setModeHint(null)}>Không cần</button></p>
              )}
              {path?.stage === "intro" && !sending && (
                <button onClick={() => send("Bắt đầu", null)} className="mb-3 inline-flex items-center gap-2 rounded-xl bg-mirror px-4 py-2.5 text-sm font-semibold text-white hover:bg-mirror/90">
                  Bắt đầu Phần 1: {path.parts[0]?.title} <Icon name="arrowRight" />
                </button>
              )}
              {path?.stage === "done" && (
                <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-mist/60 px-4 py-3 text-sm">
                  <span className="text-ink">Bạn đã đi hết dàn ý. Thử tự trình bày lại để xem mình nắm chắc tới đâu?</span>
                  <Link to={`/?mode=reunderstand&topic=${encodeURIComponent(s.topic)}`} className="font-semibold text-mirror hover:underline">Tự kiểm tra hiểu biết →</Link>
                </div>
              )}
              <div className="mb-2 flex flex-wrap gap-2">
                {replies.filter((r) => r !== "switch_mode").map((r) => (
                  <button key={r} disabled={sending} onClick={() => send("", r)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${r === "finish" ? "border-mirror/40 bg-mist text-mirror" : "border-line bg-sheet text-ink hover:border-mirror/60"}`}>
                    {label(r)}
                  </button>
                ))}
              </div>
              <form className="flex items-end gap-2 rounded-2xl border border-line bg-sheet p-2 focus-within:border-mirror" onSubmit={(e) => { e.preventDefault(); send(text, null); }}>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={3000}
                  placeholder={s.mode === "reunderstand" ? "Viết suy nghĩ hoặc trả lời câu hỏi của MindMirror…" : path?.stage === "check" ? "Trả lời câu kiểm tra nhanh bằng lời của bạn…" : "Nhập câu hỏi hoặc chủ đề bạn muốn khám phá…"}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text, null); } }}
                  className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-3 py-2 text-[0.95rem] outline-none placeholder:text-muted/70" />
                <button disabled={sending || !text.trim()} aria-label="Gửi" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mirror text-white disabled:opacity-40"><Icon name="send" /></button>
              </form>
              <p className="mt-2 text-center text-[11px] text-muted">MindMirror có thể mắc lỗi. Hãy kiểm tra những thông tin quan trọng.</p>
            </div>
          ) : (
            <p className="border-t border-line px-5 py-5 text-center text-sm text-muted">Phiên đã kết thúc. <Link to={page.path} className="font-medium text-mirror">Mở phiên mới</Link></p>
          )}
        </section>

        {/* Bảng chi tiết: tiêu chí, trích dẫn, các bước Agent đã làm */}
        {panel && (
          <aside className="fixed inset-y-0 right-0 z-40 w-[22rem] max-w-[92vw] overflow-y-auto border-l border-line bg-sheet p-5 shadow-xl xl:static xl:z-auto xl:w-80 xl:shrink-0 xl:rounded-2xl xl:border xl:shadow-none" style={{ maxHeight: "calc(100vh - 9rem)" }}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold text-ink">Chi tiết phiên</p>
              <button onClick={() => setPanel(false)} className="rounded-md p-1 text-muted hover:bg-mist" aria-label="Đóng"><Icon name="x" /></button>
            </div>
            {path && (
              <section className="mb-6">
                <h3 className="text-sm font-semibold text-ink">Dàn bài buổi học</h3>
                <p className="text-xs text-muted">{LEVELS.find((l) => l.value === path.level)?.label}{path.generatedBy === "rules" ? " · dàn ý chung (AI chưa lập được dàn ý riêng)" : ""}</p>
                <ol className="mt-2 space-y-2.5">
                  {path.parts.map((p, i) => (
                    <li key={p.id} className="flex gap-2.5 text-sm">
                      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${PART_STATUS[p.status]?.dot}`}>{p.status === "done" ? "✓" : i + 1}</span>
                      <span className="min-w-0">
                        <span className={`font-medium ${p.status === "current" ? "text-mirror" : "text-ink"}`}>{p.title}</span>
                        <span className="block text-xs text-muted">{PART_STATUS[p.status]?.label} · {p.objective}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {s.rubric.length > 0 && (
              <section className="mb-6">
                <h3 className="text-sm font-semibold text-ink">Các ý chính cần trình bày</h3>
                <p className="text-xs text-muted">Đã trình bày {shownIdeas}/{s.rubric.length} ý · rút từ tài liệu của bạn</p>
                <ul className="mt-2 space-y-2">
                  {s.rubric.map((c) => {
                    const st = rubricStatus.get(c.id) ?? "insufficient_evidence";
                    return (
                      <li key={c.id} className="flex gap-2 text-sm">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[st]}`} title={STATUS_LABEL[st]} />
                        <span><span className="font-medium text-ink">{c.concept}</span><span className="block text-xs text-muted">{STATUS_LABEL[st]}{c.citation.page ? ` · tr. ${c.citation.page}` : ""}</span></span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {devMode && <div className="flex gap-1 rounded-lg bg-paper p-1 text-sm" role="tablist">
              {(devMode ? (["sources", "trace"] as const) : (["sources"] as const)).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-md px-3 py-1.5 ${tab === t ? "bg-sheet font-semibold text-ink shadow-sm" : "text-muted"}`}>
                  {t === "sources" ? "Nguồn đã dùng" : "Agent đã làm gì"}
                </button>
              ))}
            </div>}
            {!devMode && <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Nguồn đã dùng</h3>}
            <div className="mt-4">
              {tab === "sources" || !devMode ? (
                <div className="space-y-6">
                  <section>
                    <h3 className="text-sm font-semibold text-ink">Tài liệu của bạn</h3>
                    {allCitations.length ? (
                      <ul className="mt-2 space-y-4">
                        {allCitations.map(({ key, c, n }) => (
                          <li key={key} id={`cite-${key}`} className={`rounded-lg text-sm transition-colors ${active === key ? "-mx-2 bg-marker/30 px-2 py-1" : ""}`}>
                            <p className="text-xs text-muted">[{n}] {c.documentTitle}{c.page ? `, trang ${c.page}` : ""}</p>
                            <p className="mt-1 leading-relaxed text-ink"><span className="hl">{c.quote}</span></p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-muted">{s.documentIds.length ? "Khi MindMirror nhận xét dựa trên tài liệu, đoạn được trích sẽ hiện ở đây." : "Phiên này không gắn tài liệu. Chọn thư mục học liệu khi tạo phiên mới để được đối chiếu có trích dẫn."}</p>
                    )}
                  </section>
                  {allWeb.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold text-ink">Nguồn web chính thống</h3>
                      <p className="text-[11px] text-muted">Chỉ từ danh sách nguồn chính thống; câu trích có nguyên văn trong trang.</p>
                      <ul className="mt-2 space-y-4">
                        {allWeb.map(({ key, c, n }) => (
                          <li key={key} id={`cite-${key}`} className={`rounded-lg border-l-2 border-dashed border-mirror/60 pl-2 text-sm transition-colors ${active === key ? "bg-marker/30" : ""}`}>
                            <p className="text-xs text-muted">[W{n}] {c.siteName}</p>
                            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow" className="block text-sm font-medium text-mirror underline-offset-2 hover:underline">{c.title}</a>
                            <p className="mt-1 leading-relaxed text-ink">“{c.quote}”</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              ) : (
                <TracePanel sessionId={id} version={version} />
              )}
            </div>
            <p className="mt-6 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
              {path ? "Câu kiểm tra nhanh chỉ để bạn tự biết mình đã nắm phần đó chưa — MindMirror không chấm điểm." : "MindMirror không chấm điểm. Danh sách trên chỉ ghi nhận các ý bạn đã tự trình bày trong phiên này."}
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Dải dàn ý phía trên khung chat: phần nào đã đạt / nên ôn / đang học. */
function PathBar({ path }: { path: LearningPath }) {
  const done = path.parts.filter((p) => p.status === "done").length;
  return (
    <div className="border-b border-line bg-paper/40 px-5 py-3 sm:px-10">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted">Dàn bài · {done}/{path.parts.length} phần đã đạt</span>
      </div>
      <ol className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {path.parts.map((p, i) => (
          <li key={p.id} title={`${PART_STATUS[p.status]?.label}: ${p.objective}`}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${p.status === "current" ? "border-mirror bg-mist font-semibold text-mirror" : "border-line bg-sheet text-ink/80"}`}>
            <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold ${PART_STATUS[p.status]?.dot}`}>{p.status === "done" ? "✓" : i + 1}</span>
            <span className="max-w-[12rem] truncate">{p.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-mirror" style={{ animationDelay: `${d}ms` }} />;
}

function HintLadder({ level, phase }: { level: number; phase: string }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label={`Mức hỗ trợ: ${HINT_LABEL[level]}`}>
      <span className="rounded-full bg-paper px-2 py-0.5">{phase}</span>
      <span>Mức gợi ý đã dùng</span>
      {[1, 2, 3].map((l) => <span key={l} className={`h-1.5 w-5 rounded-full ${l <= level ? "bg-mirror" : "bg-line"}`} />)}
      <span>{HINT_LABEL[level]}</span>
    </div>
  );
}

/** Lời MindMirror: hỗ trợ **đậm**, gạch đầu dòng, xuống dòng; [n] thành chỉ số trích dẫn bấm được. */
function Message({ m, active, onCite, fontCls = "text-[0.95rem]" }: { m: Msg; active: string | null; onCite: (k: string) => void; fontCls?: string }) {
  if (m.role === "user") {
    return (
      <li className="flex justify-end">
        <p className={`max-w-[80%] whitespace-pre-wrap rounded-2xl bg-mist px-4 py-3 ${fontCls} leading-relaxed text-ink`}>{m.text}</p>
      </li>
    );
  }
  const inline = (line: string, li: number): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*|\[\d+(?:,\s*\d+)*\]|\[W\d+\])/g).map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${li}-${i}`} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
      const w = /^\[W(\d+)\]$/.exec(p)?.[1];
      if (w) {
        const c = m.webCitations?.[Number(w) - 1];
        const key = `${m.id}:W${w}`;
        return c ? (
          <button key={`${li}-${i}`} className={`cite-ref cite-web ${active === key ? "bg-marker/60" : ""}`} title={`Nguồn web: ${c.siteName} — ${c.title}`}
            onClick={() => { onCite(key); setTimeout(() => document.getElementById(`cite-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); }}>W{w}</button>
        ) : null;
      }
      const nums = /^\[(\d+(?:,\s*\d+)*)\]$/.exec(p)?.[1];
      if (!nums || !m.citations?.length) return <Fragment key={`${li}-${i}`}>{p}</Fragment>;
      return nums.split(",").map((n) => n.trim()).map((n) => {
        const key = `${m.id}:${n}`;
        const c = m.citations[Number(n) - 1];
        return c ? (
          <button key={`${li}-${i}-${n}`} className={`cite-ref ${active === key ? "bg-marker/60" : ""}`} title={`${c.documentTitle}${c.page ? `, tr. ${c.page}` : ""}`}
            onClick={() => { onCite(key); setTimeout(() => document.getElementById(`cite-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50); }}>{n}</button>
        ) : null;
      });
    });
  return (
    <li className="flex gap-3">
      <Logo size={32} className="mt-0.5 shrink-0 rounded-full" />
      <div className="min-w-0 max-w-[72ch]">
        <p className="mb-1.5 text-sm font-semibold text-ink">MindMirror</p>
        <div className={`space-y-2.5 ${fontCls} leading-[1.7] text-ink/90`}><RichText text={m.text} renderInline={inline} /></div>
      </div>
    </li>
  );
}
