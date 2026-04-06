# integration/chunker.py
#
# ADDITIVE ONLY — does not import from or modify any existing scraper module.
# Splits a knowledge record (output of schema_mapper.map_article_to_knowledge)
# into paragraph/sentence-level chunks suitable for vector embedding or
# retrieval-augmented generation (RAG) pipelines.
#
# Output chunk format (per AINA integration spec):
#   {
#       source_id     : str   — id from the parent knowledge record
#       chunk_index   : int   — 0-based position of this chunk
#       chunk_text    : str   — the actual text of the chunk
#       chunk_summary : str   — 1-sentence description of the chunk
#       topic         : str   — inferred topic label for the chunk
#       metadata_json : dict  — extra context (source_url, title, date, etc.)
#   }

import re
import json
from datetime import datetime, timezone


# ─── Configuration ───────────────────────────────────────────────────────────

# Target character size per chunk.  Chunks may be slightly larger if the
# nearest sentence boundary is beyond this limit.
DEFAULT_CHUNK_SIZE = 600

# Minimum characters a chunk must have to be kept (avoids noise fragments).
MIN_CHUNK_SIZE = 80

# Maximum sentences to use when auto-generating a chunk_summary.
SUMMARY_MAX_SENTENCES = 2


# ─── Topic inference ─────────────────────────────────────────────────────────

_TOPIC_KEYWORDS: list[tuple[set, str]] = [
    # (keyword_set, topic_label) — first match wins
    ({"paspor", "passport", "perpanjang", "iqomah", "iqama", "visa",
      "legalisasi", "apostille", "surat", "dokumen", "nikah", "pernikahan"},
     "Administrasi Konsuler"),

    ({"beasiswa", "scholarship", "akademik", "pendidikan", "universitas",
      "kuliah", "mahasiswa", "pelajar", "kampus", "al-azhar"},
     "Pendidikan & Beasiswa"),

    ({"transportasi", "transport", "bus", "metro", "kereta", "taxi",
      "bandara", "airport", "uber", "grab", "angkot"},
     "Transportasi"),

    ({"apartemen", "kost", "sewa", "tempat tinggal", "akomodasi",
      "perumahan", "kontrakan", "flat"},
     "Tempat Tinggal"),

    ({"makanan", "kuliner", "restoran", "halal", "masakan", "food",
      "makan", "warung", "kafe"},
     "Kuliner"),

    ({"bahasa arab", "bahasa", "kursus", "arabic", "terjemah",
      "belajar bahasa"},
     "Bahasa"),

    ({"palestina", "palestine", "gaza", "bantuan", "donasi",
      "kemanusiaan", "humanitarian"},
     "Kemanusiaan"),

    ({"diplomasi", "bilateral", "hubungan", "kunjungan", "pertemuan",
      "perjanjian", "mou", "kerjasama"},
     "Diplomasi"),

    ({"wni", "perlindungan", "warga negara", "tki", "tkw",
      "tenaga kerja", "migran"},
     "Perlindungan WNI"),
]

_DEFAULT_TOPIC = "Berita Umum"


def _infer_topic(text: str) -> str:
    """
    Assign a topic label to a chunk of text using keyword matching.
    Returns the label of the first matching topic group, or a default.
    """
    lower = text.lower()
    for keyword_set, label in _TOPIC_KEYWORDS:
        if any(kw in lower for kw in keyword_set):
            return label
    return _DEFAULT_TOPIC


# ─── Chunking helpers ────────────────────────────────────────────────────────

def _split_into_paragraphs(text: str) -> list[str]:
    """Split text on one or more blank lines; strip each paragraph."""
    paras = re.split(r"\n{2,}", text.strip())
    return [p.strip() for p in paras if p.strip()]


def _split_into_sentences(text: str) -> list[str]:
    """Split a paragraph into individual sentences on .!? boundaries."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s.strip() for s in parts if s.strip()]


def _build_chunks(text: str, chunk_size: int = DEFAULT_CHUNK_SIZE) -> list[str]:
    """
    Split text into chunks of approximately `chunk_size` characters.

    Strategy:
      1. Split on paragraph boundaries first.
      2. If a paragraph fits within `chunk_size`, keep it whole.
      3. If a paragraph exceeds `chunk_size`, split on sentence boundaries,
         accumulating sentences until the limit is reached, then start a new chunk.
      4. Filter out chunks below MIN_CHUNK_SIZE.
    """
    paragraphs = _split_into_paragraphs(text)
    chunks: list[str] = []
    current_parts: list[str] = []
    current_len = 0

    def _flush():
        nonlocal current_parts, current_len
        merged = " ".join(current_parts).strip()
        if len(merged) >= MIN_CHUNK_SIZE:
            chunks.append(merged)
        current_parts = []
        current_len = 0

    for para in paragraphs:
        if len(para) <= chunk_size:
            # Paragraph fits — try to merge with current accumulation
            if current_len + len(para) + 1 > chunk_size and current_parts:
                _flush()
            current_parts.append(para)
            current_len += len(para) + 1
        else:
            # Paragraph is too big — break on sentences
            if current_parts:
                _flush()
            sentences = _split_into_sentences(para)
            for sent in sentences:
                if current_len + len(sent) + 1 > chunk_size and current_parts:
                    _flush()
                current_parts.append(sent)
                current_len += len(sent) + 1

    if current_parts:
        _flush()

    return chunks


def _auto_summary(chunk_text: str, max_sentences: int = SUMMARY_MAX_SENTENCES) -> str:
    """
    Build a lightweight 1-2 sentence summary of a chunk by extracting
    the first meaningful sentences (no external AI dependency).
    """
    sentences = _split_into_sentences(chunk_text)
    good = [s for s in sentences if len(s) >= 30]
    selected = good[:max_sentences] if good else sentences[:max_sentences]
    summary = " ".join(selected)
    if len(summary) > 300:
        summary = summary[:297].rsplit(" ", 1)[0] + "..."
    return summary


# ─── Public API ──────────────────────────────────────────────────────────────

def chunk_knowledge_record(
    knowledge_record: dict,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> list[dict]:
    """
    Split a knowledge record into retrievable chunks.

    Args:
        knowledge_record: dict produced by schema_mapper.map_article_to_knowledge().
                          Required keys: id, cleaned_content.
                          Optional keys: title, source_url, source_name,
                                         tags, status, created_at.
        chunk_size: target character size per chunk (default 600).

    Returns:
        List of chunk dicts, each with:
            source_id     — id from the parent knowledge record
            chunk_index   — 0-based position in the sequence
            chunk_text    — the raw chunk text
            chunk_summary — auto-generated 1-2 sentence summary
            topic         — inferred topic label
            metadata_json — dict with title, source_url, source_name,
                            tags, status, published_date, chunk_count
    """
    source_id = knowledge_record.get("id", "")
    content   = (knowledge_record.get("cleaned_content") or "").strip()

    if not content:
        return []

    raw_chunks = _build_chunks(content, chunk_size=chunk_size)
    total = len(raw_chunks)

    result: list[dict] = []
    for idx, chunk_text in enumerate(raw_chunks):
        summary = _auto_summary(chunk_text)
        topic   = _infer_topic(chunk_text)

        metadata = {
            "title":          knowledge_record.get("title", ""),
            "source_url":     knowledge_record.get("source_url", ""),
            "source_name":    knowledge_record.get("source_name", ""),
            "tags":           knowledge_record.get("tags", []),
            "status":         knowledge_record.get("status", ""),
            "published_date": knowledge_record.get("created_at", "")[:10],
            "chunk_count":    total,
        }

        result.append({
            "source_id":     source_id,
            "chunk_index":   idx,
            "chunk_text":    chunk_text,
            "chunk_summary": summary,
            "topic":         topic,
            "metadata_json": metadata,
        })

    return result


def chunk_knowledge_batch(
    knowledge_records: list,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> list[dict]:
    """
    Batch-chunk a list of knowledge records.

    Args:
        knowledge_records: list of dicts from schema_mapper.map_articles_to_knowledge().
        chunk_size: target character size per chunk.

    Returns:
        Flat list of all chunk dicts across all records, in order.
    """
    all_chunks: list[dict] = []
    for record in knowledge_records:
        all_chunks.extend(chunk_knowledge_record(record, chunk_size=chunk_size))
    return all_chunks
