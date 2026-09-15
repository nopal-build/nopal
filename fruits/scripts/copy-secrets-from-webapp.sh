#!/bin/sh
set -e

# =============================================================================
# copy-secrets-from-webapp.sh — ONE-TIME bootstrap: copies the secrets the
# app (fruits) needs from webapp's PROD app, the moment nopal-fruits is
# first created — before this split, all of this code (and therefore all
# of these secrets) lived in webapp itself. Read-then-set entirely within
# YOUR terminal (never through a third party's context), same pattern as
# webapp/scripts/copy-secrets-to-staging.sh — see that script's own
# comment for why `--machine` is required explicitly.
#
# Run this yourself, locally, once, right after `fly apps create nopal-fruits`:
#   sh fruits/scripts/copy-secrets-from-webapp.sh
#
# Safe to re-run any time these shared secrets rotate on webapp — it will
# just overwrite fruits' copies with the current values.
#
# Deliberately NOT copied (fruits-specific, set separately — see
# fruits/fly.toml itself, not `fly secrets`, since neither is sensitive):
#   WEBAUTHN_RP_ID, WEBAUTHN_ALLOWED_ORIGINS, APP_BASE_URL
# Deliberately NOT copied (webapp/marketing-only, fruits has no use for
# them): NOTION_TOKEN, NOTION_WEBHOOK_SECRET, DISCORD_BOT_TOKEN,
# DISCORD_CHANNEL_ID, WEBSITE_PROJECT_FOLDER_ID.
WEBAPP_PROD_APP="${WEBAPP_PROD_APP:-webapp-billowing-meadow-8538}"
FRUITS_PROD_APP="${FRUITS_PROD_APP:-nopal-fruits}"
WEBAPP_PROD_MACHINE="${WEBAPP_PROD_MACHINE:-}"

if [ -z "${WEBAPP_PROD_MACHINE}" ]; then
  WEBAPP_PROD_MACHINE=$(fly machine list --app "${WEBAPP_PROD_APP}" --json 2>/dev/null | grep -o '"id": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi
if [ -z "${WEBAPP_PROD_MACHINE}" ]; then
  printf 'Could not determine a webapp prod machine id — pass one explicitly:\n'
  printf '  WEBAPP_PROD_MACHINE=<id> sh fruits/scripts/copy-secrets-from-webapp.sh\n'
  exit 1
fi
printf 'Reading secrets from machine %s (%s)...\n' "${WEBAPP_PROD_MACHINE}" "${WEBAPP_PROD_APP}"

# Everything fruits actually needs at runtime — see fruits/app/util/
# email.server.ts (RESEND_API_KEY), robustness-core's db.server.ts
# (DATABASE_*), file.server.ts (AWS/S3), anthropicProvider.server.ts
# (ANTHROPIC_*, used by GraphLog/Maker), graphLogQueue.server.ts
# (REDIS_URL), and server.js's own cron jobs (CRON_SECRET,
# SORTER_ENABLED — the latter is a plain "true"/unset flag, not a real
# secret, but copied here anyway for convenience since it's simplest to
# keep it alongside everything else).
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
ANTHROPIC_API_KEY
ANTHROPIC_WORKSPACE_ID
REDIS_URL
CRON_SECRET
SORTER_ENABLED
NODE_ENV
"

printf 'Copying secrets from %s to %s...\n' "${WEBAPP_PROD_APP}" "${FRUITS_PROD_APP}"

for name in ${SECRETS}; do
  value=$(fly ssh console --app "${WEBAPP_PROD_APP}" --machine "${WEBAPP_PROD_MACHINE}" -C "printenv ${name}" 2>/dev/null | tr -d '\r')
  if [ -z "${value}" ]; then
    printf '  ⚠️  %s is empty on webapp — skipping\n' "${name}"
    continue
  fi
  fly secrets set --app "${FRUITS_PROD_APP}" "${name}=${value}" --stage >/dev/null
  printf '  ✓  %s\n' "${name}"
done

printf '\nDouble-check for anything NOT in this list before going live:\n'
printf '  fly secrets list --app %s\n' "${WEBAPP_PROD_APP}"
printf 'compared against:\n'
printf '  fly secrets list --app %s\n' "${FRUITS_PROD_APP}"
printf '\nAll secrets staged in one release (--stage above queues them without\n'
printf 'redeploying per-secret). Deploy now to apply them:\n'
printf '  fly deploy . --config fruits/fly.toml --dockerfile fruits/Dockerfile\n'
