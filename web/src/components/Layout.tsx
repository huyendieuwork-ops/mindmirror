import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase, signOut } from "../lib/supabase";
import { buildNotices, pref, setPref, useLearningData, MODE_PAGE, sessionPath } from "../lib/data";
import { Avatar, Icon, timeAgo, fmtDate, type IconName } from "./ui";
import Onboarding, { openOnboarding } from "./Onboarding";
import Mascot from "./Mascot";

export interface UserInfo { name: string; email: string | null; avatar: string | null }

/** 4 mục chính; "match" quyết định mục nào sáng (vd phiên học /check/:id vẫn thuộc "Học"). */
const NAV: { to: string; label: string; icon: IconName; match: RegExp }[] = [
  { to: "/", label: "Học", icon: "home", match: /^\/($|check|explore|s\/)/ },
  { to: "/folders", label: "Thư mục", icon: "folder", match: /^\/(folders|library)/ },
  { to: "/reports", label: "Tiến độ", icon: "chart", match: /^\/(reports|history)/ },
  { to: "/settings", label: "Cài đặt", icon: "gear", match: /^\/settings/ },
];

const CRUMB: [RegExp, string][] = [
  [/^\/$/, "Bắt đầu học"], [/^\/check/, "Kiểm tra hiểu biết"], [/^\/explore/, "Khám phá"], [/^\/folders/, "Thư mục"],
  [/^\/reports/, "Tiến độ"], [/^\/settings/, "Cài đặt"], [/^\/history/, "Lịch sử học tập"], [/^\/library/, "Thư viện tài liệu"],
  [/^\/help/, "Trung tâm trợ giúp"], [/^\/s\//, "Phiên học"],
];

export default function Layout({ children, user }: { children: ReactNode; user: UserInfo }) {
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => pref<boolean>("nav-collapsed", false));
  const toggleNav = () => setCollapsed((c) => { setPref("nav-collapsed", !c); return !c; });
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const crumb = CRUMB.find(([r]) => r.test(loc.pathname))?.[1] ?? "";

  return (
    <div className="min-h-full bg-paper">
      {/* Sidebar */}
      {/* Thanh bên: mở rộng (w-64) hoặc thu gọn chỉ còn biểu tượng (w-[76px]) trên màn hình lớn; trên điện thoại là ngăn kéo. */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-sheet transition-[transform,width] duration-200 lg:translate-x-0 ${collapsed ? "lg:w-[76px]" : ""} ${drawer ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}>
        <div className={`flex items-center gap-2.5 pt-6 pb-8 ${collapsed ? "px-6 lg:flex-col lg:px-0" : "px-5"}`}>
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5" aria-label="MindMirror – về trang chủ">
            <img src="/logo-mark.webp" alt="" width={36} height={36} className="shrink-0" />
            <AppWordmark className={`text-[1.3rem] ${collapsed ? "lg:hidden" : ""}`} />
          </Link>
          <button onClick={toggleNav} className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-mirror/50 hover:text-ink lg:grid"
            aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} aria-expanded={!collapsed} title={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}>
            <Icon name="panel" className={`h-[18px] w-[18px] ${collapsed ? "" : "rotate-180"}`} />
          </button>
        </div>
        <nav className={`flex-1 space-y-1 ${collapsed ? "px-3 lg:px-2.5" : "px-3"}`} aria-label="Điều hướng chính">
          {NAV.map((n) => {
            const active = n.match.test(loc.pathname);
            return (
              <Link key={n.to} to={n.to} aria-current={active ? "page" : undefined} title={collapsed ? n.label : undefined}
                className={`relative flex items-center gap-3 rounded-xl py-2.5 text-[0.94rem] transition-colors ${collapsed ? "px-4 lg:justify-center lg:px-0" : "px-4"} ${active ? "bg-mist font-semibold text-mirror before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-mirror" : "text-ink/75 hover:bg-mist/60 hover:text-ink"}`}>
                <Icon name={n.icon} className="h-5 w-5 shrink-0" />
                <span className={collapsed ? "lg:sr-only" : ""}>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <Link to="/help" title={collapsed ? "Trợ giúp" : undefined} className={`mb-4 mt-4 flex items-center gap-3 border-t border-line pt-4 text-left ${collapsed ? "mx-3 px-3 lg:mx-2.5 lg:justify-center lg:px-0" : "mx-3 px-3"}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper text-muted"><Icon name="help" /></span>
          <span className={collapsed ? "lg:sr-only" : ""}><span className="block text-sm font-semibold text-ink">Trợ giúp</span><span className="block text-xs text-muted">Hướng dẫn sử dụng</span></span>
        </Link>
      </aside>
      {drawer && <div className="fixed inset-0 z-30 bg-ink/20 lg:hidden" onClick={() => setDrawer(false)} />}

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[76px]" : "lg:pl-64"}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 border-b border-line bg-sheet/90 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div className="flex h-16 items-center gap-3 px-4 sm:px-8">
            <button className="rounded-lg p-2 text-muted hover:bg-mist lg:hidden" onClick={() => setDrawer(true)} aria-label="Mở menu"><Icon name="menu" className="h-5 w-5" /></button>
            <p className="hidden min-w-0 truncate text-sm font-semibold text-ink sm:block">{crumb}</p>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <button onClick={() => setPalette(true)} className="flex h-10 w-10 items-center justify-center gap-2 rounded-xl border border-line bg-paper/60 text-sm text-muted hover:border-mirror/50 md:w-72 md:justify-start md:px-3" aria-label="Tìm kiếm">
                <Icon name="search" />
                <span className="hidden flex-1 text-left md:block">Tìm kiếm chủ đề, tài liệu…</span>
                <kbd className="hidden rounded border border-line bg-sheet px-1.5 text-[10px] text-muted md:block">⌘ K</kbd>
              </button>
              <Notifications />
              <UserMenu user={user} />
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      <Onboarding userKey={user.email ?? "local"} />
      <Mascot collapsed={collapsed} />
    </div>
  );
}

/* ---------------- Menu tài khoản ---------------- */
function UserMenu({ user }: { user: UserInfo }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(() => setOpen(false));
  const nav = useNavigate();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-mist/70" aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} src={user.avatar} size={34} />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink sm:block">{user.name}</span>
        <Icon name="chevronDown" className="hidden h-4 w-4 text-muted sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-sheet shadow-xl">
          <div className="flex items-center gap-3 border-b border-line p-4">
            <Avatar name={user.name} src={user.avatar} size={44} />
            <div className="min-w-0"><p className="truncate font-semibold text-ink">{user.name}</p><p className="truncate text-xs text-muted">{user.email ?? "Tài khoản cá nhân"}</p></div>
          </div>
          <button role="menuitem" onClick={() => { setOpen(false); nav("/settings"); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-ink hover:bg-mist/60"><Icon name="gear" /> Cài đặt tài khoản</button>
          <button role="menuitem" onClick={() => { setOpen(false); nav("/help"); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-ink hover:bg-mist/60"><Icon name="help" /> Trợ giúp & phản hồi</button>
          <button role="menuitem" onClick={() => { setOpen(false); openOnboarding(); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-ink hover:bg-mist/60"><Icon name="compass" /> Hướng dẫn nhanh</button>
          <button role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new Event("mm:notes")); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-ink hover:bg-mist/60"><Icon name="pencil" /> Sổ ghi chú</button>
          {supabase && <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-sm text-ink hover:bg-mist/60"><Icon name="logout" /> Đăng xuất</button>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Thông báo ---------------- */
function readNotify() {
  const v = pref<unknown>("notify", {});
  const o = typeof v === "object" && v ? (v as Record<string, boolean>) : {};
  return { gaps: o.gaps ?? true, unfinished: o.unfinished ?? true, weekly: o.weekly ?? true };
}
function Notifications() {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<string[]>(() => pref<string[]>("read-notices", []));
  const [prefs, setPrefs] = useState(readNotify);
  useEffect(() => { const l = () => setPrefs(readNotify()); window.addEventListener("mm-notify", l); return () => window.removeEventListener("mm-notify", l); }, []);
  const data = useLearningData({ details: 8 });
  const notices = useMemo(() => buildNotices(data.sessions, data.details).filter((n) => (n.kind === "gap" ? prefs.gaps : n.kind === "unfinished" ? prefs.unfinished : prefs.weekly)), [data.sessions, data.details, prefs]);
  const unread = notices.filter((n) => !read.includes(n.id)).length;
  const ref = useOutside<HTMLDivElement>(() => setOpen(false));
  const nav = useNavigate();
  const mark = (ids: string[]) => { const r = Array.from(new Set([...read, ...ids])).slice(-200); setRead(r); setPref("read-notices", r); };
  const icon = { gap: "book", unfinished: "clock", weekly: "chart" } as const;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-mist/70 hover:text-ink" aria-label={`Thông báo${unread ? ` (${unread} chưa đọc)` : ""}`}>
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-mirror ring-2 ring-sheet" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-sheet shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <p className="font-semibold text-ink">Thông báo</p>
            {notices.length > 0 && <button onClick={() => mark(notices.map((n) => n.id))} className="text-xs font-medium text-ink hover:text-mirror">Đánh dấu đã đọc</button>}
          </div>
          {notices.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">{(prefs.gaps || prefs.unfinished || prefs.weekly) ? "Chưa có thông báo nào. Học thêm vài phiên, MindMirror sẽ nhắc bạn những điểm cần củng cố." : "Bạn đã tắt thông báo trong Cài đặt."}</p>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-line overflow-y-auto">
              {notices.map((n) => (
                <li key={n.id}>
                  <button onClick={() => { mark([n.id]); setOpen(false); nav(n.href); }} className="flex w-full gap-3 px-5 py-4 text-left hover:bg-mist/40">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mist text-mirror"><Icon name={icon[n.kind]} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{n.title}</span>
                      <span className="mt-0.5 block text-sm text-muted">{n.body}</span>
                      <span className="mt-1 block text-xs text-muted">{timeAgo(n.at)}</span>
                    </span>
                    {!read.includes(n.id) && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-mirror" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/reports" onClick={() => setOpen(false)} className="block border-t border-line py-3 text-center text-sm font-medium text-ink hover:bg-mist/40">Xem tiến độ học tập</Link>
        </div>
      )}
    </div>
  );
}

/* ---------------- Tìm kiếm nhanh (⌘K) ---------------- */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "chat" | "doc" | "folder">("all");
  const { sessions, docs, folders } = useLearningData();
  const nav = useNavigate();
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
  const nq = norm(q.trim());
  const items = useMemo(() => {
    const all = [
      ...sessions.map((s) => ({ key: `s-${s.id}`, type: "chat" as const, title: s.topic, sub: `${MODE_PAGE[s.mode].short} · ${fmtDate(s.updatedAt)}`, href: sessionPath(s), icon: "chat" as IconName })),
      ...folders.map((f) => ({ key: `f-${f.id}`, type: "folder" as const, title: f.name, sub: `${docs.filter((d) => d.folderId === f.id).length} tài liệu`, href: `/folders?f=${f.id}`, icon: "folder" as IconName })),
      ...docs.map((d) => ({ key: `d-${d.id}`, type: "doc" as const, title: d.title, sub: `${folders.find((f) => f.id === d.folderId)?.name ?? "Chưa xếp thư mục"} · ${d.kind.toUpperCase()}`, href: `/folders?f=${d.folderId ?? "none"}`, icon: "file" as IconName })),
    ];
    return all.filter((i) => (tab === "all" || i.type === tab) && (!nq || norm(i.title).includes(nq))).slice(0, nq ? 30 : 8);
  }, [sessions, docs, folders, nq, tab]);
  const tabs = [["all", "Tất cả"], ["chat", "Hội thoại"], ["doc", "Tài liệu"], ["folder", "Thư mục"]] as const;
  const go = (href: string) => { onClose(); nav(href); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Tìm kiếm" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-sheet shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 pt-5">
          <Icon name="search" className="h-5 w-5 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tài liệu, thư mục, hội thoại…"
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && items[0]) go(items[0].href); }}
            className="flex-1 rounded-full border border-line bg-paper/60 px-4 py-2.5 text-sm outline-none focus:border-mirror" />
          <kbd className="text-xs text-muted">Esc</kbd>
        </div>
        <div className="flex gap-2 px-5 pt-4">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 text-sm ${tab === k ? "bg-ink text-sheet font-medium" : "text-muted hover:bg-mist"}`}>{l}</button>
          ))}
        </div>
        <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-muted">{nq ? "Kết quả" : "Truy cập gần đây"}</p>
        <ul className="max-h-[50vh] overflow-y-auto px-2 py-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Không tìm thấy kết quả phù hợp.</li>}
          {items.map((i) => (
            <li key={i.key}>
              <button onClick={() => go(i.href)} className="flex w-full items-center gap-4 rounded-xl px-3 py-2.5 text-left hover:bg-mist/60">
                <Icon name={i.icon} className="h-5 w-5 shrink-0 text-mirror" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{i.title}</span><span className="block truncate text-xs text-muted">{i.sub}</span></span>
                <Icon name="external" className="h-4 w-4 shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function useOutside<T extends HTMLElement>(onOut: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOut]);
  return ref;
}

/* ---------------- Logo dùng chung (landing, phiên học) ---------------- */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return <img src="/logo-mark.webp" width={size} height={size} alt="" style={{ width: size, height: size }} className={`select-none object-contain ${className}`} draggable={false} />;
}
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-serif font-extrabold tracking-tight ${className}`}><span className="wordmark-a">Mind</span><span className="wordmark-b">Mirror</span></span>;
}
/** Chữ MindMirror theo logo: "Mind" xanh than, "Mirror" xanh sáng, nét bo tròn (dùng trong ứng dụng; landing giữ Wordmark cũ). */
export function AppWordmark({ className = "" }: { className?: string }) {
  return <span className={`font-sans font-bold tracking-tight ${className}`}><span className="wordmark-a">Mind</span><span style={{ color: "#4FA3EE" }}>Mirror</span></span>;
}
export function Mark({ size = 18 }: { size?: number }) {
  return <Logo size={Math.round(size * 1.4)} />;
}
