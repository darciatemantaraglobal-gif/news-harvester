# scraper.py — Modul scraping modular
import uuid
from urllib.parse import urljoin
from utils import get_soup, delay

# Selector kandidat — mudah diubah jika struktur HTML berubah
SELECTORS = {
    "title": ["h1", "h2.title", ".news-title", ".post-title", ".entry-title", "h2"],
    "date": [".date", ".news-date", "time", ".published-date", ".post-date", ".entry-date"],
    "content": [
        ".ck-content", ".post-content", ".news-content", ".article-content",
        ".content", "article", ".entry-content", ".field-item",
    ],
    "article_link": ["a[href]"],
}


def _find_first(soup, selectors: list[str]) -> str:
    """Coba setiap selector, return text dari yang pertama cocok."""
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            text = el.get_text(separator="\n", strip=True)
            if text:
                return text
    return ""


def extract_article_links(soup, base_url: str) -> list[str]:
    """Ambil semua link artikel dari halaman list."""
    links = []
    seen = set()
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        full = urljoin(base_url, href)
        # Heuristic: link artikel biasanya lebih panjang dari base
        if full not in seen and full.startswith(base_url.split("/berita")[0]) and "/berita/" in full:
            seen.add(full)
            links.append(full)
    return links


def find_next_page(soup, base_url: str) -> str | None:
    """Temukan link halaman selanjutnya dari pagination."""
    # Cari link "Next", ">", "»", atau rel=next
    for a in soup.select("a[href]"):
        text = a.get_text(strip=True).lower()
        rel = a.get("rel", [])
        if text in ("next", "›", "»", ">", "selanjutnya", "berikutnya") or "next" in rel:
            return urljoin(base_url, a["href"])
    # Cari li.next > a, .pagination .next
    for sel in [".pagination .next a", "li.next a", ".pager-next a", "a.next"]:
        el = soup.select_one(sel)
        if el and el.get("href"):
            return urljoin(base_url, el["href"])
    return None


def extract_article_detail(url: str) -> dict:
    """Scrape satu artikel, return dict dengan title/date/content/status."""
    article = {"id": str(uuid.uuid4())[:8], "url": url, "title": "", "date": "", "content": "", "status": "success"}
    try:
        soup = get_soup(url)
        if not soup:
            article["status"] = "failed"
            return article
        article["title"] = _find_first(soup, SELECTORS["title"])
        article["date"] = _find_first(soup, SELECTORS["date"])
        article["content"] = _find_first(soup, SELECTORS["content"])
        # Tentukan status
        if not article["title"] and not article["content"]:
            article["status"] = "failed"
        elif not article["title"] or not article["content"]:
            article["status"] = "partial"
    except Exception as e:
        article["status"] = "failed"
        article["content"] = f"Error: {str(e)}"
    return article


def scrape_all(start_url: str, progress_callback=None):
    """
    Scrape semua artikel dari halaman list + pagination.
    progress_callback(event_type, data) dipanggil untuk tracking.
    """
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
            links = extract_article_links(soup, start_url)
            log(f"Ditemukan {len(links)} link di halaman #{page_num}", phase="listing")
            all_links.extend(links)
            page_url = find_next_page(soup, page_url)
            if page_url:
                delay()
        except Exception as e:
            log(f"Error di halaman #{page_num}: {str(e)}", phase="listing")
            break

    total = len(all_links)
    log(f"Total {total} link artikel ditemukan. Mulai scraping...", phase="scraping", total=total)

    # Phase 2: Scrape setiap artikel
    for i, link in enumerate(all_links):
        log(f"[{i+1}/{total}] Scraping: {link}", phase="scraping", current=i+1, total=total)
        article = extract_article_detail(link)
        all_articles.append(article)
        status_icon = "✓" if article["status"] == "success" else ("◐" if article["status"] == "partial" else "✗")
        log(f"  {status_icon} {article['status'].upper()}: {article.get('title','(no title)')[:60]}", phase="scraping", current=i+1, total=total)
        delay()

    success = sum(1 for a in all_articles if a["status"] == "success")
    partial = sum(1 for a in all_articles if a["status"] == "partial")
    failed = sum(1 for a in all_articles if a["status"] == "failed")
    log(f"Selesai! {success} berhasil, {partial} partial, {failed} gagal.", phase="done", total=total, success=success, partial=partial, failed=failed)

    return all_articles
