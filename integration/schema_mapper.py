# integration/schema_mapper.py
#
# ADDITIVE ONLY — does not import from or modify any existing scraper module.
# Maps a scraped article dict (output of scraper.py / kemlu_scraper.py) into
# the unified common knowledge schema ready for AINA integration.
#
# Typical input (article dict from scraper.py):
#   { id, url, title, date, content, status, error_reason, mode, summary?, tags? }
#
# Output (common knowledge record):
#   { id, title, source_type, source_name, source_url,
#     summary, tags, status, cleaned_content, created_at }

import re
from datetime import datetime, timezone


# ─── Internal helpers ────────────────────────────────────────────────────────

def _extract_domain(url: str) -> str:
    """
    Extract a human-readable domain/site name from a URL.
    Examples:
      https://www.kemlu.go.id/cairo/berita → kemlu.go.id
      https://pcinu-mesir.or.id/berita/123 → pcinu-mesir.or.id
    """
    if not url:
        return "unknown"
    m = re.search(r"https?://(?:www\.)?([^/?#]+)", url)
    return m.group(1) if m else url[:50]


def _infer_source_name(url: str) -> str:
    """
    Derive a short display name for the source from its URL.
    Known sites get friendly names; others get their cleaned domain.
    """
    domain = _extract_domain(url).lower()
    _KNOWN = {
        "kemlu.go.id":     "KEMLU RI",
        "kbri-cairo.go.id":"KBRI Cairo",
        "pcinu-mesir.or.id":"PCINU Mesir",
        "kmb-kairo.org":   "KMB Kairo",
        "ppmi.or.id":      "PPMI Mesir",
    }
    for key, label in _KNOWN.items():
        if key in domain:
            return label
    return domain


def _now_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _map_scrape_status(scrape_status: str) -> str:
    """
    Map internal scraper status to AINA knowledge_sources status vocabulary.

    Valid values accepted by AINA DB: pending, processing, ready, rejected

    Mapping:
      success → ready       (full content retrieved, siap dipakai)
      partial → pending     (konten tidak lengkap, perlu review)
      failed  → rejected    (tidak bisa dipakai)
      *       → pending     (safe default)
    """
    _MAP = {
        "success": "ready",
        "partial": "pending",
        "failed":  "rejected",
    }
    mapped = _MAP.get(str(scrape_status).lower(), "pending")
    print(f"[Mapper] Status: {scrape_status} → {mapped}")
    return mapped


# ─── Public API ──────────────────────────────────────────────────────────────

def map_article_to_knowledge(article: dict) -> dict:
    """
    Convert a single scraped article dict into the common knowledge schema.

    Args:
        article: dict produced by scraper.py or kemlu_scraper.py.
                 Expected keys: id, url, title, date, content,
                                status, error_reason, summary (optional),
                                tags (optional).

    Returns:
        dict with keys:
            id              — original scraper id (8-char UUID fragment)
            title           — article title (stripped)
            source_type     — always "news"
            source_name     — human-readable site name
            source_url      — original article URL
            summary         — short summary (existing or empty string)
            tags            — list of keyword tags
            status          — "ready" | "pending" | "rejected"  (AINA-compatible)
            cleaned_content — article body text (content field from scraper)
            created_at      — ISO 8601 UTC timestamp of mapping creation

    Note: this function is read-only with respect to all existing data files.
    """
    url           = (article.get("url") or "").strip()
    title         = (article.get("title") or "").strip()
    content       = (article.get("content") or "").strip()
    summary       = (article.get("summary") or "").strip()
    tags          = article.get("tags") or []
    scrape_status = article.get("status", "")

    return {
        "id":              article.get("id", ""),
        "title":           title,
        "source_type":     "news",
        "source_name":     _infer_source_name(url),
        "source_url":      url,
        "summary":         summary,
        "tags":            list(tags) if isinstance(tags, (list, tuple)) else [],
        "status":          _map_scrape_status(scrape_status),
        "cleaned_content": content,
        "created_at":      _now_iso(),
    }


def map_articles_to_knowledge(articles: list) -> list:
    """
    Batch-convert a list of scraped article dicts to knowledge records.

    Filters out articles with status='rejected' so only usable content
    flows into downstream pipelines.  To include rejected articles,
    use map_article_to_knowledge() directly and filter manually.

    Args:
        articles: list of article dicts from scraper.

    Returns:
        list of knowledge record dicts (rejected articles excluded).
    """
    result = []
    for art in articles:
        rec = map_article_to_knowledge(art)
        if rec["status"] != "rejected":
            result.append(rec)
    return result
