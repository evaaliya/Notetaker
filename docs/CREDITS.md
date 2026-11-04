# Чужие основы и зависимости

**Стартовый шаблон / генератор:** не использовались. Репозиторий собран с нуля по `spec.md`.

## Основные библиотеки

Сверено с `api/requirements.txt` и `web/package.json` (M24).

| Библиотека | Зачем |
|---|---|
| FastAPI, Uvicorn, python-multipart | HTTP API (+ multipart uploads M9) |
| SQLAlchemy 2 (asyncio), asyncpg, greenlet | async ORM и драйвер Postgres |
| Alembic, psycopg2-binary | миграции (sync-путь; см. D-008) |
| pydantic-settings | конфиг из env |
| argon2-cffi | хеш паролей |
| httpx | HTTP-клиент: тесты API, YouTube Innertube/timedtext, OpenRouter |
| React 18, react-dom, Vite, TypeScript, `@vitejs/plugin-react` | frontend / сборка |
| react-router-dom | маршруты UI |
| TanStack Query | кэш; инвалидация по WS |
| TanStack Virtual (`@tanstack/react-virtual`) | виртуализация списка заметок |
| FullCalendar 6 (`@fullcalendar/core`, react, daygrid, timegrid, interaction, luxon3) + luxon | календарь + DnD; IANA-пояса сетки |
| `@fontsource/inter`, `@fontsource/manrope` | локальные шрифты UI (без CDN) |
| `lucide-react` | иконки навигации и иллюстраций заметок |
| IndexedDB (браузерный API) | черновик `/notes/new` + очередь файлов (D-057); outbox мутаций офлайн (M22, D-119); без npm-обёртки |
| OpenRouter (HTTP API) | опциональный `AI_PROVIDER=openrouter` для extract (M11); ключ только из env |
| YouTube IFrame API | встраивание роликов на `/capture/video` (M11); грузится с youtube.com |
| YouTube Innertube `youtubei/v1/player` (client ANDROID) + timedtext / captionTracks | субтитры без скачивания медиа (M11, D-067); preference языка — `audioTracks[…]` (D-109) |
| Web Speech API | живой конспект звонка в браузере (M11); без записи на сервер |
| pytest, pytest-asyncio, testcontainers | тесты на реальном Postgres |
| Playwright (`@playwright/test`) | e2e (T2/T3/T13–T17 UI и расширения M9+) |
| PostgreSQL 16 | БД (`citext`, `pg_trgm`, `SKIP LOCKED`, `LISTEN/NOTIFY`) |
| MailHog | SMTP-заглушка |
| Docker / Docker Compose | локальный стек (api, worker, web, postgres, mailhog) |

Dev-типы frontend (`@types/react`, `@types/react-dom`, `@types/node`, `@types/luxon`) — только для сборки TypeScript; в рантайме не используются.

Обновлять, если по ходу работы зависимости добавились или заменились.

## Ассеты

| Ассет | Источник |
|---|---|
| `web/src/assets/logo-nt.jpg` | логотип — файл автора проекта |
| `web/public/m11-sample.mp4` | короткий CC0-ролик (MDN interactive-examples flower) для e2e видео без внешней сети |

## Код, написанный с агентом

Основная часть кода продукта написана с участием AI-агента в **Cursor** (режим Auto; конкретные модели — в `docs/TOOLING.md`, с пометками [УТОЧНИТЬ У АВТОРА] где нужно). Экспорты чатов — в `docs/sessions/`.

Черновик `spec.md` и сверка требований до кода — во внешних чатах Claude / ChatGPT / Gemini (детали в `docs/TOOLING.md`). Не утверждаем одну единственную модель на весь проект: маршрутизация Auto могла менять бэкенд между сессиями.
