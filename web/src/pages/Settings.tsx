import { useEffect, useState } from "react";
import { api, explain, type AppConfig, type Settings } from "../lib/api";

const GROUPS: { key: keyof Settings; title: string; options: [string, string, string][] }[] = [
  { key: "aiStyle", title: "Phong cách trò chuyện", options: [["friendly", "Thân thiện", "Gần gũi, dễ hiểu"], ["concise", "Ngắn gọn", "Súc tích, vào trọng tâm"], ["academic", "Học thuật", "Có cấu trúc, dùng thuật ngữ"]] },
  { key: "supportPreference", title: "Khi cậu gặp khó", options: [["socratic_first", "Gợi mở trước", "Hỏi để cậu tự nhận ra"], ["direct", "Giải thích trực tiếp", "Không kéo dài chuỗi câu hỏi"], ["flexible", "Linh hoạt", "Agent tự chọn theo tình huống"]] },
  { key: "challengeLevel", title: "Mức thử thách", options: [["gentle", "Nhẹ nhàng", "Kiến thức nền, ví dụ đơn giản"], ["balanced", "Cân bằng", "Giải thích, hỏi, vận dụng"], ["deep", "Chuyên sâu", "Hỏi tại sao, đổi điều kiện"]] },
];

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.settings().then(setS).catch((e) => setMsg(explain(e))); api.config().then(setCfg).catch(() => {}); }, []);

  async function patch(p: Partial<Settings>) {
    setS((x) => (x ? { ...x, ...p } : x));
    await api.saveSettings(p);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  if (!s) return <div className="mx-auto max-w-3xl px-4 py-10 text-muted">{msg ?? "Đang tải…"}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl">Cài đặt</h1>
      <p className="mt-1 text-sm text-muted h-5">{saved ? "Đã lưu." : "Thay đổi được lưu ngay. Chúng đổi cách MindMirror nói, không đổi tiêu chuẩn chính xác."}</p>
      {GROUPS.map((g) => (
        <fieldset key={g.key} className="mt-8">
          <legend className="font-semibold">{g.title}</legend>
          <div className="mt-2 grid sm:grid-cols-3 gap-2">
            {g.options.map(([v, l, d]) => (
              <label key={v} className={`cursor-pointer rounded-lg border px-3 py-2 ${s[g.key] === v ? "border-ink bg-sheet" : "border-line"}`}>
                <input type="radio" name={g.key} className="sr-only" checked={s[g.key] === v} onChange={() => patch({ [g.key]: v } as Partial<Settings>)} />
                <span className="font-medium text-sm">{l}</span>
                <span className="block text-xs text-muted">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="mt-8 flex items-center gap-3">
        <input type="checkbox" checked={s.selfAssessment} onChange={(e) => patch({ selfAssessment: e.target.checked })} />
        <span>Hỏi mức tự tin trước khi bắt đầu phiên Hiểu lại</span>
      </label>

      <section className="mt-14 border-t border-line pt-6">
        <h2 className="font-semibold">Dữ liệu của cậu</h2>
        <p className="mt-1 text-sm text-muted">Gõ XOA để xác nhận. Không thể hoàn tác.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-24 rounded-md border border-line bg-sheet px-2 py-1.5 text-sm" />
          <button disabled={confirmText !== "XOA"} onClick={async () => { await api.deleteData("sessions"); setMsg("Đã xoá toàn bộ phiên học."); setConfirmText(""); }} className="rounded-md border border-rust text-rust px-3 py-1.5 text-sm disabled:opacity-30">Xoá các phiên học</button>
          <button disabled={confirmText !== "XOA"} onClick={async () => { await api.deleteData("all"); setMsg("Đã xoá phiên, tài liệu, kết nối và cài đặt."); setConfirmText(""); }} className="rounded-md bg-rust text-paper px-3 py-1.5 text-sm disabled:opacity-30">Xoá tất cả dữ liệu</button>
        </div>
        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </section>

      {cfg && (
        <section className="mt-10 text-xs text-muted">
          Máy chủ: {cfg.env}, model {cfg.model}{cfg.embeddings ? ", tìm kiếm ngữ nghĩa bật" : ", tìm kiếm từ khoá"}{cfg.tracing.length ? `, theo dõi qua ${cfg.tracing.join(" + ")}` : ""}. Giới hạn: {cfg.limits.sessionsPerDay} phiên/ngày, {cfg.limits.turnsPerSession} lượt/phiên.
        </section>
      )}
    </div>
  );
}
