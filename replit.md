# AINA Scraper

An internal tool to scrape Indonesian news articles (e.g., from government sites like Kemlu/KBRI) and process them into Knowledge Base (KB) drafts for an AI-powered system called AINA.

## Architecture

Full-stack monorepo:
- **Backend**: Python/Flask on port 8000
- **Frontend**: React + TypeScript + Vite on port 5000 (proxies `/api`, `/export`, `/settings`, `/kb*` to backend)

## Key Files

### Backend (Python)
- `app.py` — Main Flask server with all API endpoints
- `scraper.py` — Core web scraping logic
- `ai_services.py` — OpenAI GPT-4o-mini integration for AI summaries
- `db_services.py` — Supabase integration
- `kb_processor.py` — Converts scraped articles to AINA KB format
- `content_cleaner.py` — Removes navigation/footer noise from scraped content
- `data/` — Local JSON storage (scraped_articles.json, kb_articles.json)
- `config/` — Scheduler settings

### Frontend (React/TypeScript)
- `src/pages/HomePage.tsx` — Hub/landing page (Step 1: pick source, Step 2: Review)
- `src/pages/Index.tsx` — Scraper page at `/scraper` (Berita Kemlu/KBRI)
- `src/pages/PdfPage.tsx` — PDF upload page at `/pdf` (Kitab Arab)
- `src/pages/PastePage.tsx` — Paste & AI format at `/paste`
- `src/pages/MoreSourcesPage.tsx` — Extra sources at `/sources` (YouTube, DOCX, RSS, Telegram) with inline "Perbaiki dengan AI" per article
- `src/pages/ReviewDashboard.tsx` — KB Review & approval interface at `/review`
- `src/components/BottomNav.tsx` — Shared bottom nav (Beranda | Review), consistent across all pages
- `src/components/ui/` — shadcn/ui components
- `src/lib/api.ts` — API helper (uses VITE_API_URL env var, falls back to relative URLs)

## Navigation / Routes
- `/` → HomePage (hub: choose source, then Review)
- `/scraper` → Index (news scraper)
- `/pdf` → PdfPage (PDF kitab upload + OCR)
- `/paste` → PastePage (paste + AI format)
- `/sources` → MoreSourcesPage (YouTube, DOCX, RSS, Telegram)
- `/review` → ReviewDashboard (approval workflow + push to Supabase)
- `/article/:id` → ArticleDetail

## Running the Project

Two workflows run in parallel:
- **Flask Backend**: `python app.py` (port 8000)
- **Start application**: `npm run dev` (port 5000, serves frontend + proxies to backend)

## Environment Variables

- `OPENROUTER_API_KEY` — Set. All AI features (summaries, OCR, cleaning, chat) run exclusively through OpenRouter now; direct OpenAI usage has been removed.
- `OPENROUTER_MODEL` — Optional; defaults to `openai/gpt-4o-mini` on OpenRouter.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Required for Supabase database sync (not yet set; feature disabled until provided).
- `VITE_API_URL` — Optional; frontend uses relative URLs by default.

Database stays on Supabase — do not migrate to Replit's built-in database.

AI provider is OpenRouter-only (`ai_services.get_openai_client()` uses the `openai` SDK pointed at OpenRouter's base URL — no OpenAI fallback). All AI call sites in `app.py` use `get_active_model()` instead of hardcoded `gpt-4o`/`gpt-4o-mini` strings. The `openai` pip package stays installed since it's the client library OpenRouter's API is compatible with.

## Setup Notes (Replit import)

- Both workflows are configured and run cleanly: **Start application** (`npm run dev`, port 5000) and **Flask Backend** (`python app.py`, port 8000).
- `vitest` was bumped past `^3.2.4` because that exact version was blocked by Replit's package security firewall (CVE).
- A stray PyPI package literally named `fitz` (unrelated neuroimaging tool) was installed alongside `PyMuPDF`, shadowing PyMuPDF's own `fitz` module and crashing the backend on import. It was removed — only `PyMuPDF` should ever be installed, never a separate `fitz` package.
- To enable AI summaries and Supabase sync, provide `OPENROUTER_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` as secrets; the app runs fine without them, those features just stay inactive.
- Re-imported and re-verified (2026-07-10): reinstalled Python deps from `requirements.txt` and npm deps from `package.json`; both workflows started cleanly. Keep the database on Supabase — do not migrate to Replit's built-in Postgres.
- Re-imported and re-verified again (2026-07-11, session 2): same steps (fresh `pip install -r requirements.txt` + `npm install`), both workflows start cleanly. `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are still not set — AI summaries and Supabase sync stay inactive until the user provides them; everything else works. This is expected: every fresh import wipes `node_modules`/pip packages, so dependency reinstall is required each time.

## Vercel Serverless Migration (2026-07-10)

The app was migrated to run on Vercel serverless functions (in addition to still running on Replit for dev). Key changes:

- `api/index.py` — Vercel Python entry point; re-exports the Flask `app` from `app.py`.
- `vercel.json` — routes `/api/*`, `/settings`, `/export/*`, `/kb*` to the Python function, builds the frontend to `dist/` as static, and defines the `crons` entry for scheduled ingestion.
- **Persistence moved fully to Supabase** — `data/scraped_articles.json` and `data/kb_articles.json` are no longer used; `_load_articles`/`_save_articles`/`_load_kb`/`_save_kb` now read/write the Supabase tables `scraped_articles_draft` and `kb_articles_draft` (DDL in `supabase_vercel_migration.sql`). Local disk is ephemeral on Vercel, so there is intentionally no local fallback — if Supabase env vars are missing, these calls raise a clear error instead of silently doing nothing.
- **Scraping is now synchronous per-request** instead of a background `threading.Thread` (Vercel serverless has no persistent background execution). `POST /api/scrape` runs until it either finishes or hits a `max_new_articles` cap (default 20) for that invocation, returning `status: "done" | "incomplete" | "error"`. Progress is written to the new Supabase table `scrape_jobs` (keyed by `job_id`) so `GET /api/progress?job_id=...` can be polled from a separate invocation. The frontend (`src/pages/Index.tsx`) automatically re-calls `/api/scrape` with the same `job_id` while `status === "incomplete"`.
- **APScheduler removed from the main process** — background schedulers can't survive across serverless invocations. Scheduled ingestion is now triggered externally by Vercel Cron hitting `POST /api/cron/run-ingestion`, guarded by a `CRON_SECRET` env var checked against the `Authorization: Bearer <token>` header. It calls the existing `run_scheduled_news_ingestion()` in `integration/pipeline.py`. The `/api/scheduler/*` settings endpoints still exist purely to store the schedule config for the UI; update `vercel.json`'s `crons.schedule` manually to match.
- **Out of scope / follow-up needed**: four other endpoints still use `threading.Thread` background jobs and were intentionally left untouched — `api_pdf_job`, `api_youtube_scrape`, `api_telegram_scrape`, `api_muqarrar_job`. These will not work correctly on Vercel serverless (no persistent background thread) and need the same synchronous-with-job-table treatment before relying on them in production.
- New env vars needed in the Vercel project settings: `CRON_SECRET` (any random secret string, must match what's sent by Vercel Cron — Vercel injects it automatically as a Bearer token when set), plus the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`.
- Before first deploy, run `supabase_vercel_migration.sql` once in the Supabase SQL editor to create `scraped_articles_draft`, `kb_articles_draft`, and `scrape_jobs`. Both JSON data files were empty at migration time, so no data migration was needed.

## Dependencies

### Python
flask, flask-cors, requests, beautifulsoup4, lxml, apscheduler, openai, supabase, gunicorn, youtube-transcript-api, python-docx, feedparser

### Node.js
react, react-dom, react-router-dom, @tanstack/react-query, tailwindcss, shadcn/ui components, vite

## Deployment

- Build: `npm run build`
- Run: `gunicorn --bind=0.0.0.0:8000 --workers=2 --timeout=120 app:app`
- The built frontend should be served statically or via a separate static server
