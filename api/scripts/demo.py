#!/usr/bin/env python3
"""Live demo: note with «за 10 минут» so toast/MailHog arrive in ~2 minutes.

Creates starts_at = now+12m and reminder_offsets=[10] → fire_at ≈ now+2m.

Usage (stack up):
  docker compose exec api python scripts/demo.py
  DEMO_API=http://127.0.0.1:8000 python api/scripts/demo.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

API = os.environ.get("DEMO_API", "http://127.0.0.1:8000").rstrip("/")
LOGIN = os.environ.get("DEMO_LOGIN", "demo")
PASSWORD = os.environ.get("DEMO_PASSWORD", "demo")
EMAIL = os.environ.get("DEMO_EMAIL", "demo@example.com")


class ApiError(Exception):
    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


class Api:
    def __init__(self, base: str) -> None:
        self.base = base
        self.cookie: str | None = None

    def request(self, method: str, path: str, body: dict | None = None) -> dict | list | None:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        req = urllib.request.Request(
            f"{self.base}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw_cookie = resp.headers.get("Set-Cookie")
                if raw_cookie:
                    self.cookie = raw_cookie.split(";", 1)[0]
                raw = resp.read()
                if not raw:
                    return None
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ApiError(exc.code, detail) from exc

    def ensure_user(self) -> None:
        try:
            self.request("POST", "/api/auth/register", {"login": LOGIN, "password": PASSWORD})
            print(f"registered user {LOGIN!r}")
        except ApiError as exc:
            if exc.status != 409:
                raise
            self.cookie = None
            self.request("POST", "/api/auth/login", {"login": LOGIN, "password": PASSWORD})
            print(f"logged in as {LOGIN!r}")


def main() -> None:
    api = Api(API)
    api.ensure_user()
    api.request("PATCH", "/api/me", {"email": EMAIL, "timezone": "UTC"})

    now = datetime.now(timezone.utc)
    starts = now + timedelta(minutes=12)
    title = f"Demo {starts.strftime('%H:%M')} UTC"
    note = api.request(
        "POST",
        "/api/notes",
        {
            "title": title,
            "body": "Откройте две вкладки — через ~2 минуты будет toast и письмо в MailHog.",
            "starts_at": starts.isoformat().replace("+00:00", "Z"),
            "reminder_offsets": [10],
            "tag_ids": [],
        },
    )
    assert isinstance(note, dict)
    print("created note:")
    print(f"  id:     {note['id']}")
    print(f"  title:  {note['title']}")
    print(f"  starts: {note['starts_at']}")
    print(f"  offsets:{note['reminder_offsets']}")
    print()
    print("Ожидайте ~2 минуты (воркер тикает каждую секунду):")
    print("  • toast во всех открытых вкладках → http://localhost:5173")
    print("  • письмо в MailHog → http://localhost:8025")
    print(f"  • получатель: {EMAIL}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        print(f"API недоступен ({API}): {exc}", file=sys.stderr)
        sys.exit(1)
    except ApiError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
