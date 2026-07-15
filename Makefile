.PHONY: dev seed migrate down reset clean deploy restart cli release-cli

SURREAL_USER ?= root
SURREAL_PASS ?= root

# ── Full-stack dev lifecycle ───────────────────────────────────────────────────

## Run unit tests and deploy the webapp to Fly.io.
deploy:
	cd webapp && npm test -- --run
	cd db && fly deploy
	cd webapp && fly deploy

## Start the database and webapp together, then seed the database.
dev:
	docker compose up -d --wait

	@echo ""
	@echo "  ✓ SurrealDB  →  http://localhost:8080"
	@echo "  ✓ Webapp     →  http://localhost:3000"
	@echo "  ✓ Logs       →  http://localhost:9999"
	@echo ""

## Seed the running database with default namespaces, databases, and users.
## Depends on migrate so the tables exist before data is inserted.
seed: migrate
	cat db/seed.surql | docker compose exec -T db /surreal sql \
		--endpoint http://localhost:8080 \
		--user $(SURREAL_USER) \
		--pass $(SURREAL_PASS) \
		--pretty
	cd webapp && DATABASE_USERNAME=$(SURREAL_USER) DATABASE_PASSWORD=$(SURREAL_PASS) npm run seed:data
	@echo ""
	@echo "  DB users:"
	@echo "    root   user: $$SURREAL_USER        pass: $$SURREAL_PASS"
	@echo "    admin  user: admin            pass: adminpassword  (NS nopal)"
	@echo "    app    user: app              pass: apppassword    (DB nopal/dev)"
	@echo ""

## Run database migrations against the running local database.
migrate:
	sh db/migrate.sh

## Restart the webapp container, clearing the Vite dep cache first.
## Use this after package changes or whenever the dev server needs a clean reload.
restart:
	docker compose exec webapp rm -rf /app/node_modules/.vite
	docker compose restart webapp

## Stop all containers (data is preserved in named volumes).
down:
	docker compose down

## Destroy all data and start fresh.
reset: clean dev migrate seed

## Stop all containers and delete all named volumes — all data will be lost.
clean:
	docker compose down -v

## Run the nopal CLI (e.g. `make cli ARGS="login"` or `make cli ARGS="whoami"`).
## Prefer `./bin/nopal <args>` directly during day-to-day testing — same thing,
## without the ARGS="..." quoting.
cli:
	./bin/nopal $(ARGS)

# ── nopal CLI releases ────────────────────────────────────────────────────────────────

## Tag and push a new nopal CLI release. First bump `version` in
## crates/cli/Cargo.toml and commit that, then run `make release-cli` —
## it reads the version from there, sanity-checks the dist config with
## `dist plan`, then tags (nopal-vX.Y.Z) and pushes, which triggers
## .github/workflows/release.yml to build and publish to GitHub Releases.
release-cli:
	@command -v dist >/dev/null 2>&1 || { echo "'dist' not found — install with: brew install axodotdev/tap/cargo-dist"; exit 1; }
	@VERSION=$$(grep -m1 '^version' crates/cli/Cargo.toml | cut -d '"' -f2); \
	TAG="nopal-v$$VERSION"; \
	if git rev-parse "$$TAG" >/dev/null 2>&1; then \
		echo "Tag $$TAG already exists — bump 'version' in crates/cli/Cargo.toml first."; \
		exit 1; \
	fi; \
	echo "Validating dist config for $$TAG..."; \
	dist plan --tag="$$TAG" || exit 1; \
	echo ""; \
	echo "Tagging and pushing $$TAG..."; \
	git tag "$$TAG" && git push origin "$$TAG"; \
	echo ""; \
	echo "  ✓ Pushed $$TAG — GitHub Actions will build and publish the release."; \
	echo "    Watch:   gh run list --workflow=Release --limit 1"; \
	echo "    Release: https://github.com/gwing33/nopal/releases/tag/$$TAG"
