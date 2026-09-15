#!/bin/sh
set -e

# =============================================================================
# copy-secrets-to-staging.sh — Copies prod fruits secrets to the staging
# app, read-then-set entirely within YOUR terminal (never through a third
# party's context) — exact mirror of
# webapp/scripts/copy-secrets-to-staging.sh; see that script's own comment
# for why `--machine` is required explicitly.
#
# Run this yourself, locally (AFTER copy-secrets-from-webapp.sh has
# bootstrapped nopal-fruits' own secrets at least once):
#   sh fruits/scripts/copy-secrets-to-staging.sh
#
# Safe to re-run any time prod secrets rotate.
PROD_APP="${PROD_APP:-nopal-fruits}"
STAGING_APP="${STAGING_APP:-fruits-staging}"
PROD_MACHINE="${PROD_MACHINE:-}"

if [ -z "${PROD_MACHINE}" ]; then
  PROD_MACHINE=$(fly machine list --app "${PROD_APP}" --json 2>/dev/null | grep -o '"id": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi
if [ -z "${PROD_MACHINE}" ]; then
  printf 'Could not determine a prod machine id — pass one explicitly:\n'
  printf '  PROD_MACHINE=<id> sh fruits/scripts/copy-secrets-to-staging.sh\n'
  exit 1
fi
printf 'Reading secrets from machine %s...\n' "${PROD_MACHINE}"

# Every secret staging should share with prod verbatim. DATABASE_DATABASE
# is deliberately NOT in this list — it's set via [env] in
# fruits/fly.staging.toml instead, to the isolated `staging` database.
# ANTHROPIC_API_KEY/ANTHROPIC_WORKSPACE_ID are ALSO deliberately excluded —
# same reasoning webapp's own staging copy already applies: staging
# shouldn't make real LLM calls against a live API budget. GraphLog/Maker
# pages will simply fail on staging, which is fine — nothing there is
# customer-facing.
SECRETS="
DATABASE_URL
DATABASE_USERNAME
DATABASE_PASSWORD
SESSION_SECRET
ENCRYPTION_SECRET
RESEND_API_KEY
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
BUCKET_NAME
S3_ENDPOINT
S3_PUBLIC_HOSTNAME
REDIS_URL
CRON_SECRET
NODE_ENV
"

printf 'Copying secrets from %s to %s...\n' "${PROD_APP}" "${STAGING_APP}"

for name in ${SECRETS}; do
  value=$(fly ssh console --app "${PROD_APP}" --machine "${PROD_MACHINE}" -C "printenv ${name}" 2>/dev/null | tr -d '\r')
  if [ -z "${value}" ]; then
    printf '  ⚠️  %s is empty on prod — skipping\n' "${name}"
    continue
  fi
  fly secrets set --app "${STAGING_APP}" "${name}=${value}" --stage >/dev/null
  printf '  ✓  %s\n' "${name}"
done

printf '\nStaging deploys with all secrets staged in one release (--stage above\n'
printf 'queues them without redeploying per-secret). Deploy now to apply them:\n'
printf '  make deploy-staging\n'
