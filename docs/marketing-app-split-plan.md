# Splitting `nopal.build` (marketing) from the app (`o.nopal.build`)

Status: Phases 0–4 done, plus the internal-linking half of Phase 5 (see
Phase 3's own writeup for why 3/4/5 ended up as one combined pass). The
app (`fruits/`) is fully split out and passing every validation check
locally at `o.nopal.dev`. Not done yet: Phase 5's cross-service email-
link audit beyond what Phase 3 already covered, Phase 6 (CLI/desktop app
compatibility), and Phase 7 (actual Fly infra — provisioning the new app,
DNS, staging rehearsal, prod cutover). This is a planning doc, not a
changelog — update it as decisions get made or revised.

## Goal

Today `webapp/` serves both:
- The marketing site (`nopal.build`, `/about`, `/tools/*`, `/good/*`, etc.)
- The product ("fruits" — Daily Log, Vault, Maker, Projects) under `nopal.build/fruits/*`

Target end state:
- `nopal.build` → marketing site only.
- `o.nopal.build` → the product, and the `/fruits` prefix goes away entirely
  (`/fruits/vault` → `/vault`, `/fruits/maker` → `/maker`, root `/fruits` → `/`).
- Local dev: `nopal.dev` (marketing) and `o.nopal.dev` (app) instead of
  `localhost:3000`.

The good news: this monorepo already extracted its data layer
(`packages/robustness-core`), markdown engine (`packages/oxmarkdown-core`),
and design system (`packages/stamps`) into shared pnpm workspace packages, and
already runs a second independently-deployed service (`packages/worker`) off
the same workspace. The split described here follows that exact,
already-proven pattern — it's not a new architecture for this repo, just one
more workspace member.

## Critical risks found during research (read before starting)

These are the non-obvious landmines. Each one is a silent-breakage risk if
missed, not a hypothetical.

### 1. WebAuthn (passkey) RP ID is derived from the request hostname

`app/modules/auth/webauthn.server.ts`:
```ts
function getRpID(request: Request): string {
  return new URL(request.url).hostname;
}
```
Every registered passkey is bound to whatever hostname served the
registration ceremony. Today that's always `nopal.build` (fruits lives at
`nopal.build/fruits`). The instant login/passkey endpoints are served from a
different host (`o.nopal.build`) *without changing this function*, `getRpID`
silently returns `"o.nopal.build"` instead of `"nopal.build"` — and **every
existing user's passkey stops verifying** (RP ID mismatch), locking them out
with no obvious error message pointing at the cause.

Fix (must ship *before* any host change, as its own no-op-in-prod deploy):
- Pin `rpID` to an explicit env var (`WEBAUTHN_RP_ID`), not the request
  hostname — `"nopal.build"` in prod, `"nopal.dev"` locally. WebAuthn allows
  `rpID` to be the *registrable domain* of the origin, so `"nopal.build"`
  stays valid whether the request actually landed on `nopal.build` or
  `o.nopal.build`.
- Change `getOrigin`'s single expected origin into an **allow-list**
  (`expectedOrigin: string[]`) containing both `https://nopal.build` and
  `https://o.nopal.build` (and the `.dev` equivalents), since
  `@simplewebauthn/server` checks origin exactly, separately from `rpID`.
- Deploy this first, alone, and confirm existing passkey login still works in
  prod — it should be a behavior no-op there today since hostname already
  equals `nopal.build`.

### 2. Session cookie has no explicit `domain`

`app/modules/auth/session.server.ts` sets the `_auth` cookie with no
`domain`, so it defaults to the exact host that set it. If login stays
reachable from both `nopal.build` and `o.nopal.build` at any point (even
transiently during rollout), the session won't carry over between them.

Decision needed (see "Open questions" below) — either:
- **(a)** Move login/passkey/logout/verify/magic-link/welcome entirely to
  `o.nopal.build` and never serve them from `nopal.build` (marketing's "Log
  in" button just links out). No cross-domain cookie needed at all. **This is
  the recommended option** — simplest, matches how the CLI already treats
  auth as an app concern (`POST {host}/api/cli-auth/exchange`).
- **(b)** Keep login on `nopal.build` and share the cookie: set
  `domain: ".nopal.build"` (env-driven, so dev can use `.nopal.dev`) so both
  hosts read the same session.

Either way, both services need to decode the *same* cookie (same
`SESSION_SECRET`, same cookie name) — which means the auth/session module
needs to be shared code (see Phase 2), not copy-pasted.

### 3. The CLI and desktop app hardcode `nopal.build`, and cache it per-user

`crates/cli/src/main.rs` / `crates/app/src/main.rs`:
```rust
pub const DEFAULT_HOST: &str = "https://nopal.build";
```
and `crates/core/src/auth.rs` persists whatever host a user logged in with to
`~/.nopal/credentials.json` (`Credentials { host, token, email, ... }`) —
**every subsequent API call reuses that saved host forever**, it's never
re-derived from `DEFAULT_HOST`. `crates/cli/src/vault.rs` also builds
browser-opening URLs like `format!("{}/fruits/vault", client.host)`.

Impact: once `/api/*` moves to `o.nopal.build`, every already-logged-in CLI/
desktop-app user keeps silently POSTing to `nopal.build/api/*` until they
re-login. If `nopal.build` stops serving those routes outright, their CLI
just breaks with a 404, with no explanation.

Recommended fix (mirrors a migration pattern already in that file — see the
keychain→file one-time migration in `load_credentials()`):
- Bump `DEFAULT_HOST` to `https://o.nopal.build` for new logins.
- Add a one-time rewrite in `load_credentials()`: if the saved
  `creds.host == "https://nopal.build"`, rewrite it to
  `"https://o.nopal.build"` before returning (ship this in the same CLI
  release that flips `DEFAULT_HOST`).
- Update `vault.rs`'s URL builders to drop the `/fruits` prefix
  (`{host}/vault`, not `{host}/fruits/vault`).
- As a safety net (not the primary fix), keep `nopal.build` returning a
  `308 Permanent Redirect` for `/api/*` and `/fruits*` for a deprecation
  window — but verify `reqwest` actually forwards the `Authorization` header
  across that cross-host redirect before relying on it; don't assume it does.
- This affects a small, known set of users (invite-only product per
  `privacy.tsx`) — a direct heads-up + "please update the CLI" message is a
  legitimate fallback if the auto-migration above is skipped for time.

### 4. Dropping `/fruits` cascades further than it looks

Every `fruits_.*.tsx` route file, every `Link to="/fruits/..."`, every
`redirect("/fruits")`, the `AppLayout` nav, emails that may link into the app,
and the CLI's URL builders (#3 above) all hardcode the `/fruits` prefix.
Budget real time for a careful `grep -r "/fruits"` pass across `webapp/app`
**and** `crates/` — this is mechanical but not small, and easy to leave a
stale internal link if rushed.

## Target architecture

```mermaid
flowchart TB
    subgraph Shared workspace packages
        RC[robustness-core<br/>data layer]
        OX[oxmarkdown-core]
        ST[stamps<br/>design system]
        AUTH[NEW: auth-core<br/>session + webauthn + auth.server]
    end

    subgraph webapp fly app
        MKT[marketing routes<br/>nopal.build]
    end

    subgraph fruits fly app - NEW
        APP[product routes<br/>o.nopal.build]
    end

    subgraph worker fly app - existing, unchanged
        WRK[GraphLog queue worker]
    end

    MKT --> RC
    MKT --> ST
    APP --> RC
    APP --> ST
    APP --> OX
    APP --> AUTH
    MKT -. optional: just a login link, no dep .-> AUTH
    WRK --> RC
    WRK --> OX
```

Two independently deployable React Router/Express apps (same stack as today),
each its own `package.json`/`Dockerfile`/`fly.toml`/pnpm workspace member —
**exactly** the pattern `packages/worker` already established as a sibling
service off the same `robustness-core`/`oxmarkdown-core`. No new deployment
concepts for this team to learn.

Proposed new directory name: **`nopal/fruits`** (not `nopal/app`, to avoid
colliding conceptually with `webapp/app/` — the existing React Router source
folder — and because "fruits" is already the internal codename people use, it
just stops being in the URL).

### Route inventory (from actual `app/routes/` contents)

**Stays in `webapp` (marketing, nopal.build):**
`_index`, `about`, `contact`, `explore`, `good.*`, `path.*`, `tools.*`,
`materials.$id`, `science.$id`, `stories.$id`, `assemblies.$id`,
`docs.wc-waiver`, `privacy`, `grandpas-cabin-recipe`, `sunny-home-no1`,
`scc-demo`, `roots._index`, `v2.*`, `health(.$key)`.

**Moves to `fruits` (app, o.nopal.build), losing the `/fruits` prefix:**
`fruits.tsx` → `_index.tsx` (dashboard), all `fruits_.*` routes, all
`api.*` routes (vault, daily-log, graphlog, passkeys, admin impersonation,
sync-targets/tokens, upload, events), `login`, `login-error`, `logout`,
`magic-link`, `verify`, `welcome.$token`, `cli-login`, `card.$fileId`,
`public.file.$fileId`, `public.folder.$folderId`.

**Ambiguous — confirm before moving (see open questions):** none of the
public-content routes look ambiguous from the code itself, but do a final
pass once `explore.tsx`/`v2.*` content is reviewed — a couple of these read
like half-finished experiments and might be dead code worth deleting instead
of migrating.

## Phased plan

Each phase should be its own PR, independently deployable/revertable.

### Phase 0 — Local dev custom domains (independent, do this first/anytime)

Lowest risk, immediate DX payoff, doesn't block or depend on the rest.

- Add `127.0.0.1 nopal.dev` and `127.0.0.1 o.nopal.dev` to `/etc/hosts`
  (document this in `AGENTS.md`/README — can't be automated from inside a
  container).
- **Important:** `.dev` is on the browser HSTS-preload list — Chrome/Firefox
  refuse plain HTTP on *any* `.dev` hostname, even ones you don't own. Plain
  `http://nopal.dev:3000` will not load. This also matters for WebAuthn,
  which requires a secure context (`https://`, or the special-cased exact
  `localhost`) — a custom dev hostname over HTTP would silently break passkey
  login locally.
- Solution: add a small **Caddy** service to `docker-compose.yml` in front of
  the two app containers. Caddy auto-provisions locally-trusted HTTPS certs
  via its own local CA (one-time `caddy trust`), and does host-based routing:
  ```
  nopal.dev {
    reverse_proxy webapp:3000
  }
  o.nopal.dev {
    reverse_proxy fruits:3001
  }
  ```
- Set `WEBAUTHN_RP_ID=nopal.dev` for local dev (see risk #1 — needs the
  RP-ID-pinning fix regardless of this phase).
- Update `make dev`'s printed URLs and `AGENTS.md`.

This phase is valuable even if the service split never happens (it's really
"stop using bare `localhost:3000`"), but doing it now also gives you a real
local rehearsal environment for risks #1–#2 before touching prod.

### Phase 1 — Prep inside the current monorepo (no split yet, ships to prod as a no-op)

- Fix `getRpID`/`getOrigin` per risk #1 (env-driven `WEBAUTHN_RP_ID` +
  origin allow-list).
- Add an explicit, env-driven `domain` option to the session cookie config
  (`session.server.ts`), even if unset (`undefined`) for now.
- Deploy, confirm passkey login + session behavior in prod is unchanged.
  This is the safety checkpoint — if anything's going to break passkeys,
  better to find out here than after the split.

### Phase 2 — Extract shared auth code into a workspace package (done)

Moved `app/modules/auth/{auth.server,session.server,webauthn.server}.ts`
into `packages/robustness-core/src/auth/` (extended `robustness-core`
rather than adding a 4th package — it already owned
`passkeys.server.ts`/`humans.server.ts`, so this kept workspace sprawl
down), exported as `robustness-core/auth/{auth,session,webauthn}.server`.

One wrinkle found while doing this that the plan hadn't accounted for:
`auth.server.ts` wasn't a pure, self-contained move — its TOTP strategy
sends a login-code email by importing `util/email.server.ts` (Resend/SMTP)
and the `LoginCode` React email template directly, and neither of those
belongs in `robustness-core` (no React/email-provider deps anywhere else
in that package). Fixed by extracting a small dependency-injection seam,
`configureAuth({ sendTotpEmail })`, in the shared module — whichever app
owns the login flow calls it once, wiring up its own email-sending, before
any real login attempt. `webapp/app/modules/auth/*.ts` are now TEMPORARY
thin re-export shims (`export * from "robustness-core/auth/..."`, plus the
`configureAuth` call for auth.server.ts) — kept only so today's still-in-
webapp routes (`/login`, `/verify`, all `/api/*`, ...) keep working
unchanged until Phase 3+ actually moves them to `o.nopal.build`, at which
point this whole shim directory should be deleted outright rather than
kept around.

Also added to `robustness-core/package.json`: `react-router`,
`remix-auth`, `remix-auth-totp`, `@simplewebauthn/server` (matching
webapp's existing versions) as real dependencies, since the moved code
needs them directly now.

Validated: `tsc --noEmit` clean, full `vitest run` (82 tests) passing, and
a real end-to-end manual test — seeded the local dev DB, POSTed to
`/login` with a real seeded human over `https://nopal.dev`, got the
expected `302 → /verify`, and confirmed Mailpit actually received the
"Nopal Login Code" email — proving the `configureAuth` wiring executes
correctly through the new shared-package boundary, not just type-checks.

### Phase 3 — Scaffold `fruits/` as a new service (done)

This phase ended up covering Phase 3, Phase 4, and the internal-linking
half of Phase 5 together, in one pass — see the top of "Phased plan" for
why (a half-migrated state, with routes existing in neither/both places or
webapp full of dead links, is worse than doing the full code motion in one
go). Infra rollout (Phase 7 — actually provisioning the Fly app, DNS,
staging rehearsal) is still not done.

**What moved, verbatim structure:** `webapp`'s toolchain
(`package.json`/`vite.config.js`/`react-router.config.ts`/`server.js`/
`tsconfig.json`/`postcss.config.js`/`tailwind.config.ts`/`Dockerfile`/
`fly.toml`/`fly.staging.toml`) copied into `fruits/`, added to
`pnpm-workspace.yaml`. All `api.*` routes (73 files, minus `api.health.tsx`
— see below), every `fruits_.*`/`fruits.tsx` route (renamed to drop the
prefix per flat-routes convention: `fruits.tsx` → `_index.tsx`,
`fruits_.daily-log.tsx` → `daily-log.tsx`, `fruits_.maker_.graphlog.tsx` →
`maker_.graphlog.tsx`, etc. — URLs land at `/`, `/daily-log`, `/vault`,
`/maker/graphlog`, etc.), the auth-flow routes (`login`, `login-error`,
`logout`, `magic-link`, `verify`, `welcome.$token`, `cli-login`), and the
public-sharing routes (`card.$fileId`, `public.file.$fileId`,
`public.folder.$folderId`) all moved to `fruits/app/routes/`.
`AppLayout`/`DailyLogDay`/`OxEditor`/`ProjectView`, `hooks/useUser`/
`useVaultEvents`, `data/invites.server.ts`, `util/knownAccounts.ts`/
`publicVaultDisplay.ts`, the whole `app/oxmarkdown/` Lexical-editor
directory, and the relevant `app/styles/*.css` moved with them. All
internal `/fruits`/`/fruits/X` links (nav, redirects, the CLI-open-URL
style references) were rewritten to drop the prefix in the same pass —
see risk #4 in this doc; this really was as mechanical-but-not-small as
predicted, done with a scripted find/replace plus a manual pass for the
remaining bare `/fruits` (dashboard-root) references.

**Auth is now genuinely permanent in `fruits`, not a temporary shim:**
since login physically moved here in this same phase, `fruits/app/modules/
auth/*.ts` (the `robustness-core/auth/*` re-export shim + `configureAuth`
wiring introduced in Phase 2) is now the real, permanent home — and
`webapp/app/modules/auth/` was deleted outright, along with its
`@simplewebauthn/*`/`remix-auth*` reliance. webapp has zero session code
now, per the resolved open question.

**Duplicated, not shared** (small, cross-cutting files needed by both
apps — each one has a top-of-file comment saying so): `Layout`/`Footer`/
`GoodAssets` (the moved auth/public-sharing pages kept marketing's exact
chrome, unchanged, rather than getting new app-native chrome — a genuine
follow-up worth reconsidering separately), `useSchemePref`/
`useClickOutside`, `util/email.server.ts`, and — a discovery the plan
hadn't accounted for — **`OxRenderer.tsx` and part of `app/oxmarkdown/`**.
Marketing's own `/v2/*` pages (`WebsitePageView.tsx`, an in-progress
Vault-driven CMS for the marketing site itself) also render OxMarkdown
read-only, so `OxRenderer` couldn't just move to `fruits` outright. Its
real dependency graph split cleanly along an existing seam, though:
`OxRenderer` only needs `directiveRegistry.ts`/`theme.ts`/`interactive.ts`/
`OxPopover.tsx`/`OxEditorContext.tsx`/`fileDirective.ts` (all renderer-
side), never the ~28 Lexical editor-plugin files `OxEditor` alone needs —
so only that small renderer-only subset got duplicated into webapp
(`fileDirective.ts`/`OxEditorContext.tsx` trimmed down to just the type
exports `OxRenderer` needs, avoiding a real `lexical` runtime dependency
in webapp for zero benefit). `styles/oxmarkdown.css` was duplicated too
(a CSS side-effect import — `tsc` doesn't catch those, only a real dev-
server boot did). A `packages/oxmarkdown-react`-style shared package would
be the more correct long-term home for this render-only slice; not built
here to keep this phase's scope bounded.

**A real, deliberate regression, not an oversight:** `/v2/*`'s unpublished-
page "draft preview" feature (`loadWebsitePage.server.ts`) used to check
`getUser(request)` to let a signed-in collaborator preview a draft before
it's published. With zero session code left in webapp and no shared
cookie domain (per the resolved "where does login live" question), there's
no session left to check — every unpublished page now 404s for everyone,
fail-closed, rather than trusting an unauthenticated request or hacking in
a cross-domain cookie. Restoring real preview access needs a genuine
cross-service mechanism (a signed preview link/token minted by the app,
most likely) — a real product/security decision, deliberately not made as
part of this migration. Flagged clearly in that file's own comment.

**Other things discovered and handled along the way:**
- `api.health.tsx` is **duplicated**, not moved — each service's own
  `fly.toml` health check needs its own `/api/health`.
- `docs.wc-waiver.tsx` (stays in webapp) linked to
  `/api/legal-documents/view/:docId` (moved to `fruits`) by deriving its
  own request's host — now uses an `APP_BASE_URL` env var instead, since
  that link now genuinely crosses services.
- webapp's real `Footer.tsx` "Log in" link now points at
  `https://o.nopal.build`/`https://o.nopal.dev` (chosen via
  `process.env.NODE_ENV`, one of the few env vars Vite inlines into the
  client bundle too — unlike `APP_BASE_URL`, which only ever needs to be
  read server-side).
- `scripts/visual-check.ts` (the `dark-mode-review` skill's screenshot
  tool — every page it captures requires an authenticated session) moved
  to `fruits/scripts/`, default port updated to `3001`; the skill doc
  updated to match, with a note that marketing pages need no auth and can
  be reviewed by hand instead.
- `AGENTS.md` split: `fruits/AGENTS.md` inherited webapp's old (accurate-
  for-the-app) `stamps`-migration conventions and style-guide pointer
  (`app/routes/styles.tsx`, formerly `fruits_.styles.tsx`); `webapp/
  AGENTS.md` trimmed down to a lighter, marketing-appropriate version that
  points at `fruits/AGENTS.md` for the stricter conventions and calls out
  the no-session-code rule explicitly.
- `Makefile`/`docker-compose.yml`/`.github/workflows/deploy.yml`/`README.md`
  updated throughout: new `fruits` docker-compose service (port `3001`,
  its own node_modules volumes, same pattern as `webapp`/`worker`),
  Caddy's `o.nopal.dev` now actually proxies to `fruits` instead of
  `webapp`, `webapp/Dockerfile`/`packages/worker/Dockerfile` updated to
  also `COPY` `fruits/package.json` (pnpm needs every workspace member's
  `package.json` present for `--frozen-lockfile` to succeed, confirmed by
  webapp's own Dockerfile already doing this for `packages/worker`),
  `fruits/package.json`'s `test` script uses `--passWithNoTests` (no
  fruits-specific test files exist yet, and the new CI/`make deploy` step
  that runs it would otherwise fail on an empty suite).

**Validated end-to-end**, not just type-checked: `tsc --noEmit` clean on
both apps, full `vitest run` passing on both (webapp: 82 tests; fruits:
correctly reports 0 with `--passWithNoTests`, since none of its logic
lives in test-covered files yet — the existing GraphLog regression tests
test `robustness-core` directly and stayed where they were, which is
fine, they don't test webapp OR fruits code). Brought up the full local
stack (`nopal.dev` → `webapp`, `o.nopal.dev` → `fruits`, both through the
real Caddy HTTPS proxy from Phase 0), ran DB migrations + seed, and:
- Confirmed marketing pages (`/`, `/about`, `/contact`, `/docs/wc-waiver`)
  still 200 on `nopal.dev`, and that `/login`/`/v2` now correctly 404
  there (the first because it genuinely moved; the second because there's
  no seeded website content in a fresh dev DB, not a bug).
- Ran a REAL login (`POST /login` with a seeded human over `o.nopal.dev`)
  through to the `302 → /verify` redirect, and confirmed Mailpit received
  the login-code email — the `fruits`-local `configureAuth` wiring works
  end to end, not just at compile time.
- Built a real, valid `_auth` session cookie directly (same technique
  `visual-check.ts` uses) and hit every major authenticated app page
  (`/`, `/daily-log`, `/vault`, `/styles`, `/maker`, `/profile`) — all
  200, confirming `AppLayout`, `OxEditor`/`OxRenderer`, `DailyLogDay`,
  `ProjectView`, and the Maker/GraphLog pages all render correctly on the
  new service with a real user.

### Phase 4 — Slim `webapp` down to marketing-only (done, folded into Phase 3)

- Deleted the moved route files from `webapp/app/routes/` (they were
  moved, not copied).
- Updated `Footer.tsx`'s `/login` link, plus `docs/wc-waiver.tsx`'s
  legal-document link (see Phase 3's writeup) to point at the app's
  absolute URL — env/`NODE_ENV`-driven, not hardcoded.
- Removed now-unused deps from `webapp/package.json`: `@simplewebauthn/
  browser`, `@simplewebauthn/server`, `remix-auth`, `remix-auth-totp`, and
  all of `@lexical/*` + `lexical` itself (confirmed zero real imports left
  via grep — the only remaining `@lexical`/`lexical` mentions in webapp
  are CSS comments describing selector shapes, not actual dependencies).
  `@floating-ui/react` stays — webapp's duplicated `OxPopover.tsx` still
  uses it directly. Verified with a full `pnpm install` — lockfile
  updated, `tsc --noEmit` clean, full `vitest run` still passing (82
  tests), marketing pages still 200 locally.

### Phase 5 — Cross-linking & emails

- Audit every email template (`app/emails/*.tsx`) and `invites.server.ts`/
  `docs.wc-waiver.tsx`'s `getAppBaseUrl()` — these currently point at
  `nopal.build` for the "go to the app" CTA and need to point at
  `o.nopal.build` instead (whichever app now owns invite acceptance).
- Decide where `welcome.$token.tsx` (invite acceptance + first passkey
  registration) lives — almost certainly `fruits`, since it ends in the
  logged-in dashboard — and make sure invite emails link there directly.

### Phase 6 — CLI/desktop app compatibility (risk #3)

- Bump `DEFAULT_HOST` in `crates/cli` and `crates/app`.
- Add the one-time saved-host migration in `crates/core/src/auth.rs`.
- Update `crates/cli/src/vault.rs`'s URL builders to drop `/fruits`.
- Cut a new CLI release (`make release-cli`) alongside the web cutover, not
  after — an out-of-sync CLI release is exactly the silent-breakage
  scenario described in risk #3.

### Phase 7 — Infra/DNS & cutover

- Provision the new Fly app (`fly apps create` for `fruits`, or whatever
  Fly-generated name, per the existing `webapp-billowing-meadow-8538`/
  `nopal-phylog-worker` naming precedent).
- Add `o.nopal.build` as a custom domain on the new Fly app; issue/confirm
  TLS cert.
- Deploy `fruits` to staging first (mirrors `fly.staging.toml`'s existing
  pattern — shared SurrealDB instance, isolated `staging` database) and do a
  full manual pass: login, passkey register + login, Daily Log, Vault
  upload, GraphLog run, CLI login against staging's app host.
- Add a redirect at `nopal.build` for legacy `/fruits*` deep links (bookmarks,
  old emails) — a simple `308` to the equivalent `o.nopal.build` path, kept
  indefinitely or for a defined deprecation window.
- Flip DNS/deploy `fruits` to prod. Watch error rates + `/api/health` on both
  apps closely for the first 24h — this is the actual go/no-go moment for
  risks #1–#3.

### Phase 8 — Cleanup

- Remove the `/fruits*` redirect once confident no meaningful traffic still
  hits it (check Fly logs / analytics first).
- Delete dead code paths left behind in `webapp` (unused `AppLayout`-only
  CSS, etc.).
- Update `AGENTS.md` in both `webapp/` and the new `fruits/` to reflect the
  split (the UI-conventions section — shared components, `stamps` usage
  rules — should mostly just get copied into `fruits/AGENTS.md` verbatim,
  since that's where almost all of that guidance actually applies now).

## Open questions to settle before starting

1. ~~**Where does login live?**~~ **Resolved:** entirely on `o.nopal.build`
   — the marketing site needs no session information at all. Marketing's
   "Log in" CTA becomes a plain external link once Phase 3+ lands. This
   also means the session-cookie-domain groundwork from Phase 1 is (by
   design) never expected to actually be exercised — kept only because
   it was a free, inert knob to add.
2. **New package name** — `nopal/fruits` proposed; alternatives `nopal/app`
   (risks confusion with `webapp/app/`), `nopal/product`, `nopal/o`.
3. **Auth module home** — new `packages/auth-core`, or fold into
   `robustness-core`? Leaning toward extending `robustness-core` (less
   workspace sprawl, and it already owns `passkeys.server.ts`).
4. **`/fruits` redirect window** — permanent, or time-boxed? Depends on how
   much you care about old bookmarks/shared links versus keeping `nopal.build`
   simple sooner.
5. **CLI update urgency** — is it acceptable to require existing users to
   manually update/re-login, or is the automatic host-migration in Phase 6
   worth the extra implementation time? Given "invite-only, small" per
   `privacy.tsx`, manual coordination may genuinely be faster than building
   the safety net.

## Suggested order of work

Phase 0 (dev domains) can start immediately and independently. Phases 1–2 are
low-risk prep that should land before anything else. Phases 3–6 can mostly
proceed in parallel once 1–2 are done (route-moving vs. CLI work don't
conflict). Phase 7 is the single point where everything converges and needs
careful, staged rollout — do not rush this step.
