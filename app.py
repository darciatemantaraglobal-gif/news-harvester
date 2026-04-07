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


@app.route("/api/format-text", methods=["POST"])
def api_format_text():
    """Rapikan teks artikel yang di-paste langsung oleh user."""
    from ai_services import get_openai_client, check_openai_available
    if not check_openai_available():
        return jsonify({"error": "OpenAI API key tidak ditemukan. Fitur ini membutuhkan OPENAI_API_KEY."}), 503

    data = request.get_json(force=True) or {}
    title = data.get("title", "").strip()
    content = data.get("content", "").strip()

    if not content:
        return jsonify({"error": "Konten tidak boleh kosong."}), 400

    try:
        client = get_openai_client()
        prompt = (
            "Kamu adalah editor konten berita profesional. Tugasmu adalah mengekstrak dan menyajikan HANYA informasi penting dari teks berikut dalam format Markdown yang rapi dan presisi.\n\n"
            + (f"Judul: {title}\n\n" if title else "")
            + f"Teks asli:\n{content[:6000]}\n\n"
            "INSTRUKSI KETAT:\n\n"
            "**Yang HARUS dibuang (jangan masukkan sama sekali):**\n"
            "- Iklan, promo, ajakan subscribe/follow\n"
            "- Navigasi website, footer, cookie notice, disclaimer boilerplate\n"
            "- Kalimat basa-basi, pembuka/penutup tidak informatif\n"
            "- Informasi duplikat atau pengulangan\n"
            "- Opini yang tidak didukung fakta\n"
            "- Informasi yang tidak relevan dengan topik utama\n\n"
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
            "- Gunakan bahasa yang sama dengan teks asli (jangan terjemahkan)\n\n"
            "PENTING: Tulis HANYA konten Markdown. Jangan tambahkan kata pengantar, penutup, atau komentar apapun."
        )
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2500,
            temperature=0.1,
        )
        formatted = response.choices[0].message.content.strip()
        return jsonify({"status": "ok", "formatted_content": formatted})
    except Exception as e:
        logger.error(f"[FORMAT-TEXT] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/ocr-poster", methods=["POST"])
def api_ocr_poster():
    """OCR gambar poster/foto menggunakan GPT-4o Vision — ekstrak semua teks yang terlihat."""
    from ai_services import get_openai_client, check_openai_available
    import base64
    from PIL import Image as PILImage
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
    try:
        raw = img_file.read()
        # Resize jika terlalu besar (hemat token)
        try:
            img = PILImage.open(io.BytesIO(raw))
            max_side = 1200
            if max(img.size) > max_side:
                ratio = max_side / max(img.size)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size, PILImage.LANCZOS)
            buf = io.BytesIO()
            save_fmt = "PNG" if ext == "png" else "JPEG"
            img.convert("RGB").save(buf, format=save_fmt, quality=85)
            raw = buf.getvalue()
            mime = "image/png" if save_fmt == "PNG" else "image/jpeg"
        except Exception:
            mime = f"image/{ext}" if ext in {"jpg", "jpeg", "png", "webp"} else "image/jpeg"
        b64 = base64.b64encode(raw).decode("utf-8")
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Kamu adalah OCR engine profesional. Tugasmu adalah mengekstrak SEMUA teks yang terlihat di gambar ini dengan akurat.\n\n"
                            "INSTRUKSI:\n"
                            "- Ekstrak semua teks: judul, subjudul, isi, tanggal, nomor, nama, alamat, URL, hashtag, dll.\n"
                            "- Pertahankan struktur dan urutan teks (atas ke bawah, kiri ke kanan)\n"
                            "- Pisahkan blok teks yang berbeda dengan baris kosong\n"
                            "- Jika ada teks dalam bahasa Arab, Latin, atau campuran — ekstrak semuanya\n"
                            "- JANGAN tambahkan penjelasan, komentar, atau teks yang tidak ada di gambar\n"
                            "- JANGAN terjemahkan — salin teks persis seperti yang tertulis\n\n"
                            "Output: HANYA teks yang diekstrak, tidak ada yang lain."
                        )
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"}
                    }
                ]
            }],
            max_tokens=2000,
            temperature=0.05,
        )
        extracted = response.choices[0].message.content.strip()
        return jsonify({"status": "ok", "text": extracted})
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


@app.route("/api/pdf/upload", methods=["POST"])
def api_pdf_upload():
    """
    Upload satu atau lebih PDF, ekstrak teks (+ opsional OCR untuk scan),
    chunk per N halaman, simpan tiap chunk sebagai KB draft terpisah.
    """
    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "Tidak ada file PDF yang diupload."}), 400

    # Form params
    category = request.form.get("category", "").strip()
    chunk_size = max(5, min(100, int(request.form.get("chunk_size", "20"))))
    use_ocr = request.form.get("use_ocr", "false").lower() == "true"
    # Max scan pages to OCR per file — caps cost (default 150, user-configurable)
    max_ocr_pages = max(10, min(500, int(request.form.get("max_ocr_pages", "150"))))
    ocr_available = check_openai_available()
    OCR_BATCH = 4  # Halaman per API call — 4x lebih sedikit calls

    kb = _load_kb()
    now = _now_iso()
    all_results = []

    for file in files:
        fname = file.filename or ""
        if not fname.lower().endswith(".pdf"):
            all_results.append({"filename": fname, "status": "error", "error": "Bukan file PDF"})
            continue

        try:
            pdf_bytes = file.read()

            # ── Phase 1: Extract text per page ──
            # First pass: pdfplumber for text, collect scan page indices
            pages_text = []   # list of (page_num, text, is_scan)
            scan_page_indices = []
            text_pages = 0

            fitz_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            total_pages = len(fitz_doc)

            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                for i, page in enumerate(pdf.pages):
                    raw_text = (page.extract_text() or "").strip()
                    if raw_text and len(raw_text) > 20:
                        pages_text.append((i + 1, raw_text, False))
                        text_pages += 1
                    else:
                        pages_text.append((i + 1, "", True))  # placeholder
                        scan_page_indices.append(i)

            scan_pages = len(scan_page_indices)

            # Second pass: batch OCR for scan pages (if enabled and under cap)
            if use_ocr and ocr_available and scan_page_indices:
                ocr_indices = scan_page_indices[:max_ocr_pages]
                ocr_skipped = len(scan_page_indices) - len(ocr_indices)
                if ocr_skipped > 0:
                    logger.info(f"[PDF OCR] Cap: {ocr_skipped} halaman scan di-skip (limit {max_ocr_pages})")

                # Render scan pages at 1.5x (cheaper/faster than 2x, still readable)
                mat = fitz.Matrix(1.5, 1.5)
                scan_imgs = {}  # page_idx → png bytes
                for i in ocr_indices:
                    pix = fitz_doc[i].get_pixmap(matrix=mat)
                    scan_imgs[i] = pix.tobytes("png")

                # Batch OCR (4 pages per API call)
                idx_list = list(scan_imgs.keys())
                for batch_start in range(0, len(idx_list), OCR_BATCH):
                    batch_idx = idx_list[batch_start:batch_start + OCR_BATCH]
                    batch_imgs = [scan_imgs[j] for j in batch_idx]
                    try:
                        ocr_texts = ocr_arabic_pages_batch(batch_imgs)
                        for j, ocr_text in zip(batch_idx, ocr_texts):
                            # Update the placeholder in pages_text
                            for k, (pnum, _, is_scan) in enumerate(pages_text):
                                if pnum == j + 1 and is_scan:
                                    pages_text[k] = (pnum, ocr_text or "", True)
                                    break
                    except Exception as ocr_err:
                        logger.warning(f"[PDF OCR] Batch error: {ocr_err}")

            fitz_doc.close()

            # ── Phase 2: Build display title from filename ──
            base_title = os.path.splitext(fname)[0].replace("-", " ").replace("_", " ").strip()
            extra_tags = [category] if category else []

            # ── Phase 3: Chunk pages into KB articles ──
            chunks_created = 0
            ts = int(time.time())

            for chunk_idx, start in enumerate(range(0, len(pages_text), chunk_size)):
                chunk_pages = pages_text[start:start + chunk_size]
                page_start = chunk_pages[0][0]
                page_end = chunk_pages[-1][0]

                chunk_text = "\n\n".join(t for _, t, _ in chunk_pages if t).strip()
                if not chunk_text:
                    continue  # skip empty chunks (all-scan with no OCR)

                if total_pages > chunk_size:
                    chunk_title = f"{base_title} — Hal. {page_start}–{page_end}"
                    slug_suffix = f"hal{page_start}-{page_end}-{ts}"
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
                    "notes": f"Sumber: {fname}, Hal. {page_start}-{page_end}",
                    "source_type": "pdf",
                }

                idx = next((j for j, a in enumerate(kb) if a.get("id") == article_id), None)
                if idx is not None:
                    kb[idx] = kb_article
                else:
                    kb.append(kb_article)

                chunks_created += 1

            ocr_pages_done = len(scan_page_indices[:max_ocr_pages]) if (use_ocr and ocr_available) else 0
            all_results.append({
                "filename": fname,
                "status": "ok" if chunks_created > 0 else "error",
                "error": "Tidak ada teks yang bisa diekstrak dari PDF ini." if chunks_created == 0 else None,
                "title": base_title,
                "total_pages": total_pages,
                "text_pages": text_pages,
                "scan_pages": scan_pages,
                "ocr_pages_done": ocr_pages_done,
                "chunks": chunks_created,
            })

        except Exception as e:
            logger.error(f"[PDF] Error processing {fname}: {e}")
            all_results.append({"filename": fname, "status": "error", "error": str(e)[:300]})

    _save_kb(kb)
    ok_count = sum(1 for r in all_results if r.get("status") == "ok")
    total_chunks = sum(r.get("chunks", 0) for r in all_results)
    return jsonify({
        "status": "ok",
        "processed": ok_count,
        "total": len(files),
        "total_chunks": total_chunks,
        "results": all_results,
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
