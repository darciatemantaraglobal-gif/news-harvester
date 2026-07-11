"""
instagram_scraper.py — Ambil caption dari post Instagram publik (foto/carousel).

Batasan (sengaja, sesuai scope):
- HANYA post publik (bukan akun private, bukan story).
- HANYA caption teks yang diambil. Untuk Reels/video, caption tetap diambil
  tapi TIDAK ada transkripsi audio — di luar scope fitur ini.
"""
import re
import html
import requests
from datetime import datetime
from urllib.parse import urlparse
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
}
TIMEOUT = 20

_ALLOWED_HOSTS = {"instagram.com", "www.instagram.com"}

# og:description Instagram biasanya berformat:
# 'X likes, Y comments - username on Month Day, Year: "isi caption di sini"'
_OG_DESC_CAPTION_RE = re.compile(r'"(.*)"\s*$', re.DOTALL)


def is_instagram_url(url: str) -> bool:
    """
    Validasi SSRF-guard sederhana: hanya izinkan hostname instagram.com /
    www.instagram.com. Tolak semua hostname lain supaya endpoint ini tidak
    disalahgunakan untuk fetch alamat sembarangan.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        host = (parsed.hostname or "").lower()
        return host in _ALLOWED_HOSTS
    except Exception:
        return False


def _detect_content_type(url: str) -> str:
    """Deteksi Reels/video vs post foto/carousel biasa berdasarkan path URL."""
    path = urlparse(url).path.lower()
    if "/reel/" in path or "/reels/" in path:
        return "reel"
    return "post"


def _extract_caption_from_og_description(og_description: str) -> str:
    """
    Ekstrak teks caption dari dalam tanda kutip pada og:description.
    Kalau formatnya berubah/gagal parse, kembalikan og:description apa adanya.
    """
    if not og_description:
        return ""
    match = _OG_DESC_CAPTION_RE.search(og_description)
    if match:
        return html.unescape(match.group(1)).strip()
    # Fallback: format tidak sesuai ekspektasi, pakai apa adanya
    return html.unescape(og_description).strip()


def scrape_instagram_post(url: str) -> dict:
    """
    Ambil caption + metadata dari satu post Instagram publik.

    Return dict:
        {
            "url": str,
            "caption": str,
            "username": str,
            "thumbnail_url": str,
            "scraped_at": ISO timestamp,
            "content_type": "post" | "reel",
        }

    Raises:
        ValueError: URL bukan instagram.com (SSRF guard).
        RuntimeError: gagal fetch/parse — Instagram memblokir, halaman
                      berubah struktur, atau post tidak ada/sudah dihapus.
                      TIDAK pernah silent-fail dengan dict kosong.
    """
    if not is_instagram_url(url):
        raise ValueError(
            "URL tidak valid — hanya URL instagram.com/www.instagram.com yang diizinkan."
        )

    content_type = _detect_content_type(url)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise RuntimeError(
            f"Gagal mengambil data dari Instagram, kemungkinan diblokir atau URL tidak valid/post sudah dihapus: {e}"
        )

    if resp.status_code == 404:
        raise RuntimeError(
            "Gagal mengambil data dari Instagram, kemungkinan diblokir atau URL tidak valid/post sudah dihapus "
            "(HTTP 404 — post tidak ditemukan)."
        )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Gagal mengambil data dari Instagram, kemungkinan diblokir atau URL tidak valid/post sudah dihapus "
            f"(HTTP {resp.status_code})."
        )

    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        og_description_tag = soup.find("meta", property="og:description")
        og_image_tag = soup.find("meta", property="og:image")
        og_title_tag = soup.find("meta", property="og:title")

        og_description = og_description_tag.get("content", "").strip() if og_description_tag else ""
        thumbnail_url = og_image_tag.get("content", "").strip() if og_image_tag else ""
        og_title = og_title_tag.get("content", "").strip() if og_title_tag else ""
    except Exception as e:
        raise RuntimeError(
            f"Gagal mengambil data dari Instagram, kemungkinan diblokir atau URL tidak valid/post sudah dihapus: {e}"
        )

    if not og_description and not og_title:
        # Tidak ada meta tag sama sekali — halaman kemungkinan berubah struktur,
        # butuh login, atau post memang tidak ada.
        raise RuntimeError(
            "Gagal mengambil data dari Instagram, kemungkinan diblokir atau URL tidak valid/post sudah dihapus "
            "(meta tag og:description/og:title tidak ditemukan di halaman)."
        )

    caption = _extract_caption_from_og_description(og_description)

    # og:title biasanya berisi "username on Instagram: ..." atau sekadar username
    username = ""
    if og_title:
        m = re.match(r"^([^\s(]+)", html.unescape(og_title))
        if m:
            username = m.group(1).strip('"')

    result = {
        "url": url,
        "caption": caption,
        "username": username,
        "thumbnail_url": thumbnail_url,
        "scraped_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    }

    if content_type == "reel":
        result["content_type"] = "reel"
        result["note"] = (
            "URL ini terdeteksi sebagai Reels/video. Hanya caption teks yang diambil — "
            "transkrip audio/video TIDAK didukung pada fitur ini."
        )
    else:
        result["content_type"] = "post"

    return result
