# app.py — Flask server untuk News Scraper
import os, json, csv, io, threading, re, unicodedata, logging
from datetime import datetime, date, timedelta
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from scraper import scrape_all, auto_detect_selectors
from kemlu_scraper import is_kemlu_url
from ai_services import generate_ai_summary, check_openai_available
from db_services import push_kb_articles, fetch_kb_articles_from_db, check_supabase_available
from kb_processor import generate_slug, generate_summary, generate_tags, convert_to_kb_format

# ─── Logging Setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins="*")


@app.after_request
def add_no_cache_headers(response):
    """Pastikan API responses tidak di-cache oleh browser."""
    if request.path.startswith("/api/") or request.path in ("/settings", "/kb-drafts"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

DATA_DIR = "data"
CONFIG_DIR = "config"
DATA_FILE = os.path.join(DATA_DIR, "scraped_articles.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
SCHEDULER_FILE = os.path.join(CONFIG_DIR, "scheduler_settings.json")
LAST_JOB_FILE = os.path.join(DATA_DIR, "last_job.json")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)

DEFAULT_SCHEDULER = {
    "enabled": False,
    "interval": "manual",   # "manual" | "daily" | "weekly"
    "day_of_week": "mon",   # used when weekly (mon/tue/wed/thu/fri/sat/sun)
    "time_of_day": "06:00", # HH:MM
    "url": "",
    "scrape_mode": "full",  # "full" | "kb"
    "incremental": True,
    "last_run_at": None,
    "last_run_articles_added": 0,
    "last_run_url": "",
    "last_run_mode": "full",
}

# APScheduler — background, survives across requests
_scheduler = BackgroundScheduler(timezone="Asia/Jakarta")
_scheduler.start()


def _load_scheduler_settings() -> dict:
    if os.path.exists(SCHEDULER_FILE):
        try:
            with open(SCHEDULER_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                return {**DEFAULT_SCHEDULER, **saved}
        except Exception:
            pass
    return dict(DEFAULT_SCHEDULER)


def _save_scheduler_settings(data: dict):
    with open(SCHEDULER_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _next_run_iso() -> str | None:
    """Kembalikan waktu eksekusi berikutnya dari APScheduler sebagai ISO string."""
    job = _scheduler.get_job("scheduled_scrape")
    if job and job.next_run_time:
        return job.next_run_time.strftime("%Y-%m-%dT%H:%M:%S")
    return None


def _run_scheduled_scrape():
    """Dipanggil oleh APScheduler. Gunakan settings yang tersimpan."""
    cfg = _load_scheduler_settings()
    url = cfg.get("url", "").strip()
    mode = cfg.get("scrape_mode", "full")
    incremental = cfg.get("incremental", True)

    if not url:
        logging.warning("[SCHEDULER] URL belum dikonfigurasi, scraping dibatalkan.")
        return

    with state_lock:
        if scrape_state["running"]:
            logging.warning("[SCHEDULER] Scraping sedang berjalan, jadwal dilewati.")
            return

    logging.info(f"[SCHEDULER] Memulai scraping terjadwal: {url} | mode={mode} | incremental={incremental}")
    settings = _load_settings()

    # Hitung artikel sebelum
    before_count = len(_load_articles())

    _run_scrape(url, settings, mode,
                scheduled=True, incremental=incremental)

    # Hitung artikel baru
    after_count = len(_load_articles())
    added = max(0, after_count - before_count)

    cfg = _load_scheduler_settings()
    cfg["last_run_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    cfg["last_run_articles_added"] = added
    cfg["last_run_url"] = url
    cfg["last_run_mode"] = mode
    _save_scheduler_settings(cfg)
    logging.info(f"[SCHEDULER] Selesai. {added} artikel baru ditambahkan.")


def _apply_scheduler(cfg: dict):
    """Terapkan job APScheduler sesuai settings. Hapus job lama dahulu."""
    _scheduler.remove_job("scheduled_scrape") if _scheduler.get_job("scheduled_scrape") else None

    if not cfg.get("enabled") or cfg.get("interval") == "manual":
        return  # Tidak ada jadwal

    time_str = cfg.get("time_of_day", "06:00")
    try:
        h, m = time_str.split(":")
        hour, minute = int(h), int(m)
    except Exception:
        hour, minute = 6, 0

    interval = cfg.get("interval")
    if interval == "daily":
        trigger = CronTrigger(hour=hour, minute=minute, timezone="Asia/Jakarta")
    elif interval == "weekly":
        dow = cfg.get("day_of_week", "mon")
        trigger = CronTrigger(day_of_week=dow, hour=hour, minute=minute, timezone="Asia/Jakarta")
    else:
        return

    _scheduler.add_job(
        _run_scheduled_scrape,
        trigger=trigger,
        id="scheduled_scrape",
        replace_existing=True,
        misfire_grace_time=300,
    )
    logging.info(f"[SCHEDULER] Job terdaftar: interval={interval}, jam={hour:02d}:{minute:02d}")


# Terapkan scheduler dari settings yang tersimpan saat startup
_apply_scheduler(_load_scheduler_settings())

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


def _load_last_job() -> dict | None:
    """Load parameter scrape terakhir yang dijalankan."""
    if os.path.exists(LAST_JOB_FILE):
        try:
            with open(LAST_JOB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def _save_last_job(url: str, mode: str, start_date: date | None, end_date: date | None):
    """Simpan parameter scrape terakhir ke disk."""
    job = {
        "url": url,
        "mode": mode,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "saved_at": datetime.now().isoformat(),
    }
    with open(LAST_JOB_FILE, "w", encoding="utf-8") as f:
        json.dump(job, f, ensure_ascii=False, indent=2)


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


def _run_scrape(url: str, settings: dict, mode: str,
                start_date: date | None = None, end_date: date | None = None,
                incremental: bool = True, scheduled: bool = False):
    run_label = "[SCHEDULED]" if scheduled else "[MANUAL]"
    # Simpan parameter job ini agar bisa di-restart setelah reset
    if not scheduled:
        _save_last_job(url, mode, start_date, end_date)
    with state_lock:
        scrape_state["running"] = True
        scrape_state["phase"] = "listing"
        scrape_state["current"] = 0
        scrape_state["total"] = 0
        scrape_state["success"] = 0
        scrape_state["partial"] = 0
        scrape_state["failed"] = 0
        scrape_state["duplicate"] = 0
        scrape_state["logs"] = [f"{run_label} Memulai scraping: {url}"]
        scrape_state["articles"] = []

    try:
        # ── Auto-detect selectors untuk non-kemlu sites ───────────────────────
        if not is_kemlu_url(url):
            detected = auto_detect_selectors(url, log_fn=_progress_callback)
            if detected:
                settings = {**settings, **detected}
                # Simpan selector yang terdeteksi ke file settings agar persistent
                try:
                    cfg = _load_settings()
                    cfg.update(detected)
                    _save_settings(cfg)
                except Exception:
                    pass

        # Incremental: load existing untuk deduplication; Full refresh: start clean
        existing = _load_articles() if incremental else []
        if not incremental:
            _progress_callback(f"{run_label} Mode full refresh — data lama dibersihkan.")

        # Merged list yang akan di-update secara inkremental
        merged = list(existing)
        merged_urls = {a["url"] for a in existing}

        def _article_callback(article):
            """Dipanggil setelah setiap artikel berhasil di-scrape — simpan segera ke disk."""
            url_key = article.get("url", "")
            with state_lock:
                if url_key and url_key in merged_urls:
                    return
                if url_key:
                    merged_urls.add(url_key)
                merged.append(article)
                # Update running counters
                s = article.get("status", "")
                if s == "success":
                    scrape_state["success"] += 1
                elif s == "partial":
                    scrape_state["partial"] += 1
                elif s == "failed":
                    scrape_state["failed"] += 1
            _save_articles(merged)

        scrape_all(
            url,
            settings=settings,
            mode=mode,
            existing_articles=existing,
            progress_callback=_progress_callback,
            start_date=start_date,
            end_date=end_date,
            article_callback=_article_callback,
        )

        # Final save — ensure consistent state after all articles are processed
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


@app.route("/api/detect-selectors", methods=["POST"])
def api_detect_selectors():
    """
    Deteksi otomatis CSS selector dari URL yang diberikan.
    Body: { "url": "https://..." }
    """
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "URL diperlukan"}), 400
    logs: list[str] = []
    detected = auto_detect_selectors(url, log_fn=lambda m: logs.append(m))
    if detected:
        current = _load_settings()
        current.update(detected)
        _save_settings(current)
    return jsonify({"detected": detected, "logs": logs})


def _parse_date_param(s: str | None) -> date | None:
    """Parse 'yyyy-mm-dd' string ke datetime.date, return None jika gagal."""
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


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

    # ── Date range filter ──
    date_filter = (data.get("date_filter") or "all").strip()
    today = date.today()
    start_date: date | None = None
    end_date: date | None = today  # cap upper bound at today

    if date_filter == "last_7":
        start_date = today - timedelta(days=7)
    elif date_filter == "last_30":
        start_date = today - timedelta(days=30)
    elif date_filter == "custom":
        start_date = _parse_date_param(data.get("start_date"))
        end_date = _parse_date_param(data.get("end_date")) or today
    else:
        end_date = None  # "all" → no cap

    settings = _load_settings()
    threading.Thread(
        target=_run_scrape,
        args=(url, settings, mode, start_date, end_date),
        daemon=True,
    ).start()
    return jsonify({"status": "started", "date_filter": date_filter,
                    "start_date": start_date.isoformat() if start_date else None,
                    "end_date": end_date.isoformat() if end_date else None})


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


@app.route("/api/articles/bulk-delete", methods=["POST"])
def api_articles_bulk_delete():
    """Hapus artikel terpilih berdasarkan daftar ID."""
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    if not ids:
        return jsonify({"error": "Tidak ada ID yang dipilih."}), 400
    id_set = set(ids)
    articles = _load_articles()
    before = len(articles)
    articles = [a for a in articles if a.get("id") not in id_set]
    _save_articles(articles)
    deleted = before - len(articles)
    return jsonify({"status": "ok", "deleted": deleted, "remaining": len(articles)})


@app.route("/api/articles/clear-all", methods=["POST"])
def api_articles_clear_all():
    """Hapus semua hasil scraping."""
    articles = _load_articles()
    count = len(articles)
    _save_articles([])
    return jsonify({"status": "ok", "deleted": count})


@app.route("/api/reset-all", methods=["POST"])
def api_reset_all():
    """Reset semua data: artikel, KB Draft, dan progress/log."""
    global scrape_state
    # Hapus artikel scraping
    article_count = len(_load_articles())
    _save_articles([])
    # Hapus KB Draft
    kb_count = len(_load_kb())
    _save_kb([])
    # Hapus file KB approved/exported jika ada
    for f in [KB_APPROVED_FILE, KB_EXPORTED_FILE]:
        try:
            if os.path.exists(f):
                os.remove(f)
        except Exception:
            pass
    # Reset progress/log
    with state_lock:
        scrape_state.update({
            "running": False,
            "phase": "idle",
            "current": 0,
            "total": 0,
            "success": 0,
            "partial": 0,
            "failed": 0,
            "duplicate": 0,
            "logs": [],
            "articles": [],
        })

    return jsonify({
        "status": "ok",
        "articles_deleted": article_count,
        "kb_deleted": kb_count,
    })


@app.route("/export/json")
def export_json():
    articles = _load_articles()
    return Response(
        json.dumps(articles, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=scraped_articles.json"},
    )


KB_FILE = os.path.join(DATA_DIR, "kb_articles.json")
KB_APPROVED_FILE = os.path.join(DATA_DIR, "kb_approved.json")
KB_EXPORTED_FILE = os.path.join(DATA_DIR, "kb_exported.json")

VALID_STATUSES = {"pending", "reviewed", "approved", "rejected", "exported"}
BULK_ACTION_MAP = {
    "mark_reviewed": "reviewed",
    "approve": "approved",
    "reject": "rejected",
    "export": "exported",
}


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _load_kb() -> list:
    if os.path.exists(KB_FILE):
        try:
            with open(KB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_kb(data: list):
    with open(KB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_file(path: str) -> list:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_file(path: str, data: list):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _sync_article_to(path: str, article: dict):
    """Upsert artikel ke file JSON (approved atau exported)."""
    items = _load_file(path)
    art_id = article.get("id")
    replaced = False
    for i, item in enumerate(items):
        if item.get("id") == art_id:
            items[i] = article
            replaced = True
            break
    if not replaced:
        items.append(article)
    _save_file(path, items)


@app.route("/api/generate-summary", methods=["POST"])
def api_generate_summary():
    """Generate summary singkat untuk semua artikel scraped (tanpa AI)."""
    articles = _load_articles()
    if not articles:
        return jsonify({"error": "Belum ada artikel."}), 400

    updated = 0
    for a in articles:
        content = (a.get("content") or "").strip()
        if content and not a.get("summary"):
            a["summary"] = generate_summary(content)
            updated += 1

    _save_articles(articles)
    return jsonify({"status": "ok", "updated": updated, "total": len(articles)})


@app.route("/api/auto-tag", methods=["POST"])
def api_auto_tag():
    """Generate tags otomatis untuk semua artikel scraped (berbasis keyword)."""
    articles = _load_articles()
    if not articles:
        return jsonify({"error": "Belum ada artikel."}), 400

    for a in articles:
        title = (a.get("title") or "").strip()
        content = (a.get("content") or "").strip()
        a["tags"] = generate_tags(title, content)

    _save_articles(articles)
    return jsonify({"status": "ok", "total": len(articles)})


@app.route("/api/convert-kb", methods=["POST"])
def api_convert_kb():
    """Konversi semua artikel ke format KB draft untuk AINA."""
    articles = _load_articles()
    if not articles:
        return jsonify({"error": "Belum ada artikel untuk dikonversi."}), 400

    eligible = [a for a in articles if a.get("status") in ("success", "partial")]
    if not eligible:
        return jsonify({"error": "Tidak ada artikel dengan status success/partial."}), 400

    now = _now_iso()
    # Preserve existing status/notes if re-converting
    existing_kb = {a["id"]: a for a in _load_kb() if a.get("id")}

    kb_articles = []
    for a in eligible:
        kb = convert_to_kb_format(a)
        prev = existing_kb.get(kb["id"], {})
        kb["approval_status"] = prev.get("approval_status", "pending")
        kb["last_updated"] = prev.get("last_updated", now)
        kb["notes"] = prev.get("notes", "")
        kb_articles.append(kb)

    _save_kb(kb_articles)
    return jsonify({"status": "ok", "count": len(kb_articles)})


@app.route("/api/kb-draft")
def api_kb_draft():
    """Ambil KB draft yang sudah dibuat."""
    kb = _load_kb()
    return jsonify(kb)


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
    """Generate AI summary (GPT-4o-mini) untuk semua artikel KB dan update KB file."""
    kb_articles = _load_kb()
    if not kb_articles:
        return jsonify({"error": "KB belum dikonversi. Jalankan Convert to KB Draft terlebih dahulu."}), 400

    errors = []
    for art in kb_articles:
        try:
            art["ai_summary"] = generate_ai_summary(
                title=art.get("title") or "",
                content=art.get("content") or "",
            )
            # Update summary field juga jika AI berhasil
            art["summary"] = art["ai_summary"]
        except Exception as e:
            errors.append({"slug": art.get("slug"), "error": str(e)})

    _save_kb(kb_articles)
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


# ─── KB Review Workflow ───────────────────────────────────────────────────────

@app.route("/kb-drafts")
def kb_drafts():
    """Ambil semua KB draft, dengan optional filter ?status=pending|reviewed|approved|rejected|exported."""
    status_filter = request.args.get("status", "").strip().lower()
    kb = _load_kb()
    if status_filter and status_filter != "all":
        kb = [a for a in kb if a.get("approval_status") == status_filter]
    return jsonify(kb)


@app.route("/kb/update-status", methods=["POST"])
def kb_update_status():
    """Update status dan/atau notes satu artikel KB."""
    data = request.get_json(force=True)
    article_id = (data.get("id") or "").strip()
    new_status = (data.get("status") or "").strip()
    notes = data.get("notes")

    if new_status not in VALID_STATUSES:
        return jsonify({"error": f"Status tidak valid: {new_status}. Pilih: {', '.join(VALID_STATUSES)}"}), 400

    kb = _load_kb()
    article = next((a for a in kb if a.get("id") == article_id), None)
    if not article:
        return jsonify({"error": "Artikel tidak ditemukan"}), 404

    article["approval_status"] = new_status
    article["last_updated"] = _now_iso()
    if notes is not None:
        article["notes"] = str(notes)

    _save_kb(kb)

    # Sync ke file approved/exported
    if new_status == "approved":
        _sync_article_to(KB_APPROVED_FILE, article)
    elif new_status == "exported":
        _sync_article_to(KB_EXPORTED_FILE, article)

    return jsonify({"status": "ok", "article": article})


@app.route("/kb/bulk-action", methods=["POST"])
def kb_bulk_action():
    """Ubah status banyak artikel sekaligus."""
    data = request.get_json(force=True)
    ids = data.get("ids", [])
    action = (data.get("action") or "").strip()

    if action not in BULK_ACTION_MAP:
        return jsonify({"error": f"Action tidak valid: {action}. Pilih: {', '.join(BULK_ACTION_MAP)}"}), 400
    if not ids:
        return jsonify({"error": "Tidak ada ID yang dipilih"}), 400

    new_status = BULK_ACTION_MAP[action]
    id_set = set(ids)
    kb = _load_kb()
    now = _now_iso()
    updated = 0

    for a in kb:
        if a.get("id") in id_set:
            a["approval_status"] = new_status
            a["last_updated"] = now
            updated += 1
            if new_status == "approved":
                _sync_article_to(KB_APPROVED_FILE, a)
            elif new_status == "exported":
                _sync_article_to(KB_EXPORTED_FILE, a)

    _save_kb(kb)
    return jsonify({"status": "ok", "updated": updated, "new_status": new_status})


@app.route("/kb/stats")
def kb_stats():
    """Hitung jumlah artikel per status."""
    kb = _load_kb()
    counts: dict[str, int] = {s: 0 for s in VALID_STATUSES}
    counts["total"] = len(kb)
    for a in kb:
        s = a.get("approval_status", "pending")
        if s in counts:
            counts[s] += 1
    return jsonify(counts)


@app.route("/export/kb-approved")
def export_kb_approved():
    items = _load_file(KB_APPROVED_FILE)
    return Response(
        json.dumps(items, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=kb_approved.json"},
    )


@app.route("/export/kb-exported")
def export_kb_exported():
    items = _load_file(KB_EXPORTED_FILE)
    return Response(
        json.dumps(items, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=kb_exported.json"},
    )


@app.route("/export/kb-markdown")
def export_kb_markdown():
    """Export semua KB draft sebagai file .md yang rapi dan mudah dibaca."""
    kb = _load_kb()
    if not kb:
        return jsonify({"error": "Belum ada KB Draft."}), 404

    STATUS_ICON = {
        "pending": "⏳",
        "reviewed": "🔍",
        "approved": "✅",
        "rejected": "❌",
        "exported": "📦",
    }

    today = datetime.now().strftime("%d %B %Y, %H:%M")
    lines: list[str] = []

    # ── Header dokumen ──────────────────────────────────────────────────────
    lines.append("# Knowledge Base — AINA")
    lines.append("")
    lines.append(f"> **Diekspor pada:** {today}  ")
    lines.append(f"> **Total artikel:** {len(kb)}")
    lines.append("")
    lines.append("---")
    lines.append("")

    for i, article in enumerate(kb, 1):
        title = article.get("title") or "Tanpa Judul"
        slug = article.get("slug") or "-"
        source_url = article.get("source_url") or ""
        pub_date = article.get("published_date") or "-"
        summary = (article.get("summary") or "").strip()
        content = (article.get("content") or "").strip()
        tags = article.get("tags") or []
        status = article.get("approval_status") or "pending"
        status_display = f"{STATUS_ICON.get(status, '')} {status}"

        # ── Judul artikel ──────────────────────────────────────────────────
        lines.append(f"## {i}. {title}")
        lines.append("")

        # ── Metadata ───────────────────────────────────────────────────────
        lines.append("| | |")
        lines.append("|:---|:---|")
        lines.append(f"| **Tanggal terbit** | {pub_date} |")
        if source_url:
            lines.append(f"| **Sumber** | [{source_url}]({source_url}) |")
        lines.append(f"| **Slug** | `{slug}` |")
        if tags:
            tag_str = " · ".join(f"`{t}`" for t in tags)
            lines.append(f"| **Tags** | {tag_str} |")
        lines.append(f"| **Status** | {status_display} |")
        lines.append("")

        # ── Ringkasan ──────────────────────────────────────────────────────
        if summary:
            lines.append("### Ringkasan")
            lines.append("")
            lines.append(summary)
            lines.append("")

        # ── Konten Lengkap ─────────────────────────────────────────────────
        if content:
            lines.append("### Konten Lengkap")
            lines.append("")
            # Bagi konten menjadi paragraf berdasarkan newline
            for para in content.split("\n"):
                para = para.strip()
                if para:
                    lines.append(para)
                    lines.append("")

        lines.append("---")
        lines.append("")

    md_output = "\n".join(lines)
    filename = f"kb_aina_{datetime.now().strftime('%Y%m%d_%H%M')}.md"
    return Response(
        md_output,
        mimetype="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── Scheduler API ───────────────────────────────────────────────────────────

@app.route("/api/scheduler/settings", methods=["GET"])
def scheduler_get_settings():
    cfg = _load_scheduler_settings()
    cfg["next_run_at"] = _next_run_iso()
    return jsonify(cfg)


@app.route("/api/scheduler/settings", methods=["POST"])
def scheduler_post_settings():
    data = request.get_json(force=True)
    cfg = _load_scheduler_settings()

    allowed = {"enabled", "interval", "day_of_week", "time_of_day",
               "url", "scrape_mode", "incremental"}
    for k in allowed:
        if k in data:
            cfg[k] = data[k]

    # Validasi interval
    if cfg["interval"] not in ("manual", "daily", "weekly"):
        cfg["interval"] = "manual"
    if cfg["interval"] == "manual":
        cfg["enabled"] = False

    _save_scheduler_settings(cfg)
    _apply_scheduler(cfg)

    cfg["next_run_at"] = _next_run_iso()
    return jsonify({"status": "ok", "settings": cfg})


@app.route("/api/scheduler/status", methods=["GET"])
def scheduler_status():
    cfg = _load_scheduler_settings()
    return jsonify({
        "enabled": cfg.get("enabled", False),
        "interval": cfg.get("interval", "manual"),
        "last_run_at": cfg.get("last_run_at"),
        "last_run_articles_added": cfg.get("last_run_articles_added", 0),
        "last_run_url": cfg.get("last_run_url", ""),
        "last_run_mode": cfg.get("last_run_mode", "full"),
        "next_run_at": _next_run_iso(),
        "scraper_running": scrape_state["running"],
    })


@app.route("/api/scheduler/run-now", methods=["POST"])
def scheduler_run_now():
    """Jalankan scheduled scrape sekarang juga (manual trigger)."""
    with state_lock:
        if scrape_state["running"]:
            return jsonify({"error": "Scraping sedang berjalan"}), 409
    cfg = _load_scheduler_settings()
    if not cfg.get("url", "").strip():
        return jsonify({"error": "URL scheduler belum dikonfigurasi"}), 400
    threading.Thread(target=_run_scheduled_scrape, daemon=True).start()
    return jsonify({"status": "started"})


def _log_startup_info():
    """Log informasi startup dan periksa env variables."""
    logger.info("=" * 60)
    logger.info("AINA News Scraper Backend — Starting Up")
    logger.info("=" * 60)

    if check_openai_available():
        logger.info("[ENV] OPENAI_API_KEY: tersedia ✓")
    else:
        logger.warning("[ENV] OPENAI_API_KEY: TIDAK DITEMUKAN — fitur AI Summary tidak aktif")

    if check_supabase_available():
        logger.info("[ENV] SUPABASE_URL + SUPABASE_KEY: tersedia ✓")
    else:
        logger.warning("[ENV] SUPABASE_URL/SUPABASE_KEY: TIDAK DITEMUKAN — fitur Push Supabase tidak aktif")

    logger.info(f"[ENV] Data dir: {os.path.abspath(DATA_DIR)}")
    logger.info("[STARTUP] Backend siap menerima request.")
    logger.info("=" * 60)


_log_startup_info()


if __name__ == "__main__":
    # use_reloader=False: prevents Werkzeug stat reloader from restarting the process
    # mid-scrape (which would wipe in-memory scrape_state and cause progress log to blank out)
    app.run(host="0.0.0.0", port=8000, debug=True, use_reloader=False)
