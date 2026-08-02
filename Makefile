.PHONY: dev start seed migrate migrate-prod down stop reset clean deploy restart cli release-cli update-cli-version

SURREAL_USER ?= root
SURREAL_PASS ?= root

# ── Prod database access (for data-migration scripts) ─────────────────────
DB_APP ?= db-thrumming-water-5938
PROXY_PORT ?= 8081

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

## Alias for `make dev`.
start: dev

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

## Run a data-migration script from webapp/scripts/ against the PROD database,
## tunneled through a temporary `fly proxy` (no public DB access required):
##   make migrate-prod SCRIPT=migrate-vault-root-keys.ts SURREAL_PASS=<prod-pass>
## SURREAL_USER defaults to root; the proxy is torn down when the script exits.
## Scripts should be idempotent — safe to re-run if anything goes sideways.
migrate-prod:
	@test -n "$(SCRIPT)" || { echo "Usage: make migrate-prod SCRIPT=<file in webapp/scripts/> SURREAL_PASS=<prod-pass>"; exit 1; }
	@test -f "webapp/scripts/$(SCRIPT)" || { echo "webapp/scripts/$(SCRIPT) not found"; exit 1; }
	@printf 'Run webapp/scripts/%s against PROD (%s) as %s? [y/N] ' "$(SCRIPT)" "$(DB_APP)" "$(SURREAL_USER)"; \
	read -r answer; \
	[ "$$answer" = "y" ] || { echo "Aborted."; exit 1; }; \
	echo "Opening tunnel to $(DB_APP) on localhost:$(PROXY_PORT)..."; \
	fly proxy $(PROXY_PORT):8080 -a $(DB_APP) & \
	PROXY_PID=$$!; \
	trap 'kill $$PROXY_PID 2>/dev/null' EXIT INT TERM; \
	for i in $$(seq 1 30); do \
		curl -s -o /dev/null http://localhost:$(PROXY_PORT)/health && break; \
		sleep 1; \
	done; \
	curl -s -o /dev/null http://localhost:$(PROXY_PORT)/health || { echo "Tunnel never became ready — is 'fly' logged in?"; exit 1; }; \
	echo "Tunnel ready — running $(SCRIPT) against prod..."; \
	cd webapp && DATABASE_URL=http://localhost:$(PROXY_PORT)/rpc \
		DATABASE_USERNAME=$(SURREAL_USER) DATABASE_PASSWORD=$(SURREAL_PASS) \
		npx vite-node scripts/$(SCRIPT)

## Restart the webapp container, clearing the Vite dep cache first.
## Use this after package changes or whenever the dev server needs a clean reload.
restart:
	docker compose exec webapp rm -rf /app/node_modules/.vite
	docker compose restart webapp

## Stop all containers (data is preserved in named volumes).
down:
	docker compose down

## Alias for `make down`.
stop: down

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

## Bump the nopal CLI's version and commit it — defaults to a PATCH bump:
##   make update-cli-version         (x.y.z -> x.y.z+1)
##   make update-cli-version MINOR   (x.y.z -> x.y+1.0)
##   make update-cli-version MAJOR   (x.y.z -> x+1.0.0)
## Follow with `make release-cli` to tag, push, and publish the release —
## or just pass PATCH/MINOR/MAJOR to release-cli directly (see below).
update-cli-version:
	@CURRENT=$$(grep -m1 '^version' crates/cli/Cargo.toml | cut -d '"' -f2); \
	MAJOR=$$(echo "$$CURRENT" | cut -d. -f1); \
	MINOR=$$(echo "$$CURRENT" | cut -d. -f2); \
	PATCH=$$(echo "$$CURRENT" | cut -d. -f3); \
	if echo "$(MAKECMDGOALS)" | grep -qw MAJOR; then \
		MAJOR=$$((MAJOR + 1)); MINOR=0; PATCH=0; \
	elif echo "$(MAKECMDGOALS)" | grep -qw MINOR; then \
		MINOR=$$((MINOR + 1)); PATCH=0; \
	else \
		PATCH=$$((PATCH + 1)); \
	fi; \
	NEW="$$MAJOR.$$MINOR.$$PATCH"; \
	perl -i -pe "s/^version = \".*\"/version = \"$$NEW\"/" crates/cli/Cargo.toml; \
	git add crates/cli/Cargo.toml; \
	git commit -m "Bump nopal CLI to v$$NEW"; \
	echo ""; \
	echo "  ✓ Bumped v$$CURRENT -> v$$NEW and committed."; \
	echo "    Next: make release-cli"

## No-op targets so bare-word modifiers (`make update-cli-version MAJOR`,
## `make release-cli PATCH`, etc.) don't error — the real targets read
## $(MAKECMDGOALS) instead of treating these as targets to build.
PATCH MAJOR MINOR:
	@:

## Tag and push a new nopal CLI release, optionally bumping the version
## first (via update-cli-version) in the same step:
##   make release-cli          (release whatever version is currently set)
##   make release-cli PATCH    (bump patch, then release)
##   make release-cli MINOR    (bump minor, then release)
##   make release-cli MAJOR    (bump major, then release)
## Either way this sanity-checks the dist config with `dist plan`, then tags
## (nopal-vX.Y.Z) and pushes, which triggers .github/workflows/release.yml
## to build and publish to GitHub Releases.
release-cli:
	@command -v dist >/dev/null 2>&1 || { echo "'dist' not found — install with: brew install axodotdev/tap/cargo-dist"; exit 1; }
	@if echo "$(MAKECMDGOALS)" | grep -qw MAJOR; then \
		$(MAKE) update-cli-version MAJOR; \
	elif echo "$(MAKECMDGOALS)" | grep -qw MINOR; then \
		$(MAKE) update-cli-version MINOR; \
	elif echo "$(MAKECMDGOALS)" | grep -qw PATCH; then \
		$(MAKE) update-cli-version; \
	fi
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
