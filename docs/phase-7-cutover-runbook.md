# Phase 7 cutover runbook — provisioning `o.nopal.build` and going live

Status: not started. This is the one phase of
`docs/marketing-app-split-plan.md` that needs real Fly/DNS access this
agent doesn't have in this environment (`fly auth whoami` here returns "no
access token available") — everything that CAN be prepared without that
access (code, scripts, `fly.toml` config) is already done; this doc is the
exact, ordered command sequence for the parts that need a human (or an
agent with real credentials) at the keyboard.

**Read the whole thing once before running anything** — the ordering
matters more than usual here, for one reason worth understanding up
front:

## The one thing that can go wrong if you skip ahead

`.github/workflows/deploy.yml`'s `deploy-staging` job runs
**automatically, with no approval gate, on every push to `main`** — and
it now deploys `fruits-staging` (see Phase 3) in the same run as
`nopal-webapp-staging`. `webapp` also now carries the legacy `/fruits`
etc. redirect (see `webapp/server.js`) pointed at `APP_BASE_URL`.

If this branch merges to `main` before the Fly apps below exist, the
automatic staging deploy simply fails (deploying to a nonexistent Fly app
errors out) — annoying, not dangerous. But **do the app-creation +
secrets steps below BEFORE merging to `main`** regardless, so that first
automatic staging deploy actually succeeds instead of needing a retry.

Production is safer by construction: `deploy-production` requires a
manual reviewer approval (`production` GitHub Environment) before it
runs, and it deploys `webapp` (redirect code included) and `fruits`
together in that same approved run — so as long as `o.nopal.build`'s DNS
+ cert (below) are ready and `nopal-fruits` has its secrets *before* you
approve that run, both land together and there's no window where webapp
is redirecting to a host that isn't actually serving anything yet.

## 0. Pre-flight

- [ ] You're logged into the right Fly org: `fly auth whoami`.
- [ ] This branch's code is what you intend to ship (Phases 0–6 of
      `docs/marketing-app-split-plan.md` — confirm `git log` matches your
      expectation).
- [ ] You have prod's SurrealDB password handy (needed for
      `clone-staging-db` later) and DNS registrar access for `nopal.build`.

## 1. Create the Fly apps

```sh
fly apps create nopal-fruits
fly apps create fruits-staging
```

If either name is taken (Fly app names are globally unique), pick another
and update `app = '...'` in `fruits/fly.toml` / `fruits/fly.staging.toml`
to match — everything else in this runbook and those files' own comments
already assumes whatever name ends up there, so keep the two in sync.

## 2. Bootstrap secrets

```sh
sh fruits/scripts/copy-secrets-from-webapp.sh   # webapp prod -> nopal-fruits
sh fruits/scripts/copy-secrets-to-staging.sh    # nopal-fruits -> fruits-staging
```

Then sanity-check nothing was missed — compare the two lists by eye:

```sh
fly secrets list --app webapp-billowing-meadow-8538
fly secrets list --app nopal-fruits
```

(Only names/digests are shown, never values — see either script's own
comment for why they read values off a running machine instead.)

`WEBAUTHN_RP_ID` and `APP_BASE_URL` are **not** set via `fly secrets` —
they're plain (non-sensitive) `[env]` entries already committed in
`fruits/fly.toml` / `webapp/fly.toml`, so they ship with the code itself.
Nothing to do here for those two.

## 3. Deploy to staging first

```sh
make deploy-staging
```

(Deploys both `webapp` and `fruits` to their staging apps — see the
Makefile's own comment.)

```sh
make clone-staging-db SURREAL_PASS=<prod-pass>
```

(Only needs to happen once, or whenever staging has gone stale — see
`db/README.md`'s "Staging environment" section. Reminder from
`fruits/fly.toml`'s own comment: the passkey credentials this clones in
from prod will NOT work for passkey login on staging, before or after
this migration — its hostname never matches their real `rpID`. This is
pre-existing and not something to debug. TOTP/email-code login is
unaffected and is the right way to test login on staging.)

## 4. Manual QA pass on staging

Against `https://fruits-staging.fly.dev` (or whatever custom domain you
give it, if any — not required for staging):

- [ ] `/login` → TOTP email code → lands on the dashboard (`/`).
- [ ] `/daily-log` — write an entry, confirm it saves.
- [ ] `/vault` — browse folders, upload a small file.
- [ ] `/maker`, `/maker/graphlog` — loads for an Admin/Super account
      (GraphLog itself will fail without `ANTHROPIC_API_KEY` on staging —
      expected, see the secrets script's own comment; you're checking
      the page loads and shows a sane error, not that a real run
      succeeds).
- [ ] `/styles` — the living style guide renders.

Against `https://nopal-webapp-staging.fly.dev`:

- [ ] `/`, `/about`, `/contact` still load.
- [ ] `/fruits`, `/login`, `/api/vault/upload` each return a `308` to the
      equivalent `fruits-staging.fly.dev` path (confirms the redirect +
      `APP_BASE_URL` wiring — see `webapp/fly.staging.toml`'s own
      comment for why staging points `APP_BASE_URL` at `fruits-staging`
      rather than prod).

## 5. DNS + TLS for `o.nopal.build`

```sh
fly certs create o.nopal.build --app nopal-fruits
```

This prints the exact DNS record to add (almost certainly a `CNAME`
pointing at `nopal-fruits.fly.dev`, since `o.nopal.build` is a subdomain,
not an apex domain — apex domains need `A`/`AAAA` instead, which is not
this case). Add whatever it prints in your DNS registrar/provider for
`nopal.build`, then confirm:

```sh
fly certs show o.nopal.build --app nopal-fruits
```

Wait for this to report the cert as fully issued (DNS propagation can
take anywhere from a minute to a few hours depending on your registrar's
TTL) before moving on — a green cert here is your actual go/no-go signal
for step 7, not "did the command return".

## 6. Merge to `main`

Only now — after steps 1–5 are done and staging QA (step 4) looks right.
Pushing this to `main` immediately triggers the automatic
`deploy-staging` job (should succeed cleanly, everything above already
made staging match this exact code) and queues `deploy-production`
waiting on approval.

## 7. Approve the production deploy

Find the pending run under the repo's **Actions** tab. Before approving,
re-confirm:

- [ ] `fly certs show o.nopal.build --app nopal-fruits` shows the cert as
      fully issued (step 5).
- [ ] `nopal-fruits` has all its secrets (step 2).

Then approve. This deploys `db` (migrations), `webapp` (redirect code +
`APP_BASE_URL=https://o.nopal.build` live), `nopal-fruits`, and `worker`,
in that order, in one run.

## 8. Verify production, immediately

- [ ] `https://o.nopal.build/login` loads.
- [ ] **Passkey login, with a real existing account that has one
      registered** — this is the single most important check in this
      entire runbook. It's the one thing that silently breaks with no
      error message pointing at the cause if `WEBAUTHN_RP_ID` isn't
      correctly picked up (see `fruits/fly.toml`'s own comment on why
      this must be pinned to `nopal.build`, not derived from
      `o.nopal.build`). If this fails, do NOT wait — see "Rollback"
      below.
- [ ] `https://nopal.build/fruits`, `/login`, `/api/vault/upload` each
      308 to the equivalent `https://o.nopal.build/...` path.
- [ ] Existing bookmarks/emails with old `/fruits/...` links (check a
      real recent invite/notification email if one's handy) land in the
      right place.
- [ ] `nopal whoami` with an EXISTING CLI login still works unmodified
      (this exercises `migrate_legacy_host` rewriting the saved
      `nopal.build` host to `o.nopal.build` on disk — see
      `crates/core/src/auth.rs`). Then `nopal vault open` opens
      `o.nopal.build/vault`, not `nopal.build/fruits/vault`.
- [ ] Watch Fly's logs/metrics for both apps for at least the next hour,
      not just the first few minutes — `bluegreen` deploys succeed even
      if a LOW-traffic code path (an uncommon route, an edge case in the
      redirect logic) is broken, since the health check only exercises
      `/api/health`.

### Rollback

Both `webapp` and `fruits` deploy with `strategy = 'bluegreen'` — Fly
keeps the previous machine generation until the new one passes health
checks, and `fly releases` / `fly deploy --image <previous>` can revert
either app independently if something's wrong post-cutover. The riskiest
single failure mode (passkey login) has no code-level fallback — if
`WEBAUTHN_RP_ID` was somehow wrong, the fix is correcting the secret/env
var and redeploying `fruits`, not rolling back webapp.

## 9. Cut the CLI release

Deliberately held back until now — see `docs/marketing-app-split-plan.md`
Phase 6's own note (an earlier CLI release would have shipped a
new-login default pointing at a host that didn't serve anything yet).

```sh
make release-cli PATCH   # or MINOR, matching how much else has shipped since the last release
```

Existing CLI installs don't need this release to keep working —
`migrate_legacy_host` (step 8's `nopal whoami` check) handles them
automatically on next use, regardless of which CLI version they're
running, as long as it's new enough to include that migration (i.e. this
change, whenever it was actually built into a release before this point —
if this is the FIRST release containing it, then yes, existing users do
need to upgrade before the migration can run at all; `nopal update`
handles that for them the next time they run any command, per
`crates/cli/src/update.rs`).

## 10. Cleanup (later, not now)

- Once confident no meaningful traffic still hits the legacy redirects
  (check Fly logs for `webapp`'s `308`s trailing off), the redirect block
  in `webapp/server.js` can be simplified or removed — no rush, it costs
  nothing to leave indefinitely.
- Revisit `docs/status-page-spec.md` once this is stable — a real
  `status.nopal.build` matters more once there are two independently-
  failable services instead of one.
