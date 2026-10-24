#!/usr/bin/env python3
"""Build reports/verify-<ts>.md mapping T1–T21 to pytest/Playwright results."""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

# Spec §10: each behaviour → required test name(s).
T_CASES: list[tuple[str, str, list[str]]] = [
    ("T1", "Письмо ровно одно на напоминание", ["test_reminder_single_email_with_two_workers"]),
    ("T2", "In-app toast во всех вкладках одновременно", ["e2e_toast_in_two_tabs"]),
    ("T3", "Не всплывает снова после reload", ["e2e_toast_not_repeated_after_reload"]),
    ("T4", "Неактивная не напоминает", ["test_inactive_note_no_reminder"]),
    (
        "T5",
        "Активация до срока / после срока",
        ["test_reactivate_before_due", "test_reactivate_after_due_no_backfill"],
    ),
    (
        "T6",
        "Смена времени/интервала переносит",
        ["test_reschedule_moves_reminders", "test_sent_not_resent_on_edit"],
    ),
    (
        "T7",
        "Удаление отменяет, восстановление возвращает будущие",
        ["test_delete_cancels", "test_restore_returns_future_only"],
    ),
    ("T8", "Корзина чистится через 30 дней", ["test_trash_purge_30d"]),
    ("T9", "Повтор: напоминание на каждое вхождение", ["test_series_reminder_each_occurrence"]),
    ("T10", "«Начиная с этого дня» не трогает прошлое", ["test_split_series_keeps_past"]),
    ("T11", "Правка/удаление одного вхождения", ["test_override_single_occurrence"]),
    ("T12", "31-е → последний день месяца", ["test_monthly_clamp"]),
    ("T13", "Синхронизация двух вкладок без reload", ["e2e_edit_in_tab_a_visible_in_tab_b"]),
    ("T14", "Конфликт правок не теряется молча", ["test_concurrent_patch_409", "e2e_conflict_dialog"]),
    ("T15", "Смена пояса не двигает срабатывание", ["test_timezone_change_keeps_fire_at"]),
    ("T16", "«Прошедшие» без reload", ["e2e_upcoming_moves_to_past_live"]),
    (
        "T17",
        "Поиск/фильтры по всем записям; 10k заметок",
        ["perf_list_10k", "perf_search_10k", "e2e_scroll_10k", "test_list_search_filters", "test_list_keyset_pagination"],
    ),
    ("T18", "Рестарт не теряет данные и напоминания", ["test_restart_keeps_pending"]),
    (
        "T19",
        "Политика простоя",
        ["test_downtime_future_sent_late", "test_downtime_past_marked_missed"],
    ),
    ("T20", "Несколько тегов, CRUD, цвет", ["test_tags_crud_and_multi"]),
    ("T21", "Две вкладки одновременно", ["e2e_toast_in_two_tabs", "e2e_edit_in_tab_a_visible_in_tab_b", "e2e_conflict_dialog"]),
]


def _parse_junit(path: Path) -> dict[str, str]:
    """Map short test name → passed|failed|error|skipped."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    root = ET.parse(path).getroot()
    for case in root.iter("testcase"):
        name = case.attrib.get("name", "")
        # strip parametrize suffix [..]
        short = name.split("[", 1)[0]
        status = "passed"
        if case.find("failure") is not None:
            status = "failed"
        elif case.find("error") is not None:
            status = "error"
        elif case.find("skipped") is not None:
            status = "skipped"
        out[short] = status
    return out


def _parse_playwright(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    data = json.loads(path.read_text(encoding="utf-8"))
    suites = data.get("suites") or []

    def walk(suite: dict) -> None:
        for spec in suite.get("specs") or []:
            title = spec.get("title") or ""
            short = title.split("[", 1)[0]
            ok = bool(spec.get("ok"))
            # prefer detailed test results if present
            tests = spec.get("tests") or []
            if tests:
                statuses = [t.get("status") for t in tests]
                if any(s == "unexpected" or s == "failed" for s in statuses):
                    out[short] = "failed"
                elif all(s in ("expected", "passed", "skipped") for s in statuses):
                    out[short] = "skipped" if all(s == "skipped" for s in statuses) else "passed"
                else:
                    out[short] = "passed" if ok else "failed"
            else:
                out[short] = "passed" if ok else "failed"
        for child in suite.get("suites") or []:
            walk(child)

    for s in suites:
        walk(s)
    return out


def _status_for(names: list[str], results: dict[str, str]) -> tuple[str, list[str]]:
    lines: list[str] = []
    overall = "ok"
    missing = False
    for n in names:
        st = results.get(n)
        if st is None:
            lines.append(f"`{n}` — **нет в прогоне**")
            missing = True
            overall = "gap"
        elif st == "passed":
            lines.append(f"`{n}` — passed")
        else:
            lines.append(f"`{n}` — **{st}**")
            overall = "fail"
    if missing and overall == "ok":
        overall = "gap"
    return overall, lines


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--junit", type=Path, required=True)
    ap.add_argument("--playwright", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--pytest-rc", type=int, default=0)
    ap.add_argument("--e2e-rc", type=int, default=0)
    args = ap.parse_args()

    pytest_map = _parse_junit(args.junit)
    pw_map = _parse_playwright(args.playwright)
    combined = {**pytest_map, **pw_map}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# verify {args.out.stem}",
        "",
        f"Сгенерировано: {ts}",
        f"pytest exit: {args.pytest_rc}; playwright exit: {args.e2e_rc}",
        "",
        "| # | Требование | Результат | Тесты |",
        "|---|---|---|---|",
    ]
    summary_ok = 0
    summary_fail = 0
    summary_gap = 0
    detail_blocks: list[str] = []

    for tid, title, names in T_CASES:
        overall, detail = _status_for(names, combined)
        if overall == "ok":
            summary_ok += 1
            badge = "закрыто"
        elif overall == "fail":
            summary_fail += 1
            badge = "упало"
        else:
            summary_gap += 1
            badge = "пробел"
        detail_md = "<br>".join(detail)
        lines.append(f"| {tid} | {title} | {badge} | {detail_md} |")
        detail_blocks.append(f"### {tid} — {title}\n\n" + "\n".join(f"- {d}" for d in detail) + "\n")

    lines.extend(
        [
            "",
            f"**Итого:** закрыто {summary_ok}, упало {summary_fail}, пробел {summary_gap} из {len(T_CASES)}.",
            "",
            "## Детали",
            "",
        ]
    )
    lines.extend(detail_blocks)

    # Orphan failures not in the T table
    known = {n for _, _, names in T_CASES for n in names}
    extras = sorted(
        f"`{n}` — {st}" for n, st in combined.items() if n not in known and st != "passed"
    )
    if extras:
        lines.append("## Прочие упавшие / пропущенные (вне T1–T21)\n")
        lines.extend(f"- {e}" for e in extras)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
