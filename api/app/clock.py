from datetime import datetime, timezone
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class FrozenClock:
    """Test clock: advance explicitly, never sleep."""

    def __init__(self, instant: datetime) -> None:
        if instant.tzinfo is None:
            raise ValueError("Clock requires timezone-aware datetime (UTC)")
        self._now = instant.astimezone(timezone.utc)

    def now(self) -> datetime:
        return self._now

    def set(self, instant: datetime) -> None:
        if instant.tzinfo is None:
            raise ValueError("Clock requires timezone-aware datetime (UTC)")
        self._now = instant.astimezone(timezone.utc)

    def advance(self, **kwargs) -> datetime:
        from datetime import timedelta

        self._now = self._now + timedelta(**kwargs)
        return self._now
