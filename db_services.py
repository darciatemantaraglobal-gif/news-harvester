import os
import logging

_client = None

def get_supabase():
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di environment. "
                "Fitur Supabase tidak tersedia."
            )
        try:
            from supabase import create_client
            _client = create_client(url, key)
        except ImportError:
            raise RuntimeError("Package 'supabase' belum terinstall. Jalankan: pip install supabase")
    return _client


def push_kb_articles(articles: list) -> dict:
    """Push daftar KB articles ke Supabase (upsert by slug)."""
    sb = get_supabase()
    if not articles:
        return {"inserted": 0, "errors": []}

    result = sb.table("kb_articles").upsert(articles, on_conflict="slug").execute()
    return {"inserted": len(result.data), "errors": []}


def fetch_kb_articles_from_db() -> list:
    """Ambil semua KB articles dari Supabase."""
    sb = get_supabase()
    result = sb.table("kb_articles").select("*").order("created_at", desc=True).execute()
    return result.data or []


def check_supabase_available() -> bool:
    """Return True jika Supabase bisa digunakan (env vars tersedia)."""
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"))
