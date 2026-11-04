# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-11-04 14:20 +06.

Подробные смоки прошлых этапов — [`docs/HISTORY.md`](docs/HISTORY.md). Последнее решение в логе: **D-128** (период в списке + DnD во всех видах; также D-124–D-127).

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
| M25 Список период + DnD календаря | готов | UI from/to+reset; DnD month/week/day+trash mobile; e2e 8/8 chromium; D-128 |

## Работает

- Стек: `docker compose up --build` — postgres, mailhog, api, worker, web; миграции при старте.
- Auth (cookie/argon2), заметки/теги/корзина, список (search/keyset/**период from–to**), календарь, «Ближайшее», повторы, reminders+outbox, realtime WS, уведомления.
- UI по `docs/FRONTEND.md`: сайдбар, список/календарь/upcoming/tags/trash/settings, страница заметки, mobile ≤640.
- **M25:** фильтр периода в списке + сброс (сорт сохраняется); DnD relocate+trash в month/week/day на desktop и mobile viewport (touch: long-press в хуке).
- M9–M11: вложения; общие заметки; звонки/видео + YouTube captions (stub/OpenRouter).
- M14–M23: extract jobs; персональные теги / `show_in_calendar`; плотность календаря; адаптивность; annotate UI; extract timeouts; офлайн-очередь; антидрожание (D-121–123).
- **M24:** профессиональный README; `docs/TESTING.md`; сжатый STATUS + `docs/HISTORY.md`; `scripts/check_docs.py` / `make docs-check` в `make verify`.
- Тесты (факт M25, 2026-11-04): e2e `list_period` + `calendar_dnd` → **8 passed** (chromium); полный `make e2e` / `make test` в этом заходе не гонялись целиком.
- T1–T21 закрыты с M6; отчёты `reports/verify-*.md`.

## Не работает

- (пусто по объёму реализованных этапов M0–M25)

## Не делали и почему

- Запись звука на сервере / Zoom-бот — вне M11.
- Напоминания участникам общих заметок — v1 только владелец (D-058).
- LISTEN `reminders_changed` для немедленного тика — достаточно poll.
- Счётчики заметок у тегов в API — нет `note_count` (D-039).
- «Удалить навсегда» в корзине — нет endpoint (автоpurge 30д).
- Генерация картинок / Web Push — вне объёма.
- QuickAdd / calendar create без client id в офлайн-очереди — TODO(spec-gap), D-120.
- CI/GitHub Actions — вне M24 (по задаче).
- URL-persistence фильтров списка — не делали (сброс при reload; D-128).

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
- `e2e_week_many_notes_in_slot` иногда flaky (на повторном прогоне ок).
- E2E mobile DnD гоняет mouse path на узком viewport; ветка touch long-press покрыта кодом хука (D-128).

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

## Экспорты сессий (`docs/sessions/`)

Есть файлы для M0–M7, M7.1–M7.3, M8, M9–M24 (включая M11.1, M20).  
**Нет отдельного экспорта с именем этапа:** M7.fix, M8.2 (близкие чаты — `m7_*` / `m8_*`).  
**Ещё нет:** M25.

## Следующий заход

- Экспорт сессии M25 в `docs/sessions/`.
- При желании: полный `make verify`; стабилизация flake week-slot; URL-persistence фильтров.
- Вне объёма: Web Push; сложные правила повтора; ICS; журнал WS; FTS; напоминания участникам; rate-limit / подтверждение email.
