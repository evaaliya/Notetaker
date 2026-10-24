# Notetaker

Личные заметки, привязанные к дате и времени: календарь, теги, повторы, напоминания (email + in-app), корзина, live-синхронизация между вкладками и устройствами.

Полное описание требований и архитектуры — в [`spec.md`](spec.md). Состояние проекта — в [`STATUS.md`](STATUS.md).

## Требования
- Docker 24+ и Docker Compose v2 (рекомендуется), **или** Python 3.12, Node 20, PostgreSQL 16 локально.

## Запуск
```bash
git clone <ссылка на репозиторий> && cd notetaker
cp .env.example .env
docker compose up --build
```

| Сервис | URL |
|---|---|
| Web | http://localhost:5173 |
| API (Swagger) | http://localhost:8000/docs |
| MailHog (письма) | http://localhost:8025 |

Миграции применяются автоматически при старте `api`. Демо-пользователь `demo / demo` создаётся командой `make seed`.

## Команды
| Команда | Что делает |
|---|---|
| `make up` / `make down` | поднять / остановить сервисы |
| `make seed` | демо-пользователь и данные |
| `make test` | backend-тесты (реальный Postgres) |
| `make e2e` | Playwright (ставит Chromium при необходимости) |
| `make verify` | всё вместе + отчёт в `reports/` |

## Как проверить работоспособность
1. Поднять стек с хуками для e2e: `E2E_HOOKS=true docker compose up --build -d`.
2. Backend: `make test` (реальный Postgres через testcontainers).
3. Frontend e2e: `make e2e` — перед прогоном сам ставит Chromium (`npx playwright install chromium`). Отдельно ставить браузер не нужно.
4. Полный прогон: `make verify` → отчёт `reports/verify-<время>.md`.
5. Живая демонстрация: `docker compose exec api python scripts/demo.py` создаёт заметку на «через 2 минуты». Письмо — в MailHog, toast — в открытых вкладках.

## Документы
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — лог решений с временем
- [`docs/TOOLING.md`](docs/TOOLING.md) — чем делали и почему
- [`docs/sessions/`](docs/sessions/) — экспорты чатов Cursor
- [`docs/CREDITS.md`](docs/CREDITS.md) — чужие основы и зависимости
- [`STATUS.md`](STATUS.md) — что работает, что нет, что дальше
