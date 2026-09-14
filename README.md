# Nopal

We are a company focused on building homes for humans. Everything we do is open source and transparent. We look to learn and share all our information.

This repo houses all our software that helps us communicate, learn and share knowledge as well as provides us a space to build software tooling that can help us manage projects, cost estimates and define wall assemblies.

## Tech Stack
Remix for our front-end.

### Helpful commands:

```
# Run Dev Environment (Makefile)
$ make dev

# Older - - -

# Nopal CLI
$ cd ./crates
$ cargo run --package cli test
$ cargo run --package cli record-load-cell

# Nopal API
$ cd ./crates
$ cargo run --package nopal-api
# Run the gRPC server
$ grpcui --plaintext 0.0.0.0:8080
```

## Local development domains

`make dev` also brings up a local [Caddy](https://caddyserver.com) reverse
proxy (see `Caddyfile`) so the webapp is reachable at custom hostnames
instead of bare `localhost:3000` — `nopal.dev` for the marketing site and
`o.nopal.dev` reserved for the product app once it's split into its own
service (see `docs/marketing-app-split-plan.md`). Both currently point at
the same webapp container until that split happens.

One-time setup (both steps are required — `.dev` hostnames are forced to
HTTPS by every major browser, so this isn't optional the way it might be
with e.g. `.local` or `.test`):

1. Add these to `/etc/hosts` (can't be automated from inside a container):
   ```
   127.0.0.1 nopal.dev
   127.0.0.1 o.nopal.dev
   ```
2. Run `make trust-local-certs` to trust Caddy's local CA (macOS only for
   now — see the target's own comment in the `Makefile` for the manual
   Linux equivalent).

After that, `https://nopal.dev` and `https://o.nopal.dev` work like any
other HTTPS site — no cert warnings, and WebAuthn/passkeys work correctly
(they require a secure context, which a custom `http://` hostname doesn't
satisfy). Plain `http://localhost:3000` keeps working too, unchanged, if you
prefer not to bother with any of this.


# Deploy

This site uses fly.io, across three separate apps (`db`, `webapp`, the
GraphLog `worker` — see each one's own `fly.toml`) plus a staging copy of
the webapp (`webapp/fly.staging.toml`, see `db/README.md`'s "Staging
environment" section).

## Deploy pipeline

`.github/workflows/deploy.yml` runs on every push to `main`:

1. **`test`** — `pnpm --filter remix run test --run`.
2. **`deploy-staging`** — deploys the webapp to `nopal-webapp-staging`
   automatically once tests pass. No approval needed.
3. **`deploy-production`** — deploys `db`, `webapp`, and `worker` to
   production, but only once a required reviewer approves the run (the
   `production` GitHub Environment, Settings -> Environments, has
   required reviewers configured). Find the pending run under the repo's
   **Actions** tab to approve or reject it.

All three Fly apps deploy through one `FLY_API_TOKEN` repo secret — an
org-scoped deploy token (`fly tokens create org`), since the pipeline
touches more than one app. Rotate it the same way (`fly tokens create
org -o personal`, then `gh secret set FLY_API_TOKEN`) if it's ever leaked
or simply due for renewal (created with a 1-year expiry).

### Discord notifications

Both `deploy-staging` and `deploy-production` post a result (success or
failure, with commit/actor/run link) to Discord via
`.github/actions/notify-discord`, a small composite action that posts to
an incoming webhook — deliberately NOT the app's own `DISCORD_BOT_TOKEN`/
`DISCORD_CHANNEL_ID` (those are unused today and a bot token is broader-
scoped than this needs). Requires a `DISCORD_WEBHOOK_URL` repo secret
(Discord: Server Settings -> Integrations -> Webhooks -> New Webhook,
then `gh secret set DISCORD_WEBHOOK_URL`); silently skipped (a log line,
not a failure) if that secret isn't set.

## Manual deploys

Still available if you need to deploy outside the pipeline (a hotfix, or
while iterating before a PR merges):

```bash
make deploy          # db + webapp + worker, to production
make deploy-staging  # webapp only, to staging
```
