import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { pref, setPref, useLearningData } from "../lib/data";
import { Icon, type IconName } from "./ui";

/** Mở lại hướng dẫn từ bất kỳ đâu (Trợ giúp, menu tài khoản): window.dispatchEvent(new Event(OPEN_ONBOARDING)). */
export const OPEN_ONBOARDING = "mm:onboarding";
export const openOnboarding = () => window.dispatchEvent(new Event(OPEN_ONBOARDING));

interface Slide { icon: IconName; kicker: string; title: string; body: ReactNode; art: ReactNode }

const Tip = ({ n, children }: { n: number; children: ReactNode }) => (
  <li className="flex gap-3">
    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mirror/10 text-xs font-bold text-mirror">{n}</span>
    <span className="text-sm leading-relaxed text-ink/85">{children}</span>
  </li>
);
const Chip = ({ children, tone = "bg-white/90 text-ink" }: { children: ReactNode; tone?: string }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-sm ${tone}`}>{children}</span>
);
const Pane = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-2xl bg-white/95 p-3 text-left shadow-lg shadow-black/5 ${className}`}>{children}</div>
);

const SLIDES: Slide[] = [
  {
    icon: "bulb", kicker: "Chào mừng", title: "Nói ra điều bạn hiểu, nhìn ra điều còn thiếu",
    body: (
      <ul className="space-y-3">
        <Tip n={1}>MindMirror là trợ lý học tập: bạn tự trình bày, AI hỏi đúng vào chỗ bạn còn chưa chắc.</Tip>
        <Tip n={2}><b>Không chấm điểm.</b> Kết quả chỉ ghi lại những ý bạn đã tự nói được, kèm câu nguyên văn của bạn.</Tip>
        <Tip n={3}>Có tài liệu, mỗi ý giải thích đều ghi rõ nguồn (tài liệu, số trang) để bạn tự kiểm tra.</Tip>
      </ul>
    ),
    art: (
      <div className="flex flex-col items-center gap-3">
        <img src="/logo-mark.webp" alt="" width={84} height={84} className="drop-shadow-lg" />
        <Pane className="w-60"><p className="text-[11px] font-semibold text-mirror">Bạn</p><p className="text-xs text-ink">Chuẩn 2NF là khi không còn phụ thuộc bắc cầu…</p></Pane>
        <Pane className="ml-10 w-60"><p className="text-[11px] font-semibold text-[#8B6FE0]">MindMirror</p><p className="text-xs text-ink">Bạn thử phân biệt “phụ thuộc một phần” và “bắc cầu” xem? <span className="text-mirror">[tr.44]</span></p></Pane>
      </div>
    ),
  },
  {
    icon: "home", kicker: "Bước 1 · Trang Học", title: "Mở một phiên học trong 10 giây",
    body: (
      <ul className="space-y-3">
        <Tip n={1}>Gõ một chủ đề, một câu hỏi hoặc chỗ bạn đang vướng.</Tip>
        <Tip n={2}>Chọn <b>Kiểm tra hiểu biết</b> (bạn tự trình bày, AI hỏi vào chỗ chưa chắc) hoặc <b>Khám phá</b> (học từ đầu theo dàn ý, có câu kiểm tra nhanh cuối mỗi phần).</Tip>
        <Tip n={3}>Chọn tài liệu nếu có (không bắt buộc) rồi bấm <b>Bắt đầu</b>. Mỗi ngày bạn có 3 phiên học.</Tip>
      </ul>
    ),
    art: (
      <div className="w-72 space-y-2.5">
        <Pane><p className="text-[11px] text-muted">Bạn muốn học hoặc hỏi gì?</p><p className="mt-1 rounded-lg border border-mirror/40 px-2 py-1.5 text-xs text-ink">Phép nối LEFT JOIN khác INNER JOIN thế nào?</p></Pane>
        <div className="grid grid-cols-2 gap-2">
          <Pane className="ring-2 ring-mirror"><Icon name="check" className="h-4 w-4 text-mirror" /><p className="mt-1 text-xs font-semibold text-ink">Kiểm tra hiểu biết</p></Pane>
          <Pane><Icon name="compass" className="h-4 w-4 text-[#8B6FE0]" /><p className="mt-1 text-xs font-semibold text-ink">Khám phá</p></Pane>
        </div>
        <div className="flex justify-end"><Chip tone="bg-mirror text-white">Bắt đầu →</Chip></div>
      </div>
    ),
  },
  {
    icon: "upload", kicker: "Bước 2 · Tài liệu", title: "Tải tài liệu lên — không cần tạo thư mục",
    body: (
      <ul className="space-y-3">
        <Tip n={1}>Vào <b>Thư mục</b> → <b>Tải tài liệu lên</b>: PDF, slide PPTX, ghi chú .txt/.md. Chữ được trích ngay trên trình duyệt.</Tip>
        <Tip n={2}>Tài liệu chưa xếp vào thư mục nào vẫn dùng đầy đủ: học kèm tài liệu, sơ đồ khái niệm, lộ trình.</Tip>
        <Tip n={3}><b>Thư mục</b> chỉ để gom theo môn và đặt <b>mục tiêu học</b> — tạo khi nào bạn thấy cần.</Tip>
      </ul>
    ),
    art: (
      <div className="w-72 space-y-2">
        {[["PDF", "Giáo trình CSDL – Chương 4", "60 trang"], ["PPTX", "Slide Kiểm thử phần mềm", "24 trang"], ["MD", "Ghi chú ôn thi", "3 trang"]].map(([k, t, p]) => (
          <Pane key={t} className="flex items-center gap-3 py-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-mist text-[10px] font-bold text-mirror">{k}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{t}</span><span className="text-[10px] text-muted">{p}</span></span>
            <span className="h-2 w-2 rounded-full bg-moss" />
          </Pane>
        ))}
      </div>
    ),
  },
  {
    icon: "bulb", kicker: "Bước 3 · Sơ đồ & lộ trình", title: "Biến tài liệu thành sơ đồ và lộ trình học",
    body: (
      <ul className="space-y-3">
        <Tip n={1}>Trong <b>Thư mục</b>, chọn một thư mục hoặc <b>Tài liệu chưa xếp thư mục</b>.</Tip>
        <Tip n={2}>Tab <b>Sơ đồ khái niệm</b> → <b>Tạo bản đồ khái niệm</b>: AI đọc từng trang và sắp các ý chính thành mind map. Bấm vào sơ đồ để xem toàn màn hình.</Tip>
        <Tip n={3}>Tab <b>Lộ trình</b>: thứ tự học từng bước theo quan hệ “cần biết trước” có câu trích làm căn cứ.</Tip>
      </ul>
    ),
    art: (
      <svg viewBox="0 0 280 190" className="w-72 drop-shadow-lg" aria-hidden>
        <g stroke="white" strokeOpacity=".8" strokeWidth="2" fill="none">
          <path d="M140 95 C 110 95 100 45 70 45" /><path d="M140 95 C 110 95 100 145 70 145" />
          <path d="M140 95 C 170 95 180 45 210 45" /><path d="M140 95 C 170 95 180 145 210 145" />
        </g>
        <rect x="95" y="78" width="90" height="34" rx="17" fill="white" />
        <text x="140" y="100" textAnchor="middle" fontSize="12" fontWeight="700" fill="#2B3A55">Chuẩn hóa</text>
        {[[20, 30, "Phụ thuộc hàm", "#7DC4FA"], [20, 130, "Dị thường", "#2E9F7E"], [175, 30, "2NF → 3NF", "#8B6FE0"], [175, 130, "BCNF", "#D8961E"]].map(([x, y, t, c]) => (
          <g key={t as string}><rect x={x as number} y={y as number} width="88" height="30" rx="15" fill="white" stroke={c as string} strokeWidth="2" />
            <text x={(x as number) + 44} y={(y as number) + 19} textAnchor="middle" fontSize="10.5" fill="#2B3A55">{t}</text></g>
        ))}
      </svg>
    ),
  },
  {
    icon: "chart", kicker: "Bước 4 · Kết quả", title: "Thẻ Gương sau mỗi phiên, tiến độ theo thời gian",
    body: (
      <ul className="space-y-3">
        <Tip n={1}>Kết thúc phiên, <b>Thẻ Gương</b> cho bạn thấy: ý đã nói được, ý còn bỏ ngỏ, và bước nên học tiếp.</Tip>
        <Tip n={2}>Trang <b>Tiến độ</b> gom các phiên theo chủ đề; lộ trình tự đánh dấu “Đã nắm vững / Cần ôn lại”.</Tip>
        <Tip n={3}>Cần giúp? Mở <b>Trợ giúp</b> ở góc dưới thanh bên — có ô tìm kiếm và nút xem lại hướng dẫn này.</Tip>
      </ul>
    ),
    art: (
      <Pane className="w-72 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-mirror">Thẻ Gương</p>
        <p className="mt-1 text-sm font-bold text-ink">Dạng chuẩn 2 (2NF)</p>
        <div className="mt-3 space-y-2 text-xs">
          <p className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-moss" /><span>Đã nói được: 2NF cần đạt 1NF trước</span></p>
          <p className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#E0A526]" /><span>Còn bỏ ngỏ: phụ thuộc một phần vào khoá</span></p>
          <p className="flex gap-2"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-mirror" /><span>Bước tiếp: ôn “Phụ thuộc hàm đầy đủ”</span></p>
        </div>
      </Pane>
    ),
  },
];

/**
 * Hướng dẫn nhanh cho người mới: tự mở một lần khi tài khoản chưa có phiên học nào (đánh dấu theo tài khoản trong trình duyệt),
 * mở lại được từ Trợ giúp / menu tài khoản. Không gọi API, không thay đổi dữ liệu.
 */
export default function Onboarding({ userKey }: { userKey: string }) {
  const { sessions, loading } = useLearningData();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const seenKey = `onboarded:${userKey}`;

  useEffect(() => {
    if (!loading && sessions.length === 0 && !pref<boolean>(seenKey, false)) { setI(0); setOpen(true); }
  }, [loading, sessions.length, seenKey]);
  useEffect(() => {
    const h = () => { setI(0); setOpen(true); };
    window.addEventListener(OPEN_ONBOARDING, h);
    return () => window.removeEventListener(OPEN_ONBOARDING, h);
  }, []);
  const close = useCallback(() => { setPref(seenKey, true); setOpen(false); }, [seenKey]);
  const last = i === SLIDES.length; // trang cuối = "Sẵn sàng"
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((x) => Math.min(SLIDES.length, x + 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);
  if (!open) return null;

  const go = (path: string) => { close(); nav(path); };
  const s = SLIDES[i];

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label="Hướng dẫn sử dụng MindMirror">
      <style>{`@keyframes mmOnb { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } .mm-onb { animation: mmOnb .3s ease-out both; }`}</style>
      <div className="relative flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-sheet shadow-2xl md:flex-row">
        <button onClick={close} className="absolute right-3 top-3 z-10 rounded-lg p-2 text-muted hover:bg-mist hover:text-ink md:text-white/90 md:hover:bg-white/15 md:hover:text-white" aria-label="Đóng hướng dẫn">
          <Icon name="x" />
        </button>

        {/* Minh hoạ */}
        <div className="relative hidden w-[46%] shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-mirror via-[#5f97e3] to-skyish p-8 md:flex">
          <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-white/10" />
          <div key={i} className="mm-onb relative">
            {s ? s.art : (
              <div className="flex flex-col items-center gap-3 text-white">
                <img src="/logo-mark.webp" alt="" width={96} height={96} className="drop-shadow-lg" />
                <div className="flex flex-wrap justify-center gap-2"><Chip>Học</Chip><Chip>Thư mục</Chip><Chip>Tiến độ</Chip><Chip>Cài đặt</Chip></div>
              </div>
            )}
          </div>
        </div>

        {/* Nội dung */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-7 sm:px-9 sm:pt-9">
            <div key={i} className="mm-onb">
              {s ? (
                <>
                  <span className="inline-flex items-center gap-2 rounded-full bg-mist px-3 py-1 text-xs font-semibold text-mirror"><Icon name={s.icon} className="h-3.5 w-3.5" /> {s.kicker}</span>
                  <h2 className="mt-3 text-2xl font-bold leading-tight text-ink sm:text-[1.7rem]">{s.title}</h2>
                  <div className="mt-5">{s.body}</div>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-2 rounded-full bg-[#E6F6F0] px-3 py-1 text-xs font-semibold text-[#2E9F7E]">✓ Sẵn sàng</span>
                  <h2 className="mt-3 text-2xl font-bold leading-tight text-ink sm:text-[1.7rem]">Bạn muốn bắt đầu từ đâu?</h2>
                  <div className="mt-5 grid gap-3">
                    <button onClick={() => go("/")} className="group flex items-center gap-4 rounded-2xl border border-mirror/40 bg-mist/40 p-4 text-left hover:border-mirror">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mirror text-white"><Icon name="chat" className="h-5 w-5" /></span>
                      <span className="flex-1"><span className="block font-semibold text-ink">Mở phiên học đầu tiên</span><span className="text-sm text-muted">Gõ một chủ đề bất kỳ — không cần tài liệu.</span></span>
                      <Icon name="arrowRight" className="h-5 w-5 text-mirror transition group-hover:translate-x-0.5" />
                    </button>
                    <button onClick={() => go("/folders")} className="group flex items-center gap-4 rounded-2xl border border-line p-4 text-left hover:border-mirror/60">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#E6F6F0] text-[#2E9F7E]"><Icon name="upload" className="h-5 w-5" /></span>
                      <span className="flex-1"><span className="block font-semibold text-ink">Tải tài liệu lên</span><span className="text-sm text-muted">Rồi tạo sơ đồ khái niệm và lộ trình học.</span></span>
                      <Icon name="arrowRight" className="h-5 w-5 text-muted transition group-hover:translate-x-0.5" />
                    </button>
                  </div>
                  <p className="mt-4 text-xs text-muted">Xem lại hướng dẫn này bất cứ lúc nào: <b>Trợ giúp</b> → <b>Xem hướng dẫn nhanh</b>.</p>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-line px-6 py-4 sm:px-9">
            <div className="flex min-w-0 flex-1 gap-1 sm:gap-1.5" aria-label={`Trang ${i + 1}/${SLIDES.length + 1}`}>
              {Array.from({ length: SLIDES.length + 1 }, (_, k) => (
                <button key={k} onClick={() => setI(k)} aria-label={`Tới trang ${k + 1}`}
                  className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-mirror" : k < i ? "w-2 bg-mirror/40" : "w-2 bg-line"}`} />
              ))}
            </div>
            {!last && <button onClick={close} className={`whitespace-nowrap text-sm text-muted hover:text-ink ${i > 0 ? "hidden sm:inline" : ""}`}>Bỏ qua</button>}
            {i > 0 && <button onClick={() => setI(i - 1)} className="whitespace-nowrap rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink hover:border-mirror/60">Quay lại</button>}
            {!last
              ? <button onClick={() => setI(i + 1)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-mirror px-5 py-2 text-sm font-semibold text-white hover:bg-mirror/90">{i === 0 ? "Xem nhanh" : "Tiếp"} <Icon name="arrowRight" /></button>
              : <button onClick={close} className="rounded-xl bg-ink px-5 py-2 text-sm font-semibold text-paper hover:bg-ink/90">Đóng</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
