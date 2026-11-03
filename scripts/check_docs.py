#!/usr/bin/env python3
"""Проверка синхронизации STATUS.md и docs/DECISIONS.md (M24)."""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUS = ROOT / "STATUS.md"
DECISIONS = ROOT / "docs" / "DECISIONS.md"

D_RE = re.compile(r"\bD-(\d+)\b")
STATUS_UPDATED_RE = re.compile(
    r"Последнее обновление:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*(\+\d{2}|[A-Z]{2,4})?"
)
DECISION_HEADER_RE = re.compile(
    r"^###\s+D-(\d+)\s·\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(\S+)",
    re.M,
)


def fail(msg: str) -> None:
    print(f"docs-check FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def max_d(text: str) -> int | None:
    nums = [int(n) for n in D_RE.findall(text)]
    return max(nums) if nums else None


def parse_status_updated(text: str) -> datetime:
    m = STATUS_UPDATED_RE.search(text)
    if not m:
        fail("в STATUS.md нет строки «Последнее обновление: YYYY-MM-DD HH:MM …»")
    return datetime.strptime(m.group(1), "%Y-%m-%d %H:%M")


def last_decision_meta(text: str) -> tuple[int, datetime]:
    matches = list(DECISION_HEADER_RE.finditer(text))
    if not matches:
        fail("в DECISIONS.md нет заголовков вида «### D-NNN · YYYY-MM-DD HH:MM TZ»")
    last = matches[-1]
    return int(last.group(1)), datetime.strptime(last.group(2), "%Y-%m-%d %H:%M")


def main() -> None:
    if not STATUS.is_file():
        fail(f"нет файла {STATUS}")
    if not DECISIONS.is_file():
        fail(f"нет файла {DECISIONS}")

    status_text = STATUS.read_text(encoding="utf-8")
    decisions_text = DECISIONS.read_text(encoding="utf-8")

    d_last, d_when = last_decision_meta(decisions_text)
    status_max = max_d(status_text)
    if status_max is None:
        fail("в STATUS.md нет упоминаний D-NNN")
    if status_max != d_last:
        fail(
            f"последний D в STATUS.md = D-{status_max:03d}, "
            f"в DECISIONS.md = D-{d_last:03d} (должны совпадать)"
        )

    status_when = parse_status_updated(status_text)
    if status_when < d_when:
        fail(
            f"дата STATUS ({status_when:%Y-%m-%d %H:%M}) старше "
            f"последнего решения D-{d_last:03d} ({d_when:%Y-%m-%d %H:%M})"
        )

    print(
        f"docs-check OK: D-{d_last:03d} "
        f"(DECISIONS {d_when:%Y-%m-%d %H:%M}, STATUS {status_when:%Y-%m-%d %H:%M})"
    )


if __name__ == "__main__":
    main()
