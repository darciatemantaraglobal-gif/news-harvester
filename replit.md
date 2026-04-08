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
- `src/pages/MoreSourcesPage.tsx` — Extra sources at `/sources` (YouTube, DOCX, RSS, Telegram)
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

- `OPENAI_API_KEY` — Required for AI summary generation
- `SUPABASE_URL` — Required for Supabase database sync
- `SUPABASE_KEY` — Required for Supabase database sync
- `VITE_API_URL` — Optional; frontend uses relative URLs by default

## Dependencies

### Python
flask, flask-cors, requests, beautifulsoup4, lxml, apscheduler, openai, supabase, gunicorn, youtube-transcript-api, python-docx, feedparser

### Node.js
react, react-dom, react-router-dom, @tanstack/react-query, tailwindcss, shadcn/ui components, vite

## Deployment

- Build: `npm run build`
- Run: `gunicorn --bind=0.0.0.0:8000 --workers=2 --timeout=120 app:app`
- The built frontend should be served statically or via a separate static server
