import type { MirrorCard } from "../lib/api";
import { STATUS_COLOR, STATUS_LABEL } from "../lib/labels";

/** Thẻ Gương Hiểu Biết — khoảnh khắc chuyển động duy nhất của sản phẩm (hiện lên khi kết thúc phiên). */
export default function MirrorCardView({ card }: { card: MirrorCard }) {
  const a = card.assessment;
  return (
    <article className="reveal mt-8 rounded-xl border border-line bg-sheet overflow-hidden">
      <div className="grid sm:grid-cols-[1fr_1fr]">
        <section className="p-6 border-b sm:border-b-0 sm:border-r border-line">
          <h2 className="font-serif text-2xl">Hôm nay cậu đã nhìn lại…</h2>
          <p className="mt-1 text-sm text-muted">{card.topic}</p>
          {card.initialThought && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Lúc đầu cậu nói</h3>
              <blockquote className="mt-1 font-serif italic text-muted">“{card.initialThought}”</blockquote>
            </div>
          )}
          {card.changed && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Điều đã thay đổi</h3>
              <p className="mt-1 font-serif">{card.changed}</p>
            </div>
          )}
        </section>
        {/* nửa "phản chiếu": điều quan sát được */}
        <section className="p-6 bg-mirror/[0.06]">
          <h3 className="text-sm font-semibold">Điều cậu đã thể hiện</h3>
          {card.demonstrated.length ? (
            <ul className="mt-2 space-y-2 font-serif">
              {card.demonstrated.map((d, i) => (
                <li key={i}>{d.text}{d.assisted && <span className="ml-1 text-xs font-sans text-muted">(sau gợi ý)</span>}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 font-serif text-muted">Phiên này chưa đủ căn cứ để ghi nhận — và như vậy cũng không sao.</p>
          )}
          {card.unresolved.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Còn bỏ ngỏ</h3>
              <p className="mt-1 font-serif">{card.unresolved.join("; ")}</p>
            </div>
          )}
          <div className="mt-5">
            <h3 className="text-sm font-semibold">Bước tiếp theo</h3>
            <p className="mt-1 font-serif">{card.nextStep}</p>
          </div>
        </section>
      </div>
      {a.criteria.length > 0 && (
        <section className="p-6 border-t border-line">
          <h3 className="text-sm font-semibold">Theo từng tiêu chí{a.grounded ? " trong tài liệu của cậu" : ""}</h3>
          <ul className="mt-3 space-y-2">
            {a.criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_COLOR[c.status]}`} />
                <span className="flex-1">
                  <span className="font-medium">{c.concept}</span> — {STATUS_LABEL[c.status]}
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
