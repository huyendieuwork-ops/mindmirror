import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, explain, type Settings } from "../lib/api";
import { invalidate, pref, setPref } from "../lib/data";
import { saveTheme, type Theme } from "../lib/theme";
import { signOut } from "../lib/supabase";
import type { UserInfo } from "../components/Layout";
import { Avatar, Btn, Icon, Modal, PageHeader, Toggle, type IconName } from "../components/ui";
import { mascotCheer, mascotImage, mascotMode, setMascot, type MascotMode } from "../components/Mascot";

const DEFAULT: Settings = { aiStyle: "friendly", supportPreference: "socratic_first", challengeLevel: "balanced", selfAssessment: true };
export interface NotifyPrefs { gaps: boolean; unfinished: boolean; weekly: boolean }
export const NOTIFY_DEFAULT: NotifyPrefs = { gaps: true, unfinished: true, weekly: true };
export type ChatFont = "sm" | "md" | "lg";

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: "account", label: "Tài khoản", icon: "user" },
  { id: "ai", label: "Cách AI hướng dẫn", icon: "chat" },
  { id: "look", label: "Giao diện", icon: "panel" },
  { id: "notify", label: "Thông báo", icon: "bell" },
  { id: "data", label: "Dữ liệu & quyền riêng tư", icon: "lock" },
];

/** Cài đặt: điều hướng theo nhóm bên trái, mỗi nhóm một khối; lựa chọn ít dùng dạng nút chọn nhanh thay cho danh sách thả xuống. */
export default function SettingsPage({ user }: { user: UserInfo }) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(pref<Theme>("theme", "light"));
  const [font, setFont] = useState<ChatFont>(pref<ChatFont>("chatFont", "md"));
  const [notify, setNotify] = useState<NotifyPrefs>({ ...NOTIFY_DEFAULT, ...pref<Partial<NotifyPrefs>>("notify", {}) });
  const [devMode, setDevMode] = useState<boolean>(pref<boolean>("devMode", false));
  const [usage, setUsage] = useState<{ sessionsToday: number; sessionsPerDay: number; resetAt: string } | null>(null);
  const [del, setDel] = useState<null | "sessions" | "all">(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [section, setSection] = useState("account");
  const [mMode, setMMode] = useState<MascotMode>(mascotMode);
  const [mImg, setMImg] = useState<string | null>(mascotImage);
  const [mCheer, setMCheer] = useState<boolean>(mascotCheer);
  function pickMascotImage(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|gif|webp|jpeg)$/.test(f.type)) { setError("Chọn ảnh PNG, GIF, WebP hoặc JPG."); return; }
    if (f.size > 600 * 1024) { setError("Ảnh tối đa 600 KB (nên dùng PNG/GIF nền trong suốt)."); return; }
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); try { setMascot({ img: url }); setMImg(url); setSaved("Đã đổi nhân vật"); } catch { setError("Trình duyệt không lưu được ảnh này. Thử ảnh nhỏ hơn."); } };
    r.readAsDataURL(f);
  }

  useEffect(() => { api.settings().then(setS).catch((e) => { setError(explain(e)); setS(DEFAULT); }); api.usage().then(setUsage).catch(() => {}); }, []);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(null), 2200); return () => clearTimeout(t); }, [saved]);

  async function patch(p: Partial<Settings>) {
    if (!s) return;
    const prev = s;
    setS({ ...s, ...p }); setError(null);
    try { setS(await api.saveSettings(p)); setSaved("Đã lưu thay đổi"); } catch (e) { setS(prev); setError(explain(e)); }
  }
  function patchNotify(p: Partial<NotifyPrefs>) {
    const n = { ...notify, ...p };
    setNotify(n); setPref("notify", n); setSaved("Đã lưu thay đổi");
    window.dispatchEvent(new Event("mm-notify"));
  }
  async function doDelete() {
    if (!del) return;
    setBusy(true);
    try {
      await api.deleteData(del);
      invalidate();
      setDel(null); setConfirmText("");
      setSaved(del === "all" ? "Đã xoá toàn bộ dữ liệu" : "Đã xoá lịch sử học tập");
    } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }
  /** Tải dữ liệu của tôi: phiên học (kèm Thẻ Gương), danh sách tài liệu và thư mục — gom ở trình duyệt từ chính API của bạn. */
  async function exportData() {
    setExporting(true); setError(null);
    try {
      const [list, docs, folders, notes] = await Promise.all([api.listSessions(), api.documents(), api.folders(), api.notes().catch(() => ({ items: [] }))]);
      const sessions = [];
      for (const it of list.items.slice(0, 30)) sessions.push(await api.getSession(it.id).catch(() => it));
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), account: { name: user.name, email: user.email ?? null }, settings: s, folders: folders.items, documents: docs.items, notes: notes.items, sessions }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mindmirror-du-lieu-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setSaved("Đã tạo tệp dữ liệu");
    } catch (e) { setError(explain(e)); } finally { setExporting(false); }
  }
  const go = (id: string) => { setSection(id); document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const v = s ?? DEFAULT;
  const left = usage ? Math.max(0, usage.sessionsPerDay - usage.sessionsToday) : null;
  const resetVN = usage ? new Date(usage.resetAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "7:00";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Cài đặt" subtitle="Tài khoản, cách MindMirror hướng dẫn bạn, giao diện, thông báo và dữ liệu." actions={
        saved ? <span className="inline-flex items-center gap-1.5 rounded-full bg-moss/10 px-3 py-1.5 text-sm font-medium text-moss"><Icon name="check" /> {saved}</span> : null
      } />
      {error && <p className="rounded-lg bg-rust/10 px-4 py-2.5 text-sm text-rust">{error}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Nhóm cài đặt" className="flex gap-2 overflow-x-auto lg:sticky lg:top-6 lg:flex-col lg:self-start">
          {SECTIONS.map((x) => (
            <button key={x.id} onClick={() => go(x.id)} aria-current={section === x.id}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${section === x.id ? "bg-mist font-semibold text-mirror" : "text-ink/80 hover:bg-mist/50"}`}>
              <Icon name={x.icon} className="h-4 w-4" /> {x.label}
            </button>
          ))}
        </nav>

        <div className="space-y-6">
          <Section id="account" title="Tài khoản">
            <div className="flex flex-wrap items-center gap-4 pb-4">
              <Avatar name={user.name} src={user.avatar} size={56} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{user.name}</p>
                {user.email && <p className="truncate text-sm text-muted">{user.email}</p>}
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted"><Icon name="lock" className="h-3.5 w-3.5" /> Đăng nhập bằng Google</p>
              </div>
              <Btn onClick={() => signOut()}><Icon name="logout" /> Đăng xuất</Btn>
            </div>
            <Row title="Hạn mức hôm nay" desc={`Đặt lại lúc ${resetVN} sáng mỗi ngày (giờ Việt Nam).`}>
              {usage ? (
                <div className="w-48">
                  <p className="text-right text-sm"><b className="text-ink">{left}/{usage.sessionsPerDay}</b> <span className="text-muted">phiên còn lại</span></p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-mirror" style={{ width: `${Math.round(((left ?? 0) / usage.sessionsPerDay) * 100)}%` }} /></div>
                </div>
              ) : <span className="text-sm text-muted">—</span>}
            </Row>
          </Section>

          <Section id="ai" title="Cách AI hướng dẫn" subtitle="Áp dụng cho các phiên mới và lượt trả lời tiếp theo.">
            <Row title="Giọng điệu" desc="Độ dài và cách diễn đạt của MindMirror.">
              <Segmented label="Giọng điệu" value={v.aiStyle} disabled={!s} onChange={(x) => patch({ aiStyle: x })}
                options={[{ value: "concise", label: "Ngắn gọn" }, { value: "friendly", label: "Vừa phải" }, { value: "academic", label: "Học thuật" }]} />
            </Row>
            <Row title="Mức thử thách" desc="Câu hỏi của AI sẽ dễ hay khó tới đâu.">
              <Segmented label="Mức thử thách" value={v.challengeLevel} disabled={!s} onChange={(x) => patch({ challengeLevel: x })}
                options={[{ value: "gentle", label: "Nhẹ nhàng" }, { value: "balanced", label: "Cân bằng" }, { value: "deep", label: "Đào sâu" }]} />
            </Row>
            <Row title="Ưu tiên tự suy nghĩ" desc="Bật: hỏi gợi mở trước khi giải thích. Tắt: đưa giải thích ngay khi bạn cần.">
              <Toggle label="Ưu tiên tự suy nghĩ" disabled={!s} checked={v.supportPreference === "socratic_first"} onChange={(on) => patch({ supportPreference: on ? "socratic_first" : "flexible" })} />
            </Row>
            <Row title="Tự đánh giá trước phiên" desc="Hỏi bạn đang thấy mình ở mức nào trước khi Kiểm tra hiểu biết.">
              <Toggle label="Tự đánh giá trước phiên" disabled={!s} checked={v.selfAssessment} onChange={(on) => patch({ selfAssessment: on })} />
            </Row>
          </Section>

          <Section id="look" title="Giao diện">
            <Row title="Chủ đề màu" desc="Sáng, tối hoặc theo hệ thống.">
              <Segmented label="Chủ đề màu" value={theme} onChange={(t) => { setTheme(t); saveTheme(t); setSaved("Đã lưu thay đổi"); }}
                options={[{ value: "light", label: "Sáng" }, { value: "dark", label: "Tối" }, { value: "system", label: "Hệ thống" }]} />
            </Row>
            <Row title="Cỡ chữ trong phiên học" desc="Áp dụng cho lời trò chuyện trong phiên học.">
              <Segmented label="Cỡ chữ" value={font} onChange={(f) => { setFont(f); setPref("chatFont", f); setSaved("Đã lưu thay đổi"); }}
                options={[{ value: "sm", label: "Nhỏ" }, { value: "md", label: "Vừa" }, { value: "lg", label: "Lớn" }]} />
            </Row>
            <Row title="Trợ lý ghi chú ở chân trang" desc="Nhân vật nhỏ ở chân trang — bấm vào để mở sổ ghi chú. Chọn đi dạo, đứng yên một chỗ hoặc ẩn (vẫn mở ghi chú được từ menu tài khoản).">
              <Segmented label="Trợ lý ghi chú" value={mMode} onChange={(m) => { setMMode(m); setMascot({ mode: m }); setSaved("Đã lưu thay đổi"); }}
                options={[{ value: "walk", label: "Đi dạo" }, { value: "stand", label: "Đứng yên" }, { value: "hidden", label: "Ẩn" }]} />
            </Row>
            <Row title="Lời động viên" desc="Thỉnh thoảng (khoảng 5–10 phút một lần) bé Mochi hiện một câu cổ vũ nhỏ. Bấm vào bong bóng để ẩn.">
              <Toggle label="Lời động viên" disabled={mMode === "hidden"} checked={mCheer} onChange={(x) => { setMCheer(x); setMascot({ cheer: x }); setSaved("Đã lưu thay đổi"); }} />
            </Row>
            <Row title="Hình nhân vật" desc="Mặc định là bé thỏ Mochi của MindMirror. Bạn có thể dùng ảnh nhân vật riêng (PNG/GIF/WebP nền trong suốt, ≤ 600 KB, hướng mặt sang phải) mà bạn có quyền sử dụng — ảnh chỉ lưu trên trình duyệt này.">
              <div className="flex flex-wrap items-center gap-2">
                {mImg && <img src={mImg} alt="Nhân vật hiện tại" className="h-10 w-10 rounded-lg border border-line object-contain" />}
                <label className="cursor-pointer rounded-lg border border-line bg-sheet px-3 py-1.5 text-sm font-medium text-ink hover:border-mirror/60">
                  Chọn ảnh…
                  <input type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => { pickMascotImage(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {mImg && <button onClick={() => { setMascot({ img: null }); setMImg(null); setSaved("Đã dùng nhân vật mặc định"); }} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink">Dùng mặc định</button>}
              </div>
            </Row>
            <Row title="Chế độ kỹ thuật (demo)" desc="Hiện tab “Agent đã làm gì” trong phiên học: các bước xử lý, công cụ, guardrail, token và chi phí ước tính.">
              <Toggle label="Chế độ kỹ thuật" checked={devMode} onChange={(x) => { setDevMode(x); setPref("devMode", x); setSaved("Đã lưu thay đổi"); }} />
            </Row>
          </Section>

          <Section id="notify" title="Thông báo" subtitle="Hiển thị ở biểu tượng chuông trên thanh công cụ.">
            <Row title="Kiến thức cần củng cố" desc="Nhắc khi một phiên còn khái niệm chưa rõ.">
              <Toggle label="Kiến thức cần củng cố" checked={notify.gaps} onChange={(x) => patchNotify({ gaps: x })} />
            </Row>
            <Row title="Phiên học chưa hoàn thành" desc="Nhắc quay lại phiên chưa kết thúc sau 1 ngày.">
              <Toggle label="Phiên học chưa hoàn thành" checked={notify.unfinished} onChange={(x) => patchNotify({ unfinished: x })} />
            </Row>
            <Row title="Tóm tắt hằng tuần" desc="Số phiên học và nội dung nên ôn trong 7 ngày qua.">
              <Toggle label="Tóm tắt hằng tuần" checked={notify.weekly} onChange={(x) => patchNotify({ weekly: x })} />
            </Row>
          </Section>

          <Section id="data" title="Dữ liệu & quyền riêng tư">
            <Row title="Kết nối Google Drive, Notion" desc="Lấy tài liệu thẳng vào thư mục, chỉ đọc.">
              <Link to="/library" className="inline-flex items-center gap-1 text-sm font-medium text-mirror">Quản lý kết nối <Icon name="arrowRight" /></Link>
            </Row>
            <Row title="Tải dữ liệu của tôi" desc="Phiên học (kèm Thẻ Gương), tài liệu, thư mục và ghi chú — tệp JSON.">
              <Btn onClick={exportData} disabled={exporting}>{exporting ? "Đang tạo tệp…" : "Tải xuống"}</Btn>
            </Row>
            <Row title="Lịch sử học tập" desc="Xem lại toàn bộ phiên đã học.">
              <Link to="/history" className="inline-flex items-center gap-1 text-sm font-medium text-mirror">Mở lịch sử <Icon name="arrowRight" /></Link>
            </Row>
            <Row title="Xoá lịch sử học tập" desc="Xoá mọi phiên học, giữ lại tài liệu và thư mục. Sẽ hỏi lại trước khi xoá.">
              <Btn variant="danger" onClick={() => setDel("sessions")}>Xoá lịch sử…</Btn>
            </Row>
            <Row title="Xoá toàn bộ dữ liệu" desc="Xoá vĩnh viễn phiên học, tài liệu, thư mục, ghi chú, kết nối và cài đặt. Sẽ hỏi lại trước khi xoá.">
              <Btn variant="danger" onClick={() => setDel("all")}>Xoá dữ liệu…</Btn>
            </Row>
            <p className="pt-4 text-sm"><a href="/privacy.html" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-mirror">Đọc Chính sách quyền riêng tư <Icon name="external" /></a></p>
          </Section>

          <p className="text-center text-sm text-muted">Cần hỗ trợ? <Link to="/help" className="font-medium text-mirror">Xem hướng dẫn sử dụng</Link></p>
        </div>
      </div>

      <Modal open={!!del} title={del === "all" ? "Xoá toàn bộ dữ liệu" : "Xoá lịch sử học tập"} onClose={() => { setDel(null); setConfirmText(""); }}
        footer={<><Btn onClick={() => { setDel(null); setConfirmText(""); }}>Huỷ</Btn><Btn variant="danger" disabled={confirmText.trim().toUpperCase() !== "XOA" || busy} onClick={doDelete}>{busy ? "Đang xoá…" : "Xoá vĩnh viễn"}</Btn></>}>
        <p className="text-sm text-ink">{del === "all" ? "Toàn bộ phiên học, tài liệu, thư mục, kết nối và cài đặt sẽ bị xoá." : "Mọi phiên học và thẻ tổng kết sẽ bị xoá. Tài liệu và thư mục được giữ lại."} Thao tác này không hoàn tác được.</p>
        <label className="mt-4 block text-sm font-medium text-ink">Gõ <b>XOA</b> để xác nhận
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-sheet px-3 py-2 font-normal outline-none focus:border-rust" />
        </label>
      </Modal>
    </div>
  );
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={`set-${id}`} className="panel scroll-mt-6 p-5 sm:p-6">
      <h2 className="font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-3 divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-1 last:pb-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{title}</p><p className="text-xs text-muted">{desc}</p></div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-paper p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${value === o.value ? "bg-sheet font-semibold text-mirror shadow-sm" : "text-muted hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
