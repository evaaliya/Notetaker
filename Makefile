.PHONY: up down seed test e2e verify

COMPOSE=docker compose
COMPOSE_E2E=docker compose -f docker-compose.yml -f docker-compose.e2e.yml

up:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

seed:
	docker compose exec api python scripts/seed.py --notes 10000

test:
	@if [ -x .venv/bin/pytest ]; then \
		cd api && ../.venv/bin/pytest -v; \
	else \
		docker compose run --rm \
			-e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
			-v /var/run/docker.sock:/var/run/docker.sock \
			api pytest -v; \
	fi

# Поднимает стек с E2E_HOOKS=true, гоняет Playwright, затем пересоздаёт api
# без override — обычный режим (ручки /api/e2e/* снова 404).
e2e:
	$(COMPOSE_E2E) up --build -d
	@echo "waiting for api/web..."
	@ok=0; for i in $$(seq 1 60); do \
		if curl -sf http://127.0.0.1:8000/api/health >/dev/null \
			&& curl -sf http://127.0.0.1:5173 >/dev/null; then ok=1; break; fi; \
		sleep 2; \
	done; \
	if [ "$$ok" != "1" ]; then echo "api/web not ready"; exit 1; fi
	@curl -sf -o /dev/null -w "e2e hooks (expect 401/422 not 404): %{http_code}\n" \
		-X POST http://127.0.0.1:8000/api/e2e/tick_reminders || true
	cd web && npx playwright install chromium && npx playwright test; \
	status=$$?; \
	echo "restoring api without E2E_HOOKS..."; \
	$(COMPOSE) up -d --force-recreate --no-deps api; \
	sleep 3; \
	code=$$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8000/api/e2e/tick_reminders || true); \
	echo "e2e hooks after restore (expect 404): $$code"; \
	exit $$status

# Полный прогон + отчёт T1–T21 в reports/verify-<время>.md
verify:
	@mkdir -p reports
	@TS=$$(date +%Y%m%d-%H%M%S); \
	JUNIT=reports/pytest-$$TS.xml; \
	PWJSON=reports/playwright-$$TS.json; \
	OUT=reports/verify-$$TS.md; \
	echo "=== pytest → $$JUNIT ==="; \
	if [ -x .venv/bin/pytest ]; then \
		(cd api && ../.venv/bin/pytest -v --junitxml=../$$JUNIT); PY_RC=$$?; \
	else \
		docker compose run --rm \
			-e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
			-v /var/run/docker.sock:/var/run/docker.sock \
			-v "$$(pwd)/reports:/reports" \
			api pytest -v --junitxml=/reports/pytest-$$TS.xml; PY_RC=$$?; \
	fi; \
	echo "=== e2e (with E2E_HOOKS) → $$PWJSON ==="; \
	$(COMPOSE_E2E) up --build -d; \
	ok=0; for i in $$(seq 1 60); do \
		if curl -sf http://127.0.0.1:8000/api/health >/dev/null \
			&& curl -sf http://127.0.0.1:5173 >/dev/null; then ok=1; break; fi; \
		sleep 2; \
	done; \
	if [ "$$ok" != "1" ]; then echo "api/web not ready"; exit 1; fi; \
	(cd web && npx playwright install chromium && \
		npx playwright test --reporter=json > ../$$PWJSON); E2E_RC=$$?; \
	echo "restoring api without E2E_HOOKS..."; \
	$(COMPOSE) up -d --force-recreate --no-deps api; \
	python3 scripts/verify_report.py \
		--junit $$JUNIT --playwright $$PWJSON --out $$OUT \
		--pytest-rc $$PY_RC --e2e-rc $$E2E_RC; \
	echo "report: $$OUT"; \
	if [ $$PY_RC -ne 0 ] || [ $$E2E_RC -ne 0 ]; then exit 1; fi
