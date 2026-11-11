-- MindMirror 0005 — Đợt 3 (GraphRAG): đếm lượt dựng đồ thị khái niệm để giới hạn theo ngày (giữ hạn mức Gemini).
-- Đồ thị nằm ở Neo4j; bảng này chỉ lưu thời điểm + số trang đã đọc, không lưu nội dung. Chỉ thêm bảng mới.
create table if not exists public.graph_build_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pages int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists graph_build_log_user_idx on public.graph_build_log(user_id, created_at);
alter table public.graph_build_log enable row level security; -- không policy ⇒ client không đọc được
