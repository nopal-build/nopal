---
name: stamps
description: Nopal's shared `stamps` design-system package (`packages/stamps`) — reusable, framework-agnostic UI components/hooks used by both `fruits` (app) and `webapp` (marketing), documented live on the Stamps guide page `fruits/app/routes/maker_.stamps.tsx`. Use when adding or changing a component/hook in `packages/stamps`, documenting one on the guide page, or working on consumers that build on stamps primitives (e.g. Vault's website-file split editor in `fruits/app/routes/vault.tsx`).
---

# Stamps design system

`packages/stamps/src` is Nopal's shared component library. It's exported via
subpath exports in `packages/stamps/package.json` (e.g.
`"./ActionBar": "./src/ActionBar.tsx"`) and consumed by both `fruits` and
`webapp`. **Never duplicate a component inside either app** — if both need
it, it belongs here.

Styling uses `@vanilla-extract/css` / `sprinkles` / `recipes`: each visual
component gets a sibling `name.css.ts` file; shared tokens live in
`src/tokens.ts` and `src/sprinkles.css.ts`.

## Adding a new component or hook

1. Create `src/Name.tsx` (+ `src/name.css.ts` if it needs styling).
2. Register it in `packages/stamps/package.json`'s `exports` map — both the
   component and its `.css.ts`, if any.
3. Document it on the guide page, `fruits/app/routes/maker_.stamps.tsx`, in
   the section that matches its category (Icons, Buttons, Boxes & Cards,
   etc.).
4. **Hooks are the exception** — it's fine to leave a hook undocumented on
   the guide page (matches the existing `useScrollSpy` convention).
   `useStickyPaneMaxHeight` was deliberately left off for this reason.

## Guide page gotchas (`maker_.stamps.tsx`)

- Solo icon specimens must be wrapped in `Cluster`, or they stretch to full
  width.
- When writing Playwright checks against this page, scope `getByRole`
  queries to a specific container — labels can collide with unrelated
  controls elsewhere on the same page (hit this more than once).

## Component reference

- **`ExpandIcon.tsx`** — fullscreen-toggle glyph. Uses `currentColor` (not a
  literal hex fill), so it inherits button text color in any state.
- **`LayoutFlipIcon.tsx`** + `.css.ts` — represents a two-pane layout with
  plain CSS boxes (3px radius), *not* an SVG — this was an explicit design
  choice, don't convert it to SVG. Takes an `mdSide: "left" | "right"` prop
  and renders a narrow (fixed) + wide (greedy) box ordered to reflect the
  *current* layout state, not a fixed icon.
- **`ActionBar.tsx`** + `.css.ts` — `ActionBar` / `ActionBarGroup` /
  `ActionBarButton`. Buttons grouped together share one bordered pill (3px
  radius, dividers between buttons); a standalone button is just a
  one-button group. The `active` variant uses `navActiveBg` +
  `colors.purple` — this matches the existing `navLink` convention.
  **Don't use `surfaceInset`** for the active state — it was tried and
  rejected because it's nearly invisible against similarly-toned
  backgrounds.
- **`useStickyPaneMaxHeight.ts`** — shared hook, extracted from a fix
  originally written inline in `DrawerContent.tsx` (which now uses this
  hook instead of its own copy). See "Sticky pane height math" below for
  why it's not just `scroller.clientHeight`.

## Pitfalls (tried and rejected — don't repeat)

1. **Sticky-pane height is not just `scroller.clientHeight`.** It overshoots
   twice over: once for the scroller's own padding (subtract it), and once
   for the pane's natural pre-stuck offset within the scroller caused by
   preceding content like a toolbar (subtract
   `paneRect.top - scrollerRect.top + scroller.scrollTop` too). Both fixes
   live in `useStickyPaneMaxHeight` — don't reintroduce the bug in a new
   sticky-pane consumer by hand-rolling this math again.
2. **A sticky-mobile-bottom-bar reaching the true viewport edge is not a
   margin problem.** A sticky element's `bottom: 0` clamps at the scroller's
   *padding box*, exactly like a top-sticky element does — `margin-bottom`
   can't push it past that boundary. Shift the sticky offset itself instead
   (e.g. `bottom: -20px`).
3. **`scrollbar-gutter: stable` will relocate a phantom-scrollbar bug, not
   fix it.** If an outer scroll container (e.g. `AppLayout`'s `<main>`)
   forces `overflow-y: scroll` (or `scrollbar-gutter: stable`) to avoid
   layout shift, but the actual scrolling happens in a nested inner
   container (e.g. Vault's own `.vault-main`), the outer container ends up
   reserving a gutter for a scrollbar it never shows — same visual bug,
   just invisible instead of a visible bar. If the scrollbar disappears but
   a gap remains where it used to be, check every ancestor for
   `scrollbar-gutter: stable` or a forced `overflow-y: scroll`/`overflow:
   auto` and remove it unless that specific element is the one that
   actually scrolls. Prefer plain `overflow-y: auto` with no
   `scrollbar-gutter` override unless there's a *measured* layout-shift
   problem to solve.
4. **Auto-growing a `<textarea>` must be gated on visibility.** Measuring
   `scrollHeight` to auto-grow a textarea while it (or an ancestor) is
   `display: none` always reads back `0px`, permanently. If a component
   toggles between two panes (e.g. a mobile markdown/preview switch), only
   run the auto-grow effect when that pane is actually the visible one.

## Case study: Vault's website-file split editor

`fruits/app/routes/vault.tsx`'s `WebsitePageSplitEditor` is the fullest
real-world consumer of `stamps` so far, and a good reference for how these
pieces compose. It replaces the plain WYSIWYG editor for markdown files
where `current.websiteAnchor && current.websitePageMeta` is set (other
markdown files still render inside the shared `.vault-readme-section` box;
this component intentionally renders outside it).

- Renders a raw-Markdown pane and a live-Preview pane side by side on
  desktop, one-at-a-time on mobile (`≤859px`), and must render the Preview
  pane **exactly** like the real public site
  (`webapp/app/components/WebsitePageView.tsx`, plain `OxRenderer`, zero
  extra classNames) — build the same directive registry
  (`buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })`) rather than
  approximating the styling. Any preview CSS change must be checked against
  that real render, not assumed.
- Uses `LayoutFlipIcon` (persist the `mdSide` choice to
  `localStorage["nopal:vault:website-split-editor:md-side"]`),
  `ActionBar`/`ActionBarGroup` (desktop pane-flip + expand button; mobile
  markdown/preview switch with Save styled into the same bar), `ExpandIcon`
  (self-contained `position: fixed` fullscreen mode, Escape closes it), and
  `Surface` (wraps the Preview pane) + `useStickyPaneMaxHeight` (desktop
  Markdown pane, 460px, sticky).
- Save is explicit (disabled until dirty), not debounced autosave;
  `onSave` returns a `Promise` so the UI can show a real "Saving…" state.
- All CSS lives in `fruits/app/styles/vault.css`, appended after
  `.vault-readme-section` under `.vault-website-editor*` class names.
- `WebsitePublishToggle` (the publish/draft badge) lives inside this
  component now, to the left of the `ActionBar`, rather than floating
  separately like it used to.

### Testing this kind of change safely

- A real test fixture already exists: `projects/nopal-web/terrain.md`
  (file id `td9iqfkr46bpscmceovx`, owner `super_1`). Before and after any
  live test, re-check its `updated_at` via a throwaway script to confirm
  nothing was accidentally saved.
- Dev stack is docker-compose: `fruits` on `:3001`, SurrealDB on `:8080`
  (`root`/`root`). One-off scripts run from `nopal/fruits/`:
  `DATABASE_URL=http://localhost:8080/rpc DATABASE_USERNAME=root DATABASE_PASSWORD=root npx vite-node scripts/<name>.ts`.
  Delete throwaway `tmp-*.ts` scripts (and `tmp/visual-check/*.png`) as soon
  as you're done with them.
- Drive the real UI with Playwright clicks for anything that triggers a
  React Router `useFetcher` action — a raw `fetch()` POST won't carry the
  right headers and will silently fail differently than a real click would.
- `edit_file` can occasionally apply part of a diff and then throw a
  JSON-parse error, leaving the file broken mid-edit. Always re-read the
  file after such an error before making further edits.
