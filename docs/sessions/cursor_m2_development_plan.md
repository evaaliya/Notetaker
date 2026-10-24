# M2 development plan
_Exported on 10/24/2026 at 12:19:46 GMT+6 from Cursor (3.26.16)_

---

**User**

 Это новый чат, контекста прошлых нет. Сначала прочитай: spec.md,
STATUS.md, docs/DECISIONS.md, .cursor/rules/. M0 и M1 закрыты.
Работаем над M2.

Объём M2 (spec.md §6, §7, §12): GET /calendar?from=&to= (вхождения
диапазона; пока только одиночные заметки, повторы в M5), календарь
на фронте (месяц, неделя, день, клик открывает боковую панель
заметки, перетаскивание меняет starts_at через PATCH с version,
дата меняется, время суток сохраняется), экран «Ближайшее» (сегодня,
неделя, прошедшие активные) по GET /upcoming. Критерий готово:
UI-смоки из spec.md §12. Вне объёма: воркер, WS, повторы, useNow
и live-переход в «прошедшие» (M4).

Сначала план M2 на 10–15 строк, затем иди по нему без вопросов,
если спека однозначна.

Правила фиксации:
1. Запись в docs/DECISIONS.md сразу после решения, в том же коммите.
   Время из date. Нумерация продолжается с D-016.
2. Коммиты мелкие, префикс M2:, по одному на логический кусок.
3. Новые зависимости сразу в docs/CREDITS.md.
4. Тесты на реальном Postgres, без sleep. UI-смоки опиши в STATUS.md
   (что проверено вручную, что автоматически).
5. Не пиши «готово» или «N passed» без вывода команды. Приведи:
   git log —oneline, make test, curl ключевых эндпоинтов.
6. В конце обнови STATUS.md и напомни про экспорт чата.
   Не начинай M3, пока я не скажу.

---

**Cursor**

Читаю спеку, статус, решения и правила — затем короткий план M2 и сразу к реализации.

CREDITS уже упоминает FullCalendar. Смотрю текущий API и фронт, чтобы составить точный план.

План M2 (критерий: UI-смоки §12; вне объёма — воркер/WS/повторы/useNow):

1. `GET /api/calendar?from=&to=` — одиночные (`rec_freq IS NULL`), не в корзине; ответ — вхождения `{occurrence_start, note}`.
2. `GET /api/upcoming` — бакеты today / week / past по `Clock` + TZ пользователя; past только `active`.
3. Тесты на Postgres без sleep (`test_calendar_range_singles`, `test_upcoming_buckets`).
4. FullCalendar + клиент `api.calendar` / `api.upcoming`; CREDITS уже ок.
5. Экран Календарь: месяц/неделя/день; клик → боковая панель; DnD → PATCH с `version`, дата меняется, время суток в TZ сохраняется.
6. Экран «Ближайшее» — три секции из `/upcoming` (без live `useNow`).
7. Навигация, стили оболочки под широкий календарь.
8. Решения (D-017+) сразу в DECISIONS; мелкие коммиты `M2:`.
9. В конце: `make test`, curl, `STATUS.md`, отчёт с выводом команд.

Иду по плану.

Реализую API календаря и upcoming: схемы, сервис, роутер, тесты.

Тесты зелёные. Пишу D-017/D-018 и коммичу API.

Ставлю FullCalendar и собираю экраны.

Пишу страницы календаря и «Ближайшее».

Проверяю API через curl и обновляю STATUS.

Контейнер API ещё на M1 — пересобираю compose.

M2 закрыт: API календаря/upcoming, UI месяц·неделя·день + боковая панель, «Ближайшее», коммиты D-017…D-019.

### Коммиты
```
dc32631 M2: STATUS — этап закрыт (calendar, upcoming, UI-смоки)
0bdd7fe M2: экраны Календарь и Ближайшее
91627df M2: FullCalendar 6.1.22, api.calendar/upcoming, wall-time DnD helper
5fdc163 M2: GET /calendar и /upcoming для одиночных заметок
```

### `make test` (2026-10-23 08:05 +06)
```
collected 14 items
… test_calendar_range_singles PASSED
… test_upcoming_buckets PASSED
============================== 14 passed in 3.24s ==============================
```

### curl (после `docker compose up --build`)
- `/api/calendar?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z` → `items` с `CalIn` + `Todayish`
- `/api/upcoming` → `today: [Todayish]`, `past: [CalIn]`, `week: []`
- `/api/health` → `status: ok`, worker ok
- web `http://localhost:5173/` → 200

### UI-смоки
В STATUS.md: браузер — месяц/неделя/день, клик → панель «Smoke event», upcoming «Сегодня (1)». DnD: код `relocateKeepWallTime` + PATCH; полный drag в автоматизации не гоняли.

### Решения
D-017 (форма вхождений, только singles), D-018 (границы upcoming в TZ), D-019 (FullCalendar 6 + wall-time DnD).

M3 не начинаю. Экспортируй этот чат в `docs/sessions/`.

