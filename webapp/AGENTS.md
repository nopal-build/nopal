# webapp Agent Notes

The marketing site (`nopal.build`) — home page, About, Tools, Good,
materials/science/stories/assemblies, contact, legal. The product app
(Daily Log, Vault, Maker, Projects, login) split out into its own service,
`fruits/` (`o.nopal.build`) — see `docs/marketing-app-split-plan.md` for
the history and rationale. This app has **no session/auth code at all** —
if you find yourself wanting `getUser` or anything session-shaped here,
that almost certainly belongs in `fruits/` instead.

Stack: React Router 7 (SSR, file-based-ish routes via `app/routes.ts`), React 18,
TypeScript, SurrealDB (read-mostly here — most write-heavy data lives behind
`fruits/`), Notion (as a CMS for materials/science/stories/assemblies).
Tests run with `vitest`.

## UI conventions

- This app is a lighter user of `packages/stamps` (a vanilla-extract-based
  design system shared with `fruits/`) than `fruits/` is — most marketing
  pages still use Tailwind utility classes plus the legacy `Layout`/
  `Footer` chrome, and that's fine here. Where a page or component DOES
  reach for something new, prefer `stamps` over a new Tailwind class or a
  hand-rolled one-off (see `stamps/tokens`, `stamps/sprinkles.css`,
  `stamps/typography.css`, `stamps/button.css`, `stamps/link.css`) — but
  don't go out of your way to migrate marketing pages wholesale; that
  hasn't been a priority here the way it has in `fruits/`.
- `fruits/AGENTS.md` has the full, stricter set of `stamps`-migration
  conventions (including the living style guide at `fruits/app/routes/
  styles.tsx`) if you're touching something that genuinely warrants that
  level of rigor — most marketing work won't.
- A few files under `app/components`, `app/hooks`, and `app/util` (`Layout`,
  `Footer`, `GoodAssets`, `useSchemePref`, `useClickOutside`,
  `email.server`) are duplicated verbatim in `fruits/` (its login/verify/
  welcome/card/public-sharing pages kept the same chrome they had before
  the split) — see each file's own top-of-file comment before assuming a
  change here should also happen there, or vice versa.
- Keep edits consistent with existing formatting/indentation in the file you're
  editing rather than introducing a new style.

## Validation

- Run `npx tsc --noEmit -p .` (or `npm run typecheck`) from `webapp/` after
  non-trivial changes to catch type errors.
- Prefer targeted `diagnostics` checks on the files you changed before a full
  project sweep.
- There's no scripted visual dark-mode check for marketing pages yet (the
  `dark-mode-review` skill's script only covers `fruits/`, since every app
  page requires an authenticated session and marketing pages don't) — for
  now, hand-check `prefers-color-scheme: dark` in devtools after any change
  touching CSS/colors here. This app has no in-app theme toggle, so those
  bugs are otherwise easy to miss.
