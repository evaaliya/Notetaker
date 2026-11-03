# HISTORY — история этапов Notetaker

Подробные смоки и отчёты по этапам, перенесённые из `STATUS.md` на этапе M24.
Актуальное состояние — в [`STATUS.md`](../STATUS.md).

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

### Смоки M23 (2026-11-04 03:19 +06)
**Диагностика (D-121):** осцилляция ±1px → RO 14.4–19.4/с (выше у mq 900/640); CLS headless=0; `ws.close()`+offline → 4 open / 6 close / 12 с с invalidate на каждый close; баннер уже fixed.
**Автоматически:**
- `make test` → **121 passed**.
- `make e2e` → **112 passed** (`ws_reconnect_backoff_unit`, `e2e_no_layout_shift_at_breakpoints`, `e2e_offline_no_rerender_storm` + регрессии).
**Работает:** gutter stable; RO без петли measure/updateSize; offline без invalidate-шторма; одна инвалидация после reconnect.

### Смоки M22 (2026-11-04 02:53 +06)
**Диагностика (D-118):** (a) setOffline → `/notes/new`, 0 заметок; (b) fetch+abort → 1 на сервере, UI на `/new`; (c) повтор без id → дубль; (b2) abort GET → «Заметка не найдена».
**Автоматически:**
- `make test` → **121 passed** (`test_create_note_idempotent` + foreign/deleted).
- `make e2e` → **109 passed** (`e2e_offline_create_queued_once`, `e2e_offline_note_page_shows_network_error`, `e2e_no_duplicate_after_reconnect`).
**Работает:** баннер поверх вёрстки; очередь IDB; идемпотентный create; 404≠сеть.

### Смоки M21 (2026-11-04 02:18 +06)
**Диагностика (D-115):** (a) stub 2.8 с done; (b) openrouter без ключа — раньше job+ошибка 1.3 с, теперь 503 до job; (c) bad key → invalid_key; (d) stop worker → hang >70 с → **корневая причина**; (e) youtube blocked → network → теперь youtube_unreachable.
**Автоматически:**
- `make test` → **118 passed** (`test_m21_*` ×5).
- e2e `e2e_m21_openrouter_missing_key_message_fast` (≤2 с), `e2e_m21_worker_down_error_within_20s` (≤20 с); полный `make e2e` 105 passed + 1 flake week (rerun ok).
**Работает:** предупреждение у «Разобрать субтитры»; нет бесконечного poll.

### Смоки M18 (2026-11-03 02:05 +06)
**Автоматически:**
- M17 calendar e2e → **6 passed** (вкл. `e2e_month_late_series_no_midnight_spill`, D-104).
- Ранее: `make test` 97; M18 list e2e ×5; полный `make e2e` 97.
**Работает:** длинные заголовки/превью не ломают сетку; sidebar/main без пересечений; mid-width virtual rows (D-103); month late series без midnight spill / ложной склейки дней (D-104); ≤640 — нижние вкладки.
**Скрины:** `docs/design/screens/list-{1200,768,390}.png`.

### Смоки M17 (2026-11-02 02:14 +06)
**Автоматически:**
- `make test` → **97 passed**.
- `make e2e` → **93 passed** (`e2e_month_main_pill_and_segments`, `e2e_month_segment_switches_main_and_opens_panel`, `e2e_week_timeline_layout`, `e2e_day_timeline_hours`, `e2e_timeline_overflow_plus_n` + регрессии).
**Работает:** месяц с переключением главной через колбаску; week/day вертикальный таймлайн; overflow `+N ещё`; панель без изменений по API.

### Смоки M16 (2026-11-02 00:34 +06)
**Автоматически:**
- `make test` → **97 passed** (`test_member_personal_tags_isolated`, `test_owner_tags_not_visible_to_member`, `test_show_in_calendar_false_hidden_from_calendar_but_in_list` + регрессии).
- `make e2e` → **87 passed** (`e2e_shared_note_personal_tags`, `e2e_video_draft_show_in_calendar_checkbox`, `test_ws_invalidate_coalesce` + suite).
**Звонки:** окно «Подтвердите черновики» в `CallCapturePage` не меняли (отдельная модалка без чекбокса календаря).
**Работает:** у участника свои теги на общей заметке; владелец не видит теги участника; video draft default вне календаря.

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
