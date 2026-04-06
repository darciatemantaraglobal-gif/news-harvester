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
#     summary, tags, status, cleaned_content,
#     created_at, published_at, scraped_at,
#     source_category, source_trust_hint }

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


_INDONESIAN_MONTHS = {
    "januari": 1, "februari": 2, "maret": 3, "april": 4,
    "mei": 5, "juni": 6, "juli": 7, "agustus": 8,
    "september": 9, "oktober": 10, "november": 11, "desember": 12,
}


def _normalize_published_at(date_str: str) -> str | None:
    """
    Normalize various date string formats from scrapers to ISO 8601 UTC.

    Handles:
      "2025-01-15"           → "2025-01-15T00:00:00Z"
      "2025-01-15T12:30:00"  → "2025-01-15T12:30:00Z"
      "15 Januari 2025"      → "2025-01-15T00:00:00Z"
      ""  / None             → None  (caller should omit field)
    """
    if not date_str:
        return None
    s = str(date_str).strip()
    if not s:
        return None

    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}))?", s)
    if m:
        date_part = m.group(1)
        time_part = m.group(2) or "00:00:00"
        try:
            dt = datetime.strptime(f"{date_part}T{time_part}", "%Y-%m-%dT%H:%M:%S")
            return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            pass

    m2 = re.match(r"(\d{1,2})\s+(\w+)\s+(\d{4})", s.lower())
    if m2:
        day, month_name, year = int(m2.group(1)), m2.group(2), int(m2.group(3))
        month = _INDONESIAN_MONTHS.get(month_name)
        if month:
            try:
                dt = datetime(year, month, day, tzinfo=timezone.utc)
                return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                pass

    return None


def _infer_source_category(url: str) -> str:
    """
    Classify the news source into a broad category for smart retrieval.

    Categories:
      official_news   — Government portals (kemlu, kbri, .go.id)
      community_news  — Diaspora/student orgs (pcinu, kmb, ppmi, ppi)
      article         — All other sources (default)
    """
    domain = _extract_domain(url).lower()
    if "kemlu.go.id" in domain or "kbri" in domain or domain.endswith(".go.id"):
        return "official_news"
    if any(k in domain for k in ["pcinu", "kmb-", "ppmi", "ppi-", ".or.id"]):
        return "community_news"
    return "article"


def _infer_trust_hint(url: str) -> str:
    """
    Assign a lightweight trust signal based on the source domain.

    Levels:
      high    — Indonesian government sources (.go.id, kemlu, kbri)
      medium  — Known diaspora organizations (.or.id, pcinu, kmb, ppmi, ppi)
      default — All other sources
    """
    domain = _extract_domain(url).lower()
    if "kemlu.go.id" in domain or "kbri" in domain or domain.endswith(".go.id"):
        return "high"
    if any(k in domain for k in ["pcinu", "kmb-", "ppmi", "ppi-", ".or.id"]):
        return "medium"
    return "default"


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
            id                — original scraper id (8-char UUID fragment)
            title             — article title (stripped)
            source_type       — always "news"
            source_name       — human-readable site name
            source_url        — original article URL
            summary           — short summary (existing or empty string)
            tags              — list of keyword tags
            status            — "ready" | "pending" | "rejected"  (AINA-compatible)
            cleaned_content   — article body text (content field from scraper)
            created_at        — ISO 8601 UTC timestamp of mapping creation
            published_at      — normalized article publish date (from scraper's date
                                field); None if date is missing or unparseable
            scraped_at        — alias for created_at (scraper run time approximation)
            source_category   — "official_news" | "community_news" | "article"
            source_trust_hint — "high" | "medium" | "default"

    Note: this function is read-only with respect to all existing data files.
    """
    url           = (article.get("url") or "").strip()
    title         = (article.get("title") or "").strip()
    content       = (article.get("content") or "").strip()
    summary       = (article.get("summary") or "").strip()
    tags          = article.get("tags") or []
    scrape_status = article.get("status", "")
    now           = _now_iso()
    published_at  = _normalize_published_at(article.get("date", ""))

    record = {
        "id":                article.get("id", ""),
        "title":             title,
        "source_type":       "news",
        "source_name":       _infer_source_name(url),
        "source_url":        url,
        "summary":           summary,
        "tags":              list(tags) if isinstance(tags, (list, tuple)) else [],
        "status":            _map_scrape_status(scrape_status),
        "cleaned_content":   content,
        "created_at":        now,
        "scraped_at":        now,
        "source_category":   _infer_source_category(url),
        "source_trust_hint": _infer_trust_hint(url),
    }
    if published_at:
        record["published_at"] = published_at
    return record


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
