import type { ReactNode } from "react";
import { Logo, Wordmark } from "../components/Layout";
import { signInWithGoogle } from "../lib/supabase";

/** Trang giới thiệu (landing) hiện khi chưa đăng nhập. */
export default function Login() {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 bg-paper/70 backdrop-blur-md" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4">
          <a href="#top" className="flex items-center gap-2 mr-auto">
            <Logo size={36} />
            <Wordmark className="text-xl" />
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted">
            <a href="#tinh-nang" className="hover:text-ink">Tính năng</a>
            <a href="#cach-hoat-dong" className="hover:text-ink">Cách hoạt động</a>
            <a href="#hoi-dap" className="hover:text-ink">Hỏi đáp</a>
          </nav>
          <button onClick={signInWithGoogle} className="btn-soft text-sm">Đăng nhập</button>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:pt-16 sm:pb-24 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-mist text-mirror text-xs font-semibold px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-mirror" /> Trợ lý học tập AI kiểu Socratic
          </span>
          <h1 className="mt-5 font-serif font-extrabold text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.1] tracking-tight">
            Nói ra điều cậu nghĩ.<br />
            <span className="bg-gradient-to-r from-mirror to-skyish bg-clip-text text-transparent">Rồi cùng soi lại.</span>
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed max-w-xl">
            MindMirror không giảng bài thay cậu. Nó hỏi lại, gợi ý vừa đủ và đối chiếu với chính tài liệu cậu học — để cậu biết mình
            đã <b className="text-ink">hiểu</b> tới đâu, chứ không chỉ thấy “nghe quen”.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <GoogleButton />
            <a href="#cach-hoat-dong" className="btn-soft">Xem cách hoạt động</a>
          </div>
          <p className="mt-4 text-xs text-muted">Miễn phí · Đăng nhập bằng Google · Chỉ dùng tên và email, không truy cập Gmail hay Drive.</p>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-mist via-sheet to-marker/50 blur-2xl opacity-80" aria-hidden />
          <div className="relative card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <Logo size={40} className="float" />
              <div>
                <p className="font-semibold text-sm">MindMirror</p>
                <p className="text-xs text-muted">Hiểu lại · Dạng chuẩn 2 (2NF)</p>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <Bubble who="ai">Cậu thử giải thích 2NF bằng lời của mình xem — một bảng “vi phạm 2NF” trông như thế nào?</Bubble>
              <Bubble who="me">Là khi có cột chỉ phụ thuộc vào một phần của khoá chính ghép ạ.</Bubble>
              <Bubble who="ai">Chuẩn rồi! Trong slide trang 12 có bảng <span className="hl">ĐăngKý(MãSV, MãMH, TênMH)</span>. Cột nào đang vi phạm?</Bubble>
            </div>
            <div className="mt-5 rounded-xl bg-mist p-3 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-sheet text-mirror font-bold">✓</span>
              <div className="text-xs">
                <p className="font-semibold text-ink">Thẻ Gương Hiểu Biết</p>
                <p className="text-muted">Tự giải thích được 2/3 tiêu chí · cần luyện thêm 3NF</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TÍNH NĂNG */}
      <section id="tinh-nang" className="mx-auto max-w-6xl px-4 py-16 scroll-mt-16">
        <SectionTitle kicker="Tính năng" title="Học sâu hơn, không học vẹt" />
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6 hover:-translate-y-1 transition-transform">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-mist text-2xl">{f.emoji}</span>
              <h3 className="mt-4 font-serif font-bold text-lg">{f.title}</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HAI CHẾ ĐỘ */}
      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid md:grid-cols-2 gap-5">
          <div className="card p-7 bg-gradient-to-br from-sheet to-mist/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-mirror">Chế độ 1</p>
            <h3 className="mt-2 font-serif font-extrabold text-2xl">Khám phá kiến thức</h3>
            <p className="mt-2 text-muted">Có điều gì đang tò mò? MindMirror dẫn cậu tự tìm ra câu trả lời qua từng câu hỏi gợi mở.</p>
            <p className="mt-4 text-sm italic text-muted">“Vì sao đại dương có màu xanh?”</p>
          </div>
          <div className="card p-7 bg-gradient-to-br from-sheet to-marker/40">
            <p className="text-xs font-semibold uppercase tracking-wider text-mirror">Chế độ 2</p>
            <h3 className="mt-2 font-serif font-extrabold text-2xl">Hiểu lại kiến thức</h3>
            <p className="mt-2 text-muted">Phần đã học mà còn vướng? Giải thích lại bằng lời của cậu, MindMirror chỉ ra chỗ hổng kèm trích dẫn tài liệu.</p>
            <p className="mt-4 text-sm italic text-muted">“Dạng chuẩn 2 (2NF) trong cơ sở dữ liệu”</p>
          </div>
        </div>
      </section>

      {/* CÁCH HOẠT ĐỘNG */}
      <section id="cach-hoat-dong" className="mx-auto max-w-6xl px-4 py-16 scroll-mt-16">
        <SectionTitle kicker="Cách hoạt động" title="Ba bước, mười phút" />
        <ol className="mt-10 grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card p-6 relative">
              <span className="absolute -top-4 left-6 grid h-9 w-9 place-items-center rounded-full btn-primary !p-0 text-sm">{i + 1}</span>
              <h3 className="mt-3 font-serif font-bold text-lg">{s.title}</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* HỎI ĐÁP */}
      <section id="hoi-dap" className="mx-auto max-w-3xl px-4 py-16 scroll-mt-16">
        <SectionTitle kicker="Hỏi đáp" title="Câu hỏi thường gặp" />
        <div className="mt-8 space-y-3">
          {FAQ.map((q) => (
            <details key={q.q} className="card px-5 py-4 group">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-semibold">
                {q.q}
                <span className="text-mirror transition-transform group-open:rotate-45 text-xl leading-none">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted leading-relaxed">{q.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* KÊU GỌI */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="rounded-3xl p-8 sm:p-12 text-center bg-gradient-to-br from-mist via-sheet to-marker/60 border border-line">
          <Logo size={64} className="mx-auto float" />
          <h2 className="mt-4 font-serif font-extrabold text-3xl sm:text-4xl">Sẵn sàng soi lại điều mình biết?</h2>
          <p className="mt-3 text-muted">Bắt đầu phiên đầu tiên chỉ với một tài khoản Google.</p>
          <div className="mt-7 flex justify-center"><GoogleButton /></div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted">
          <div className="flex items-center gap-2"><Logo size={24} /><Wordmark /></div>
          <p>Bài tập lớn môn Agentic AI · © 2026</p>
          <a href="/privacy.html" className="hover:text-ink underline underline-offset-4 decoration-line">Chính sách quyền riêng tư</a>
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  { emoji: "💬", title: "Hỏi lại kiểu Socratic", text: "Không đưa đáp án ngay. MindMirror đặt câu hỏi để cậu tự diễn đạt và tự phát hiện chỗ chưa chắc." },
  { emoji: "📚", title: "Bám tài liệu của cậu", text: "Tải slide, giáo trình PDF/PPTX — mọi nhận xét đều kèm trích dẫn đúng trang, không bịa." },
  { emoji: "💡", title: "Gợi ý vừa đủ", text: "Gợi ý tăng dần theo 3 mức. Cần đáp án? Chỉ một nút bấm, không ai phán xét." },
  { emoji: "🪞", title: "Thẻ Gương Hiểu Biết", text: "Cuối phiên nhận thẻ tổng kết: phần tự làm được, phần cần hỗ trợ, phần nên luyện thêm." },
];

const STEPS = [
  { title: "Chọn chủ đề", text: "Gõ điều cậu muốn học hoặc ôn lại. Có thể đính kèm tài liệu để đối chiếu." },
  { title: "Trò chuyện & giải thích", text: "Trả lời bằng lời của chính cậu. MindMirror hỏi tiếp, gợi ý khi cần và chỉ ra chỗ hổng." },
  { title: "Nhận thẻ tổng kết", text: "Xem mình đã hiểu tới đâu, kèm bằng chứng từ chính câu trả lời và tài liệu." },
];

const FAQ = [
  { q: "MindMirror có làm bài hộ không?", a: "Không. Mục tiêu là giúp cậu tự hiểu. Cậu vẫn có thể xin đáp án bất cứ lúc nào, nhưng MindMirror sẽ ghi nhận đó là phần “sau khi được hỗ trợ”." },
  { q: "Tài liệu của mình có an toàn không?", a: "Chữ trong tài liệu được trích ngay trên trình duyệt và chỉ dùng cho phiên học của cậu. Cậu có thể xoá dữ liệu bất kỳ lúc nào trong Cài đặt." },
  { q: "Có mất phí không?", a: "Miễn phí cho mục đích học tập. Mỗi ngày có giới hạn số phiên để đảm bảo chất lượng cho mọi người." },
];

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-mirror">{kicker}</p>
      <h2 className="mt-2 font-serif font-extrabold text-3xl sm:text-4xl tracking-tight">{title}</h2>
    </div>
  );
}

function Bubble({ who, children }: { who: "ai" | "me"; children: ReactNode }) {
  return who === "ai" ? (
    <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-mist px-4 py-2.5 text-ink">{children}</div>
  ) : (
    <div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-gradient-to-br from-[#5FA3F0] to-[#3F7AD4] px-4 py-2.5 text-white">{children}</div>
  );
}

function GoogleButton() {
  return (
    <button onClick={signInWithGoogle} className="btn-primary text-base">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      </span>
      Bắt đầu với Google
    </button>
  );
}
