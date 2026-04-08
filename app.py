# app.py — Flask server untuk News Scraper
import os, json, csv, io, threading, re, unicodedata, logging, time
from functools import wraps
import pdfplumber
import fitz  # PyMuPDF
from datetime import datetime, date, timedelta
from flask import Flask, render_template, request, jsonify, Response, g
import hashlib
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

import openai
from scraper import scrape_all, auto_detect_selectors
from kemlu_scraper import is_kemlu_url
from ai_services import generate_ai_summary, check_openai_available, ocr_arabic_page, ocr_arabic_pages_batch
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

# ─── Auth ───────────────────────────────────────────────────────────────────────
_ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
_SESSION_SECRET = os.environ.get("SESSION_SECRET", "")

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def _make_user_token(username: str) -> str:
    return hashlib.sha256(f"{_SESSION_SECRET}:{username}".encode()).hexdigest()

def _load_users() -> list:
    try:
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE) as f:
                return json.load(f)
    except Exception:
        pass
    return []

def _save_users(users: list) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)

def _get_valid_tokens() -> dict:
    tokens = {_SESSION_SECRET: (_ADMIN_USERNAME, True)}
    for user in _load_users():
        tok = _make_user_token(user["username"])
        tokens[tok] = (user["username"], False)
    return tokens

_PUBLIC_ENDPOINTS = {"login", "static"}

@app.before_request
def _check_auth():
    if request.method == "OPTIONS":
        return
    if request.endpoint in _PUBLIC_ENDPOINTS:
        return
    if not _SESSION_SECRET:
        return jsonify({"error": "Auth not configured. Set SESSION_SECRET env var."}), 500
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    valid = _get_valid_tokens()
    if token not in valid:
        return jsonify({"error": "Unauthorized"}), 401
    g.current_user, g.is_admin = valid[token]
    _update_last_seen(g.current_user)

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not _ADMIN_PASSWORD:
        return jsonify({"error": "Auth not configured. Set ADMIN_PASSWORD secret."}), 500
    if username == _ADMIN_USERNAME and password == _ADMIN_PASSWORD:
        _record_login(username)
        return jsonify({"token": _SESSION_SECRET, "is_admin": True, "username": username})
    users = _load_users()
    pw_hash = _hash_password(password)
    for user in users:
        if user["username"] == username and user["password_hash"] == pw_hash:
            _record_login(username)
            return jsonify({"token": _make_user_token(username), "is_admin": False, "username": username})
    return jsonify({"error": "Username atau password salah."}), 401

@app.route("/api/users", methods=["GET"])
def list_users():
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden"}), 403
    return jsonify([{"username": u["username"]} for u in _load_users()])

@app.route("/api/users", methods=["POST"])
def add_user():
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip().lower()
    password = data.get("password", "").strip()
    if not username or not password:
        return jsonify({"error": "Username dan password wajib diisi."}), 400
    if username == _ADMIN_USERNAME.lower():
        return jsonify({"error": "Username sudah digunakan."}), 400
    users = _load_users()
    if any(u["username"].lower() == username for u in users):
        return jsonify({"error": "Username sudah ada."}), 400
    users.append({"username": username, "password_hash": _hash_password(password)})
    _save_users(users)
    return jsonify({"ok": True, "username": username})

@app.route("/api/users/<username>", methods=["DELETE"])
def delete_user(username):
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden"}), 403
    users = _load_users()
    new_users = [u for u in users if u["username"] != username]
    if len(new_users) == len(users):
        return jsonify({"error": "User tidak ditemukan."}), 404
    _save_users(new_users)
    return jsonify({"ok": True})


@app.route("/api/users/<username>/reset-password", methods=["POST"])
def reset_user_password(username):
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json(silent=True) or {}
    new_password = (data.get("password") or "").strip()
    if not new_password:
        return jsonify({"error": "Password baru wajib diisi."}), 400
    users = _load_users()
    target = next((u for u in users if u["username"] == username), None)
    if not target:
        return jsonify({"error": "User tidak ditemukan."}), 404
    target["password_hash"] = _hash_password(new_password)
    _save_users(users)
    return jsonify({"ok": True})


@app.route("/api/users/activity", methods=["GET"])
def get_users_activity():
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden"}), 403
    from datetime import datetime, timezone
    import time as _time

    _load_activity()
    users_list = _load_users()

    push_log = []
    if os.path.exists(PUSH_LOG_FILE):
        try:
            with open(PUSH_LOG_FILE, "r", encoding="utf-8") as f:
                push_log = json.load(f)
        except Exception:
            push_log = []

    push_by_user: dict = {}
    for entry in push_log:
        u = entry.get("username", "unknown")
        if u not in push_by_user:
            push_by_user[u] = {"count": 0, "total_articles": 0, "last_push": None, "last_source": None}
        push_by_user[u]["count"] += 1
        push_by_user[u]["total_articles"] += entry.get("count", 0)
        ts = entry.get("timestamp")
        if ts and (push_by_user[u]["last_push"] is None or ts > push_by_user[u]["last_push"]):
            push_by_user[u]["last_push"] = ts
            push_by_user[u]["last_source"] = entry.get("source")

    def _online_status(last_seen: str | None) -> str:
        if not last_seen:
            return "offline"
        try:
            dt = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            diff = (_time.time() - dt.timestamp())
            if diff < 300:
                return "online"
            if diff < 1800:
                return "away"
            return "offline"
        except Exception:
            return "offline"

    result = []

    admin_act = _activity_cache.get(_ADMIN_USERNAME, {})
    admin_push = push_by_user.get(_ADMIN_USERNAME, {})
    result.append({
        "username": _ADMIN_USERNAME,
        "is_admin": True,
        "last_login": admin_act.get("last_login"),
        "last_seen": admin_act.get("last_seen"),
        "status": _online_status(admin_act.get("last_seen")),
        "push_count": admin_push.get("count", 0),
        "push_articles": admin_push.get("total_articles", 0),
        "last_push": admin_push.get("last_push"),
        "last_source": admin_push.get("last_source"),
    })

    for u in users_list:
        uname = u["username"]
        act = _activity_cache.get(uname, {})
        push = push_by_user.get(uname, {})
        result.append({
            "username": uname,
            "is_admin": False,
            "last_login": act.get("last_login"),
            "last_seen": act.get("last_seen"),
            "status": _online_status(act.get("last_seen")),
            "push_count": push.get("count", 0),
            "push_articles": push.get("total_articles", 0),
            "last_push": push.get("last_push"),
            "last_source": push.get("last_source"),
        })

    return jsonify(result)


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
USERS_FILE = os.path.join(DATA_DIR, "users.json")
USER_ACTIVITY_FILE = os.path.join(DATA_DIR, "user_activity.json")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)

def _ensure_data_files():
    """Pastikan semua file data wajib ada — buat dengan nilai default jika belum ada."""
    defaults = {
        DATA_FILE: [],
        SETTINGS_FILE: {},
        LAST_JOB_FILE: {},
        USERS_FILE: [],
        USER_ACTIVITY_FILE: {},
    }
    for path, default in defaults.items():
        if not os.path.exists(path):
            try:
                with open(path, "w") as f:
                    json.dump(default, f)
                logger.info(f"[INIT] Buat file baru: {path}")
            except Exception as e:
                logger.warning(f"[INIT] Gagal buat {path}: {e}")

_ensure_data_files()

_activity_cache: dict = {}
_activity_dirty: dict = {}

def _load_activity() -> dict:
    global _activity_cache
    try:
        if os.path.exists(USER_ACTIVITY_FILE):
            with open(USER_ACTIVITY_FILE, "r", encoding="utf-8") as f:
                _activity_cache = json.load(f)
    except Exception:
        _activity_cache = {}
    return _activity_cache

def _save_activity() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(USER_ACTIVITY_FILE, "w", encoding="utf-8") as f:
        json.dump(_activity_cache, f, indent=2)

def _update_last_seen(username: str) -> None:
    import time as _time
    now_ts = _time.time()
    prev = _activity_dirty.get(username, 0)
    if now_ts - prev < 30:
        return
    _activity_dirty[username] = now_ts
    if not _activity_cache:
        _load_activity()
    if username not in _activity_cache:
        _activity_cache[username] = {}
    _activity_cache[username]["last_seen"] = _now_iso()
    _save_activity()

def _record_login(username: str) -> None:
    if not _activity_cache:
        _load_activity()
    if username not in _activity_cache:
        _activity_cache[username] = {}
    _activity_cache[username]["last_login"] = _now_iso()
    _save_activity()

_load_activity()

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
    "cancelled": False,   # set by reset-all to abort in-flight scrape saves
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
        scrape_state["cancelled"] = False   # clear any previous cancellation
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
                # If reset was called while we were scraping, discard this write
                if scrape_state.get("cancelled"):
                    return
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

        # Final save — skip if reset was called mid-scrape
        with state_lock:
            was_cancelled = scrape_state.get("cancelled", False)
        if not was_cancelled:
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


@app.route("/api/article/<article_id>/format", methods=["POST"])
def api_format_article(article_id):
    """Rapikan konten artikel menggunakan AI."""
    from ai_services import get_openai_client, check_openai_available
    if not check_openai_available():
        return jsonify({"error": "OpenAI API key tidak ditemukan. Fitur ini membutuhkan OPENAI_API_KEY."}), 503

    articles = _load_articles()
    article = next((a for a in articles if a["id"] == article_id), None)
    if not article:
        return jsonify({"error": "Artikel tidak ditemukan"}), 404

    data = request.get_json(force=True) or {}
    save = data.get("save", False)

    title = article.get("title", "")
    content = article.get("content", "")
    if not content:
        return jsonify({"error": "Artikel tidak memiliki konten."}), 400

    try:
        client = get_openai_client()
        prompt = (
            "Kamu adalah editor konten berita profesional. Tugasmu adalah mengekstrak dan menyajikan HANYA informasi penting dari artikel berikut dalam format Markdown yang rapi dan presisi.\n\n"
            f"Judul artikel: {title}\n\n"
            f"Konten asli:\n{content[:6000]}\n\n"
            "INSTRUKSI KETAT:\n\n"
            "**Yang HARUS dibuang (jangan masukkan sama sekali):**\n"
            "- Iklan, promo, ajakan subscribe/follow\n"
            "- Navigasi website, footer, cookie notice, disclaimer boilerplate\n"
            "- Kalimat basa-basi, pembuka/penutup tidak informatif\n"
            "- Informasi duplikat atau pengulangan\n"
            "- Opini wartawan yang tidak didukung fakta\n"
            "- Informasi yang tidak relevan dengan topik utama artikel\n\n"
            "**Yang HARUS dipertahankan:**\n"
            "- Fakta utama: apa, siapa, kapan, di mana, mengapa, bagaimana\n"
            "- Angka, statistik, tanggal, nama resmi\n"
            "- Kutipan langsung yang penting\n"
            "- Konteks dan latar belakang yang relevan\n\n"
            "**Format output (Markdown):**\n"
            "- Gunakan `##` untuk sub-topik jika ada lebih dari satu topik\n"
            "- Gunakan bullet points (`-`) untuk daftar fakta atau poin-poin\n"
            "- Gunakan **bold** untuk nama, jabatan, angka, atau istilah kunci\n"
            "- Gunakan paragraf prose untuk narasi yang mengalir\n"
            "- Pisahkan bagian dengan satu baris kosong\n"
            "- Gunakan bahasa yang sama dengan artikel asli (jangan terjemahkan)\n\n"
            "PENTING: Tulis HANYA konten Markdown. Jangan tambahkan kata pengantar, penutup, atau komentar apapun dari kamu."
        )
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2500,
            temperature=0.1,
        )
        formatted = response.choices[0].message.content.strip()

        if save:
            for a in articles:
                if a["id"] == article_id:
                    a["content"] = formatted
                    a["formatted_by_ai"] = True
                    break
            _save_articles(articles)

        return jsonify({"status": "ok", "formatted_content": formatted})
    except Exception as e:
        logger.error(f"[FORMAT] Error: {e}")
        return jsonify({"error": str(e)}), 500


def _detect_arabic_ratio(text: str) -> float:
    """Hitung persentase karakter Arab dalam teks."""
    if not text:
        return 0.0
    arab_count = sum(1 for c in text if '\u0600' <= c <= '\u06FF' or '\u0750' <= c <= '\u077F' or '\uFB50' <= c <= '\uFDFF' or '\uFE70' <= c <= '\uFEFF')
    letter_count = sum(1 for c in text if c.isalpha())
    return arab_count / max(letter_count, 1)

_ARABIC_RECONSTRUCTION_SYSTEM = (
    "Kamu adalah ahli rekonstruksi teks Arab dari hasil OCR dan spesialis bahasa Arab klasik/modern.\n\n"
    "KONTEKS PENTING:\n"
    "Teks yang diberikan adalah hasil OCR dari kitab/dokumen berbahasa Arab. OCR sering menghasilkan:\n"
    "- Huruf Arab yang tercerai-berai (misal: 'ا ل ح م د' → seharusnya 'الحمد')\n"
    "- Spasi yang salah posisi di tengah kata\n"
    "- Karakter aneh atau simbol pengganti huruf yang tidak terbaca\n"
    "- Urutan kata yang terbalik atau baris yang tertukar\n"
    "- Harakat/syakal yang terpisah dari huruf aslinya\n\n"
    "TUGAS UTAMAMU:\n"
    "1. REKONSTRUKSI setiap kata Arab ke bentuk yang benar — sambungkan huruf-huruf yang tercerai\n"
    "2. PERBAIKI spasi yang salah di dalam kata (spasi hanya antar kata, bukan di tengah kata)\n"
    "3. PERTAHANKAN semua harakat/syakal (ـَ ـِ ـُ ـّ dll) jika ada, letakkan di posisi benar\n"
    "4. PERTAHANKAN semua konten — jangan tambah atau hapus makna\n"
    "5. PERTAHANKAN bahasa asli — jangan terjemahkan ke Indonesia\n"
    "6. Untuk teks campuran Arab-Indonesia: rekonstruksi Arab, pertahankan Indonesia apa adanya\n\n"
    "STANDAR KUALITAS OUTPUT:\n"
    "- Kata Arab harus terbaca seperti kitab yang dicetak normal\n"
    "- Gunakan Unicode Arab yang benar (bukan karakter terpisah)\n"
    "- Jangan gunakan harakat jika tidak ada di teks asli\n"
)

_FORMAT_SYSTEM = {
    "berita": (
        "Setelah rekonstruksi Arab selesai, sajikan hasilnya sebagai konten berita yang rapi.\n"
        "- Ekstrak fakta penting: apa, siapa, kapan, di mana, mengapa\n"
        "- Gunakan `##` untuk sub-topik, `-` untuk fakta, **bold** untuk nama/angka kunci\n"
        "- Pertahankan semua teks Arab yang sudah direkonstruksi\n"
        "Output: HANYA Markdown. Tanpa pengantar atau komentar."
    ),
    "kitab": (
        "Setelah rekonstruksi Arab selesai, strukturkan sebagai teks kitab.\n"
        "- Gunakan `##` untuk Bab/Fasal/Pasal jika terdeteksi\n"
        "- Letakkan teks Arab dalam blok tersendiri, syarah/terjemahan sesudahnya\n"
        "- Pertahankan nomor-nomor poin/masalah/fasal\n"
        "Output: HANYA teks kitab terstruktur dalam Markdown. Tanpa komentar."
    ),
    "laporan": (
        "Setelah rekonstruksi Arab selesai, susun sebagai laporan formal.\n"
        "- Mulai dengan **Ringkasan Eksekutif**\n"
        "- Gunakan `##` untuk: Latar Belakang, Temuan Utama, Analisis, Rekomendasi\n"
        "- Pertahankan data, angka, nama resmi, teks Arab penting\n"
        "Output: HANYA konten laporan Markdown. Tanpa pengantar."
    ),
    "ringkasan": (
        "Setelah rekonstruksi Arab selesai, buat ringkasan singkat.\n"
        "- Maksimal 5 poin terpenting dalam bullet list `-`\n"
        "- Sertakan teks Arab kunci jika relevan\n"
        "Output: HANYA ringkasan Markdown. Tanpa kata pengantar."
    ),
    "poin": (
        "Setelah rekonstruksi Arab selesai, ubah menjadi daftar poin informatif.\n"
        "- Setiap fakta/hukum/masalah = 1 bullet point `-`\n"
        "- **bold** di awal setiap poin untuk kata kunci\n"
        "- Pertahankan istilah Arab yang penting\n"
        "Output: HANYA daftar poin Markdown. Tanpa narasi pembuka."
    ),
    "briefing": (
        "Setelah rekonstruksi Arab selesai, buat briefing ringkas.\n"
        "- **SITUASI**: 1-2 kalimat gambaran keseluruhan\n"
        "- **FAKTA KUNCI**: bullet list fakta terverifikasi\n"
        "- **AKTOR**: siapa yang terlibat\n"
        "- **IMPLIKASI**: apa yang perlu diperhatikan\n"
        "Output: HANYA konten briefing Markdown. Tanpa pengantar."
    ),
}

FORMAT_PROMPTS = {
    "berita": lambda title, content: (
        "Kamu adalah editor konten berita profesional. Ekstrak dan sajikan HANYA informasi penting dalam format Markdown yang rapi.\n\n"
        + (f"Judul: {title}\n\n" if title else "")
        + f"Teks asli:\n{content}\n\n"
        "INSTRUKSI:\n"
        "- Buang: iklan, promo, navigasi, disclaimer, basa-basi, duplikasi, opini tidak berdasar fakta\n"
        "- Pertahankan: fakta (apa/siapa/kapan/di mana/mengapa/bagaimana), angka, tanggal, nama resmi, kutipan penting\n"
        "- Format: `##` untuk sub-topik, `-` untuk daftar fakta, **bold** untuk nama/jabatan/angka kunci, paragraf prose untuk narasi\n"
        "- Gunakan bahasa yang sama dengan teks asli\n"
        "Output: HANYA Markdown. Tanpa pengantar atau komentar."
    ),
    "kitab": lambda title, content: (
        "Kamu adalah editor teks kitab Arab/Indonesia profesional. Rapikan dan strukturkan teks berikut.\n\n"
        + (f"Judul/Kitab: {title}\n\n" if title else "")
        + f"Teks asli:\n{content}\n\n"
        "INSTRUKSI:\n"
        "- Perbaiki kesalahan OCR: karakter aneh, spasi salah, baris terputus\n"
        "- Pertahankan SEMUA konten asli — jangan hapus atau tambah informasi\n"
        "- Strukturkan dengan `##` untuk Bab/Fasal/Pasal jika terdeteksi\n"
        "- Teks Arab: pertahankan, pastikan urutan RTL, gunakan blok terpisah\n"
        "- Terjemahan/syarah: letakkan setelah teks Arab yang relevan\n"
        "- Rapikan paragraf dan spasi, pertahankan bahasa asli\n"
        "Output: HANYA teks yang sudah diperbaiki dalam Markdown. Tanpa komentar."
    ),
    "laporan": lambda title, content: (
        "Kamu adalah analis laporan resmi. Susun ulang teks berikut menjadi laporan terstruktur dan formal.\n\n"
        + (f"Judul: {title}\n\n" if title else "")
        + f"Konten:\n{content}\n\n"
        "INSTRUKSI:\n"
        "- Mulai dengan **Ringkasan Eksekutif** (2-3 kalimat inti)\n"
        "- Gunakan `##` untuk: Latar Belakang, Temuan/Fakta Utama, Analisis, Rekomendasi (jika ada)\n"
        "- Pertahankan semua data, angka, nama resmi, tanggal\n"
        "- Bahasa: formal dan objektif\n"
        "- Gunakan **bold** untuk istilah kunci dan poin penting\n"
        "Output: HANYA konten laporan Markdown. Tanpa pengantar atau penutup dari kamu."
    ),
    "ringkasan": lambda title, content: (
        "Buat ringkasan SANGAT SINGKAT dan padat dari teks berikut.\n\n"
        + (f"Judul: {title}\n\n" if title else "")
        + f"Teks:\n{content}\n\n"
        "INSTRUKSI:\n"
        "- Maksimal 5 poin paling penting\n"
        "- Setiap poin: 1-2 kalimat, langsung ke inti\n"
        "- Sertakan angka/tanggal/nama kunci yang krusial\n"
        "- Format: bullet list `-` yang ringkas\n"
        "- Di bagian atas, satu kalimat konteks (tanpa header)\n"
        "Output: HANYA teks ringkasan. Tanpa kata pengantar."
    ),
    "poin": lambda title, content: (
        "Ubah teks berikut menjadi daftar poin-poin informatif yang mudah dibaca.\n\n"
        + (f"Topik: {title}\n\n" if title else "")
        + f"Teks:\n{content}\n\n"
        "INSTRUKSI:\n"
        "- Setiap fakta/informasi penting = 1 bullet point `-`\n"
        "- Poin harus mandiri dan informatif (tidak menggantung)\n"
        "- Gunakan **bold** di awal setiap poin untuk kata kunci\n"
        "- Kelompokkan dengan `##` jika ada kategori yang berbeda\n"
        "- Buang semua teks yang tidak informatif (basa-basi, iklan, dll)\n"
        "Output: HANYA daftar poin Markdown. Tanpa narasi pembuka."
    ),
    "briefing": lambda title, content: (
        "Kamu adalah analis intelijen. Buat briefing ringkas dari teks berikut.\n\n"
        + (f"Subjek: {title}\n\n" if title else "")
        + f"Sumber:\n{content}\n\n"
        "INSTRUKSI — format briefing diplomatik/intelijen:\n"
        "- **SITUASI**: 1-2 kalimat gambaran keseluruhan\n"
        "- **FAKTA KUNCI**: bullet list fakta terverifikasi (angka, nama, tanggal)\n"
        "- **AKTOR**: siapa saja yang terlibat dan perannya\n"
        "- **IMPLIKASI**: apa artinya / apa yang perlu diperhatikan (jika ada dalam teks)\n"
        "- Bahasa: singkat, presisi, faktual — tidak ada opini tambahan\n"
        "Output: HANYA konten briefing Markdown. Tanpa pengantar."
    ),
}

@app.route("/api/format-text", methods=["POST"])
def api_format_text():
    """Rapikan teks artikel. Auto-deteksi Arab untuk rekonstruksi OCR yang kuat."""
    from ai_services import get_openai_client, check_openai_available
    if not check_openai_available():
        return jsonify({"error": "OpenAI API key tidak ditemukan. Fitur ini membutuhkan OPENAI_API_KEY."}), 503

    data = request.get_json(force=True) or {}
    title = data.get("title", "").strip()
    content = data.get("content", "").strip()
    fmt = data.get("format", "berita").strip().lower()

    if not content:
        return jsonify({"error": "Konten tidak boleh kosong."}), 400
    if fmt not in FORMAT_PROMPTS:
        fmt = "berita"

    arabic_ratio = _detect_arabic_ratio(content)
    is_arabic = arabic_ratio >= 0.25   # ≥25% karakter Arab → mode Arab aktif

    try:
        client = get_openai_client()

        if is_arabic:
            # ── Mode Arab: system message khusus rekonstruksi OCR Arab ──────────
            format_instruction = _FORMAT_SYSTEM.get(fmt, _FORMAT_SYSTEM["berita"])
            user_prompt = (
                f"{format_instruction}\n\n"
                + (f"Judul/Kitab: {title}\n\n" if title else "")
                + f"=== TEKS OCR YANG PERLU DIREKONSTRUKSI ===\n{content[:7000]}\n"
                + "=== AKHIR TEKS ==="
            )
            messages = [
                {"role": "system", "content": _ARABIC_RECONSTRUCTION_SYSTEM},
                {"role": "user", "content": user_prompt},
            ]
            model = "gpt-4o"   # GPT-4o lebih akurat untuk Arab daripada gpt-4o-mini
            logger.info(f"[FORMAT-TEXT] Arab mode (ratio={arabic_ratio:.2f}), fmt={fmt}")
        else:
            # ── Mode biasa: prompt lama ──────────────────────────────────────────
            prompt = FORMAT_PROMPTS[fmt](title, content[:7000])
            messages = [{"role": "user", "content": prompt}]
            model = "gpt-4o-mini"
            logger.info(f"[FORMAT-TEXT] Non-Arab mode, fmt={fmt}")

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=3500,
            temperature=0.1,
        )
        formatted = response.choices[0].message.content.strip()
        return jsonify({
            "status": "ok",
            "formatted_content": formatted,
            "format_used": fmt,
            "arabic_mode": is_arabic,
            "arabic_ratio": round(arabic_ratio, 2),
        })
    except Exception as e:
        logger.error(f"[FORMAT-TEXT] Error: {e}")
        return jsonify({"error": str(e)}), 500


OCR_TYPE_PROMPTS = {
    "auto": (
        "Kamu adalah OCR engine profesional multi-bahasa. Ekstrak SEMUA teks yang terlihat di gambar ini dengan akurasi tinggi.\n\n"
        "INSTRUKSI:\n"
        "- Deteksi otomatis tipe konten (poster, dokumen, kitab Arab, screenshot, dll.)\n"
        "- Ekstrak semua teks: judul, isi, tanggal, angka, nama, URL, hashtag, teks kecil\n"
        "- Pertahankan struktur & urutan (atas→bawah, kiri→kanan; untuk Arab: kanan→kiri)\n"
        "- Teks Arab: ekstrak dengan urutan RTL yang benar, pisahkan dari teks Latin\n"
        "- Pisahkan blok teks berbeda dengan satu baris kosong\n"
        "- JANGAN terjemahkan, JANGAN tambah komentar atau teks yang tidak ada di gambar\n"
        "Output: HANYA teks yang diekstrak."
    ),
    "poster": (
        "Kamu adalah OCR engine untuk poster dan flyer. Ekstrak semua teks dari gambar poster ini.\n\n"
        "INSTRUKSI:\n"
        "- Ekstrak SEMUA teks: headline besar, subtitle, body text, tanggal/waktu, lokasi, nama, nomor, URL, hashtag, teks kecil di footer\n"
        "- Urutkan dari elemen terbesar/terpenting ke terkecil\n"
        "- Pertahankan hirarki visual: judul besar → sub → detail\n"
        "- Pisahkan setiap blok elemen dengan baris kosong\n"
        "- JANGAN terjemahkan atau tambahkan teks yang tidak ada\n"
        "Output: HANYA teks dari poster, terstruktur."
    ),
    "dokumen": (
        "Kamu adalah OCR engine presisi untuk dokumen resmi. Ekstrak teks dari dokumen ini dengan akurasi maksimum.\n\n"
        "INSTRUKSI:\n"
        "- Pertahankan struktur dokumen: header, paragraf, tabel (format sebagai teks), footer\n"
        "- Ekstrak semua teks termasuk nomor dokumen, tanggal, tanda tangan tertulis, cap/stempel\n"
        "- Pertahankan indentasi dan hierarki paragraf\n"
        "- Angka dan kode penting (Nomor Surat, NIK, dll): pastikan akurasi 100%\n"
        "- Tabel: format sebagai baris dengan pemisah ` | `\n"
        "- JANGAN tambahkan interpretasi atau penjelasan\n"
        "Output: HANYA teks dokumen yang akurat."
    ),
    "kitab": (
        "Kamu adalah OCR engine spesialis teks kitab Arab dan Arab-Melayu (pegon). Ekstrak teks dari halaman kitab ini.\n\n"
        "INSTRUKSI KRITIS:\n"
        "- Teks Arab: ekstrak dengan urutan kata RTL yang BENAR, jaga harakat/tanda baca Arab\n"
        "- Teks Pegon/Arab-Melayu: ekstrak sebagaimana tertulis\n"
        "- Terjemahan/catatan Latin: ekstrak terpisah di bawah teks Arab terkait\n"
        "- Nomor halaman, nomor hadis/ayat, judul bab: sertakan semuanya\n"
        "- Pisahkan setiap paragraf/potongan teks dengan baris kosong\n"
        "- Perbaiki karakter yang terpotong/rusak berdasarkan konteks Arab\n"
        "- JANGAN terjemahkan, JANGAN tambahkan teks yang tidak ada di halaman\n"
        "Output: HANYA teks kitab yang diekstrak, Arab dan non-Arab dipertahankan."
    ),
    "screenshot": (
        "Kamu adalah OCR engine untuk screenshot digital. Ekstrak semua teks dari screenshot ini.\n\n"
        "INSTRUKSI:\n"
        "- Ekstrak semua teks: pesan, postingan, komentar, nama pengguna, timestamp, tombol, label\n"
        "- Pertahankan konteks percakapan: siapa menulis apa\n"
        "- Format: [Nama]: teks untuk percakapan/chat\n"
        "- Sertakan metadata yang terlihat: tanggal, like/share count, dll.\n"
        "- JANGAN tambahkan interpretasi atau teks yang tidak ada\n"
        "Output: HANYA teks dari screenshot, terstruktur."
    ),
}

@app.route("/api/ocr-poster", methods=["POST"])
def api_ocr_poster():
    """OCR gambar menggunakan GPT-4o Vision — multi-tipe, akurasi tinggi."""
    from ai_services import get_openai_client, check_openai_available
    import base64
    from PIL import Image as PILImage, ImageEnhance, ImageFilter
    if not check_openai_available():
        return jsonify({"error": "OpenAI API key tidak ditemukan. Fitur OCR membutuhkan OPENAI_API_KEY."}), 503
    if "image" not in request.files:
        return jsonify({"error": "Tidak ada file gambar yang dikirim."}), 400
    img_file = request.files["image"]
    if not img_file.filename:
        return jsonify({"error": "Nama file kosong."}), 400
    allowed = {"jpg", "jpeg", "png", "webp", "bmp", "gif"}
    ext = img_file.filename.rsplit(".", 1)[-1].lower() if "." in img_file.filename else ""
    if ext not in allowed:
        return jsonify({"error": f"Format file tidak didukung: .{ext}. Gunakan JPG, PNG, atau WEBP."}), 400

    ocr_type = (request.form.get("ocr_type") or "auto").strip().lower()
    if ocr_type not in OCR_TYPE_PROMPTS:
        ocr_type = "auto"

    try:
        raw = img_file.read()
        try:
            img = PILImage.open(io.BytesIO(raw)).convert("RGB")
            max_side = 1600
            if max(img.size) > max_side:
                ratio = max_side / max(img.size)
                img = img.resize((int(img.width * ratio), int(img.height * ratio)), PILImage.LANCZOS)
            if ocr_type in ("dokumen", "kitab"):
                img = ImageEnhance.Contrast(img).enhance(1.4)
                img = ImageEnhance.Sharpness(img).enhance(1.6)
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            raw = buf.getvalue()
            mime = "image/png"
        except Exception:
            mime = "image/jpeg"
        b64 = base64.b64encode(raw).decode("utf-8")
        client = get_openai_client()
        ocr_prompt = OCR_TYPE_PROMPTS[ocr_type]
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": ocr_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"}},
                ]
            }],
            max_tokens=3000,
            temperature=0.05,
        )
        extracted = response.choices[0].message.content.strip()
        return jsonify({"status": "ok", "text": extracted, "ocr_type": ocr_type})
    except Exception as e:
        logger.error(f"[OCR-POSTER] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/push-paste", methods=["POST"])
def api_push_paste():
    """Push artikel hasil Paste & Rapikan langsung ke Supabase knowledge_base."""
    from db_services import push_kb_articles
    from kb_processor import KEYWORD_TAG_MAP, DEFAULT_TAGS
    data = request.get_json(force=True) or {}
    title = data.get("title", "").strip()
    content = data.get("content", "").strip()
    if not content:
        return jsonify({"error": "Konten tidak boleh kosong."}), 400
    if not title:
        title = "Artikel dari Paste"
    # Auto-tag dari title + content
    combined = (title + " " + content).lower()
    tags = list(DEFAULT_TAGS)
    for keyword, tag in KEYWORD_TAG_MAP.items():
        if keyword in combined and tag not in tags:
            tags.append(tag)
    article = {"title": title, "content": content, "tags": tags, "summary": ""}
    try:
        result = push_kb_articles([article])
        if result.get("inserted", 0) > 0:
            _record_push(username=g.current_user, source="paste", count=result["inserted"], titles=[title])
        return jsonify({
            "status": "ok",
            "inserted": result["inserted"],
            "skipped": result.get("skipped", 0),
            "errors": result.get("errors", []),
        })
    except Exception as e:
        logger.error(f"[PUSH-PASTE] Error: {e}")
        return jsonify({"error": str(e)}), 500


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
    # Count existing items for the response
    article_count = len(_load_articles())
    kb_count = len(_load_kb())

    # Step 1: cancel any in-flight scrape BEFORE clearing files, so the
    # background thread won't overwrite the empty files when it finishes
    with state_lock:
        scrape_state["cancelled"] = True

    # Step 2: brief pause so any _save_articles call already inside the lock
    # can finish, then our write wins cleanly
    time.sleep(0.15)

    # Step 3: now safe to clear files
    _save_articles([])
    _save_kb([])

    # Hapus file KB approved/exported jika ada
    for f in [KB_APPROVED_FILE, KB_EXPORTED_FILE]:
        try:
            if os.path.exists(f):
                os.remove(f)
        except Exception:
            pass

    # Reset progress/log and lift the cancellation flag
    with state_lock:
        scrape_state.update({
            "running": False,
            "cancelled": False,
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


@app.route("/api/ingestion-history")
def api_ingestion_history():
    history_file = os.path.join(DATA_DIR, "ingestion_history.json")
    try:
        if os.path.exists(history_file):
            with open(history_file, "r", encoding="utf-8") as f:
                runs = json.load(f)
        else:
            runs = []
    except Exception:
        runs = []
    return jsonify({"runs": list(reversed(runs)), "total": len(runs)})


KB_FILE = os.path.join(DATA_DIR, "kb_articles.json")
KB_APPROVED_FILE = os.path.join(DATA_DIR, "kb_approved.json")
KB_EXPORTED_FILE = os.path.join(DATA_DIR, "kb_exported.json")
PUSH_LOG_FILE = os.path.join(DATA_DIR, "push_log.json")


def _record_push(username: str, source: str, count: int, titles: list):
    """Catat aktivitas push ke Supabase ke push_log.json."""
    try:
        log = []
        if os.path.exists(PUSH_LOG_FILE):
            with open(PUSH_LOG_FILE, "r", encoding="utf-8") as f:
                log = json.load(f)
        log.append({
            "id": f"push-{int(time.time()*1000)}",
            "timestamp": _now_iso(),
            "username": username,
            "source": source,
            "count": count,
            "titles": titles[:10],
        })
        with open(PUSH_LOG_FILE, "w", encoding="utf-8") as f:
            json.dump(log, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"[PUSH-LOG] Gagal mencatat push log: {e}")

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
    """Konversi semua artikel ke format KB draft untuk AINA.
    
    Body opsional:
      { "cutoff_days": 30 }          → hanya artikel <= 30 hari terakhir
      { "cutoff_date": "2026-01-01" } → hanya artikel >= tanggal ini
    Artikel tanpa tanggal selalu disertakan kecuali ada parameter "skip_undated": true.
    """
    data = request.get_json(force=True, silent=True) or {}
    articles = _load_articles()
    if not articles:
        return jsonify({"error": "Belum ada artikel untuk dikonversi."}), 400

    eligible = [a for a in articles if a.get("status") in ("success", "partial")]
    if not eligible:
        return jsonify({"error": "Tidak ada artikel dengan status success/partial."}), 400

    # ── Terapkan filter tanggal jika ada ──────────────────────────────────────
    cutoff: date | None = None
    if data.get("cutoff_days"):
        try:
            cutoff = date.today() - timedelta(days=int(data["cutoff_days"]))
        except (ValueError, TypeError):
            pass
    elif data.get("cutoff_date"):
        cutoff = _parse_date_param(data["cutoff_date"])

    skip_undated = bool(data.get("skip_undated", False))
    skipped = 0

    if cutoff:
        filtered = []
        for a in eligible:
            art_date = _parse_date_param(a.get("date"))
            if art_date is None:
                if skip_undated:
                    skipped += 1
                    continue
                filtered.append(a)  # tanpa tanggal → ikut sertakan
            elif art_date >= cutoff:
                filtered.append(a)
            else:
                skipped += 1
        eligible = filtered

    if not eligible:
        return jsonify({"error": "Tidak ada artikel yang memenuhi filter tanggal."}), 400

    now = _now_iso()
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
    return jsonify({"status": "ok", "count": len(kb_articles), "skipped": skipped})


@app.route("/api/kb-draft")
def api_kb_draft():
    """Ambil KB draft yang sudah dibuat."""
    kb = _load_kb()
    return jsonify(kb)


@app.route("/api/push-supabase", methods=["POST"])
def api_push_supabase():
    """Push KB articles ke AINA's Supabase knowledge_base table dengan status='pending'."""
    if not os.path.exists(KB_FILE):
        return jsonify({"error": "KB belum dikonversi. Jalankan Convert to KB Draft terlebih dahulu."}), 400
    with open(KB_FILE, "r", encoding="utf-8") as f:
        kb_articles = json.load(f)
    if not kb_articles:
        return jsonify({"error": "KB kosong."}), 400
    try:
        result = push_kb_articles(kb_articles)
        if result.get("inserted", 0) > 0:
            _record_push(
                username=g.current_user,
                source="review-all",
                count=result["inserted"],
                titles=[a.get("title", "") for a in kb_articles[:10]],
            )
        return jsonify({
            "status": "ok",
            "inserted": result["inserted"],
            "skipped": result.get("skipped", 0),
            "errors": result.get("errors", []),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/push-approved", methods=["POST"])
def api_push_approved():
    """Push hanya artikel yang sudah approved ke Supabase, lalu tandai sebagai exported."""
    if not os.path.exists(KB_APPROVED_FILE):
        return jsonify({"error": "Belum ada artikel yang diapprove."}), 400
    with open(KB_APPROVED_FILE, "r", encoding="utf-8") as f:
        approved = json.load(f)
    if not approved:
        return jsonify({"error": "Tidak ada artikel approved untuk di-push."}), 400
    try:
        result = push_kb_articles(approved)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Mark successfully-pushed articles as exported in the main KB file
    if result.get("inserted", 0) > 0:
        _record_push(
            username=g.current_user,
            source="review-approved",
            count=result["inserted"],
            titles=[a.get("title", "") for a in approved[:10]],
        )
        pushed_ids = {a["id"] for a in approved}
        kb = _load_kb()
        now = _now_iso()
        for a in kb:
            if a.get("id") in pushed_ids and a.get("approval_status") == "approved":
                a["approval_status"] = "exported"
                a["last_updated"] = now
                _sync_article_to(KB_EXPORTED_FILE, a)
        _save_kb(kb)
        # Clear approved file — those articles are now exported
        remaining = [a for a in approved if a.get("id") not in pushed_ids]
        with open(KB_APPROVED_FILE, "w", encoding="utf-8") as f:
            json.dump(remaining, f, ensure_ascii=False, indent=2)

    return jsonify({
        "status": "ok",
        "inserted": result["inserted"],
        "skipped": result.get("skipped", 0),
        "errors": result.get("errors", []),
    })


@app.route("/api/push-log", methods=["GET"])
def api_push_log():
    """Laporan history push ke Supabase. Hanya admin."""
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden — hanya admin"}), 403
    log = []
    if os.path.exists(PUSH_LOG_FILE):
        with open(PUSH_LOG_FILE, "r", encoding="utf-8") as f:
            log = json.load(f)
    return jsonify({"log": list(reversed(log)), "total": len(log)})


@app.route("/api/push-log/clear", methods=["POST"])
def api_push_log_clear():
    """Hapus seluruh push log. Hanya admin."""
    if not g.get("is_admin", False):
        return jsonify({"error": "Forbidden — hanya admin"}), 403
    with open(PUSH_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump([], f)
    return jsonify({"ok": True})


_ARAB_HEADINGS = re.compile(
    r'^\s*(بسم الله|بِسْمِ|باب|بَابٌ|بَاب|فصل|فَصْلٌ|كتاب|كِتَابٌ|مقدمة|مُقَدِّمَة|خاتمة|تمهيد|قاعدة|مسألة|الفصل|الباب|الكتاب|المقدمة|الخاتمة)',
    re.UNICODE | re.MULTILINE
)
_LATIN_HEADINGS = re.compile(
    r'^\s*(BAB|Bab|CHAPTER|Chapter|PASAL|Pasal|FASAL|Fasal|PENDAHULUAN|Pendahuluan|PENUTUP|Penutup|MUKADIMAH|Mukadimah|PROLOG|EPILOG)\b',
    re.MULTILINE
)

@app.route("/api/pdf/inspect", methods=["POST"])
def api_pdf_inspect():
    """
    Inspeksi PDF: baca metadata, judul, dan daftar halaman dengan deteksi bab/fasal/heading.
    Kembalikan ringkasan detail sebelum ekstraksi dimulai.
    """
    if "file" not in request.files:
        return jsonify({"error": "Tidak ada file yang dikirim."}), 400
    pdf_file = request.files["file"]
    if not pdf_file.filename or not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "File harus berformat PDF."}), 400

    try:
        pdf_bytes = pdf_file.read()

        # ── Buka dengan PyMuPDF untuk metadata ──
        fitz_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(fitz_doc)
        meta = fitz_doc.metadata or {}
        pdf_title = (meta.get("title") or "").strip()
        pdf_author = (meta.get("author") or "").strip()
        pdf_subject = (meta.get("subject") or "").strip()
        fitz_doc.close()

        # ── Buka dengan pdfplumber untuk analisis per halaman ──
        pages_info = []
        chapters = []   # list of {page_num, heading, heading_type}
        text_count = 0
        scan_count = 0

        MAX_INSPECT_PAGES = 800  # cap agar tidak OOM

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            inspect_pages = min(total_pages, MAX_INSPECT_PAGES)
            for i in range(inspect_pages):
                page = pdf.pages[i]
                raw = (page.extract_text() or "").strip()
                page_num = i + 1
                is_scan = not raw or len(raw) < 15

                if is_scan:
                    scan_count += 1
                    pages_info.append({
                        "page": page_num,
                        "type": "scan",
                        "heading": None,
                        "preview": "[Halaman gambar/scan — perlu OCR]",
                        "words": 0,
                    })
                    continue

                text_count += 1
                word_count = len(raw.split())
                first_line = raw.split('\n')[0][:120].strip()

                # Deteksi heading Arabic atau Latin
                heading = None
                heading_type = None
                arab_match = _ARAB_HEADINGS.search(raw[:300])
                latin_match = _LATIN_HEADINGS.search(raw[:300])
                if arab_match:
                    # Ambil baris pertama yang mengandung heading Arab
                    for ln in raw.split('\n')[:5]:
                        if _ARAB_HEADINGS.search(ln):
                            heading = ln.strip()[:120]
                            break
                    heading_type = "arab"
                elif latin_match:
                    for ln in raw.split('\n')[:5]:
                        if _LATIN_HEADINGS.search(ln):
                            heading = ln.strip()[:120]
                            break
                    heading_type = "latin"

                if heading:
                    chapters.append({"page": page_num, "heading": heading, "type": heading_type})

                pages_info.append({
                    "page": page_num,
                    "type": "text",
                    "heading": heading,
                    "heading_type": heading_type,
                    "preview": first_line,
                    "words": word_count,
                })

        # Halaman yang tidak di-inspect (> MAX_INSPECT_PAGES) dianggap scan
        if total_pages > MAX_INSPECT_PAGES:
            for i in range(MAX_INSPECT_PAGES, total_pages):
                pages_info.append({
                    "page": i + 1,
                    "type": "unknown",
                    "heading": None,
                    "preview": "[Tidak di-inspeksi — di luar batas preview]",
                    "words": 0,
                })

        # Nama file sebagai fallback judul
        base_name = os.path.splitext(pdf_file.filename)[0].replace("-", " ").replace("_", " ").strip()

        return jsonify({
            "ok": True,
            "filename": pdf_file.filename,
            "title": pdf_title or base_name,
            "author": pdf_author,
            "subject": pdf_subject,
            "total_pages": total_pages,
            "text_pages": text_count,
            "scan_pages": scan_count,
            "chapters": chapters,
            "pages": pages_info,
        })

    except Exception as e:
        logger.error(f"[PDF INSPECT] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/pdf/learn", methods=["POST"])
def api_pdf_learn():
    """
    Analisis isi PDF dengan AI: ringkasan keseluruhan + deskripsi tiap bab/fasal.
    Menggunakan GPT-4o untuk membaca sampel teks dan menjelaskan pembahasannya.
    """
    if "file" not in request.files:
        return jsonify({"error": "Tidak ada file yang dikirim."}), 400
    pdf_file = request.files["file"]
    if not pdf_file.filename or not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "File harus berformat PDF."}), 400
    if not check_openai_available():
        return jsonify({"error": "OPENAI_API_KEY tidak tersedia — fitur analisis AI tidak aktif."}), 503

    try:
        pdf_bytes = pdf_file.read()
        base_name = os.path.splitext(pdf_file.filename)[0].replace("-", " ").replace("_", " ").strip()

        # ── Ekstrak teks per halaman (hingga 300 hal, hemat memori) ──
        pages_text_raw = []   # list of (page_num, text)
        chapters_detected = []

        fitz_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(fitz_doc)
        meta = fitz_doc.metadata or {}
        pdf_title = (meta.get("title") or "").strip() or base_name
        fitz_doc.close()

        MAX_PAGES = min(total_pages, 300)

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for i in range(MAX_PAGES):
                page = pdf.pages[i]
                raw = (page.extract_text() or "").strip()
                if raw and len(raw) > 15:
                    pages_text_raw.append((i + 1, raw))
                    # Deteksi chapter headings
                    arab_m = _ARAB_HEADINGS.search(raw[:400])
                    latin_m = _LATIN_HEADINGS.search(raw[:400])
                    heading = None
                    if arab_m:
                        for ln in raw.split('\n')[:6]:
                            if _ARAB_HEADINGS.search(ln):
                                heading = ln.strip()[:150]
                                break
                    elif latin_m:
                        for ln in raw.split('\n')[:6]:
                            if _LATIN_HEADINGS.search(ln):
                                heading = ln.strip()[:150]
                                break
                    if heading:
                        chapters_detected.append({"page": i + 1, "heading": heading, "text_sample": raw[:600]})

        text_pages = len(pages_text_raw)
        scan_pages = MAX_PAGES - text_pages

        if text_pages == 0:
            return jsonify({
                "ok": True,
                "title": pdf_title,
                "total_pages": total_pages,
                "text_pages": 0,
                "scan_pages": scan_pages,
                "ai_available": False,
                "overview": "PDF ini tampaknya berisi halaman scan/gambar semua — tidak ada teks digital yang bisa dianalisis. Aktifkan OCR untuk mengekstrak teksnya terlebih dahulu.",
                "chapters": [],
                "topics": [],
            })

        # ── Siapkan sampel teks untuk AI ──
        # Ambil: 5 hal pertama + 5 hal terakhir + tiap chapter + max 15 hal acak
        sample_pages = set()
        for i in range(min(5, len(pages_text_raw))):
            sample_pages.add(i)
        for i in range(max(0, len(pages_text_raw) - 5), len(pages_text_raw)):
            sample_pages.add(i)
        # Tiap chapter
        ch_indices = {ch["page"] - 1 for ch in chapters_detected if ch["page"] - 1 < len(pages_text_raw)}
        sample_pages.update(ch_indices)
        # Tambah sampel merata
        step = max(1, len(pages_text_raw) // 15)
        for i in range(0, len(pages_text_raw), step):
            sample_pages.add(i)

        sampled = sorted(sample_pages)[:35]
        sample_text_parts = []
        for idx in sampled:
            pnum, ptxt = pages_text_raw[idx]
            snippet = ptxt[:500].strip()
            sample_text_parts.append(f"[Halaman {pnum}]\n{snippet}")
        sample_text = "\n\n---\n\n".join(sample_text_parts)

        # ── Siapkan daftar bab untuk AI ──
        chapters_for_prompt = "\n".join(
            f"- Halaman {ch['page']}: {ch['heading']}"
            for ch in chapters_detected[:30]
        ) or "(tidak terdeteksi otomatis)"

        # ── Bangun prompt AI ──
        prompt = f"""Kamu adalah asisten analisis kitab/buku berbahasa Arab dan Indonesia.

Berikut adalah metadata dan sampel teks dari PDF berjudul "{pdf_title}":
- Total halaman: {total_pages} (teks digital: {text_pages}, scan: {scan_pages})
- Bab/fasal terdeteksi otomatis:
{chapters_for_prompt}

=== SAMPEL TEKS PDF ===
{sample_text[:6000]}
=== AKHIR SAMPEL ===

Berdasarkan informasi di atas, buatlah analisis dalam format JSON berikut (jawab HANYA JSON, tanpa markdown):
{{
  "judul": "judul/nama kitab yang sebenarnya (dari teks)",
  "penulis": "nama penulis jika ditemukan, kosong jika tidak",
  "bahasa": "Arab / Indonesia / Campuran",
  "bidang": "bidang ilmu (misal: Fiqh, Aqidah, Tafsir, Hadits, dsb)",
  "overview": "ringkasan 2-3 kalimat tentang isi dan tujuan kitab ini",
  "bab": [
    {{
      "nomor": 1,
      "judul": "judul bab/fasal (teks asli jika Arab)",
      "halaman": 1,
      "pembahasan": "1-2 kalimat tentang apa yang dibahas di bab ini"
    }}
  ],
  "topik_utama": ["topik1", "topik2", "topik3"]
}}

Jika bab tidak terdeteksi otomatis, identifikasi dari konten teks. Maksimal 20 bab."""

        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.3,
        )
        raw_json = response.choices[0].message.content.strip()

        # Bersihkan jika ada markdown fence
        if raw_json.startswith("```"):
            raw_json = re.sub(r"^```[a-z]*\n?", "", raw_json)
            raw_json = re.sub(r"\n?```$", "", raw_json)

        ai_result = json.loads(raw_json)

        return jsonify({
            "ok": True,
            "title": ai_result.get("judul") or pdf_title,
            "author": ai_result.get("penulis", ""),
            "language": ai_result.get("bahasa", ""),
            "field": ai_result.get("bidang", ""),
            "total_pages": total_pages,
            "text_pages": text_pages,
            "scan_pages": scan_pages,
            "ai_available": True,
            "overview": ai_result.get("overview", ""),
            "chapters": ai_result.get("bab", []),
            "topics": ai_result.get("topik_utama", []),
        })

    except json.JSONDecodeError as je:
        logger.error(f"[PDF LEARN] JSON parse error: {je}")
        return jsonify({"error": "AI mengembalikan format tidak valid. Coba lagi."}), 500
    except Exception as e:
        logger.error(f"[PDF LEARN] Error: {e}")
        return jsonify({"error": str(e)}), 500


def _safe_pdf_slug(filename: str, suffix: str = "") -> str:
    """Buat slug aman dari nama file PDF (bisa non-ASCII/Arab)."""
    base = os.path.splitext(filename)[0]
    # Try ASCII slug first
    slug = generate_slug(base)
    if not slug:
        # Fallback: hex of filename + suffix
        slug = re.sub(r"[^a-z0-9]", "-", base.lower())[:30].strip("-") or "kitab"
    if suffix:
        slug = f"{slug}-{suffix}"
    return slug[:80]


# ── PDF Job store (in-memory, background processing) ──────────────────────────
import threading as _threading
import uuid as _uuid

_pdf_jobs: dict = {}           # job_id → job dict
_pdf_jobs_lock = _threading.Lock()


def _pdf_job_worker(job_id: str, files_data: list, category: str, chunk_size: int,
                    use_ocr: bool, max_ocr_pages: int, page_start_g: int, page_end_g: int):
    """Background thread: process PDF files and store results in _pdf_jobs."""
    OCR_BATCH = 4
    ocr_available = check_openai_available()
    all_results = []
    total_files = len(files_data)

    def _set_progress(msg: str, done_files: int = 0):
        with _pdf_jobs_lock:
            _pdf_jobs[job_id]["progress"] = msg
            _pdf_jobs[job_id]["done_files"] = done_files

    # Jika OCR diminta tapi API key tidak tersedia, langsung beri tahu
    if use_ocr and not ocr_available:
        with _pdf_jobs_lock:
            _pdf_jobs[job_id].update({
                "status": "done",
                "progress": "OCR tidak bisa dijalankan — OPENAI_API_KEY belum diset.",
                "done_files": 0,
                "results": {
                    "status": "ok",
                    "processed": 0,
                    "total": total_files,
                    "total_chunks": 0,
                    "results": [{"filename": f, "status": "error",
                                 "error": "OPENAI_API_KEY tidak ditemukan. Set secret OPENAI_API_KEY di environment untuk menggunakan OCR."}
                                for f, _ in files_data],
                },
            })
        logger.warning(f"[PDF JOB] {job_id} dibatalkan — OPENAI_API_KEY tidak ada")
        return

    _set_progress(f"Memulai pemrosesan {total_files} file...")

    try:
        for fi, (fname, pdf_bytes) in enumerate(files_data):
            _set_progress(f"[{fi+1}/{total_files}] Membaca {fname}...", fi)
            try:
                pages_text = []
                scan_page_indices = []
                text_pages = 0

                fitz_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                total_pages = len(fitz_doc)
                p_start_idx = max(0, page_start_g - 1)
                p_end_idx = min(total_pages - 1, page_end_g - 1) if page_end_g > 0 else total_pages - 1

                with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                    for i, page in enumerate(pdf.pages):
                        if i < p_start_idx or i > p_end_idx:
                            continue
                        raw_text = (page.extract_text() or "").strip()
                        if raw_text and len(raw_text) > 20:
                            pages_text.append((i + 1, raw_text, False))
                            text_pages += 1
                        else:
                            pages_text.append((i + 1, "", True))
                            scan_page_indices.append(i)

                scan_pages = len(scan_page_indices)

                if use_ocr and ocr_available and scan_page_indices:
                    ocr_indices = scan_page_indices[:max_ocr_pages]
                    ocr_skipped = len(scan_page_indices) - len(ocr_indices)
                    total_batches = (len(ocr_indices) + OCR_BATCH - 1) // OCR_BATCH

                    if ocr_skipped > 0:
                        logger.info(f"[PDF OCR] Cap: {ocr_skipped} hal. skip (limit {max_ocr_pages})")

                    mat = fitz.Matrix(1.5, 1.5)
                    scan_imgs = {}
                    for i in ocr_indices:
                        pix = fitz_doc[i].get_pixmap(matrix=mat)
                        scan_imgs[i] = pix.tobytes("png")

                    idx_list = list(scan_imgs.keys())
                    for bn, batch_start_idx in enumerate(range(0, len(idx_list), OCR_BATCH)):
                        batch_end_idx = min(batch_start_idx + OCR_BATCH - 1, len(idx_list) - 1)
                        _set_progress(
                            f"[{fi+1}/{total_files}] OCR {fname}: batch {bn+1}/{total_batches} "
                            f"(hal. {idx_list[batch_start_idx]+1}–{idx_list[batch_end_idx]+1})",
                            fi,
                        )
                        batch_idx = idx_list[batch_start_idx:batch_start_idx + OCR_BATCH]
                        batch_imgs = [scan_imgs[j] for j in batch_idx]
                        try:
                            ocr_texts = ocr_arabic_pages_batch(batch_imgs)
                            for j, ocr_text in zip(batch_idx, ocr_texts):
                                for k, (pnum, _, is_scan) in enumerate(pages_text):
                                    if pnum == j + 1 and is_scan:
                                        pages_text[k] = (pnum, ocr_text or "", True)
                                        break
                        except Exception as ocr_err:
                            logger.warning(f"[PDF OCR] Batch error: {ocr_err}")

                fitz_doc.close()

                _set_progress(f"[{fi+1}/{total_files}] Menyimpan chunk KB untuk {fname}...", fi)
                base_title = os.path.splitext(fname)[0].replace("-", " ").replace("_", " ").strip()
                extra_tags = [category] if category else []
                chunks_created = 0
                ts = int(time.time())
                now = _now_iso()
                kb = _load_kb()

                for _ci, start in enumerate(range(0, len(pages_text), chunk_size)):
                    chunk_pages = pages_text[start:start + chunk_size]
                    pg_start = chunk_pages[0][0]
                    pg_end = chunk_pages[-1][0]
                    chunk_text = "\n\n".join(t for _, t, _ in chunk_pages if t).strip()
                    if not chunk_text:
                        continue

                    if total_pages > chunk_size:
                        chunk_title = f"{base_title} — Hal. {pg_start}–{pg_end}"
                        slug_suffix = f"hal{pg_start}-{pg_end}-{ts}"
                    else:
                        chunk_title = base_title
                        slug_suffix = str(ts)

                    slug = _safe_pdf_slug(fname, slug_suffix)
                    tags = list(set(extra_tags + generate_tags(chunk_title, chunk_text[:600])))
                    summary = generate_summary(chunk_title, chunk_text)
                    article_id = f"pdf-{slug}"

                    kb_article = {
                        "id": article_id,
                        "title": chunk_title,
                        "slug": slug,
                        "source_url": f"pdf://{fname}",
                        "published_date": now[:10],
                        "content": chunk_text,
                        "summary": summary,
                        "tags": tags,
                        "scrape_status": "success",
                        "approval_status": "pending",
                        "last_updated": now,
                        "notes": f"Sumber: {fname}, Hal. {pg_start}-{pg_end}",
                        "source_type": "pdf",
                    }

                    idx = next((j for j, a in enumerate(kb) if a.get("id") == article_id), None)
                    if idx is not None:
                        kb[idx] = kb_article
                    else:
                        kb.append(kb_article)
                    chunks_created += 1

                _save_kb(kb)

                ocr_pages_done = len(scan_page_indices[:max_ocr_pages]) if (use_ocr and ocr_available) else 0
                all_results.append({
                    "filename": fname,
                    "status": "ok" if chunks_created > 0 else "error",
                    "error": "Tidak ada teks yang bisa diekstrak." if chunks_created == 0 else None,
                    "title": base_title,
                    "total_pages": total_pages,
                    "text_pages": text_pages,
                    "scan_pages": scan_pages,
                    "ocr_pages_done": ocr_pages_done,
                    "chunks": chunks_created,
                })

            except Exception as e:
                logger.error(f"[PDF JOB] Error on {fname}: {e}", exc_info=True)
                all_results.append({"filename": fname, "status": "error", "error": str(e)[:300]})

    except Exception as outer_e:
        logger.error(f"[PDF JOB] Outer error: {outer_e}", exc_info=True)
        all_results.append({"filename": "—", "status": "error", "error": f"Error tak terduga: {str(outer_e)[:200]}"})

    finally:
        ok_count = sum(1 for r in all_results if r.get("status") == "ok")
        total_chunks = sum(r.get("chunks", 0) for r in all_results)

        with _pdf_jobs_lock:
            _pdf_jobs[job_id].update({
                "status": "done",
                "progress": f"Selesai — {ok_count}/{total_files} file berhasil, {total_chunks} chunk disimpan.",
                "done_files": total_files,
                "results": {
                    "status": "ok",
                    "processed": ok_count,
                    "total": total_files,
                    "total_chunks": total_chunks,
                    "results": all_results,
                },
            })
        logger.info(f"[PDF JOB] {job_id} selesai — {ok_count}/{total_files} ok, {total_chunks} chunks")


@app.route("/api/pdf/upload", methods=["POST"])
def api_pdf_upload():
    """
    Upload satu atau lebih PDF — langsung kembalikan job_id, proses di background.
    Polling status via GET /api/pdf/job/<job_id>
    """
    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "Tidak ada file PDF yang diupload."}), 400

    category = request.form.get("category", "").strip()
    chunk_size = max(5, min(100, int(request.form.get("chunk_size", "20"))))
    use_ocr = request.form.get("use_ocr", "false").lower() == "true"
    max_ocr_pages = max(10, min(500, int(request.form.get("max_ocr_pages", "150"))))
    page_start_g = max(1, int(request.form.get("page_start", "1") or "1"))
    page_end_raw = request.form.get("page_end", "0") or "0"
    page_end_g = int(page_end_raw) if page_end_raw.isdigit() and int(page_end_raw) > 0 else 0

    # Baca bytes semua file sebelum keluar dari request context
    files_data = []
    for f in files:
        fname = f.filename or ""
        if not fname.lower().endswith(".pdf"):
            continue
        files_data.append((fname, f.read()))

    if not files_data:
        return jsonify({"error": "Tidak ada file PDF yang valid."}), 400

    job_id = str(_uuid.uuid4())
    with _pdf_jobs_lock:
        _pdf_jobs[job_id] = {
            "status": "processing",
            "progress": "Menginisialisasi...",
            "done_files": 0,
            "total_files": len(files_data),
            "results": None,
            "created_at": time.time(),
        }

    t = _threading.Thread(
        target=_pdf_job_worker,
        args=(job_id, files_data, category, chunk_size, use_ocr, max_ocr_pages, page_start_g, page_end_g),
        daemon=True,
    )
    t.start()
    logger.info(f"[PDF JOB] Mulai job {job_id} — {len(files_data)} file, OCR={use_ocr}")

    return jsonify({"job_id": job_id, "status": "processing", "total_files": len(files_data)})


@app.route("/api/pdf/job/<job_id>", methods=["GET"])
def api_pdf_job_status(job_id: str):
    """Poll status job upload PDF."""
    with _pdf_jobs_lock:
        job = _pdf_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job tidak ditemukan."}), 404
    # Cleanup job lama (lebih dari 1 jam)
    if time.time() - job.get("created_at", 0) > 3600:
        with _pdf_jobs_lock:
            _pdf_jobs.pop(job_id, None)
        return jsonify({"error": "Job expired."}), 404
    return jsonify({
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress", ""),
        "done_files": job.get("done_files", 0),
        "total_files": job.get("total_files", 1),
        "results": job.get("results"),   # None saat masih proses
    })


@app.route("/api/pdf/rapikan-file", methods=["POST"])
def api_pdf_rapikan_file():
    """Perbaiki semua chunk KB dari satu file PDF dengan AI (bersihkan teks OCR, format ulang)."""
    from ai_services import get_openai_client, check_openai_available
    if not check_openai_available():
        return jsonify({"error": "OpenAI API key tidak ditemukan."}), 503
    data = request.get_json(force=True) or {}
    filename = data.get("filename", "").strip()
    if not filename:
        return jsonify({"error": "Nama file diperlukan."}), 400
    kb = _load_kb()
    target = [a for a in kb if a.get("source_url", "").startswith(f"pdf://{filename}")]
    if not target:
        return jsonify({"error": f"Tidak ada KB chunk ditemukan untuk file: {filename}"}), 404
    client = get_openai_client()
    updated = 0
    for article in target:
        raw_content = (article.get("content") or "").strip()
        if not raw_content:
            continue
        try:
            prompt = (
                "Kamu adalah editor teks Arab/Indonesia profesional. Perbaiki dan rapikan teks berikut yang merupakan hasil ekstraksi dari PDF kitab.\n\n"
                "INSTRUKSI:\n"
                "- Perbaiki kesalahan OCR: karakter aneh, spasi yang salah, baris terputus\n"
                "- Pertahankan semua konten asli — JANGAN hapus atau tambah informasi\n"
                "- Rapikan struktur paragraf dan spasi\n"
                "- Pertahankan bahasa asli (Arab, Indonesia, atau campuran)\n"
                "- Jika ada teks Arab: pastikan urutan kata Arab tetap RTL\n"
                "- Output: HANYA teks yang sudah diperbaiki, tanpa komentar apapun\n\n"
                f"Teks:\n{raw_content[:4000]}"
            )
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2000,
                temperature=0.05,
            )
            fixed = resp.choices[0].message.content.strip()
            if fixed:
                article["content"] = fixed
                article["last_updated"] = _now_iso()
                updated += 1
        except Exception as e:
            logger.warning(f"[PDF-RAPIKAN] Gagal chunk {article.get('id')}: {e}")
    if updated > 0:
        _save_kb(kb)
    return jsonify({"status": "ok", "updated": updated, "total": len(target)})


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
    """Update status, notes, content, dan/atau summary satu artikel KB."""
    data = request.get_json(force=True)
    article_id = (data.get("id") or "").strip()
    new_status = (data.get("status") or "").strip()
    notes = data.get("notes")
    new_content = data.get("content")
    new_summary = data.get("summary")

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
    if new_content is not None:
        article["content"] = str(new_content)
    if new_summary is not None:
        article["summary"] = str(new_summary)

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
        logger.info("[ENV] SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: tersedia ✓")
    else:
        logger.warning("[ENV] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: TIDAK DITEMUKAN — fitur Push Supabase tidak aktif")

    logger.info(f"[ENV] Data dir: {os.path.abspath(DATA_DIR)}")
    logger.info("[STARTUP] Backend siap menerima request.")
    logger.info("=" * 60)


_log_startup_info()


if __name__ == "__main__":
    # use_reloader=False: prevents Werkzeug stat reloader from restarting the process
    # mid-scrape (which would wipe in-memory scrape_state and cause progress log to blank out)
    app.run(host="0.0.0.0", port=8000, debug=True, use_reloader=False)
