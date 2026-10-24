# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-10-24 18:00 +06.

## Этапы

| Этап | Статус | Что проверено |
|---|---|---|
| M0 Скелет | готов | `docker compose up --build`; `/api/health` → ok + worker; register/login/me; pytest 6 passed (testcontainers) |
| M1 Заметки/теги/корзина/список | готов | T20 `test_tags_crud_and_multi`; T17 server `test_list_search_filters` / `test_list_keyset_pagination`; `perf_*_10k` — M6; `make test` → 12 passed; curl tags/notes/list/me |
| M2 Календарь и «Ближайшее» | готов | `test_calendar_range_singles`, `test_upcoming_buckets`; `make test` → 14 passed; curl `/calendar`, `/upcoming`; UI-смоки (см. ниже) |
| M3 Воркер напоминаний + outbox | готов | T1, T4–T8, T18–T19 (`test_reminder_*`, `test_inactive_*`, `test_reactivate_*`, `test_reschedule_*`, `test_sent_*`, `test_delete_*`, `test_restore_*`, `test_trash_purge_30d`, `test_restart_*`, `test_downtime_*`); `make test` → 26 passed; MailHog smoke (см. ниже) |
| M4 Realtime | готов | T2/T3/T13/T14/T15/T16 + UI reminders/timezone e2e; `make test` → 31 passed; Playwright → 9 passed (D-023–D-027) |
| M5 Повторы | готов | T9–T12 (`test_series_reminder_each_occurrence`, `test_split_series_keeps_past`, `test_override_single_occurrence`, `test_monthly_clamp` + DST); `make test` → 40 passed; `make e2e` → 9 passed; UI-смоки (см. ниже) |
| M6 Нагрузка и verify | готов | A1–A3 (stale sending, Date, e2e hooks); T17 `perf_list_10k` / `perf_search_10k` / `e2e_scroll_10k`; `make seed`; `make verify` → T1–T21 все закрыто; отчёт `reports/verify-20261024-175604.md` |

## Работает
- `docker compose up --build` поднимает postgres, mailhog, api, worker, web.
- Миграции Alembic применяются при старте api/worker (схема §3 + `worker_heartbeat` + outbox `sending`/`sending_at`).
- Auth: `POST /api/auth/register|login|logout`, opaque-сессия в httpOnly cookie (argon2).
- `GET/PATCH /api/me` (email, IANA timezone).
- `GET /api/health` — БД + heartbeat воркера.
- Теги: `GET/POST/PATCH/DELETE /api/tags`, цвет `#RRGGBB`, уникальность имени без регистра через `name_lower` (`set_tag_name`).
- Заметки: create/get/patch/delete, activate/deactivate, trash/restore; PATCH с `version` → `409` + актуальная `note`.
- Список: `GET /api/notes` — `q`, теги (any/all), status, период (from/to), sort/dir, keyset (cursor/limit).
- `GET /api/calendar?from=&to=` — вхождения `{occurrence_start, note}` для одиночных (`rec_freq IS NULL`), не в корзине (D-017).
- `GET /api/upcoming` — бакеты `today` / `week` / `past` по `Clock` + TZ пользователя; past только `active` (D-018).
- Web: Календарь (FullCalendar 6: месяц/неделя/день, клик → боковая панель, DnD → PATCH с `version` и сохранением wall-time), «Ближайшее» (три секции), Список, Теги, Корзина, Настройки; время через `Intl` + `user.timezone`.
- Тесты: `make test` → 46 passed на реальном Postgres (testcontainers); `make e2e` → 14 passed (вкл. `e2e_scroll_10k`).
- Напоминания (singles): материализация при create/patch (`fire_at = starts_at − offset`, без `fire_at <= now`); rebuild pending при смене времени/offsets; `sent` не трогаем (D-020).
- Воркер `tick(now)`: claim `FOR UPDATE SKIP LOCKED` (лимит 100); inactive/deleted → `skipped`; effective occurrence `< now` → `missed` (D-007); иначе `notifications` + `email_outbox` + `sent` + `pg_notify` на канал `u_<user_id>` (`notification.new`, D-023).
- Outbox: SMTP (`smtplib`) вне транзакции; фиксированный `Message-ID = <{outbox_id}@notetaker.local>` (D-021); заголовок `Date` из Clock/UTC (D-033); claim → `sending` + `sending_at` (D-031); протухший `sending` > `OUTBOX_SENDING_TIMEOUT_MINUTES` (дефолт 2) → `pending` + attempts (D-032).
- Автоочистка корзины раз в час: `deleted_at < now − 30d` (D-022).
- Realtime (M4): `pg_notify('u_<user_id>', …)` в той же транзакции, что мутация; api LISTEN → fan-out; `GET /ws` (cookie); клиент только инвалидирует TanStack Query (D-025).
- `GET /api/notifications?unseen=1`, `POST /api/notifications/{id}/seen` (+ `notification.seen` по WS).
- Toast только на `notification.new` за сессию WS; после закрытия — `seen`; reload без повторного toast (T2/T3).
- Синхронизация правок между вкладками без reload (список / календарь / «Ближайшее», T13).
- Диалог конфликта при 409: «Моя версия поверх» / «Принять серверную» / «Сравнить» (T14); черновик не стирается.
- `useNow` + клиентский перенос в «Прошедшие» без reload (T16).
- Playwright e2e: `make e2e` сам включает `E2E_HOOKS` через `docker-compose.e2e.yml`, ставит Chromium, после прогона возвращает api без хуков (D-034/D-035); ручки `/api/e2e/*` при обычном `make up` → 404.
- **Напоминания в UI:** мультивыбор «за 10 минут / за час / за день» в форме списка и боковой панели → `reminder_offsets`; при редактировании отображаются текущие (D-026).
- Настройки: поле Email есть, сохраняется через `PATCH /me` (проверено e2e).
- **Часовой пояс в UI:** поиск по всем IANA (`Intl.supportedValuesOf`) в Настройках; register шлёт пояс браузера; у поля времени подпись «ввод в поясе …»; смена пояса меняет отображение, не `starts_at`/`fire_at` (T15, D-027).
- Предупреждение в форме, если выбранное напоминание уже в прошлом (`starts − offset ≤ now`).
- `scripts/demo.py` — заметка с offset=10, fire ≈ через 2 минуты; `docker compose exec api python scripts/demo.py`.
- **Повторы (M5):** генератор daily/weekly/monthly в `rec_tz` (D-006/D-028); 31-е → последний день месяца; DST-gap → вперёд; `OccurrenceOut` = `{occurrence_start, original_start, note}` (D-029).
- `/calendar` и `/upcoming` раскрывают серии с overrides; список — одна строка серии с бейджем «повтор».
- `PATCH|DELETE /notes/{id}?scope=this|following|all&occurrence_start=` — override / split / мастер; `rec_tz` заморожен.
- Reminders серий: горизонт 60д при create/rebuild; продление воркером hourly (+ при старте hourly-блока); override delete → skip; fire по effective start.
- UI: `RecurrenceField` (частота/until) при создании; при правке вхождения — диалог «только это» / «это и следующие»; DnD серии → `scope=this`.
- **M6 нагрузка:** `make seed` → `demo/demo` + 10k заметок (теги, даты, ~10% серий, D-036); `perf_list_10k` p95 < 150 ms; `perf_search_10k` p95 < 300 ms; `e2e_scroll_10k` — DOM-строк ≤ 50.
- **`make verify`:** pytest + e2e + `reports/verify-<время>.md` с T1–T21 (D-038).

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

### Смоки M4 (2026-10-24)
**Автоматически:**
- `make test` → 31 passed (в т.ч. realtime, `test_timezone_change_keeps_fire_at` T15, `test_register_with_timezone`).
- `E2E_HOOKS=true docker compose up --build -d` затем `cd web && npx playwright test` → 9 passed:
  - `e2e_toast_in_two_tabs` (T2)
  - `e2e_toast_not_repeated_after_reload` (T3)
  - `e2e_edit_in_tab_a_visible_in_tab_b` (T13)
  - `e2e_conflict_dialog` (T14)
  - `e2e_upcoming_moves_to_past_live` (T16)
  - `e2e_reminder_from_ui_toast_and_mail` — форма UI + toast в 2 вкладках + ровно 1 письмо в MailHog
  - `e2e_timezone_change_updates_display_keeps_instant`
  - `e2e_register_uses_browser_timezone`
  - `e2e_past_reminder_shows_warning`
- `docker compose exec api python scripts/demo.py` → создал `Demo … UTC`, offsets `[10]`.

### Смоки M5 (2026-10-24)
**Автоматически:**
- `make test` → 40 passed (T9–T12 + регрессии M0–M4).
- `make e2e` → 9 passed (после Escape в timezone e2e, чтобы listbox не перехватывал Save).

**Вручную в браузере (localhost:5173):**
- Список → «Новая заметка» → «Повторять» daily до 2026-10-28, reminder 10м, starts 25.10 10:00 Asia/Bishkek → строка `M5 Series UI · повтор`.
- Календарь: 4 вхождения серии на 25–28; клик → панель «Вхождение» с `original_start`.
- Правка заголовка одного вхождения → диалог области → «Только это» → в календаре день 25 = `M5 Only This`, остальные `M5 Series UI`; в БД override на `2026-10-25T04:00:00Z`.
- Правка 26-го → «Это и следующие» → split: старая серия `rec_until=2026-10-25`, новая `M5 From Here` с `starts=2026-10-26`.
- Напоминание серии: forced `fire_at` + `process_due_reminders` → claimed 1, outbox 1, MailHog `total ≥ 1`.
- Формат времени (D-030): `formatTimeHm` / FC `eventContent` — всегда ЧЧ:ММ; e2e `formatTimeHm_always_hhmm_in_zone`, `e2e_calendar_list_upcoming_time_hhmm`.

### Смоки M6 (2026-10-24)
**Автоматически:**
- `make test` → 46 passed (в т.ч. `perf_list_10k`, `perf_search_10k`, stale sending, Date header).
- `make e2e` после `docker compose down -v`: 13→14 passed (добавлен `e2e_scroll_10k`); хуки during=401, after restore=404.
- `make seed` → `inserted 10000 notes; user 'demo' / 'demo'`.
- `make verify` → pytest 46 + e2e 14; отчёт `reports/verify-20261024-175604.md` — **T1–T21 все закрыто** (0 пробелов).

**Вручную в браузере (localhost:5173, пользователь `m6ui`, после `docker compose down -v && up --build`):**
- Регистрация → календарь октябрь 2026; Настройки: email `m6ui@example.com`, пояс `Asia/Bishkek`.
- Заметка `M6 Reminder UI` с offset 10м → forced `fire_at` → MailHog `total=1`, Subject/Date/Message-ID; toast «toast check» во вкладке списка.
- Серия `M6 Series UI` daily до 27.10 → в списке бейдж «повтор»; в календаре **4** события `11:59M6 Series UI`.
- Корзина: `M6 Reminder UI` после DELETE.
- Смена пояса на `UTC`: в списке время с `17:59` (Bishkek) на `11:59`; `starts_at` в API остался `2026-10-24T11:59:00Z`.
- Обычный `up`: `POST /api/e2e/tick_reminders` → **404**.

**Таблица T1–T21 (итог M6):**

| # | Статус | Тесты / комментарий |
|---|---|---|
| T1 | закрыто | `test_reminder_single_email_with_two_workers` |
| T2 | закрыто | `e2e_toast_in_two_tabs` |
| T3 | закрыто | `e2e_toast_not_repeated_after_reload` |
| T4 | закрыто | `test_inactive_note_no_reminder` |
| T5 | закрыто | `test_reactivate_before_due`, `test_reactivate_after_due_no_backfill` |
| T6 | закрыто | `test_reschedule_moves_reminders`, `test_sent_not_resent_on_edit` |
| T7 | закрыто | `test_delete_cancels`, `test_restore_returns_future_only` |
| T8 | закрыто | `test_trash_purge_30d` |
| T9 | закрыто | `test_series_reminder_each_occurrence` |
| T10 | закрыто | `test_split_series_keeps_past` |
| T11 | закрыто | `test_override_single_occurrence` |
| T12 | закрыто | `test_monthly_clamp` (+ DST-кейсы рядом) |
| T13 | закрыто | `e2e_edit_in_tab_a_visible_in_tab_b` |
| T14 | закрыто | `test_concurrent_patch_409`, `e2e_conflict_dialog` |
| T15 | закрыто | `test_timezone_change_keeps_fire_at` |
| T16 | закрыто | `e2e_upcoming_moves_to_past_live` |
| T17 | закрыто | `perf_list_10k`, `perf_search_10k`, `e2e_scroll_10k` (+ функц. list-тесты) |
| T18 | закрыто | `test_restart_keeps_pending` |
| T19 | закрыто | `test_downtime_future_sent_late`, `test_downtime_past_marked_missed` |
| T20 | закрыто | `test_tags_crud_and_multi` |
| T21 | закрыто | покрыто T2/T13/T14 |

## Не работает
- (пусто по объёму M0–M6)

## Не делали и почему
- LISTEN `reminders_changed` для немедленного тика — достаточно секундного poll; NOTIFY при rebuild пишем, подписчик воркера — по желанию позже.
- Изменения вида интерфейса — вне M6 (отдельный этап M7, если будет).
- См. «Известные ограничения» ниже (из спеки).

## Известные ограничения
- Интервал повтора только 1; нет «по дням недели» и «последняя пятница».
- Фильтр по периоду для серий приближённый (по пересечению диапазона): возможны ложные попадания в узкий период.
- Удаление отдельного вхождения серии не попадает в корзину.
- Email: «ровно одно» гарантировано на уровне записей; при падении между SMTP и пометкой `sent` возможен дубль (at-least-once). Снижение риска: фиксированный `Message-ID`. При SMTP дольше `OUTBOX_SENDING_TIMEOUT_MINUTES` возможен повторный claim (тот же Message-ID).
- Нет пересинхронизации по журналу событий — после реконнекта WS полная инвалидация.
- Горизонт материализации напоминаний серий — 60 дней, продлевается воркером раз в час и при старте.
- Seed 10k не материализует reminders (только список/поиск/скролл).
- Нет rate-limit, сброса пароля, подтверждения email.
- «Неделя» в `/upcoming` — скользящее окно `[завтра, сегодня+7d)`, не ISO-неделя Пн–Вс (D-018).
- Purge: `deleted_at < now − 30d` (ровно 30д0ч ещё не удаляется; D-022).
- E2E_HOOKS — только на время `make e2e` / `make verify` (D-034); в обычном `make up` выключен.

## Следующий заход
- M7 (если будет): полировка UI / визуальный дизайн (вне текущего объёма).
- Web Push / Service Worker.
- Интервал повтора и сложные правила («каждый второй вторник»).
- ICS-экспорт/импорт и подписка на календарь.
- Журнал событий с курсором для точного догона после обрыва WS.
- Полнотекстовый поиск со стеммингом.
- Шаринг заметок, rate-limit, подтверждение email.
