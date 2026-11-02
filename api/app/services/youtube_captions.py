"""Fetch YouTube caption track text (no media download)."""

from __future__ import annotations

import json
import re
import time
import xml.etree.ElementTree as ET
from html import unescape
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.errors import AppError
from app.services.extract_errors import map_httpx_error, raise_extract
from app.services.http_retry import call_with_retry, remaining_timeout

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,32}$")
# Fallback preference when default audio lang is absent (en before ru — not the reverse).
_PREF_LANGS = ("en", "ru", "uk", "kk", "de", "fr", "es")
# Bump when track-picking algorithm changes so caption cache keys miss old rows.
# v3: prefer audioTracks[defaultAudioTrackIndex] (e.g. ru.4) over bare en>ru fallback.
CAPTION_TRACK_ALGO_VERSION = "v3"
_INNERTUBE_CONTEXT = {"client": {"clientName": "ANDROID", "clientVersion": "20.10.38"}}
_INNERTUBE_KEY_RE = re.compile(r'"INNERTUBE_API_KEY"\s*:\s*"([a-zA-Z0-9_-]+)"')


def caption_cache_key(video_id: str) -> str:
    """PK for youtube_caption_cache: includes track-pick algo version."""
    return f"{CAPTION_TRACK_ALGO_VERSION}:{video_id}"


def track_language_code(track: dict) -> str:
    return str(track.get("languageCode") or track.get("language_code") or "").strip().lower()


def track_is_asr(track: dict) -> bool:
    return str(track.get("kind") or "") == "asr"


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


def fetch_youtube_captions(
    url_or_id: str,
    *,
    timeout: float = 15.0,
    retries: int = 1,
    retry_pause_sec: float = 1.0,
) -> tuple[str, str]:
    """Return (plain_text, lang_or_kind). Raises AppError if no captions.

    ``timeout`` is a **wall-clock** budget for the whole captions chain (M14 / D-083),
    not only per-request httpx read timeout.
    """
    video_id = extract_youtube_id(url_or_id)

    def once() -> tuple[str, str]:
        return _fetch_captions_once(video_id, wall_timeout=timeout)

    try:
        return call_with_retry(
            once,
            retries=retries,
            pause_sec=retry_pause_sec,
            is_transient=lambda exc: isinstance(exc, httpx.HTTPError)
            and not isinstance(exc, AppError),
        )
    except AppError:
        raise
    except httpx.TimeoutException as exc:
        f = map_httpx_error(exc)
        raise AppError(f.code, f.message, status_code=f.status_code, extra={"hint": f.hint}) from exc
    except httpx.HTTPError as exc:
        f = map_httpx_error(exc)
        raise AppError(f.code, f.message, status_code=f.status_code, extra={"hint": f.hint}) from exc


def _fetch_captions_once(video_id: str, *, wall_timeout: float) -> tuple[str, str]:
    headers = {"User-Agent": _UA, "Accept-Language": "en,ru;q=0.8"}
    deadline = time.monotonic() + max(0.5, wall_timeout)
    # Per-request cap shares the wall budget; connect stays short.
    per = min(wall_timeout, 10.0)
    timeout = httpx.Timeout(connect=5.0, read=per, write=per, pool=5.0)
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        tracks, playability, preferred_audio = _caption_tracks(
            client, video_id, deadline=deadline
        )
        if not tracks:
            status = (playability or {}).get("status")
            reason = (playability or {}).get("reason") or ""
            if status and status != "OK":
                raise_extract(
                    "video_unavailable",
                    detail=(
                        f"YouTube: ролик недоступен ({reason or status}). "
                        "Проверьте id (регистр важен: I ≠ l) и регион."
                    ),
                )
            raise_extract("no_captions")
        ordered = _order_tracks(tracks, preferred_audio=preferred_audio)
        last_empty = False
        for track in ordered:
            remaining_timeout(deadline)
            base = track.get("baseUrl") or track.get("base_url")
            if not base:
                continue
            base = str(base).replace("&fmt=srv3", "")
            left = remaining_timeout(deadline)
            res = client.get(base, timeout=httpx.Timeout(connect=5.0, read=left, write=left, pool=5.0))
            if res.status_code >= 400:
                continue
            text = captions_xml_to_text(res.text)
            if not text.strip():
                last_empty = True
                continue
            # source_lang must follow THIS track's languageCode — not defaultAudioLanguage.
            lang = track_language_code(track) or "?"
            kind = "asr" if track_is_asr(track) else "manual"
            return text, f"{lang}/{kind}"
        if last_empty:
            raise_extract("no_captions", detail="Дорожка субтитров пустая")
        raise_extract("no_captions", detail="Не удалось получить URL дорожки субтитров")
    raise AssertionError("unreachable")


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


def _caption_tracks(
    client: httpx.Client, video_id: str, *, deadline: float | None = None
) -> tuple[list[dict], dict | None, str | None]:
    """Return (tracks, playabilityStatus, preferred_audio_lang).

    ``preferred_audio`` comes from captions.audioTracks[defaultAudioTrackIndex]
    (e.g. ``ru.4``) or legacy defaultAudioLanguage — used only to prefer a matching
    caption track, never as the language of fetched text.
    """
    if deadline is not None:
        remaining_timeout(deadline)
    playability: dict | None = None
    preferred_audio: str | None = None

    # Prefer ANDROID player JSON (no watch HTML) — survives watch 429 and exposes
    # audioTracks[defaultAudioTrackIndex] for bilingual ASR videos.
    tracks, playability, preferred_audio = _tracks_from_innertube(client, video_id, api_key=None)
    if tracks:
        return tracks, playability, preferred_audio

    watch = client.get(f"https://www.youtube.com/watch?v={video_id}")
    if watch.status_code >= 400:
        # Last resort: timedtext list (often empty for modern videos).
        if deadline is not None:
            remaining_timeout(deadline)
        listed = client.get(
            "https://www.youtube.com/api/timedtext",
            params={"type": "list", "v": video_id},
        )
        if listed.status_code < 400 and listed.text.strip():
            parsed = _parse_track_list_xml(listed.text)
            if parsed:
                return parsed, playability, preferred_audio
        raise_extract("upstream_error", detail=f"YouTube watch HTTP {watch.status_code}")
    html = unescape(watch.text)

    api_key_m = _INNERTUBE_KEY_RE.search(html)
    if api_key_m:
        if deadline is not None:
            remaining_timeout(deadline)
        tracks, playability, preferred_audio = _tracks_from_innertube(
            client, video_id, api_key=api_key_m.group(1)
        )
        if tracks:
            return tracks, playability, preferred_audio

    player = _extract_player_response(html)
    if player:
        playability = (
            player.get("playabilityStatus")
            if isinstance(player.get("playabilityStatus"), dict)
            else playability
        )
        preferred_audio = preferred_audio or _audio_lang_from_player(player)
        cap_renderer = _captions_renderer(player)
        tracks = (cap_renderer or {}).get("captionTracks") or []
        if isinstance(tracks, list) and tracks:
            return [t for t in tracks if isinstance(t, dict)], playability, preferred_audio

    if deadline is not None:
        remaining_timeout(deadline)
    listed = client.get(
        "https://www.youtube.com/api/timedtext",
        params={"type": "list", "v": video_id},
    )
    if listed.status_code < 400 and listed.text.strip():
        parsed = _parse_track_list_xml(listed.text)
        if parsed:
            return parsed, playability, preferred_audio
    return [], playability, preferred_audio


def _captions_renderer(player: dict) -> dict | None:
    try:
        renderer = (
            player.get("captions", {})
            .get("playerCaptionsTracklistRenderer")
        )
    except AttributeError:
        return None
    return renderer if isinstance(renderer, dict) else None


def _audio_lang_from_track_id(audio_track_id: str | None) -> str | None:
    """``ru.4`` / ``en-US.10`` → ``ru`` / ``en-us`` (base matched by _track_score)."""
    raw = (audio_track_id or "").strip().lower()
    if not raw:
        return None
    # Drop YouTube quality/role suffix (``.4`` original, ``.10`` dubbed, …).
    lang = raw.rsplit(".", 1)[0] if "." in raw else raw
    return lang or None


def _audio_lang_from_captions_renderer(renderer: dict | None) -> str | None:
    """Prefer language of audioTracks[defaultAudioTrackIndex] (Innertube).

    Many bilingual videos omit defaultAudioLanguage but still expose e.g. ``ru.4``
    as the default audio while listing both ``en/asr`` and ``ru/asr`` — without this
    we incorrectly fall back to en-first and download the English auto-track.
    """
    if not isinstance(renderer, dict):
        return None
    tracks = renderer.get("audioTracks")
    if not isinstance(tracks, list) or not tracks:
        return None
    idx = renderer.get("defaultAudioTrackIndex")
    if not isinstance(idx, int) or idx < 0 or idx >= len(tracks):
        idx = 0
    chosen = tracks[idx]
    if not isinstance(chosen, dict):
        return None
    return _audio_lang_from_track_id(
        chosen.get("audioTrackId") if isinstance(chosen.get("audioTrackId"), str) else None
    )


def _audio_lang_from_player(player: dict) -> str | None:
    """Extract default audio language for track preference only."""
    from_cap = _audio_lang_from_captions_renderer(_captions_renderer(player))
    if from_cap:
        return from_cap
    for key in ("defaultAudioLanguage", "defaultLanguage"):
        val = player.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip().lower()
    micro = player.get("microformat")
    if isinstance(micro, dict):
        renderer = micro.get("playerMicroformatRenderer")
        if isinstance(renderer, dict):
            for key in ("defaultAudioLanguage", "defaultLanguage"):
                val = renderer.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip().lower()
    return None


def _tracks_from_innertube(
    client: httpx.Client, video_id: str, api_key: str | None = None
) -> tuple[list[dict], dict | None, str | None]:
    url = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
    if api_key:
        url = f"https://www.youtube.com/youtubei/v1/player?key={api_key}"
    res = client.post(
        url,
        json={"context": _INNERTUBE_CONTEXT, "videoId": video_id},
    )
    if res.status_code >= 400:
        return [], None, None
    try:
        data = res.json()
    except json.JSONDecodeError:
        return [], None, None
    playability = (
        data.get("playabilityStatus")
        if isinstance(data.get("playabilityStatus"), dict)
        else None
    )
    preferred = _audio_lang_from_player(data)
    cap_renderer = _captions_renderer(data)
    tracks = (cap_renderer or {}).get("captionTracks") or []
    if not isinstance(tracks, list):
        tracks = []
    return [t for t in tracks if isinstance(t, dict)], playability, preferred


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


def _lang_base(code: str) -> str:
    return (code or "").strip().lower().split("-", 1)[0]


def _track_score(t: dict, *, preferred_audio: str | None = None) -> tuple[int, int, int]:
    """Higher is better: (1) match preferred audio lang, (2) lang pref, (3) manual > asr.

    Language match outranks manual/asr so we never pick Russian manual over English ASR
    when the preferred/original language is English.
    """
    lang = track_language_code(t)
    lang_base = _lang_base(lang)
    pref_base = _lang_base(preferred_audio or "")

    audio_match = 0
    if pref_base and lang_base and (
        lang_base == pref_base or lang.startswith(pref_base) or pref_base.startswith(lang_base)
    ):
        audio_match = 1_000_000

    lang_rank = 0
    for i, code in enumerate(_PREF_LANGS):
        if lang_base == code or lang.startswith(code):
            lang_rank = 10_000 - i * 100
            break

    manual_bonus = 10 if not track_is_asr(t) else 0
    return (audio_match, lang_rank, manual_bonus)


def _order_tracks(
    tracks: list[dict], *, preferred_audio: str | None = None
) -> list[dict]:
    return sorted(
        tracks,
        key=lambda t: _track_score(t, preferred_audio=preferred_audio),
        reverse=True,
    )


def _pick_track(tracks: list[dict], *, preferred_audio: str | None = None) -> dict:
    return max(tracks, key=lambda t: _track_score(t, preferred_audio=preferred_audio))
