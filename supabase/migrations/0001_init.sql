-- MindMirror — schema khởi đầu (Supabase Postgres)
-- Chạy: Supabase Dashboard → SQL Editor, hoặc `supabase db push`.

create extension if not exists "pgcrypto";

-- ---------- Hồ sơ & cài đặt ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_style text not null default 'friendly' check (ai_style in ('friendly','concise','academic')),
  support_preference text not null default 'socratic_first' check (support_preference in ('socratic_first','direct','flexible')),
  challenge_level text not null default 'balanced' check (challenge_level in ('gentle','balanced','deep')),
  self_assessment boolean not null default true,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  updated_at timestamptz not null default now()
);

-- Tự tạo profile khi user đăng nhập Google lần đầu
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Phiên học ----------
create table if not exists public.learning_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('explore','reunderstand')),
  topic text not null,
  goal text,
  phase text not null,
  status text not null check (status in ('active','paused','finished')),
  state jsonb not null,        -- LearningState (state machine)
  settings jsonb not null,     -- snapshot cài đặt AI lúc chạy phiên
  sources jsonb not null default '[]'::jsonb, -- đoạn nguồn đã trích (không lưu tệp gốc)
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists learning_sessions_user_idx on public.learning_sessions(user_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key,
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user','assistant')),
  text text not null,
  action text,
  intent text,
  created_at timestamptz not null default now()
);
create index if not exists messages_session_idx on public.messages(session_id, seq);

create table if not exists public.knowledge_gaps (
  id uuid primary key,
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  concept text not null,
  status text not null check (status in ('open','resolved','resolved_after_support','skipped')),
  support_level int not null default 0 check (support_level between 0 and 3)
);

create table if not exists public.evidence (
  id uuid primary key,
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  criterion text not null,
  claim text not null,
  quote text not null,          -- đã được backend xác thực có trong lời người học
  status text not null check (status in ('observed','unclear','contradicted')),
  assisted boolean not null default false,
  support_level_at_time int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.session_cards (
  session_id uuid primary key references public.learning_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_json jsonb not null,
  created_at timestamptz not null default now()
);

-- Idempotency: gửi lại cùng client_turn_id không tạo turn mới
create table if not exists public.turn_requests (
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  client_turn_id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, client_turn_id)
);

-- Chỉ metadata, KHÔNG lưu prompt
create table if not exists public.ai_call_usage (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid references public.learning_sessions(id) on delete set null,
  provider text not null,
  model text not null,
  status text not null,
  http_status int,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  latency_ms int not null default 0,
  fallback boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_call_usage_user_day_idx on public.ai_call_usage(user_id, created_at);

-- ---------- Row Level Security ----------
-- Backend (service role) vượt RLS nhưng vẫn tự lọc user_id.
-- RLS bảo vệ khi frontend đọc trực tiếp bằng token người dùng (vd trang lịch sử).
alter table public.profiles         enable row level security;
alter table public.user_settings    enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.messages         enable row level security;
alter table public.knowledge_gaps   enable row level security;
alter table public.evidence         enable row level security;
alter table public.session_cards    enable row level security;
alter table public.turn_requests    enable row level security;
alter table public.ai_call_usage    enable row level security;

create policy "own profile"  on public.profiles      for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own settings" on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Dữ liệu phiên: người dùng chỉ ĐỌC/XOÁ trực tiếp; ghi đi qua backend để giữ toàn vẹn evidence.
create policy "read own sessions"   on public.learning_sessions for select using (user_id = auth.uid());
create policy "delete own sessions" on public.learning_sessions for delete using (user_id = auth.uid());
create policy "read own messages"   on public.messages       for select using (user_id = auth.uid());
create policy "read own gaps"       on public.knowledge_gaps for select using (user_id = auth.uid());
create policy "read own evidence"   on public.evidence       for select using (user_id = auth.uid());
create policy "read own cards"      on public.session_cards  for select using (user_id = auth.uid());
create policy "read own usage"      on public.ai_call_usage  for select using (user_id = auth.uid());
-- turn_requests: không có policy ⇒ chỉ service role truy cập.
