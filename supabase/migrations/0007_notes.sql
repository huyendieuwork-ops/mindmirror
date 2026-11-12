-- MindMirror 0007 — Ghi chú cá nhân (trợ lý ghi chú ở chân trang). Chỉ THÊM bảng mới, không đụng dữ liệu cũ.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes(user_id, updated_at desc);

-- Backend dùng service role (vượt RLS) và luôn lọc user_id; bật RLS để khóa truy cập trực tiếp bằng anon key.
alter table public.notes enable row level security;
