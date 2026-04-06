-- ============================================================
-- AINA Scraper — Phase 3 Migration
-- Adds freshness + trust metadata columns to knowledge_sources.
--
-- Run this ONCE in Supabase SQL Editor after 001_knowledge_tables.sql.
-- Safe to run multiple times (IF NOT EXISTS / DO $$ guards).
-- ============================================================

-- ─── Timestamp columns for freshness scoring ─────────────────
-- published_at : article publish date from original site (nullable)
-- scraped_at   : when the scraper fetched this article (not nullable, defaults to now)

ALTER TABLE knowledge_sources
    ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scraped_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── Source classification columns ───────────────────────────
-- source_category   : "official_news" | "community_news" | "article"
-- source_trust_hint : "high" | "medium" | "default"

ALTER TABLE knowledge_sources
    ADD COLUMN IF NOT EXISTS source_category   TEXT NOT NULL DEFAULT 'article',
    ADD COLUMN IF NOT EXISTS source_trust_hint TEXT NOT NULL DEFAULT 'default';

-- ─── Indexes for retrieval filters ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_published_at
    ON knowledge_sources (published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_scraped_at
    ON knowledge_sources (scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_source_category
    ON knowledge_sources (source_category);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_trust_hint
    ON knowledge_sources (source_trust_hint);

-- ─── CHECK constraints (optional — uncomment if AINA enforces these) ─────────
-- ALTER TABLE knowledge_sources
--     ADD CONSTRAINT chk_source_category
--         CHECK (source_category IN ('official_news', 'community_news', 'article'));
--
-- ALTER TABLE knowledge_sources
--     ADD CONSTRAINT chk_source_trust_hint
--         CHECK (source_trust_hint IN ('high', 'medium', 'default'));
