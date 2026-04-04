# utils.py — HTTP helpers dengan retry, timeout, delay
import time
import requests
from bs4 import BeautifulSoup

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
TIMEOUT = 15
RETRY_COUNT = 2
REQUEST_DELAY = 0.5  # detik antar request

HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"}

# Status code yang mengindikasikan situs memblokir scraper
BLOCKED_CODES = {403, 429, 503, 406, 451}


def get_soup(url: str) -> BeautifulSoup:
    """
    Fetch URL dengan retry dan return BeautifulSoup object.
    Membiarkan exception spesifik bubble up agar bisa diklasifikasikan:
      - requests.exceptions.Timeout
      - requests.exceptions.ConnectionError
      - requests.exceptions.HTTPError  (incl. 403/429 → blocked)
      - Exception (parse error, dll)
    """
    last_exc = None
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"
            return BeautifulSoup(resp.text, "lxml")
        except requests.exceptions.Timeout as e:
            last_exc = e
        except requests.exceptions.HTTPError as e:
            # Jangan retry untuk status blocked
            if e.response is not None and e.response.status_code in BLOCKED_CODES:
                raise
            last_exc = e
        except requests.exceptions.ConnectionError as e:
            last_exc = e
        except Exception as e:
            last_exc = e

        if attempt < RETRY_COUNT:
            time.sleep(REQUEST_DELAY)

    raise last_exc


def delay():
    """Delay antar request agar tidak agresif."""
    time.sleep(REQUEST_DELAY)
