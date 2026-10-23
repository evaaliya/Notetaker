# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-10-23 08:05 +06.

## Этапы

| Этап | Статус | Что проверено |
|---|---|---|
| M0 Скелет | готов | `docker compose up --build`; `/api/health` → ok + worker; register/login/me; pytest 6 passed (testcontainers) |
| M1 Заметки/теги/корзина/список | готов | T20 `test_tags_crud_and_multi`; T17 server `test_list_search_filters` / `test_list_keyset_pagination`; `perf_*_10k` — M6; `make test` → 12 passed; curl tags/notes/list/me |
| M2 Календарь и «Ближайшее» | готов | `test_calendar_range_singles`, `test_upcoming_buckets`; `make test` → 14 passed; curl `/calendar`, `/upcoming`; UI-смоки (см. ниже) |
| M3 Воркер напоминаний + outbox | не начат | — |
| M4 Realtime | не начат | — |
| M5 Повторы | не начат | — |
| M6 Нагрузка и verify | не начат | — |

## Работает
- `docker compose up --build` поднимает postgres, mailhog, api, worker, web.
- Миграции Alembic применяются при старте api/worker (схема §3 + `worker_heartbeat`).
- Auth: `POST /api/auth/register|login|logout`, opaque-сессия в httpOnly cookie (argon2).
- `GET/PATCH /api/me` (email, IANA timezone).
- `GET /api/health` — БД + heartbeat воркера.
- Теги: `GET/POST/PATCH/DELETE /api/tags`, цвет `#RRGGBB`, уникальность имени без регистра через `name_lower` (`set_tag_name`).
- Заметки: create/get/patch/delete, activate/deactivate, trash/restore; PATCH с `version` → `409` + актуальная `note`.
- Список: `GET /api/notes` — `q`, теги (any/all), status, период (from/to), sort/dir, keyset (cursor/limit).
- `GET /api/calendar?from=&to=` — вхождения `{occurrence_start, note}` для одиночных (`rec_freq IS NULL`), не в корзине (D-017).
- `GET /api/upcoming` — бакеты `today` / `week` / `past` по `Clock` + TZ пользователя; past только `active` (D-018).
- Web: Календарь (FullCalendar 6: месяц/неделя/день, клик → боковая панель, DnD → PATCH с `version` и сохранением wall-time), «Ближайшее» (три секции), Список, Теги, Корзина, Настройки; время через `Intl` + `user.timezone`.
- Тесты: `make test` → 14 passed на реальном Postgres (testcontainers).

### UI-смоки M2 (2026-10-23)
**Автоматически (pytest + curl после `docker compose up --build`):**
- `test_calendar_range_singles` — диапазон, исключение серии/корзины, `from < to`.
- `test_upcoming_buckets` — today/week/past через FrozenClock (без sleep).
- curl: `/api/calendar?from=…&to=…` → items; `/api/upcoming` → today/week/past; PATCH `starts_at` с version.

**Вручную в браузере (localhost:5173, пользователь `m2ui`):**
- Регистрация → редирект на `/calendar`, месяц октябрь 2026, переключатели Месяц/Неделя/День.
- Создана заметка «Smoke event» 2026-10-23 14:30 UTC → видна в календаре (`.fc-event`).
- Клик по событию открывает боковую панель с полями и `version`-сохранением.
- `/upcoming`: «Сегодня (1)» содержит Smoke event; «Неделя» / «Прошедшие» пусты для этого кейса.
- Перетаскивание в UI: путь кода `relocateKeepWallTime` → PATCH; полный drag в браузерной автоматизации не гоняли (проверить руками при желании).

## Не работает
- Materialization reminders, outbox, purge корзины — M3 (`TODO(spec-gap)` в create/patch).
- WS / `pg_notify` / конфликт-диалог / `useNow` live-переход в «прошедшие» — M4 (API 409 уже есть).
- Генерация вхождений / overrides / split серии — M5 (поля `rec_freq` сохраняются; в календаре/upcoming серии пока скрыты).
- Нагрузка 10k (`perf_list_10k` / `perf_search_10k` с сидом и порогами §8), `e2e_scroll_10k`, `make verify` — M6.

## Не делали и почему
- Логика воркера (reminders/outbox/materializer/purge) — этап M3; heartbeat есть с M0 (`TODO(spec-gap)`).
- `useNow` и live-переход заметок в «прошедшие» без reload — M4 (T16).
- Раскрытие повторов в `/calendar` и `/upcoming` — M5.
- `make seed` / demo / Playwright / `make verify` — M6 (и e2e с M4+).
- 10k seed и perf-пороги — критерий M6.
- См. «Известные ограничения» ниже (из спеки).

## Известные ограничения
- Интервал повтора только 1; нет «по дням недели» и «последняя пятница».
- Фильтр по периоду для серий приближённый (по пересечению диапазона): возможны ложные попадания в узкий период.
- Удаление отдельного вхождения серии не попадает в корзину.
- Email: «ровно одно» гарантировано на уровне записей; при падении между SMTP и пометкой `sent` возможен дубль (at-least-once). Снижение риска: фиксированный `Message-ID`.
- Нет пересинхронизации по журналу событий — после реконнекта WS полная инвалидация.
- Горизонт материализации напоминаний серий — 60 дней, продлевается воркером раз в час и при старте.
- Нет rate-limit, сброса пароля, подтверждения email.
- «Неделя» в `/upcoming` — скользящее окно `[завтра, сегодня+7d)`, не ISO-неделя Пн–Вс (D-018).

## Следующий заход
- Web Push / Service Worker.
- Интервал повтора и сложные правила («каждый второй вторник»).
- ICS-экспорт/импорт и подписка на календарь.
- Журнал событий с курсором для точного догона после обрыва WS.
- Полнотекстовый поиск со стеммингом.
- Шаринг заметок, rate-limit, подтверждение email.
