# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-11-04 19:25 +06.

Подробные смоки прошлых этапов — [`docs/HISTORY.md`](docs/HISTORY.md). Последнее решение в логе: **D-138** (README stub/изоляция/volume; fresh-check→MailHog; также D-136/137).

## Этапы

| Этап | Статус | Что проверено |
|---|---|---|
| M0 Скелет | готов | compose, health, auth, pytest testcontainers |
| M1 Заметки/теги/корзина/список | готов | T20, list search/keyset |
| M2 Календарь и «Ближайшее» | готов | calendar/upcoming + UI |
| M3 Воркер + outbox | готов | T1, T4–T8, T18–T19, MailHog |
| M4 Realtime | готов | T2/T3/T13–T16 + e2e |
| M5 Повторы | готов | T9–T12 |
| M6 Нагрузка и verify | готов | T17 perf, T1–T21 закрыто |
| M7 / M7.fix Интерфейс | готов | токены, сайдбар, mobile; luxon TZ |
| M8.2 Список и страница заметки | готов | layout e2e, `/notes/new|:id` |
| M9 Вложения | готов | upload/413/415/404/purge + autosave |
| M10 Общие заметки | готов | share/ACL/realtime + e2e два контекста |
| M11 / M11.1 Звонки и видео | готов | stub/OpenRouter, captions; e2e стабилизация |
| M12 Тесты YouTube | готов | `test_youtube_*` / `e2e_youtube_*` |
| M13 UI Polish | готов | mid-width, mobile calendar |
| M14 Сеть/гонки | готов | extract jobs, timeouts, cancel |
| M15 Вёрстка/рендеринг | готов | layout + editor; chromium/ff/wk |
| M16 Персональные теги / календарь | готов | `note_user_tags`, `show_in_calendar` |
| M17 Календарь плотность | готов | месяц+таймлайн week/day |
| M18 Адаптивность списка | готов | truncate, virtualizer, month clamp |
| M19 Annotate-driven UI | готов | D-105–114 (bell, extract session, EN/RU, share) |
| M20 Экспорт сессии Annotate | готов | docs/sessions (без кода продукта) |
| M21 Extract без спиннера | готов | config/preflight, TTL, UI poll |
| M22 Офлайн create/правка | готов | client UUID, outbox IDB |
| M23 Антидрожание UI | готов | gutter, RO-guard, WS backoff |
| M24 Документация | готов | README/TESTING/HISTORY; `make docs-check`; D-124–126 |
| M25 Список период + DnD календаря | готов | UI from/to+reset; DnD month/week/day+trash; create `/notes/new`; ghost clone; release-on-window D-128–132 |
| M26 Touch / LAN open | готов | safeRandomUUID (H3); long-press tap (H1); CDP touch e2e D-133–134 |
| M27 Изоляция / сдача | готов | compose-порты, `make fresh-check`, D-135; `make verify` 2026-11-04 |

## Работает

- Стек: `docker compose up --build` — postgres, mailhog, api, worker, web; миграции при старте. Порты/имя проекта — из `.env` (изоляция второй копии — README).
- Auth (cookie/argon2), заметки/теги/корзина, список (search/keyset/**период from–to**), календарь, «Ближайшее», повторы, reminders+outbox, realtime WS, уведомления.
- UI по `docs/FRONTEND.md`: сайдбар, список/календарь/upcoming/tags/trash/settings, страница заметки, mobile ≤640.
- **M25:** фильтр периода; DnD month/week/day; mobile create → `/notes/new`.
- **M26:** insecure LAN UUID; long-press без move открывает карточку.
- M9–M23: вложения; share; звонки/видео/YouTube; extract jobs; офлайн-очередь; антидрожание.
- **Счётчики collect:** pytest **128**; Playwright chromium ориентир **112** / все проекты **~134** (+2 e2e D-137).
- **Регрессия после D-136–138 (2026-11-04 19:25 +06):** `make docs-check` OK; `make test` → **128 passed** (0 failed); `make fresh-check` OK (notes=0 → register → note → MailHog). E2e (chromium, корзина/reminders/tz/create): timezone + m26 + autosave + offline + m7_ui (**22 passed**); reminder_ui + alarm + realtime + m15_editor (**13 passed** после повторного прогона `e2e_reminder_from_ui_toast_and_mail` — первый раз 0 из‑за api без E2E_HOOKS). Полный `make e2e` / verify в этом заходе не гоняли. Старый полный отчёт: [`reports/verify-20261104-172913.md`](reports/verify-20261104-172913.md).
- **D-136:** restore — overdue skipped + prune offsets.
- **D-137:** phone/LAN create — RFC-4122 UUID; 422 detail в UI.
- **D-138:** README stub/изоляция/volume; fresh-check→MailHog.
- `e2e_week_many_notes_in_slot`: стабилизирован (toggle overflow вместо Escape; 5/5 rerun). `e2e_scroll_10k` — passed.

## Не реализовано (явные пробелы / TODO)

- **«Удалить навсегда» в корзине** — нет API/кнопки; только автоpurge через 30 дней (`TODO(spec-gap)` в `TrashPage.tsx`).
- **Calendar / QuickAdd create в офлайн-очереди** — без client id не ставится в IDB outbox (`TODO(spec-gap)`, D-120); основной create — `/notes/new`.
- **LISTEN `reminders_changed`** — NOTIFY шлётся, воркер только poll (D-135; отступление от spec §4.4).

## Не делали и почему

- Запись звука на сервере / Zoom-бот — вне M11.
- Напоминания участникам общих заметок — v1 только владелец (D-058).
- Счётчики заметок у тегов в API — нет `note_count` (D-039).
- Генерация картинок / Web Push — вне объёма.
- CI/GitHub Actions — вне M24 (по задаче).
- URL-persistence фильтров списка — не делали (сброс при reload; D-128).
- Реальный телефон на LAN в M26 не гоняли вручную — покрытие симуляцией insecure + CDP touch.

## Известные ограничения

- Интервал повтора только 1; нет «по дням недели» / «последняя пятница».
- Фильтр периода для серий приближённый (возможны ложные попадания).
- Удаление вхождения серии не в корзину.
- Email at-least-once; риск дубля снижен фиксированным Message-ID.
- После реконнекта WS — полная инвалидация (не журнал событий).
- Горизонт напоминаний серий — 60 дней.
- Seed 10k не материализует reminders.
- Нет rate-limit, сброса пароля, подтверждения email.
- «Неделя» в `/upcoming` — скользящее окно, не ISO (D-018).
- YouTube: без captions разбор невозможен; нужен доступ api→youtube.com; id регистрозависим.
- E2E_HOOKS только на время `make e2e` / `make verify`.
- Calendar DnD e2e trash/relocate на mobile viewport по-прежнему mouse path; open/suppress touch — CDP в `m26_mobile_open` (D-134).

## Расширения сверх брифа

| Этап | Что | Статус |
|---|---|---|
| M9 | Вложения + autosave IDB | готов |
| M10 | Общие заметки | готов |
| M11–M12 | Звонки/видео + тесты YouTube | готов |
| M13–M15 | UI polish, сеть/гонки, вёрстка | готов |
| M16–M19 | Теги/календарь, плотность, адаптив, annotate | готов |
| M21–M23 | Extract TTL, офлайн, антидрожание | готов |
| M24 | Документация + docs-check | готов |
| M25 | Период списка + DnD всех видов | готов |
| M26 | Touch open + insecure LAN UUID | готов |
| M27 | Изоляция стека / сдача docs + verify | готов |

## Экспорты сессий (`docs/sessions/`)

Есть файлы для M0–M7, M7.1–M7.3, M8, M9–M26 (включая M11.1, M20; M25 — `cursor_m25_notetaker_functional_requirement.md`; M26 — `cursor_m26_mobile_notes_opening_issue.md`).  
**Нет отдельного экспорта с именем этапа:** M7.fix, M8.2 (близкие чаты — `m7_*` / `m8_*`).

## Следующий заход

1. Ручная проверка на реальном телефоне по LAN.
2. Вне объёма: Web Push; сложные правила повтора; ICS; журнал WS; FTS; напоминания участникам; rate-limit / подтверждение email; опционально LISTEN на `reminders_changed` (D-135).
