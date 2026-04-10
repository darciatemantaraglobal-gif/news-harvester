-- ============================================================
-- AINA Scraper — Muqarrar Chunks Table
-- Run once in Supabase SQL Editor.
-- Safe to re-run: all statements use IF NOT EXISTS.
-- Requires: pgvector extension enabled (handled below).
-- ============================================================

-- ── 0. Enable pgvector extension ────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. Create table (idempotent) ────────────────────────────
CREATE TABLE IF NOT EXISTS muqarrar_chunks (
  id            text        PRIMARY KEY,
  kitab_id      text        NOT NULL,
  kitab_name    text        NOT NULL,
  author        text        DEFAULT '',
  description   text        DEFAULT '',
  page_number   integer     NOT NULL,
  chapter       text        DEFAULT '',
  content       text        NOT NULL,
  embedding     jsonb       DEFAULT '[]',
  embedding_vec vector(1536),
  word_count    integer     DEFAULT 0,
  is_ocr        boolean     DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- ── 2. Migrate columns (safe: ADD COLUMN IF NOT EXISTS) ─────
ALTER TABLE muqarrar_chunks ADD COLUMN IF NOT EXISTS description   text DEFAULT '';
ALTER TABLE muqarrar_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);

-- ── 3. Disable RLS (service role key bypasses anyway) ────────
ALTER TABLE muqarrar_chunks DISABLE ROW LEVEL SECURITY;

-- ── 4. Standard indexes ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS muqarrar_kitab_id_idx ON muqarrar_chunks (kitab_id);
CREATE INDEX IF NOT EXISTS muqarrar_page_idx     ON muqarrar_chunks (kitab_id, page_number);

-- ── 5. pgvector IVFFlat index ────────────────────────────────
-- NOTE: IVFFlat requires at least `lists` rows in the table to build.
-- Run this block AFTER uploading at least one kitab (10+ chunks).
-- It is safe to re-run — the DO block catches "already exists" errors.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'muqarrar_chunks'
      AND indexname  = 'muqarrar_embedding_vec_idx'
  ) THEN
    CREATE INDEX muqarrar_embedding_vec_idx
      ON muqarrar_chunks
      USING ivfflat (embedding_vec vector_cosine_ops)
      WITH (lists = 10);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'muqarrar_embedding_vec_idx: % — run again after uploading data.', SQLERRM;
END;
$$;

-- ============================================================
-- RPC: match_muqarrar_chunks
-- Used by AINA Website for semantic search over muqarrar kitab.
-- ============================================================
CREATE OR REPLACE FUNCTION match_muqarrar_chunks(
  query_embedding vector(1536),
  match_threshold float   DEFAULT 0.35,
  match_count     int     DEFAULT 5,
  filter_kitab_id text    DEFAULT NULL
)
RETURNS TABLE (
  kitab_id    text,
  kitab_name  text,
  author      text,
  description text,
  page_number integer,
  chapter     text,
  content     text,
  word_count  integer,
  is_ocr      boolean,
  similarity  float
)
LANGUAGE plpgsql
AS $func$
BEGIN
  RETURN QUERY
  SELECT
    mc.kitab_id,
    mc.kitab_name,
    mc.author,
    mc.description,
    mc.page_number,
    mc.chapter,
    mc.content,
    mc.word_count,
    mc.is_ocr,
    1 - (mc.embedding_vec <=> query_embedding) AS similarity
  FROM muqarrar_chunks mc
  WHERE mc.embedding_vec IS NOT NULL
    AND 1 - (mc.embedding_vec <=> query_embedding) > match_threshold
    AND (filter_kitab_id IS NULL OR mc.kitab_id = filter_kitab_id)
  ORDER BY mc.embedding_vec <=> query_embedding
  LIMIT match_count;
END;
$func$;
