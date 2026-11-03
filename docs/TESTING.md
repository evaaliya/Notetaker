# Тестирование Notetaker

Подробные команды для разработчика. Краткий старт приложения — в [`README.md`](../README.md).

**Проверено на:** macOS (Apple Silicon).  
**Не проверено на этой системе:** Windows, Linux (ожидается тот же bash-путь на Linux / WSL2).

`make test`, `make e2e` и `make verify` выполняются **на хосте**. Docker нужен для testcontainers (Postgres) и для стека e2e.

## Подготовка хоста

```bash
# из корня репозитория
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
cd web && npm install && cd ..
```

Без `.venv` `make test` уйдёт в `docker compose run … pytest` (нужен Docker socket).  
`make e2e` всё равно требует `npm install` в `web/`.

На Windows без WSL2 цели Makefile не рассчитаны (`sh`, `.venv/bin/…`, `curl`). Используйте WSL2 или эквиваленты ниже в среде с bash/curl.

## Команды: `make` и без `make`

Все примеры — из **корня репозитория**.

| Цель | С `make` | Без `make` |
|---|---|---|
| Поднять стек (foreground) | `make up` | `docker compose up --build` |
| Поднять стек (фон) | — | `docker compose up --build -d` |
| Остановить | `make down` | `docker compose down` |
| Seed 10k (`demo`/`demo`) | `make seed` | `docker compose exec api python scripts/seed.py --notes 10000` |
| Backend-тесты | `make test` | см. ниже |
| Playwright e2e | `make e2e` | см. ниже |
| Полный verify + отчёт | `make verify` | см. ниже |
| Проверка синхронизации docs | `make docs-check` | `python3 scripts/check_docs.py` |

### `test` без make

С локальным venv (предпочтительно):

```bash
cd api && ../.venv/bin/pytest -v
```

Без venv (через образ api + Docker socket):

```bash
docker compose run --rm \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -v /var/run/docker.sock:/var/run/docker.sock \
  api pytest -v
```

### `e2e` без make

`make e2e` ставит Chromium, Firefox и WebKit (нужны для части suite, напр. M15). Эквивалент:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d
# дождаться готовности api и web, затем:
cd web && npx playwright install chromium firefox webkit && npx playwright test
cd ..
# вернуть обычный режим (хуки выкл.):
docker compose up -d --force-recreate --no-deps api
```

`make e2e` дополнительно ждёт health циклом и печатает коды ответа хуков (401 во время e2e, 404 после restore).

Обычный `docker compose up` хуки **не** включает. Override: `docker-compose.e2e.yml`.

### `verify` без make

Нужны JUnit XML от pytest и JSON-репорт Playwright — иначе `scripts/verify_report.py` не соберёт таблицу T1–T21.

```bash
mkdir -p reports
TS=$(date +%Y%m%d-%H%M%S)
JUNIT=reports/pytest-$TS.xml
PWJSON=reports/playwright-$TS.json
OUT=reports/verify-$TS.md

# 1) pytest → JUnit
if [ -x .venv/bin/pytest ]; then
  (cd api && ../.venv/bin/pytest -v --junitxml=../$JUNIT); PY_RC=$?
else
  docker compose run --rm \
    -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$(pwd)/reports:/reports" \
    api pytest -v --junitxml=/reports/pytest-$TS.xml; PY_RC=$?
fi

# 2) e2e с JSON-репортером
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d
# …дождаться health api/web…
(cd web && npx playwright install chromium firefox webkit \
  && npx playwright test --reporter=json > ../$PWJSON); E2E_RC=$?
docker compose up -d --force-recreate --no-deps api

# 3) отчёт T1–T21 + проверка docs
python3 scripts/verify_report.py \
  --junit "$JUNIT" \
  --playwright "$PWJSON" \
  --out "$OUT" \
  --pytest-rc "$PY_RC" --e2e-rc "$E2E_RC"
python3 scripts/check_docs.py
```

`make verify` делает то же и вызывает `make docs-check` в конце.

## Что проверяет `make docs-check`

Скрипт `scripts/check_docs.py`:

1. Последний номер решения `D-NNN` в `STATUS.md` совпадает с последним в `docs/DECISIONS.md`.
2. Дата «Последнее обновление» в `STATUS.md` не старше даты последней записи в `DECISIONS.md`.

## Замечания

- Первый `make e2e` качает браузеры Playwright (~100+ MB на движок).
- Хуки `/api/e2e/*` в обычном `make up` → **404**; во время `make e2e` / `make verify` → не 404 (обычно 401 без сессии).
- Flaky: `e2e_week_many_notes_in_slot` иногда падает; повторный прогон обычно ок (см. `STATUS.md`).
