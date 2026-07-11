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
      title              → title (truncated to 120 chars)
      content            → content
      tags               → keywords (comma-joined, max 300 chars)
      masisir_category   → category (AI-classified — diprioritaskan bila valid)
      tags               → category (via _map_tags_to_category — fallback)
      summary            → summary (truncated to 600 chars)
      masisir_key_points / masisir_action_needed / masisir_important_dates
                         → important_notes (teks terstruktur, max 500 chars)
      -                  → status = "pending"
      -                  → hidden = false
      -                  → article_type = "narrative"
      -                  → author_id = SUPABASE_AUTHOR_ID env var (or fallback admin UUID)
    """
    title = (kb_article.get("title") or "").strip()[:120]
    content = (kb_article.get("content") or "").strip()
    summary = (kb_article.get("summary") or "").strip()[:600]
    tags = kb_article.get("tags") or []

    # ── Category: prioritaskan masisir_category (hasil klasifikasi AI, lebih presisi)
    # dibanding _map_tags_to_category() yang hanya mengandalkan keyword matching biasa.
    masisir_cat = (kb_article.get("masisir_category") or "").strip()
    if masisir_cat in AINA_VALID_CATEGORIES:
        category = masisir_cat
    else:
        category = _map_tags_to_category(tags)

    # Build keywords string from tags (max 300 chars)
    keywords = ", ".join(str(t) for t in tags if t)[:300]

    # ── important_notes: gabungkan hasil ekstraksi masisir dari Tahap 3 ──────────
    # Field ini diisi HANYA jika ada data dari relevance_filter.py (masisir_extract).
    # Kalau toggle filter OFF atau artikel dari sebelum Tahap 3 → important_notes kosong,
    # tidak error.
    important_notes = ""
    key_points  = [str(p).strip() for p in (kb_article.get("masisir_key_points") or []) if str(p).strip()]
    action      = (kb_article.get("masisir_action_needed")   or "").strip()
    imp_dates   = (kb_article.get("masisir_important_dates") or "").strip()

    parts = []
    if key_points:
        parts.append(f"Poin penting: {'; '.join(key_points)}.")
    if action:
        parts.append(f"Tindakan: {action}.")
    if imp_dates:
        parts.append(f"Tanggal penting: {imp_dates}.")

    if parts:
        raw = " ".join(parts)
        if len(raw) > 500:
            # Potong di batas kata, bukan di tengah kata
            raw = raw[:500].rsplit(" ", 1)[0].rstrip(".,;") + "…"
        important_notes = raw

    payload = {
        "author_id":      _get_author_id(),
        "title":          title,
        "content":        content,
        "category":       category,
        "status":         "pending",
        "hidden":         False,
        "article_type":   "narrative",
        "keywords":       keywords,
        "summary":        summary,
        "important_notes": important_notes,
    }
    # Hapus string kosong agar tidak override DB defaults untuk field opsional
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


def get_app_setting(key: str, default=None):
    """
    Ambil satu setting dari tabel app_settings di Supabase (generic key/value store).
    Return `default` jika key tidak ada / Supabase tidak tersedia / terjadi error apapun.
    Tidak pernah raise — aman dipanggil di request path manapun.
    """
    try:
        sb = get_supabase()
        result = sb.table("app_settings").select("value").eq("key", key).limit(1).execute()
        rows = result.data or []
        if not rows:
            return default
        return rows[0].get("value", default)
    except Exception as e:
        logger.warning(f"[APP-SETTINGS-DB] Gagal ambil setting '{key}': {e}")
        return default


def set_app_setting(key: str, value) -> bool:
    """Simpan/update satu setting ke tabel app_settings. Return True jika berhasil."""
    try:
        sb = get_supabase()
        sb.table("app_settings").upsert(
            {"key": key, "value": value},
            on_conflict="key"
        ).execute()
        return True
    except Exception as e:
        logger.warning(f"[APP-SETTINGS-DB] Gagal simpan setting '{key}': {e}")
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
    [MUQARRAR AI PIPELINE] Simpan satu sub-chunk halaman ke tabel muqarrar_chunks.

    Field yang wajib ada di dict chunk:
      id          — unik: "{kitab_id}__p{page:04d}__c{chunk_idx:02d}"
      kitab_id    — ID kitab (slug + timestamp)
      kitab_name  — Nama lengkap kitab
      author      — Pengarang (boleh kosong)
      description — Deskripsi singkat (boleh kosong)
      page_number — Nomor halaman sumber (int, selalu ada)
      chapter     — Judul bab/fasal jika terdeteksi (= section_title di spec)
      content     — Teks sub-chunk (sudah di-clean, 500–900 karakter)
      embedding   — List float dari text-embedding-3-large (1536 dim); [] jika gagal
      word_count  — Jumlah kata dalam chunk
      is_ocr      — True jika teks berasal dari OCR Vision

    NOTE (Phase 2): Saat migrasi ke muqarrar_documents, ubah kitab_id → document_id FK.
    NOTE: Kolom 'chapter' di Supabase = section_title di spec — rename di Phase 2.
    """
    import json as _json
    try:
        sb = get_supabase()
        row = dict(chunk)

        # Validate required fields before sending to Supabase
        for required_field in ("id", "kitab_id", "kitab_name", "page_number", "content"):
            if not row.get(required_field):
                logger.warning(
                    f"[MUQARRAR] chunk inválid: field '{required_field}' kosong — skip "
                    f"(hal {chunk.get('page_number')}, id={chunk.get('id')})"
                )
                return False

        if not isinstance(row.get("page_number"), int):
            logger.warning(f"[MUQARRAR] page_number bukan int — skip id={chunk.get('id')}")
            return False

        # Konversi embedding list → string format pgvector "[x, y, ...]"
        # Chunk tanpa embedding (list kosong) → embedding_vec = NULL (tetap tersimpan,
        # namun tidak bisa digunakan untuk vector search)
        emb = row.get("embedding")
        if emb and isinstance(emb, list) and len(emb) == 1536:
            row["embedding_vec"] = _json.dumps(emb)
        else:
            if emb:
                logger.warning(
                    f"[MUQARRAR] embedding size tidak valid ({len(emb) if isinstance(emb, list) else type(emb)}) "
                    f"— disimpan tanpa vector (hal {chunk.get('page_number')})"
                )
            row["embedding_vec"] = None

        # Upsert: re-upload kitab akan menimpa chunks lama dengan ID yang sama
        sb.table("muqarrar_chunks").upsert(row, on_conflict="id").execute()
        return True
    except Exception as e:
        logger.warning(
            f"[MUQARRAR] Gagal simpan chunk hal {chunk.get('page_number')} "
            f"id={chunk.get('id')}: {e}"
        )
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


# ══════════════════════════════════════════════════════════════════════════════
# VERCEL SERVERLESS MIGRATION — persistence moved from local JSON to Supabase
# ══════════════════════════════════════════════════════════════════════════════
#
# scraped_articles_draft — replaces data/scraped_articles.json
# kb_articles_draft      — replaces data/kb_articles.json
# scrape_jobs            — replaces the in-memory scrape_state global
#
# Local disk is ephemeral/read-only on Vercel serverless, so these tables are
# now the SOLE source of truth (no local fallback). If Supabase env vars are
# missing, callers get a clear RuntimeError instead of a silent no-op.
# See supabase_setup.sql / muqarrar_setup.sql for the existing DDL pattern —
# DDL for these three new tables ships alongside this migration.

def get_scraped_articles() -> list:
    """Ambil semua draft artikel hasil scrape dari scraped_articles_draft, urut terbaru duluan."""
    sb = get_supabase()
    result = (
        sb.table("scraped_articles_draft")
        .select("data")
        .order("scraped_at", desc=True)
        .execute()
    )
    return [row["data"] for row in (result.data or [])]


def save_scraped_articles(articles: list) -> None:
    """
    Ganti TOTAL isi scraped_articles_draft dengan `articles` (replace-all semantics,
    sama seperti _save_articles() versi file JSON lama).
    Setiap artikel disimpan sebagai satu baris: url (unique key) + data (JSONB penuh).
    """
    sb = get_supabase()
    sb.table("scraped_articles_draft").delete().neq("url", "").execute()
    if not articles:
        return
    rows = [{"url": a.get("url") or a.get("id") or "", "data": a} for a in articles]
    batch_size = 200
    for i in range(0, len(rows), batch_size):
        sb.table("scraped_articles_draft").upsert(rows[i:i + batch_size], on_conflict="url").execute()


def get_kb_articles() -> list:
    """Ambil semua KB draft dari kb_articles_draft, urut terbaru duluan."""
    sb = get_supabase()
    result = (
        sb.table("kb_articles_draft")
        .select("data")
        .order("created_at", desc=True)
        .execute()
    )
    return [row["data"] for row in (result.data or [])]


def save_kb_articles(articles: list) -> None:
    """Ganti TOTAL isi kb_articles_draft dengan `articles` (replace-all semantics)."""
    sb = get_supabase()
    sb.table("kb_articles_draft").delete().neq("article_id", "").execute()
    if not articles:
        return
    rows = [{"article_id": str(a.get("id") or a.get("url") or ""), "data": a} for a in articles]
    batch_size = 200
    for i in range(0, len(rows), batch_size):
        sb.table("kb_articles_draft").upsert(rows[i:i + batch_size], on_conflict="article_id").execute()


def create_scrape_job(job_id: str, **fields) -> None:
    """Buat baris job baru di scrape_jobs (dipanggil saat scrape dimulai)."""
    sb = get_supabase()
    row = {
        "job_id": job_id,
        "status": fields.pop("status", "running"),
        "phase": fields.pop("phase", "listing"),
        "current": fields.pop("current", 0),
        "total": fields.pop("total", 0),
        "success": fields.pop("success", 0),
        "partial": fields.pop("partial", 0),
        "failed": fields.pop("failed", 0),
        "duplicate": fields.pop("duplicate", 0),
        "logs": fields.pop("logs", []),
    }
    row.update(fields)
    sb.table("scrape_jobs").upsert(row, on_conflict="job_id").execute()


def update_scrape_job(job_id: str, **fields) -> None:
    """Update kolom job yang ada (progress, status, logs, dst). Silent no-op kalau gagal."""
    try:
        sb = get_supabase()
        fields["updated_at"] = _now_iso_utc()
        sb.table("scrape_jobs").update(fields).eq("job_id", job_id).execute()
    except Exception as e:
        logger.warning(f"[SCRAPE-JOB] Gagal update job {job_id}: {e}")


def get_scrape_job(job_id: str) -> dict | None:
    """Baca satu scrape job by id. Return None kalau tidak ditemukan / Supabase tidak tersedia."""
    try:
        sb = get_supabase()
        result = sb.table("scrape_jobs").select("*").eq("job_id", job_id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as e:
        logger.warning(f"[SCRAPE-JOB] Gagal ambil job {job_id}: {e}")
        return None


def _now_iso_utc() -> str:
    from datetime import datetime, timezone
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def muqarrar_delete_kitab(kitab_id: str) -> bool:
    """Hapus semua chunks milik satu kitab (semua sub-chunks semua halaman)."""
    try:
        sb = get_supabase()
        sb.table("muqarrar_chunks").delete().eq("kitab_id", kitab_id).execute()
        return True
    except Exception as e:
        logger.warning(f"[MUQARRAR] Gagal hapus kitab {kitab_id}: {e}")
        return False
