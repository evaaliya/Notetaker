"""Language heuristics for extract bilingual path (M11)."""

from __future__ import annotations

import re

_LETTER_RE = re.compile(r"[A-Za-zА-Яа-яЁё]")


def detect_lang(text: str) -> str:
    """Return en | ru | other from letter ratio (transcript / note body)."""
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
