# `oxmarkdown-editor` e2e tests

Headless-browser tests driving **real keyboard input** against the CSR
build — Playwright's `page.keyboard.type()`/`press()` go through the
actual browser rendering engine's own text-insertion/key-handling code,
not a synthetic DOM event we construct ourselves. This is the only way to
catch genuine browser/`contenteditable` quirks that native Rust unit
tests structurally cannot see, because the quirk lives in the browser's
own behavior, not in `oxmarkdown-editor`'s logic:

- **Confirmed real example**: a space typed at the true end of a line
  (nothing after it) arrives as `\u00A0` (non-breaking space), not a
  plain space — the browser substitutes it so a trailing space isn't
  visually collapsed away. A native test can assert against a literal
  `\u00A0` once you know to look for it; only *real* typing in a *real*
  browser reveals that the browser does this at all. `input-rules.spec.ts`
  reproduces this for every trigger sequence.
- **Confirmed real example**: the "## " input rule used to leave the
  caret as a DOM sibling of the new `<h2>` rather than inside it — a
  purely DOM-level symptom (visible in devtools, invisible to any test
  that only inspects `taino-edit-core`'s own document model).
  `input-rules.spec.ts`'s heading test checks `document.getSelection()`
  directly for this reason (see `helpers.ts`'s `caretParentTag`).

## Running

```sh
cd ono/e2e
npm install                 # first time only
npm test                    # or: npx playwright test
```

`playwright.config.ts`'s `webServer` rebuilds the wasm bundle from
scratch (`build-and-serve.sh`) before every run and serves it on port
4178 (deliberately different from the manually-run dev servers in
`../crates/oxmarkdown-editor/README.md` — 4176 CSR, 4177 SSR — so this
suite never collides with one you already have running by hand).

Chromium is resolved via the exact `@playwright/test` version pinned in
`package.json` (not a caret range) so it reuses whatever `fruits/`'s own
Playwright install already cached in `~/Library/Caches/ms-playwright`
instead of downloading a second copy — check `fruits/`'s resolved
`playwright` version if you ever bump this one, and try to keep them
matched.

## `?doc=` — why tests don't use `DEFAULT_SAMPLE`

Every test starts from a small, hermetic fixture via `gotoWithDoc()`
(`helpers.ts`), which loads the page with `?doc=<url-encoded markdown>`.
`initial_markdown()` in `../crates/oxmarkdown-editor/src/lib.rs` reads
this query param instead of the large, evolving `DEFAULT_SAMPLE` when
present — purely so these tests don't need to fight with (or churn
alongside) that sample's own content just to find a clean starting point.

## A real gotcha discovered writing these tests

`page.keyboard.press("ControlOrMeta+Z")` (capital `Z`) synthesizes
`event.key === "Z"` **without** `shiftKey` — not the same as an actual
physical `z` keypress. Since `EditingFixups`/`History` bind lowercase
`"Mod-z"`, this mismatch meant our own keydown handler never even ran,
`preventDefault()` was never called, and the *browser's own native
contenteditable undo* fired instead — producing bizarre, misleading
results (undo depth going *up*, not down) that looked like a real
application bug at first. It wasn't: fixed by using lowercase
`"ControlOrMeta+z"` in the test. See `undo-redo.spec.ts`'s own comment.
Worth remembering for any future test that presses a letter-key
shortcut.

## Known gaps in this first pass

- No coverage yet for bold/italic (`Mod-b`/`Mod-i`) or links/images —
  these were manually verified earlier in the project and aren't known
  to be fragile, but automated coverage would still be worth adding.
- `code_block` has no input rule yet (nothing to reach it with real
  typing), so its Enter-inserts-literal-newline behavior is skipped here
  — see `enter.spec.ts`.
