# Fixing e2e test failures
_Exported on 11/1/2026 at 15:37:25 GMT+6 from Cursor (3.26.16)_

---

**User**

Это новый чат, контекста прошлых нет. Прочитай: spec.md, STATUS.md,
docs/DECISIONS.md, .cursor/rules/, git log -25. M0–M11 закрыты. Работаем
над M11.1: починить 5 упавших e2e. Следуй .cursor/rules/00-process.mdc.
Сначала диагностика, потом правки.

Сейчас: make test даёт 71 passed, make e2e даёт 38 passed и 5 failed:
- capture_m11.spec.ts › e2e_call_transcript_extract (не появляется
  call-drafts-modal);
- format_hm.spec.ts › e2e_calendar_list_upcoming_time_hhmm;
- m7_ui.spec.ts › e2e_tags_visible_everywhere, e2e_week_many_notes_in_slot,
  e2e_drag_to_trash.
В последних четырёх не находится .fc-event с названием заметки за 15 с.
Раньше эти тесты проходили.

1. Для каждого упавшего теста определи причину: баг продукта или устаревший
   тест. Для календарных: создай заметку на сегодня и покажи доказательства
   (скриншот, DOM, ответ /api/calendar), видно ли событие в календаре
   (вид, дата, пояс, фильтры, окно 1280×720).
2. Баг продукта: исправь и запиши причину в DECISIONS.md. Устаревший тест:
   обнови селектор или ожидание под актуальное поведение, не ослабляя
   проверку (событие видно, тег в пилюле, много заметок в одном слоте,
   перетаскивание в корзину и «Отменить»).
3. Для e2e_call_transcript_extract опиши, как поток работает сейчас, и
   подгони тест под него; поведение не меняй.
4. data-testid добавлять можно, существующие не переименовывать.

Критерий готово: make test и make e2e без падений, покажи полный вывод и
итоговые числа. Коммиты на русском с префиксом M11.1:, запись в
DECISIONS.md сразу после решения. STATUS.md только дополняй. Напомни про
экспорт чата.


---

**Cursor**

Сначала соберу контекст и диагностику по пяти упавшим e2e — план и критерий готово покажу до правок.

Проверяю поток capture и почему календарь не находит события с датами октября при «сегодня» = 1 ноября.

Нашёл вероятную причину календарных тестов: навигация next→prev возвращает к «сегодня» и не доходит до октября. Проверяю extract и видимость события «на сегодня».

---
name: M11.1 fix e2e
overview: "Диагностика уже указывает: 4 календарных e2e устарели из‑за жёстких дат октября 2026 при «сегодня» = 1 ноября; call-extract падает из‑за AI_PROVIDER=openrouter в e2e. Правки — в тестах и docker-compose.e2e.yml, без смены продуктового UI."
todos:
  - id: diag-today-event
    content: "После «ок»: заметка на сегодня + скрин/DOM/GET /api/calendar (1280×720)"
    status: completed
  - id: fix-calendar-e2e
    content: "Обновить format_hm + m7_ui: относительные даты, prev-first навигация"
    status: completed
  - id: fix-call-e2e
    content: AI_PROVIDER=stub в docker-compose.e2e.yml + await /api/extract в capture_m11
    status: completed
  - id: decisions-status
    content: "D-074/D-075 в DECISIONS.md, дополнить STATUS.md, коммиты M11.1:"
    status: completed
  - id: verify
    content: make test + make e2e, полный вывод и числа в отчёте
    status: completed
isProject: false
---

# M11.1: починить 5 упавших e2e

## Диагноз (по коду; живые скрин/DOM/`/api/calendar` — сразу после «ок»)

| Тест | Вердикт | Причина |
|---|---|---|
| `e2e_calendar_list_upcoming_time_hhmm` | устаревший тест | Жёсткие `2026-10-24/25` + цикл **next→prev** в month view: при старте в ноябре 2026 после N next и N prev снова ноябрь, **октябрь не открывается**. Раньше «сегодня» было в октябре — тест зелёный без навигации. |
| `e2e_tags_visible_everywhere`, `e2e_week_many_notes_in_slot`, `e2e_drag_to_trash` | устаревший тест | `starts_at: 2026-10-28…` + [`gotoWeekWithTitle`](web/e2e/m7_ui.spec.ts) тоже **next→prev**. 1.11.2026 — воскресенье: неделя FC (Sun-start) = 1–7 ноября; 28.10 — **предыдущая** неделя. После 36 next + 36 prev снова текущая неделя → `.fc-event` с title нет → timeout 15 с. |
| `e2e_call_transcript_extract` | окружение e2e / ожидание теста | Продукт: textarea → `POST /api/extract` → `applyExtract` → `call-drafts-modal` ([`CallCapturePage.tsx`](web/src/pages/CallCapturePage.tsx)). В [`.env`](.env) `AI_PROVIDER=openrouter`; [`docker-compose.e2e.yml`](docker-compose.e2e.yml) **не** форсит stub → e2e бьёт в free OpenRouter (медленно/ошибка) → модалка не появляется. UI/testid не ломались. |

Продуктовый баг календаря **не** предполагается: API отдаёт items в диапазоне, FC рисует `.fc-event` с title + `formatTimeHm`. После «ок» подтвердим: создать заметку «на сегодня» noon UTC, viewport 1280×720, week view, скрин + DOM + ответ `/api/calendar`.

```mermaid
flowchart LR
  subgraph calFail [Календарные e2e]
    HardDate["starts_at октябрь 2026"] --> Nav["next xN затем prev xN"]
    Nav --> Back["снова сегодня"]
    Back --> Miss[".fc-event не найден"]
  end
  subgraph callFail [call extract]
    Click["call-extract"] --> OR["OpenRouter free"]
    OR --> Fail["timeout / error"]
    Fail --> NoModal["call-drafts-modal нет"]
  end
```

Поток call (актуально, не меняем):

1. `/capture/call` → текст / файл / Web Speech  
2. «Извлечь черновики» → `aiBusy` + `AiThinkingPanel` (`call-ai-thinking`)  
3. `api.extract` → summary + drafts → `confirmOpen` → `call-drafts-modal` / `call-draft-list` («создано ИИ»)  
4. «Создать выбранные» → `POST /notes` (`source=call`, `ai_generated`) → `/list`

## План правок

### 1. Календарные e2e — даты относительно «сейчас»
- [`web/e2e/m7_ui.spec.ts`](web/e2e/m7_ui.spec.ts): `starts_at` = сегодня ~12:00 / 10:00 / 14:00 **UTC** после `PATCH /me timezone=UTC` (как стабилизация в `realtime.spec.ts`, коммит `141a6ca`). `gotoWeekWithTitle`: сначала **prev**, потом next; короче цикл; дождаться ответа calendar / появления `.fc-event`.
- [`web/e2e/format_hm.spec.ts`](web/e2e/format_hm.spec.ts): две заметки на **сегодня** с `:00` и `:22`; серия `until` = сегодняшняя дата; убрать бессмысленный next→prev (текущий месяц уже содержит события). Проверки `04:00`/`08:22` заменить на фактические HH:MM из `formatTimeHm` / строки события; list/upcoming/`series-occ-hint` сохранить по смыслу.
- Утверждения не ослаблять: тег в `tag-pill`, 5 событий в одном слоте, drag → `trash-undo` → Отменить.

### 2. `e2e_call_transcript_extract` — stub в e2e + ожидание API
- В [`docker-compose.e2e.yml`](docker-compose.e2e.yml): `AI_PROVIDER: "stub"` (рядом с `E2E_HOOKS`), чтобы `make e2e` был детерминированным; обычный `make up` по-прежнему читает `.env` (openrouter).
- В [`web/e2e/capture_m11.spec.ts`](web/e2e/capture_m11.spec.ts): дождаться `response` на `/api/extract` (ok), затем `call-drafts-modal` / confirm / list — **без** правок [`CallCapturePage.tsx`](web/src/pages/CallCapturePage.tsx).

### 3. Документы и коммиты
- Сразу после решений: записи в [`docs/DECISIONS.md`](docs/DECISIONS.md) (D-074 календарные даты/навигация; D-075 stub в e2e compose).
- Коммиты: `M11.1: …` (отдельно решения/тесты по смыслу).
- [`STATUS.md`](STATUS.md): только дополнить блок M11.1 (не переписывать историю).
- Критерий: `make test` и `make e2e` без падений; в отчёте полный вывод и итоговые числа.
- Напомнить про экспорт чата в `docs/sessions/`.

## Критерий «готово»
- `make test` — все passed (ожидаемо ~71).
- `make e2e` — все passed, 0 failed (ожидаемо 43 = 38+5).
- Пять именённых сценариев зелёные; проверки видимости/тега/слота/корзины/модалки call сохранены.


---

**User**

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.

---

**Cursor**

Начинаю с диагностики: заметка на сегодня и доказательства в календаре.

Диагностика подтверждена: событие на сегодня видно в неделе. Перехожу к правкам тестов.

Все тесты зелёные. Обновляю STATUS фактическими числами и делаю коммиты.

M11.1 закрыт: 5 e2e починены, продукт календаря/звонка не ломали.

### Диагноз
| Тест | Причина |
|---|---|
| 4 календарных | Устаревшие даты октября + next→prev → снова «сегодня», октябрь не открывается |
| `e2e_call_transcript_extract` | `AI_PROVIDER=openrouter` в e2e → модалка не успевала |

Доказательство «сегодня»: `/api/calendar` match 1; week 1280×720 — `.fc-event` `DiagToday…12:00` (`docs/design/screens/m11_1-diag-today-1280.png`).

### Правки
- D-074: относительные `starts_at`, week nav prev-first  
- D-075: `AI_PROVIDER=stub` в `docker-compose.e2e.yml` + await `/api/extract`

### Коммиты
`ba4145a` → `ab9f06d` → `3821b7e`

### `make test` → **71 passed**
```
============================= 71 passed in 20.73s ==============================
```

### `make e2e` → **43 passed**, 0 failed
```
  ✓  8 capture_m11.spec.ts:4:1 › e2e_call_transcript_extract (785ms)
  ✓  14 format_hm.spec.ts:46:1 › e2e_calendar_list_upcoming_time_hhmm (1.7s)
  ✓  18 m7_ui.spec.ts:42:1 › e2e_tags_visible_everywhere (1.6s)
  ✓  19 m7_ui.spec.ts:77:1 › e2e_week_many_notes_in_slot (793ms)
  ✓  20 m7_ui.spec.ts:100:1 › e2e_drag_to_trash (1.0s)
  …
  43 passed (55.1s)
e2e hooks after restore (expect 404): 404
```

Экспорт этого чата — в `docs/sessions/`.

