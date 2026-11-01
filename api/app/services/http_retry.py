"""Transient HTTP retry with pause (M14)."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TypeVar

import httpx

T = TypeVar("T")

_TRANSIENT = (
    httpx.TimeoutException,
    httpx.ConnectError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.WriteError,
)


def call_with_retry(
    fn: Callable[[], T],
    *,
    retries: int = 1,
    pause_sec: float = 1.0,
    is_transient: Callable[[BaseException], bool] | None = None,
) -> T:
    """Run ``fn``; on transient failure retry once after pause."""
    attempts = max(0, retries) + 1
    last: BaseException | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — classify below
            last = exc
            transient = is_transient(exc) if is_transient else isinstance(exc, _TRANSIENT)
            if not transient or i >= attempts - 1:
                raise
            time.sleep(pause_sec)
    assert last is not None
    raise last


def remaining_timeout(deadline: float, *, floor: float = 0.05) -> float:
    """Seconds left until monotonic deadline."""
    left = deadline - time.monotonic()
    if left < floor:
        raise httpx.TimeoutException("wall-clock deadline exceeded")
    return left
