# News Scraper — AINA KB Pipeline

A React + Vite frontend with a Flask Python backend for scraping Indonesian news articles and converting them into Knowledge Base drafts for AINA.

## Stack

- **Frontend**: React 18, TypeScript, Vite, port 5000
- **Backend**: Flask (Python), port 8000
- **UI**: shadcn/ui, Tailwind CSS, Radix UI primitives
- **Routing**: React Router DOM v6
- **State/Data**: TanStack React Query
- **Proxy**: Vite proxies `/api`, `/export`, `/settings` → Flask :8000

## Key Python Modules

| File | Purpose |
|------|---------|
| `app.py` | Flask server, all API routes |
| `scraper.py` | Dynamic web scraper (selector-configurable, mode-aware) |
| `utils.py` | HTTP helpers (retry, timeout, User-Agent) |
| `content_cleaner.py` | Content cleaning pipeline (whitespace, nav removal, dedup lines) |
| `kb_processor.py` | KB draft helpers: `generate_slug`, `generate_summary`, `generate_tags`, `convert_to_kb_format` |
| `ai_services.py` | GPT-4o-mini AI summary generation |
| `db_services.py` | Supabase push/fetch |

## Data Files

- `data/scraped_articles.json` — raw scraped articles
- `data/kb_articles.json` — KB draft (after conversion)
- `data/settings.json` — scraper selector settings

## API Endpoints

### Scraping
- `POST /api/scrape` — start scraping (params: `url`, `mode`)
- `GET /api/progress` — real-time progress (SSE-like polling)
- `GET /api/articles` — all scraped articles
- `GET /api/article/<id>` — single article

### KB Pipeline
- `POST /api/generate-summary` — rule-based summary for all articles
- `POST /api/auto-tag` — keyword-based auto tagging for all articles
- `POST /api/convert-kb` — convert success/partial articles to KB draft
- `GET /api/kb-draft` — fetch current KB draft
- `POST /api/ai-summary-all` — GPT-4o-mini summary for KB articles

### Settings
- `GET /settings` — get scraper settings
- `POST /settings` — save scraper settings

### Export
- `GET /export/json` — download scraped_articles.json
- `GET /export/csv` — download scraped_articles.csv
- `GET /export/kb` — download kb_articles.json

### Supabase
- `POST /api/push-supabase` — push KB articles to Supabase
- `GET /api/db-articles` — fetch articles from Supabase

## Scraping Modes

- `list` — title, date, URL only (fast)
- `full` — + full content
- `kb` — full + kb_ready flag

## Article Status

- `success` — all fields scraped
- `partial` — some fields missing
- `failed` — could not scrape
- `duplicate` — already exists (skipped)

## Error Reasons

- `timeout`, `blocked`, `request_failed`, `parse_failed`, `selector_not_found`, `empty_content`, `duplicate`, `date_unknown`

## Scheduler

- **Library**: APScheduler `BackgroundScheduler` (started on Flask startup)
- **Config file**: `config/scheduler_settings.json`
- **Intervals**: `manual` (no schedule), `daily` (CronTrigger), `weekly` (CronTrigger + day_of_week)
- **Timezone**: Asia/Jakarta (WIB)
- **Incremental mode**: skip URLs already in `data/scraped_articles.json`; full refresh clears existing data before scraping
- **Logging**: `[SCHEDULED]` vs `[MANUAL]` prefix in scrape logs

### Scheduler API
- `GET /api/scheduler/settings` — full settings + next_run_at
- `POST /api/scheduler/settings` — save and re-apply APScheduler job
- `GET /api/scheduler/status` — live status (last_run, next_run, articles_added)
- `POST /api/scheduler/run-now` — trigger scheduled scrape immediately

## KB Draft Format

```json
{
  "title": "...",
  "slug": "slug-dari-judul",
  "source_url": "https://...",
  "published_date": "...",
  "content": "...",
  "summary": "...",
  "tags": ["berita", "kemlu", "kairo", "mesir"],
  "scrape_status": "success",
  "approval_status": "pending"
}
```

## Auto Tag Keywords

Default tags: `berita, kemlu, kairo, mesir`
Keyword-based additional tags: `paspor, visa, iqomah, pendidikan, beasiswa, mahasiswa, kbri, palestina, bantuan, diplomasi, konsuler, wni, perlindungan, hukum, pernikahan, legalisasi, perpanjangan, pelayanan`

## Workflows

- **Start application**: `npm run dev` — Vite dev server on port 5000
- **Flask Backend**: `python app.py` — Flask on port 8000

## Environment Secrets

- `OPENAI_API_KEY` — for GPT-4o-mini AI summaries
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase anon/service key

## Notes

- Migrated from Lovable: removed `lovable-tagger`, updated Vite config for Replit (host `0.0.0.0`, `allowedHosts: true`)
- Supabase table must be created manually via `supabase_setup.sql`
- Settings persisted to `data/settings.json`
- Content is auto-cleaned via `content_cleaner.py` after scraping
- Deduplication: URL-based + title+date-based, cross-run
