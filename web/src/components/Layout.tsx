import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { supabase, signOut } from "../lib/supabase";

type IconName = "plus" | "book" | "clock" | "gear" | "logout";

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...p}>
      {name === "plus" && <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>}
      {name === "book" && <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>}
      {name === "clock" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
      {name === "gear" && <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>}
      {name === "logout" && <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>}
    </svg>
  );
}

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Phiên mới", icon: "plus", end: true },
  { to: "/library", label: "Tài liệu", icon: "book" },
  { to: "/history", label: "Lịch sử", icon: "clock" },
  { to: "/settings", label: "Cài đặt", icon: "gear" },
];

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "bg-mist text-mirror" : "text-muted hover:text-ink hover:bg-mist/60"
  }`;

export default function Layout({ children, email }: { children: ReactNode; email: string | null }) {
  const initial = (email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-20 bg-sheet/80 backdrop-blur-md border-b border-line" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
          <NavLink to="/" className="flex items-center gap-2 mr-auto shrink-0" aria-label="MindMirror — trang chính">
            <Logo size={32} />
            <Wordmark className="hidden sm:inline text-lg" />
          </NavLink>
          <nav className="flex items-center gap-1 overflow-x-auto -mr-1 pr-1" aria-label="Điều hướng chính">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link} title={n.label}>
                <Icon name={n.icon} />
                <span className="hidden md:inline">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          {supabase ? (
            <div className="flex items-center gap-2 pl-2 border-l border-line">
              <span className="hidden sm:grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-skyish to-mirror text-white text-sm font-semibold" title={email ?? ""}>{initial}</span>
              <button onClick={signOut} className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-sm text-muted hover:text-ink hover:bg-mist/60" title="Đăng xuất">
                <Icon name="logout" />
                <span className="hidden lg:inline">Đăng xuất</span>
              </button>
            </div>
          ) : (
            <span className="hidden sm:block text-xs text-muted border border-line rounded-full px-2 py-0.5" title="Chưa cấu hình Supabase — đăng nhập giả lập">Chế độ thử</span>
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

/** Logo hình ảnh (web/public/logo-mark.webp). */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return <img src="/logo-mark.webp" width={size} height={size} alt="" className={`select-none ${className}`} draggable={false} />;
}

/** Chữ "MindMirror" hai màu như logo. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-serif font-extrabold tracking-tight ${className}`}>
      <span className="wordmark-a">Mind</span><span className="wordmark-b">Mirror</span>
    </span>
  );
}

/** Giữ tương thích với chỗ cũ còn dùng <Mark />. */
export function Mark({ size = 18 }: { size?: number }) {
  return <Logo size={Math.round(size * 1.4)} />;
}
