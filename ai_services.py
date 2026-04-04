import os
import logging

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
    return response.choices[0].message.content.strip()


def check_openai_available() -> bool:
    """Return True jika OpenAI API key tersedia."""
    return bool(os.environ.get("OPENAI_API_KEY"))
