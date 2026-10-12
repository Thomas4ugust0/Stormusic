PY ?= .venv/bin/python
VENDOR := app/static/vendor

.PHONY: install test lint typecheck security vendor up down logs migrate key

install:
	python3 -m venv .venv && $(PY) -m pip install -e '.[dev]'

test:
	$(PY) -m pytest

lint:
	$(PY) -m ruff check app tests migrations

typecheck:
	$(PY) -m mypy app

security:
	$(PY) -m bandit -q -r app && $(PY) -m pip_audit

vendor:
	sh scripts/fetch_docs_assets.sh

up: vendor
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f api worker

migrate:
	docker compose run --rm migrate

key:
	docker compose run --rm api python -m app.cli create-key $(NAME)
