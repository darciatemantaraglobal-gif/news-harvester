# scraper.py — Modul scraping modular dengan selector dinamis
import re, uuid
from urllib.parse import urljoin
from utils import get_soup, delay

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
                if text:
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
                # Pastikan link berbeda dari halaman list itu sendiri dan belum ada
                if full not in seen and full != base_url and full.startswith("http"):
                    seen.add(full)
                    links.append(full)
        except Exception:
            continue
    return links


def find_next_page(soup, base_url: str, selectors: list[str]) -> str | None:
    """Temukan link halaman selanjutnya menggunakan selector dinamis + teks umum."""
    # Coba text-based navigation dulu (universal)
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

    # Coba selector dari settings
    for sel in selectors:
        try:
            el = soup.select_one(sel)
            if el and el.get("href"):
                return urljoin(base_url, el["href"])
        except Exception:
            continue

    return None


def extract_article_detail(url: str, settings: dict, mode: str = "full") -> dict:
    """
    Scrape satu artikel.
    mode:
      - 'list'  → hanya title, date, url (no content fetch)
      - 'full'  → title, date, url, full content
      - 'kb'    → same as full, tambah flag kb_ready=True
    """
    article = {
        "id": str(uuid.uuid4())[:8],
        "url": url,
        "title": "",
        "date": "",
        "content": "",
        "status": "success",
        "mode": mode,
    }

    title_sels = _parse_selectors(settings.get("title_selector", DEFAULT_SETTINGS["title_selector"]))
    date_sels = _parse_selectors(settings.get("date_selector", DEFAULT_SETTINGS["date_selector"]))
    content_sels = _parse_selectors(settings.get("content_selector", DEFAULT_SETTINGS["content_selector"]))

    try:
        soup = get_soup(url)
        if not soup:
            article["status"] = "failed"
            return article

        article["title"] = _find_first(soup, title_sels)
        article["date"] = _find_first(soup, date_sels)

        if mode in ("full", "kb"):
            article["content"] = _find_first(soup, content_sels)

        if mode == "kb":
            article["kb_ready"] = True

        # Tentukan status
        if mode == "list":
            article["status"] = "success" if article["title"] else "partial"
        else:
            if not article["title"] and not article["content"]:
                article["status"] = "failed"
            elif not article["title"] or not article["content"]:
                article["status"] = "partial"

    except Exception as e:
        article["status"] = "failed"
        article["content"] = f"Error: {str(e)}"

    return article


def scrape_all(start_url: str, settings: dict = None, mode: str = "full", progress_callback=None):
    """
    Scrape semua artikel dari halaman list + pagination.
    settings: dict dari /settings endpoint
    mode: 'list' | 'full' | 'kb'
    """
    if settings is None:
        settings = DEFAULT_SETTINGS

    link_sels = _parse_selectors(settings.get("article_link_selector", DEFAULT_SETTINGS["article_link_selector"]))
    next_sels = _parse_selectors(settings.get("next_page_selector", DEFAULT_SETTINGS["next_page_selector"]))

    def log(msg, **kwargs):
        if progress_callback:
            progress_callback(msg, **kwargs)

    all_articles = []
    page_url = start_url
    page_num = 0
    all_links = []

    # Phase 1: Kumpulkan semua link dari pagination
    log("Mulai mengumpulkan link artikel...", phase="listing")
    while page_url:
        page_num += 1
        log(f"Membuka halaman list #{page_num}: {page_url}", phase="listing")
        try:
            soup = get_soup(page_url)
            if not soup:
                log(f"Gagal membuka halaman #{page_num}", phase="listing")
                break
            links = extract_article_links(soup, start_url, link_sels)
            log(f"Ditemukan {len(links)} link di halaman #{page_num}", phase="listing")
            all_links.extend(links)
            # Deduplicate across pages
            all_links = list(dict.fromkeys(all_links))
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
        log(f"[{i+1}/{total}] Scraping: {link}", phase="scraping", current=i+1, total=total)
        article = extract_article_detail(link, settings=settings, mode=mode)
        all_articles.append(article)
        status_icon = "✓" if article["status"] == "success" else ("◐" if article["status"] == "partial" else "✗")
        log(f"  {status_icon} {article['status'].upper()}: {article.get('title','(no title)')[:60]}", phase="scraping", current=i+1, total=total)
        delay()

    success = sum(1 for a in all_articles if a["status"] == "success")
    partial = sum(1 for a in all_articles if a["status"] == "partial")
    failed = sum(1 for a in all_articles if a["status"] == "failed")
    log(
        f"Selesai! {success} berhasil, {partial} partial, {failed} gagal.",
        phase="done", total=total, success=success, partial=partial, failed=failed,
    )

    return all_articles
