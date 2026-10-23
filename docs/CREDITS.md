# Чужие основы и зависимости

**Стартовый шаблон / генератор:** не использовались. Репозиторий собран с нуля по `spec.md`.

## Основные библиотеки

| Библиотека | Зачем |
|---|---|
| FastAPI, Uvicorn | HTTP API |
| SQLAlchemy 2 (asyncio), asyncpg | async ORM и драйвер Postgres |
| Alembic, psycopg2-binary | миграции (sync-путь; см. D-008) |
| pydantic-settings | конфиг из env |
| argon2-cffi | хеш паролей |
| httpx | async HTTP-клиент в тестах API |
| React 18, Vite, TypeScript | frontend |
| react-router-dom | маршруты UI |
| TanStack Query | кэш; позже — инвалидация по WS |
| TanStack Virtual | виртуализация списков (с M1+) |
| FullCalendar | календарь (с M2) |
| pytest, pytest-asyncio, testcontainers | тесты на реальном Postgres |
| Playwright | e2e (с M4+) |
| PostgreSQL 16 | БД (`citext`, `pg_trgm`, `SKIP LOCKED`, `LISTEN/NOTIFY`) |
| MailHog | SMTP-заглушка |

Обновлять, если по ходу работы зависимости добавились или заменились.

## Код, написанный с агентом

Основная часть кода написана с участием AI-агента (см. `docs/TOOLING.md`). Экспорты чатов Cursor — в `docs/sessions/`.
