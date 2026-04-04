# kb_processor.py — Modul pemrosesan Knowledge Base draft untuk AINA
import re
import unicodedata
from formatter import format_aina_response

# ─── Tag Configuration ──────────────────────────────────────────────────────

DEFAULT_TAGS = ["berita", "kemlu", "kairo", "mesir"]

# Keyword → tag (case-insensitive match di title + content)
KEYWORD_TAG_MAP = {
    "paspor": "paspor",
    "passport": "paspor",
    "visa": "visa",
    "iqomah": "iqomah",
    "iqama": "iqomah",
    "pendidikan": "pendidikan",
    "beasiswa": "beasiswa",
    "scholarship": "beasiswa",
    "mahasiswa": "mahasiswa",
    "pelajar": "mahasiswa",
    "kbri": "kbri",
    "kedutaan": "kbri",
    "palestina": "palestina",
    "palestine": "palestina",
    "gaza": "palestina",
    "bantuan": "bantuan",
    "bansos": "bantuan",
    "donasi": "bantuan",
    "diplomasi": "diplomasi",
    "diplomatic": "diplomasi",
    "bilateral": "diplomasi",
    "konsulat": "konsuler",
    "konsuler": "konsuler",
    "wni": "wni",
    "warga negara": "wni",
    "perlindungan": "perlindungan",
    "hukum": "hukum",
    "pernikahan": "pernikahan",
    "nikah": "pernikahan",
    "surat": "surat",
    "legalisasi": "legalisasi",
    "apostille": "legalisasi",
    "perpanjangan": "perpanjangan",
    "pelayanan": "pelayanan",
}


# ─── Core Helper Functions ───────────────────────────────────────────────────

def generate_slug(title: str) -> str:
    """
    Buat slug URL-safe dari title.
    Contoh: 'Berita KBRI Kairo 2024' → 'berita-kbri-kairo-2024'
    """
    if not title:
        return ""
    # Normalize unicode → ASCII approximation
    title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    title = title.lower().strip()
    title = re.sub(r"[^a-z0-9\s-]", "", title)
    title = re.sub(r"[\s_]+", "-", title)
    title = re.sub(r"-+", "-", title).strip("-")
    return title[:80]


def generate_summary(content: str, min_sentences: int = 2, max_sentences: int = 4) -> str:
    """
    Buat summary singkat dari content:
    - Ambil kalimat-kalimat awal yang representatif (bukan terlalu pendek)
    - Batasi antara min_sentences dan max_sentences kalimat
    - Maksimal 500 karakter total
    """
    if not content or not content.strip():
        return ""

    # Split kalimat berdasarkan tanda baca akhir kalimat
    raw_sentences = re.split(r"(?<=[.!?])\s+", content.strip())

    # Filter: kalimat minimal 25 karakter (bukan fragmen navigasi)
    good = [s.strip() for s in raw_sentences if len(s.strip()) >= 25]

    if not good:
        # Fallback: ambil 300 karakter pertama
        return content.strip()[:300].rsplit(" ", 1)[0] + "..."

    selected = good[:max_sentences]

    # Gabungkan dan potong di 500 karakter
    summary = " ".join(selected)
    if len(summary) > 500:
        summary = summary[:497].rsplit(" ", 1)[0] + "..."

    return summary


def generate_tags(title: str, content: str) -> list[str]:
    """
    Generate tags otomatis berdasarkan keyword matching di title + content.
    - Selalu include DEFAULT_TAGS
    - Tambahkan tag dari KEYWORD_TAG_MAP jika keyword ditemukan
    - Return list unik, terurut
    """
    combined = f"{title} {content}".lower()

    tags = set(DEFAULT_TAGS)
    for keyword, tag in KEYWORD_TAG_MAP.items():
        if keyword in combined:
            tags.add(tag)

    # Urut: default tags dulu, lalu sisanya alfabetis
    sorted_tags = [t for t in DEFAULT_TAGS if t in tags]
    extra = sorted(t for t in tags if t not in DEFAULT_TAGS)
    return sorted_tags + extra


def convert_to_kb_format(article: dict) -> dict:
    """
    Konversi satu artikel scraping ke format KB draft untuk AINA.

    Output fields:
    - title, slug, source_url, published_date
    - content, summary, tags
    - scrape_status, approval_status
    """
    title = (article.get("title") or "").strip()
    content = (article.get("content") or "").strip()

    # Pakai summary yang sudah ada jika tersedia, otherwise generate
    existing_summary = (article.get("summary") or "").strip()
    summary = existing_summary if existing_summary else generate_summary(content)

    # Pakai tags yang sudah ada jika tersedia, otherwise generate
    existing_tags = article.get("tags")
    if existing_tags and isinstance(existing_tags, list) and len(existing_tags) > 0:
        tags = existing_tags
    else:
        tags = generate_tags(title, content)

    # Build formatter context so it can apply trust layer and structure fixes
    fmt_ctx = {
        "source_url": article.get("url", ""),
        "source_name": article.get("source", ""),
        "scrape_status": article.get("status", "unknown"),
        "published_date": article.get("date", ""),
        "add_trust_footer": False,  # trust footer off by default in KB storage
    }

    return {
        "id": article.get("id", ""),
        "title": title,
        "slug": generate_slug(title) or article.get("id", ""),
        "source_url": article.get("url", ""),
        "published_date": article.get("date", ""),
        "content": format_aina_response(content, fmt_ctx),
        "summary": format_aina_response(summary, fmt_ctx),
        "tags": tags,
        "scrape_status": article.get("status", "unknown"),
        "approval_status": "pending",
    }
