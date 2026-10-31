"""Parse .txt / .vtt / .srt (incl. Zoom-ish exports) to plain text (M11)."""

from __future__ import annotations

import re

_VTT_TS = re.compile(
    r"^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[.,]\d{3}"
)
_SRT_TS = re.compile(
    r"^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[.,]\d{3}"
)
_SRT_INDEX = re.compile(r"^\d+$")
_VTT_NOTE = re.compile(r"^(NOTE|STYLE|REGION)\b", re.IGNORECASE)
_ZOOM_CHAT = re.compile(r"^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s+")


def parse_transcript(filename: str | None, content: str | bytes) -> str:
    if isinstance(content, bytes):
        text = content.decode("utf-8-sig", errors="replace")
    else:
        text = content
    name = (filename or "").lower()
    if name.endswith(".vtt") or text.lstrip().upper().startswith("WEBVTT"):
        return parse_vtt(text)
    if name.endswith(".srt"):
        return parse_srt(text)
    return parse_plain_or_zoom(text)


def parse_vtt(text: str) -> str:
    lines_out: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if line.upper().startswith("WEBVTT"):
            continue
        if _VTT_NOTE.match(line):
            continue
        if _VTT_TS.match(line):
            continue
        if line.startswith("NOTE "):
            continue
        # Strip optional cue settings after timestamp already skipped.
        lines_out.append(_strip_vtt_tags(line))
    return "\n".join(lines_out).strip()


def parse_srt(text: str) -> str:
    lines_out: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if _SRT_INDEX.match(line):
            continue
        if _SRT_TS.match(line):
            continue
        lines_out.append(_strip_vtt_tags(line))
    return "\n".join(lines_out).strip()


def parse_plain_or_zoom(text: str) -> str:
    """Keep speaker labels; drop empty lines. Zoom chat-like timestamps stay as context."""
    lines_out: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        lines_out.append(line)
    return "\n".join(lines_out).strip()


def _strip_vtt_tags(line: str) -> str:
    # Remove simple <c> / <v Speaker> tags.
    line = re.sub(r"</?c[^>]*>", "", line)
    line = re.sub(r"<v\s+([^>]+)>", r"\1: ", line)
    line = re.sub(r"</v>", "", line)
    line = re.sub(r"<[^>]+>", "", line)
    return line.strip()
