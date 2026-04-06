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


def ocr_arabic_page(page_image_bytes: bytes) -> str:
    """
    OCR satu halaman PDF (sebagai PNG bytes) menggunakan GPT-4o vision.
    Khusus untuk teks Arab. Mengembalikan teks hasil OCR.
    """
    import base64
    client = get_openai_client()
    b64 = base64.b64encode(page_image_bytes).decode("utf-8")
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Ini adalah halaman dari kitab berbahasa Arab. "
                        "Tolong ekstrak SEMUA teks yang ada di halaman ini secara akurat, "
                        "termasuk harakat jika ada. "
                        "Kembalikan HANYA teks Arab tanpa komentar tambahan."
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
                }
            ],
        }],
        max_tokens=2000,
        temperature=0.1,
    )
    return response.choices[0].message.content.strip()


def check_openai_available() -> bool:
    """Return True jika OpenAI API key tersedia."""
    return bool(os.environ.get("OPENAI_API_KEY"))
