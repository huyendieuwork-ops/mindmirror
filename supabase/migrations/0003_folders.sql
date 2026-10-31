-- MindMirror 0003 — Thư mục tài liệu (My Folder)

create table if not exists public.folders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'blue',
  created_at timestamptz not null default now()
);
create index if not exists folders_user_idx on public.folders(user_id);

-- Backend dùng service role (vượt RLS) và luôn lọc user_id; bật RLS để khóa truy cập trực tiếp bằng anon key.
alter table public.folders enable row level security;

alter table public.documents add column if not exists folder_id uuid references public.folders(id) on delete set null;
create index if not exists documents_folder_idx on public.documents(folder_id);
