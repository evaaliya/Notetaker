# Project M0 planning
_Exported on 10/23/2026 at 07:06:45 GMT+6 from Cursor (3.26.16)_

---

**User**

Прочитай spec.md и правила в .cursor/rules/. Построим проект по этапам.
Сначала покажи план этапа M0 с критерием «готово» и жди моего «ок».
После этого: мелкие коммиты, запись в docs/DECISIONS.md со временем
из `date`, обновление STATUS.md. Тесты запускай сам и показывай результат.

---

**Cursor**

Сначала прочитаю `spec.md` и правила в `.cursor/rules/`, затем дам план M0 с критерием «готово».

Путь к репо с пробелом в конце — читаю `spec.md` и правила.

Прочитал `spec.md`, `00-process.mdc`, `10-invariants.mdc`, текущие `STATUS.md` / `DECISIONS.md`. Код ещё не начат — только kit (спека, docs, Makefile, `.env.example`).

---

## План этапа M0 — Скелет

**Цель по спеке:** compose, миграции, auth, `/health`.  
**Критерий «готово»:** `docker compose up` поднимает всё (postgres, mailhog, api, worker, web).

### Что сделаем

1. **Docker Compose** — сервисы: `postgres` (16 + расширения `citext`/`pg_trgm`), `mailhog`, `api`, `worker` (тот же образ, другая команда), `web` (Vite).
2. **Backend-скелет** — FastAPI + SQLAlchemy 2 async + Alembic; `Clock`; конфиг из env; миграции по модели из §3 (users, sessions, tags, notes, …); автоприменение миграций при старте api.
3. **Auth** — `POST /api/auth/register|login|logout`, opaque-сессия (argon2 + httpOnly cookie), минимальный `GET/PATCH /api/me` (email, timezone).
4. **`GET /api/health`** — liveness + проверка БД; heartbeat воркера (заглушка/минимальная запись, чтобы health мог проверить worker).
5. **Worker-заглушка** — процесс крутится, пишет heartbeat; логика напоминаний — с M3 (`TODO(spec-gap)` где нужно).
6. **Frontend-скелет** — Vite + React + TS: экран логина/регистрации и заглушка shell (остальные экраны — M1+).
7. **Тесты** — минимум: health + register/login/logout/me на реальном Postgres (testcontainers); без sleep.
8. **Процесс** — мелкие коммиты с префиксом `M0: …`; запись в `docs/DECISIONS.md` (время из `date`); обновление `STATUS.md`; в отчёте — что запускал и результат.

### Вне M0 (намеренно)

Заметки/теги/корзина, календарь, воркер напоминаний/outbox, WS/realtime, повторы, seed 10k, Playwright e2e.

---

Жду твоё **«ок»** — после него начну M0.

---

**User**

<timestamp>Friday, Oct 23, 2026, 5:29 AM (UTC+6)</timestamp>
<system_notification>
The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.

<task>
kind: shell
status: success
task_id: 65625
title: Locate workspace and spec.md
tool_call_id: call-0dc6c521-77c6-4288-ac9f-68cad61dd772-4
fc_p6JnxJM-6jKPYy-52c7eeb0-aws_ue1_0
output_path: /Users/diana/.cursor/projects/Users-diana-Documents-GitHub-notetaker-kit/terminals/65625.txt
</task>
</system_notification>
<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed). If there's no follow-ups needed, don't explicitly say that.</user_query>

---

**Cursor**

Фоновый поиск репозитория завершился успешно: проект лежит в `notetaker-kit` (в пути есть завершающий пробел), `spec.md` и правила на месте.

План M0 уже показан выше — жду твоё **«ок»**, чтобы начать этап.

---

**User**

ок

---

**Cursor**

Начинаю M0: сначала посмотрю текущее состояние репо и соберу скелет по плану.

Собираю backend, compose и фронт. Git, похоже, ещё не инициализирован — проверю и при необходимости инициализирую.

Ставлю зависимости и гоняю тесты.

Пять тестов прошли; падение из‑за того, что `worker` держит старый `SessionLocal` при импорте — исправляю.

Тесты зелёные. Поднимаю `docker compose`.

Миграции ломаются внутри уже запущенного event loop — перевожу Alembic на sync-драйвер.

**M0 готов.** `docker compose up --build` поднимает postgres, mailhog, api, worker, web.

### Проверки
| Что | Результат |
|---|---|
| `GET /api/health` | `{"status":"ok","db":"ok","worker":{"ok":true,...}}` |
| Web / MailHog | HTTP 200 |
| register → `/api/me` | ок, cookie-сессия |
| `pytest -v` (testcontainers) | **6 passed** |

### Коммиты
`8d6e082` kit → `cefec4c` модели/Alembic → `cec3d40` auth/health/worker → `692e0a5` compose+web → `1467828` тесты + D-008–D-010 + STATUS

### Ключевые решения (D-008–D-010)
Alembic через sync `psycopg2` (иначе ломается внутри asyncio); heartbeat воркера в БД; `tags.name_lower` вместо expression unique.

Сервисы: http://localhost:5173 · http://localhost:8000/docs · http://localhost:8025

Не начинаю M1, пока не отчитаюсь: **M0 закрыт.**

Напомни себе экспортировать чат Cursor в `docs/sessions/`.

---

**User**

M0 принят. три вещи:

1. Лог решений: пиши запись в docs/DECISIONS.md СРАЗУ после решения,
   отдельным коммитом или в том же коммите, где решение реализовано.
   Не копи записи до конца этапа: D-009 и D-010 имеют одинаковое
   время 05:45, это похоже на запись задним числом. Время всегда
   из `date`.
2. Добавь psycopg2 и другие новые зависимости в docs/CREDITS.md.
3. Не пиши «готово» или «N passed», не показав сам вывод команды.
   В отчёте этапа приводи фактический вывод: `git log --oneline`,
   `make test`, `curl` health.


---

**Cursor**

Принято. Обновлю `CREDITS.md` и зафиксирую правило по логу решений — с реальным временем из `date`.

Принято по всем трём пунктам.

1. **Лог решений** — сразу после решения + свежий `date`; зафиксировано в `00-process.mdc` и **D-011** (06:12 +06). Метки D-009/D-010 не переписывал.
2. **`docs/CREDITS.md`** — добавлены `psycopg2-binary`, `asyncpg`, Uvicorn, pydantic-settings, httpx, react-router-dom, Postgres 16 и остальное из M0.
3. **Отчёты** — дальше только с фактическим выводом команд.

Коммит: `97f9093 M0: CREDITS (psycopg2 и др.), правило лога решений D-011`

Фактический вывод сейчас:

```
$ git log --oneline
97f9093 M0: CREDITS (psycopg2 и др.), правило лога решений D-011
1467828 M0: тесты testcontainers, STATUS и решения D-008–D-010
692e0a5 M0: docker compose и web-скелет (логин/shell)
cec3d40 M0: auth (cookie-сессия), /health и heartbeat воркера
cefec4c M0: модели, Clock, Alembic-миграция схемы
8d6e082 chore: стартовый kit — спека, правила, STATUS/DECISIONS

$ curl -sS http://localhost:8000/api/health
{"status":"ok","db":"ok","worker":{"ok":true,"last_seen_at":"2026-10-23T00:12:10.173322Z"}}

$ make test
... (6 tests) ...
============================== 6 passed in 2.65s ===============================
```

---

**User**

Удали docs/sessions/PROMPTS.md и docs/sessions/README.md: вместо них
в docs/sessions/ лежат экспорты чатов Cursor. Сначала найди через grep
все ссылки на эти два файла и на «PROMPTS» в spec.md, README.md,
docs/*.md и .cursor/rules/, исправь их так, чтобы везде говорилось
только про экспорты чатов в docs/sessions/. Проверь, что ссылок на
удалённые файлы не осталось (покажи вывод grep). Отдельный коммит.

---

**Cursor**

Ищу все ссылки на эти файлы и «PROMPTS», затем поправлю и удалю.

Проверяю grep ещё раз чистым поиском — `rg` ругался на битый glob в `.gitignore`.

Сделано. Коммит `6e4b32a`.

**Правки ссылок:** `spec.md`, `README.md`, `docs/CREDITS.md` — везде только «экспорты чатов Cursor» в `docs/sessions/`.  
**Удалены:** `docs/sessions/PROMPTS.md`, `docs/sessions/README.md`.

**Проверка — ссылок на удалённые файлы / `PROMPTS` нет:**

```
$ rg -n --no-ignore 'PROMPTS|sessions/README|sessions/PROMPTS|docs/sessions/README|docs/sessions/PROMPTS' \
    spec.md README.md docs/ .cursor/rules/
exit:1   # совпадений нет
```

Оставшиеся упоминания `docs/sessions/` — только про экспорты (README, spec, TOOLING, CREDITS, process rule, экспорт чата).

```
$ git log --oneline -1
6e4b32a docs: sessions — только экспорты чатов, без PROMPTS/README
```

Замечание: в `.gitignore` строка `{.cursor/` ломает парсинг glob у `rg` без `--no-ignore`. Могу поправить отдельно.

---

**User**

ок 

---

**Cursor**

Папки `{.cursor` уже нет — убираю битую строку из `.gitignore`.

Строка `{.cursor/` удалена (самой папки уже не было). `rg` снова парсит `.gitignore` без ошибок.

```
$ rg -n 'PROMPTS|sessions/README' spec.md README.md docs/ .cursor/rules/
rg_exit:1

$ git log --oneline -2
6d9c0f0 fix: убрать битый glob {.cursor/ из .gitignore
6e4b32a docs: sessions — только экспорты чатов, без PROMPTS/README
```

