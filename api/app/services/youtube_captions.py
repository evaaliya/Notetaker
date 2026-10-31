"""Fetch YouTube caption track text (no media download)."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from html import unescape
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.errors import AppError

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")
_PREF_LANGS = ("ru", "en", "uk", "kk", "de", "fr", "es")
_INNERTUBE_CONTEXT = {"client": {"clientName": "ANDROID", "clientVersion": "20.10.38"}}
_INNERTUBE_KEY_RE = re.compile(r'"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"')


def extract_youtube_id(url_or_id: str) -> str:
    raw = (url_or_id or "").strip()
    if _YT_ID_RE.fullmatch(raw):
        return raw
    try:
        u = urlparse(raw if "://" in raw else f"https://{raw}")
    except Exception as exc:
        raise AppError("validation_error", "Некорректная ссылка YouTube") from exc
    host = (u.hostname or "").lower()
    path = u.path or ""
    if host in {"youtu.be", "www.youtu.be"}:
        vid = path.strip("/").split("/")[0]
    elif "youtube.com" in host:
        if path.startswith("/shorts/") or path.startswith("/embed/"):
            parts = path.strip("/").split("/")
            vid = parts[1] if len(parts) > 1 else ""
        else:
            vid = parse_qs(u.query).get("v", [""])[0]
    else:
        raise AppError("validation_error", "Нужна ссылка YouTube")
    if not vid or not _YT_ID_RE.fullmatch(vid):
        raise AppError("validation_error", "Не удалось извлечь id ролика YouTube")
    return vid


def fetch_youtube_captions(url_or_id: str, *, timeout: float = 30.0) -> tuple[str, str]:
    """Return (plain_text, lang_or_kind). Raises AppError if no captions."""
    video_id = extract_youtube_id(url_or_id)
    headers = {"User-Agent": _UA, "Accept-Language": "ru,en;q=0.8"}
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
            tracks, playability = _caption_tracks(client, video_id)
            if not tracks:
                status = (playability or {}).get("status")
                reason = (playability or {}).get("reason") or ""
                if status and status != "OK":
                    raise AppError(
                        "video_unavailable",
                        f"YouTube: ролик недоступен ({reason or status}). "
                        "Проверьте id (регистр важен: I ≠ l) и регион.",
                        status_code=404,
                    )
                raise AppError(
                    "no_captions",
                    "У ролика нет субтитров (ни ручных, ни авто). Разбор по тексту дорожки невозможен.",
                    status_code=404,
                )
            # Try preferred track first, then others if body empty (stale/blocked baseUrl).
            ordered = _order_tracks(tracks)
            last_empty = False
            for track in ordered:
                base = track.get("baseUrl") or track.get("base_url")
                if not base:
                    continue
                base = str(base).replace("&fmt=srv3", "")
                res = client.get(base)
                if res.status_code >= 400:
                    continue
                text = captions_xml_to_text(res.text)
                if not text.strip():
                    last_empty = True
                    continue
                lang = str(track.get("languageCode") or track.get("language_code") or "?")
                kind = "asr" if track.get("kind") == "asr" else "manual"
                return text, f"{lang}/{kind}"
            if last_empty:
                raise AppError("no_captions", "Дорожка субтитров пустая", status_code=404)
            raise AppError("no_captions", "Не удалось получить URL дорожки субтитров", status_code=404)
    except AppError:
        raise
    except httpx.HTTPError as exc:
        raise AppError("upstream_error", f"YouTube недоступен: {exc}", status_code=502) from exc


def captions_xml_to_text(raw: str) -> str:
    """Parse YouTube timedtext XML (srv1/srv3) or JSON3 into plain lines."""
    data = (raw or "").strip()
    if not data:
        return ""
    if data.startswith("{") or data.startswith("["):
        return _json3_to_text(data)
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        m = re.search(r"(<transcript[\s\S]*</transcript>)", data, re.I)
        if not m:
            return _strip_tags(data)
        root = ET.fromstring(m.group(1))
    lines: list[str] = []
    for node in root.iter():
        tag = node.tag.split("}")[-1].lower()
        if tag in {"text", "p", "s"}:
            chunk = "".join(node.itertext())
            chunk = unescape(chunk.replace("\n", " ")).strip()
            if chunk:
                lines.append(chunk)
    out: list[str] = []
    for line in lines:
        if not out or out[-1] != line:
            out.append(line)
    return " ".join(out).strip()


def _json3_to_text(raw: str) -> str:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    events = obj.get("events") if isinstance(obj, dict) else None
    if not isinstance(events, list):
        return ""
    parts: list[str] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        segs = ev.get("segs")
        if not isinstance(segs, list):
            continue
        for seg in segs:
            if isinstance(seg, dict) and seg.get("utf8"):
                parts.append(str(seg["utf8"]))
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _strip_tags(raw: str) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", unescape(cleaned)).strip()


def _caption_tracks(client: httpx.Client, video_id: str) -> tuple[list[dict], dict | None]:
    """Return (tracks, playabilityStatus). Prefer Innertube ANDROID — watch-page baseUrl often empty."""
    watch = client.get(f"https://www.youtube.com/watch?v={video_id}")
    if watch.status_code >= 400:
        raise AppError("upstream_error", f"YouTube watch HTTP {watch.status_code}", status_code=502)
    html = unescape(watch.text)
    playability: dict | None = None

    api_key_m = _INNERTUBE_KEY_RE.search(html)
    if api_key_m:
        tracks, playability = _tracks_from_innertube(client, video_id, api_key_m.group(1))
        if tracks:
            return tracks, playability

    player = _extract_player_response(html)
    if player:
        playability = player.get("playabilityStatus") if isinstance(player.get("playabilityStatus"), dict) else playability
        try:
            tracks = (
                player.get("captions", {})
                .get("playerCaptionsTracklistRenderer", {})
                .get("captionTracks", [])
                or []
            )
        except AttributeError:
            tracks = []
        if tracks:
            return [t for t in tracks if isinstance(t, dict)], playability

    listed = client.get(
        "https://www.youtube.com/api/timedtext",
        params={"type": "list", "v": video_id},
    )
    if listed.status_code < 400 and listed.text.strip():
        parsed = _parse_track_list_xml(listed.text)
        if parsed:
            return parsed, playability
    return [], playability


def _tracks_from_innertube(
    client: httpx.Client, video_id: str, api_key: str
) -> tuple[list[dict], dict | None]:
    res = client.post(
        f"https://www.youtube.com/youtubei/v1/player?key={api_key}",
        json={"context": _INNERTUBE_CONTEXT, "videoId": video_id},
    )
    if res.status_code >= 400:
        return [], None
    try:
        data = res.json()
    except json.JSONDecodeError:
        return [], None
    playability = data.get("playabilityStatus") if isinstance(data.get("playabilityStatus"), dict) else None
    try:
        tracks = (
            data.get("captions", {})
            .get("playerCaptionsTracklistRenderer", {})
            .get("captionTracks", [])
            or []
        )
    except AttributeError:
        tracks = []
    return [t for t in tracks if isinstance(t, dict)], playability


def _extract_player_response(html: str) -> dict | None:
    marker = "ytInitialPlayerResponse"
    idx = html.find(marker)
    if idx >= 0:
        brace = html.find("{", idx)
        if brace >= 0:
            try:
                obj, _ = json.JSONDecoder().raw_decode(html[brace:])
                if isinstance(obj, dict):
                    return obj
            except json.JSONDecodeError:
                pass
    m = re.search(r'"captionTracks"\s*:\s*(\[[^\]]+\])', html)
    if m:
        try:
            arr = json.loads(m.group(1))
            if isinstance(arr, list):
                return {
                    "captions": {
                        "playerCaptionsTracklistRenderer": {"captionTracks": arr}
                    }
                }
        except json.JSONDecodeError:
            pass
    return None


def _parse_track_list_xml(xml_text: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out: list[dict] = []
    for track in root.findall(".//track"):
        lang = track.attrib.get("lang_code") or track.attrib.get("lang_original") or ""
        name = track.attrib.get("name") or ""
        kind = "asr" if track.attrib.get("kind") == "asr" else ""
        v = track.attrib.get("v") or ""
        params = {
            "v": v,
            "lang": lang,
            "fmt": "srv3",
        }
        if kind:
            params["kind"] = "asr"
        if name:
            params["name"] = name
        q = "&".join(f"{k}={unquote(str(val))}" for k, val in params.items() if val)
        out.append(
            {
                "languageCode": lang,
                "kind": kind,
                "baseUrl": f"https://www.youtube.com/api/timedtext?{q}",
            }
        )
    return out


def _track_score(t: dict) -> tuple[int, int]:
    lang = str(t.get("languageCode") or t.get("language_code") or "").lower()
    kind = str(t.get("kind") or "")
    pref = 0
    for i, code in enumerate(_PREF_LANGS):
        if lang.startswith(code):
            pref = 100 - i
            break
    manual = 10 if kind != "asr" else 0
    return (pref + manual, pref)


def _order_tracks(tracks: list[dict]) -> list[dict]:
    return sorted(tracks, key=_track_score, reverse=True)


def _pick_track(tracks: list[dict]) -> dict:
    return max(tracks, key=_track_score)
