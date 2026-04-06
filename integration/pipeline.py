# integration/pipeline.py
#
# AINA Scraper — Phase 5: Semi-Automatic Knowledge Ingestion Pipeline
#
# ADDITIVE ONLY — zero changes to any existing file (app.py, scraper.py, etc.)
#
# Provides:
#   run_scheduled_news_ingestion()  — full pipeline: scrape → map → knowledge DB
#   start_ingestion_scheduler()     — opt-in background scheduler via ENV
#   stop_ingestion_scheduler()      — graceful shutdown
#   get_run_history()               — read ingestion_history.json
#
# ENV controls (all optional):
#   ENABLE_SCHEDULED_INGESTION=true          — activate background scheduler
#   SCHEDULE_INTERVAL_MINUTES=360            — run interval (default 6 hours)
#   INGESTION_SCRAPE_URL=https://...         — fallback URL if scheduler cfg empty
#
# Run history:
#   Primary   — data/ingestion_history.json (local, last 50 runs)
#   Secondary — Supabase table harvester_runs (cross-service, opt-in)
#               Written only if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
#               Requires 003_harvester_runs.sql migration to be run first.
#               Failure to write to Supabase never affects the ingestion pipeline.
#
# Never auto-invoked at import time.

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ─── File paths (mirrors app.py conventions) ─────────────────────────────────
_DATA_DIR       = "data"
_CONFIG_DIR     = "config"
_DATA_FILE      = os.path.join(_DATA_DIR, "scraped_articles.json")
_SETTINGS_FILE  = os.path.join(_DATA_DIR, "settings.json")
_SCHED_FILE     = os.path.join(_CONFIG_DIR, "scheduler_settings.json")
_HISTORY_FILE   = os.path.join(_DATA_DIR, "ingestion_history.json")
_MAX_HISTORY    = 50

# ─── Concurrent-run guard ─────────────────────────────────────────────────────
# Prevents two ingestion runs from executing simultaneously.
# Uses a non-blocking acquire so a duplicate trigger is simply skipped.
_ingestion_lock = threading.Lock()

# ─── Internal helpers ─────────────────────────────────────────────────────────

def _load_json(path: str, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
    except Exception:
        pass
    return default


def _save_json(path: str, data):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _elapsed(t0: float) -> float:
    return round(time.time() - t0, 2)


# ─── Run history ──────────────────────────────────────────────────────────────

def _save_run_history(summary: dict) -> None:
    """Append one run summary to ingestion_history.json (capped at _MAX_HISTORY)."""
    history = _load_json(_HISTORY_FILE, [])
    if not isinstance(history, list):
        history = []
    history.append(summary)
    history = history[-_MAX_HISTORY:]
    _save_json(_HISTORY_FILE, history)


def get_run_history(limit: int = 20) -> list:
    """
    Return the last `limit` ingestion run summaries from ingestion_history.json.

    Each entry contains:
      started_at, finished_at, status, duration_sec, url,
      scraped_count, inserted, updated, skipped, rejected,
      chunk_count, error_message
    """
    history = _load_json(_HISTORY_FILE, [])
    if not isinstance(history, list):
        return []
    return history[-limit:]


# ─── Main pipeline ────────────────────────────────────────────────────────────

def run_scheduled_news_ingestion(
    url: str = "",
    settings: dict = None,
    mode: str = "full",
    incremental: bool = True,
) -> dict:
    """
    Full knowledge ingestion pipeline:
      1. Scrape articles from `url` using scraper.py / kemlu_scraper.py
      2. Merge with existing data/scraped_articles.json (if incremental)
      3. Map articles to AINA knowledge schema (schema_mapper.py)
      4. Write to Supabase knowledge_sources (db_writer.py)
      5. Write chunks to Supabase knowledge_chunks (db_writer.py)

    Args:
        url:         Target URL to scrape. Falls back to config/scheduler_settings.json,
                     then INGESTION_SCRAPE_URL env var. Raises ValueError if none found.
        settings:    Scraper selector settings dict. Loaded from data/settings.json if None.
        mode:        Scrape mode: "full" | "list" | "kb" (default "full").
        incremental: If True, skip articles already in scraped_articles.json.

    Returns dict with:
        started_at, finished_at, status, duration_sec, url,
        scraped_count, inserted, updated, skipped, rejected,
        chunk_count, error_message
    """
    # ── Concurrent-run guard ─────────────────────────────────────────────────
    acquired = _ingestion_lock.acquire(blocking=False)
    if not acquired:
        msg = "Another ingestion run is already in progress — skipping"
        logger.warning(f"[Scheduler] {msg}")
        return {
            "started_at":    _now_iso(),
            "finished_at":   _now_iso(),
            "status":        "skipped_concurrent",
            "duration_sec":  0,
            "url":           url,
            "scraped_count": 0,
            "inserted":      0,
            "updated":       0,
            "skipped":       0,
            "rejected":      0,
            "chunk_count":   0,
            "error_message": msg,
        }

    started_at = _now_iso()
    t0         = time.time()
    resolved_url = url  # preserved for error summary even if resolution fails

    try:
        # ── Step 0: Resolve URL ──────────────────────────────────────────────
        if not url:
            sched_cfg = _load_json(_SCHED_FILE, {})
            url = sched_cfg.get("url", "").strip()
        if not url:
            url = os.environ.get("INGESTION_SCRAPE_URL", "").strip()
        if not url:
            raise ValueError(
                "No scrape URL configured. Set INGESTION_SCRAPE_URL env var "
                "or configure a URL via the Scraper Scheduler settings."
            )
        resolved_url = url

        # ── Step 0b: Load scraper settings ──────────────────────────────────
        if settings is None:
            settings = _load_json(_SETTINGS_FILE, {})

        logger.info(
            f"[Scheduler] start news ingestion | url={url} "
            f"mode={mode} incremental={incremental}"
        )

        # ── Step 1: Scrape ───────────────────────────────────────────────────
        from scraper import scrape_all

        existing_articles = _load_json(_DATA_FILE, []) if incremental else []
        scrape_logs: list[str] = []

        def _progress(msg, **_kwargs):
            scrape_logs.append(str(msg))

        new_articles = scrape_all(
            start_url=url,
            settings=settings,
            mode=mode,
            existing_articles=existing_articles if incremental else None,
            progress_callback=_progress,
        )

        scraped_count = len(new_articles)
        logger.info(f"[Scheduler] scraped={scraped_count}")

        # ── Step 2: Merge + save to shared data file ─────────────────────────
        # Keeps data/scraped_articles.json consistent with the manual flow.
        if incremental and existing_articles:
            existing_urls = {a.get("url") for a in existing_articles}
            merged = existing_articles + [
                a for a in new_articles if a.get("url") not in existing_urls
            ]
        else:
            merged = new_articles

        _save_json(_DATA_FILE, merged)

        # ── Steps 3-5: Map → knowledge_sources → knowledge_chunks ────────────
        from integration.db_writer import ingest_scraped_articles_to_news_knowledge

        ingest_result = ingest_scraped_articles_to_news_knowledge(new_articles)

        inserted    = ingest_result.get("inserted", 0)
        updated     = ingest_result.get("updated", 0)
        skipped     = ingest_result.get("skipped", 0)
        rejected    = ingest_result.get("source_errors", 0)
        chunk_count = ingest_result.get("chunks_inserted", 0)

        logger.info(
            f"[Scheduler] inserted={inserted} updated={updated} "
            f"skipped={skipped} rejected={rejected}"
        )
        logger.info(f"[Scheduler] chunks={chunk_count}")

        duration = _elapsed(t0)
        logger.info(f"[Scheduler] done in {duration}s")

        summary = {
            "started_at":    started_at,
            "finished_at":   _now_iso(),
            "status":        "success",
            "duration_sec":  duration,
            "url":           url,
            "scraped_count": scraped_count,
            "inserted":      inserted,
            "updated":       updated,
            "skipped":       skipped,
            "rejected":      rejected,
            "chunk_count":   chunk_count,
            "error_message": None,
        }

    except Exception as exc:
        duration = _elapsed(t0)
        logger.error(f"[Scheduler] failed: {exc}")
        summary = {
            "started_at":    started_at,
            "finished_at":   _now_iso(),
            "status":        "failed",
            "duration_sec":  duration,
            "url":           resolved_url,
            "scraped_count": 0,
            "inserted":      0,
            "updated":       0,
            "skipped":       0,
            "rejected":      0,
            "chunk_count":   0,
            "error_message": str(exc),
        }

    finally:
        _ingestion_lock.release()

    _save_run_history(summary)
    _push_run_to_supabase(summary)
    return summary


# ─── Supabase run-history sync (opt-in, cross-service) ───────────────────────

def _push_run_to_supabase(summary: dict) -> None:
    """
    Write one ingestion run summary to Supabase table `harvester_runs`.

    Completely opt-in:
      - Only runs if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
      - Any error is logged as a WARNING and silently swallowed — the main
        pipeline result is never affected by this call.
      - Requires 003_harvester_runs.sql migration to be run in Supabase first.

    Fields inserted (all from the `summary` dict):
      started_at, finished_at, status, duration_sec, url,
      scraped_count, inserted, updated, skipped, rejected,
      chunk_count, error_message
    """
    url      = os.environ.get("SUPABASE_URL", "").strip()
    svc_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not svc_key:
        return  # Not configured — skip silently

    try:
        from supabase import create_client
        sb = create_client(url, svc_key)
        payload = {
            "started_at":    summary.get("started_at"),
            "finished_at":   summary.get("finished_at"),
            "status":        summary.get("status", "unknown"),
            "duration_sec":  summary.get("duration_sec", 0),
            "url":           summary.get("url", ""),
            "scraped_count": summary.get("scraped_count", 0),
            "inserted":      summary.get("inserted", 0),
            "updated":       summary.get("updated", 0),
            "skipped":       summary.get("skipped", 0),
            "rejected":      summary.get("rejected", 0),
            "chunk_count":   summary.get("chunk_count", 0),
            "error_message": summary.get("error_message"),
        }
        sb.table("harvester_runs").insert(payload).execute()
        logger.info("[Scheduler] Run summary pushed to Supabase harvester_runs")
    except Exception as exc:
        logger.warning(f"[Scheduler] Could not push run to Supabase (non-fatal): {exc}")


# ─── Optional background scheduler ───────────────────────────────────────────
# Completely separate from app.py's _scheduler (job: "scheduled_scrape").
# Job ID: "knowledge_ingestion"

_pipeline_scheduler = None


def start_ingestion_scheduler() -> bool:
    """
    Start the knowledge ingestion background scheduler.

    Reads ENV:
      ENABLE_SCHEDULED_INGESTION=true       — must be set to activate
      SCHEDULE_INTERVAL_MINUTES=360         — run interval in minutes (default 6h)

    Returns True if scheduler was started, False if disabled or already running.
    """
    global _pipeline_scheduler

    enabled = os.environ.get(
        "ENABLE_SCHEDULED_INGESTION", ""
    ).strip().lower() in ("true", "1", "yes")

    if not enabled:
        logger.info(
            "[Scheduler] ENABLE_SCHEDULED_INGESTION not set — "
            "knowledge ingestion scheduler disabled"
        )
        return False

    if _pipeline_scheduler is not None and _pipeline_scheduler.running:
        logger.info("[Scheduler] Ingestion scheduler already running — no-op")
        return False

    try:
        interval_min = int(os.environ.get("SCHEDULE_INTERVAL_MINUTES", "360"))
    except ValueError:
        interval_min = 360

    from apscheduler.schedulers.background import BackgroundScheduler

    _pipeline_scheduler = BackgroundScheduler(timezone="UTC")
    _pipeline_scheduler.add_job(
        run_scheduled_news_ingestion,
        trigger="interval",
        minutes=interval_min,
        id="knowledge_ingestion",
        replace_existing=True,
        misfire_grace_time=300,
    )
    _pipeline_scheduler.start()
    logger.info(
        f"[Scheduler] Knowledge ingestion scheduler started — "
        f"interval={interval_min} min"
    )
    return True


def stop_ingestion_scheduler() -> None:
    """Gracefully stop the ingestion scheduler if running."""
    global _pipeline_scheduler
    if _pipeline_scheduler and _pipeline_scheduler.running:
        _pipeline_scheduler.shutdown(wait=False)
        _pipeline_scheduler = None
        logger.info("[Scheduler] Knowledge ingestion scheduler stopped")


def is_ingestion_scheduler_running() -> bool:
    """Return True if the background scheduler is active."""
    return _pipeline_scheduler is not None and _pipeline_scheduler.running
