# webapp Agent Notes

Stack: React Router 7 (SSR, file-based-ish routes via `app/routes.ts`), React 18,
TypeScript, SurrealDB. Tests run with `vitest`. Styling is mid-migration from
Tailwind CSS onto `packages/stamps`, a vanilla-extract-based design system
shared with any future non-webapp surface — see the UI conventions below.

## UI conventions

- Before building or editing any form/UI, check `app/routes/fruits_.styles.tsx`
  — always. It's the living style guide for this app: it documents shared
  components, default classes, and patterns that should be reused everywhere.
  Specifically read section `#component-guide` ("00 · Component Decision
  Guide") first — it has a quick lookup table ("I need to build… → use this"),
  a full component inventory, and rules for when to extract a new component
  vs. keep markup inline. Don't skip this step even for "small" UI changes;
  it's faster than re-deriving a pattern that already exists.
- Always use the shared components from `packages/stamps` (e.g. `Input`,
  `Badge`, `Chip`, `Modal`, `Surface`, `CircleButton`, `MoreMenu`,
  `SearchCollection`, `CopyField` — imported as `stamps/Input`, `stamps/Badge`,
  etc.) instead of raw `<input>`, `<textarea>`, hand-rolled dialogs, or
  copy-to-clipboard rows. If a raw element or duplicated pattern is used
  instead of an existing component, that's a bug — replace it. New *shared*
  (cross-surface-ready) primitives belong in `packages/stamps`, not
  `app/components` — see `#component-guide` in `fruits_.styles.tsx` for the
  full inventory of what's already there and where it lives. `app/components`
  is for webapp/marketing-specific components (`Layout`, `AppLayout`,
  `GoodAssets`, etc.) that aren't meant to be shared.
- This app is migrating off Tailwind onto `packages/stamps` (a
  vanilla-extract-based design system) — don't add new Tailwind utility
  classes. Concretely:
  - **Colors**: use `stamps/tokens`'s `semanticColors` (preferred —
    `textPrimary`, `textSubtle`, `surfaceCard`, etc., already flip correctly
    for dark mode) or `colors`/`palette` for a literal/nature-named hue, not
    a raw `var(--x)` string or a Tailwind color class.
  - **Spacing & layout**: use `stamps/sprinkles.css`'s `sprinkles()` instead
    of Tailwind's spacing/layout utility classes (`p-4`, `gap-2`, `flex`,
    `items-center`, `mb-6`, `text-right`, …) — e.g.
    `sprinkles({ p: 4, gap: 2, display: "flex", alignItems: "center" })`.
    Only reach for a new scale value if the existing one (documented in
    `sprinkles.css.ts`) genuinely doesn't cover it — don't invent one-off
    pixel values when a nearby scale step would do.
  - **Typography**: use `stamps/typography.css`'s `textSize` (`textSize.sm`,
    `textSize["3xl"]`, etc. — pairs `font-size`/`line-height` together, so
    don't set them separately) for font size, and `stamps/sprinkles.css`'s
    `sprinkles()` for `fontWeight`, `fontFamily` (`mono`/`hand`),
    `fontStyle`, `textTransform`, `letterSpacing`, and standalone
    `lineHeight` — not Tailwind's `text-sm`, `font-bold`, `font-mono`,
    `italic`, `uppercase`, `tracking-wide`, etc. Use `stamps/typography.css`'s
    `truncate` for Tailwind's `truncate` (don't set `overflow`/
    `text-overflow`/`white-space` separately).
  - **Buttons**: use `stamps/button.css`'s `button` recipe (`button({
    variant: "primary" | "secondary" | "outline" | "purple" | "yellow" })`)
    instead of Tailwind/legacy `.btn`/`.btn-primary`/`.btn-secondary`/
    `.btn-outline`/`.btn-purple`/`.btn-yellow` classes. For a tinted
    variant (e.g. a destructive action), pass `tint: "danger"` instead of
    the old `style={{ "--btn-color": "var(--red)" }}` escape hatch.
  - **Links**: use `stamps/link.css`'s `link` class instead of the
    Tailwind-adjacent legacy `.link` class — applies to `<a>`, `<Link>`,
    or a plain inline `<button>` (e.g. a "cancel" action styled as a link).
  - The only non-migrated legacy classes left are `.menu-item` and
    `.collection-well` — still fine to use as-is for now (they're custom
    CSS, not Tailwind, so they're a separate concern from this migration).
    Don't block a change on migrating something unrelated to what you're
    already touching; do migrate whatever Tailwind you *do* touch in the
    same change.
- Don't re-apply styling that a shared component already provides by default
  (e.g. `Input` already has border/radius/padding baked in). Only pass a
  `className` for one-off overrides.
- Deciding whether to componentize (see `#component-guide` for the full
  version): used once → keep it inline. Repeated 2+ times in one route file →
  extract a local, unexported component in that same file. Needed on a
  second route, or wraps a native form element → promote it to
  `packages/stamps` (or `app/components/` if it's genuinely
  webapp/marketing-specific, not meant to be shared) and document it in
  `fruits_.styles.tsx` in the same change. Prefer generic, slot-based props
  (e.g. `SearchCollection`'s `resultsSlot`) over baking one route's business
  logic into the shared component.
- If you add a new visual pattern, component, or prop (e.g. `Input`'s
  `hideLabel`), add a corresponding live example to `fruits_.styles.tsx` in
  the same change so it stays the single source of truth — an undocumented
  component might as well not exist to the next agent that touches this repo.
- Keep edits consistent with existing formatting/indentation in the file you're
  editing rather than introducing a new style.

## Validation

- Run `npx tsc --noEmit -p .` (or `npm run typecheck`) from `webapp/` after
  non-trivial changes to catch type errors.
- Prefer targeted `diagnostics` checks on the files you changed before a full
  project sweep.
- After any change touching CSS, colors, or `app/styles/*.css`, use the
  `dark-mode-review` skill to capture and visually check both light and dark
  mode screenshots before considering the work done — this app has no
  in-app theme toggle, so `prefers-color-scheme` bugs are otherwise easy to
  miss.
