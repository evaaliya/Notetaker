# Notetaker

Клиент-серверные заметки, привязанные к дате и времени: календарь, теги, повторы, напоминания (email + in-app), совместный доступ, вложения, разбор звонков и YouTube-субтитров, live-синхронизация между вкладками.

Полные требования — [`spec.md`](spec.md). Текущее состояние — [`STATUS.md`](STATUS.md).

## Основные возможности

- **Заметки и теги** — создание, поиск и фильтры на сервере, корзина с автоочисткой через 30 дней
- **Календарь и «Ближайшее»** — месяц / неделя / день, drag-and-drop, повторы (daily/weekly/monthly)
- **Напоминания** — email (MailHog локально) и in-app toast; состояние в БД, переживает рестарт
- **Realtime** — WebSocket + `pg_notify`; правки и уведомления без перезагрузки
- **Общие заметки** — владелец делится по логину; участник редактирует, не удаляет
- **Вложения** — файлы до 10 МБ, превью, autosave черновика
- **Звонки и видео** — (экспериментально, сверх требований задания) импорт транскрипта / Web Speech; субтитры YouTube → ИИ-конспект (stub или OpenRouter). Онлайн-прослушивание звонков не реализовано, подробности и ограничения — в STATUS.md.
- **Офлайн** — очередь create/PATCH в IndexedDB, идемпотентный create

## Скриншоты

| Календарь (месяц) | Список | День |
|---|---|---|
| ![Календарь](docs/design/screens/calendar-month-1440.png) | ![Список](docs/design/screens/list-1440.png) | ![День](docs/design/screens/calendar-day-1440.png) |

Больше экранов (в т.ч. mobile 390) — в [`docs/design/screens/`](docs/design/screens/).

## Технологический стек

| Слой | Технологии |
|---|---|
| Frontend | React 18, TypeScript, Vite, TanStack Query / Virtual, FullCalendar 6, luxon |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, argon2 |
| Database | PostgreSQL 16 (`SKIP LOCKED`, `LISTEN/NOTIFY`, `pg_trgm`) |
| Background jobs | DB-poll воркер (reminders, email outbox, materializer, trash purge) |
| Realtime | `pg_notify` → API LISTEN → WebSocket |
| Mail (dev) | MailHog |
| Testing | pytest + testcontainers; Playwright |
| Infrastructure | Docker Compose (`postgres`, `api`, `worker`, `web`, `mailhog`) |

## Архитектура и документация

```
Browser ──HTTP/WS──▶ api (FastAPI) ──SQL──▶ PostgreSQL
                         │ LISTEN              ▲
                         │ pg_notify ◀─────────┤
worker (reminders/outbox/purge) ───────────────┘
                         └── SMTP ──▶ MailHog
```

| Документ | Содержание |
|---|---|
| [`spec.md`](spec.md) | требования, схема, API, этапы M0–M25 |
| [`STATUS.md`](STATUS.md) | что работает / не работает / дальше |
| [`docs/HISTORY.md`](docs/HISTORY.md) | подробные смоки прошлых этапов |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | лог решений (D-NNN) |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | UI: токены, экраны, правила |
| [`docs/TESTING.md`](docs/TESTING.md) | pytest, e2e, verify, команды без make |
| [`docs/TOOLING.md`](docs/TOOLING.md) | чем собирали проект |
| [`docs/CREDITS.md`](docs/CREDITS.md) | зависимости и ассеты |
| [`docs/sessions/`](docs/sessions/) | экспорты чатов Cursor |

## Требования для запуска

Проект **не** устанавливает Docker и Git за вас.

| Для запуска UI/API | Для тестов (`make test` / `e2e` / `verify`) |
|---|---|
| Git | Python 3.11+ (лучше 3.12) |
| Docker 24+ и Compose v2 | Node.js 20+ и npm |
| curl (или PowerShell) для health | `make` (Unix/WSL2) |

**macOS / Windows:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) должен быть запущен.  
**Linux:** Docker Engine + Compose v2.

Проверено на **macOS (Apple Silicon)**. Windows и Linux на этой системе не прогонялись; для тестов на Windows используйте **WSL2**.

## Quick Start

```bash
git clone https://github.com/evaaliya/Notetaker && cd Notetaker
cp .env.example .env
docker compose up --build -d
```

Первый запуск может занять несколько минут (образы и сборка). Миграции применяются при старте `api`.

| Сервис | URL (порты по умолчанию) |
|---|---|
| Web | http://localhost:5173 |
| API (Swagger) | http://localhost:8000/docs |
| MailHog | http://localhost:8025 |

Порты и имя проекта задаются в `.env` (`API_PORT`, `WEB_PORT`, `POSTGRES_PORT`, `MAILHOG_*`, опционально `COMPOSE_PROJECT_NAME`) — см. `.env.example`.

Остановка с сохранением данных: `docker compose down` (или `make down`).

**Сброс БД (удалит данные тома Postgres этого проекта):**

```bash
docker compose down -v
```

Используйте только если нужен чистый том. Не включайте `-v` в обычный ежедневный запуск.

Демо с 10 000 заметок: `make seed`, логин `demo` / `demo` (см. [`docs/TESTING.md`](docs/TESTING.md)).

### Если у вас уже запущена другая копия на localhost

Два стека на одних и тех же хост-портах не поднимутся; при частичном старте UI может ходить в «чужой» API на `:8000`.

**Cookie и localStorage привязаны к origin** (`scheme://host:port`). Две копии на `http://localhost:5173` и `http://localhost:15173` — разные origins (разные cookie). Но `http://localhost:5173` и `http://127.0.0.1:5173` для браузера — **разные** hosts; зато две вкладки на один и тот же URL делят сессию. Если параллельно открыт «оригинал» и клон на одном адресе — откройте клон в **приватном окне** или по `http://127.0.0.1:<WEB_PORT>` (другой host → свои cookie).

1. В `.env` второй копии задайте **другие порты** и имя проекта:
   ```bash
   COMPOSE_PROJECT_NAME=notetaker-copy2
   API_PORT=18000
   WEB_PORT=15173
   POSTGRES_PORT=15432
   MAILHOG_SMTP_PORT=11025
   MAILHOG_UI_PORT=18025
   ```
2. Поднимите: `docker compose up --build -d`.
3. Проверьте, что это **ваша** БД (на чистом стеке без seed — **0**):
   ```bash
   docker compose exec postgres psql -U notetaker -d notetaker -c 'SELECT count(*) FROM notes;'
   ```
   Если видите чужие сотни тысяч строк — не тот `COMPOSE_PROJECT_NAME` / том / порт Postgres.

**Где лежат данные Postgres:** именованный Docker volume `pgdata` (см. `docker-compose.yml`), не bind-mount в папку репозитория. Имя тома на хосте = `<project>_pgdata`, где `project` — `COMPOSE_PROJECT_NAME` или basename каталога (по умолчанию). Пример: проект `notetaker` → volume `notetaker_pgdata`. Список: `docker volume ls | grep pgdata`. `docker compose down` том **не** удаляет; `down -v` — удаляет.

Автопроверка изоляции: `make fresh-check` (клон `HEAD` во временную папку, `-p notetaker-fresh` на портах 18xxx, ждёт `/api/health`, `notes=0`, регистрация → заметка → письмо в MailHog, затем `down -v` **только** этого временного проекта).

## Проверка работоспособности

```bash
curl -s http://localhost:8000/api/health
# ожидается "status":"ok" и worker.ok true (через пару секунд после старта)
```

1. Открыть http://localhost:5173
2. «Создать аккаунт» → зарегистрироваться
3. Открыть **Список** → «Новая заметка» 

Опционально: демо напоминания ≈ через 2 минуты — `docker compose exec api python scripts/demo.py` (toast + письмо в MailHog).

## Тестирование

Кратко (нужны Python/Node на хосте — см. раздел «Требования»):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r api/requirements.txt
cd web && npm install && cd ..

make test        # backend, testcontainers
make e2e         # Playwright (+ E2E_HOOKS на время прогона)
make verify      # pytest + e2e + отчёт T1–T21 + docs-check
make docs-check  # синхронизация STATUS ↔ DECISIONS
```

Эквиваленты **без make**, детали хуков и JUnit для verify — в [`docs/TESTING.md`](docs/TESTING.md).

**Счётчики (collect):** pytest **128**; Playwright все проекты **140** (chromium + m15 firefox/webkit).  
**Последний полный прогон (2026-11-04 20:47 +06, M28.1):** pytest **128 passed**; Playwright **140 passed** (0 failed / 0 skipped). Отчёт: [`reports/verify-20261104-204738.md`](reports/verify-20261104-204738.md). Актуальный STATUS — [`STATUS.md`](STATUS.md).

## Что не работает / ограничения

Кратко: нет «удалить навсегда» в корзине (только автоpurge 30 дней); calendar/quick create без client id в офлайн-очереди не реализован (основной путь — `/notes/new`); воркер reminders на poll без LISTEN (D-135). Полный список — [`STATUS.md`](STATUS.md) (§ «Не реализовано» / «Известные ограничения»).

## Что сделали бы следующим заходом

Кратко (полный приоритизированный список — [`STATUS.md`](STATUS.md) § «Следующий заход»):

1. **UX:** добить мобильную версию (сейчас не до конца); кнопка «Новая заметка» с любой страницы на desktop (как mobile FAB); доработка промпта extract; предпросмотр/фильтрация AI-черновиков.
2. Пробелы продукта: «удалить навсегда» в корзине; calendar/offline create с client id; URL-фильтры списка; `note_count` у тегов.
3. **Сверх брифа:** ручной телефон по LAN; CI/GitHub Actions (сейчас — `make verify`).
4. Дальше: Web Push; сложные повторы; ICS; журнал WS; FTS; напоминания участникам; rate-limit / email; LISTEN `reminders_changed` (D-135); живые звонки — отдельной задачей.

## Проверка ключевых возможностей

### Совместные заметки

Сессия в httpOnly cookie: вкладки одного браузера = один пользователь. Для второго аккаунта — **приватное окно** или другой браузер.

1. Пользователь A: заметка → «Поделиться» → логин B.
2. B (инкогнито): видит «Общая · владелец: …»; правка видна у A без reload.
3. B не удаляет и не делится; есть «Покинуть».

Автотест: `e2e_two_users_shared_note`.

### Напоминания

В форме заметки выберите offset (10 мин / час / день). Либо `scripts/demo.py`. Письма — http://localhost:8025.

### AI (звонки / видео) — режим без ключа

По умолчанию в `.env.example`: **`AI_PROVIDER=stub`** — ключ OpenRouter **не нужен**. Разбор идёт на заготовленных ответах; без ключа API **не** отвечает 500.

| Функция | `AI_PROVIDER=stub` (без ключа) | `AI_PROVIDER=openrouter` + ключ |
|---|---|---|
| Звонок: текст / `.txt`/`.vtt`/`.srt` → черновики | да (детерминированный stub) | да (LLM) |
| Видео: YouTube → субтитры → конспект | да (stub по тексту субтитров; нужен доступ api→youtube.com) | да (LLM) |
| Плеер `.mp4` / не-YouTube URL | да (только плеер) | да (только плеер) |
| «Разобрать субтитры» для не-YouTube | нет | нет |

OpenRouter подключают явно: оба поля обязательны вместе.

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
```

затем `docker compose up -d --force-recreate --no-deps api`. Без ключа при `openrouter` разбор **не стартует** (ошибка preflight, не 500) — M21.

Звук на сервер не пишется. Zoom как бот не подключаем.

### YouTube

Нужна сеть с контейнера `api` до `youtube.com` (Innertube + timedtext). Без captions у ролика разбор невозможен.

ИИ-разбор субтитров — только для ссылок YouTube. Прямой `.mp4` и другие URL можно открыть в плеере, но «Разобрать субтитры» для них недоступна.

Автотесты используют фикстуры и mock (без live YouTube/LLM): `test_youtube_*`, `e2e_youtube_*`.

## Troubleshooting

| Симптом | Что сделать |
|---|---|
| `Cannot connect to the Docker daemon` | Запустить Docker Desktop / сервис Docker |
| Порты заняты | Стек: **5173**, **8000**, **8025**/1025, **5432**. На macOS: `lsof -nP -iTCP:8000 -sTCP:LISTEN` |
| MailHog platform warning на Apple Silicon | Безвредно (эмуляция amd64) |
| Долгая первая сборка | Нормально; дальше слои кэшируются |
| `/api/e2e/*` → 404 | Ожидаемо без `make e2e` / `docker-compose.e2e.yml` |
| Первый e2e качает браузеры | Дождаться `npx playwright install` или повторить |

## Известные ограничения и ОС

Кратко: интервал повтора только 1; email at-least-once (фиксированный Message-ID); горизонт напоминаний серий 60 дней; нет OAuth / Web Push / rate-limit. Полный список — [`STATUS.md`](STATUS.md) и `spec.md` §13.

**Проверено:** macOS Apple Silicon (запуск, `make test`, `make e2e`).  
**Не проверено на этой системе:** Windows, Linux.
