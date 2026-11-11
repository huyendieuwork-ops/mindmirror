-- MindMirror 0004 — Nguồn web chính thống (Đợt 2). Chỉ thêm bảng/cột, không đụng dữ liệu cũ.

-- Kết quả search_trusted_sources đã kiểm tra (L1–L5, trích từ trang code tự tải). Dùng chung mọi người dùng:
-- nội dung công khai, khoá là mã băm (môn + truy vấn chuẩn hoá) — KHÔNG lưu câu hỏi gốc.
create table if not exists public.web_source_cache (
  key text primary key,
  results jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists web_source_cache_expires_idx on public.web_source_cache(expires_at);
alter table public.web_source_cache enable row level security; -- không có policy ⇒ client không đọc được

-- Đếm lượt tìm web để giới hạn theo ngày (chỉ thời điểm, không lưu truy vấn).
create table if not exists public.web_search_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists web_search_log_user_idx on public.web_search_log(user_id, created_at);
alter table public.web_search_log enable row level security;

-- Trích dẫn nguồn web của từng lời MindMirror (tách khỏi trích dẫn tài liệu).
alter table public.messages add column if not exists web_citations jsonb not null default '[]'::jsonb;
