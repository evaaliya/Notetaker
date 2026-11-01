# STATUS

Обновляется в конце каждого этапа. Последнее обновление: 2026-11-01 22:18 +06.

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
| M7 Новый интерфейс | готов | токены/шрифты/сайдбар; TagPill/`tagColors`/`NoteIllustration`/`pickIllustration`; календарь (slotEventOverlap, теги, trash-zone+Отменить); экраны Upcoming/List/Tags/Trash/Settings; mobile ≤640; bell+WebAudio; `make test` 46; `make e2e` 23; скрины `docs/design/screens/` |
| M7.fix Правки после живой проверки | готов | термин «тег»; тёмная панель/бирюза/Manrope; сайдбар pin+popover; luxon timeZone (D-049); e2e slot/sidebar/popover; `make test` 46; `make e2e` 26; скрины обновлены |
| M8.2 Каркас списка и страница заметки | готов | тулбар select тегов; строки grid; `/notes/new|:id`; сайдбар 64px; e2e layout; `make test` 46; Playwright 34; скрины 1440/1024 |
| M9 Вложения | готов | `test_attachment_*` + purge файлов; autosave+IndexedDB (D-057); `make test` → 52; e2e вкл. `e2e_attachment_*` / `e2e_autosave_*` |
| M10 Общие заметки | готов | `test_share_*` / `test_realtime_event_reaches_member`; `e2e_two_users_shared_note`; `make test` → 57; `make e2e` → 40 |
| M11 Звонки и видео | готов | stub 5 фраз + `test_extract_api` + parse vtt/srt; `e2e_call_transcript_extract` / `e2e_video_player_in_extract_panel`; UI D-072 |
| M11.1 Стабилизация e2e | готов | 5 упавших e2e: календарные даты → «сегодня» (D-074); call extract → stub в `docker-compose.e2e.yml` (D-075) |
| M12 Тесты/доки YouTube | готов | `test_youtube_*` (15) + `e2e_youtube_*` (3); README/CREDITS/D-076–077; `make test` 86; `make e2e` 46 |
| M13 UI Polish | готов | токены/контроли (D-079); mid-width + OverflowMenu + мобильное «Ещё» (D-080); мобильный календарь/sheet/уведомления (D-081); `make test` 86; `make e2e` 49; отчёт `reports/verify-20261101-194344.md` (+ доработка mobile) |
| M14 Сеть/гонки | готов | D-082 диагностика; job+кэш+cancel (D-083); аудит api.ts/WS/SMTP (D-084); `make test` 94; `make e2e` 51 |
| M15 Вёрстка/рендеринг | готов | D-085–091; клики/ширина/день/resize; Profiler без memo; `make test` 94; `make e2e` 69 (chromium+m15×ff/wk) |

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
- Тесты: `make test` → 94 passed на реальном Postgres (testcontainers); Playwright e2e → 69 passed (chromium suite + m15 firefox/webkit).
- **M14 сеть/гонки:** `POST /api/extract/youtube/jobs` + poll/cancel; captions cache; wall-clock 15s/60s + retry; ошибки по-русски + hint + «Повторить»; `api.ts` timeout/Abort; double-click/stale guard. Sync `/youtube` сохранён.
- **M13 UI Polish:** токены `--control-h` / `--accent-hover` / холодные `--shadow-*`; единые hover/focus кнопок и полей (высота ≥44px); FullCalendar hover на бирюзу; `switch.off` нейтральный; адаптив mid-width (фильтры wrap, rail ≤900, строки → OverflowMenu «Действия»); на 390 «Ещё» → Уведомления/Теги/Звонок/Видео/Настройки; **отдельный мобильный календарь** (день по умолчанию, chrome, sheet-панель, «В корзину» без DnD); без горизонтального скролла. Backend не меняли.
- **Звонки/видео (M11):** `AI_PROVIDER=stub|openrouter`; `POST /api/extract` (+ `/transcript`, `/youtube`); поля `source`/`source_url`/`source_ts`/`ai_generated`; UI `/capture/call` и `/capture/video`; **субтитры YouTube** → extract → при EN выбор языка EN/RU → одна заметка-конспект; бейдж «создано ИИ». Конспект (D-068): главная мысль + заметки markdown-lite. Видео (D-069): по умолчанию только конспект. Пока ждём ответ — `AiThinkingPanel` (D-070). EN-ролик → выбор языка конспекта EN/RU (D-071, стабилизация D-073). UI видео (D-072): плеер слева от «Разобрать». Zoom API нет: только вставка/файл транскрипта или Web Speech в браузере.
- **M12 тесты YouTube:** фикстуры + fake fetch (D-076); e2e route-mock extract + stub IFrame (D-077); покрыто: id/XML, create note, ошибки по-русски, ACL, bilingual UI. Не покрыто: live Innertube, live LLM.
- **Общие заметки (M10):** `note_members`; владелец добавляет/удаляет по логину; участник видит список/календарь/«Ближайшее» с бейджем «Общая · владелец: …», правит (version→409), не удаляет и не делится; «Покинуть»; realtime на всех участников; уведомление «Вам открыт доступ»; чужой → 404.
- **Вложения (M9):** `attachments` + том `uploads`; POST/GET/DELETE `/api/notes/{id}/attachments`; sniff типа; 10 МБ / 10 файлов; 413/415/404; soft-delete сохраняет файлы, purge 30д удаляет с диска; WS `attachment.added`/`deleted`; UI скрепка/DnD/превью; `NoteOut.has_attachments`.
- **Autosave страницы заметки (D-057):** пустой `/notes/new` без записи в БД; create при первом тексте/файле; PATCH debounce 600 мс; очередь файлов + черновик в IndexedDB `notetaker-drafts`; статус «Сохранено» вместо кнопки «Сохранить».
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
- (пусто по объёму M0–M7)

## Не делали и почему
- **Запись звука на сервере / подключение к звонку Zoom как бот** — вне M11; только явный импорт текста/транскрипта или Web Speech в браузере (звук на сервер не уходит).
- **Напоминания участникам общих заметок** — в v1 только владелец (D-058); иначе per-user offsets и fan-out email/in-app.
- LISTEN `reminders_changed` для немедленного тика — достаточно секундного poll; NOTIFY при rebuild пишем, подписчик воркера — по желанию позже.
- Счётчики заметок у тегов в сайдбаре — в API нет `note_count` (D-039); схему не расширяли.
- «Удалить навсегда» в корзине — нет endpoint (только автоpurge 30д); см. TODO(spec-gap) в TrashPage.
- Генерация картинок моделью / Web Push — вне M7 (`docs/FRONTEND.md` §12).
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
- **M11 видео:** YouTube IFrame API и произвольные внешние URL грузятся с сети браузера; без сети плеер недоступен (локальный e2e-фикстура `web/public/m11-sample.mp4`).
- **M11 субтитры:** без captions у ролика разбор невозможен; не-YouTube URL — кнопка разбора недоступна (только плеер). Список дорожек — Innertube ANDROID (D-067); id YouTube регистрозависим (`I` ≠ `l`). Длинные ролики → большой transcript и дольше extract.

### Смоки M7 (2026-10-28)
**Автоматически:**
- `make test` → 46 passed.
- `make e2e` → 23 passed (прежние 14 + `tagColors_*` / `pickIllustration_*` + `e2e_tags_visible_everywhere` / `e2e_week_many_notes_in_slot` / `e2e_drag_to_trash` / `e2e_mobile_quick_add` + screenshots).
- Скрины: `docs/design/screens/*-{1280,390}.png` (+ `mobile-sheet-390.png`).

**Вручную в браузере (localhost:5173):** см. отчёт этапа в чате (тег в календаре/списке/«Ближайшем», drag в корзину и «Отменить»).

### Смоки M7.fix (2026-10-29)
**Автоматически:**
- `make test` → 46 passed.
- `make e2e` → 26 passed (+ `e2e_calendar_slot_matches_label_timezone`, `e2e_sidebar_fits_viewport`, `e2e_notifications_popover`).
- Заметка `starts_at=2026-10-29T05:41:00Z` при `Asia/Bishkek`: подпись **11:41**, позиция в полосе слота **11:00–12:00** (не 05:00) — D-049 / luxon.
- Скрины обновлены: `docs/design/screens/*-{1280,390}.png`.

### Смоки M8.2 (2026-10-31)
**Автоматически:**
- `make test` → 46 passed.
- Playwright → 34 passed (`e2e_list_rows_aligned`, `e2e_toolbar_one_row`, `e2e_create_is_page`, `e2e_reminders_in_one_row`, `e2e_sidebar_collapse` + прежние).
- Скрины: `docs/design/screens/list-{1440,1024}.png`, `note-new-{1440,1024}.png` (+ обновлены 1280/390).

**Работает (M8.2):**
- Список: тулбар в одну строку (≥1200px) — поиск, select «Все теги», статус, сортировка, «Применить»; строки CSS grid `48px|1fr|auto`.
- Создание/правка заметки — страницы `/notes/new` и `/notes/:id` (не dialog); поле «Текст» ≥12 строк; напоминания в один ряд.
- На странице заметки: сайдбар 64px + колонка списка 320px + редактор (текст max 760px).
- Сайдбар сворачивается (default 64px, `localStorage`, 150 мс / reduced-motion); «Выйти» в меню аватара при свёртке.
- Боковая панель календаря без изменений по поведению маршрутов.

### Смоки M9 (2026-10-31)
**Автоматически:**
- `make test` → **52 passed** (`test_attachment_upload_ok`, `test_attachment_too_large_413`, `test_attachment_bad_type_415`, `test_attachment_foreign_404`, `test_trash_purge_deletes_attachment_files`, `test_attachment_txt_and_docx_ok` + регрессии).
- `make e2e` → **39 passed** (вкл. `e2e_attachment_image_thumbnail`, `e2e_autosave_*`; D-057).
- Autosave: пустой `/notes/new` без POST; первый символ/файл → create; PATCH debounce 600 мс; черновик+файлы в IndexedDB `notetaker-drafts`.

### Смоки M10 (2026-10-31)
**Автоматически:**
- `make test` → **57 passed** (`test_share_note_visible_to_member`, `test_member_edit_triggers_409_for_owner`, `test_non_member_gets_404`, `test_member_cannot_delete_or_share`, `test_realtime_event_reaches_member` + регрессии).
- `make e2e` → **40 passed** (вкл. `e2e_two_users_shared_note` — два browser context).

## Расширения сверх брифа

| Этап | Что | Статус |
|---|---|---|
| M9 | Вложения в заметках (`spec.md` §15) + autosave/IndexedDB (D-057) | готов |
| M10 | Общие заметки между пользователями (`spec.md` §15) | готов |
| M11 | Заметки из звонков и обучающих видео (`spec.md` §15); stub/OpenRouter | готов |
| M12 | Тесты и документация субтитров YouTube (фикстуры, bilingual e2e) | готов |
| M13 | UI Polish | готов |
| M14 | Сетевые ошибки и гонки (jobs, timeouts, audit) | готов |
| M15 | Вёрстка и рендеринг (клики, ширина, календарь, Profiler) | готов |

### Смоки M11 (2026-11-01)
**Автоматически:**
- Captions path: Innertube ANDROID (D-067); live smoke `Ok6QdZHCcI8` → ru/asr ~9k chars; `test_youtube_captions_xml_to_text`, `test_extract_youtube_uses_captions`; UI `e2e_video_captions_button_visible` / `e2e_video_player_in_extract_panel` (D-072).
- Откат: захват вкладки / OpenRouter audio STT / Whisper в браузере (D-064/D-065) — заменено субтитрами (D-066).

### Смоки M11.1 (2026-11-01)
**Диагностика:** заметка `DiagToday` на `2026-11-01T12:00:00Z` → `/api/calendar` match 1; week view 1280×720 — `.fc-event` виден (`docs/design/screens/m11_1-diag-today-1280.png`). Продукт календаря ок; падения — устаревшие жёсткие даты октября + next→prev.
**Исправлено:**
- `format_hm` / `m7_ui`: `starts_at` = сегодня UTC; week nav prev-first (D-074).
- `docker-compose.e2e.yml`: `AI_PROVIDER=stub`; `e2e_call_transcript_extract` ждёт `/api/extract` (D-075).
- UI звонка не меняли.
**Автоматически:** `make test` → **71 passed**; `make e2e` → **43 passed** (0 failed).

### Смоки M12 (2026-11-01)
**Автоматически:**
- `make test` → **86 passed** (`test_youtube_*` ×15: id/XML фикстуры, API create + EN/`summary_ru`, `no_captions`/`video_unavailable`/`upstream_error`, чужой → 404; без live youtube.com).
- `make e2e` → **46 passed** (`e2e_youtube_save_english_summary`, `e2e_youtube_save_russian_translation`, `e2e_youtube_russian_source_no_lang_choice` — route-mock extract, по одной заметке).
- Документы: README (сеть, лимиты, покрытие), CREDITS (Innertube/timedtext), D-076/D-077.
**Не чинили продукт** — тесты зелёные без правок поведения.

### Смоки M13 (2026-11-01)
**Автоматически:**
- `make test` → **86 passed**.
- `make e2e` → **47 passed** (после фикса `button.note-main`; ранее падал `e2e_list_rows_aligned` из‑за глобального `inline-flex` у button).
- `make verify` → pytest 86 + playwright 47; отчёт `reports/verify-20261101-194344.md` — T1–T21 закрыто.
- `m13_390_no_hscroll_and_more_menu`: 390×844 — нет горизонтального скролла на list/upcoming/calendar/settings; меню «Ещё» и «Действия» полностью доступны.

**Ограничения M13:** без редизайна и новых продуктовых фич; палитра тегов не менялась (D-078).

### Смоки M13 mobile calendar (2026-11-01, дополнение)
**Автоматически:**
- `make test` → **86 passed**.
- `make e2e` → **49 passed** (`m13_mobile_calendar_day_nav_and_sheet`, `m13_mobile_notifications_from_more` + прежние).
- Mobile calendar: chrome prev/next/today + День/Неделя/Месяц; клик по событию → sheet; «В корзину» в панели; desktop `e2e_drag_to_trash` без регрессии.
- «Ещё» → Уведомления открывает `.notif-popover` на 390.

### Смоки M14 (2026-11-01)
**Диагностика (D-082):** captions ~7 с; OpenRouter free 29–182 с; `httpx.Timeout(90)` не wall-clock (trickle 120 с ok). Кэша не было; «второй быстрее» кэшем не объясняется.
**Автоматически:**
- `make test` → **94 passed** (`test_extract_jobs_m14` + регрессии).
- `make e2e` → **51 passed** (`e2e_youtube_double_click_single_job`, `e2e_youtube_late_response_ignored_after_cancel` + youtube_m12 на job mock).

### Смоки M15 (2026-11-01)
**Диагностика (D-085, эксперимент):** (b) коллизия `app-main.note-main` ↔ `.note-main` строк → shrink-wrap workspace 709 при main 1376; LS/аккаунт не влияют; (a) video list без Link; (c) FC 1h без end; (d) нет `updateSize`.
**Исправлено:** `note-route` (D-086); `NoteLink` + `notifications.note_id` (D-087); clamp end суток (D-088); ResizeObserver/transitionend (D-089); m15 e2e ×3 браузера (D-090); Profiler — memo не нужен (D-091).
**Автоматически:**
- `make test` → **94 passed**.
- `make e2e` → **69 passed** (chromium полный suite + `m15_layout` на firefox/webkit); ширины 390–1920, без h-scroll.

### Смоки M15 редактор (2026-11-01 23:02 +06)
**Исправлено (D-092):** редактор на всю ширину панели (без max 760px); мета — `EditorMetaDisclosure` (время/повтор/напоминания/теги/вложения); теги — `TagMultiSelect` + чипы; DnD файла на текст + скрепка; бизнес-логика autosave/API без изменений.
**Автоматически:**
- `make test` → **94 passed**.
- `make e2e` → **81 passed** (вкл. `m15_editor_*` на chromium/firefox/webkit + прежние `m15_layout`); адаптация `reminder_ui`/`timezone`/`attachments_m9`/`autosave_m9`/`m8_2` — раскрытие meta перед взаимодействием.
**Работает:** title/body ≥70% ширины pane; meta свёрнута по умолчанию, значения сохраняются; paperclip + drop на body; sidebar collapse не ломает ширину.

### Смоки M15 Apple Notes редактор (2026-11-01 23:38 +06)
**Исправлено (D-093):** единая writing surface (title 28px/800 + body без рамок); горизонтальный `.note-action-bar` с popover; одна скрепка → filechooser; теги — `TagPill` toggle без поиска/чекбоксов; убраны вертикальные full-width карточки D-092 и скрепка у «Закрыть».
**Автоматически:**
- `make test` → **94 passed**.
- `make e2e` → **81 passed** (`m15_editor_*` ×3 браузера + suite); `reminder_ui`/`timezone` учитывают exclusive popover.
**Работает:** toolbar `flex-direction: row`; ровно один `note-attach-btn`; значения meta сохраняются при сворачивании; DnD на surface.
**Дополнение (2026-11-02 00:01 +06, D-094):** у `.side-tags-scroll` скрыт системный скроллбар на тёмном сайдбаре; `make e2e` → **84 passed**.

## Следующий заход
- Web Push / Service Worker.
- Интервал повтора и сложные правила («каждый второй вторник»).
- ICS-экспорт/импорт и подписка на календарь.
- Журнал событий с курсором для точного догона после обрыва WS.
- Полнотекстовый поиск со стеммингом.
- Напоминания участникам общих заметок; rate-limit, подтверждение email.
