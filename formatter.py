# formatter.py — Post-processing formatter layer for AINA
# Transforms raw AI/scraped output into clean, structured, consistent final text
# before it is stored in KB or returned to the frontend.

import re
import unicodedata

# ─── Robotic / filler phrases to strip ──────────────────────────────────────

_ROBOTIC_PHRASES = [
    # Opener phrases — strip through end of that sentence
    r"Tentu(?:nya)?[,!]?\s+(?:saya\s+)?(?:akan\s+)?(?:\w+\s+)*?(?=[A-Z\u00C0-\u024F])",
    r"Tentu(?:nya)?[!,.]?\s*",
    r"Baik(?:lah)?[,!.]?\s*",
    r"Dengan senang hati[,!.]?[^.!?]*[.!?]?\s*",
    r"Sebagai asisten AI[,!]?[^.!?]*[.!?]?\s*",
    r"Sebagai AI[,!]?[^.!?]*[.!?]?\s*",
    r"Saya adalah (?:sebuah )?AI[^.!?]*[.!?]?\s*",
    r"Saya hanya sebuah AI[^.!?]*[.!?]?\s*",
    r"Berdasarkan pengetahuan saya[,]?\s*",
    r"Perlu saya sampaikan bahwa\s*",
    r"Penting untuk dicatat bahwa\s*",
    r"Harap dicatat bahwa\s*",
    # Closer phrases — strip whole sentence anywhere in text
    r"[Ss]emoga\s+(?:ini\s+)?(?:membantu|bermanfaat)[!.]?\s*",
    r"[Jj]ika ada pertanyaan lain[^.!?]*[.!?]\s*",
    r"[Ss]ilakan (?:tanyakan|hubungi|bertanya)[^.!?]*[.!?]\s*",
    r"[Jj]angan ragu (?:untuk\s+)?(?:bertanya|menghubungi)[^.!?]*[.!?]\s*",
]

# Arabic script detection
_ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")


# ─── Main public function ────────────────────────────────────────────────────

def format_aina_response(
    raw_text: str,
    context: dict | None = None,
) -> str:
    """
    Post-process raw AI/scraped text into clean AINA output.

    Args:
        raw_text: The raw text to format (summary, KB content, AI answer, etc.)
        context: Optional metadata dict with keys:
            - source_url (str): origin URL
            - source_name (str): display name of the source
            - scrape_status (str): 'success' | 'partial' | 'failed'
            - published_date (str): YYYY-MM-DD
            - add_trust_footer (bool): whether to append the trust footer
            - is_list_content (bool): hint that content is a list

    Returns:
        Formatted, clean text string.
    """
    if not raw_text or not raw_text.strip():
        return _safety_fallback(context)

    ctx = context or {}
    text = raw_text.strip()

    # 1. Clean text
    text = _clean_text(text)
    if not text:
        return _safety_fallback(ctx)

    # 2. Normalize whitespace / line endings
    text = _normalize_whitespace(text)

    # 3. Split paragraphs that are too long
    text = _split_long_paragraphs(text)

    # 4. Normalize bullet/list formatting
    text = _normalize_bullets(text, hint_is_list=ctx.get("is_list_content", False))

    # 5. Arabic format fix
    text = _fix_arabic_context(text)

    # 6. Trust footer (optional, only if explicitly requested)
    if ctx.get("add_trust_footer"):
        text = _append_trust_footer(text, ctx)

    return text.strip()


# ─── Internal helpers ────────────────────────────────────────────────────────

def _clean_text(text: str) -> str:
    """Remove robotic phrases, excessive repetition, and leading/trailing noise."""
    # Strip robotic openers / closers
    for pattern in _ROBOTIC_PHRASES:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE | re.MULTILINE)

    # Remove consecutive duplicate sentences
    sentences = re.split(r"(?<=[.!?])\s+", text)
    seen: set[str] = set()
    deduped: list[str] = []
    for s in sentences:
        key = re.sub(r"\s+", " ", s.strip().lower())
        if key and key not in seen:
            seen.add(key)
            deduped.append(s.strip())
    text = " ".join(deduped)

    # Remove lines that are pure navigation artifacts (very short, no letters)
    lines = text.splitlines()
    lines = [l for l in lines if not re.fullmatch(r"[\W\d\s]{0,20}", l.strip())]
    text = "\n".join(lines)

    # Fix double spaces
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def _normalize_whitespace(text: str) -> str:
    """Normalize line endings and ensure consistent paragraph breaks."""
    # Convert \r\n and \r to \n
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse 3+ blank lines into 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _split_long_paragraphs(text: str, max_chars: int = 600) -> str:
    """
    Break paragraphs that exceed max_chars into smaller ones.
    Splits on sentence boundaries (., !, ?) to keep reading natural.
    """
    paragraphs = text.split("\n\n")
    result: list[str] = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chars:
            result.append(para)
            continue
        # Split into sentences and re-group into chunks ≤ max_chars
        sents = re.split(r"(?<=[.!?])\s+", para)
        chunk: list[str] = []
        chunk_len = 0
        for sent in sents:
            if chunk and chunk_len + len(sent) + 1 > max_chars:
                result.append(" ".join(chunk))
                chunk = [sent]
                chunk_len = len(sent)
            else:
                chunk.append(sent)
                chunk_len += len(sent) + 1
        if chunk:
            result.append(" ".join(chunk))
    return "\n\n".join(result)


def _normalize_bullets(text: str, hint_is_list: bool = False) -> str:
    """
    Detect and normalize list-like content into consistent bullet format.
    Handles:
    - Lines starting with -, *, •, numbers (1. 2. etc.)
    - Inline comma-separated items that should be a list (if hint_is_list=True)
    """
    lines = text.splitlines()
    normalized: list[str] = []

    # Regex: detect existing list markers
    _bullet_re = re.compile(r"^[\-\*\•]\s+")
    _num_re = re.compile(r"^\d+[\.\)]\s+")

    for line in lines:
        stripped = line.strip()
        if not stripped:
            normalized.append("")
            continue
        if _bullet_re.match(stripped):
            # Normalize to "- " format
            normalized.append("- " + _bullet_re.sub("", stripped))
        elif _num_re.match(stripped):
            # Keep numbered lists as-is but clean spacing
            normalized.append(re.sub(r"^(\d+)[\.\)]\s+", r"\1. ", stripped))
        else:
            normalized.append(line)

    return "\n".join(normalized)


def _fix_arabic_context(text: str) -> str:
    """
    Ensure Arabic words are accompanied by transliteration hints when possible.
    If a line has Arabic script isolated (no parenthetical already), add a
    marker so downstream rendering knows to treat it specially.
    We don't auto-transliterate (requires an external library), but we flag it.
    """
    lines = text.splitlines()
    result: list[str] = []
    for line in lines:
        if _ARABIC_RE.search(line):
            # Check if already has transliteration hint: parenthetical ASCII after Arabic
            has_hint = bool(re.search(r"[\u0600-\u06FF].+\([A-Za-z]", line))
            if not has_hint:
                # Wrap Arabic-only sequences to signal RTL context
                line = re.sub(
                    r"([\u0600-\u06FF][\u0600-\u06FF\s\u064B-\u065F]*[\u0600-\u06FF])",
                    r"[\1]",
                    line,
                )
        result.append(line)
    return "\n".join(result)


def _append_trust_footer(text: str, ctx: dict) -> str:
    """Append a standardized trust footer block."""
    source_name = ctx.get("source_name") or _extract_domain(ctx.get("source_url", "")) or "Tidak diketahui"
    source_url = ctx.get("source_url", "")
    date = ctx.get("published_date", "")
    status = ctx.get("scrape_status", "")

    trust_level = _infer_trust_level(status, source_url)

    footer_parts = ["\n\n—"]
    if source_url:
        footer_parts.append(f"Sumber: {source_name} ({source_url})")
    else:
        footer_parts.append(f"Sumber: {source_name}")
    if date:
        footer_parts.append(f"Tanggal: {date}")
    footer_parts.append(f"Tingkat kepercayaan: {trust_level}")

    return text + "\n".join(footer_parts)


def _infer_trust_level(scrape_status: str, source_url: str) -> str:
    """Derive a human-readable trust level from status and source."""
    url_lower = (source_url or "").lower()
    is_official = any(d in url_lower for d in ["kemlu.go.id", "go.id", "kbri", "kjri"])

    if scrape_status == "success" and is_official:
        return "Tinggi — Sumber resmi pemerintah"
    elif scrape_status == "success":
        return "Sedang — Konten berhasil di-scrape sepenuhnya"
    elif scrape_status == "partial":
        return "Sedang-rendah — Konten tidak lengkap (partial scrape)"
    else:
        return "Rendah — Status scraping tidak diketahui"


def _extract_domain(url: str) -> str:
    """Extract domain name from URL for display."""
    if not url:
        return ""
    match = re.search(r"https?://(?:www\.)?([^/]+)", url)
    return match.group(1) if match else url[:40]


def _safety_fallback(ctx: dict | None) -> str:
    """Return a minimal structured fallback when input is empty or unformattable."""
    ctx = ctx or {}
    source = _extract_domain(ctx.get("source_url", "")) or "sumber tidak diketahui"
    return (
        "Informasi tidak tersedia saat ini.\n\n"
        f"Sumber data: {source}\n"
        "Silakan coba scrape ulang atau periksa konten artikel secara manual."
    )
