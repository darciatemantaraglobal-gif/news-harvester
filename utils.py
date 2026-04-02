# utils.py — HTTP helpers dengan retry, timeout, delay
import time
import requests
from bs4 import BeautifulSoup

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
TIMEOUT = 15
RETRY_COUNT = 2
REQUEST_DELAY = 1  # detik antar request

HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"}


def get_soup(url: str) -> BeautifulSoup | None:
    """Fetch URL dengan retry dan return BeautifulSoup object."""
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            return BeautifulSoup(resp.text, "lxml")
        except Exception as e:
            if attempt < RETRY_COUNT:
                time.sleep(REQUEST_DELAY)
            else:
                raise e
    return None


def delay():
    """Delay antar request agar tidak agresif."""
    time.sleep(REQUEST_DELAY)
