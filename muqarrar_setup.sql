-- ============================================================
-- AINA Scraper — Muqarrar Chunks Table
-- Jalankan sekali di Supabase SQL Editor
-- ============================================================

-- ── 0. Aktifkan pgvector extension ──────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. Buat tabel (aman dijalankan berulang kali) ───────────
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

-- ── 2. Index standar ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS muqarrar_kitab_id_idx ON muqarrar_chunks (kitab_id);
CREATE INDEX IF NOT EXISTS muqarrar_page_idx     ON muqarrar_chunks (kitab_id, page_number);

-- ── 3. Index pgvector untuk cosine similarity search ────────
CREATE INDEX IF NOT EXISTS muqarrar_embedding_vec_idx
  ON muqarrar_chunks
  USING ivfflat (embedding_vec vector_cosine_ops)
  WITH (lists = 10);

-- ── 4. Disable RLS (pakai service role key) ─────────────────
ALTER TABLE muqarrar_chunks DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Migrasi kolom: jalankan jika tabel SUDAH ADA sebelumnya
-- (aman dijalankan berulang kali — ADD COLUMN IF NOT EXISTS)
-- ============================================================
ALTER TABLE muqarrar_chunks ADD COLUMN IF NOT EXISTS description   text DEFAULT '';
ALTER TABLE muqarrar_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);

-- Migrasi data lama: konversi embedding jsonb → vector(1536)
-- Jalankan SEKALI untuk mengisi embedding_vec dari data yang sudah ada
UPDATE muqarrar_chunks
SET    embedding_vec = embedding::text::vector(1536)
WHERE  embedding IS NOT NULL
  AND  jsonb_array_length(embedding) = 1536
  AND  embedding_vec IS NULL;

-- ============================================================
-- RPC: match_muqarrar_chunks
-- Digunakan oleh AINA Website untuk semantic search ke kitab muqarrar
-- Sama persis dengan match_knowledge_base tapi untuk tabel muqarrar_chunks
-- ============================================================
CREATE OR REPLACE FUNCTION match_muqarrar_chunks(
  query_embedding vector(1536),
  match_threshold float   DEFAULT 0.35,
  match_count     int     DEFAULT 5,
  filter_kitab_id text    DEFAULT NULL   -- NULL = semua kitab
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
