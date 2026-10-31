import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, explain, type Settings } from "../lib/api";
import { invalidate, pref, setPref } from "../lib/data";
import { saveTheme, type Theme } from "../lib/theme";
import { signOut } from "../lib/supabase";
import type { UserInfo } from "../components/Layout";
import { Avatar, Btn, Card, Icon, Modal, PageHeader, SelectBox, Toggle, type IconName } from "../components/ui";

const DEFAULT: Settings = { aiStyle: "friendly", supportPreference: "socratic_first", challengeLevel: "balanced", selfAssessment: true };
export interface NotifyPrefs { gaps: boolean; unfinished: boolean; weekly: boolean }
export const NOTIFY_DEFAULT: NotifyPrefs = { gaps: true, unfinished: true, weekly: true };

export default function SettingsPage({ user }: { user: UserInfo }) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(pref<Theme>("theme", "light"));
  const [notify, setNotify] = useState<NotifyPrefs>({ ...NOTIFY_DEFAULT, ...pref<Partial<NotifyPrefs>>("notify", {}) });
  const [del, setDel] = useState<null | "sessions" | "all">(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.settings().then(setS).catch((e) => { setError(explain(e)); setS(DEFAULT); }); }, []);
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

  const v = s ?? DEFAULT;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Cài đặt" subtitle="Tuỳ chỉnh cách MindMirror trò chuyện, hỗ trợ và nhắc bạn học." actions={
        saved ? <span className="inline-flex items-center gap-1.5 rounded-full bg-moss/10 px-3 py-1.5 text-sm font-medium text-moss"><Icon name="check" /> {saved}</span> : null
      } />
      {error && <p className="rounded-lg bg-rust/10 px-4 py-2.5 text-sm text-rust">{error}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Trợ lý học tập" subtitle="Áp dụng cho các phiên mới và lượt trả lời tiếp theo">
            <div className="divide-y divide-line">
              <Row icon="chat" title="Phong cách trả lời" desc="Độ dài và giọng điệu của MindMirror.">
                <SelectBox label="Phong cách trả lời" value={v.aiStyle} disabled={!s} onChange={(x) => patch({ aiStyle: x })} className="w-44"
                  options={[{ value: "concise", label: "Ngắn gọn" }, { value: "friendly", label: "Vừa phải" }, { value: "academic", label: "Học thuật" }]} />
              </Row>
              <Row icon="chart" title="Mức độ thử thách" desc="Câu hỏi phản biện nhẹ nhàng hay đào sâu.">
                <SelectBox label="Mức độ thử thách" value={v.challengeLevel} disabled={!s} onChange={(x) => patch({ challengeLevel: x })} className="w-44"
                  options={[{ value: "gentle", label: "Nhẹ nhàng" }, { value: "balanced", label: "Cân bằng" }, { value: "deep", label: "Đào sâu" }]} />
              </Row>
              <Row icon="bulb" title="Ưu tiên tự suy nghĩ" desc="Bật: hỏi gợi mở trước khi giải thích. Tắt: linh hoạt đưa giải thích khi bạn cần.">
                <Toggle label="Ưu tiên tự suy nghĩ" disabled={!s} checked={v.supportPreference === "socratic_first"} onChange={(on) => patch({ supportPreference: on ? "socratic_first" : "flexible" })} />
              </Row>
              <Row icon="user" title="Tự đánh giá trước phiên" desc="Hỏi bạn thấy mình đang ở mức nào trước khi Kiểm tra kiến thức.">
                <Toggle label="Tự đánh giá trước phiên" disabled={!s} checked={v.selfAssessment} onChange={(on) => patch({ selfAssessment: on })} />
              </Row>
              <Row icon="book" title="Ngôn ngữ" desc="Ngôn ngữ giao diện và trò chuyện.">
                <SelectBox label="Ngôn ngữ" value="vi" disabled onChange={() => {}} className="w-44" options={[{ value: "vi", label: "Tiếng Việt" }]} />
              </Row>
            </div>
          </Card>

          <Card title="Thông báo" subtitle="Hiển thị ở biểu tượng chuông trên thanh công cụ">
            <div className="divide-y divide-line">
              <Row icon="bulb" title="Kiến thức cần củng cố" desc="Nhắc khi một phiên còn khái niệm chưa rõ.">
                <Toggle label="Kiến thức cần củng cố" checked={notify.gaps} onChange={(x) => patchNotify({ gaps: x })} />
              </Row>
              <Row icon="clock" title="Phiên học dang dở" desc="Nhắc quay lại phiên chưa kết thúc sau 1 ngày.">
                <Toggle label="Phiên học dang dở" checked={notify.unfinished} onChange={(x) => patchNotify({ unfinished: x })} />
              </Row>
              <Row icon="chart" title="Báo cáo hằng tuần" desc="Tóm tắt số phiên học trong 7 ngày qua.">
                <Toggle label="Báo cáo hằng tuần" checked={notify.weekly} onChange={(x) => patchNotify({ weekly: x })} />
              </Row>
            </div>
          </Card>

          <Card title="Giao diện">
            <Row icon="panel" title="Chủ đề màu" desc="Sáng, tối hoặc theo hệ thống." first>
              <SelectBox label="Chủ đề màu" value={theme} onChange={(t) => { setTheme(t); saveTheme(t); }} className="w-44"
                options={[{ value: "light", label: "Sáng" }, { value: "dark", label: "Tối" }, { value: "system", label: "Theo hệ thống" }]} />
            </Row>
          </Card>

          <Card title="Dữ liệu & quyền riêng tư">
            <div className="divide-y divide-line">
              <Row icon="clock" title="Lịch sử học tập" desc="Xem lại toàn bộ phiên đã học.">
                <Link to="/history" className="inline-flex items-center gap-1 text-sm font-medium text-mirror">Mở lịch sử <Icon name="arrowRight" /></Link>
              </Row>
              <Row icon="trash" title="Xoá lịch sử học tập" desc="Xoá mọi phiên học, giữ lại tài liệu và thư mục.">
                <Btn variant="danger" onClick={() => setDel("sessions")}>Xoá lịch sử</Btn>
              </Row>
              <Row icon="lock" title="Xoá toàn bộ dữ liệu" desc="Xoá phiên học, tài liệu, thư mục, kết nối và cài đặt.">
                <Btn variant="danger" onClick={() => setDel("all")}>Xoá tất cả</Btn>
              </Row>
              <Row icon="external" title="Chính sách quyền riêng tư" desc="Cách MindMirror dùng dữ liệu của bạn.">
                <a href="/privacy.html" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-mirror">Xem <Icon name="external" /></a>
              </Row>
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <section className="panel p-5 text-center">
            <div className="flex justify-center"><Avatar name={user.name} src={user.avatar} size={72} /></div>
            <p className="mt-3 font-semibold text-ink">{user.name}</p>
            {user.email && <p className="text-sm text-muted">{user.email}</p>}
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-mist px-3 py-1 text-xs font-medium text-mirror"><Icon name="lock" className="h-3.5 w-3.5" /> Đăng nhập bằng Google</p>
            <Btn className="mt-5 w-full" onClick={() => signOut()}><Icon name="logout" /> Đăng xuất</Btn>
          </section>
          <section className="panel bg-mist/40 p-5">
            <p className="font-semibold text-ink">Cần hỗ trợ?</p>
            <p className="mt-1 text-sm text-muted">Xem hướng dẫn sử dụng và câu hỏi thường gặp.</p>
            <Link to="/help" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-mirror">Trợ giúp & phản hồi <Icon name="arrowRight" /></Link>
          </section>
        </aside>
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

function Row({ icon, title, desc, children, first }: { icon: IconName; title: string; desc: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center ${first ? "pt-0" : ""} first:pt-0 last:pb-0`}>
      <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-mist text-mirror sm:grid"><Icon name={icon} /></span>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{title}</p><p className="text-xs text-muted">{desc}</p></div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
