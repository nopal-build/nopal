---
name: dark-mode-review
description: Visually verify Nopal's app (`fruits/`) pages in both light and dark mode by screenshotting them with `scripts/visual-check.ts` (Playwright, auto-authenticated). Use when asked to check, review, or fix dark mode / `prefers-color-scheme` styling, contrast issues, or CSS variable overrides in `fruits/app/styles/*.css`.
---

# Dark mode visual review

Nopal's dark mode is driven entirely by `prefers-color-scheme` — there's no
in-app toggle. Colors are either CSS variables that already flip in
`:root`/dark blocks, or one-off `@media (prefers-color-scheme: dark) { ... }`
overrides scattered through `fruits/app/styles/*.css` (app pages) or
`webapp/app/styles/*.css` (marketing pages — these two do NOT share a
stylesheet, see `docs/marketing-app-split-plan.md`). A few components also
branch in JS via `useSchemePref()` (`fruits/app/hooks/useSchemePref.ts` for
the app, a duplicate at `webapp/app/hooks/useSchemePref.ts` for marketing),
e.g. to swap logo images. Because there's no toggle to click, the only
reliable way to check compatibility is to force each color scheme and
actually look.

This skill's script (`visual-check.ts`) only covers the **app** (`fruits/`,
`o.nopal.build`) — every one of its pages requires an authenticated
session, which is what the script's cookie-injection trick exists for (see
"Why this approach" below). Marketing pages (`webapp/`) need no auth at
all, so they're simpler to check by hand: run `webapp`'s own dev server and
just load a page with your browser's devtools forcing
`prefers-color-scheme`, or Chrome DevTools' "Rendering" tab → "Emulate CSS
media feature prefers-color-scheme". No script for that exists yet — worth
adding here if marketing dark-mode bugs turn out to be a recurring problem.

## How to run it

1. **Precondition: the dev server must already be running** on
   `http://localhost:3001` (`npm run dev` from `fruits/`, or `make dev`'s
   docker-compose `fruits` service). Don't try to start it yourself — it's
   a long-lived process and will hang a one-shot terminal command. If it's
   not running, ask the user to start it.
2. If Chromium hasn't been installed for Playwright yet, run once from
   `fruits/`: `npx playwright install chromium`.
3. Run the screenshot script from `fruits/`:
   ```
   npx vite-node scripts/visual-check.ts [--email=someone@example.com] [path ...]
   ```
   - With no path arguments, it screenshots `/maker/stamps` — the Stamps
     design system guide (`app/routes/maker_.stamps.tsx`), which exercises
     the shared component library end-to-end and is the single best
     default target.
   - Pass one or more paths to check specific pages, e.g.:
     ```
     npx vite-node scripts/visual-check.ts /profile /daily-log
     ```
   - It authenticates automatically as an existing Super/Admin account in
     the DB (so admin-only nav/menus render too). Pass `--email=` to
     authenticate as a specific human instead (useful for checking
     Human-role-only views, e.g. after the "login as user" impersonation
     feature).
4. Screenshots are written to `fruits/tmp/visual-check/<route>--light.png`
   and `<route>--dark.png` (gitignored — throwaway output, not committed).
5. **Read both PNGs directly** with the file-reading tool and compare them
   side by side. Look specifically for:
   - Text with too little contrast against its background in either mode
     (especially anything using a hardcoded hex color instead of a
     `var(--...)` token).
   - Borders, dividers, or icons that vanish in one mode.
   - Elements that never got a dark override at all — same background in
     both screenshots when everything around them changed.
   - Images/logos that look wrong on a dark background (check whether they
     need a `useSchemePref()`-driven swap, like `AppLayout` already does for
     the nopal logo).
6. If something looks wrong, find the relevant rule in `app/styles/*.css`
   (search for the class name) and check whether it has a
   `@media (prefers-color-scheme: dark) { ... }` block at all, or whether an
   existing `var(--...)` token should be used instead of a hardcoded color.
   Re-run the script after fixing to confirm.

## Why this approach (vs. clicking through the app)

Every app page requires an authenticated session, and this app's login is
TOTP-email-code or WebAuthn passkey — neither is easy to drive from a
script. `scripts/visual-check.ts` sidesteps that by building a real `_auth`
session cookie the exact same way `auth.server.ts` does
(`sessionStorage.commitSession`) and injecting it straight into the
Playwright browser context, rather than adding any test-only login route to
the app itself.

This is intentionally a lightweight, ad hoc screenshot tool for an agent (or
human) to *look at* — not a CI visual-regression suite. If baseline-diffing
in CI becomes valuable later, `@playwright/test`'s `toHaveScreenshot()` is
the natural next step, but that's a separate, heavier decision (requires
committed baseline images and a review workflow) than what this skill covers.
