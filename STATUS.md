# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-10-24 12:39 +06.

## Этапы

| Этап | Статус | Что проверено |
|---|---|---|
| M0 Скелет | готов | `docker compose up --build`; `/api/health` → ok + worker; register/login/me; pytest 6 passed (testcontainers) |
| M1 Заметки/теги/корзина/список | готов | T20 `test_tags_crud_and_multi`; T17 server `test_list_search_filters` / `test_list_keyset_pagination`; `perf_*_10k` — M6; `make test` → 12 passed; curl tags/notes/list/me |
| M2 Календарь и «Ближайшее» | готов | `test_calendar_range_singles`, `test_upcoming_buckets`; `make test` → 14 passed; curl `/calendar`, `/upcoming`; UI-смоки (см. ниже) |
| M3 Воркер напоминаний + outbox | готов | T1, T4–T8, T18–T19 (`test_reminder_*`, `test_inactive_*`, `test_reactivate_*`, `test_reschedule_*`, `test_sent_*`, `test_delete_*`, `test_restore_*`, `test_trash_purge_30d`, `test_restart_*`, `test_downtime_*`); `make test` → 26 passed; MailHog smoke (см. ниже) |
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
- Тесты: `make test` → 26 passed на реальном Postgres (testcontainers).
- Напоминания (singles): материализация при create/patch (`fire_at = starts_at − offset`, без `fire_at <= now`); rebuild pending при смене времени/offsets; `sent` не трогаем (D-020).
- Воркер `tick(now)`: claim `FOR UPDATE SKIP LOCKED` (лимит 100); inactive/deleted → `skipped`; `occurrence_start < now` → `missed` (D-007); иначе `notifications` + `email_outbox` + `sent` + `pg_notify('notification.new')`.
- Outbox: SMTP (`smtplib`) вне транзакции; фиксированный `Message-ID = <{outbox_id}@notetaker.local>` (D-021); без email у пользователя — только in-app notification.
- Автоочистка корзины раз в час: `deleted_at < now − 30d` (D-022).

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

### Смоки M3 (2026-10-24)
**Автоматически:**
- `make test` → 26 passed (в т.ч. T1, T4–T8, T18–T19).
- MailHog: после create + `UPDATE reminders SET fire_at = now() - 1s` воркер отправил письмо; `curl http://localhost:8025/api/v2/messages` → `total: 1`, Subject `M3 MailHog smoke`, `Message-ID: <…@notetaker.local>`; reminder/outbox `status=sent`.

## Не работает
- WS / toast UI / конфликт-диалог / `useNow` live-переход в «прошедшие» — M4 (API 409 уже есть; воркер шлёт `pg_notify('notification.new')`).
- Генерация вхождений / overrides / split серии / материализация горизонта 60д для серий — M5 (поля `rec_freq` сохраняются; в календаре/upcoming серии пока скрыты; reminders для `rec_freq IS NOT NULL` не создаются).
- Нагрузка 10k (`perf_list_10k` / `perf_search_10k` с сидом и порогами §8), `e2e_scroll_10k`, `make verify` — M6.

## Не делали и почему
- LISTEN `reminders_changed` для немедленного тика — достаточно секундного poll; NOTIFY при rebuild пишем, подписчик воркера — по желанию позже.
- `useNow` и live-переход заметок в «прошедшие» без reload — M4 (T16).
- Раскрытие повторов в `/calendar` и `/upcoming`, series reminders — M5 (T9–T12).
- `make seed` / demo / Playwright / `make verify` — M6 (и e2e с M4+).
- 10k seed и perf-пороги — критерий M6.
- См. «Известные ограничения» ниже (из спеки).

## Известные ограничения
- Интервал повтора только 1; нет «по дням недели» и «последняя пятница».
- Фильтр по периоду для серий приближённый (по пересечению диапазона): возможны ложные попадания в узкий период.
- Удаление отдельного вхождения серии не попадает в корзину.
- Email: «ровно одно» гарантировано на уровне записей; при падении между SMTP и пометкой `sent` возможен дубль (at-least-once). Снижение риска: фиксированный `Message-ID`.
- Нет пересинхронизации по журналу событий — после реконнекта WS полная инвалидация.
- Горизонт материализации напоминаний серий — 60 дней, продлевается воркером раз в час и при старте (M5).
- Нет rate-limit, сброса пароля, подтверждения email.
- «Неделя» в `/upcoming` — скользящее окно `[завтра, сегодня+7d)`, не ISO-неделя Пн–Вс (D-018).
- Purge: `deleted_at < now − 30d` (ровно 30д0ч ещё не удаляется; D-022).

## Следующий заход
- Web Push / Service Worker.
- Интервал повтора и сложные правила («каждый второй вторник»).
- ICS-экспорт/импорт и подписка на календарь.
- Журнал событий с курсором для точного догона после обрыва WS.
- Полнотекстовый поиск со стеммингом.
- Шаринг заметок, rate-limit, подтверждение email.
