# content_cleaner.py — Modul pembersihan konten artikel
import re

# Pola teks navigasi / elemen umum yang tidak berguna
_NAV_PATTERNS = [
    r"^(home|beranda|halaman\s+utama|back\s+to\s+top|kembali\s+ke\s+atas)$",
    r"^(share|bagikan|print|cetak|tweet|copy\s+link|salin\s+tautan)$",
    r"^(tags?|kategori|category|label)\s*[:：]?\s*$",
    r"^(related|artikel\s+terkait|lihat\s+juga|baca\s+juga|you\s+may\s+also).*$",
    r"^(advertisement|iklan|sponsored|promoted).*$",
    r"^(copyright|hak\s+cipta|©|\d{4}\s+all\s+rights\s+reserved).*$",
    r"^(subscribe|langganan|newsletter|follow\s+us|ikuti\s+kami).*$",
    r"^(loading|memuat|please\s+wait|mohon\s+tunggu).*$",
    r"^[\s\W]{0,3}$",  # baris hampir kosong (≤3 karakter non-alfanumerik)
]
_NAV_COMPILED = [re.compile(p, re.IGNORECASE) for p in _NAV_PATTERNS]


def normalize_whitespace(text: str) -> str:
    """Normalisasi spasi: collapse multiple spaces/tabs ke satu, trim tiap baris."""
    lines = text.splitlines()
    result = []
    for line in lines:
        line = re.sub(r"[ \t]+", " ", line).strip()
        result.append(line)
    return "\n".join(result)


def remove_duplicate_lines(text: str) -> str:
    """Hapus baris duplikat berurutan (consecutive duplicate lines)."""
    lines = text.splitlines()
    result = []
    prev = object()  # sentinel
    for line in lines:
        if line != prev:
            result.append(line)
        prev = line
    return "\n".join(result)


def remove_nav_lines(text: str) -> str:
    """Hapus baris yang cocok dengan pola navigasi/footer umum."""
    lines = text.splitlines()
    result = []
    for line in lines:
        stripped = line.strip()
        if not any(p.fullmatch(stripped) for p in _NAV_COMPILED):
            result.append(line)
    return "\n".join(result)


def collapse_blank_lines(text: str, max_consecutive: int = 1) -> str:
    """Kurangi baris kosong berturut-turut menjadi maksimal max_consecutive."""
    lines = text.splitlines()
    result = []
    blank_count = 0
    for line in lines:
        if line.strip() == "":
            blank_count += 1
            if blank_count <= max_consecutive:
                result.append(line)
        else:
            blank_count = 0
            result.append(line)
    return "\n".join(result)


def clean_text(content: str) -> str:
    """
    Pipeline pembersihan konten lengkap:
    1. normalize_whitespace  — normalisasi spasi & tab
    2. remove_nav_lines      — buang baris navigasi/footer
    3. remove_duplicate_lines — buang baris duplikat berurutan
    4. collapse_blank_lines  — max 1 baris kosong berturut-turut
    5. strip                 — buang spasi di awal/akhir
    """
    if not content:
        return ""
    text = normalize_whitespace(content)
    text = remove_nav_lines(text)
    text = remove_duplicate_lines(text)
    text = collapse_blank_lines(text, max_consecutive=1)
    return text.strip()
