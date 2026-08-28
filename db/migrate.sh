#!/bin/sh
set -e

# =============================================================================
# migrate.sh — SurrealDB tracked migration runner
#
# Scans migrations/ for files matching [0-9]*.surql (sorted by name), checks
# which ones have already been recorded in the `migration` table, and applies
# the pending ones in order. Each successful migration is recorded so it is
# never applied again.
#
# Usage — local (DB container must be running):
#   make migrate
#   Runs on the host; reaches /surreal inside the container via docker compose exec.
#
# Usage — Fly.io:
#   Invoked automatically via [deploy] release_command in fly.toml.
#   The release container (debian:bookworm-slim + surreal binary) has /bin/sh,
#   so /surreal is called directly.
#   Set credentials as Fly secrets:
#     fly secrets set SURREAL_USER=root DB_PASS=yourpassword
#   (The Makefile passes SURREAL_USER/SURREAL_PASS through as SURREAL_PASS/DB_PASS.)
# =============================================================================

NS="nopal"
DB="opuntia"

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Strip trailing slash so a root-level script (/migrate.sh → /) gives
# /migrations rather than //migrations.
MIGRATIONS_DIR="${MIGRATIONS_DIR:-${SCRIPT_DIR%/}/migrations}"

# ── .env ───────────────────────────────────────────────────────────────────────
# Load local credentials from db/.env if present.
# On Fly.io credentials come from Fly secrets instead — no .env in the container.
ENV_FILE="${SCRIPT_DIR}/.env"
if [ -f "${ENV_FILE}" ]; then
  . "${ENV_FILE}"
fi

USER="${SURREAL_USER:-root}"
PASS="${SURREAL_PASS:-root}"

printf "${USER} and ${PASS}"

# ── Connection & surreal command ───────────────────────────────────────────────
# On Fly.io the release machine has /surreal available and can reach the
# already-running database via Fly's internal load balancer.
# Locally the SurrealDB container has no shell, so the script runs on the host
# and invokes /surreal through docker compose exec.
if [ -n "$FLY_APP_NAME" ]; then
  ENDPOINT="${SURREAL_ENDPOINT:-http://${FLY_APP_NAME}.internal:8080}"
  _run_surreal() {
    /surreal sql \
      --endpoint "${ENDPOINT}" \
      --username "${USER}" \
      --password "${PASS}" \
      "$@"
  }
else
  ENDPOINT="${SURREAL_ENDPOINT:-http://localhost:8080}"
  _run_surreal() {
    docker compose exec -T db /surreal sql \
      --endpoint "${ENDPOINT}" \
      --username "${USER}" \
      --password "${PASS}" \
      "$@"
  }
fi

# ── SQL helpers ────────────────────────────────────────────────────────────────

# Root-level SQL (stdin). No namespace / database pre-selected.
# Used during bootstrap where the namespace may not exist yet.
root_sql() { _run_surreal "$@"; }

# SQL (stdin) pre-scoped to $NS / $DB.
app_sql() { _run_surreal --namespace "${NS}" --database "${DB}" "$@"; }

# Exit with an error if the SurrealDB response JSON contains an ERR status.
check_errors() {
  _out="$1"
  _label="$2"
  if printf '%s' "${_out}" | grep -q '"status":"ERR"'; then
    printf '\n✗  %s failed:\n%s\n' "${_label}" "${_out}" >&2
    exit 1
  fi
}

# ── Header ─────────────────────────────────────────────────────────────────────
printf 'SurrealDB migration runner\n'
printf 'endpoint : %s\n' "${ENDPOINT}"
printf 'target   : %s / %s\n\n' "${NS}" "${DB}"

# ── 1. Bootstrap ───────────────────────────────────────────────────────────────
# Idempotently creates the namespace, database, and migration-tracking table.
printf 'Bootstrapping...\n'
bootstrap_out=$(root_sql << EOF
DEFINE NAMESPACE IF NOT EXISTS ${NS};
USE NS ${NS}; DEFINE DATABASE IF NOT EXISTS ${DB};
USE NS ${NS} DB ${DB}; DEFINE TABLE IF NOT EXISTS migration SCHEMAFULL;
USE NS ${NS} DB ${DB}; DEFINE FIELD IF NOT EXISTS name   ON migration TYPE string;
USE NS ${NS} DB ${DB}; DEFINE FIELD IF NOT EXISTS run_at ON migration TYPE datetime VALUE time::now() READONLY;
USE NS ${NS} DB ${DB}; DEFINE INDEX IF NOT EXISTS migration_name_unique ON migration FIELDS name UNIQUE;
EOF
)
check_errors "${bootstrap_out}" "bootstrap"

# ── 2. Already-applied migrations ─────────────────────────────────────────────
applied=$(printf 'SELECT name FROM migration ORDER BY name ASC;' \
  | app_sql \
  | grep -o '"name":"[^"]*"' \
  | sed 's/"name":"//g; s/"//g')

# ── 3. Apply pending migrations ────────────────────────────────────────────────
applied_count=0
skipped_count=0

for filepath in "${MIGRATIONS_DIR}"/[0-9]*.surql; do
  # If the glob matched nothing, $filepath is still the literal pattern string.
  [ -f "${filepath}" ] || { printf 'No migration files found in %s\n' "${MIGRATIONS_DIR}"; break; }

  name=$(basename "${filepath}" .surql)

  if printf '%s\n' "${applied}" | grep -qxF "${name}"; then
    printf '  ↷  %s\n' "${name}"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  printf '  →  %s\n' "${name}"

  migration_out=$(cat "${filepath}" | app_sql)
  check_errors "${migration_out}" "${name}"

  record_out=$(printf 'CREATE migration SET name = "%s", run_at = time::now();' "${name}" | app_sql)
  check_errors "${record_out}" "recording ${name}"

  applied_count=$((applied_count + 1))
done

printf '\n✓  %d applied, %d skipped.\n' "${applied_count}" "${skipped_count}"
