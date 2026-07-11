# relevance_filter.py — Fitur "Relevansi & Ekstraksi Masisir" untuk AINA Scraper
#
# Tujuan: sebelum artikel apapun (Web Scraper, Paste & Rapikan, YouTube, DOCX,
# RSS, Telegram, Instagram) masuk ke KB draft, cek dulu apakah artikel itu
# relevan buat Masisir (Mahasiswa/Masyarakat Indonesia di Mesir/Kairo), dan
# ekstrak poin-poin penting supaya reviewer tidak perlu baca artikel penuh.
#
# Desain:
# - quick_keyword_prefilter() → filter murah tanpa AI. Kalau TIDAK ada sinyal
#   keyword sama sekali, langsung anggap tidak relevan tanpa panggil AI
#   (hemat biaya AI untuk artikel yang jelas-jelas tidak nyambung).
# - classify_and_extract() → panggil AI (lewat ai_services, model yang sama
#   dipakai fitur lain) untuk klasifikasi + ekstraksi terstruktur. TIDAK PERNAH
#   raise — kalau AI gagal/timeout/parsing error, balikin dict fallback yang
#   menandai "perlu dicek manual" alih-alih menjatuhkan seluruh request.
# - filter_and_extract() → orkestrasi keduanya, dipanggil dari SATU tempat
#   (kb_processor.convert_to_kb_format) supaya semua pipeline otomatis konsisten.

import json
import logging

from db_services import AINA_VALID_CATEGORIES, _TAG_TO_CATEGORY, get_app_setting, set_app_setting

logger = logging.getLogger(__name__)

_SETTING_KEY = "masisir_filter_enabled"


# ─── Keyword signals ─────────────────────────────────────────────────────────

_MASISIR_SPECIFIC_KEYWORDS = {
    "masisir", "ppmi", "al-azhar", "al azhar", "azhar", "mahasantri",
    "muqarrar", "kairo", "cairo", "mesir", "egypt", "kbri kairo",
    "wni mesir", "iqama", "iqomah", "visa pelajar", "beasiswa al-azhar",
    "mahasiswa indonesia mesir", "konsuler kairo", "atdikbud", "atase pendidikan",
    "wisma nusantara", "rumah aspirasi", "senat mahasiswa", "buhuts",
    "syahadah", "muktamar", "munas ppmi", "kekeluargaan", "kekel",
    "darul lughah", "markaz lughah", "idarah azhar", "azhar syarif",
}

# Gabungkan semua keyword yang sudah dipakai untuk kategori/tag di db_services
# (AINA_VALID_CATEGORIES nama-nama kategori + semua keyword di _TAG_TO_CATEGORY)
# supaya sinyal relevansi konsisten dengan sistem kategori yang sudah ada.
_EXISTING_KEYWORDS: set[str] = set()
for _cat in AINA_VALID_CATEGORIES:
    _EXISTING_KEYWORDS.add(_cat.lower())
for _keyword_set, _category in _TAG_TO_CATEGORY:
    _EXISTING_KEYWORDS.update(k.lower() for k in _keyword_set)
    _EXISTING_KEYWORDS.add(_category.lower())

MASISIR_SIGNAL_KEYWORDS: set[str] = _EXISTING_KEYWORDS | _MASISIR_SPECIFIC_KEYWORDS


def quick_keyword_prefilter(title: str, content: str) -> bool:
    """
    Filter murah berbasis keyword, tanpa panggil AI.
    Return True kalau ADA minimal satu sinyal keyword Masisir di title/content
    (artinya: lanjut ke klasifikasi AI). Return False kalau sama sekali tidak
    ada sinyal apapun (artinya: kemungkinan besar tidak relevan, tapi
    keputusan akhir tetap lewat filter_and_extract, bukan langsung ditolak
    di sini — prefilter ini hanya dipakai untuk hemat panggilan AI).
    """
    combined = f"{title or ''} {content or ''}".lower()
    return any(kw in combined for kw in MASISIR_SIGNAL_KEYWORDS)


def _fallback_result(reason: str, needs_manual_check: bool = True) -> dict:
    """Dict fallback yang aman dipakai kapan pun AI gagal/tidak tersedia."""
    return {
        "is_relevant": None if needs_manual_check else False,
        "relevance_score": 0,
        "reason": reason,
        "category": None,
        "key_points": [],
        "action_needed": "",
        "important_dates": "",
    }


def classify_and_extract(title: str, content: str) -> dict:
    """
    Panggil AI untuk klasifikasi relevansi + ekstraksi info terstruktur.

    Return dict:
    {
        "is_relevant": bool | None,   # None = AI gagal, perlu cek manual
        "relevance_score": int,       # 0-100
        "reason": str,
        "category": str | None,
        "key_points": list[str],
        "action_needed": str,
        "important_dates": str,
    }

    TIDAK PERNAH raise — semua exception ditangkap dan dikembalikan sebagai
    fallback dict dengan is_relevant=None (perlu cek manual oleh reviewer).
    """
    try:
        from ai_services import get_openai_client, get_active_model
    except Exception as e:
        logger.warning(f"[MASISIR-FILTER] ai_services tidak tersedia: {e}")
        return _fallback_result("AI tidak tersedia (ai_services gagal diimpor).")

    snippet = (content or "").strip()[:4000]
    system_prompt = (
        "Kamu adalah asisten klasifikasi untuk AINA, chatbot informasi KBRI Kairo "
        "untuk Masisir (Mahasiswa/Masyarakat Indonesia di Mesir, terutama pelajar Al-Azhar "
        "dan sekitar Kairo). Tugasmu: menilai apakah SATU artikel relevan untuk Masisir, "
        "lalu mengekstrak info pentingnya.\n\n"
        "Artikel dianggap RELEVAN kalau berkaitan dengan: kehidupan/administrasi WNI di Mesir, "
        "KBRI/konsuler, pendidikan/Al-Azhar/beasiswa, visa/iqama/paspor, keamanan/travel advisory "
        "Mesir, kegiatan PPMI/organisasi mahasiswa Indonesia di Mesir, isu Palestina/Timur Tengah "
        "yang berdampak ke WNI di Mesir, atau info praktis (transport, tempat tinggal, kuliner) "
        "di Kairo/Mesir untuk pelajar Indonesia.\n"
        "Artikel dianggap TIDAK RELEVAN kalau isinya berita umum yang tidak menyentuh Mesir/Masisir "
        "sama sekali (misal: berita olahraga negara lain, gosip selebriti, politik dalam negeri "
        "Indonesia yang tidak terkait WNI luar negeri, dll).\n\n"
        "WAJIB balas HANYA dengan JSON valid (tanpa markdown code fence, tanpa teks lain), format:\n"
        '{"is_relevant": true/false, "relevance_score": 0-100, "reason": "alasan singkat", '
        '"category": "Administrasi|Akademik|Kehidupan Mesir|Transport|Tempat Tinggal|Kuliner|Bahasa|null", '
        '"key_points": ["poin 1", "poin 2"], "action_needed": "tindakan yang perlu diambil Masisir, kosongkan jika tidak ada", '
        '"important_dates": "tanggal/deadline penting jika ada, kosongkan jika tidak ada"}'
    )
    user_prompt = f"Judul: {title}\n\nIsi artikel:\n{snippet}"

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=get_active_model(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=600,
            temperature=0.2,
        )
        raw = (response.choices[0].message.content or "").strip()
    except Exception as e:
        logger.warning(f"[MASISIR-FILTER] Panggilan AI gagal: {e}")
        return _fallback_result(f"Panggilan AI gagal: {e}")

    # Bersihkan markdown code fence kalau AI tetap membungkusnya
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"[MASISIR-FILTER] Gagal parse JSON dari AI: {e} — raw: {raw[:200]}")
        return _fallback_result("Respons AI tidak bisa diparse sebagai JSON.")
    except Exception as e:
        logger.warning(f"[MASISIR-FILTER] Error tak terduga saat parsing: {e}")
        return _fallback_result(f"Error tak terduga: {e}")

    if not isinstance(parsed, dict):
        return _fallback_result("Respons AI bukan JSON object.")

    category = parsed.get("category")
    if category not in AINA_VALID_CATEGORIES:
        category = None

    key_points = parsed.get("key_points")
    if not isinstance(key_points, list):
        key_points = []
    key_points = [str(p).strip() for p in key_points if str(p).strip()][:8]

    try:
        score = int(parsed.get("relevance_score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    return {
        "is_relevant": bool(parsed.get("is_relevant", False)),
        "relevance_score": score,
        "reason": str(parsed.get("reason") or "").strip()[:400],
        "category": category,
        "key_points": key_points,
        "action_needed": str(parsed.get("action_needed") or "").strip()[:400],
        "important_dates": str(parsed.get("important_dates") or "").strip()[:200],
    }


def filter_and_extract(article: dict) -> dict:
    """
    Orkestrasi: prefilter keyword → (kalau perlu) klasifikasi AI.
    `article` minimal berisi {"title": ..., "content": ...}.

    Menambahkan field-field berikut ke `article` (field asli TIDAK dihapus):
    - is_masisir_relevant: bool | None
    - relevance_score: int
    - relevance_reason: str
    - masisir_category: str | None
    - masisir_key_points: list[str]
    - masisir_action_needed: str
    - masisir_important_dates: str

    Return `article` yang sudah diperkaya (sama object, juga direturn untuk kenyamanan).
    """
    title = article.get("title") or ""
    content = article.get("content") or ""

    has_signal = quick_keyword_prefilter(title, content)

    if not has_signal:
        article["is_masisir_relevant"] = False
        article["relevance_score"] = 0
        article["relevance_reason"] = "Tidak ditemukan kata kunci terkait Masisir/Mesir/KBRI Kairo pada artikel ini."
        article["masisir_category"] = None
        article["masisir_key_points"] = []
        article["masisir_action_needed"] = ""
        article["masisir_important_dates"] = ""
        return article

    result = classify_and_extract(title, content)
    article["is_masisir_relevant"] = result.get("is_relevant")
    article["relevance_score"] = result.get("relevance_score", 0)
    article["relevance_reason"] = result.get("reason", "")
    article["masisir_category"] = result.get("category")
    article["masisir_key_points"] = result.get("key_points", [])
    article["masisir_action_needed"] = result.get("action_needed", "")
    article["masisir_important_dates"] = result.get("important_dates", "")
    return article


# ─── Toggle ON/OFF (persisted di Supabase, default ON) ──────────────────────

def is_masisir_filter_enabled() -> bool:
    """
    True secara default (fail-safe): kalau Supabase tidak tersedia atau
    setting belum pernah disimpan, filter dianggap AKTIF.
    """
    value = get_app_setting(_SETTING_KEY, default=True)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ("false", "0", "off", "no")
    return True


def set_masisir_filter_enabled(enabled: bool) -> bool:
    """Simpan toggle ke Supabase. Return True kalau berhasil disimpan."""
    return set_app_setting(_SETTING_KEY, bool(enabled))
