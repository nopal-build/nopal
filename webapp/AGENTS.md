# webapp Agent Notes

Stack: React Router 7 (SSR, file-based-ish routes via `app/routes.ts`), React 18,
Tailwind CSS, TypeScript, SurrealDB. Tests run with `vitest`.

## UI conventions

- Before building or editing any form/UI, check `app/routes/fruits_.styles.tsx`
  — always. It's the living style guide for this app: it documents shared
  components, default classes, and patterns that should be reused everywhere.
  Specifically read section `#component-guide` ("00 · Component Decision
  Guide") first — it has a quick lookup table ("I need to build… → use this"),
  a full component inventory, and rules for when to extract a new component
  vs. keep markup inline. Don't skip this step even for "small" UI changes;
  it's faster than re-deriving a pattern that already exists.
- Always use the shared components in `app/components` (e.g. `Input`, `Badge`,
  `Chip`, `Modal`, `SearchCollection`, `CopyField`) instead of raw `<input>`,
  `<textarea>`, hand-rolled dialogs, or copy-to-clipboard rows. If a raw
  element or duplicated pattern is used instead of an existing component,
  that's a bug — replace it.
- Don't re-apply styling that a shared component already provides by default
  (e.g. `Input` already has border/radius/padding baked in). Only pass a
  `className` for one-off overrides.
- Deciding whether to componentize (see `#component-guide` for the full
  version): used once → keep it inline. Repeated 2+ times in one route file →
  extract a local, unexported component in that same file. Needed on a
  second route, or wraps a native form element → promote it to
  `app/components/` and document it in `fruits_.styles.tsx` in the same
  change. Prefer generic, slot-based props (e.g. `SearchCollection`'s
  `resultsSlot`) over baking one route's business logic into the shared
  component.
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
