-- ============================================================
-- AINA Scraper — Phase 5 Analytics Migration
-- Creates harvester_runs table for cross-service observability.
--
-- Purpose:
--   Stores a summary record after every ingestion pipeline run.
--   AINA can query this table directly to monitor harvester health,
--   freshness of data, and ingestion success rates.
--
-- Run ONCE in Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS guards).
--
-- Prerequisites:
--   001_knowledge_tables.sql must be run first.
--   002_metadata_columns.sql must be run first.
-- ============================================================

CREATE TABLE IF NOT EXISTS harvester_runs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Timing
    started_at      TIMESTAMPTZ NOT NULL,
    finished_at     TIMESTAMPTZ NOT NULL,
    duration_sec    NUMERIC(10, 2)          DEFAULT 0,

    -- Outcome
    status          TEXT        NOT NULL    DEFAULT 'unknown',
    -- Values: 'success' | 'failed' | 'skipped_concurrent'

    -- Source info
    url             TEXT                    DEFAULT '',

    -- Counts
    scraped_count   INTEGER                 DEFAULT 0,
    inserted        INTEGER                 DEFAULT 0,
    updated         INTEGER                 DEFAULT 0,
    skipped         INTEGER                 DEFAULT 0,
    rejected        INTEGER                 DEFAULT 0,
    chunk_count     INTEGER                 DEFAULT 0,

    -- Error detail (null on success)
    error_message   TEXT,

    -- Audit
    created_at      TIMESTAMPTZ             DEFAULT now()
);

-- ─── Indexes for AINA analytics queries ──────────────────────
-- Most recent runs first
CREATE INDEX IF NOT EXISTS idx_harvester_runs_started_at
    ON harvester_runs (started_at DESC);

-- Filter by outcome
CREATE INDEX IF NOT EXISTS idx_harvester_runs_status
    ON harvester_runs (status);

-- Filter failed runs quickly
CREATE INDEX IF NOT EXISTS idx_harvester_runs_status_started
    ON harvester_runs (status, started_at DESC);

-- ─── Useful AINA query examples (for reference, not executed) ─
-- Last 10 runs:
--   SELECT * FROM harvester_runs ORDER BY started_at DESC LIMIT 10;
--
-- Success rate (last 30 days):
--   SELECT
--     COUNT(*) FILTER (WHERE status = 'success') AS successes,
--     COUNT(*) FILTER (WHERE status = 'failed')  AS failures,
--     ROUND(
--       COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0), 1
--     ) AS success_rate_pct
--   FROM harvester_runs
--   WHERE started_at > now() - INTERVAL '30 days';
--
-- Last successful scrape (freshness check):
--   SELECT started_at, scraped_count, inserted, chunk_count
--   FROM harvester_runs
--   WHERE status = 'success'
--   ORDER BY started_at DESC LIMIT 1;
--
-- Average duration:
--   SELECT ROUND(AVG(duration_sec), 1) AS avg_duration_sec
--   FROM harvester_runs WHERE status = 'success';
