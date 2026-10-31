import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, explain, type Mode } from "../lib/api";
import { MODE_LABEL, PHASE_LABEL } from "../lib/labels";

export default function History() {
  const [items, setItems] = useState<{ id: string; mode: Mode; topic: string; phase: string; status: string; updatedAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.listSessions().then((r) => setItems(r.items)).catch((e) => setError(explain(e))); }, []);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl">Những lần cậu đã soi lại</h1>
      {error && <p className="mt-4 text-rust text-sm">{error}</p>}
      {items && !items.length && <p className="mt-6 text-muted">Chưa có phiên nào. <Link to="/" className="underline">Bắt đầu phiên đầu tiên</Link></p>}
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {items?.map((s) => (
          <li key={s.id}>
            <Link to={`/s/${s.id}`} className="block py-4 hover:text-mirror">
              <p className="font-serif text-lg">{s.topic}</p>
              <p className="text-xs text-muted">
                {MODE_LABEL[s.mode]} — {s.status === "finished" ? "đã có thẻ Gương Hiểu Biết" : s.status === "paused" ? "tạm dừng" : PHASE_LABEL[s.phase]} — {new Date(s.updatedAt).toLocaleString("vi")}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
