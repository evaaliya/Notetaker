# M23 interface shaking issue
_Exported on 11/4/2026 at 03:26:07 GMT+6 from Cursor (3.26.16)_

---

**User**

Это новый чат, контекста прошлых нет. Прочитай: spec.md, STATUS.md,
docs/DECISIONS.md (D-089, D-103), .cursor/rules/, git log -25. Следуй
.cursor/rules/00-process.mdc. Работаем над M23: дрожание интерфейса на
узком экране. Сначала план в 10 строк.

Симптом: при уменьшенном окне интерфейс «трясётся» (дрожит), замечено без
сети. Гипотезы: (1) обратная связь ResizeObserver и перерасчёта вёрстки
(updateSize календаря, virtualizer.measure) без порога; (2) полоса
прокрутки появляется и исчезает на границе медиа-запроса и меняет
ширину; (3) в офлайне WebSocket переподключается без паузы и каждый раз
инвалидирует кэши; (4) баннер или тост сдвигает вёрстку.

1. Диагностика цифрами в DECISIONS.md: Playwright на ширинах 1210, 1190,
   910, 890, 650, 630 онлайн и офлайн: layout-shift (PerformanceObserver)
   за 10 с, вызовов ResizeObserver в секунду, попыток WS и инвалидаций в
   секунду, число рендеров (Profiler).
2. Исправления по подтверждённым причинам: scrollbar-gutter: stable у
   главного контейнера; в ResizeObserver защита (requestAnimationFrame,
   порог изменения ≥1px, без реакции на собственные изменения); WS
   экспоненциальный backoff 1→30 с с джиттером, офлайн не инвалидирует
   кэши на каждую попытку, одна инвалидация после успешного подключения;
   индикаторы сети в position:fixed.
3. АУДИТ КЛАССА: все ResizeObserver, matchMedia и подписки на размер и
   сеть. Таблица в DECISIONS.md.
4. Тесты: e2e_no_layout_shift_at_breakpoints (суммарный CLS < 0.01 за
   10 с на указанных ширинах), e2e_offline_no_rerender_storm (число
   рендеров и запросов за 10 с офлайн ограничено), юнит на backoff.
Коммиты на русском с префиксом M23:, запись в DECISIONS.md сразу после
решения, фактический вывод make test и make e2e. Напомни про экспорт чата.

---

**Cursor**

Сначала соберу контекст по спеке, статусу, решениям и правилам, затем дам план M23 в 10 строк.

**M23 — план (жду «ок»)**

1. **Диагностика:** Playwright-пробы на 1210/1190/910/890/650/630, online+offline → CLS (PerformanceObserver), ResizeObserver/с, WS+invalidate/с, рендеры Profiler; цифры в DECISIONS (D-121).
2. **Аудит класса:** все `ResizeObserver`, `matchMedia`, resize/network-подписки → таблица в DECISIONS (риск петли / сдвига вёрстки).
3. **Scrollbar:** `scrollbar-gutter: stable` на главном контейнере (гипотеза границы media-query).
4. **ResizeObserver:** rAF + порог ≥1px + игнор собственных изменений у календаря (`updateSize`, D-089) и списка (`virtualizer.measure`, D-103).
5. **WS offline:** exponential backoff 1→30 с + jitter; без invalidate на каждую попытку; одна invalidate после успешного reconnect.
6. **Индикаторы:** баннер/тост сети — `position: fixed` (не двигают поток).
7. **Тесты:** `e2e_no_layout_shift_at_breakpoints` (Σ CLS < 0.01 / 10 с); `e2e_offline_no_rerender_storm`; юнит backoff.
8. **Коммиты:** `M23: …` по шагам (диагностика → фиксы → тесты/STATUS); решения сразу в DECISIONS.
9. **Критерий готово:** подтверждённые причины закрыты; e2e+unit зелёные; `make test` + `make e2e` с фактическим выводом; STATUS обновлён.
10. Не трогаем API/схему/M0–M6; только `web/` (+ docs).

---

**User**

ok

---

**Cursor**

Начинаю M23: сначала найду ResizeObserver/WS/баннеры и сниму диагностику на указанных ширинах.

Сначала проверю, что стек поднят, и сниму диагностику через Playwright.

Пишу диагностический скрипт и параллельно готовлю защиту ResizeObserver / backoff WS.

Перезапускаю диагностику вне песочницы — Chromium там не стартовал.

Простой idle-замер почти пустой — перезапускаю с осцилляцией ширины и корректным учётом WS offline.

RO ~14–19/с подтверждён. Отдельно проверю WS offline — в основном прогоне счётчик остался нулевым.

Пишу D-121 и правки: helper для ResizeObserver, backoff WS, `scrollbar-gutter`.

Коммичу диагностику, затем прогоню тесты на фиксах.

M23 e2e зелёные. Запускаю полный `make test` и `make e2e`.

**M23 готов.** Дрожание закрыто по подтверждённым причинам: RO без порога и WS-invalidate на каждый close; баннер уже был fixed.

### Диагностика (D-121)
| Гипотеза | Итог |
|---|---|
| (1) RO ↔ measure/updateSize | **да** — 14.4–19.4 RO/с на ±1px; выше у mq 900/640 |
| (2) scrollbar gutter | **частично** — `gutter:auto`, CLS в headless=0 |
| (3) WS + invalidate | **да** — close+offline: 4 open / 6 close / 12 с |
| (4) баннер/тост | **нет** — уже `position:fixed` |

### Фиксы (D-122/D-123)
- `scrollbar-gutter: stable` на `html` / `.app-frame`
- `observeElementSize` (rAF, ≥1px, ignore self) для календаря и списка
- WS backoff 1→30 с + jitter; invalidate только после успешного reconnect

### Тесты (фактический вывод)
```
make test  → 121 passed in 26.85s
make e2e   → 112 passed (4.6m)
  ✓ ws_reconnect_backoff_unit
  ✓ e2e_no_layout_shift_at_breakpoints
  ✓ e2e_offline_no_rerender_storm
```

### Коммиты
```
38c6aa7 M23: STATUS — антидрожание, 121 pytest / 112 e2e
02c6134 M23: e2e CLS на брейкпоинтах и offline без rerender-storm
eab1fec M23: scrollbar-gutter, RO-guard, WS backoff 1→30с (D-121–123)
2b89feb M23: скрипт диагностики дрожания (CLS/RO/WS)
```

Напомни себе экспортировать этот чат в `docs/sessions/`.

