-- ============================================================
-- AINA Scraper — Supabase Schema Setup
-- Jalankan di: https://supabase.com/dashboard → SQL Editor
-- ============================================================

create table if not exists kb_articles (
  -- id dari app (8-char string dari uuid, bukan uuid penuh)
  id             text,

  -- Field utama artikel
  title          text,
  slug           text primary key,   -- slug dipakai sebagai unique key untuk upsert
  source_url     text,
  published_date text,
  content        text,
  summary        text,
  ai_summary     text,
  tags           text[],

  -- Status dari scraper dan review workflow
  scrape_status    text default 'success',
  approval_status  text default 'pending',
  notes            text default '',
  last_updated     text,

  -- Timestamp Supabase
  created_at     timestamptz default now()
);

-- Index untuk performa query
create index if not exists idx_kb_articles_created_at   on kb_articles(created_at desc);
create index if not exists idx_kb_articles_approval     on kb_articles(approval_status);
create index if not exists idx_kb_articles_scrape       on kb_articles(scrape_status);

-- Enable Row Level Security (opsional, nonaktifkan dulu kalau mau akses bebas)
-- alter table kb_articles enable row level security;
