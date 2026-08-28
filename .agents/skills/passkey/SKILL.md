---
name: passkey
description: Passkey (WebAuthn) authentication in Nopal — registration, usernameless login, invite-first onboarding, and the alias-email/verification system built alongside it. Use when working on anything under app/routes/api.passkeys.*, app/routes/welcome.$token.tsx, app/modules/auth/webauthn.server.ts, app/data/passkeys.server.ts, or the email/alias fields on Human.
disable-model-invocation: false
---

# Passkey Auth in Nopal

Nopal supports WebAuthn passkeys alongside the original TOTP-email-code login
(`remix-auth-totp`). Passkeys are additive — TOTP-by-email always remains a
working fallback, so there is no lockout risk anywhere in this system.

## Core files

- `app/modules/auth/webauthn.server.ts` — all `@simplewebauthn/server` logic:
  generating/verifying registration and authentication options. RP ID and
  origin are derived from the request URL (`new URL(request.url).hostname`
  / `${protocol}//${host}`), **not** an env var — this makes localhost dev
  and prod both work without config, as long as the app is always served
  from the domain the passkey should be scoped to.
- `app/data/passkeys.server.ts` — the `passkeys` SurrealDB table. Fields:
  `humanId`, `webauthnUserId` (WebAuthn "user handle", captured at
  registration for future discoverable-credential use), `credentialId`,
  `publicKey` (stored base64), `counter`, `transports`, `deviceType`,
  `backedUp`, `name`, `createdAt`.
- Resource routes (all JSON, POST-only):
  - `app/routes/api.passkeys.register-options.tsx` /
    `register-verify.tsx` — registration while logged in (used by the
    profile page). Authorized via session (`getUser`).
  - `app/routes/api.passkeys.login-options.tsx` /
    `login-verify.tsx` — **usernameless** login. `login-options` calls
    `generateAuthenticationOptions` with **no `allowCredentials`**, so the
    browser offers any discoverable passkey for the site — no email typed.
    `login-verify` looks up the passkey by `credentialId` and logs the
    human in directly (`session.set("user", human)`), matching what the
    TOTP strategy does on success.
  - `app/routes/api.passkeys.invite-register-options.tsx` /
    `invite-register-verify.tsx` — registration for a **signed-out**
    brand-new invitee, authorized by a single-use invite token instead of
    a session. Reuses the exact same `generatePasskeyRegistrationOptions` /
    `verifyPasskeyRegistration` helpers as the logged-in path.
- `app/routes/fruits_.profile.tsx` — "Passkeys" section: lists existing
  passkeys, "+ Create a passkey" button (client-side ceremony via
  `@simplewebauthn/browser`'s `startRegistration`), and per-passkey
  "Remove" (scoped so a human can only delete their own).
- `app/routes/login.tsx` — "Sign in with a passkey" button, calls
  `startAuthentication` from `@simplewebauthn/browser`.

## Invite-first onboarding flow (passkey before email verification)

Goal: let a brand-new invitee set up a passkey straight from the welcome
email, before they've ever proven email ownership via a code — but this
requires a secure single-use token, since the welcome email previously had
none (it just pre-filled `/login`'s email field, which is not proof of
anything on its own).

- `app/data/humans.server.ts` — `Human.inviteToken` / `inviteTokenExpiresAt`
  (7-day TTL). `setInviteToken`, `getHumanByInviteToken`,
  `consumeInviteToken` (single-use — cleared once a passkey is registered),
  `isInviteTokenValid`.
- `app/data/invites.server.ts` — `inviteHuman(data, request?)` generates the
  token and builds `passkeySetupUrl` (`/welcome/:token`) using
  `getAppBaseUrl(request)`, which derives the host from the **current
  request** (so links point at `localhost:3000` in dev, `nopal.build` in
  prod). Always pass `request` through from any call site.
- `app/emails/welcome.tsx` — primary CTA is "Set up your passkey" →
  `passkeySetupUrl`; a secondary plain-text link still offers the classic
  emailed-code login for anyone who'd rather skip passkeys.
- `app/routes/welcome.$token.tsx` — the `/welcome/:token` page. Three
  possible states depending on session:
  1. **No session** → normal passkey-setup UI. On success, the code no
     longer sends the user to `/login` to click "Send Code" manually —
     it calls `useSubmit()` to POST `{ email }` straight to `/login`'s
     action (same effect as a manual submit: sends the TOTP code and
     redirects to `/verify`). The flow is create passkey → land directly
     on `/verify`, no intermediate manual step.
  2. **Signed in as the exact same account being invited** (`existingUser._id
     === invitedHuman._id`) → nothing to decide, redirect straight to
     `/fruits/profile`.
  3. **Signed in as a *different* account** → shows a 3-choice page
     (`ExistingSessionChoice`): stay signed in as-is (just a link to
     `/fruits`), fold the invite into the current account via alias
     (`intent=alias` — adds `invitedHuman.email` as an alias on
     `existingUser`, repoints any relationships pointing at the
     placeholder via `repointRelationshipsToHuman`, consumes the invite
     token, deletes the placeholder), or log out and set up the invited
     account instead (`intent=logout` — destroys session, reloads the
     same `/welcome/:token` URL, which now hits case 1).
  - If the token itself is invalid/expired/already used:
    **signed-in** users are redirected to `/fruits/profile?inviteExpired=1`
    (profile page shows a small explanatory notice) rather than through
    `/login` — a signed-in user hitting `/login` gets bounced straight to
    `/fruits` with zero explanation, which looks like the whole feature is
    silently broken. **Signed-out** users still go to `/login` (harmless;
    they can always request a code).

## Alias emails & verification-gated email changes

Built on the profile page (`app/routes/fruits_.profile.tsx`) alongside the
above, since the "fold into existing account" flow needed alias emails as a
first-class concept.

- `Human.aliasEmails?: string[]` — other addresses that log in to the same
  account. `getHumanByEmail` matches primary **or** any alias
  (`aliasEmails CONTAINS $email`).
- Adding/changing an email is always verification-gated:
  `Human.pendingEmail` / `pendingEmailType` (`"alias" | "primary"`) /
  `pendingEmailCode` / `pendingEmailCodeExpiresAt` / `pendingEmailAttempts`
  track one pending change at a time (starting a new one invalidates the
  previous code). `startEmailChange` generates a 6-digit code (10 min TTL);
  `recordFailedEmailCodeAttempt` caps wrong guesses at 5 before forcing a
  fresh code; `applyPendingEmailChange` commits it — for `"primary"`, the
  **old primary is automatically demoted to an alias** rather than dropped,
  so an email edit can never lock someone out of their own account.
- `isEmailTakenByAnotherHuman` is checked both before sending a code and
  again right before applying it, so two accounts can never end up sharing
  a login address.
- Security notice emails (`app/emails/emailChangeNotice.tsx`) go to the
  address that was **already** on the account whenever an alias is added or
  a primary change completes — so a hijacked-session attacker adding their
  own alias still leaves a trail somewhere they don't control.
- The profile UI: name is a static line with an inline "Edit" toggle (no
  popup); email likewise, plus a list of verified aliases each with
  "Remove", and an "+ Add alias email" toggle. Whenever a change is
  pending, the whole email block switches to "enter the code we sent"
  with Confirm / Resend / Cancel.

## Known gotchas (already hit, already fixed — don't reintroduce)

1. **Never name a SurrealDB bind parameter `$token`.** SurrealDB reserves it
   for its own internal auth/JWT system and throws `'token' is a protected
   variable and cannot be set`. This is caught and silently swallowed by
   `query()` in `app/data/generic.server.ts` (logs and returns `[]`), which
   made `getHumanByInviteToken` return `undefined` for *every* invite,
   permanently, until fixed by renaming the param (e.g. `$inviteToken`).
   If a query ever mysteriously never matches, check for reserved-word
   collisions this way — the `generic.server.ts` catch blocks hide the
   real SurrealDB error unless you read server logs closely, or better,
   reproduce with a throwaway `vite-node` script (see below).
2. **When a mutation does multiple writes, re-fetch after the *last* one**
   before returning/using the result. `applyPendingEmailChange`'s alias
   branch used to call `addAliasEmail` (which internally re-fetches) and
   then *separately* `clearPendingEmailChange`, but returned the stale
   snapshot from the first call — so the returned `Human` still looked
   like it had a pending change. That stale object got written straight
   into the session, so the UI kept showing "enter code" and a second
   click would silently re-run the whole thing (including re-sending
   notice emails). Fix: do all writes first, then one final
   `getHumanById` before returning.
3. **Never let a non-critical `sendEmail` call crash an action after the
   real state change already committed.** Wrap best-effort notification
   emails (e.g. the security notice) in `try/catch` and just
   `console.error` on failure — don't let them fail the whole request when
   the important work already succeeded. The code-delivery email (the one
   the user actually needs to proceed) is the one case where a send
   failure *should* surface as a real error to the user.
4. **Invite tokens are single-use.** Re-clicking a welcome-email link after
   successfully completing passkey setup will correctly show it as
   invalid/expired — that's not a bug, generate a fresh invite to test the
   flow again.

## Debugging tip

This project has a local SurrealDB reachable via the `DATABASE_URL` in
`.env` (default `http://localhost:8080/rpc`, root/root). When a data-layer
function seems to silently misbehave, write a throwaway script under
`webapp/scripts/` and run it with `npx vite-node scripts/whatever.ts` — it
can import any `*.server.ts` module directly and hit the real DB, which is
far faster than guessing from static reading. Delete the script when done.
