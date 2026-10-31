import { useEffect, useState } from "react";
import { api, type TraceRecord } from "../lib/api";

const STEP: Record<string, string> = {
  "agent.turn": "Cả lượt", "policy.decide": "Chọn bước tiếp theo", "rag.retrieve": "Tìm trong tài liệu",
  "agent.respond": "Soạn phản hồi", "validate.output": "Kiểm chứng bằng chứng", "card.build": "Tạo thẻ",
  "agent.plan": "Lập tiêu chí từ tài liệu", "rag.ingest": "Nhập tài liệu", "rag.embed": "Tạo embedding",
};

/** Observability cho người dùng/giám khảo: agent đã làm những bước gì, mất bao lâu, tốn bao nhiêu token. */
export default function TracePanel({ sessionId, version }: { sessionId: string; version: number }) {
  const [items, setItems] = useState<TraceRecord[]>([]);
  useEffect(() => { api.traces(sessionId).then((r) => setItems(r.items)).catch(() => {}); }, [sessionId, version]);
  if (!items.length) return <p className="text-sm text-muted">Chưa có lượt nào.</p>;
  const total = items.reduce((a, t) => ({ tok: a.tok + t.summary.inputTokens + t.summary.outputTokens, cost: a.cost + t.summary.costUsd }), { tok: 0, cost: 0 });
  return (
    <div className="text-sm">
      <p className="text-muted">{items.length} lần xử lý · {total.tok.toLocaleString("vi")} token · ước tính ${total.cost.toFixed(4)}</p>
      <ol className="mt-3 space-y-3">
        {items.slice().reverse().map((t) => (
          <li key={t.traceId} className="border-l-2 border-mirror/30 pl-3">
            <p className="font-medium text-ink">
              {new Date(t.createdAt).toLocaleTimeString("vi")} — {t.summary.totalMs ?? "?"} ms
              {t.summary.fallbacks > 0 && <span className="text-rust">, đã chuyển model dự phòng</span>}
            </p>
            <ul className="mt-1 text-muted">
              {t.summary.steps.filter((s) => s.name !== "agent.turn").map((s, i) => (
                <li key={i} className={s.status === "error" ? "text-rust" : ""}>
                  {STEP[s.name] ?? s.name.replace("llm.", "Gọi model ")}: {s.ms} ms
                </li>
              ))}
            </ul>
            {t.summary.errors.length > 0 && <p className="text-rust">Lỗi: {t.summary.errors.map((e) => `${e.span} (${e.error})`).join(", ")}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
