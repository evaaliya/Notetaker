# Notetaker

Личные заметки, привязанные к дате и времени: календарь, теги, повторы, напоминания (email + in-app), корзина, live-синхронизация между вкладками и устройствами.

Полное описание требований и архитектуры — в [`spec.md`](spec.md). Состояние проекта — в [`STATUS.md`](STATUS.md).

## Требования
- Docker 24+ и Docker Compose v2 (рекомендуется), **или** Python 3.12, Node 20, PostgreSQL 16 локально.

## Развёртывание с нуля
```bash
git clone https://github.com/evaaliya/Notetaker && cd notetaker
cp .env.example .env
docker compose down -v          # чистый том БД (если уже поднимали)
docker compose up --build
```

| Сервис | URL |
|---|---|
| Web | http://localhost:5173 |
| API (Swagger) | http://localhost:8000/docs |
| MailHog (письма) | http://localhost:8025 |

Миграции применяются автоматически при старте `api`.  
Демо-пользователь `demo` / `demo` (10 000 заметок): `make seed`.

Проверка после старта:
```bash
curl -s http://localhost:8000/api/health
# {"status":"ok", ... "worker": true/false ...}
```

## Команды
| Команда | Что делает |
|---|---|
| `make up` / `make down` | поднять / остановить сервисы (`E2E_HOOKS` выключен) |
| `make seed` | пользователь `demo/demo` + 10k заметок |
| `make test` | backend-тесты (реальный Postgres / testcontainers) |
| `make e2e` | стек с `E2E_HOOKS=true` → Playwright → api снова без хуков |
| `make verify` | pytest + e2e + отчёт `reports/verify-<время>.md` (T1–T21) |

## E2E (Playwright)
```bash
make e2e
```
`make e2e` сам:
1. поднимает compose с override `docker-compose.e2e.yml` (`E2E_HOOKS=true` у api);
2. ждёт готовности api/web;
3. ставит Chromium при необходимости и гоняет тесты;
4. пересоздаёт api **без** override — ручки `/api/e2e/*` снова отдают 404.

Обычный `make up` / `docker compose up` хуки не включает.  
Вручную: `docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build`.

## Как проверить работоспособность
1. С нуля: `docker compose down -v && docker compose up --build`.
2. Backend: `make test`.
3. Frontend e2e: `make e2e` (отдельно ставить браузер и выставлять `E2E_HOOKS` не нужно).
4. Полный прогон: `make verify` → отчёт `reports/verify-<время>.md` (каждое T1–T21 сопоставлено с тестом; пробелы не скрываются).
5. Нагрузка UI: `make seed`, войти как `demo` / `demo`, экран «Список» — виртуальная прокрутка.
6. Живая демонстрация напоминания: `docker compose exec api python scripts/demo.py` (заметка на «через ~2 минуты»). Письмо — MailHog, toast — в открытых вкладках.

## Документы
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — лог решений с временем
- [`docs/TOOLING.md`](docs/TOOLING.md) — чем делали и почему
- [`docs/sessions/`](docs/sessions/) — экспорты чатов Cursor
- [`docs/CREDITS.md`](docs/CREDITS.md) — чужие основы и зависимости
- [`STATUS.md`](STATUS.md) — что работает, что нет, что дальше
