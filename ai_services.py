import os
import logging
from formatter import format_aina_response

_client = None


def get_openai_client():
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY tidak ditemukan di environment. "
                "Fitur AI Summary tidak tersedia."
            )
        try:
            from openai import OpenAI
            _client = OpenAI(api_key=api_key)
        except ImportError:
            raise RuntimeError("Package 'openai' belum terinstall. Jalankan: pip install openai")
    return _client


def generate_ai_summary(title: str, content: str) -> str:
    """Buat ringkasan artikel menggunakan GPT-4o-mini."""
    client = get_openai_client()
    prompt = (
        f"Artikel berita berjudul: \"{title}\"\n\n"
        f"Konten:\n{content[:3000]}\n\n"
        "Tulis ringkasan singkat artikel ini dalam 2-3 kalimat dalam Bahasa Indonesia. "
        "Fokus pada fakta utama, siapa yang terlibat, dan apa yang terjadi."
    )
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=300,
        temperature=0.3,
    )
    raw = response.choices[0].message.content.strip()
    return format_aina_response(raw)


def ocr_arabic_pages_batch(page_images: list[bytes]) -> list[str]:
    """
    OCR beberapa halaman PDF sekaligus (batch) menggunakan GPT-4o-mini vision.
    Menerima list PNG bytes, mengembalikan list teks per halaman.

    Hemat biaya:
    - detail: "low"  → ~85 token/gambar (vs high: 500-2000 token)
    - max_tokens: 800 per halaman
    - Batch: beberapa halaman per API call (kurangi overhead)
    """
    import base64
    if not page_images:
        return []

    client = get_openai_client()

    content = [{
        "type": "text",
        "text": (
            f"Ada {len(page_images)} halaman dari kitab berbahasa Arab di bawah ini. "
            "Untuk SETIAP halaman, ekstrak semua teks Arab yang ada. "
            f"Format jawaban: tulis '===HALAMAN 1===' lalu teksnya, '===HALAMAN 2===' lalu teksnya, dst. "
            "Kembalikan HANYA teks Arab, tanpa komentar. Jika halaman kosong/gambar saja, tulis '(kosong)'."
        )
    }]

    for i, img_bytes in enumerate(page_images):
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64}",
                "detail": "low",  # 85 token/gambar vs high yang bisa 2000 token
            }
        })

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": content}],
        max_tokens=800 * len(page_images),
        temperature=0.1,
    )

    raw = response.choices[0].message.content.strip()

    # Parse hasil per halaman
    results = []
    if len(page_images) == 1:
        results.append(raw if raw != "(kosong)" else "")
    else:
        for i in range(len(page_images)):
            marker = f"===HALAMAN {i + 1}==="
            next_marker = f"===HALAMAN {i + 2}===" if i + 1 < len(page_images) else None
            start = raw.find(marker)
            if start == -1:
                results.append("")
                continue
            start += len(marker)
            end = raw.find(next_marker) if next_marker else len(raw)
            chunk = raw[start:end].strip()
            results.append("" if chunk == "(kosong)" else chunk)

    return results


def ocr_arabic_page(page_image_bytes: bytes) -> str:
    """Wrapper single-halaman untuk backward compat."""
    results = ocr_arabic_pages_batch([page_image_bytes])
    return results[0] if results else ""


def check_openai_available() -> bool:
    """Return True jika OpenAI API key tersedia."""
    return bool(os.environ.get("OPENAI_API_KEY"))
