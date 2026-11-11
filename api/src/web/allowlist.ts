/**
 * DANH SÁCH NGUỒN CHÍNH THỐNG (Đợt 2) — đặt cố định trong code, theo môn.
 * Không đọc từ DB hay từ tin nhắn để không ai sửa được lúc chạy; thêm trang mới phải qua PR.
 *
 * Kiểm tra link L1–L4 (L5 chuyển hướng ở fetch.ts, L6–L7 ở grounding.ts):
 *  L1 chỉ https · L2 không IP / cổng / tên đăng nhập · L3 tên máy chủ BẰNG ĐÚNG tên miền hoặc kết thúc bằng ".tên-miền"
 *  (không dùng phép "có chứa") · L4 mục có giới hạn đường dẫn thì đường dẫn phải bắt đầu bằng tiền tố đó.
 */

export type SourceTier = "official" | "encyclopedia" | "textbook" | "edu" | "gov";

export interface AllowEntry {
  /** Tên miền gốc. wildcard=true nghĩa là CHỈ nhận tên miền con (vd *.edu.vn), không nhận "edu.vn". */
  domain: string;
  wildcard?: boolean;
  /** Tiền tố đường dẫn được phép (rỗng = toàn trang). */
  pathPrefixes?: string[];
  name: string;
  tier: SourceTier;
  /** Môn áp dụng; "*" = mọi môn. */
  subjects: string[];
}

/** Bản đã được nhóm duyệt (11/11/2026): giữ nguyên bảng nháp môn Cơ sở dữ liệu. */
export const ALLOWLIST: readonly AllowEntry[] = [
  { domain: "postgresql.org", pathPrefixes: ["/docs/"], name: "Tài liệu PostgreSQL", tier: "official", subjects: ["csdl"] },
  { domain: "dev.mysql.com", pathPrefixes: ["/doc/"], name: "Tài liệu MySQL", tier: "official", subjects: ["csdl"] },
  { domain: "learn.microsoft.com", pathPrefixes: ["/sql/", "/office/", "/vi-vn/sql/", "/en-us/sql/", "/vi-vn/office/", "/en-us/office/"], name: "Microsoft Learn (SQL Server, Access)", tier: "official", subjects: ["csdl"] },
  { domain: "sqlite.org", name: "Tài liệu SQLite", tier: "official", subjects: ["csdl"] },
  { domain: "vi.wikipedia.org", pathPrefixes: ["/wiki/"], name: "Wikipedia tiếng Việt", tier: "encyclopedia", subjects: ["*"] },
  { domain: "en.wikipedia.org", pathPrefixes: ["/wiki/"], name: "Wikipedia (English)", tier: "encyclopedia", subjects: ["*"] },
  { domain: "openstax.org", pathPrefixes: ["/books/"], name: "OpenStax (sách mở)", tier: "textbook", subjects: ["*"] },
  { domain: "edu.vn", wildcard: true, name: "Trường đại học Việt Nam (.edu.vn)", tier: "edu", subjects: ["*"] },
  { domain: "gov.vn", wildcard: true, name: "Cơ quan nhà nước (.gov.vn)", tier: "gov", subjects: ["*"] },
];

/** Thứ tự tin cậy khi nhiều trang cùng phù hợp: tài liệu chính thức trước, bách khoa sau. */
export const TIER_RANK: Record<SourceTier, number> = { official: 0, textbook: 1, encyclopedia: 2, edu: 3, gov: 4 };

export const DEFAULT_SUBJECT = "csdl";

export type LinkCheck =
  | { ok: true; url: URL; entry: AllowEntry }
  | { ok: false; code: "L1" | "L2" | "L3" | "L4"; reason: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function entriesFor(subject = DEFAULT_SUBJECT): AllowEntry[] {
  return ALLOWLIST.filter((e) => e.subjects.includes("*") || e.subjects.includes(subject));
}

/** Tên miền để báo cho dịch vụ tìm kiếm (chỉ là gợi ý — code vẫn kiểm tra lại từng link). */
export function searchDomains(subject = DEFAULT_SUBJECT): string[] {
  return entriesFor(subject).map((e) => e.domain);
}

function hostMatches(host: string, e: AllowEntry): boolean {
  const d = e.domain.toLowerCase();
  if (e.wildcard) return host.endsWith(`.${d}`) && host.length > d.length + 1;
  return host === d || host.endsWith(`.${d}`);
}

/** L1–L4 cho một đường link. Không bao giờ ném lỗi. */
export function checkUrl(raw: string, subject = DEFAULT_SUBJECT): LinkCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "L1", reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "L1", reason: "not_https" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.username || url.password) return { ok: false, code: "L2", reason: "userinfo" };
  if (url.port) return { ok: false, code: "L2", reason: "port" };
  if (IPV4.test(host) || host.includes(":") || host.startsWith("[")) return { ok: false, code: "L2", reason: "ip_address" };
  const hostEntries = entriesFor(subject).filter((e) => hostMatches(host, e));
  if (!hostEntries.length) return { ok: false, code: "L3", reason: "domain_not_allowed" };
  // Đường dẫn đã được URL chuẩn hoá (xử lý "..", "%2e"), nên so tiền tố trên pathname là an toàn.
  const path = url.pathname;
  const entry = hostEntries.find((e) => !e.pathPrefixes?.length || e.pathPrefixes.some((p) => path.startsWith(p)));
  if (!entry) return { ok: false, code: "L4", reason: "path_not_allowed" };
  url.hash = "";
  return { ok: true, url, entry };
}
