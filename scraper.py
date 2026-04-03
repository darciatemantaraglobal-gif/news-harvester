# scraper.py — Modul scraping modular dengan selector dinamis, cleaning, deduplication
import re
import uuid
import requests
from urllib.parse import urljoin

from utils import get_soup, delay, BLOCKED_CODES
from content_cleaner import clean_text

DEFAULT_SETTINGS = {
    "article_link_selector": 'a[href*="/berita/"]',
    "next_page_selector": 'a[rel="next"], a.next, .pagination a',
    "title_selector": "h1, h2, .title, .news-title, .post-title",
    "date_selector": ".date, .news-date, time, .published-date, .post-date",
    "content_selector": ".ck-content, .post-content, .news-content, .article-content, .content, article, .entry-content",
}


def _parse_selectors(raw: str) -> list[str]:
    """Pisah string selector berdasarkan koma (trim tiap item)."""
    return [s.strip() for s in raw.split(",") if s.strip()]


def _find_first(soup, selectors: list[str]) -> str:
    """Coba setiap selector, return text dari yang pertama cocok."""
    for sel in selectors:
        try:
            el = soup.select_one(sel)
            if el:
                text = el.get_text(separator="\n", strip=True)
                if text.strip():
                    return text
        except Exception:
            continue
    return ""


def extract_article_links(soup, base_url: str, selectors: list[str]) -> list[str]:
    """Ambil semua link artikel dari halaman list menggunakan selector dinamis."""
    links = []
    seen = set()
    for sel in selectors:
        try:
            for a in soup.select(sel):
                href = a.get("href", "")
                if not href:
                    continue
                full = urljoin(base_url, href)
                if full not in seen and full != base_url and full.startswith("http"):
                    seen.add(full)
                    links.append(full)
        except Exception:
            continue
    return links


def find_next_page(soup, base_url: str, selectors: list[str]) -> str | None:
    """Temukan link halaman selanjutnya menggunakan text-based + selector dinamis."""
    for a in soup.select("a[href]"):
        try:
            text = a.get_text(strip=True).lower()
            rel = a.get("rel", [])
            if text in ("next", "›", "»", ">", "selanjutnya", "berikutnya") or "next" in rel:
                href = a.get("href", "")
                if href:
                    return urljoin(base_url, href)
        except Exception:
            continue

    for sel in selectors:
        try:
            el = soup.select_one(sel)
            if el and el.get("href"):
                return urljoin(base_url, el["href"])
        except Exception:
            continue

    return None


def _classify_request_error(exc: Exception) -> str:
    """Klasifikasikan exception menjadi error_reason string."""
    if isinstance(exc, requests.exceptions.Timeout):
        return "timeout"
    if isinstance(exc, requests.exceptions.HTTPError):
        code = exc.response.status_code if exc.response is not None else 0
        if code in BLOCKED_CODES:
            return "blocked"
        return "request_failed"
    if isinstance(exc, requests.exceptions.ConnectionError):
        return "request_failed"
    return "parse_failed"


def extract_article_detail(url: str, settings: dict, mode: str = "full") -> dict:
    """
    Scrape satu artikel. Tidak pernah raise exception — selalu return dict.
    Errors dikumpulkan di field error_reason.

    mode:
      - 'list' → hanya title, date, url
      - 'full' → title, date, url, full content
      - 'kb'   → same as full + kb_ready=True
    """
    article = {
        "id": str(uuid.uuid4())[:8],
        "url": url,
        "title": "",
        "date": "",
        "content": "",
        "status": "success",
        "error_reason": "",
        "mode": mode,
    }

    title_sels = _parse_selectors(settings.get("title_selector", DEFAULT_SETTINGS["title_selector"]))
    date_sels = _parse_selectors(settings.get("date_selector", DEFAULT_SETTINGS["date_selector"]))
    content_sels = _parse_selectors(settings.get("content_selector", DEFAULT_SETTINGS["content_selector"]))

    try:
        soup = get_soup(url)

        article["title"] = _find_first(soup, title_sels)
        article["date"] = _find_first(soup, date_sels)

        if mode in ("full", "kb"):
            raw_content = _find_first(soup, content_sels)
            article["content"] = clean_text(raw_content)

        if mode == "kb":
            article["kb_ready"] = True

        # Tentukan status & error_reason
        if mode == "list":
            if not article["title"]:
                article["status"] = "partial"
                article["error_reason"] = "selector_not_found"
        else:
            has_title = bool(article["title"])
            has_content = bool(article["content"])

            if not has_title and not has_content:
                article["status"] = "failed"
                article["error_reason"] = "selector_not_found"
            elif not has_title:
                article["status"] = "partial"
                article["error_reason"] = "selector_not_found"
            elif not has_content:
                article["status"] = "partial"
                article["error_reason"] = "empty_content"

    except Exception as exc:
        article["status"] = "failed"
        article["error_reason"] = _classify_request_error(exc)
        article["content"] = ""

    return article


def scrape_all(
    start_url: str,
    settings: dict = None,
    mode: str = "full",
    existing_articles: list = None,
    progress_callback=None,
):
    """
    Scrape semua artikel dari halaman list + pagination.
    - settings: dict dari /settings endpoint
    - mode: 'list' | 'full' | 'kb'
    - existing_articles: artikel yang sudah ada (untuk cross-run deduplication)
    - Satu artikel error tidak menghentikan proses scraping
    """
    if settings is None:
        settings = DEFAULT_SETTINGS

    link_sels = _parse_selectors(settings.get("article_link_selector", DEFAULT_SETTINGS["article_link_selector"]))
    next_sels = _parse_selectors(settings.get("next_page_selector", DEFAULT_SETTINGS["next_page_selector"]))

    def log(msg, **kwargs):
        if progress_callback:
            progress_callback(msg, **kwargs)

    # Build deduplication sets dari artikel yang sudah ada
    seen_urls: set[str] = set()
    seen_title_date: set[tuple] = set()
    if existing_articles:
        for a in existing_articles:
            if a.get("url"):
                seen_urls.add(a["url"])
            t = a.get("title", "").strip()
            d = a.get("date", "").strip()
            if t and d:
                seen_title_date.add((t, d))

    all_articles = []
    page_url = start_url
    page_num = 0
    all_links = []
    duplicate_count = 0

    # Phase 1: Kumpulkan semua link dari pagination
    log("Mulai mengumpulkan link artikel...", phase="listing")
    while page_url:
        page_num += 1
        log(f"Membuka halaman list #{page_num}: {page_url}", phase="listing")
        try:
            soup = get_soup(page_url)
            links = extract_article_links(soup, start_url, link_sels)
            log(f"Ditemukan {len(links)} link di halaman #{page_num}", phase="listing")
            all_links.extend(links)
            all_links = list(dict.fromkeys(all_links))  # deduplicate URLs
            page_url = find_next_page(soup, page_url, next_sels)
            if page_url:
                delay()
        except Exception as e:
            log(f"Error di halaman #{page_num}: {str(e)}", phase="listing")
            break

    total = len(all_links)
    log(f"Total {total} link artikel ditemukan. Mulai scraping mode={mode}...", phase="scraping", total=total)

    # Phase 2: Scrape setiap artikel
    for i, link in enumerate(all_links):
        log(f"[{i+1}/{total}] Scraping: {link}", phase="scraping", current=i + 1, total=total)

        # Cek duplikat URL sebelum scraping
        if link in seen_urls:
            duplicate_count += 1
            log(
                f"  ⊘ DUPLICATE (URL): {link[:70]}",
                phase="scraping", current=i + 1, total=total,
                duplicate=duplicate_count,
            )
            delay()
            continue

        # Scrape artikel (tidak akan raise)
        article = extract_article_detail(link, settings=settings, mode=mode)

        # Cek duplikat title+date
        t = article.get("title", "").strip()
        d = article.get("date", "").strip()
        if t and d and (t, d) in seen_title_date:
            duplicate_count += 1
            log(
                f"  ⊘ DUPLICATE (title+date): {t[:60]}",
                phase="scraping", current=i + 1, total=total,
                duplicate=duplicate_count,
            )
            delay()
            continue

        # Tambahkan ke sets
        seen_urls.add(link)
        if t and d:
            seen_title_date.add((t, d))

        all_articles.append(article)

        status_icons = {"success": "✓", "partial": "◐", "failed": "✗"}
        icon = status_icons.get(article["status"], "?")
        reason = f" [{article['error_reason']}]" if article.get("error_reason") else ""
        log(
            f"  {icon} {article['status'].upper()}{reason}: {article.get('title', '(no title)')[:60]}",
            phase="scraping", current=i + 1, total=total,
            duplicate=duplicate_count,
        )
        delay()

    success = sum(1 for a in all_articles if a["status"] == "success")
    partial = sum(1 for a in all_articles if a["status"] == "partial")
    failed = sum(1 for a in all_articles if a["status"] == "failed")
    log(
        f"Selesai! {success} berhasil, {partial} partial, {failed} gagal, {duplicate_count} duplikat.",
        phase="done", total=total,
        success=success, partial=partial, failed=failed, duplicate=duplicate_count,
    )

    return all_articles
