# Splitting `nopal.build` (marketing) from the app (`o.nopal.build`)

Status: Phase 0 (local dev custom domains), Phase 1 (WebAuthn RP ID /
origin pinning + session cookie domain groundwork), and Phase 2 (shared
auth code extracted into `robustness-core`) done. Phases 3+ not started.
This is a planning doc, not a changelog — update it as decisions get made
or revised.

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

### Phase 3 — Scaffold `fruits/` as a new service

- Copy `webapp`'s toolchain (`package.json`, `vite.config.js`,
  `react-router.config.ts`, `server.js`, `tsconfig.json`,
  `postcss.config.js`, `tailwind.config.ts` if still needed) into `nopal/fruits/`.
- Add it to `pnpm-workspace.yaml`.
- Move the "moves to fruits" route list (above) from `webapp/app/routes/` to
  `fruits/app/routes/`, stripping the `fruits_.`/`fruits.` prefix from
  filenames (React Router's flat-routes convention) so URLs land at `/`,
  `/vault`, `/maker`, etc.
- Move routes' exclusive component dependencies (`AppLayout`, `DailyLogDay`,
  `ProjectView`, `OxEditor`, `OxRenderer`, `WebsitePageView`, related
  `styles/*.css`, `hooks/useUser`, `hooks/useSchemePref`) into
  `fruits/app/components` / `fruits/app/hooks`.
- Wire up `fly.toml`/`fly.staging.toml`/`Dockerfile` for `fruits/`, modeled
  directly on `webapp/fly.toml` + `webapp/Dockerfile` (same bluegreen
  strategy, same `/api/health` check, same repo-root build context).
- Update `Makefile`'s `deploy`/`deploy-staging` targets to also deploy
  `fruits/`.
- Update `docker-compose.yml`: new `fruits` service (own container, own
  node_modules volumes — same pattern as `webapp`/`worker` today), listening
  on a distinct port (e.g. `3001`).

### Phase 4 — Slim `webapp` down to marketing-only

- Delete the moved route files from `webapp/app/routes/`.
- Delete now-unused deps from `webapp/package.json` (e.g. `@simplewebauthn/*`,
  `@lexical/*` if `OxEditor` doesn't stay, `remix-auth*` if login fully
  moves) — run `depcheck` or just `pnpm --filter webapp run build` and follow
  the errors.
- Update `Footer.tsx`'s `/login` link (and any other internal "go to the
  app" links) to point at the absolute app URL, driven by an env var
  (`APP_BASE_URL=https://o.nopal.build`, `https://o.nopal.dev` in dev) rather
  than a hardcoded string — same idea `invites.server.ts`'s
  `FALLBACK_APP_BASE_URL` already uses for email links.

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
