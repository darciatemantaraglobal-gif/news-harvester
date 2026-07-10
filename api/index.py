"""
Vercel Python serverless entry point.

Vercel's Python runtime auto-detects a WSGI-compatible `app` object exported
from any file under /api and wraps it for you — no separate handler function
needed (the older `def handler(request)` / BaseHTTPRequestHandler pattern is
deprecated). This file just re-exports the existing Flask app so Vercel can
find it; all real route logic still lives in app.py at the project root.
"""
import os
import sys

# Make the project root importable (app.py, db_services.py, scraper.py, etc.
# live one directory up from /api).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import app  # noqa: E402

# Vercel's Python runtime looks for this module-level `app` name.
