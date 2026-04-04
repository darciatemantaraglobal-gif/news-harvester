"""
kemlu_scraper.py — Special scraper untuk kemlu.go.id (SPA berbasis Vue.js)
Menggunakan internal REST API backpanel.kemlu.go.id karena halaman utama
tidak bisa di-scrape dengan BeautifulSoup (JavaScript-rendered).
"""
import re
import uuid
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from content_cleaner import clean_text
from utils import delay

KEMLU_API = "https://backpanel.kemlu.go.id/public-content-service/api"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}
TIMEOUT = 20


def is_kemlu_url(url: str) -> bool:
    return "kemlu.go.id" in url


def extract_mission_slug(url: str) -> str | None:
    """
    Ekstrak mission slug dari URL kemlu.go.id.
    Contoh: https://www.kemlu.go.id/cairo/berita → 'cairo'
    """
    m = re.search(r"kemlu\.go\.id/([^/?#]+)", url)
    if m:
        slug = m.group(1).strip("/")
        if slug and slug not in ("berita", "publikasi", "rss", "feed"):
            return slug
    return None


def _get_slider_articles(mission: str) -> list[dict]:
    """Ambil artikel dari slider berita (featured articles)."""
    articles = []
    try:
        r = requests.get(
            f"{KEMLU_API}/content/home",
            params={"slug": mission, "sub": "berita"},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if not r.ok:
            return articles
        data = r.json().get("data", {})
        for section in data.get("content", []):
            for item in section.get("list_content", []):
                slug = item.get("slug")
                if slug:
                    articles.append({
                        "slug": slug,
                        "title": item.get("title", ""),
                        "publish_date": item.get("publish_date", ""),
                        "url": f"https://www.kemlu.go.id/{mission}/berita/{slug}",
                    })
    except Exception:
        pass
    return articles


def _get_section_articles(mission: str, existing_slugs: set) -> list[dict]:
    """Ambil artikel tambahan dari content sections (non-slider)."""
    articles = []
    try:
        r = requests.get(
            f"{KEMLU_API}/content/home-content",
            params={"mission": mission},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if not r.ok:
            return articles

        for section in r.json().get("data", []):
            if section.get("consumed_type") != "publication":
                continue
            content_id = section.get("content_id")
            if not content_id:
                continue
            try:
                r2 = requests.get(
                    f"{KEMLU_API}/content/{content_id}",
                    headers=HEADERS,
                    timeout=TIMEOUT,
                )
                if not r2.ok:
                    continue
                content_data = r2.json().get("data", {})
                for sub in content_data.get("content", []):
                    for item in sub.get("list_content", []):
                        slug = item.get("slug")
                        if slug and slug not in existing_slugs:
                            existing_slugs.add(slug)
                            articles.append({
                                "slug": slug,
                                "title": item.get("title", ""),
                                "publish_date": item.get("publish_date", ""),
                                "url": f"https://www.kemlu.go.id/{mission}/berita/{slug}",
                            })
                delay()
            except Exception:
                continue
    except Exception:
        pass
    return articles


def get_article_detail(mission: str, article: dict, mode: str) -> dict:
    """
    Ambil konten lengkap artikel dari kemlu.go.id API.
    """
    slug = article["slug"]
    result = {
        "id": str(uuid.uuid4())[:8],
        "url": article["url"],
        "title": article["title"],
        "date": article["publish_date"],
        "content": "",
        "status": "success",
        "error_reason": "",
        "mode": mode,
    }

    if mode == "list":
        if not result["title"]:
            result["status"] = "partial"
            result["error_reason"] = "selector_not_found"
        return result

    try:
        r = requests.get(
            f"{KEMLU_API}/content/publication",
            params={"portal": mission, "slug": slug},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        if r.ok:
            data = r.json().get("data", {})
            if data.get("title"):
                result["title"] = data["title"]
            if data.get("publish_date"):
                result["date"] = data["publish_date"]

            html_content = data.get("content_detail") or data.get("headline", "")
            if html_content:
                soup = BeautifulSoup(html_content, "lxml")
                result["content"] = clean_text(soup.get_text(separator="\n", strip=True))
        else:
            result["status"] = "partial"
            result["error_reason"] = "request_failed"
    except Exception as e:
        result["status"] = "partial"
        result["error_reason"] = "request_failed"

    if not result["title"] and not result["content"]:
        result["status"] = "failed"
        result["error_reason"] = "selector_not_found"
    elif not result["content"]:
        result["status"] = "partial"
        result["error_reason"] = "empty_content"
    elif not result["title"]:
        result["status"] = "partial"
        result["error_reason"] = "selector_not_found"

    return result


def scrape_kemlu(
    start_url: str,
    mode: str = "full",
    existing_articles: list = None,
    progress_callback=None,
    start_date=None,
    end_date=None,
    article_callback=None,
) -> list[dict]:
    """
    Entry point scraping kemlu.go.id.
    Menggantikan scrape_all() ketika URL terdeteksi sebagai kemlu.go.id.
    """
    from scraper import date_in_range

    def log(msg, **kwargs):
        if progress_callback:
            progress_callback(msg, **kwargs)

    mission = extract_mission_slug(start_url)
    if not mission:
        log("Tidak bisa mendeteksi mission dari URL kemlu.go.id.", phase="done",
            total=0, success=0, partial=0, failed=0, duplicate=0)
        return []

    log(f"Terdeteksi sebagai kemlu.go.id — mission: {mission}", phase="listing")
    log("Mengambil daftar artikel dari API kemlu.go.id...", phase="listing")

    # Kumpulkan article slugs untuk deduplikasi
    seen_slugs: set = set()
    seen_urls: set = set()
    seen_title_date: set = set()
    if existing_articles:
        for a in existing_articles:
            if a.get("url"):
                seen_urls.add(a["url"])
            t = a.get("title", "").strip()
            d = a.get("date", "").strip()
            if t and d:
                seen_title_date.add((t, d))

    # Phase 1: Kumpulkan link artikel
    slider_articles = _get_slider_articles(mission)
    log(f"Ditemukan {len(slider_articles)} link di halaman #1 (slider berita)", phase="listing")

    for a in slider_articles:
        seen_slugs.add(a["slug"])

    extra_articles = _get_section_articles(mission, seen_slugs.copy())
    log(f"Ditemukan {len(extra_articles)} link tambahan dari sections", phase="listing")

    all_article_stubs = slider_articles + extra_articles
    total = len(all_article_stubs)
    log(f"Total {total} link artikel ditemukan. Mulai scraping mode={mode}...",
        phase="scraping", total=total)

    if total == 0:
        log("Selesai! 0 berhasil, 0 partial, 0 gagal, 0 duplikat.",
            phase="done", total=0, success=0, partial=0, failed=0, duplicate=0)
        return []

    # Phase 2: Scrape detail setiap artikel
    all_articles = []
    duplicate_count = 0

    for i, stub in enumerate(all_article_stubs):
        log(f"[{i+1}/{total}] Scraping: {stub['url']}", phase="scraping",
            current=i + 1, total=total)

        # Cek duplikat URL
        if stub["url"] in seen_urls:
            duplicate_count += 1
            log(f"  ⊘ DUPLICATE (URL): {stub['url'][:70]}", phase="scraping",
                current=i + 1, total=total, duplicate=duplicate_count)
            delay()
            continue

        article = get_article_detail(mission, stub, mode)

        # Cek duplikat title+date
        t = article.get("title", "").strip()
        d = article.get("date", "").strip()
        if t and d and (t, d) in seen_title_date:
            duplicate_count += 1
            log(f"  ⊘ DUPLICATE (title+date): {t[:60]}", phase="scraping",
                current=i + 1, total=total, duplicate=duplicate_count)
            delay()
            continue

        # Date range filter
        if start_date is not None or end_date is not None:
            dr = date_in_range(article.get("date", ""), start_date, end_date)
            if dr == "out":
                log(f"  ⊘ OUT OF RANGE: {t[:60]}", phase="scraping",
                    current=i + 1, total=total, duplicate=duplicate_count)
                delay()
                continue
            elif dr == "unknown":
                if article.get("status") == "success":
                    article["status"] = "partial"
                if not article.get("error_reason"):
                    article["error_reason"] = "date_unknown"

        seen_urls.add(stub["url"])
        if t and d:
            seen_title_date.add((t, d))

        all_articles.append(article)
        if article_callback:
            article_callback(article)

        icons = {"success": "✓", "partial": "◐", "failed": "✗"}
        icon = icons.get(article["status"], "?")
        reason = f" [{article['error_reason']}]" if article.get("error_reason") else ""
        log(f"  {icon} {article['status'].upper()}{reason}: {t[:60]}",
            phase="scraping", current=i + 1, total=total, duplicate=duplicate_count)
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
