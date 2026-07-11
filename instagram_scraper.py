"""
instagram_scraper.py — Ambil caption + OCR poster/gambar dari post Instagram publik (foto/carousel).

Batasan (sengaja, sesuai scope):
- HANYA post publik (bukan akun private, bukan story).
- Carousel: coba parse JSON-LD / blob script untuk semua URL gambar; fallback ke og:image tunggal.
- Reels/video: caption tetap diambil, TIDAK ada transkripsi audio.
- Maksimal 10 gambar per post untuk OCR (mencegah biaya AI membengkak).
"""
import re
import html
import json
import base64
import logging
import requests
from datetime import datetime
from urllib.parse import urlparse
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
}
TIMEOUT = 20
IMG_DOWNLOAD_TIMEOUT = 15
MAX_IMAGES_PER_POST = 10

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
    return html.unescape(og_description).strip()


def extract_carousel_image_urls(html_text: str, og_image_fallback: str = "") -> list:
    """
    Coba ekstrak URL semua gambar carousel dari HTML Instagram.

    Strategy (berurutan, berhenti di yang pertama berhasil):
    1. JSON-LD <script type="application/ld+json"> — paling bersih kalau ada.
    2. display_url pattern dalam blob script tag — Instagram embed data ke JS.
    3. Fallback ke og:image tunggal.

    Seluruh fungsi AMAN dari exception: selalu return list (minimal 1 item jika
    og_image_fallback tersedia, kosong jika tidak ada sama sekali).
    """
    urls = []

    # ── Approach 1: JSON-LD ───────────────────────────────────────────────────
    try:
        soup = BeautifulSoup(html_text, "html.parser")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                raw = script.string or ""
                if not raw.strip():
                    continue
                data = json.loads(raw)
                # data bisa list atau dict
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    imgs = item.get("image")
                    if not imgs:
                        continue
                    if isinstance(imgs, str) and imgs.startswith("http"):
                        urls.append(imgs)
                    elif isinstance(imgs, list):
                        for img in imgs:
                            if isinstance(img, str) and img.startswith("http"):
                                urls.append(img)
                            elif isinstance(img, dict):
                                u = img.get("url") or img.get("contentUrl") or ""
                                if u and u.startswith("http"):
                                    urls.append(u)
            except Exception:
                continue
    except Exception:
        pass

    if urls:
        logger.debug(f"[IG-CAROUSEL] JSON-LD: {len(urls)} gambar ditemukan.")
        return list(dict.fromkeys(urls))[:MAX_IMAGES_PER_POST]

    # ── Approach 2: display_url pattern dalam blob script ────────────────────
    try:
        matches = re.findall(r'"display_url"\s*:\s*"(https://[^"]+)"', html_text)
        if matches:
            cleaned = [u.replace("\\u0026", "&") for u in matches]
            logger.debug(f"[IG-CAROUSEL] display_url pattern: {len(cleaned)} gambar.")
            return list(dict.fromkeys(cleaned))[:MAX_IMAGES_PER_POST]
    except Exception:
        pass

    # ── Fallback: og:image tunggal ───────────────────────────────────────────
    if og_image_fallback:
        logger.debug("[IG-CAROUSEL] Fallback ke og:image tunggal.")
        return [og_image_fallback]
    return []


def ocr_instagram_images(image_urls: list) -> list:
    """
    OCR setiap gambar Instagram menggunakan AI Vision (openai/gpt-4o-mini).

    - Maks MAX_IMAGES_PER_POST gambar per post (selebihnya dilewati).
    - Gambar didownload, di-encode base64, dikirim ke model dengan detail "high".
    - Kalau 1 gambar gagal → skip, lanjut gambar berikutnya.
    - Kalau OpenRouter tidak tersedia → semua entry success=False.

    Return: list of dict [{image_url, extracted_text, success, error?}]
    """
    from ai_services import get_openai_client, check_openai_available

    if not check_openai_available():
        return [
            {"image_url": u, "extracted_text": "", "success": False,
             "error": "OpenRouter API key tidak tersedia"}
            for u in image_urls[:MAX_IMAGES_PER_POST]
        ]

    limited = image_urls[:MAX_IMAGES_PER_POST]
    results = []

    try:
        client = get_openai_client()
    except Exception as e:
        return [
            {"image_url": u, "extracted_text": "", "success": False, "error": str(e)}
            for u in limited
        ]

    PROMPT = (
        "Ekstrak semua teks yang terlihat pada gambar ini (poster/infografis/foto). "
        "Kalau tidak ada teks yang terbaca, jawab persis dengan kata 'TIDAK_ADA_TEKS'. "
        "Jangan menambahkan komentar atau penjelasan lain, hanya teks yang berhasil dibaca."
    )

    for img_url in limited:
        try:
            resp = requests.get(img_url, timeout=IMG_DOWNLOAD_TIMEOUT, headers=HEADERS)
            resp.raise_for_status()
            img_bytes = resp.content

            # Deteksi mime type dari Content-Type header
            ct = resp.headers.get("Content-Type", "image/jpeg").lower()
            if "png" in ct:
                mime = "image/png"
            elif "webp" in ct:
                mime = "image/webp"
            elif "gif" in ct:
                mime = "image/gif"
            else:
                mime = "image/jpeg"

            b64 = base64.b64encode(img_bytes).decode("utf-8")

            ai_resp = client.chat.completions.create(
                model="openai/gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{b64}",
                                "detail": "high",
                            },
                        },
                    ],
                }],
                max_tokens=1000,
                temperature=0.1,
            )
            extracted = ai_resp.choices[0].message.content.strip()
            results.append({"image_url": img_url, "extracted_text": extracted, "success": True})
            logger.info(f"[IG-OCR] OK: {img_url[:60]}... → {len(extracted)} chars")
        except Exception as e:
            logger.warning(f"[IG-OCR] Gagal: {img_url[:60]}... — {e}")
            results.append({"image_url": img_url, "extracted_text": "", "success": False, "error": str(e)})

    return results


def scrape_instagram_post(url: str) -> dict:
    """
    Ambil caption + metadata + OCR poster dari satu post Instagram publik.

    Return dict:
        {
            "url": str,
            "caption": str,
            "username": str,
            "thumbnail_url": str,
            "scraped_at": ISO timestamp,
            "content_type": "post" | "reel",
            "poster_text": str,            # gabungan teks OCR semua gambar
            "images_processed": int,       # jumlah gambar yang berhasil di-OCR
            "images_skipped": int,         # jumlah gambar yang gagal/dilewati
            "image_urls": list[str],       # URL semua gambar yang ditemukan
        }

    Raises:
        ValueError: URL bukan instagram.com (SSRF guard).
        RuntimeError: gagal fetch/parse halaman Instagram.
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

    html_text = resp.text

    try:
        soup = BeautifulSoup(html_text, "html.parser")

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
        raise RuntimeError(
            "Gagal mengambil data dari Instagram, kemungkinan diblokir atau URL tidak valid/post sudah dihapus "
            "(meta tag og:description/og:title tidak ditemukan di halaman)."
        )

    caption = _extract_caption_from_og_description(og_description)

    username = ""
    if og_title:
        m = re.match(r"^([^\s(]+)", html.unescape(og_title))
        if m:
            username = m.group(1).strip('"')

    # ── OCR semua gambar carousel ─────────────────────────────────────────────
    image_urls = extract_carousel_image_urls(html_text, og_image_fallback=thumbnail_url)
    logger.info(f"[IG] {len(image_urls)} gambar ditemukan untuk post: {url}")

    ocr_results = []
    if image_urls and content_type != "reel":
        ocr_results = ocr_instagram_images(image_urls)

    images_processed = sum(1 for r in ocr_results if r.get("success"))
    images_skipped = len(ocr_results) - images_processed

    # Gabungkan teks OCR semua gambar yang berhasil
    poster_parts = []
    for i, r in enumerate(ocr_results):
        if not r.get("success"):
            continue
        text = (r.get("extracted_text") or "").strip()
        if not text or text == "TIDAK_ADA_TEKS":
            continue
        if len(ocr_results) > 1:
            poster_parts.append(f"[Gambar {i + 1}]\n{text}")
        else:
            poster_parts.append(text)

    poster_text = "\n\n".join(poster_parts)

    result = {
        "url": url,
        "caption": caption,
        "username": username,
        "thumbnail_url": thumbnail_url,
        "scraped_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "poster_text": poster_text,
        "images_processed": images_processed,
        "images_skipped": images_skipped,
        "image_urls": image_urls,
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
