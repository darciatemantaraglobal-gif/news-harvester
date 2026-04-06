#!/usr/bin/env python3
# run_ingestion.py
#
# AINA Scraper — Phase 5: Standalone Knowledge Ingestion Runner
#
# Usage:
#   python run_ingestion.py               # starts background scheduler (keeps alive)
#   python run_ingestion.py --once        # runs pipeline once, then exits
#   python run_ingestion.py --once --url https://kemlu.go.id/cairo/en
#   python run_ingestion.py --history     # prints last 10 run summaries, then exits
#
# ENV variables:
#   ENABLE_SCHEDULED_INGESTION=true       required for scheduler mode (no --once)
#   SCHEDULE_INTERVAL_MINUTES=360         interval in minutes (default 6 hours)
#   INGESTION_SCRAPE_URL=https://...      fallback scrape URL

import argparse
import json
import logging
import os
import signal
import sys
import time

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _print_summary(summary: dict) -> None:
    sep = "=" * 55
    print(sep)
    print(f"  Status      : {summary.get('status','?').upper()}")
    print(f"  URL         : {summary.get('url','')}")
    print(f"  Started     : {summary.get('started_at','')}")
    print(f"  Finished    : {summary.get('finished_at','')}")
    print(f"  Duration    : {summary.get('duration_sec', 0)}s")
    print(f"  Scraped     : {summary.get('scraped_count', 0)}")
    print(f"  Inserted    : {summary.get('inserted', 0)}")
    print(f"  Updated     : {summary.get('updated', 0)}")
    print(f"  Skipped     : {summary.get('skipped', 0)}")
    print(f"  Rejected    : {summary.get('rejected', 0)}")
    print(f"  Chunks      : {summary.get('chunk_count', 0)}")
    if summary.get("error_message"):
        print(f"  Error       : {summary['error_message']}")
    print(sep)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AINA Knowledge Ingestion Pipeline Runner"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run pipeline once and exit (do not start scheduler)",
    )
    parser.add_argument(
        "--url",
        default="",
        help="URL to scrape (overrides ENV and scheduler config)",
    )
    parser.add_argument(
        "--mode",
        default="full",
        choices=["full", "list", "kb"],
        help="Scrape mode (default: full)",
    )
    parser.add_argument(
        "--no-incremental",
        dest="incremental",
        action="store_false",
        help="Disable incremental mode (re-scrape all articles)",
    )
    parser.add_argument(
        "--history",
        action="store_true",
        help="Print last 10 run summaries from ingestion_history.json and exit",
    )
    args = parser.parse_args()

    # ── --history mode ────────────────────────────────────────────────────────
    if args.history:
        from integration.pipeline import get_run_history
        runs = get_run_history(limit=10)
        if not runs:
            print("No ingestion history found (data/ingestion_history.json is empty).")
            sys.exit(0)
        print(f"\nLast {len(runs)} ingestion run(s):\n")
        for i, r in enumerate(reversed(runs), 1):
            print(f"[Run {i}]")
            _print_summary(r)
        sys.exit(0)

    # ── --once mode ───────────────────────────────────────────────────────────
    if args.once:
        logger.info("[Runner] --once mode: running pipeline once then exiting")
        from integration.pipeline import run_scheduled_news_ingestion
        summary = run_scheduled_news_ingestion(
            url=args.url,
            mode=args.mode,
            incremental=args.incremental,
        )
        _print_summary(summary)
        sys.exit(0 if summary["status"] == "success" else 1)

    # ── Scheduler mode ────────────────────────────────────────────────────────
    enabled = os.environ.get(
        "ENABLE_SCHEDULED_INGESTION", ""
    ).strip().lower() in ("true", "1", "yes")

    if not enabled:
        print(
            "\nScheduler mode requires ENABLE_SCHEDULED_INGESTION=true.\n"
            "Set the env var or use --once to run the pipeline immediately.\n"
            "\nExample:\n"
            "  ENABLE_SCHEDULED_INGESTION=true "
            "SCHEDULE_INTERVAL_MINUTES=60 python run_ingestion.py\n"
        )
        sys.exit(1)

    from integration.pipeline import start_ingestion_scheduler, stop_ingestion_scheduler

    started = start_ingestion_scheduler()
    if not started:
        logger.error("[Runner] Failed to start scheduler — check ENV vars and logs")
        sys.exit(1)

    # ── Graceful shutdown on SIGTERM / SIGINT ────────────────────────────────
    def _shutdown(signum, frame):
        logger.info("[Runner] Shutdown signal received — stopping scheduler")
        stop_ingestion_scheduler()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    interval_min = int(os.environ.get("SCHEDULE_INTERVAL_MINUTES", "360"))
    logger.info(
        f"[Runner] Scheduler running — interval={interval_min} min. "
        f"Press Ctrl+C to stop."
    )

    while True:
        time.sleep(10)


if __name__ == "__main__":
    main()
