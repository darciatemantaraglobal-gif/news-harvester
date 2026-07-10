-- ═══════════════════════════════════════════════════════════════════════════
-- Vercel serverless migration — new Supabase tables
-- Run this once in the Supabase SQL Editor before deploying to Vercel.
-- Replaces local JSON files (which are not writable/persistent on Vercel)
-- and the in-memory scrape_state used for progress tracking.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) scraped_articles_draft — replaces data/scraped_articles.json
create table if not exists scraped_articles_draft (
  url        text primary key,
  data       jsonb not null,
  scraped_at timestamptz not null default now()
);
create index if not exists idx_scraped_articles_draft_scraped_at
  on scraped_articles_draft (scraped_at desc);

-- 2) kb_articles_draft — replaces data/kb_articles.json
create table if not exists kb_articles_draft (
  article_id text primary key,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_kb_articles_draft_created_at
  on kb_articles_draft (created_at desc);

-- 3) scrape_jobs — replaces the in-memory scrape_state global
--    (each /api/scrape invocation writes progress here so it can be polled
--    from a separate serverless invocation via GET /api/progress?job_id=...)
create table if not exists scrape_jobs (
  job_id     text primary key,
  status     text not null default 'running',   -- running | done | incomplete | error
  phase      text not null default 'listing',    -- listing | scraping | done
  current    integer not null default 0,
  total      integer not null default 0,
  success    integer not null default 0,
  partial    integer not null default 0,
  failed     integer not null default 0,
  duplicate  integer not null default 0,
  logs       jsonb not null default '[]'::jsonb,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional: periodically clean up old job rows (scrape_jobs grows unbounded
-- otherwise). Safe to run manually or on a schedule.
-- delete from scrape_jobs where created_at < now() - interval '7 days';
