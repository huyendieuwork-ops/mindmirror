import { Mark } from "../components/Layout";
import { signInWithGoogle } from "../lib/supabase";

export default function Login() {
  return (
    <div className="min-h-full grid place-items-center px-6">
      <div className="max-w-md">
        <Mark size={36} />
        <h1 className="mt-6 font-serif text-4xl leading-tight">Nói ra điều cậu nghĩ.<br />Rồi cùng soi lại.</h1>
        <p className="mt-4 text-muted leading-relaxed">
          MindMirror hỏi lại, gợi ý vừa đủ và đối chiếu với chính tài liệu của cậu — để cậu biết mình đã hiểu tới đâu, không phải chỉ thấy "nghe quen".
        </p>
        <button onClick={signInWithGoogle} className="mt-8 inline-flex items-center gap-3 rounded-lg bg-ink text-paper px-5 py-3 font-medium hover:opacity-90">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Đăng nhập bằng Google
        </button>
        <p className="mt-4 text-xs text-muted">MindMirror chỉ dùng tên và email để lưu phiên học của cậu; không truy cập Gmail hay Drive.</p>
      </div>
    </div>
  );
}
