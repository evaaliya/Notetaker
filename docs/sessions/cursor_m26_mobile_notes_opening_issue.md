# Mobile notes opening issue
_Exported on 11/4/2026 at 16:47:40 GMT+6 from Cursor (3.26.16)_

---

**User**

M26: Заметки и новая заметка не открываются на реальном телефоне (touch / DnD / окружение)

Это новый чат, контекста прошлых нет. Изучи:
spec.md, STATUS.md, docs/DECISIONS.md, docs/FRONTEND.md, .cursor/rules/, git log -25.
Следуй .cursor/rules/00-process.mdc.

СИМПТОМ
На реальном телефоне (iOS/Android), открытом по http://<LAN-IP-Mac> в той же
Wi-Fi сети, существующие заметки не открываются вообще, и есть проблемы с открытием
/notes/new. В DevTools с мобильной эмуляцией на ноутбуке всё работает.

ГИПОТЕЗЫ (не факты, всё подтвердить кодом и воспроизведением)
H1. Конфликт long-press DnD и click в useLongPressDrag: на touch drag вооружается
    через 350 мс удержания без движения, suppressClickIfDragged() глушит click,
    onSelect не вызывается. Эта гипотеза объясняет только случай «палец лежал
    дольше 350 мс». Обычный тап короче, поэтому H1 одна может не объяснять «не
    открывается вообще».
H2. На touch браузер забирает жест под скролл и шлёт pointercancel; если хук его не
    обрабатывает, таймер или флаги (didDrag, suppress) залипают.
H3. Insecure context: http://<LAN-IP> не secure context. Недоступны
    crypto.randomUUID, navigator.locks, service worker и др. Если после M22 create или
    очередь используют такие API, /notes/new на телефоне может падать с TypeError, а на
    localhost работать.
H4. Адрес API: захардкоженный localhost/127.0.0.1 или неверный origin/CORS. На
    телефоне запросы уходят не туда, UI может показывать «Нет соединения» или
    «Заметка не найдена».
H5. Перекрытие элементов (FAB z-index 45 vs MobileNav z-index 50, pointer-events)
    и/или кэш старого JS-бандла.

ЭТАП 0 — ПОДТВЕРЖДЕНИЕ ПРИЧИНЫ (до любых правок кода)
Не предполагай, а докажи. Для каждого утверждения дай файл:строка.
0.1 useLongPressDrag и все места использования: где ставится didDrag (на arm или
    только на реальном движении после arm), как обрабатываются pointerup,
    pointercancel, lostpointercapture, contextmenu, touch-action, как и когда
    сбрасывается suppressClickIfDragged.
0.2 Воспроизведение в Playwright с hasTouch и CDP Input.dispatchTouchEvent
    (page.touchscreen.tap() мгновенный и этот баг не поймает, не использовать его как
    единственный способ):
    (a) быстрый тап <150 мс; (b) удержание 450 мс

---

**Cursor**

Начинаю этап 0: соберу контекст из спеки/статуса/правил и разберу `useLongPressDrag` с точками вызова — без правок кода.

Дальше сверю список (без DnD), `crypto.randomUUID` на `/notes/new`, прокси API и CSS перекрытий.

H3 выглядит сильной: `crypto.randomUUID()` в форме редактора. Поднимаю стек и воспроизведу touch + insecure-context.

Пишу диагностический e2e для 0.2 и проверки H3 без правок продукта.

Браузер падал в песочнице (SIGSEGV) — перезапускаю с полными правами.

## Этап 0 — подтверждение причины (правок кода нет)

**План этапа:** разобрать хук/вызовы с `файл:строка` → воспроизвести touch CDP → проверить H3–H5 кодом и e2e → зафиксировать, что чинить в M26.  
**Критерий «готово»:** у каждой гипотезы статус confirmed / partial / rejected с доказательством; есть воспроизводимый Playwright-след.

Диагностика: `web/e2e/m26_touch_diag.spec.ts` → **6 passed** (chromium, hasTouch + CDP).

---

### 0.1 `useLongPressDrag`

| Что | Где |
|---|---|
| Единственный usage | `TimelineNoteCard.tsx:76–115`, click → `suppressClickIfDragged` → `onSelect` (`134–137`) |
| Константы | `dnd.ts:8–10` — `DND_LONG_PRESS_MS=350`, `DND_MOVE_CANCEL_PX=10` |
| `didDrag = false` | только на `pointerdown` (`useLongPressDrag.ts:160`) |
| `didDrag = true` | **в `arm()`**, не при движении после arm (`93–97`) |
| Touch arm | таймер 350 мс (`176–182`) |
| Mouse arm | после движения >10px (`122–123`) |
| `pointerup` / `pointercancel` | на `window` (`172–174`, `132–148`); `lostpointercapture` / `contextmenu` — **нет** |
| `resetTracking` | чистит timer/start/armed/pointerId (`84–91`), **не** `didDrag` |
| `suppressClickIfDragged` | если `didDrag` → true и сброс (`188–192`) |
| `touch-action` | `.tl-card-dnd` → `manipulation` (`styles.css:964–966`) |
| Список | DnD **нет** — `ListPage.tsx:376–380` просто `navigate` |

---

### 0.2 Playwright (CDP touch, не `touchscreen.tap`)

| Сценарий | Результат |
|---|---|
| (a) hold ~80 мс (&lt;150) | панель **открывается** |
| (b) hold 450 мс | панель **не** открывается (arm → suppress) |
| `pointercancel` до arm → следующий быстрый тап | панель **открывается** (флаги не залипают на следующий жест) |
| Список click | navigate на `/notes/:id` ок (на localhost) |

---

### Гипотезы

**H1 — partial (confirmed для long-press)**  
Удержание ≥350 мс глушит click. Быстрый тап открывает. Одно H1 **не** объясняет «не открывается вообще».

**H2 — mostly rejected (для sticky suppress)**  
`pointercancel` обрабатывается (`142–148`, `174`). После cancel до arm следующий тап работает. `didDrag` после arm+cancel остаётся true до следующего `pointerdown`, но тот его сбрасывает (`160`). `lostpointercapture` не слушается — отдельный крайний случай, не «все тапы».

**H3 — confirmed (главная причина для списка + `/notes/new` на `http://LAN-IP`)**  
`NoteEditorForm` **всегда** вызывает `crypto.randomUUID()` при mount:

```238:238:web/src/pages/NoteEditorPage.tsx
  const clientNoteIdRef = useRef<string>(crypto.randomUUID());
```

То же без fallback: `noteDraftIdb.ts:97`, `mutationOutbox.ts:159+`.  
Fallback есть только в `alarmLoop.ts:144–145`.  
`navigator.locks` в outbox — безопасный fallback (`mutationOutbox.ts:340–342`).

Без `randomUUID` (симуляция insecure / LAN):  
- `/notes/new` → `TypeError: crypto.randomUUID is not a function`  
- `/notes/:id` → тот же crash после загрузки  

На `localhost` / DevTools-эмуляции `isSecureContext === true` → UUID есть → «у меня на ноуте работает».

Календарный sheet (`NoteSidePanel`) UUID **не** использует — быстрый тап по карточке на телефоне может открывать панель, а список/`/notes/new` — нет.

**H4 — rejected**  
`fetch(path)` относительный (`api.ts:200`); `wsUrl` = `location.host` (`realtime.ts:50–52`); Vite `host: 0.0.0.0` + proxy `/api`/`/ws`. `VITE_API_URL` в compose **нигде не читается**.

**H5 — weak / not primary**  
FAB `z-index:45`, MobileNav `50` (`styles.css:2615`, `2659`) — FAB выше nav по `bottom`, не перекрывает строки списка. Кэш бандла возможен, но H3 воспроизводится без него.

---

### Вердикт

На реальном телефоне по `http://<LAN-IP>` ломается в первую очередь **H3** (список + новая заметка). **H1** добавляет «мёртвые» тапы в календаре при удержании ≥350 мс.

---

### Дальше (этап 1 — только после твоего «ок»)

1. Safe UUID helper (как в `alarmLoop`) везде вместо голого `crypto.randomUUID`.  
2. E2e insecure-context / missing `randomUUID` для `/notes/new` и `/notes/:id`.  
3. По желанию: touch-tap e2e + смягчение H1 (не ставить `didDrag` до реального move после arm).

Жду **ок**, чтобы начать правки.  
Напоминание: экспорт этого чата в `docs/sessions/` после этапа.

---

**User**

ок

---

**Cursor**

Иду в этап 1: safe UUID, смягчение H1 (`didDrag` только после движения) и e2e.

После фикса H1 удержание 450 мс без движения должно открывать панель — обновляю e2e.

Два фикса: после long-press браузер часто не шлёт `click` — вызову `onSelect` из хука; контейнер `web` ещё со старым бандлом — пересоберу.

## M26 готов

**H3:** `safeRandomUUID()` вместо голого `crypto.randomUUID` — `/notes/new` и `/notes/:id` не падают на `http://LAN-IP`.  
**H1:** `didDrag` только после движения; long-press без move → `onTapAfterArm` → открытие (браузер часто не шлёт click).

### Коммиты
```
ae73447 M26: e2e touch/insecure + D-133/134 STATUS
38a3733 M26: long-press без движения открывает заметку
94be80e M26: safeRandomUUID вне secure context (LAN http)
```

### Проверки (факт)
```
docs-check OK: D-134 (DECISIONS 2026-11-04 16:43, STATUS 2026-11-04 16:43)

18 passed (24.8s)
  m26_mobile_open (6) + calendar_dnd (7) + dnd_release_clears_ghost (5)
```

Полный `make e2e` / `make test` не гонялись. После `docker compose up --build` (или recreate `web`) проверь на телефоне по LAN.

Напоминание: сохрани экспорт этого чата в `docs/sessions/`.

