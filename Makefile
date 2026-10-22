.PHONY: up down seed test e2e verify

up:
	docker compose up --build

down:
	docker compose down

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

e2e:
	cd web && npx playwright test

verify:
	@mkdir -p reports
	@TS=$$(date +%Y%m%d-%H%M%S); \
	{ echo "# verify $$TS"; echo; \
	  docker compose run --rm api pytest -v 2>&1; \
	  cd web && npx playwright test 2>&1; } | tee reports/verify-$$TS.md
