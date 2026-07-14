# webapp Agent Notes

Stack: React Router 7 (SSR, file-based-ish routes via `app/routes.ts`), React 18,
Tailwind CSS, TypeScript, SurrealDB. Tests run with `vitest`.

## UI conventions

- Before building or editing any form/UI, check `app/routes/fruits_.styles.tsx`.
  It's the living style guide for this app — it documents the shared components,
  default classes, and patterns that should be reused everywhere.
- Always use the shared components in `app/components` (e.g. `Input`, `Badge`,
  `Chip`) instead of raw `<input>`, `<textarea>`, etc. If a raw element is used
  instead of an existing component, that's a bug — replace it.
- Don't re-apply styling that a shared component already provides by default
  (e.g. `Input` already has border/radius/padding baked in). Only pass a
  `className` for one-off overrides.
- If you add a new visual pattern or prop (e.g. `Input`'s `hideLabel`), add a
  corresponding example to `fruits_.styles.tsx` in the same change so it stays
  the single source of truth.
- Keep edits consistent with existing formatting/indentation in the file you're
  editing rather than introducing a new style.

## Validation

- Run `npx tsc --noEmit -p .` (or `npm run typecheck`) from `webapp/` after
  non-trivial changes to catch type errors.
- Prefer targeted `diagnostics` checks on the files you changed before a full
  project sweep.
