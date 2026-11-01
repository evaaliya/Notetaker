"""M14 step-0 diagnostics: real timings for captions + OpenRouter (no refactor).

Run inside api container:
  python scripts/m14_diag_timings.py [youtube_id_or_url]
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from datetime import datetime, timezone
from typing import Any

import httpx

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "Ok6QdZHCcI8"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def log(msg: str) -> None:
    print(f"[{_now()}] {msg}", flush=True)


class TimingTransport(httpx.BaseTransport):
    """Wrap default transport; log every request duration."""

    def __init__(self) -> None:
        self._inner = httpx.HTTPTransport()
        self.calls: list[dict[str, Any]] = []

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        short = url[:120]
        t0 = time.perf_counter()
        log(f"HTTP → {request.method} {short}")
        try:
            resp = self._inner.handle_request(request)
        except Exception as exc:
            dt = time.perf_counter() - t0
            self.calls.append(
                {"method": request.method, "url": short, "sec": round(dt, 3), "error": type(exc).__name__}
            )
            log(f"HTTP ✗ {request.method} {short}  {dt:.3f}s  {type(exc).__name__}: {exc}")
            raise
        dt = time.perf_counter() - t0
        # Streaming responses need an explicit read before .content.
        try:
            resp.read()
            nbytes = len(resp.content)
        except Exception:
            nbytes = None
        self.calls.append(
            {
                "method": request.method,
                "url": short,
                "sec": round(dt, 3),
                "status": resp.status_code,
                "bytes": nbytes,
            }
        )
        log(f"HTTP ← {resp.status_code} {short}  {dt:.3f}s  bytes={nbytes}")
        return resp


def measure_captions(video: str) -> tuple[str, str, float, list[dict]]:
    from app.services.youtube_captions import fetch_youtube_captions

    transport = TimingTransport()
    # Patch httpx.Client used inside fetch: wrap by monkeypatching Client.__init__ is heavy;
    # instead re-implement timing around the public call + patch module-level Client.
    orig_client = httpx.Client

    def timed_client(*args, **kwargs):
        kwargs = dict(kwargs)
        kwargs["transport"] = transport
        # keep caller timeout
        return orig_client(*args, **kwargs)

    httpx.Client = timed_client  # type: ignore[misc]
    try:
        t0 = time.perf_counter()
        text, lang = fetch_youtube_captions(video, timeout=30.0)
        dt = time.perf_counter() - t0
        log(f"captions DONE lang={lang} chars={len(text)} total={dt:.3f}s")
        return text, lang, dt, list(transport.calls)
    finally:
        httpx.Client = orig_client  # type: ignore[misc]


def measure_openrouter(text: str, *, label: str) -> tuple[float, list[float], Any]:
    from app.config import get_settings
    from app.services.ai.openrouter import OpenRouterProvider

    s = get_settings()
    provider = OpenRouterProvider(api_key=s.openrouter_api_key or "", model=s.openrouter_model)
    chat_secs: list[float] = []
    orig_chat = provider._chat

    def timed_chat(payload: dict) -> str:
        t0 = time.perf_counter()
        log(f"OpenRouter._chat START model={s.openrouter_model} label={label}")
        try:
            out = orig_chat(payload)
        except Exception as exc:
            dt = time.perf_counter() - t0
            chat_secs.append(dt)
            log(f"OpenRouter._chat FAIL {dt:.3f}s: {type(exc).__name__}: {exc}")
            raise
        dt = time.perf_counter() - t0
        chat_secs.append(dt)
        log(f"OpenRouter._chat OK {dt:.3f}s content_chars={len(out)}")
        return out

    provider._chat = timed_chat  # type: ignore[method-assign]
    t0 = time.perf_counter()
    result = provider.extract(text, now=datetime.now(timezone.utc), timezone="UTC")
    dt = time.perf_counter() - t0
    log(
        f"extract DONE label={label} total={dt:.3f}s chat_calls={len(chat_secs)} "
        f"chat_secs={[round(x, 3) for x in chat_secs]} "
        f"summary={'yes' if result.summary else 'no'} "
        f"summary_ru={'yes' if result.summary_ru else 'no'} "
        f"drafts={len(result.drafts)} source_lang={result.source_lang}"
    )
    return dt, chat_secs, result


def main() -> int:
    from app.config import get_settings

    s = get_settings()
    log("=== M14 diag start ===")
    log(f"video={VIDEO}")
    log(f"ai_provider={s.ai_provider} model={s.openrouter_model} key_set={bool(s.openrouter_api_key)}")
    log(
        "configured timeouts: youtube_captions default=30.0s (per httpx request); "
        "OpenRouter _chat httpx.Client(timeout=90.0); "
        "browser fetch: none; vite proxy: none"
    )

    summary: dict[str, Any] = {"video": VIDEO, "runs": []}

    # --- Pass 1: captions ---
    log("--- PASS 1: fetch_youtube_captions ---")
    try:
        text, lang, cap_dt, cap_calls = measure_captions(VIDEO)
        cap_ok = True
        cap_err = None
    except Exception as exc:
        text, lang, cap_dt, cap_calls = "", "?", 0.0, []
        cap_ok = False
        cap_err = f"{type(exc).__name__}: {exc}"
        log(f"captions FAIL: {cap_err}")
        traceback.print_exc()

    summary["pass1_captions"] = {
        "ok": cap_ok,
        "sec": round(cap_dt, 3) if cap_ok else None,
        "lang": lang if cap_ok else None,
        "chars": len(text) if cap_ok else 0,
        "http_calls": cap_calls,
        "error": cap_err,
    }

    if not cap_ok:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 1

    # --- Pass 1: model ---
    log("--- PASS 1: OpenRouter extract (full captions text) ---")
    try:
        model_dt, chat_secs, _ = measure_openrouter(text, label="pass1")
        model_ok = True
        model_err = None
    except Exception as exc:
        model_dt, chat_secs = 0.0, []
        model_ok = False
        model_err = f"{type(exc).__name__}: {exc}"
        log(f"model FAIL: {model_err}")
        traceback.print_exc()

    summary["pass1_model"] = {
        "ok": model_ok,
        "sec": round(model_dt, 3) if model_ok else None,
        "chat_secs": [round(x, 3) for x in chat_secs],
        "error": model_err,
    }

    # --- Pass 2: captions again (cache? warm DNS?) ---
    log("--- PASS 2: fetch_youtube_captions (same video) ---")
    try:
        text2, lang2, cap_dt2, cap_calls2 = measure_captions(VIDEO)
        summary["pass2_captions"] = {
            "ok": True,
            "sec": round(cap_dt2, 3),
            "lang": lang2,
            "chars": len(text2),
            "http_calls": cap_calls2,
            "same_text": text2 == text,
        }
    except Exception as exc:
        summary["pass2_captions"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        log(f"pass2 captions FAIL: {exc}")

    # --- Pass 2: model again ---
    log("--- PASS 2: OpenRouter extract (same text) ---")
    try:
        model_dt2, chat_secs2, _ = measure_openrouter(text, label="pass2")
        summary["pass2_model"] = {
            "ok": True,
            "sec": round(model_dt2, 3),
            "chat_secs": [round(x, 3) for x in chat_secs2],
        }
    except Exception as exc:
        summary["pass2_model"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        log(f"pass2 model FAIL: {exc}")
        traceback.print_exc()

    # Totals as user would see from one sync /extract/youtube
    if summary.get("pass1_captions", {}).get("ok") and summary.get("pass1_model", {}).get("ok"):
        total1 = summary["pass1_captions"]["sec"] + summary["pass1_model"]["sec"]
        summary["pass1_end_to_end_estimate_sec"] = round(total1, 3)
    if summary.get("pass2_captions", {}).get("ok") and summary.get("pass2_model", {}).get("ok"):
        total2 = summary["pass2_captions"]["sec"] + summary["pass2_model"]["sec"]
        summary["pass2_end_to_end_estimate_sec"] = round(total2, 3)

    log("=== SUMMARY JSON ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
