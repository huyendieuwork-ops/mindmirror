import type { MirrorCard } from "../lib/api";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/labels";

/** Thẻ Gương Hiểu Biết — hiện lên khi kết thúc phiên. */
export default function MirrorCardView({ card }: { card: MirrorCard }) {
  const a = card.assessment;
  return (
    <article className="reveal mt-6 overflow-hidden rounded-2xl border border-line bg-sheet shadow-sm">
      <div className="flex items-center gap-3 border-b border-line bg-mist/50 px-6 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-sheet text-mirror">✓</span>
        <div><p className="font-semibold text-ink">Tổng kết buổi học</p><p className="text-xs text-muted">{card.topic}</p></div>
      </div>
      <div className="grid sm:grid-cols-2">
        <section className="border-b border-line p-6 sm:border-b-0 sm:border-r">
          <h2 className="text-lg font-bold text-ink">Hôm nay bạn đã nhìn lại…</h2>
          {card.initialThought && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Lúc đầu bạn nói</h3>
              <blockquote className="mt-1 italic text-ink/80">“{card.initialThought}”</blockquote>
            </div>
          )}
          {card.changed && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Điều đã thay đổi</h3>
              <p className="mt-1 text-ink">{card.changed}</p>
            </div>
          )}
          {!card.initialThought && !card.changed && <p className="mt-2 text-sm text-muted">Mỗi lần giải thích lại là một lần hiểu sâu hơn.</p>}
        </section>
        <section className="bg-mist/30 p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Điều bạn đã thể hiện</h3>
          {card.demonstrated.length ? (
            <ul className="mt-2 space-y-2 text-ink">
              {card.demonstrated.map((d, i) => (
                <li key={i} className="flex gap-2"><span className="text-moss">✓</span><span>{d.text}{d.assisted && <span className="ml-1 text-xs text-muted">(sau gợi ý)</span>}</span></li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">Phiên này chưa đủ căn cứ để ghi nhận — và như vậy cũng không sao.</p>
          )}
          {card.unresolved.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Còn bỏ ngỏ</h3>
              <p className="mt-1 text-ink">{card.unresolved.join("; ")}</p>
            </div>
          )}
          <div className="mt-4 rounded-xl bg-sheet p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-mirror">Bước tiếp theo</h3>
            <p className="mt-1 text-ink">{card.nextStep}</p>
          </div>
        </section>
      </div>
      {a.criteria.length > 0 && (
        <section className="border-t border-line p-6">
          <h3 className="text-sm font-semibold text-ink">Theo từng tiêu chí{a.grounded ? " trong tài liệu của bạn" : ""}</h3>
          <ul className="mt-3 space-y-2">
            {a.criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[c.status]}`} />
                <span className="flex-1">
                  <span className="font-medium text-ink">{c.concept}</span> — {STATUS_LABEL[c.status]}
                  {c.applied && <span className="text-moss">, đã vận dụng vào tình huống mới</span>}
                  {c.sourceCitation?.page && <span className="text-muted"> (tr. {c.sourceCitation.page})</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">{a.note}</p>
        </section>
      )}
    </article>
  );
}
