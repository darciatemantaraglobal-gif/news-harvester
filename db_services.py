import os
import logging

logger = logging.getLogger(__name__)

_client = None

# ─── AINA knowledge_base schema ────────────────────────────────────────────────
# Table: knowledge_base
# Required: title (TEXT), content (TEXT), category (TEXT), status (TEXT), hidden (BOOL)
# Optional: article_type (TEXT), keywords (TEXT), summary (TEXT),
#           important_notes (TEXT), last_updated (TIMESTAMPTZ)
# No: slug, source_url, published_date (those are scraper-internal fields)

AINA_VALID_CATEGORIES = {
    "Administrasi", "Akademik", "Kehidupan Mesir",
    "Transport", "Tempat Tinggal", "Kuliner", "Bahasa",
}

# Tag → AINA category mapping (first match wins, checked in order)
_TAG_TO_CATEGORY = [
    # Akademik
    ({"pendidikan", "beasiswa", "scholarship", "mahasiswa", "pelajar", "akademik"}, "Akademik"),
    # Transport
    ({"transport", "transportasi", "bus", "metro", "kereta", "taxi"}, "Transport"),
    # Tempat Tinggal
    ({"tempat tinggal", "perumahan", "akomodasi", "apartemen", "sewa", "kost"}, "Tempat Tinggal"),
    # Kuliner
    ({"kuliner", "makanan", "restoran", "halal", "food"}, "Kuliner"),
    # Bahasa
    ({"bahasa", "arab", "language"}, "Bahasa"),
    # Kehidupan Mesir
    ({"kehidupan", "kairo", "mesir", "cairo", "egypt"}, "Kehidupan Mesir"),
    # Administrasi — default for KBRI/konsuler/dokumen content
    ({"administrasi", "paspor", "visa", "iqomah", "surat", "legalisasi",
      "apostille", "perpanjangan", "konsuler", "kbri", "kedutaan", "wni",
      "perlindungan", "hukum", "pernikahan", "nikah", "pelayanan", "bantuan",
      "diplomasi", "bilateral"}, "Administrasi"),
]


def _map_tags_to_category(tags: list) -> str:
    """Map our internal tags list to AINA's valid category string."""
    tag_set = {str(t).lower() for t in (tags or [])}
    for keyword_set, category in _TAG_TO_CATEGORY:
        if tag_set & keyword_set:
            return category
    return "Administrasi"  # safe default — most KBRI content is administrative


# The AINA knowledge_base table requires a non-null author_id (FK to auth.users).
# Set SUPABASE_AUTHOR_ID env var to the UUID of the AINA admin account that will
# "own" scraper-imported articles. Defaults to the primary admin observed in the DB.
_FALLBACK_AUTHOR_ID = "38a8f526-b1a7-47ef-9a04-ecc8b2b63f27"


def _get_author_id() -> str:
    return os.environ.get("SUPABASE_AUTHOR_ID") or _FALLBACK_AUTHOR_ID


def _build_aina_payload(kb_article: dict) -> dict:
    """
    Convert a local KB draft article into a payload ready for AINA's knowledge_base table.

    Maps:
      title       → title (truncated to 120 chars)
      content     → content
      tags        → category (via _map_tags_to_category) + keywords (comma-joined)
      summary     → summary (truncated to 600 chars)
      -           → status = "pending"
      -           → hidden = false
      -           → article_type = "narrative"
      -           → author_id = SUPABASE_AUTHOR_ID env var (or fallback admin UUID)
    """
    title = (kb_article.get("title") or "").strip()[:120]
    content = (kb_article.get("content") or "").strip()
    summary = (kb_article.get("summary") or "").strip()[:600]
    tags = kb_article.get("tags") or []

    category = _map_tags_to_category(tags)

    # Build keywords string from tags (max 300 chars)
    keywords = ", ".join(str(t) for t in tags if t)[:300]

    payload = {
        "author_id": _get_author_id(),
        "title": title,
        "content": content,
        "category": category,
        "status": "pending",
        "hidden": False,
        "article_type": "narrative",
        "keywords": keywords,
        "summary": summary,
    }
    # Remove empty strings to avoid overriding DB defaults for optional fields
    return {k: v for k, v in payload.items() if v != ""}


def get_supabase():
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        # Prefer service-role key (admin access, bypasses RLS) → fall back to anon key
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL atau SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment. "
                "Fitur Supabase tidak tersedia."
            )
        try:
            from supabase import create_client
            _client = create_client(url, key)
        except ImportError:
            raise RuntimeError("Package 'supabase' belum terinstall. Jalankan: pip install supabase")
    return _client


def push_kb_articles(articles: list) -> dict:
    """
    Push daftar KB articles ke AINA's Supabase knowledge_base table.
    Each article is inserted with status='pending' for admin review in AINA's dashboard.
    Skips articles with empty title or content.
    Returns: { inserted, skipped, errors }
    """
    sb = get_supabase()
    if not articles:
        return {"inserted": 0, "skipped": 0, "errors": []}

    inserted = 0
    skipped = 0
    errors = []

    for art in articles:
        title = (art.get("title") or "").strip()
        content = (art.get("content") or "").strip()

        if not title or not content:
            skipped += 1
            logger.warning(f"[DB] Skip artikel tanpa judul/konten: {art.get('id', '?')}")
            continue

        payload = _build_aina_payload(art)

        try:
            result = sb.table("knowledge_base").insert(payload).execute()
            if result.data:
                inserted += 1
                logger.info(f"[DB] Inserted: {title[:60]}")
            else:
                errors.append(f"Insert gagal (no data returned): {title[:60]}")
        except Exception as e:
            msg = str(e)
            logger.error(f"[DB] Insert error for '{title[:60]}': {msg}")
            errors.append(f"{title[:60]}: {msg[:120]}")

    logger.info(f"[DB] Push selesai — inserted={inserted}, skipped={skipped}, errors={len(errors)}")
    return {"inserted": inserted, "skipped": skipped, "errors": errors}


def fetch_kb_articles_from_db() -> list:
    """Ambil artikel terbaru dari AINA's knowledge_base table (max 100)."""
    sb = get_supabase()
    result = (
        sb.table("knowledge_base")
        .select("id, title, category, status, keywords, summary, created_at")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    # Normalize the fields our frontend table expects
    rows = result.data or []
    normalized = []
    for r in rows:
        normalized.append({
            "id": r.get("id"),
            "title": r.get("title") or "",
            "published_date": (r.get("created_at") or "")[:10],
            "tags": [t.strip() for t in (r.get("keywords") or "").split(",") if t.strip()],
            "category": r.get("category") or "",
            "status": r.get("status") or "",
            "summary": r.get("summary") or "",
        })
    return normalized


def check_supabase_available() -> bool:
    """Return True jika Supabase bisa digunakan (env vars tersedia)."""
    url = bool(os.environ.get("SUPABASE_URL"))
    key = bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))
    return url and key


def save_user_activity(username: str, last_login: str | None = None, last_seen: str | None = None) -> bool:
    """
    Simpan/update aktivitas user (last_login dan/atau last_seen) ke tabel user_activity di Supabase.
    Return True jika berhasil.
    """
    try:
        sb = get_supabase()
        payload: dict = {"username": username}
        if last_login is not None:
            payload["last_login"] = last_login
        if last_seen is not None:
            payload["last_seen"] = last_seen
        sb.table("user_activity").upsert(payload, on_conflict="username").execute()
        return True
    except Exception as e:
        logger.warning(f"[USER-ACTIVITY-DB] Gagal simpan aktivitas '{username}': {e}")
        return False


def fetch_user_activity() -> dict:
    """
    Ambil semua aktivitas user dari tabel user_activity di Supabase.
    Return dict {username: {last_login, last_seen}}.
    """
    try:
        sb = get_supabase()
        result = sb.table("user_activity").select("username, last_login, last_seen").execute()
        return {row["username"]: row for row in (result.data or [])}
    except Exception as e:
        logger.warning(f"[USER-ACTIVITY-DB] Gagal fetch aktivitas: {e}")
        return {}


def fetch_app_users() -> list:
    """
    Ambil semua user dari tabel app_users di Supabase.
    Return list of {username, password_hash}. Kosong jika tabel belum ada / Supabase tidak tersedia.
    """
    try:
        sb = get_supabase()
        result = sb.table("app_users").select("username, password_hash").execute()
        return result.data or []
    except Exception as e:
        logger.warning(f"[APP-USERS-DB] Gagal fetch users dari Supabase: {e}")
        return []


def save_app_user(username: str, password_hash: str) -> bool:
    """Simpan/update satu user ke tabel app_users. Return True jika berhasil."""
    try:
        sb = get_supabase()
        sb.table("app_users").upsert(
            {"username": username, "password_hash": password_hash},
            on_conflict="username"
        ).execute()
        return True
    except Exception as e:
        logger.warning(f"[APP-USERS-DB] Gagal simpan user '{username}': {e}")
        return False


def delete_app_user(username: str) -> bool:
    """Hapus user dari tabel app_users. Return True jika berhasil."""
    try:
        sb = get_supabase()
        sb.table("app_users").delete().eq("username", username).execute()
        return True
    except Exception as e:
        logger.warning(f"[APP-USERS-DB] Gagal hapus user '{username}': {e}")
        return False


def save_push_log_to_supabase(entry: dict) -> bool:
    """
    Simpan satu entri push log ke tabel push_logs di Supabase.
    Return True jika berhasil, False jika gagal (tabel belum ada / Supabase tidak tersedia).
    """
    try:
        sb = get_supabase()
        payload = {
            "id": entry["id"],
            "timestamp": entry.get("timestamp"),
            "username": entry.get("username", "unknown"),
            "source": entry.get("source", "unknown"),
            "count": entry.get("count", 0),
            "titles": entry.get("titles", []),
        }
        sb.table("push_logs").upsert(payload, on_conflict="id").execute()
        return True
    except Exception as e:
        logger.warning(f"[PUSH-LOG-DB] Gagal simpan ke Supabase: {e}")
        return False


def fetch_push_logs_from_supabase(limit: int = 200) -> list:
    """
    Ambil push log dari tabel push_logs di Supabase, urut terbaru duluan.
    Return list kosong jika tabel belum ada atau Supabase tidak tersedia.
    """
    try:
        sb = get_supabase()
        result = (
            sb.table("push_logs")
            .select("id, timestamp, username, source, count, titles")
            .order("timestamp", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.warning(f"[PUSH-LOG-DB] Gagal fetch dari Supabase: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# MUQARRAR — per-page KB chunks with embeddings
# ══════════════════════════════════════════════════════════════════════════════

def muqarrar_check_table() -> dict:
    """
    Periksa apakah tabel muqarrar_chunks sudah ada di Supabase.
    Return {"exists": True/False, "error": str|None}
    """
    try:
        sb = get_supabase()
        sb.table("muqarrar_chunks").select("id").limit(1).execute()
        return {"exists": True, "error": None}
    except Exception as e:
        err = str(e)
        if "does not exist" in err or "relation" in err or "42P01" in err:
            return {"exists": False, "error": "Tabel belum dibuat. Jalankan muqarrar_setup.sql di Supabase SQL Editor."}
        return {"exists": False, "error": err}


def muqarrar_save_chunk(chunk: dict) -> bool:
    """
    Simpan satu chunk halaman muqarrar ke Supabase.
    chunk: {id, kitab_id, kitab_name, author, page_number, chapter, content, embedding, word_count, is_ocr}
    """
    try:
        sb = get_supabase()
        sb.table("muqarrar_chunks").upsert(chunk, on_conflict="id").execute()
        return True
    except Exception as e:
        logger.warning(f"[MUQARRAR] Gagal simpan chunk hal {chunk.get('page_number')}: {e}")
        return False


def muqarrar_fetch_chunks_for_search(kitab_id: str | None = None) -> list:
    """
    Ambil semua chunks (dengan embedding) untuk similarity search.
    Jika kitab_id diberikan, filter per kitab. Sinon, ambil semua.
    Return list of dicts.
    """
    try:
        sb = get_supabase()
        q = sb.table("muqarrar_chunks").select(
            "id, kitab_id, kitab_name, author, page_number, chapter, content, embedding, word_count"
        )
        if kitab_id:
            q = q.eq("kitab_id", kitab_id)
        result = q.order("page_number").execute()
        return result.data or []
    except Exception as e:
        logger.warning(f"[MUQARRAR] Gagal fetch chunks: {e}")
        return []


def muqarrar_list_kitab() -> list:
    """
    Ambil daftar kitab yang sudah diupload.
    Return list of {kitab_id, kitab_name, author, description, total_pages, created_at}
    """
    try:
        sb = get_supabase()
        result = (
            sb.table("muqarrar_chunks")
            .select("kitab_id, kitab_name, author, description, page_number, created_at")
            .order("created_at", desc=True)
            .execute()
        )
        rows = result.data or []
        # Group by kitab_id
        kitab_map: dict = {}
        for r in rows:
            kid = r["kitab_id"]
            if kid not in kitab_map:
                kitab_map[kid] = {
                    "kitab_id": kid,
                    "kitab_name": r["kitab_name"],
                    "author": r.get("author", ""),
                    "description": r.get("description", ""),
                    "total_pages": 0,
                    "created_at": r.get("created_at", ""),
                }
            kitab_map[kid]["total_pages"] = max(kitab_map[kid]["total_pages"], r["page_number"])
        return sorted(kitab_map.values(), key=lambda x: x["created_at"], reverse=True)
    except Exception as e:
        logger.warning(f"[MUQARRAR] Gagal list kitab: {e}")
        return []


def muqarrar_delete_kitab(kitab_id: str) -> bool:
    """Hapus semua chunks milik satu kitab."""
    try:
        sb = get_supabase()
        sb.table("muqarrar_chunks").delete().eq("kitab_id", kitab_id).execute()
        return True
    except Exception as e:
        logger.warning(f"[MUQARRAR] Gagal hapus kitab {kitab_id}: {e}")
        return False
        return []
