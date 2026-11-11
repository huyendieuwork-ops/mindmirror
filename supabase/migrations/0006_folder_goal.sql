-- MindMirror 0006 — Mục tiêu học của thư mục (chỉ THÊM cột, không xoá/sửa dữ liệu cũ)
-- Người học tự đặt (vd "Ôn thi cuối kỳ chương 4–6, ưu tiên ví dụ có lời giải"); AI dùng để chọn ví dụ và mức độ giải thích.
alter table public.folders add column if not exists goal text;
do $$ begin
  alter table public.folders add constraint folders_goal_len check (goal is null or char_length(goal) <= 500);
exception when duplicate_object then null; end $$;
