# integration/db_writer.py
#
# Phase 2 — ADDITIVE ONLY.
# Writes scraped news articles to two new Supabase tables:
#   - knowledge_sources   (one row per article URL)
#   - knowledge_chunks    (one row per text chunk within an article)
#
# This module does NOT modify any existing file.
# It is NOT called by any existing endpoint or pipeline.
# Existing scraping flow is completely unaffected.
#
# Entry point (opt-in, call explicitly):
#   from integration.db_writer import ingest_scraped_articles_to_news_knowledge
#   result = ingest_scraped_articles_to_news_knowledge(articles)
#
# Requires: integration/migrations/001_knowledge_tables.sql run first in Supabase.
# Uses the same env vars as db_services.py: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import os
import json
import hashlib
import logging
from datetime import datetime, timezone

from integration.schema_mapper import map_article_to_knowledge
from integration.chunker import chunk_knowledge_record

logger = logging.getLogger(__name__)


# ─── Supabase connection (independent from db_services.py) ──────────────────
# Uses the same env vars but maintains its own client instance so there is
# zero coupling to the existing db_services module.

_writer_client = None


def _get_supabase():
    """
    Return a Supabase client using the same credentials as the existing
    pipeline (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
    Raises RuntimeError if env vars are missing or package not installed.
    """
    global _writer_client
    if _writer_client is None:
        url = os.environ.get("SUPABASE_URL")
        key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_KEY")
        )
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY diperlukan "
                "untuk integration/db_writer. Pastikan env vars sudah di-set."
            )
        try:
            from supabase import create_client
            _writer_client = create_client(url, key)
        except ImportError:
            raise RuntimeError(
                "Package 'supabase' belum terinstall. Jalankan: pip install supabase"
            )
    return _writer_client


# ─── Content hash ────────────────────────────────────────────────────────────

def _content_hash(title: str, content: str) -> str:
    """
    Compute a short MD5 hex digest of title + content.
    Used to detect whether an article has actually changed since last ingest.
    """
    raw = f"{title}||{content}".encode("utf-8")
    return hashlib.md5(raw).hexdigest()


# ─── knowledge_sources helpers ───────────────────────────────────────────────

def _fetch_source_by_url(sb, source_url: str) -> dict | None:
    """
    Fetch an existing knowledge_sources row by source_url.
    Returns the row dict or None if not found.
    """
    if not source_url:
        return None
    try:
        res = (
            sb.table("knowledge_sources")
            .select("id, content_hash")
            .eq("source_url", source_url)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as e:
        logger.error(f"[DB_WRITER] Fetch by URL error: {e}")
        return None


def _insert_source(sb, record: dict, content_hash: str) -> str | None:
    """
    Insert a new row into knowledge_sources.
    Returns the DB-generated UUID string, or None on error.
    """
    payload = {
        "title":           (record.get("title") or "")[:200],
        "source_type":     record.get("source_type", "news"),
        "source_name":     record.get("source_name", ""),
        "source_url":      record.get("source_url", ""),
        "summary":         (record.get("summary") or "")[:600],
        "tags":            record.get("tags", []),
        "status":          record.get("status", "pending"),
        "cleaned_content": record.get("cleaned_content", ""),
        "content_hash":    content_hash,
        "updated_at":      datetime.now(tz=timezone.utc).isoformat(),
    }
    # Remove empty optional strings to use DB defaults where sensible
    payload = {k: v for k, v in payload.items() if v != ""}

    try:
        res = sb.table("knowledge_sources").insert(payload).execute()
        rows = res.data or []
        if rows:
            inserted_id = rows[0].get("id")
            logger.info(f"[DB_WRITER] Inserted source: {payload.get('title','')[:60]}")
            return inserted_id
        logger.warning(f"[DB_WRITER] Insert returned no data for: {payload.get('title','')[:60]}")
        return None
    except Exception as e:
        logger.error(f"[DB_WRITER] Insert source error: {e}")
        return None


def _update_source(sb, source_id: str, record: dict, content_hash: str) -> bool:
    """
    Update an existing knowledge_sources row with new content.
    Returns True on success.
    """
    payload = {
        "title":           (record.get("title") or "")[:200],
        "source_name":     record.get("source_name", ""),
        "summary":         (record.get("summary") or "")[:600],
        "tags":            record.get("tags", []),
        "status":          record.get("status", "pending"),
        "cleaned_content": record.get("cleaned_content", ""),
        "content_hash":    content_hash,
        "updated_at":      datetime.now(tz=timezone.utc).isoformat(),
    }
    try:
        sb.table("knowledge_sources").update(payload).eq("id", source_id).execute()
        logger.info(f"[DB_WRITER] Updated source id={source_id[:8]}: {payload.get('title','')[:60]}")
        return True
    except Exception as e:
        logger.error(f"[DB_WRITER] Update source error id={source_id}: {e}")
        return False


# ─── knowledge_chunks helpers ────────────────────────────────────────────────

def _delete_chunks_for_source(sb, source_id: str) -> int:
    """
    Delete all existing chunks for a source_id.
    Returns number of rows deleted (best-effort count).
    """
    try:
        res = (
            sb.table("knowledge_chunks")
            .delete()
            .eq("source_id", source_id)
            .execute()
        )
        deleted = len(res.data or [])
        logger.info(f"[DB_WRITER] Deleted {deleted} chunks for source_id={source_id[:8]}")
        return deleted
    except Exception as e:
        logger.error(f"[DB_WRITER] Delete chunks error for source_id={source_id}: {e}")
        return 0


def _insert_chunks(sb, source_id: str, chunks: list) -> tuple[int, list[str]]:
    """
    Insert a list of chunk dicts into knowledge_chunks.
    Overrides source_id in each chunk with the DB-assigned UUID.

    Returns:
        (inserted_count, error_messages)
    """
    inserted = 0
    errors: list[str] = []

    for chunk in chunks:
        payload = {
            "source_id":     source_id,
            "chunk_index":   chunk.get("chunk_index", 0),
            "chunk_text":    chunk.get("chunk_text", ""),
            "chunk_summary": chunk.get("chunk_summary", ""),
            "topic":         chunk.get("topic", ""),
            "metadata_json": chunk.get("metadata_json", {}),
        }
        if not payload["chunk_text"]:
            continue
        try:
            res = sb.table("knowledge_chunks").insert(payload).execute()
            if res.data:
                inserted += 1
            else:
                errors.append(
                    f"chunk_index={payload['chunk_index']} returned no data"
                )
        except Exception as e:
            msg = str(e)[:120]
            errors.append(f"chunk_index={payload['chunk_index']}: {msg}")
            logger.error(f"[DB_WRITER] Chunk insert error: {msg}")

    return inserted, errors


# ─── Per-record ingest ────────────────────────────────────────────────────────

def _ingest_one(sb, record: dict, chunk_size: int) -> dict:
    """
    Ingest a single knowledge record into knowledge_sources + knowledge_chunks.

    Duplicate / update logic:
      - No existing row → INSERT source + INSERT chunks
      - Existing row, same content_hash → SKIP (no write)
      - Existing row, different content_hash → UPDATE source + DELETE old chunks + INSERT new chunks

    Returns a result dict: { action, source_id, chunks_inserted, chunk_errors }
    """
    source_url   = record.get("source_url", "")
    title        = record.get("title", "")
    content      = record.get("cleaned_content", "")
    hash_now     = _content_hash(title, content)

    existing = _fetch_source_by_url(sb, source_url)

    if existing is None:
        # ── New article ──────────────────────────────────────────────────────
        source_id = _insert_source(sb, record, hash_now)
        if not source_id:
            return {"action": "error", "source_id": None,
                    "chunks_inserted": 0, "chunk_errors": ["source insert failed"]}

        chunks = chunk_knowledge_record(record, chunk_size=chunk_size)
        ins, errs = _insert_chunks(sb, source_id, chunks)
        return {"action": "inserted", "source_id": source_id,
                "chunks_inserted": ins, "chunk_errors": errs}

    db_id   = existing["id"]
    db_hash = existing.get("content_hash", "")

    if db_hash == hash_now:
        # ── No content change ────────────────────────────────────────────────
        logger.info(f"[DB_WRITER] Skipped (unchanged): {title[:60]}")
        return {"action": "skipped", "source_id": db_id,
                "chunks_inserted": 0, "chunk_errors": []}

    # ── Content changed — update source and replace chunks ───────────────────
    _update_source(sb, db_id, record, hash_now)
    _delete_chunks_for_source(sb, db_id)
    chunks = chunk_knowledge_record(record, chunk_size=chunk_size)
    ins, errs = _insert_chunks(sb, db_id, chunks)
    return {"action": "updated", "source_id": db_id,
            "chunks_inserted": ins, "chunk_errors": errs}


# ─── Public API ──────────────────────────────────────────────────────────────

def ingest_scraped_articles_to_news_knowledge(
    articles: list,
    chunk_size: int = 600,
    skip_failed: bool = True,
) -> dict:
    """
    OPT-IN high-level function.  NOT called by any existing endpoint.

    Maps scraped article dicts to the knowledge schema, then writes them to
    Supabase tables knowledge_sources and knowledge_chunks.

    Args:
        articles:     List of article dicts from scraper.py / kemlu_scraper.py.
                      Same format as stored in data/scraped_articles.json.
        chunk_size:   Target characters per chunk (default 600).
        skip_failed:  If True (default), skip articles with status='rejected'.
                      Set False to ingest rejected articles too.

    Returns dict:
        {
          "inserted":        int,   # new sources added
          "updated":         int,   # existing sources updated (content changed)
          "skipped":         int,   # sources unchanged (same content hash)
          "source_errors":   int,   # articles that failed to insert/update
          "chunks_inserted": int,   # total chunks written
          "chunk_errors":    list,  # list of error message strings
          "details":         list,  # per-article action summary
        }

    Guarantees:
      - Existing scraping flow is NOT affected (this function is never called
        automatically — it must be called explicitly by the caller).
      - Duplicate articles (same source_url) are detected and skipped or updated
        rather than double-inserted.
      - If a source's content changed, its old chunks are fully replaced.
      - Failed articles are excluded by default (skip_failed=True).
    """
    sb = _get_supabase()

    totals = {
        "inserted": 0,
        "updated":  0,
        "skipped":  0,
        "source_errors": 0,
        "chunks_inserted": 0,
        "chunk_errors": [],
        "details": [],
    }

    for raw_article in articles:
        # Map to knowledge schema
        record = map_article_to_knowledge(raw_article)

        # Skip rejected articles if requested
        if skip_failed and record["status"] == "rejected":
            totals["skipped"] += 1
            totals["details"].append({
                "url": record.get("source_url", ""),
                "action": "skipped_rejected",
            })
            continue

        # Skip if no content at all (nothing to chunk)
        if not record.get("cleaned_content", "").strip():
            totals["skipped"] += 1
            totals["details"].append({
                "url": record.get("source_url", ""),
                "action": "skipped_empty",
            })
            continue

        result = _ingest_one(sb, record, chunk_size)

        action = result.get("action", "error")
        if action == "inserted":
            totals["inserted"] += 1
        elif action == "updated":
            totals["updated"] += 1
        elif action == "skipped":
            totals["skipped"] += 1
        else:
            totals["source_errors"] += 1

        totals["chunks_inserted"] += result.get("chunks_inserted", 0)
        totals["chunk_errors"].extend(result.get("chunk_errors", []))
        totals["details"].append({
            "url":             record.get("source_url", ""),
            "title":           record.get("title", "")[:60],
            "action":          action,
            "source_id":       result.get("source_id"),
            "chunks_inserted": result.get("chunks_inserted", 0),
        })

    logger.info(
        f"[DB_WRITER] Ingest complete — "
        f"inserted={totals['inserted']}, updated={totals['updated']}, "
        f"skipped={totals['skipped']}, errors={totals['source_errors']}, "
        f"chunks={totals['chunks_inserted']}"
    )
    return totals
