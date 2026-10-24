# M3 development plan
_Exported on 10/24/2026 at 13:06:08 GMT+6 from Cursor (3.26.16)_

---

**User**

Это новый чат, контекста прошлых нет. Сначала прочитай: spec.md,
STATUS.md, docs/DECISIONS.md, .cursor/rules/. M0, M1, M2 закрыты.
Работаем над M3.

Объём M3 (spec.md: воркер, reminders, outbox, корзина, этап M3
в §12): материализация напоминаний при создании и изменении заметки,
tick(now) воркера через Clock, SKIP LOCKED, уведомления в БД и
письма через email_outbox в MailHog с фиксированным Message-ID,
пересчёт напоминаний при смене времени, деактивации, удалении и
восстановлении, автоочистка корзины через 30 дней, политика
простоя из D-007. Критерий готово: тесты воркера из таблицы
спеки §10 с теми именами тестов, что указаны там. Вне объёма:
WS и live-уведомления в UI (M4), повторы (M5).

Сначала план M3 на 10–15 строк, затем иди по нему без вопросов,
если спека однозначна.

Правила фиксации:
1. Запись в docs/DECISIONS.md сразу после решения, в том же коммите.
   Время из `date`. Нумерация продолжается с D-020.
2. Коммиты мелкие, префикс M3:, по одному на логический кусок.
3. Новые зависимости сразу в docs/CREDITS.md.
4. Тесты на реальном Postgres, через Clock, без sleep.
5. STATUS.md только дополняй, прежние пункты не сокращай.
6. Не пиши «готово» или «N passed» без вывода команды. Приведи:
   git log --oneline, make test, а также письмо в MailHog
   (curl http://localhost:8025/api/v2/messages).
7. В конце обнови STATUS.md и напомни про экспорт чата.
   Не начинай M4, пока я не скажу.

---

**Cursor**

Сначала прочитаю спеку, статус, решения и правила — затем план M3 и сразу реализация.

Читаю текущий код воркера, модели и роутер заметок — затем план и реализация.

## План M3

Критерий готово: тесты T1, T4–T8, T18–T19 с именами из §10.

1. `services/reminders.py` — материализация singles: `fire_at = starts_at − offset`, не создавать `fire_at <= now`; rebuild: удалить `pending`, INSERT `ON CONFLICT DO NOTHING`.
2. Хук в create/patch при `starts_at` / `reminder_offsets` (серии — M5).
3. `tick(now)`: claim `pending` `FOR UPDATE SKIP LOCKED` (лимит 100); inactive/deleted → `skipped`; `occurrence_start < now` → `missed` (D-007); иначе notifications + outbox + `sent` + `pg_notify`.
4. Отдельный цикл outbox: SMTP вне транзакции, фиксированный `Message-ID`.
5. Раз в час: purge корзины `deleted_at < now − 30d`.
6. Тесты на Postgres + FrozenClock без sleep; MailHog-смок в отчёте.
7. DECISIONS с D-020+, CREDITS при новых deps, STATUS в конце; без M4.

Иду по плану.

Пишу materializer и подключаю его к create/patch.

Переписываю outbox и `worker.tick` — SMTP вне транзакции, сессии разделены.

Счётчики в тестах ограничиваю по `note_id` — иначе при общей БД они накапливаются.

Исправляю: `expire_all` без await, запросы через `SessionLocal` клиента, граница purge строго по спеке `<`.

Баг в тесте: оба reminder с `offset_min=10` схлопывались в dict.

Все 26 тестов зелёные. Делаю коммиты, затем MailHog-смок и STATUS.

## M3 закрыт

Материализация singles, `tick(now)` с SKIP LOCKED + D-007, outbox с фиксированным Message-ID, purge 30d. Решения D-020–D-022. M4 не начинал.

### Коммиты (`git log --oneline`)
```
7873ba9 M3: STATUS — этап закрыт (worker, outbox, MailHog)
2d9c43a M3: tests T1, T4–T8, T18–T19 (Clock, no sleep)
0f15c2f M3: tick SKIP LOCKED, outbox Message-ID, trash purge
4c78b66 M3: materialize singles on create/patch (D-020–D-022)
```

### `make test`
```
============================== 26 passed in 9.30s ==============================
```
В том числе: `test_reminder_single_email_with_two_workers`, `test_inactive_note_no_reminder`, `test_reactivate_before_due`, `test_reactivate_after_due_no_backfill`, `test_reschedule_moves_reminders`, `test_sent_not_resent_on_edit`, `test_delete_cancels`, `test_restore_returns_future_only`, `test_trash_purge_30d`, `test_restart_keeps_pending`, `test_downtime_future_sent_late`, `test_downtime_past_marked_missed`.

### MailHog (`curl http://localhost:8025/api/v2/messages`)
- `total: 1`
- Subject: `M3 MailHog smoke`
- To: `m3smoke@example.com`
- `Message-ID: <116e5385-1e3a-406d-afba-1304cd52fefe@notetaker.local>`
- reminder/outbox в БД: `sent` / `sent`

Экспорт этого чата в `docs/sessions/`, когда будешь готова.

---

**User**

В test_reminder_single_email_with_two_workers (api/tests/test_reminders_m3.py)
скажи, вызывает ли one_claim тот же код захвата из app/worker.py, что и
боевой tick, или отдельную копию SQL. Покажи код. Если копия, переделай
тест: два tick(clock.now(), ...) одновременно через asyncio.gather,
каждый на своём соединении, после чего проверь, что в outbox и
notifications ровно по одной строке. Отдельный коммит M3:, покажи make test.


---

**Cursor**

Сверяю тест с боевым `tick` — покажу, общий ли путь захвата.

`one_claim` не идёт через `tick()` в `worker.py` — вызывает тот же `process_due_reminders` (один SQL в `worker_jobs.py`, не копия). Переведу тест на два параллельных `tick()`.

**Было не копия SQL, но и не полный `tick`.**

`one_claim` вызывал тот же `process_due_reminders`, что и боевой `tick` — SQL один, в `worker_jobs.py`. Обхода через `worker.tick` не было (heartbeat/outbox/purge мимо).

```47:49:api/app/worker.py
    async with db_module.SessionLocal() as session:
        async with session.begin():
            n = await process_due_reminders(session, now, batch_size=settings.worker_batch_size)
```

Раньше в тесте:
```python
return await process_due_reminders(session, clock.now())
```

Переделал на два параллельных `tick` — каждый сам открывает `SessionLocal`:

```python
await asyncio.gather(
    tick(clock.now(), smtp_send=_noop_smtp),
    tick(clock.now(), smtp_send=_noop_smtp),
)
```

Коммит: `327e4be M3: T1 гоняет два concurrent tick(), не обход process_due_reminders`

```
make test → 26 passed in 8.86s
```

