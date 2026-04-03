# app.py — Flask server untuk News Scraper
import os, json, csv, io, threading, re, unicodedata
from flask import Flask, render_template, request, jsonify, Response

from scraper import scrape_all
from ai_services import generate_ai_summary
from db_services import push_kb_articles, fetch_kb_articles_from_db

app = Flask(__name__)

DATA_DIR = "data"
DATA_FILE = os.path.join(DATA_DIR, "scraped_articles.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
os.makedirs(DATA_DIR, exist_ok=True)

DEFAULT_SETTINGS = {
    "article_link_selector": 'a[href*="/berita/"]',
    "next_page_selector": 'a[rel="next"], a.next, .pagination a',
    "title_selector": "h1, h2, .title, .news-title, .post-title",
    "date_selector": ".date, .news-date, time, .published-date, .post-date",
    "content_selector": ".ck-content, .post-content, .news-content, .article-content, .content, article, .entry-content",
}


def _load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                merged = {**DEFAULT_SETTINGS, **saved}
                return merged
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def _save_settings(data: dict):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# State global untuk progress tracking
scrape_state = {
    "running": False,
    "phase": "idle",      # idle, listing, scraping, done
    "current": 0,
    "total": 0,
    "success": 0,
    "partial": 0,
    "failed": 0,
    "duplicate": 0,
    "logs": [],
    "articles": [],
}
state_lock = threading.Lock()


def _load_articles() -> list:
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _save_articles(data: list):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _progress_callback(msg, **kwargs):
    with state_lock:
        scrape_state["logs"].append(msg)
        for k, v in kwargs.items():
            if k in scrape_state:
                scrape_state[k] = v


def _run_scrape(url: str, settings: dict, mode: str):
    with state_lock:
        scrape_state["running"] = True
        scrape_state["phase"] = "listing"
        scrape_state["current"] = 0
        scrape_state["total"] = 0
        scrape_state["success"] = 0
        scrape_state["partial"] = 0
        scrape_state["failed"] = 0
        scrape_state["duplicate"] = 0
        scrape_state["logs"] = []
        scrape_state["articles"] = []

    try:
        # Load artikel yang sudah ada untuk cross-run deduplication
        existing = _load_articles()

        new_articles = scrape_all(
            url,
            settings=settings,
            mode=mode,
            existing_articles=existing,
            progress_callback=_progress_callback,
        )

        # Gabungkan dengan artikel lama (skip URL yang sudah ada)
        existing_urls = {a["url"] for a in existing}
        merged = existing + [a for a in new_articles if a["url"] not in existing_urls]
        _save_articles(merged)

        with state_lock:
            scrape_state["articles"] = merged
            scrape_state["phase"] = "done"
    except Exception as e:
        with state_lock:
            scrape_state["logs"].append(f"FATAL ERROR: {str(e)}")
            scrape_state["phase"] = "done"
    finally:
        with state_lock:
            scrape_state["running"] = False


# ─── Routes ─────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/article/<article_id>")
def article_detail(article_id):
    articles = _load_articles()
    article = next((a for a in articles if a["id"] == article_id), None)
    return render_template("article.html", article=article)


@app.route("/settings", methods=["GET"])
def get_settings():
    return jsonify(_load_settings())


@app.route("/settings", methods=["POST"])
def post_settings():
    data = request.get_json(force=True)
    allowed_keys = {
        "article_link_selector", "next_page_selector",
        "title_selector", "date_selector", "content_selector",
    }
    current = _load_settings()
    for k in allowed_keys:
        if k in data:
            current[k] = str(data[k]).strip()
    _save_settings(current)
    return jsonify({"status": "ok", "settings": current})


@app.route("/api/scrape", methods=["POST"])
def api_scrape():
    with state_lock:
        if scrape_state["running"]:
            return jsonify({"error": "Scraping sedang berjalan"}), 409
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    mode = (data.get("mode") or "full").strip()
    if mode not in ("list", "full", "kb"):
        mode = "full"
    if not url:
        return jsonify({"error": "URL tidak boleh kosong"}), 400
    if not url.startswith("http"):
        return jsonify({"error": "URL tidak valid, harus dimulai dengan http:// atau https://"}), 400
    settings = _load_settings()
    threading.Thread(target=_run_scrape, args=(url, settings, mode), daemon=True).start()
    return jsonify({"status": "started"})


@app.route("/api/progress")
def api_progress():
    with state_lock:
        return jsonify({
            "running": scrape_state["running"],
            "phase": scrape_state["phase"],
            "current": scrape_state["current"],
            "total": scrape_state["total"],
            "success": scrape_state["success"],
            "partial": scrape_state["partial"],
            "failed": scrape_state["failed"],
            "duplicate": scrape_state["duplicate"],
            "logs": scrape_state["logs"][-50:],  # kirim 50 log terakhir
        })


@app.route("/api/articles")
def api_articles():
    articles = _load_articles()
    return jsonify(articles)


@app.route("/api/article/<article_id>")
def api_article(article_id):
    articles = _load_articles()
    article = next((a for a in articles if a["id"] == article_id), None)
    if not article:
        return jsonify({"error": "Artikel tidak ditemukan"}), 404
    return jsonify(article)


@app.route("/export/json")
def export_json():
    articles = _load_articles()
    return Response(
        json.dumps(articles, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=scraped_articles.json"},
    )


KB_FILE = os.path.join(DATA_DIR, "kb_articles.json")


def _make_slug(title: str) -> str:
    """Buat slug sederhana dari title."""
    title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    title = title.lower()
    title = re.sub(r"[^a-z0-9\s-]", "", title)
    title = re.sub(r"[\s]+", "-", title.strip())
    title = re.sub(r"-+", "-", title)
    return title[:80]


def _clean_whitespace(text: str) -> str:
    """Bersihkan whitespace berlebihan."""
    lines = [line.strip() for line in text.splitlines()]
    lines = [l for l in lines if l]
    return "\n".join(lines)


def _make_summary(content: str, n: int = 3) -> str:
    """Ambil n kalimat pertama sebagai summary."""
    sentences = re.split(r"(?<=[.!?])\s+", content.strip())
    sentences = [s.strip() for s in sentences if s.strip()]
    return " ".join(sentences[:n])


@app.route("/api/convert-kb", methods=["POST"])
def api_convert_kb():
    articles = _load_articles()
    if not articles:
        return jsonify({"error": "Belum ada artikel untuk dikonversi."}), 400

    kb_articles = []
    for a in articles:
        raw_content = a.get("content") or ""
        clean_content = _clean_whitespace(raw_content)
        title = (a.get("title") or "").strip()
        kb_articles.append({
            "title": title,
            "slug": _make_slug(title) if title else a.get("id", ""),
            "source_url": a.get("url", ""),
            "published_date": a.get("date", ""),
            "content": clean_content,
            "summary": _make_summary(clean_content),
            "tags": ["berita", "kemlu", "kairo"],
        })

    with open(KB_FILE, "w", encoding="utf-8") as f:
        json.dump(kb_articles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok", "count": len(kb_articles)})


@app.route("/api/push-supabase", methods=["POST"])
def api_push_supabase():
    """Push KB articles ke Supabase."""
    if not os.path.exists(KB_FILE):
        return jsonify({"error": "KB belum dikonversi. Jalankan Convert to KB Format terlebih dahulu."}), 400
    with open(KB_FILE, "r", encoding="utf-8") as f:
        kb_articles = json.load(f)
    if not kb_articles:
        return jsonify({"error": "KB kosong."}), 400
    try:
        result = push_kb_articles(kb_articles)
        return jsonify({"status": "ok", "inserted": result["inserted"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai-summary", methods=["POST"])
def api_ai_summary():
    """Generate AI summary untuk satu artikel."""
    data = request.get_json(force=True)
    article_id = (data.get("id") or "").strip()
    if not article_id:
        return jsonify({"error": "ID artikel diperlukan."}), 400

    articles = _load_articles()
    article = next((a for a in articles if a["id"] == article_id), None)
    if not article:
        return jsonify({"error": "Artikel tidak ditemukan."}), 404

    try:
        summary = generate_ai_summary(
            title=article.get("title") or "",
            content=article.get("content") or "",
        )
        return jsonify({"status": "ok", "summary": summary})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai-summary-all", methods=["POST"])
def api_ai_summary_all():
    """Generate AI summary untuk semua artikel KB dan update KB file."""
    if not os.path.exists(KB_FILE):
        return jsonify({"error": "KB belum dikonversi."}), 400
    with open(KB_FILE, "r", encoding="utf-8") as f:
        kb_articles = json.load(f)
    if not kb_articles:
        return jsonify({"error": "KB kosong."}), 400

    errors = []
    for art in kb_articles:
        try:
            art["ai_summary"] = generate_ai_summary(
                title=art.get("title") or "",
                content=art.get("content") or "",
            )
        except Exception as e:
            errors.append({"slug": art.get("slug"), "error": str(e)})

    with open(KB_FILE, "w", encoding="utf-8") as f:
        json.dump(kb_articles, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "ok", "count": len(kb_articles), "errors": errors})


@app.route("/api/db-articles")
def api_db_articles():
    """Ambil semua artikel dari Supabase."""
    try:
        articles = fetch_kb_articles_from_db()
        return jsonify(articles)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/export/kb")
def export_kb():
    if not os.path.exists(KB_FILE):
        return jsonify({"error": "KB belum dikonversi."}), 404
    with open(KB_FILE, "r", encoding="utf-8") as f:
        data = f.read()
    return Response(
        data,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=kb_articles.json"},
    )


@app.route("/export/csv")
def export_csv():
    articles = _load_articles()
    si = io.StringIO()
    fields = ["id", "title", "date", "url", "content", "status", "error_reason", "mode"]
    writer = csv.DictWriter(si, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(articles)
    return Response(
        si.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=scraped_articles.csv"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
