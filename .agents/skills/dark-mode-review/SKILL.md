---
name: dark-mode-review
description: Visually verify light/dark mode (prefers-color-scheme) compatibility of Nopal webapp pages by capturing authenticated Playwright screenshots in both color schemes and reviewing them directly as images. Use after any change touching CSS, colors, `app/styles/*.css`, or components under `app/components`, or whenever asked to check dark mode / light mode.
---

# Dark mode visual review

Nopal's dark mode is driven entirely by `prefers-color-scheme` — there's no
in-app toggle. Colors are either CSS variables that already flip in
`:root`/dark blocks, or one-off `@media (prefers-color-scheme: dark) { ... }`
overrides scattered through `webapp/app/styles/*.css`. A few components also
branch in JS via `useSchemePref()` (`webapp/app/hooks/useSchemePref.ts`), e.g.
to swap logo images. Because there's no toggle to click, the only reliable
way to check compatibility is to force each color scheme and actually look.

## How to run it

1. **Precondition: the dev server must already be running** on
   `http://localhost:3000` (`npm run dev` from `webapp/`). Don't try to start
   it yourself — it's a long-lived process and will hang a one-shot terminal
   command. If it's not running, ask the user to start it.
2. If Chromium hasn't been installed for Playwright yet, run once from
   `webapp/`: `npx playwright install chromium`.
3. Run the screenshot script from `webapp/`:
   ```
   npx vite-node scripts/visual-check.ts [--email=someone@example.com] [path ...]
   ```
   - With no path arguments, it screenshots `/fruits/styles` — the living
     style guide (`app/routes/fruits_.styles.tsx`), which exercises the
     shared component library end-to-end and is the single best default
     target.
   - Pass one or more paths to check specific pages, e.g.:
     ```
     npx vite-node scripts/visual-check.ts /fruits/profile /fruits/daily-log
     ```
   - It authenticates automatically as an existing Super/Admin account in
     the DB (so admin-only nav/menus render too). Pass `--email=` to
     authenticate as a specific human instead (useful for checking
     Human-role-only views, e.g. after the "login as user" impersonation
     feature).
4. Screenshots are written to `webapp/tmp/visual-check/<route>--light.png`
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

Every page under `/fruits/*` requires an authenticated session, and this
app's login is TOTP-email-code or WebAuthn passkey — neither is easy to
drive from a script. `scripts/visual-check.ts` sidesteps that by building a
real `_auth` session cookie the same way `auth.server.ts` does
(`sessionStorage.commitSession`) and injecting it straight into the
Playwright browser context, rather than adding any test-only login route to
the app itself.

This is intentionally a lightweight, ad hoc screenshot tool for an agent (or
human) to *look at* — not a CI visual-regression suite. If baseline-diffing
in CI becomes valuable later, `@playwright/test`'s `toHaveScreenshot()` is
the natural next step, but that's a separate, heavier decision (requires
committed baseline images and a review workflow) than what this skill covers.
