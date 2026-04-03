import os
from supabase import create_client, Client

_client = None

def get_supabase() -> Client:
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di environment.")
        _client = create_client(url, key)
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
