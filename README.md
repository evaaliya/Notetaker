# Notetaker

Личные заметки, привязанные к дате и времени: календарь, теги, повторы, напоминания (email + in-app), корзина, live-синхронизация между вкладками и устройствами.

Полное описание требований и архитектуры — в [`spec.md`](spec.md). Состояние проекта — в [`STATUS.md`](STATUS.md).

**Проверено на:** macOS (Apple Silicon).  
**Не проверено на этой системе:** Windows, Linux (команды ниже даны по документации инструментов; присылайте правки, если что-то расходится).

---

## Что установить заранее (обязательно)

Проект **сам** Docker, Git, Python и Node **не ставит**. Без пунктов ниже команды из README не сработают.

### Для запуска приложения (UI / API / MailHog)

| Что | Зачем | Как проверить |
|---|---|---|
| **Git** | клонировать репозиторий | `git --version` |
| **Docker Desktop** (macOS/Windows) или **Docker Engine + Compose v2** (Linux), версия Docker 24+ | поднять postgres, api, worker, web, MailHog | `docker --version` и `docker compose version` |
| **curl** (macOS/Linux) или PowerShell (Windows) | проверка `/api/health` | `curl --version` / PowerShell уже в Windows |

**macOS / Windows:** установите [Docker Desktop](https://www.docker.com/products/docker-desktop/), **откройте его** и дождитесь статуса Running. Пока Docker не запущен, `docker compose` падает с ошибкой про daemon.

**Linux:** Docker Engine + плагин Compose v2 — [документация](https://docs.docker.com/engine/install/). Пользователя обычно нужно добавить в группу `docker` и перелогиниться.

### Дополнительно — только для тестов (`make test` / `make e2e` / `make verify`)

| Что | Зачем | Как проверить |
|---|---|---|
| **Python 3.11+** (лучше 3.12) | pytest на хосте | `python3 --version` |
| **Node.js 20+** и npm | Playwright e2e | `node --version`, `npm --version` |
| **make** | цели из `Makefile` | `make --version` |

**Windows и тесты:** `Makefile` и цели `test` / `e2e` / `verify` завязаны на Unix-shell (`sh`, `seq`, пути `.venv/bin/…`, `curl`). На «чистом» Windows / Git Bash **не проверено**. Запускайте тесты в **WSL2** (Ubuntu) с Docker Desktop + WSL integration, либо используйте эквиваленты без `make` из раздела ниже — тоже в среде, где есть bash/curl (WSL2).  
**macOS:** проверено. **Linux:** не проверено на этой системе (ожидается тот же bash-путь, что на macOS).

---

## Развёртывание с нуля (только приложение)

Когда Git и Docker уже установлены и Docker запущен.

### 1. Клон

```bash
git clone https://github.com/evaaliya/Notetaker && cd Notetaker
```

### 2. Файл окружения

**macOS / Linux** (проверено на macOS):

```bash
cp .env.example .env
```

**Windows (PowerShell)** (не проверено на этой системе):

```powershell
copy .env.example .env
```

**Windows (WSL2 / Git Bash)** (не проверено на этой системе): как на macOS — `cp .env.example .env`.

### 3. Поднять стек

```bash
docker compose down -v          # чистый том БД, если поднимали раньше
docker compose up --build -d
```

**Важно про `-d` (detached / фон) — частая путаница:**

| Что видишь | Что это значит |
|---|---|
| В конце `✔ … Started` и снова приглашение shell (`%` / `$`) | **Норма.** Команда закончилась, контейнеры **продолжают работать в фоне**. Это не остановка. |
| В терминале нет бесконечного потока логов | **Норма** при `-d`. Логи не пишутся в это окно специально. |
| Хочешь смотреть логи | `docker compose logs -f` — Ctrl+C **только выходит из просмотра**, контейнеры **не** гасит |
| Хочешь убедиться, что всё ещё живо | `docker compose ps` — у всех STATUS = `Up` |
| Реально остановить стек | только `docker compose down` (или Stop в Docker Desktop) |

Без `-d` (`docker compose up --build`) логи идут в терминал, и Ctrl+C **остановит** весь стек — для повседневной работы удобнее `-d`.

Первый раз может занять несколько минут (скачивание образов и сборка).  
Предупреждение MailHog `platform (linux/amd64) does not match … arm64` на Apple Silicon **безвредно**.

| Сервис | URL | Открыть в браузере |
|---|---|---|
| Web (интерфейс) | http://localhost:5173 | да |
| API (Swagger) | http://localhost:8000/docs | да |
| Health (JSON) | http://localhost:8000/api/health | да / или `curl` |
| MailHog (письма) | http://localhost:8025 | да |

Миграции применяются автоматически при старте `api`.

### 4. Проверка health

**macOS / Linux** (проверено на macOS):

```bash
curl -s http://localhost:8000/api/health
# ожидается "status":"ok" и worker.ok true (через пару секунд после старта)
```

**Windows (PowerShell)** (не проверено на этой системе):

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

### 5. Ручная проверка в браузере

1. Открыть http://localhost:5173  
2. «Создать аккаунт» → зарегистрироваться  
3. Создать заметку (Список или Календарь)  

Остановка: `docker compose down` (данные БД сохранятся) или `docker compose down -v` (сбросить БД).

Демо-пользователь `demo` / `demo` с 10 000 заметок создаётся отдельно: `make seed` (или эквивалент без make ниже).

---

## Для тестов

`make test`, `make e2e` и `make verify` выполняются **на хосте** (pytest / Playwright локально). Docker нужен для testcontainers (Postgres) и для стека e2e.

**Рекомендуемая ОС для тестов:** macOS или Linux / **WSL2**. На Windows без WSL2 цели Makefile не рассчитаны.

### Подготовка хоста

**macOS / Linux / WSL2** (venv проверено на macOS):

```bash
# из корня Notetaker
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
cd web && npm install && cd ..
```

**Windows PowerShell** (venv; **не проверено** на этой системе; для `make test/e2e` всё равно нужен WSL2):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r api\requirements.txt
cd web; npm install; cd ..
```

После этого на macOS/Linux/WSL2: `make test`, `make e2e`, `make verify` (или эквиваленты без make).

Без `.venv` `make test` попытается уйти в `docker compose run … pytest` (нужен доступ к Docker socket). `make e2e` всё равно требует `npm install` в `web/`.

---

## Команды: `make` и то же без `make`

Все примеры — из **корня репозитория**. Эквиваленты без make проверены по смыслу Makefile; полный прогон `test`/`e2e`/`verify` без make на чистой машине **на macOS совпадает с make** (те же docker/pytest/npx). На Windows/Linux — **не проверено**.

| Цель | С `make` | Без `make` |
|---|---|---|
| Поднять стек (foreground) | `make up` | `docker compose up --build` |
| Поднять стек (фон) | — | `docker compose up --build -d` |
| Остановить | `make down` | `docker compose down` |
| Seed 10k (`demo`/`demo`) | `make seed` | `docker compose exec api python scripts/seed.py --notes 10000` |
| Backend-тесты | `make test` | см. блок ниже |
| Playwright e2e | `make e2e` | см. блок ниже |
| Полный verify + отчёт | `make verify` | см. блок ниже |

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

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d
# дождаться готовности api и web, затем:
cd web && npx playwright install chromium && npx playwright test
cd ..
# вернуть обычный режим (хуки выкл.):
docker compose up -d --force-recreate --no-deps api
```

`make e2e` дополнительно ждёт health циклом и печатает коды ответа хуков (401 во время e2e, 404 после restore).

### `verify` без make

```bash
mkdir -p reports
TS=$(date +%Y%m%d-%H%M%S)
# 1) pytest → reports/pytest-$TS.xml  (как в блоке test)
# 2) e2e с JSON-репортером:
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d
cd web && npx playwright install chromium \
  && npx playwright test --reporter=json > ../reports/playwright-$TS.json
cd ..
docker compose up -d --force-recreate --no-deps api
# 3) отчёт T1–T21:
python3 scripts/verify_report.py \
  --junit reports/pytest-$TS.xml \
  --playwright reports/playwright-$TS.json \
  --out reports/verify-$TS.md \
  --pytest-rc 0 --e2e-rc 0
```

(Коды `--pytest-rc` / `--e2e-rc` подставьте по фактическому exit code прогонов.)

---

## E2E (Playwright)

```bash
make e2e
```

Что делает `make e2e`:
1. поднимает compose с override `docker-compose.e2e.yml` (`E2E_HOOKS=true` у api);
2. ждёт готовности api/web;
3. ставит Chromium при необходимости и гоняет тесты из `web/`;
4. пересоздаёт api **без** override — `/api/e2e/*` снова 404.

Обычный `docker compose up` хуки **не** включает.  
Вручную: `docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d`.

---

## Если что-то не работает

### «Сразу вернуло в shell — значит Docker остановился?»
Нет. При `docker compose up -d` возврат приглашения — ожидаемое поведение (см. таблицу в §3). Проверьте `docker compose ps` и http://localhost:5173.

### Docker не запущен
Сообщение вроде `Cannot connect to the Docker daemon`. Откройте Docker Desktop (или стартуйте сервис Docker на Linux) и повторите команду.

### Заняты порты
Стек слушает: **5173** (web), **8000** (api), **8025** / **1025** (MailHog), **5432** (postgres).

**macOS / Linux** (проверено на macOS для просмотра портов):

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:8025 -sTCP:LISTEN
lsof -nP -iTCP:1025 -sTCP:LISTEN
lsof -nP -iTCP:5432 -sTCP:LISTEN
```

Освободить: остановить чужой процесс или `docker compose down`, либо сменить порты в `docker-compose.yml` (не проверено).

**Windows (PowerShell)** (не проверено на этой системе):

```powershell
netstat -ano | findstr ":8000"
# затем Task Manager / taskkill по PID
```

### Предупреждение MailHog на Apple Silicon
При старте может быть: `The requested image's platform (linux/amd64) does not match … (linux/arm64)`. Для локальной разработки **безвредно** — MailHog работает через эмуляцию. Проверено на macOS Apple Silicon.

### Долгая первая сборка
`docker compose up --build` первый раз качает базовые образы (python, node, postgres, mailhog) и собирает api/web. Повторные запуски быстрее за счёт кэша слоёв.

### Первый `make e2e` качает Chromium
`npx playwright install chromium` скачивает браузер (~100+ MB). При таймауте CDN команда обычно ретраит зеркало; дождитесь окончания или повторите `cd web && npx playwright install chromium`.

### Хуки e2e «не находятся» (404)
В обычном режиме так и должно быть. Для Playwright нужен `make e2e` (или compose с `docker-compose.e2e.yml`).

---

## Как проверить работоспособность

1. Раздел «Развёртывание с нуля» → health → регистрация → заметка в UI.  
2. (Опционально) раздел «Для тестов» → `make test` → `make e2e` → `make verify`.  
3. Нагрузка: `make seed`, войти `demo` / `demo`, Список.  
4. Демо напоминания: `docker compose exec api python scripts/demo.py` (~2 минуты до toast/MailHog).

---

## Документы
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — лог решений с временем  
- [`docs/TOOLING.md`](docs/TOOLING.md) — чем делали и почему  
- [`docs/sessions/`](docs/sessions/) — экспорты чатов Cursor  
- [`docs/CREDITS.md`](docs/CREDITS.md) — чужие основы и зависимости  
- [`STATUS.md`](STATUS.md) — что работает, что нет, что дальше  
