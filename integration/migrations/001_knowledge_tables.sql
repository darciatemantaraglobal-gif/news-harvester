-- ============================================================
-- AINA Scraper — Phase 2 Migration
-- Creates knowledge_sources and knowledge_chunks tables.
--
-- Run this ONCE in Supabase SQL Editor before using
-- integration/db_writer.py for the first time.
--
-- Safe to run multiple times (IF NOT EXISTS guards).
-- ============================================================

-- ─── knowledge_sources ──────────────────────────────────────
-- One row per scraped article URL.
-- source_url is UNIQUE — used for deduplication / upsert.
-- content_hash (MD5) detects whether content actually changed.

CREATE TABLE IF NOT EXISTS knowledge_sources (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT        NOT NULL    DEFAULT '',
    source_type     TEXT        NOT NULL    DEFAULT 'news',
    source_name     TEXT                    DEFAULT '',
    source_url      TEXT        UNIQUE,
    summary         TEXT                    DEFAULT '',
    tags            JSONB                   DEFAULT '[]'::jsonb,
    status          TEXT                    DEFAULT 'published',
    cleaned_content TEXT                    DEFAULT '',
    content_hash    TEXT                    DEFAULT '',
    created_at      TIMESTAMPTZ             DEFAULT now(),
    updated_at      TIMESTAMPTZ             DEFAULT now()
);

-- Index on source_url for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_source_url
    ON knowledge_sources (source_url);

-- Index on source_type for filtering by content type
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_source_type
    ON knowledge_sources (source_type);


-- ─── knowledge_chunks ────────────────────────────────────────
-- One row per text chunk derived from a knowledge_source.
-- ON DELETE CASCADE ensures orphan chunks are cleaned up
-- automatically when a source row is deleted.

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID        NOT NULL
                        REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    chunk_index     INTEGER     NOT NULL,
    chunk_text      TEXT        NOT NULL,
    chunk_summary   TEXT                    DEFAULT '',
    topic           TEXT                    DEFAULT '',
    metadata_json   JSONB                   DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ             DEFAULT now()
);

-- Index on source_id for fast bulk-delete / re-chunk operations
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_id
    ON knowledge_chunks (source_id);

-- Index on topic for filtering by topic
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_topic
    ON knowledge_chunks (topic);


-- ─── Optional: enable Row Level Security (disable for service-role writes)
-- If you are inserting via service-role key (SUPABASE_SERVICE_ROLE_KEY),
-- RLS is bypassed automatically. Leave these lines commented unless needed.

-- ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE knowledge_chunks  ENABLE ROW LEVEL SECURITY;
