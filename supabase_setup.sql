-- Jalankan SQL ini di Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

create table if not exists kb_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text,
  slug         text unique,
  source_url   text,
  published_date text,
  content      text,
  summary      text,
  tags         text[],
  ai_summary   text,
  created_at   timestamptz default now()
);

-- Index untuk pencarian slug dan tanggal
create index if not exists idx_kb_articles_slug on kb_articles(slug);
create index if not exists idx_kb_articles_created_at on kb_articles(created_at desc);
