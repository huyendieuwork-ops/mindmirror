import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, explain, newTurnId, type Assessment, type Citation, type Intent, type MirrorCard, type Msg, type SessionView } from "../lib/api";
import { HINT_LABEL, INTENT_LABEL, MODE_LABEL, PHASE_LABEL, STATUS_COLOR, STATUS_LABEL } from "../lib/labels";
import MirrorCardView from "../components/MirrorCardView";
import TracePanel from "../components/TracePanel";

const DEFAULT_REPLIES: Intent[] = ["hint", "give_example", "show_answer", "skip", "finish"];

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
  const [active, setActive] = useState<string | null>(null); // trích dẫn đang được chọn
  const [tab, setTab] = useState<"sources" | "trace">("sources");
  const [version, setVersion] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const v = await api.getSession(id);
      setS(v);
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
      setModeHint(r.suggestModeSwitch ? MODE_LABEL[r.suggestModeSwitch] : null);
      if (r.card) setCard(r.card);
      await load();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(explain(e)); // giữ pending để bấm "Gửi lại" với cùng client_turn_id
    } finally { setSending(false); }
  }

  // Mọi trích dẫn trong phiên — đánh số theo thứ tự xuất hiện trong từng tin nhắn
  const allCitations = useMemo(() => {
    const out: { key: string; c: Citation; msgId: string; n: number }[] = [];
    s?.messages.forEach((m) => m.citations?.forEach((c, i) => out.push({ key: `${m.id}:${i + 1}`, c, msgId: m.id, n: i + 1 })));
    return out.reverse();
  }, [s]);

  if (!s) return <div className="mx-auto max-w-3xl px-4 py-16 text-muted">{error ?? "Đang mở phiên…"}</div>;
  const finished = s.status === "finished";
  const rubricStatus = new Map(assessment?.criteria.map((c) => [c.criterionId, c.status]) ?? []);

  return (
    <div className="mx-auto max-w-6xl px-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <div className="min-w-0 flex flex-col min-h-[calc(100vh-3.5rem)]">
        <header className="pt-6 pb-4 border-b border-line">
          <p className="text-sm text-muted">{MODE_LABEL[s.mode]} · {PHASE_LABEL[s.phase] ?? s.phase}</p>
          <h1 className="mt-1 font-serif text-2xl sm:text-3xl leading-tight">{s.topic}</h1>
          <HintLadder level={s.hintLevel} />
        </header>

        <ol className="flex-1 py-6 space-y-6" aria-live="polite">
          {s.messages.map((m) => (
            <Message key={m.id} m={m} active={active} onCite={(k) => { setActive(k); setTab("sources"); }} />
          ))}
          {pending && (
            <li className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink/[0.06] px-4 py-2.5 opacity-70">{pending.text || INTENT_LABEL[pending.intent!]}</p>
            </li>
          )}
          {sending && <li className="font-serif text-muted italic">MindMirror đang nghĩ…</li>}
        </ol>

        {card && <MirrorCardView card={card} />}
        <div ref={endRef} />

        {!finished && (
          <div className="sticky bottom-0 bg-paper pt-3 pb-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
            {error && (
              <div className="mb-2 flex items-center gap-3 text-sm text-rust">
                <span>{error}</span>
                {pending && <button className="underline font-medium" onClick={() => send(pending.text, pending.intent, pending.turnId)}>Gửi lại</button>}
              </div>
            )}
            {modeHint && (
              <p className="mb-2 text-sm">
                MindMirror gợi ý chuyển sang <b>{modeHint}</b> cho điểm này.{" "}
                <button className="underline" onClick={() => send("", "switch_mode")}>Chuyển</button>{" "}
                <button className="text-muted underline" onClick={() => setModeHint(null)}>Không cần</button>
              </p>
            )}
            <div className="flex flex-wrap gap-2 mb-2">
              {replies.filter((r) => r !== "switch_mode").map((r) => (
                <button key={r} disabled={sending} onClick={() => send("", r)}
                  className={`px-3 py-1 rounded-full text-sm border disabled:opacity-40 ${r === "finish" ? "border-ink" : "border-line hover:border-ink"}`}>
                  {INTENT_LABEL[r]}
                </button>
              ))}
            </div>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(text, null); }}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={3000}
                placeholder="Nói theo cách cậu hiểu — không cần chính xác từng chữ"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text, null); } }}
                className="flex-1 resize-none rounded-xl border border-line bg-sheet px-4 py-3 outline-none focus:border-mirror" />
              <button disabled={sending || !text.trim()} className="rounded-xl bg-ink text-paper px-5 py-3 font-semibold disabled:opacity-40">Gửi</button>
            </form>
          </div>
        )}
        {finished && (
          <p className="py-8 text-sm text-muted">Phiên đã kết thúc. <Link to="/" className="underline">Mở phiên mới</Link></p>
        )}
      </div>

      {/* Lề phải: như lề giáo trình — trích dẫn, tiêu chí, quá trình xử lý */}
      <aside className="lg:sticky lg:top-14 lg:self-start lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto py-6 border-t lg:border-t-0 lg:border-l border-line lg:pl-6">
        {s.rubric.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold">Điều cần thể hiện</h2>
            <ul className="mt-2 space-y-2">
              {s.rubric.map((c) => {
                const st = rubricStatus.get(c.id) ?? "insufficient_evidence";
                return (
                  <li key={c.id} className="flex gap-2 text-sm">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[st]}`} title={STATUS_LABEL[st]} />
                    <span><span className="font-medium">{c.concept}</span><span className="block text-muted text-xs">{STATUS_LABEL[st]}{c.citation.page ? ` · tr. ${c.citation.page}` : ""}</span></span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className={`${s.rubric.length ? "mt-8" : ""} flex gap-4 border-b border-line text-sm`} role="tablist">
          {(["sources", "trace"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`pb-2 -mb-px border-b-2 ${tab === t ? "border-ink font-semibold" : "border-transparent text-muted"}`}>
              {t === "sources" ? "Từ tài liệu" : "Agent đã làm gì"}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "sources" ? (
            allCitations.length ? (
              <ul className="space-y-4">
                {allCitations.map(({ key, c, n }) => (
                  <li key={key} id={`cite-${key}`} className={`text-sm rounded-md transition-colors ${active === key ? "bg-marker/20 -mx-2 px-2 py-1" : ""}`}>
                    <p className="text-xs text-muted">[{n}] {c.documentTitle}{c.page ? `, trang ${c.page}` : ""}</p>
                    <p className="mt-1 font-serif leading-relaxed"><span className="hl">{c.quote}</span></p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{s.documentIds.length ? "Khi MindMirror nhận xét dựa trên tài liệu, đoạn được trích sẽ hiện ở đây." : "Phiên này không gắn tài liệu. Thêm tài liệu ở trang Tài liệu để được đối chiếu có trích dẫn."}</p>
            )
          ) : (
            <TracePanel sessionId={id} version={version} />
          )}
        </div>
      </aside>
    </div>
  );
}

function HintLadder({ level }: { level: number }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-muted" aria-label={`Mức hỗ trợ: ${HINT_LABEL[level]}`}>
      <span>Mức hỗ trợ</span>
      {[1, 2, 3].map((l) => <span key={l} className={`h-1.5 w-6 rounded-full ${l <= level ? "bg-mirror" : "bg-line"}`} />)}
      <span>{HINT_LABEL[level]}</span>
    </div>
  );
}

/** Lời MindMirror: serif như chữ trong sách; [n] thành chỉ số trích dẫn bấm được. */
function Message({ m, active, onCite }: { m: Msg; active: string | null; onCite: (k: string) => void }) {
  if (m.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink/[0.06] px-4 py-2.5">{m.text}</p>
      </li>
    );
  }
  const parts = m.text.split(/(\[\d+(?:,\s*\d+)*\])/g);
  return (
    <li className="max-w-[68ch] font-serif text-[1.07rem] leading-[1.7] whitespace-pre-wrap">
      {parts.map((p, i) => {
        const nums = /^\[(\d+(?:,\s*\d+)*)\]$/.exec(p)?.[1];
        if (!nums || !m.citations?.length) return <Fragment key={i}>{p}</Fragment>;
        return nums.split(",").map((n) => n.trim()).map((n) => {
          const key = `${m.id}:${n}`;
          const c = m.citations[Number(n) - 1];
          return c ? (
            <button key={`${i}-${n}`} className={`cite-ref ${active === key ? "bg-marker/60" : ""}`}
              title={`${c.documentTitle}${c.page ? `, tr. ${c.page}` : ""}`}
              onClick={() => { onCite(key); document.getElementById(`cite-${key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}>
              {n}
            </button>
          ) : null;
        });
      })}
    </li>
  );
}
