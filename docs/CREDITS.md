# Чужие основы и зависимости

**Стартовый шаблон / генератор:** <ЗАПОЛНИТЬ: «не использовались» или название + ссылка>.

## Основные библиотеки

| Библиотека | Зачем |
|---|---|
| FastAPI, SQLAlchemy 2, Alembic | backend, ORM, миграции |
| argon2-cffi | хеш паролей |
| React, Vite, TypeScript | frontend |
| TanStack Query, TanStack Virtual | кэш с инвалидацией по WS, виртуализация списков |
| FullCalendar | календарь (месяц/неделя/день, drag-and-drop) |
| pytest, testcontainers, Playwright | тесты на реальном Postgres и e2e |
| MailHog | SMTP-заглушка |

Обновлять, если по ходу работы зависимости добавились или заменились.

## Код, написанный с агентом

Основная часть кода написана с участием AI-агента (см. `docs/TOOLING.md`). Промпты и экспорт сессий — в `docs/sessions/`.
