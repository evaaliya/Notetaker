# Notetaker

Личные заметки, привязанные к дате и времени: календарь, теги, повторы, напоминания (email + in-app), корзина, live-синхронизация между вкладками и устройствами.

Полное описание требований и архитектуры — в [`spec.md`](spec.md). Состояние проекта — в [`STATUS.md`](STATUS.md).

## Требования
- **Стек приложения:** Docker 24+ и Docker Compose v2.
- **Для тестов на хосте** (см. ниже): Python 3.11+ (рекомендуется 3.12), Node 20+, `make`, Docker (testcontainers поднимает Postgres).

## Развёртывание с нуля
```bash
git clone https://github.com/evaaliya/Notetaker && cd Notetaker
cp .env.example .env
docker compose down -v          # чистый том БД (если уже поднимали)
docker compose up --build -d
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

## Для тестов
`make test`, `make e2e` и `make verify` выполняются **на хосте** (не внутри контейнера приложения): pytest и Playwright вызываются локально; Docker нужен для Postgres (testcontainers) и для поднятого стека e2e.

```bash
# из корня репозитория (после clone и cd Notetaker)
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt
cd web && npm install && cd ..
```

После этого:
- `make test` — использует `.venv/bin/pytest` (реальный Postgres через testcontainers);
- `make e2e` — поднимает стек с `E2E_HOOKS`, гоняет Playwright из `web/` (Chromium ставит сам), затем выключает хуки;
- `make verify` — pytest + e2e + отчёт `reports/verify-<время>.md`.

Без `.venv` `make test` / часть `make verify` попытаются уйти в `docker compose run … pytest` (нужен Docker socket); e2e всё равно требует `npm install` в `web/`.

## Команды
| Команда | Что делает |
|---|---|
| `make up` / `make down` | поднять / остановить сервисы (`E2E_HOOKS` выключен) |
| `make seed` | пользователь `demo/demo` + 10k заметок |
| `make test` | backend-тесты на хосте (реальный Postgres / testcontainers) |
| `make e2e` | стек с `E2E_HOOKS=true` → Playwright на хосте → api снова без хуков |
| `make verify` | pytest + e2e + отчёт `reports/verify-<время>.md` (T1–T21) |

## E2E (Playwright)
```bash
make e2e
```
`make e2e` сам:
1. поднимает compose с override `docker-compose.e2e.yml` (`E2E_HOOKS=true` у api);
2. ждёт готовности api/web;
3. ставит Chromium при необходимости и гоняет тесты из `web/`;
4. пересоздаёт api **без** override — ручки `/api/e2e/*` снова отдают 404.

Обычный `make up` / `docker compose up` хуки не включает.  
Вручную: `docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d`.

## Как проверить работоспособность
1. С нуля: `docker compose down -v && docker compose up --build -d`.
2. Один раз подготовить хост (раздел «Для тестов»).
3. Backend: `make test`.
4. Frontend e2e: `make e2e` (отдельно ставить браузер и выставлять `E2E_HOOKS` не нужно).
5. Полный прогон: `make verify` → отчёт `reports/verify-<время>.md` (каждое T1–T21 сопоставлено с тестом; пробелы не скрываются).
6. Нагрузка UI: `make seed`, войти как `demo` / `demo`, экран «Список» — виртуальная прокрутка.
7. Живая демонстрация напоминания: `docker compose exec api python scripts/demo.py` (заметка на «через ~2 минуты»). Письмо — MailHog, toast — в открытых вкладках.

## Документы
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — лог решений с временем
- [`docs/TOOLING.md`](docs/TOOLING.md) — чем делали и почему
- [`docs/sessions/`](docs/sessions/) — экспорты чатов Cursor
- [`docs/CREDITS.md`](docs/CREDITS.md) — чужие основы и зависимости
- [`STATUS.md`](STATUS.md) — что работает, что нет, что дальше
