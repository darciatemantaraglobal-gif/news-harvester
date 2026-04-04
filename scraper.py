# scraper.py — Modul scraping modular dengan selector dinamis, cleaning, deduplication
import re
import uuid
import requests
from datetime import date, datetime, timedelta
from urllib.parse import urljoin, urlparse

from utils import get_soup, delay, BLOCKED_CODES
from content_cleaner import clean_text
from kemlu_scraper import is_kemlu_url, scrape_kemlu


# ─── Auto-Detect Selectors ───────────────────────────────────────────────────

# Pola URL yang BUKAN artikel (navigasi, author, kategori, dsb.)
_SKIP_PATTERNS = {
    "/author/", "/category/", "/tag/", "/page/", "/feed/",
    "/wp-content/", "/wp-admin/", "/wp-json/",
    "#", "mailto:", "javascript:",
    "/search", "/login", "/register",
}

# Kandidat selector untuk link artikel di halaman list
_LINK_CANDIDATES = [
    "article h2 a",
    "article h3 a",
    "article h1 a",
    "h2.entry-title a",
    "h3.entry-title a",
    "h1.entry-title a",
    ".entry-title a",
    ".post-title a",
    ".news-title a",
    ".article-title a",
    "article a[rel='bookmark']",
    "article a[rel=\"bookmark\"]",
    ".post h2 a",
    ".post h3 a",
    "a[href*='/berita/']",
    "a[href*='/news/']",
    "a[href*='/artikel/']",
    "a[href*='/post/']",
    "a[href*='/read/']",
    "a[href*='/publication/']",
    "a[href*='/press-release/']",
]

# Kandidat selector next-page
_NEXT_CANDIDATES = [
    "a.next",
    "a[rel=next]",
    "a[rel='next']",
    ".nav-next a",
    ".next-posts-link",
    ".navigation a.next",
    ".page-numbers.next",
    'a.page-numbers[aria-label="Next Page"]',
    ".nav-links a.next",
]

# Kandidat selector title artikel
_TITLE_CANDIDATES = [
    "h1.entry-title",
    "h1.post-title",
    "h1.article-title",
    "h1.news-title",
    ".post-title h1",
    "header h1",
    "h1",
    "h2.entry-title",
]

# Kandidat selector tanggal artikel
_DATE_CANDIDATES = [
    "time[datetime]",
    "time",
    ".entry-date",
    ".published",
    ".post-date",
    ".date",
    ".meta-date",
    ".article-date",
    ".news-date",
    "span.date",
    ".post-meta time",
    ".byline time",
]

# Kandidat selector konten artikel
_CONTENT_CANDIDATES = [
    ".entry-content",
    ".post-content",
    ".article-content",
    ".news-content",
    ".ck-content",
    ".post-body",
    ".article-body",
    ".content-area article",
    "article .content",
    ".single-content",
    ".post-text",
    "article",
]


def _is_article_url(href: str, base_domain: str) -> bool:
    """Return True jika URL terlihat seperti link artikel (bukan navigasi)."""
    if not href or not href.startswith("http"):
        return False
    if base_domain and base_domain not in href:
        return False
    for pat in _SKIP_PATTERNS:
        if pat in href:
            return False
    return True


def auto_detect_selectors(url: str, log_fn=None) -> dict:
    """
    Otomatis deteksi CSS selector yang tepat untuk URL yang diberikan.
    Mengembalikan dict selector yang bisa langsung dipakai sebagai `settings`.
    Selector yang tidak terdeteksi tidak disertakan (gunakan default).
    """
    def log(msg):
        if log_fn:
            log_fn(msg)

    result = {}
    base_domain = urlparse(url).netloc

    # ── Fetch halaman list ────────────────────────────────────────────────────
    log("[AUTO] Mendeteksi struktur halaman...")
    try:
        soup = get_soup(url)
    except Exception as e:
        log(f"[AUTO] Gagal fetch halaman: {e}")
        return result

    # ── Deteksi selector link artikel ────────────────────────────────────────
    best_link_sel = None
    best_links: list[str] = []

    for sel in _LINK_CANDIDATES:
        try:
            els = soup.select(sel)
            valid = []
            seen = set()
            for el in els:
                href = el.get("href", "")
                if _is_article_url(href, base_domain) and href not in seen:
                    seen.add(href)
                    valid.append(href)
            if len(valid) > len(best_links):
                best_links = valid
                best_link_sel = sel
        except Exception:
            continue

    if best_link_sel and best_links:
        result["article_link_selector"] = best_link_sel
        log(f"[AUTO] Link artikel → '{best_link_sel}' ({len(best_links)} link ditemukan)")
    else:
        log("[AUTO] Tidak bisa deteksi link artikel — pakai selector default")
        return result

    # ── Deteksi next-page selector ───────────────────────────────────────────
    for sel in _NEXT_CANDIDATES:
        try:
            el = soup.select_one(sel)
            if el and el.get("href"):
                result["next_page_selector"] = sel
                log(f"[AUTO] Next page → '{sel}'")
                break
        except Exception:
            continue
    else:
        log("[AUTO] Tidak ada pagination ditemukan")

    # ── Fetch satu artikel sampel untuk deteksi title/date/content ───────────
    sample_url = best_links[0]
    log(f"[AUTO] Menganalisa artikel sampel...")
    try:
        art_soup = get_soup(sample_url)
    except Exception as e:
        log(f"[AUTO] Gagal fetch artikel sampel: {e}")
        return result

    # Title
    for sel in _TITLE_CANDIDATES:
        try:
            el = art_soup.select_one(sel)
            if el and el.get_text(strip=True):
                result["title_selector"] = sel
                log(f"[AUTO] Title → '{sel}'")
                break
        except Exception:
            continue

    # Date
    for sel in _DATE_CANDIDATES:
        try:
            el = art_soup.select_one(sel)
            if el and el.get_text(strip=True):
                result["date_selector"] = sel
                log(f"[AUTO] Tanggal → '{sel}'")
                break
        except Exception:
            continue
    else:
        log("[AUTO] Selector tanggal tidak ditemukan")

    # Content
    for sel in _CONTENT_CANDIDATES:
        try:
            el = art_soup.select_one(sel)
            if el and len(el.get_text(strip=True)) > 100:
                result["content_selector"] = sel
                log(f"[AUTO] Konten → '{sel}'")
                break
        except Exception:
            continue
    else:
        log("[AUTO] Selector konten tidak ditemukan")

    log(f"[AUTO] Deteksi selesai — {len(result)} selector berhasil diidentifikasi")
    return result

# ─── Date Parsing Helpers ────────────────────────────────────────────────────

INDONESIAN_MONTHS: dict[str, int] = {
    # Indonesian
    "januari": 1, "februari": 2, "maret": 3, "april": 4,
    "mei": 5, "juni": 6, "juli": 7, "agustus": 8,
    "september": 9, "oktober": 10, "november": 11, "desember": 12,
    # Short Indonesian
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "agt": 8, "agu": 8, "sep": 9,
    "okt": 10, "nov": 11, "des": 12,
    # English
    "january": 1, "february": 2, "march": 3, "may": 5,
    "june": 6, "july": 7, "august": 8,
    "october": 10, "december": 12,
    # Short English
    "oct": 10, "dec": 12, "aug": 8,
}


def parse_article_date(date_str: str) -> date | None:
    """
    Parse tanggal artikel dari berbagai format umum.
    Return datetime.date atau None jika gagal.
    Mendukung format Indonesia, ISO, dan situs pemerintah.
    """
    if not date_str:
        return None

    # Bersihkan: hapus hari dalam seminggu, whitespace berlebihan, tanda baca
    s = re.sub(r"(senin|selasa|rabu|kamis|jumat|sabtu|minggu|"
               r"monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
               "", date_str.lower().strip())
    s = re.sub(r"\s+", " ", s).strip().strip(",").strip()

    # 1. ISO 8601: 2024-01-15 atau 2024-01-15T10:00:00
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass

    # 2. dd/mm/yyyy atau dd-mm-yyyy atau dd.mm.yyyy
    m = re.search(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass

    # 3. yyyy/mm/dd
    m = re.search(r"(\d{4})[/\-.](\d{2})[/\-.](\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass

    # 4. dd Bulan yyyy  /  dd-Bulan-yyyy  (Indonesian / English month name)
    m = re.search(r"(\d{1,2})[\s\-]+([a-z]+)[\s\-,]+(\d{4})", s)
    if m:
        month_name = m.group(2).lower()
        mon = INDONESIAN_MONTHS.get(month_name)
        if mon:
            try:
                return date(int(m.group(3)), mon, int(m.group(1)))
            except ValueError:
                pass

    # 5. Bulan dd, yyyy  /  Month dd yyyy  (English order)
    m = re.search(r"([a-z]+)\s+(\d{1,2})[,\s]+(\d{4})", s)
    if m:
        month_name = m.group(1).lower()
        mon = INDONESIAN_MONTHS.get(month_name)
        if mon:
            try:
                return date(int(m.group(3)), mon, int(m.group(2)))
            except ValueError:
                pass

    return None


def date_in_range(
    article_date_str: str,
    start: date | None,
    end: date | None,
) -> str:
    """
    Periksa apakah tanggal artikel berada dalam rentang filter.
    Return: 'in' | 'out' | 'unknown'
    'unknown' → gagal parse tanggal (artikel tetap disimpan, ditandai partial)
    """
    if start is None and end is None:
        return "in"  # no filter

    parsed = parse_article_date(article_date_str)
    if parsed is None:
        return "unknown"

    if start and parsed < start:
        return "out"
    if end and parsed > end:
        return "out"
    return "in"

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
    start_date: date | None = None,
    end_date: date | None = None,
    article_callback=None,
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

    # ── Deteksi situs khusus ──────────────────────────────────────────────────
    if is_kemlu_url(start_url):
        return scrape_kemlu(
            start_url,
            mode=mode,
            existing_articles=existing_articles,
            progress_callback=progress_callback,
            start_date=start_date,
            end_date=end_date,
            article_callback=article_callback,
        )

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

        # ── Date range filter ──
        if start_date is not None or end_date is not None:
            dr = date_in_range(article.get("date", ""), start_date, end_date)
            if dr == "out":
                log(
                    f"  ⊘ OUT OF RANGE (tanggal): {article.get('title', link)[:60]}",
                    phase="scraping", current=i + 1, total=total,
                    duplicate=duplicate_count,
                )
                delay()
                continue
            elif dr == "unknown":
                # Tanggal tidak bisa dibaca → simpan, tandai partial
                if article.get("status") == "success":
                    article["status"] = "partial"
                if not article.get("error_reason"):
                    article["error_reason"] = "date_unknown"
                log(
                    f"  ⚠ DATE UNKNOWN (tetap disimpan): {article.get('title', link)[:60]}",
                    phase="scraping", current=i + 1, total=total,
                    duplicate=duplicate_count,
                )

        # Tambahkan ke sets
        seen_urls.add(link)
        if t and d:
            seen_title_date.add((t, d))

        all_articles.append(article)
        if article_callback:
            article_callback(article)

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
