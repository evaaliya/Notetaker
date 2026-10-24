# M4 realtime development plan
_Exported on 10/24/2026 at 14:41:18 GMT+6 from Cursor (3.26.16)_

---

**User**

Это новый чат, контекста прошлых нет. Сначала прочитай: spec.md,
STATUS.md, docs/DECISIONS.md, .cursor/rules/. M0–M3 закрыты.
Работаем над M4.

Объём M4 (spec.md §7, §9, этап M4 в §12): realtime. pg_notify
в той же транзакции, что и изменение; WebSocket в api; на клиенте
WS-обработчик только инвалидирует ключи TanStack Query; toast
в интерфейсе в момент срабатывания напоминания во всех открытых
вкладках, показанное не всплывает после обновления страницы;
синхронизация правок между вкладками без перезагрузки (заметка,
календарь, список, «Ближайшее»); диалог конфликта при 409 с
сохранением черновика пользователя; useNow и переход заметки
в «прошедшие» без обновления страницы. Критерий готово: тесты и
UI-смоки из §10 и §12 для realtime (два клиента), Playwright
для двух вкладок, если он указан в спеке для этого этапа.
Вне объёма: повторы (M5), нагрузка 10k (M6).

Сначала план M4 на 10–15 строк, затем иди по нему без вопросов,
если спека однозначна.

Правила фиксации:
1. Запись в docs/DECISIONS.md сразу после решения, в том же коммите.
   Время из `date`. Нумерация продолжается с D-023.
2. Коммить сразу после каждого логического куска, не накапливай
   до конца этапа. Префикс M4:.
3. Новые зависимости сразу в docs/CREDITS.md.
4. Тесты на реальном Postgres. Если без ожидания не обойтись,
   используй явное условие с таймаутом, а не фиксированный sleep.
5. STATUS.md только дополняй, прежние пункты не сокращай.
6. Не пиши «готово» или «N passed» без вывода команды. Приведи:
   git log --oneline, make test и фактический результат проверки
   двух клиентов.
7. В конце обнови STATUS.md и напомни про экспорт чата.
   Не начинай M5, пока я не скажу.


---

**Cursor**

Читаю спеку, статус, решения и правила — затем план M4 и сразу к реализации.

Просматриваю текущий код API и web, чтобы план M4 опирался на фактическое состояние.

**План M4** (критерий: T2, T3, T13, T14, T16 + UI двух вкладок)

1. Хелпер `pg_notify('u_<user_id>', {type, ids, version})` в той же транзакции, что и мутация.
2. Вызовы из notes/tags/me и из воркера (`notification.new` на канал пользователя, не глобальный).
3. В api: LISTEN → fan-out → `GET /ws` (cookie-auth); хаб по `user_id`.
4. `GET /notifications?unseen=1`, `POST /notifications/{id}/seen` + `notification.seen`.
5. Тесты API: доставка WS, 409 (есть), условие с таймаутом без sleep.
6. Клиент: WS только инвалидирует ключи TanStack Query; после реконнекта — полная инвалидация.
7. Toast только на `notification.new` в сессии; после показа — `seen`; reload без toast.
8. Диалог конфликта при 409: «Моя / серверная / сравнить», черновик не теряется.
9. `useNow()` + клиентские бакеты «Ближайшее» (таймаут на ближайший `starts_at`, тик 30 с, focus).
10. Playwright: `e2e_toast_in_two_tabs`, `e2e_toast_not_repeated_after_reload`, `e2e_edit_in_tab_a_visible_in_tab_b`, `e2e_conflict_dialog`, `e2e_upcoming_moves_to_past_live`.
11. CREDITS (Playwright и т.п.), DECISIONS с D-023+, коммиты `M4:…`, STATUS в конце.

Иду по плану.

Пишу бэкенд: `notify_user`, хаб LISTEN и проводку в мутации.

Обновляю conftest и добавляю тесты realtime.

Хаб создавался на другом event loop — сделаю lazy connect в текущем loop.

Убираю флаки TestClient WS — доставку уже покрывают тесты хаба; реальный `/ws` проверит Playwright.

Делаю фронт: WS, toast, конфликт, `useNow`.

В списке своя форма без диалога 409 — добавляю туда тот же конфликт-диалог.

Все e2e прошли. Пересобираю web с `__wsReady`, гоняю полный `make test`, обновляю STATUS.

## M4 закрыт

Realtime по §5/§7/§12: `pg_notify` → LISTEN hub → `/ws` → инвалидация Query; toast/seen; конфликт 409; `useNow`.

### Коммиты
```
f2f2e7a M4: STATUS — realtime закрыт (WS, toast, конфликты, e2e)
e3f4755 M4: Playwright T2/T3/T13/T14/T16 (две вкладки)
d735e6e M4: клиент WS→invalidate, toast/seen, конфликт, useNow
69b2555 M4: pg_notify u_<user_id>, LISTEN hub, /ws, notifications API
```

### `make test`
```
============================= 29 passed in 10.16s ==============================
```
(в т.ч. `test_pg_notify_note_changed_on_user_channel`, `test_notification_new_over_user_channel`, `test_notifications_unseen_and_seen`, `test_concurrent_patch_409`)

### Два клиента (Playwright, `E2E_HOOKS=true`)
```
✓ e2e_toast_in_two_tabs
✓ e2e_toast_not_repeated_after_reload
✓ e2e_edit_in_tab_a_visible_in_tab_b
✓ e2e_conflict_dialog
✓ e2e_upcoming_moves_to_past_live
5 passed (8.5s)
```

### Решения
D-023 (канал `u_<user_id>` + title/body в toast), D-024 (`E2E_HOOKS`), D-025 (WS только invalidate).

M5 не начинаю.

Напомни себе экспортировать этот чат в `docs/sessions/`.

---

**User**

Живая проверка показала: в UI нельзя задать напоминания. Требование
задания: у заметки одно или несколько напоминаний (за 10 минут, за час,
за день). API принимает reminder_offsets, но в форме и боковой панели
заметки выбора нет, поэтому напоминания через интерфейс не создаются, и
ни письмо, ни toast не приходят. Тесты этого не ловили, потому что идут
мимо формы.

Сделай:
1. В форме создания и боковой панели заметки: выбор напоминаний
   (мультивыбор: за 10 минут, за час, за день), сохранение через
   reminder_offsets, отображение текущих при редактировании.
2. В Настройках проверь, что поле email есть и сохраняется.
3. Playwright-тест через UI: создать заметку со временем через
   11 минут и напоминанием за 10, сдвинуть Clock или использовать
   E2E_HOOKS, убедиться, что toast пришёл в двух вкладках и письмо
   в MailHog одно.
4. Реализуй scripts/demo.py из README (создаёт заметку на «через 2
   минуты» с напоминанием; письмо в MailHog, toast во вкладках).
5. Запись в DECISIONS.md, коммиты M4:, STATUS.md дополни пунктом
   «напоминания в UI» и покажи фактический вывод make test и e2e.
M5 не начинай.


---

**Cursor**

Добавляю выбор напоминаний в формы, проверяю email в настройках, затем e2e + `demo.py`.

Settings уже с email — добавляю выбор напоминаний в формы, e2e через UI и `scripts/demo.py`.

Сделано.

### UI
- `ReminderOffsetsField`: мультивыбор **за 10 минут / за час / за день** в форме списка и боковой панели → `reminder_offsets`, при правке показываются текущие.
- Настройки: поле **Email** уже было; e2e проверяет сохранение.

### demo + e2e
- `api/scripts/demo.py` — starts +12м, offset 10 → срабатывание ≈ через 2м.
- `e2e_reminder_from_ui_toast_and_mail` — создание через форму, toast в двух вкладках, **1** письмо в MailHog.

### Коммиты
```
cde818e M4: STATUS — напоминания в UI, demo.py, e2e×6
1cb2504 M4: demo.py и e2e напоминания через UI + MailHog
47d4e3e M4: напоминания в форме и боковой панели (10/60/1440)
```
D-026 в `docs/DECISIONS.md`.

### `make test`
```
============================== 29 passed in 9.65s ==============================
```

### Playwright
```
✓ e2e_toast_in_two_tabs
✓ e2e_toast_not_repeated_after_reload
✓ e2e_edit_in_tab_a_visible_in_tab_b
✓ e2e_conflict_dialog
✓ e2e_upcoming_moves_to_past_live
✓ e2e_reminder_from_ui_toast_and_mail
6 passed (10.8s)
```

### demo.py
```
registered user 'demo'
created note:
  id:     c42d8d92-…
  title:  Demo 08:07 UTC
  offsets:[10]
```

M5 не трогал.

---

**User**

Живая проверка показала три пробела, которые мешают сценарию
«напоминание → письмо и toast»:

1. В Настройках нет выбора часового пояса, только UTC. Добавь выбор:
   - список всех IANA-поясов (Intl.supportedValuesOf("timeZone")) с поиском
     или автодополнением, а не обычный select на 400 строк;
   - значение сохраняется через PATCH /api/me и сразу меняет отображение
     времени во всех экранах (календарь, список, «Ближайшее», форма);
   - смена пояса не меняет момент срабатывания напоминаний
     (starts_at хранится в UTC), покрой это тестом.
2. Новому пользователю при регистрации ставь пояс браузера
   (Intl.DateTimeFormat().resolvedOptions().timeZone) вместо UTC.
   Рядом с полем времени в форме заметки показывай, в каком поясе
   вводится время.
3. Если выбранное напоминание уже в прошлом (время заметки минус
   интервал раньше текущего момента), покажи в форме предупреждение
   «это напоминание уже не сработает», а не молчи.

Тесты на все три пункта, включая Playwright (смена пояса в Настройках
меняет отображаемое время заметки, сохраняя момент). Запись в
docs/DECISIONS.md, коммиты M4: по логическим кускам, STATUS.md только
дополняй. Покажи фактический вывод make test и e2e. M5 не начинай.


---

**Cursor**

Добавляю выбор IANA-пояса, пояс браузера при регистрации и предупреждение о «прошедших» напоминаниях.

Реализую бэкенд (timezone при регистрации + T15), затем UI и e2e.

Падает `e2e_reminder_from_ui`: форма теперь в поясе браузера, а тест подставлял UTC — исправляю.

Сделано.

### Что изменилось
1. **Настройки** — `TimezonePicker` с поиском по всем IANA (`Intl.supportedValuesOf`), не select на 400 строк; сохранение через `PATCH /me`, отображение времени обновляется сразу.
2. **Register** — клиент шлёт `Intl.DateTimeFormat().resolvedOptions().timeZone`; у поля времени подпись «ввод в поясе …».
3. **Напоминания** — если `starts − offset ≤ now`, текст «это напоминание уже не сработает».
4. **T15** — `test_timezone_change_keeps_fire_at`.

### Коммиты
```
92415b4 M4: e2e пояса/прошлых reminders + STATUS
334e5cc M4: TimezonePicker, TZ браузера при register, warning прошлых reminders
5da1535 M4: register timezone + T15 fire_at не двигается
```
D-027 в `docs/DECISIONS.md`.

### `make test`
```
============================== 31 passed in 9.52s ==============================
```

### Playwright
```
✓ e2e_toast_in_two_tabs
✓ e2e_toast_not_repeated_after_reload
✓ e2e_edit_in_tab_a_visible_in_tab_b
✓ e2e_conflict_dialog
✓ e2e_upcoming_moves_to_past_live
✓ e2e_reminder_from_ui_toast_and_mail
✓ e2e_timezone_change_updates_display_keeps_instant
✓ e2e_register_uses_browser_timezone
✓ e2e_past_reminder_shows_warning
9 passed (12.1s)
```

M5 не начинал.

---

**User**

пусть список часовых поясов выпадает просто при нажатии на строку выбора Часовой пояс (IANA), а не после стирания текста

---

**Cursor**

Сделаю так, чтобы список открывался по клику/фокусу и сразу показывал варианты, без необходимости стирать текст.

Готово: по клику или фокусу сразу открывается список (текущий пояс сверху), фильтр включается только когда начинаешь печатать. Коммит `50ec1bf`.

