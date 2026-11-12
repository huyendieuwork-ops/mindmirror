import type { ReactNode } from "react";
import { Logo, Wordmark } from "../components/Layout";
import { Icon, type IconName } from "../components/ui";
import { signInWithGoogle } from "../lib/supabase";

/** Trang giới thiệu (landing) hiện khi chưa đăng nhập. */
export default function Login() {
  return (
    <div className="landing min-h-full text-ink">
      <header className="sticky top-0 z-20 border-b border-transparent bg-[#F6F9FF]/80 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a href="#top" className="mr-auto flex items-center gap-2">
            <Logo size={36} />
            <Wordmark className="text-xl" />
          </a>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted md:flex">
            <a href="#tinh-nang" className="hover:text-ink">Tính năng</a>
            <a href="#cach-hoat-dong" className="hover:text-ink">Cách hoạt động</a>
            <a href="#hoi-dap" className="hover:text-ink">Hỏi đáp</a>
          </nav>
          <button onClick={signInWithGoogle} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:border-mirror hover:text-mirror">Đăng nhập</button>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="relative overflow-hidden">
        <HeroBackdrop />
        <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pb-20 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:pb-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-mirror/20 bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-mirror shadow-sm">
              <Spark /> Luyện tư duy cùng MindMirror
            </span>
            <h1 className="mt-6 text-[2.5rem] font-extrabold leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.15rem] xl:text-[3.4rem]">
              <span className="sm:whitespace-nowrap">Nói ra điều bạn hiểu.</span><br />
              <span className="text-mirror sm:whitespace-nowrap">Nhìn ra điều còn thiếu.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              MindMirror lắng nghe cách bạn giải thích, đặt câu hỏi phản biện và đối chiếu với chính tài liệu bạn học —
              giúp bạn biết mình đã <b className="font-semibold text-ink">thật sự hiểu</b> tới đâu.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button onClick={signInWithGoogle} className="group inline-flex items-center gap-3 rounded-full bg-mirror py-2 pl-2 pr-6 text-base font-semibold text-white shadow-[0_12px_28px_-12px_rgb(74_134_219/0.9)] transition-transform hover:-translate-y-0.5">
                <GoogleMark />
                Bắt đầu với Google
                <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a href="#tinh-nang" className="group inline-flex items-center gap-2 rounded-full border border-line bg-white px-6 py-3 text-base font-semibold text-ink shadow-sm hover:border-mirror hover:text-mirror">
                Khám phá MindMirror
                <Icon name="arrowRight" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
              <span className="inline-flex items-center gap-2"><Tick /> Miễn phí cho sinh viên</span>
              <span className="inline-flex items-center gap-2"><Tick /> Trích dẫn đúng trang tài liệu</span>
              <span className="inline-flex items-center gap-2"><Tick /> Không truy cập Gmail, Drive</span>
            </div>
          </div>

          <HeroCard />
        </div>
      </section>

      {/* TÍNH NĂNG */}
      <section id="tinh-nang" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
        <SectionTitle kicker="Tính năng" title="Học sâu hơn, không học vẹt" sub="Bốn thói quen của người học giỏi, gói gọn trong một trợ lý." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-white p-6 shadow-[0_10px_30px_-20px_rgb(30_52_92/0.35)] transition-transform hover:-translate-y-1">
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${f.tone}`}><Icon name={f.icon} className="h-5 w-5" /></span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HAI CHẾ ĐỘ */}
      <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
          <Mode icon="check" tone="bg-mist text-mirror" kicker="Kiểm tra kiến thức" title="Giải thích lại — để biết mình hiểu tới đâu"
            text="Nêu chủ đề đã học, nói theo cách của bạn. MindMirror phản biện, chỉ ra chỗ hổng và trích đúng trang giáo trình." quote="“Chuẩn hoá cơ sở dữ liệu: 2NF khác 3NF ở điểm nào?”" />
          <Mode icon="compass" tone="bg-[#F1ECFF] text-[#8B6FE0]" kicker="Khám phá kiến thức" title="Tò mò điều gì — cùng tìm ra câu trả lời"
            text="Đặt câu hỏi bất kỳ. MindMirror dẫn bạn tự suy luận qua từng gợi ý, kèm ví dụ đời thường dễ nhớ." quote="“Vì sao đại dương có màu xanh?”" />
        </div>
      </section>

      {/* CÁCH HOẠT ĐỘNG */}
      <section id="cach-hoat-dong" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20 sm:px-6">
        <SectionTitle kicker="Cách hoạt động" title="Ba bước, mười phút" />
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-2xl border border-line bg-white p-6 pt-8 shadow-[0_10px_30px_-20px_rgb(30_52_92/0.35)]">
              <span className="absolute -top-4 left-6 grid h-9 w-9 place-items-center rounded-full bg-mirror text-sm font-bold text-white shadow-md">{i + 1}</span>
              <h3 className="text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* HỎI ĐÁP */}
      <section id="hoi-dap" className="mx-auto max-w-3xl scroll-mt-16 px-4 py-16 sm:px-6">
        <SectionTitle kicker="Hỏi đáp" title="Câu hỏi thường gặp" />
        <div className="mt-10 space-y-3">
          {FAQ.map((q) => (
            <details key={q.q} className="group rounded-2xl border border-line bg-white px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q.q}
                <span className="text-xl leading-none text-mirror transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{q.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* KÊU GỌI */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] border border-line bg-gradient-to-br from-[#EAF3FF] via-white to-[#E3F0FF] p-8 text-center sm:p-14">
          <Logo size={64} className="float mx-auto" />
          <h2 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">Sẵn sàng soi lại điều mình biết?</h2>
          <p className="mt-3 text-muted">Bắt đầu phiên đầu tiên chỉ với một tài khoản Google.</p>
          <button onClick={signInWithGoogle} className="mt-8 inline-flex items-center gap-3 rounded-full bg-mirror py-2 pl-2 pr-6 text-base font-semibold text-white shadow-[0_12px_28px_-12px_rgb(74_134_219/0.9)] transition-transform hover:-translate-y-0.5">
            <GoogleMark /> Bắt đầu với Google <Icon name="arrowRight" className="h-4 w-4" />
          </button>
        </div>
      </section>

      <footer className="border-t border-line bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted sm:px-6">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex items-center gap-2"><Logo size={24} /><Wordmark /></div>
            <a href="/privacy.html" className="underline decoration-line underline-offset-4 hover:text-ink">Chính sách quyền riêng tư</a>
          </div>
          <div className="mt-6 border-t border-line pt-5 text-center">
            <p className="font-medium text-ink">Sản phẩm của nhóm sinh viên Đại học Kinh tế Quốc dân</p>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-2 gap-y-1">
              {TEAM.map((n, i) => <li key={n} className="whitespace-nowrap">{n}{i < TEAM.length - 1 && <span className="ml-2 text-line" aria-hidden>·</span>}</li>)}
            </ul>
            <p className="mt-3 text-xs">© 2026 MindMirror · Bài tập lớn môn Agentic AI · Sản phẩm học tập, phi thương mại</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const TEAM = ["Hoàng Nhật Quỳnh", "Lê Như Ngọc Mai", "Đặng Thị Huyền Diệu", "Trần Thị Xuân Nhi", "Nguyễn Thị Nhân"];

/* ---------------- Hero ---------------- */
function HeroCard() {
  return (
    <div className="relative mx-auto w-full max-w-[30rem]">
      {/* hình trang trí: vòng tròn, chấm, thẻ nổi */}
      <div className="absolute -right-6 -top-8 h-40 w-40 rounded-full bg-[#CFE4FF] opacity-70 blur-[2px]" aria-hidden />
      <div className="absolute -bottom-10 -left-8 h-32 w-32 rounded-full bg-[#E4DCFF] opacity-70" aria-hidden />
      <Dots className="absolute -left-10 top-10 text-mirror/25" />

      <div className="relative rounded-[1.75rem] border border-white/80 bg-white/90 p-5 shadow-[0_30px_70px_-30px_rgb(30_52_92/0.45)] backdrop-blur sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={40} className="float" />
            <div>
              <p className="text-sm font-semibold">MindMirror</p>
              <p className="flex items-center gap-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-moss" /> Kiểm tra kiến thức · Chuẩn hoá CSDL</p>
            </div>
          </div>
          <span className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold text-mirror">Gợi ý 1/3</span>
        </div>

        <div className="mt-5 space-y-3 text-sm">
          <Bubble who="ai">Bạn thử giải thích 2NF bằng lời của mình xem — một bảng “vi phạm 2NF” trông như thế nào?</Bubble>
          <Bubble who="me">Là khi có cột chỉ phụ thuộc vào một phần của khoá chính ghép ạ.</Bubble>
          <Bubble who="ai">Chính xác! Slide trang 12 có bảng <span className="hl">ĐăngKý(MãSV, MãMH, TênMH)</span>. Cột nào đang vi phạm?</Bubble>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-[#F6F9FF] p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-mirror shadow-sm"><Icon name="chart" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Tổng kết buổi học</p>
            <p className="truncate text-xs text-muted">Tự giải thích 2/3 tiêu chí · nên ôn thêm 3NF</p>
          </div>
          <div className="flex -space-x-1.5">
            <span className="h-3 w-3 rounded-full bg-moss ring-2 ring-white" />
            <span className="h-3 w-3 rounded-full bg-moss ring-2 ring-white" />
            <span className="h-3 w-3 rounded-full bg-[#F0B44C] ring-2 ring-white" />
          </div>
        </div>
      </div>

      {/* thẻ nổi nhỏ */}
      <div className="float absolute -bottom-6 -left-6 hidden items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-xs font-medium shadow-lg sm:flex" style={{ animationDelay: "1.2s" }}>
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#E6F6F0] text-[#2E9F7E]"><Icon name="book" className="h-4 w-4" /></span>
        Trích dẫn: Slide tr.12
      </div>
      <div className="float absolute -right-5 -top-6 hidden items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-xs font-medium shadow-lg sm:flex" style={{ animationDelay: "2.4s" }}>
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#FFF5E0] text-[#D8961E]"><Icon name="bulb" className="h-4 w-4" /></span>
        Câu hỏi gợi mở
      </div>
    </div>
  );
}

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute -top-40 right-[-10%] h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle,rgb(125_196_250/0.35),transparent_65%)]" />
      <div className="absolute -left-40 top-20 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgb(74_134_219/0.14),transparent_65%)]" />
      <svg className="absolute bottom-0 left-0 w-full text-white" viewBox="0 0 1440 120" preserveAspectRatio="none" height="80"><path fill="currentColor" d="M0 80c240 40 480 40 720 10s480-50 720-10v40H0z" /></svg>
    </div>
  );
}

function Mode({ icon, tone, kicker, title, text, quote }: { icon: IconName; tone: string; kicker: string; title: string; text: string; quote: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-7 shadow-[0_10px_30px_-20px_rgb(30_52_92/0.35)]">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${tone}`}><Icon name={icon} className="h-5 w-5" /></span>
        <p className="text-sm font-semibold text-mirror">{kicker}</p>
      </div>
      <h3 className="mt-4 text-2xl font-extrabold tracking-tight">{title}</h3>
      <p className="mt-2 text-muted">{text}</p>
      <p className="mt-4 rounded-xl bg-[#F6F9FF] px-4 py-3 text-sm italic text-muted">{quote}</p>
    </div>
  );
}

const FEATURES: { icon: IconName; tone: string; title: string; text: string }[] = [
  { icon: "chat", tone: "bg-mist text-mirror", title: "Hỏi lại kiểu Socratic", text: "Không đưa đáp án ngay. MindMirror đặt câu hỏi để bạn tự diễn đạt và tự phát hiện chỗ chưa chắc." },
  { icon: "book", tone: "bg-[#E6F6F0] text-[#2E9F7E]", title: "Bám tài liệu của bạn", text: "Tải slide, giáo trình PDF/PPTX vào My Folder — nhận xét luôn kèm trích dẫn đúng trang, không bịa." },
  { icon: "bulb", tone: "bg-[#FFF5E0] text-[#D8961E]", title: "Gợi ý vừa đủ", text: "Gợi ý tăng dần theo 3 mức. Cần đáp án? Chỉ một nút bấm, không ai phán xét." },
  { icon: "chart", tone: "bg-[#F1ECFF] text-[#8B6FE0]", title: "Báo cáo tiến bộ", text: "Thẻ tổng kết mỗi buổi và báo cáo theo tuần: phần đã vững, phần nên ôn lại." },
];

const STEPS = [
  { title: "Chọn chủ đề", text: "Gõ điều bạn muốn học hoặc ôn lại. Có thể chọn một thư mục tài liệu để đối chiếu." },
  { title: "Trò chuyện & giải thích", text: "Trả lời bằng lời của chính bạn. MindMirror hỏi tiếp, gợi ý khi cần và chỉ ra chỗ hổng." },
  { title: "Nhận thẻ tổng kết", text: "Xem mình đã hiểu tới đâu, kèm bằng chứng từ câu trả lời và tài liệu, cùng gợi ý ôn tập." },
];

const FAQ = [
  { q: "MindMirror có làm bài hộ không?", a: "Không. Mục tiêu là giúp bạn tự hiểu. Bạn vẫn có thể xin đáp án bất cứ lúc nào, nhưng MindMirror sẽ ghi nhận đó là phần “sau khi được hỗ trợ”." },
  { q: "Tài liệu của mình có an toàn không?", a: "Chữ trong tài liệu được trích ngay trên trình duyệt và chỉ dùng cho phiên học của bạn. Bạn có thể xoá dữ liệu bất kỳ lúc nào trong Cài đặt." },
  { q: "Có mất phí không?", a: "Miễn phí cho mục đích học tập. Mỗi ngày có giới hạn số lượt để đảm bảo chất lượng cho mọi người." },
];

function SectionTitle({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-mirror">{kicker}</p>
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mx-auto mt-3 max-w-xl text-muted">{sub}</p>}
    </div>
  );
}

function Bubble({ who, children }: { who: "ai" | "me"; children: ReactNode }) {
  return who === "ai" ? (
    <div className="flex items-end gap-2">
      <Logo size={26} className="shrink-0" />
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-[#EEF5FF] px-4 py-2.5 text-ink">{children}</div>
    </div>
  ) : (
    <div className="flex items-end justify-end gap-2">
      <div className="max-w-[78%] rounded-2xl rounded-br-md bg-mirror px-4 py-2.5 text-white">{children}</div>
      <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#FFE3C7] text-[11px] font-bold text-[#B5651D]">B</span>
    </div>
  );
}

function GoogleMark() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-full bg-white">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
    </span>
  );
}
const Tick = () => <span className="grid h-5 w-5 place-items-center rounded-full bg-moss/15 text-moss"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg></span>;
const Spark = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>;
function Dots({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      {Array.from({ length: 36 }, (_, i) => <circle key={i} cx={8 + (i % 6) * 16} cy={8 + Math.floor(i / 6) * 16} r="2.2" fill="currentColor" />)}
    </svg>
  );
}
