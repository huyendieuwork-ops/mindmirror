import { useEffect, useState } from "react";
import { api, type TraceRecord } from "../lib/api";

const STEP: Record<string, string> = {
  input_validation: "Kiểm tra đầu vào", intent_understanding: "Hiểu ý định", policy_decision: "Chọn bước tiếp theo",
  evidence_retrieval: "Truy xuất bằng chứng", knowledge_analysis: "Phân tích & đặt câu hỏi", misconception_detection: "Phát hiện hiểu lầm",
  output_validation: "Kiểm duyệt đầu ra", reassessment: "Đánh giá lại", session_summary: "Tổng kết phiên",
  web_search: "Tìm nguồn chính thống",
};
const TOOL: Record<string, string> = {
  search_learning_materials: "Tìm trong thư viện", retrieve_document_context: "Lấy ngữ cảnh tài liệu phiên",
  get_learning_history: "Xem lịch sử học", get_knowledge_gaps: "Xem lỗ hổng đã ghi", save_session_summary: "Lưu thẻ tổng kết",
  search_trusted_sources: "Tìm nguồn web chính thống",
};
const WHO: Record<string, string> = { model: "model tự gọi", policy: "workflow gọi", mcp: "qua MCP" };

/** Observability (chỉ hiện ở Chế độ kỹ thuật): bước workflow, công cụ, guardrail, model, token, chi phí ước tính. */
export default function TracePanel({ sessionId, version }: { sessionId: string; version: number }) {
  const [items, setItems] = useState<TraceRecord[]>([]);
  useEffect(() => { api.traces(sessionId).then((r) => setItems(r.items)).catch(() => {}); }, [sessionId, version]);
  if (!items.length) return <p className="text-sm text-muted">Chưa có lượt nào.</p>;
  const total = items.reduce((a, t) => ({ tok: a.tok + t.summary.inputTokens + t.summary.outputTokens, cost: a.cost + t.summary.costUsd, calls: a.calls + t.summary.llmCalls }), { tok: 0, cost: 0, calls: 0 });
  return (
    <div className="text-sm">
      <p className="text-muted">{items.length} lần xử lý · {total.calls} lần gọi model · {total.tok.toLocaleString("vi")} token · chi phí ước tính ${total.cost.toFixed(4)}</p>
      <p className="mt-1 text-[11px] text-muted">Chi phí là ước tính theo bảng giá công khai; free tier không bị tính phí — hoá đơn thật xem ở Google AI Studio.</p>
      <ol className="mt-3 space-y-4">
        {items.slice().reverse().map((t) => {
          const s = t.summary;
          return (
            <li key={t.traceId} className="border-l-2 border-mirror/30 pl-3">
              <p className="font-medium text-ink">
                {new Date(t.createdAt).toLocaleTimeString("vi")} — {s.totalMs ?? "?"} ms · {s.llmCalls} lần gọi{s.models?.length ? ` (${s.models.join(", ")})` : ""}
                {s.retries ? <span className="text-rust"> · thử lại {s.retries}</span> : null}
                {s.fallbacks > 0 && <span className="text-rust"> · model dự phòng</span>}
              </p>
              <p className="text-[11px] text-muted">trace {t.traceId.slice(0, 8)} · {s.inputTokens}+{s.outputTokens} token · ~${s.costUsd.toFixed(5)}</p>
              {s.workflow?.length ? (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {s.workflow.map((w, i) => (
                    <li key={i} className={`rounded-md px-1.5 py-0.5 text-[11px] ${w.status === "error" ? "bg-rust/10 text-rust" : w.status === "skipped" ? "bg-paper text-muted/60 line-through" : "bg-paper text-muted"}`}>{STEP[w.step] ?? w.step} {w.ms}ms</li>
                  ))}
                </ul>
              ) : null}
              {s.tools?.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {s.tools.map((x, i) => (
                    <li key={i} className={x.ok ? "text-ink" : "text-rust"}>🔧 {TOOL[x.name] ?? x.name} <span className="text-muted">({WHO[x.initiator ?? ""] ?? x.initiator}, {x.ms} ms{x.error ? `, lỗi ${x.error}` : ""})</span></li>
                  ))}
                </ul>
              ) : null}
              {s.retrieval?.filter((r) => r.purpose !== "web").length ? <p className="mt-1 text-muted">📚 Truy xuất: {s.retrieval.filter((r) => r.purpose !== "web").map((r) => `${r.hits} đoạn (${r.method})`).join(", ")}</p> : null}
              {s.web?.map((w, i) => (
                <div key={i} className="mt-1 text-muted">
                  🌐 Nguồn web ({w.fromCache ? "lấy từ bộ nhớ lưu" : w.method}){w.rejected ? ` · loại ${w.rejected} link ngoài danh sách/lỗi` : ""}{!w.pages.length ? " · không có trang phù hợp" : ""}
                  {w.pages.length > 0 && <ul className="ml-4 list-disc text-[11px]">{[...new Set(w.pages)].map((u) => <li key={u} className="break-all">{(() => { try { return decodeURI(u); } catch { return u; } })()}</li>)}</ul>}
                </div>
              ))}
              {s.guardrails?.length ? <p className="mt-1 text-[#B7791F]">🛡️ Guardrail: {s.guardrails.join(", ")}</p> : null}
              {s.errors.length > 0 && <p className="mt-1 text-rust">Lỗi: {s.errors.map((e) => `${e.span} (${e.error})`).join(", ")}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
