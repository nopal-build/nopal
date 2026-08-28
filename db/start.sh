#!/bin/sh
set -e

# =============================================================================
# start.sh — SurrealDB entrypoint for Fly.io
#
# 1. Starts SurrealDB in the background.
# 2. Polls localhost until it accepts connections (up to 30 s).
# 3. Runs migrate.sh against localhost.
# 4. Waits on the SurrealDB process, forwarding signals cleanly.
# =============================================================================

USER="${SURREAL_USER:-root}"
PASS="${SURREAL_PASS:-root}"

# ── Start SurrealDB in the background ─────────────────────────────────────────
printf 'Starting SurrealDB...\n'
/surreal start --bind "[::]:8080" "surrealkv:///data/srdb.db" &
DB_PID=$!

# Forward SIGTERM / SIGINT to SurrealDB so Fly can shut it down cleanly.
trap 'kill "$DB_PID" 2>/dev/null' TERM INT

# ── Wait for SurrealDB to be ready ────────────────────────────────────────────
printf 'Waiting for SurrealDB to be ready'
i=0
until curl -sf "http://localhost:8080/health" >/dev/null 2>&1; do

  # Bail if SurrealDB exited unexpectedly.
  if ! kill -0 "$DB_PID" 2>/dev/null; then
    printf '\nSurrealDB process exited unexpectedly.\n' >&2
    exit 1
  fi

  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    printf '\nSurrealDB did not become ready within 30 s.\n' >&2
    exit 1
  fi

  printf '.'
  sleep 1
done
printf ' ready\n\n'

# ── Run migrations ─────────────────────────────────────────────────────────────
# SURREAL_ENDPOINT overrides the .internal URL that migrate.sh would otherwise
# build from FLY_APP_NAME — so migrations run against this machine directly.
SURREAL_ENDPOINT="http://localhost:8080" /bin/sh /migrate.sh

# ── Hand off ──────────────────────────────────────────────────────────────────
printf '\nDatabase ready.\n'
wait "$DB_PID"
