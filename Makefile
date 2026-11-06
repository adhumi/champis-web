# Site champis.app (adhumi/champis-web). `make help` liste les cibles.
UV := uv run

.DEFAULT_GOAL := help

.PHONY: help
help: ## Cette aide
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z_-]+:.*## / { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: setup
setup: ## Sous-module du référentiel et environnement de test (uv sync --group dev)
	git submodule update --init champis
	uv sync --group dev

.PHONY: serve
serve: ## Site local : http://localhost:8080/web/ (l'API locale de champis-api est attendue sur :8000)
	python3 -m http.server 8080

.PHONY: test
test: ## Tests (Python + node, sans réseau)
	$(UV) pytest $(ARGS)

.PHONY: check
check: ## Exactement la CI (hors validation Caddy, faite par la CI dans Docker)
	$(UV) ruff check .
	$(UV) ruff format --check .
	$(UV) pytest

.PHONY: smoke
smoke: ## Contrôle un site qui tourne : make smoke URL=https://champis.app (défaut http://localhost:8080)
	sh scripts/smoke.sh $(URL)

.PHONY: referential
referential: ## Met le sous-module champis/ (référentiel) à la dernière version de main, à committer ici
	git submodule update --init --remote champis
	git -C champis log --oneline -1
