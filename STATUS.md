# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-10-23 07:47 +06.

## Этапы

| Этап | Статус | Что проверено |
|---|---|---|
| M0 Скелет | готов | `docker compose up --build`; `/api/health` → ok + worker; register/login/me; pytest 6 passed (testcontainers) |
| M1 Заметки/теги/корзина/список | готов | T20 `test_tags_crud_and_multi`; T17 server `test_list_search_filters` / `test_list_keyset_pagination`; `perf_*_10k` — M6; `make test` → 12 passed; curl tags/notes/list/me |
| M2 Календарь и «Ближайшее» | не начат | — |
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
- Web: экран входа/регистрации (http://localhost:5173).
- Теги: `GET/POST/PATCH/DELETE /api/tags`, цвет `#RRGGBB`, уникальность имени без регистра через `name_lower` (`set_tag_name`).
- Заметки: create/get/patch/delete, activate/deactivate, trash/restore; PATCH с `version` → `409` + актуальная `note`.
- Список: `GET /api/notes` — `q`, теги (any/all), status, период (from/to), sort/dir, keyset (cursor/limit).
- Web: экраны Список (виртуализация + infinite scroll), Теги, Корзина, Настройки; время через `Intl` + `user.timezone`.
- Тесты: `make test` → 12 passed на реальном Postgres (testcontainers).

## Не работает
- Календарь / «Ближайшее» — M2.
- Materialization reminders, outbox, purge корзины — M3 (`TODO(spec-gap)` в create/patch).
- WS / `pg_notify` / конфликт-диалог на клиенте — M4 (API 409 уже есть).
- Генерация вхождений / overrides / split серии — M5 (поля `rec_*` сохраняются).
- Нагрузка 10k (`perf_list_10k` / `perf_search_10k` с сидом и порогами §8), `e2e_scroll_10k`, `make verify` — M6.

## Не делали и почему
- Логика воркера (reminders/outbox/materializer/purge) — этап M3; heartbeat есть с M0 (`TODO(spec-gap)`).
- `make seed` / demo / Playwright / `make verify` — M6 (и e2e с M4+).
- 10k seed и perf-пороги — критерий M6 (`perf_list_10k` / `perf_search_10k`); в M1 T17 закрыт функционально (`test_list_search_filters`, `test_list_keyset_pagination`, см. D-016).
- Live-события при CRUD — M4.
- См. «Известные ограничения» ниже (из спеки).

## Известные ограничения
- Интервал повтора только 1; нет «по дням недели» и «последняя пятница».
- Фильтр по периоду для серий приближённый (по пересечению диапазона): возможны ложные попадания в узкий период.
- Удаление отдельного вхождения серии не попадает в корзину.
- Email: «ровно одно» гарантировано на уровне записей; при падении между SMTP и пометкой `sent` возможен дубль (at-least-once). Снижение риска: фиксированный `Message-ID`.
- Нет пересинхронизации по журналу событий — после реконнекта WS полная инвалидация.
- Горизонт материализации напоминаний серий — 60 дней, продлевается воркером раз в час и при старте.
- Нет rate-limit, сброса пароля, подтверждения email.

## Следующий заход
- Web Push / Service Worker.
- Интервал повтора и сложные правила («каждый второй вторник»).
- ICS-экспорт/импорт и подписка на календарь.
- Журнал событий с курсором для точного догона после обрыва WS.
- Полнотекстовый поиск со стеммингом.
- Шаринг заметок, rate-limit, подтверждение email.
