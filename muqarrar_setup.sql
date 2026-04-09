-- ============================================================
-- AINA Scraper — Muqarrar Chunks Table
-- Jalankan sekali di Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS muqarrar_chunks (
  id          text        PRIMARY KEY,
  kitab_id    text        NOT NULL,
  kitab_name  text        NOT NULL,
  author      text        DEFAULT '',
  page_number integer     NOT NULL,
  chapter     text        DEFAULT '',
  content     text        NOT NULL,
  embedding   jsonb       DEFAULT '[]',
  word_count  integer     DEFAULT 0,
  is_ocr      boolean     DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS muqarrar_kitab_id_idx  ON muqarrar_chunks (kitab_id);
CREATE INDEX IF NOT EXISTS muqarrar_page_idx      ON muqarrar_chunks (kitab_id, page_number);

-- Row Level Security (opsional — disable jika pakai service role saja)
ALTER TABLE muqarrar_chunks DISABLE ROW LEVEL SECURITY;
