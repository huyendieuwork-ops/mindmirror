-- MindMirror 0002 — RAG (pgvector + full-text), MCP connectors, agent traces

create extension if not exists vector;

-- Phiên gắn tài liệu + rubric bám tài liệu
alter table public.learning_sessions add column if not exists document_ids uuid[] not null default '{}';
alter table public.learning_sessions add column if not exists rubric jsonb not null default '[]'::jsonb;
alter table public.learning_sessions drop column if exists sources;

alter table public.messages add column if not exists citations jsonb not null default '[]'::jsonb;

alter table public.evidence add column if not exists criterion_id text;
alter table public.evidence add column if not exists source_citation jsonb;
alter table public.evidence add column if not exists context text not null default 'other'
  check (context in ('explain','transfer','other'));

-- ---------- Thư viện tài liệu ----------
create table if not exists public.documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('pdf','slides','text','mcp')),
  origin jsonb,                         -- {connectorId, externalId, url} nếu lấy qua MCP
  page_count int not null default 0,
  chunk_count int not null default 0,
  embedded boolean not null default false,
  content_hash text not null,
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, content_hash)
);

create table if not exists public.chunks (
  id uuid primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal int not null,
  page int,
  heading text,
  text text not null,
  search_text text not null,            -- đã chuẩn hoá ở backend (NFC, chữ thường, dấu thanh thống nhất)
  search_tsv tsvector generated always as (to_tsvector('simple', search_text)) stored,
  embedding vector(768),
  suspicious boolean not null default false
);
create index if not exists chunks_doc_idx on public.chunks(document_id, ordinal);
create index if not exists chunks_user_idx on public.chunks(user_id);
create index if not exists chunks_tsv_idx on public.chunks using gin(search_tsv);
create index if not exists chunks_vec_idx on public.chunks using hnsw (embedding vector_cosine_ops);

-- Tìm kiếm lai: full-text ('simple' — phù hợp tiếng Việt đã chuẩn hoá) + cosine, gộp bằng RRF (k=60).
-- p_user bắt buộc: hàm chỉ trả đoạn thuộc người dùng đó.
create or replace function public.match_chunks(
  p_user uuid, p_doc_ids uuid[], p_query text, p_embedding vector(768), p_k int default 4
) returns table (
  id uuid, document_id uuid, ordinal int, page int, heading text, text text, search_text text,
  suspicious boolean, document_title text, score float, lexical_rank int, vector_rank int
) language sql stable as $$
  with pool as (
    select c.* from public.chunks c
    where c.user_id = p_user and c.document_id = any(p_doc_ids)
  ),
  lex as (
    select p.id, row_number() over (order by ts_rank_cd(p.search_tsv, q) desc)::int as r
    from pool p, websearch_to_tsquery('simple', p_query) q
    where p.search_tsv @@ q
    order by r limit 40
  ),
  lex_or as ( -- truy vấn dài hiếm khi khớp AND toàn bộ ⇒ thêm nhánh OR các từ
    select p.id, row_number() over (order by ts_rank_cd(p.search_tsv, q) desc)::int as r
    from pool p, to_tsquery('simple', array_to_string(array(
      select distinct regexp_replace(w, '[^[:alnum:]]', '', 'g') from unnest(string_to_array(p_query, ' ')) w
      where length(regexp_replace(w, '[^[:alnum:]]', '', 'g')) > 1), ' | ')) q
    where p.search_tsv @@ q
    order by r limit 40
  ),
  vec as (
    select p.id, row_number() over (order by p.embedding <=> p_embedding)::int as r
    from pool p where p_embedding is not null and p.embedding is not null
    order by r limit 40
  ),
  fused as (
    select id, sum(1.0 / (60 + r)) as score,
      min(case when src in ('lex','lex_or') then r end) as lexical_rank,
      min(case when src = 'vec' then r end) as vector_rank
    from (
      select id, r, 'lex' as src from lex
      union all select id, r, 'lex_or' from lex_or
      union all select id, r, 'vec' from vec
    ) u group by id
  )
  select c.id, c.document_id, c.ordinal, c.page, c.heading, c.text, c.search_text, c.suspicious,
         d.title, f.score, f.lexical_rank, f.vector_rank
  from fused f join public.chunks c on c.id = f.id join public.documents d on d.id = c.document_id
  order by f.score desc limit p_k;
$$;

-- ---------- MCP connectors ----------
create table if not exists public.connectors (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  preset text not null check (preset in ('google_drive','notion','generic')),
  token_enc text,                        -- AES-GCM, khoá CONNECTOR_ENC_KEY chỉ ở Worker
  tools jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- Observability ----------
create table if not exists public.agent_traces (
  trace_id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid references public.learning_sessions(id) on delete cascade,
  name text not null,
  summary jsonb not null,               -- token, chi phí, độ trễ từng bước, lỗi — không có nội dung học
  created_at timestamptz not null default now()
);
create index if not exists agent_traces_session_idx on public.agent_traces(session_id, created_at);

alter table public.ai_call_usage add column if not exists cost_usd numeric(12,8) not null default 0;

-- ---------- RLS ----------
alter table public.documents    enable row level security;
alter table public.chunks       enable row level security;
alter table public.connectors   enable row level security;
alter table public.agent_traces enable row level security;

create policy "read own documents"   on public.documents for select using (user_id = auth.uid());
create policy "delete own documents" on public.documents for delete using (user_id = auth.uid());
create policy "read own chunks"      on public.chunks    for select using (user_id = auth.uid());
create policy "read own traces"      on public.agent_traces for select using (user_id = auth.uid());
-- connectors: không có policy ⇒ chỉ service role (token mã hoá không bao giờ lộ ra client).
revoke execute on function public.match_chunks(uuid, uuid[], text, vector, int) from anon, authenticated;
