import { useEffect, type ReactNode } from "react";

/* ---------------- Biểu tượng (nét 1.8, kiểu Lucide) ---------------- */
export type IconName =
  | "home" | "check" | "compass" | "chart" | "gear" | "help" | "search" | "bell" | "chevronDown" | "chevronRight"
  | "plus" | "upload" | "folder" | "file" | "pencil" | "move" | "trash" | "send" | "logout" | "user" | "x" | "menu"
  | "arrowRight" | "clock" | "book" | "bulb" | "database" | "chat" | "panel" | "external" | "lock" | "link";

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...p}>
      {name === "home" && <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></>}
      {name === "check" && <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="m8 12 3 3 5-6" /></>}
      {name === "compass" && <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>}
      {name === "chart" && <><path d="M4 20h16" /><path d="M7 16v-5M12 16V8M17 16v-8" /></>}
      {name === "gear" && <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>}
      {name === "help" && <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4" /><path d="M12 17h.01" /></>}
      {name === "search" && <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>}
      {name === "bell" && <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>}
      {name === "chevronDown" && <path d="m6 9 6 6 6-6" />}
      {name === "chevronRight" && <path d="m9 6 6 6-6 6" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "upload" && <><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>}
      {name === "folder" && <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />}
      {name === "file" && <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>}
      {name === "pencil" && <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>}
      {name === "move" && <><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M10 13.5h5m-2-2 2 2-2 2" /></>}
      {name === "trash" && <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>}
      {name === "send" && <><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4z" /></>}
      {name === "logout" && <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>}
      {name === "user" && <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>}
      {name === "x" && <path d="M6 6l12 12M18 6 6 18" />}
      {name === "menu" && <path d="M4 7h16M4 12h16M4 17h16" />}
      {name === "arrowRight" && <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>}
      {name === "clock" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
      {name === "book" && <><path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5z" /><path d="M12 6v14" /></>}
      {name === "bulb" && <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z" /></>}
      {name === "database" && <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" /><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></>}
      {name === "chat" && <><path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /><path d="M17 9h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-3" /></>}
      {name === "panel" && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>}
      {name === "external" && <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>}
      {name === "lock" && <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>}
      {name === "link" && <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>}
    </svg>
  );
}

/* ---------------- Khối giao diện cơ bản ---------------- */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, action, children, className = "", bodyClass = "p-5" }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Btn({ children, onClick, variant = "outline", disabled, type = "button", className = "", title }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "outline" | "soft" | "danger" | "ghost"; disabled?: boolean; type?: "button" | "submit"; className?: string; title?: string }) {
  const v = {
    primary: "bg-mirror text-white hover:bg-mirror/90 shadow-sm",
    outline: "bg-sheet border border-line text-ink hover:border-mirror/60 hover:text-mirror",
    soft: "bg-mist text-mirror border border-mirror/20 hover:bg-marker/50",
    danger: "bg-rust/10 text-rust border border-rust/20 hover:bg-rust/15",
    ghost: "text-muted hover:text-ink hover:bg-mist/70",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${v} ${className}`}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-mirror" : "bg-line"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function SelectBox<T extends string>({ value, onChange, options, disabled, label, className = "" }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; label: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}
        className="w-full appearance-none rounded-lg border border-line bg-sheet py-2 pl-3 pr-9 text-sm text-ink outline-none focus:border-mirror disabled:opacity-60">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Progress({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full rounded-full bg-mist ${className}`}>
      <div className="h-2 rounded-full bg-gradient-to-r from-skyish to-mirror transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Donut({ value, size = 168, label }: { value: number | null; size?: number; label: string }) {
  const r = 42, c = 2 * Math.PI * r, v = value ?? 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--mist))" strokeWidth="11" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="url(#mmDonut)" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
        <defs><linearGradient id="mmDonut" x1="0" x2="1"><stop offset="0" stopColor="#7DC4FA" /><stop offset="1" stopColor="#4A86DB" /></linearGradient></defs>
      </svg>
      <div className="absolute text-center">
        <p className="text-3xl font-bold text-ink">{value === null ? "—" : `${Math.round(v)}%`}</p>
        <p className="mt-0.5 text-[11px] text-muted">{label}</p>
      </div>
    </div>
  );
}

/** Biểu đồ đường đơn giản (SVG) — giá trị 0–100, null = không có dữ liệu. */
export function LineChart({ points }: { points: { label: string; value: number | null }[] }) {
  const W = 640, H = 220, L = 40, R = 20, T = 12, B = 28;
  const xs = (i: number) => L + (points.length <= 1 ? 0 : (i * (W - L - R)) / (points.length - 1));
  const ys = (v: number) => T + (1 - v / 100) * (H - T - B);
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null) as { label: string; value: number; i: number }[];
  const path = valid.map((p, k) => `${k ? "L" : "M"}${xs(p.i)},${ys(p.value)}`).join(" ");
  const area = valid.length > 1 ? `${path} L${xs(valid[valid.length - 1]!.i)},${ys(0)} L${xs(valid[0]!.i)},${ys(0)} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Biểu đồ mức độ hiểu theo thời gian">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={ys(g)} y2={ys(g)} stroke="rgb(var(--line))" strokeDasharray={g ? "3 4" : undefined} />
          <text x={L - 8} y={ys(g) + 4} textAnchor="end" fontSize="10" fill="rgb(var(--muted))">{g}%</text>
        </g>
      ))}
      {area && <path d={area} fill="rgb(var(--mirror) / 0.10)" />}
      {path && <path d={path} fill="none" stroke="rgb(var(--mirror))" strokeWidth="2.5" strokeLinejoin="round" />}
      {valid.map((p) => <circle key={p.i} cx={xs(p.i)} cy={ys(p.value)} r="4.5" fill="rgb(var(--sheet))" stroke="rgb(var(--mirror))" strokeWidth="2" />)}
      {points.map((p, i) => <text key={i} x={xs(i)} y={H - 8} textAnchor={i === points.length - 1 && i > 0 ? "end" : i === 0 && points.length > 1 ? "start" : "middle"} fontSize="10" fill="rgb(var(--muted))">{p.label}</text>)}
    </svg>
  );
}

export function Empty({ icon = "bulb", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-mist text-mirror"><Icon name={icon} className="h-5 w-5" /></span>
      <p className="mt-3 font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl border border-line bg-sheet shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-mist hover:text-ink" aria-label="Đóng"><Icon name="x" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return src ? (
    <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid place-items-center rounded-full bg-mist font-semibold text-mirror" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>
  );
}

export const FOLDER_TONE: Record<string, string> = {
  blue: "text-[#4A86DB] bg-[#EAF2FF]",
  purple: "text-[#8B6FE0] bg-[#F1ECFF]",
  green: "text-[#2E9F7E] bg-[#E6F6F0]",
  amber: "text-[#D8961E] bg-[#FFF5E0]",
  pink: "text-[#D9579B] bg-[#FDEAF3]",
  teal: "text-[#1C9BB0] bg-[#E3F6F9]",
};
export const FOLDER_COLORS = Object.keys(FOLDER_TONE);

export function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "vừa xong";
  if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
  if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
  if (d < 172800) return "Hôm qua";
  if (d < 2592000) return `${Math.floor(d / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
