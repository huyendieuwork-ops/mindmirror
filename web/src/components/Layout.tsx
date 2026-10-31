import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { supabase, signOut } from "../lib/supabase";

const link = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap px-2 py-1 rounded-md text-sm ${isActive ? "text-ink font-semibold" : "text-muted hover:text-ink"}`;

export default function Layout({ children, email }: { children: ReactNode; email: string | null }) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-2 sm:gap-4">
          <NavLink to="/" className="flex items-baseline gap-2 mr-auto">
            <Mark />
            <span className="hidden sm:inline font-serif text-lg font-semibold tracking-tight">MindMirror</span>
          </NavLink>
          <nav className="flex items-center gap-1 overflow-x-auto">
            <NavLink to="/" end className={link}>Phiên mới</NavLink>
            <NavLink to="/library" className={link}>Tài liệu</NavLink>
            <NavLink to="/history" className={link}>Lịch sử</NavLink>
            <NavLink to="/settings" className={link}>Cài đặt</NavLink>
          </nav>
          {supabase ? (
            <button onClick={signOut} className="hidden sm:block text-sm text-muted hover:text-ink" title={email ?? ""}>Đăng xuất</button>
          ) : (
            <span className="hidden sm:block text-xs text-muted border border-line rounded px-2 py-0.5" title="Chưa cấu hình Supabase — đăng nhập giả lập">Chế độ thử</span>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

/** Logo: hai nửa vòng tròn đối xứng — hình ảnh "soi lại" chính mình. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="translate-y-[2px]">
      <path d="M10 2a8 8 0 0 0 0 16z" fill="rgb(var(--ink))" />
      <path d="M10 2a8 8 0 0 1 0 16z" fill="rgb(var(--mirror))" opacity=".55" />
    </svg>
  );
}
