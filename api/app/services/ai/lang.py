"""Language helpers for extract bilingual path (M11 / caption-lang)."""

from __future__ import annotations

import re

_LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")


def normalize_caption_lang(raw: str | None) -> str:
    """Map YouTube track tag (``en/asr``, ``en-US``, ``ru``) → ``en`` | ``ru`` | ``other``.

    Empty / ``?`` → ``other`` (caller may fall back to letter heuristics).
    """
    s = (raw or "").strip().lower()
    if not s or s == "?" or s.startswith("?/"):
        return "other"
    # "en/asr" | "ru/manual" | "en-US"
    code = s.split("/", 1)[0].split("-", 1)[0]
    if code == "en":
        return "en"
    if code == "ru":
        return "ru"
    return "other"


def resolve_source_lang(*, caption_lang: str | None, transcript: str) -> str:
    """Prefer YouTube caption track language; letter heuristic only if unknown."""
    norm = normalize_caption_lang(caption_lang)
    if norm in ("en", "ru"):
        return norm
    return detect_lang(transcript)


def detect_lang(text: str) -> str:
    """Return en | ru | other from letter ratio (fallback when caption lang unknown)."""
    letters = _LETTER_RE.findall(text or "")
    if not letters:
        return "other"
    cyr = sum(1 for ch in letters if ("А" <= ch <= "я") or ch in "Ёё")
    ratio = cyr / len(letters)
    if ratio >= 0.35:
        return "ru"
    latin = sum(1 for ch in letters if ("A" <= ch <= "Z") or ("a" <= ch <= "z"))
    if latin / len(letters) >= 0.5:
        return "en"
    return "other"


def is_mostly_cyrillic(text: str) -> bool:
    return detect_lang(text) == "ru"
