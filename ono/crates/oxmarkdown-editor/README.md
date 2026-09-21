# oxmarkdown-editor

Editing-mode spike: evaluating [`taino-edit`](https://github.com/juanma-dev/taino-edit)
as the Lexical replacement — a real ProseMirror/TipTap-inspired Rust
document model + `contenteditable` DOM bridge for Leptos, with **no
JavaScript bridge at runtime** (unlike Lexical, or `leptos-tiptap`,
which wraps the real TipTap JS bundle via `wasm-bindgen`).

## Why this is worth taking seriously

Far more mature than expected going in — not a small crate to
hand-roll around, but a real editor framework: a typed, immutable
document tree (`Node`/`Mark`/`Fragment`/`Slice`), a schema system with
a content-automaton validator, invertible/mappable `Step`s and a
`Transform` builder, `EditorState` with bounded undo/redo history, a
real `contenteditable` bridge (incremental diff/patch, bidirectional
selection sync, IME composition, sanitized clipboard paste,
drag-and-drop, focus management), a `Plugin`/`Extension` system (13
built-in extensions including full tables), and — critically for this
repo's own requirements — **Leptos SSR**: the initial document
server-renders as real HTML via a tested `doc_view_html` ⟷
`EditorView::mount` markup contract. 214 host tests plus a real headless-
Chromium browser test suite.

This means the hard, notoriously-fiddly parts of "replace Lexical" —
selection sync, IME, clipboard sanitization, diff/patch — don't need to
be built from scratch here, unlike the directive-parsing gap
`oxmarkdown-rs` had to close itself (`markdown-rs` had nothing to build
on for that; `taino-edit` has a lot to build on for this).

## Status: minimal built-in schema, proven CSR + SSR

This spike uses `taino-edit`'s own minimal schema (paragraph, bold,
italic — no custom OxMarkdown extensions) specifically to test the
INTEGRATION itself first, isolated from schema-design decisions:

- **CSR: works.** A real `contenteditable` region, typing works, Mod-b/
  Mod-i toggle marks. See "Running it locally" below.

**A real bug found (by a real user testing in a real browser — exactly
the kind of thing this environment can't catch by itself) and fixed**:
Mod-b/Mod-i did nothing except trigger the BROWSER's own Cmd-b
(bookmarks)/Cmd-i (page info) shortcuts, and Ctrl/Option did nothing at
all. Root cause, confirmed by reading `taino-edit-leptos`'s source
directly: `<TainoEditor>`'s `keymap` prop is `Option<Keymap>`, defaults
to `None`, and the component only takes ownership of keyboard input AT
ALL when one is supplied — my first version never built or passed one.
Without it: a browser-reserved combo fires natively (nothing ever
called `preventDefault`), and a non-reserved one does nothing (no OS
binding, no JS handler either) — exactly the reported symptom. Fixed
by building a real keymap via `taino_edit_extensions::build_keymap_with`
from the same extensions list the schema uses, with actual Mac
detection (`navigator.platform`, gated to only run under `csr`/
`hydrate` — SSR has no `navigator` to ask) rather than their own basic
example's hardcoded `mac=false`, so Cmd (not just Ctrl) works on Mac as
expected.
- **SSR: works, confirmed directly** (not taken on faith from the
  README) — `src/bin/ssr_server.rs` returns the real initial document
  as plain HTML with zero JS involved, same proof method
  `oxmarkdown-leptos` used for its own SSR claim.
- **Not yet done: hydration** for this crate specifically (making the
  SSR'd editor live) — `oxmarkdown-leptos` already proved the
  mechanics of csr/hydrate/ssr feature-gating + `rouille` asset
  serving work in this exact workspace shape, so wiring it up here is
  expected to be mechanical repetition of that, not new risk. Skipped
  for this pass to keep focus on the integration question itself.

## A real, load-bearing version mismatch found

`taino-edit-leptos` v0.7.0 requires **Leptos 0.8**, not 0.7 —
`oxmarkdown-leptos` (this repo's own rendering crate) is still on
Leptos 0.7. Confirmed this is fine as two separate crates in the same
Cargo workspace (each resolves its own dependency graph independently;
verified `oxmarkdown-leptos` still builds completely unaffected after
adding this crate) — but it means `taino-edit` cannot be added AS A
DEPENDENCY of `oxmarkdown-leptos` itself without also bumping that
crate to Leptos 0.8 first. Whether/when to do that bump — needed before
these two crates could ever merge into one real editor+renderer
surface — is a real decision, not yet made.

## The markdown ⟷ taino-edit conversion layer: built and proven

`src/convert.rs` parses real OxMarkdown via `oxmarkdown_rs::parse_document`
(the same proven parser `oxmarkdown-leptos` renders with) and converts
the resulting mdast-shaped tree into a real `taino-edit` `Node` tree —
not routing through `taino-edit`'s own Markdown parser at all, since it
has no idea what a directive or `==highlight==` even is. Mirrors the
shape the real product already uses for the same problem
(`editingTransforms.ts` converts mdast ⟷ Lexical nodes) — flattening
mdast's nested `strong`/`emphasis`/`link` NODES into taino-edit's flat
marks-on-text-leaf model, the same conceptual step Lexical's own
conversion needs (Lexical is ALSO a flat-marks-on-leaves model, unlike
mdast).

Loads the real `DEFAULT_SAMPLE`, including `:::gallery{...}`.
Confirmed via the SSR binary that the ENTIRE pipeline round-trips
correctly on real content: the heading, bold/italic/link paragraph, and—
the important case—the `:::note{...}` container directive (unsupported
as a real node) degrades to a VISIBLE placeholder paragraph wrapped in a
plain `blockquote`, with its two real inner paragraphs preserved
correctly across the blank line between them, not truncated or merged.
Task-list checkboxes show as a plain `[ ]`/`[x]` text prefix (no real
checkbox attribute on this minimal schema yet). Nothing is silently
dropped — every currently-unsupported construct (directives,
strikethrough, `==highlight==`, hard line breaks) degrades to plain
visible text instead.

**Images: confirmed working, no fix actually needed.** A first pass of
this README claimed a real gap here ("`convert_block` has no `\"image\"`
arm, needed for gallery support") — that turned out to be an untested,
incorrect assumption, caught by actually checking rather than trusting
the guess: `oxmarkdown_rs::parse_document` wraps consecutive
`![alt](url)` lines (no blank line between them) in one ordinary
`paragraph` node (mdast's `image` is always inline/phrasing content,
never a block type on its own), which `convert_block`'s existing
`"paragraph"` arm already routes through `convert_inline`'s existing
`"image"` case correctly. Confirmed directly: all three
`:::gallery{...}` images render as real `<img src=... alt=...>` tags in
the SSR output. The gallery CONTAINER itself still falls back to the
generic directive placeholder (no real `gallery` node/layout yet) —
only the images inside it were ever in question, and they work.

## Editing behavior fixups, input rules, undo/redo, e2e tests

Since the sections above were written, this crate grew well past "does
typing and Mod-b work" into a real set of editing-behavior fixes on top
of `taino-edit`'s own defaults — all in `src/commands.rs`, whose own
module doc comment is the authoritative, detailed record of each real
bug found (several genuine `taino-edit-core`/`taino-edit-leptos` gaps,
confirmed by reading their source, not assumed) and how it was fixed:

- **Enter** demotes a heading's continuation to a paragraph, inserts a
  literal newline in a code block instead of splitting it, and exits an
  empty line out of its enclosing blockquote (generalized to multi-
  paragraph blockquotes — only the empty line exits, not the whole
  quote).
- **Input rules** (`"- "`/`"* "` → bullet list, `"1. "` → ordered list,
  `"## "` → heading, `"> "` → blockquote) — a gap `taino-edit-leptos`
  never wires up at all, plus a real browser quirk (trailing spaces
  arrive as `\u00A0`, not a plain space) only caught by actual browser
  testing, not native unit tests.
- **Option/Ctrl+Backspace/Delete** (word delete) — `taino-edit-leptos`'s
  keydown handler unconditionally calls `preventDefault()` on any
  Backspace/Delete regardless of modifiers, silently swallowing the
  browser's native word-delete with nothing to replace it.
- **Shift+Enter** inserts a real `hard_break` atom (`<br>`) — a small
  from-scratch schema extension, since none exists upstream — that works
  generically in every block with inline content (paragraph, heading,
  blockquote, list items), not just paragraphs.
- **Undo/redo** — wired up via `taino_edit_extensions::History`
  (`Mod-z`/`Mod-Shift-z`); the core history machinery was already there,
  just never bound to a keymap in this crate. Each transaction is
  currently its own undo group (confirmed both by a native test and by
  the e2e suite below) — real, fast, uninterrupted typing does NOT yet
  coalesce into per-word undo groups the way most real editors do, since
  neither `taino-edit-dom` nor `taino-edit-leptos` ever calls
  `Transaction::join_history`. Flagged as a known, deliberately-deferred
  follow-up, not fixed here.

**A real e2e suite** now lives in `../../e2e/` (Playwright, headless
Chromium) — see its own README for the full rationale, but in short:
native Rust unit tests structurally can't see genuine
browser/`contenteditable` quirks like the `\u00A0` one above, or a caret
landing in the wrong DOM node. Only driving REAL keyboard input through
a REAL browser catches those. `?doc=<url-encoded markdown>` (read by
`initial_markdown()` in `lib.rs`) lets those tests load a small, hermetic
fixture instead of fighting with `DEFAULT_SAMPLE`.

## What's real follow-up work (not started)

The entire point of this spike was answering "does taino-edit work at
all in our stack," not building the real editor. Still ahead, once this
proves out for real (a browser check, not just curl/compiler
confirmation):

- **An actual OxMarkdown schema** — directives (leaf/container/text) as
  real node types via `taino-edit`'s `Extension` trait, task checkboxes
  as a real list-item attribute (matching the JS implementation's own
  deliberate convention — see the `oxmarkdown` skill: "Checklists never
  use `@lexical/list`'s native `\"check\"` list type... a field on a
  custom node" — same shape, different framework), `@`-mentions, and
  `==highlight==`/GFM strikethrough as real mark types. The conversion
  layer's current placeholder-text fallbacks (see above) are exactly
  the call sites that would switch over to real node/mark construction.
- Reconsidering the hard line-break fallback (a literal `\n` character
  ends up embedded in an HTML text run rather than a real line break —
  a cosmetic issue spotted in the SSR output, not chased down yet).
- Merging this with `oxmarkdown-leptos` into one real surface (once the
  Leptos 0.7→0.8 question is resolved) — today they're deliberately
  separate crates so this integration question could be tested in
  isolation.
- Hydration for this crate (see "Status" above).

## Running it locally

**CSR** (interactive, no SSR):

```sh
# from ono/, the workspace root
cargo build -p oxmarkdown-editor --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/debug/oxmarkdown_editor.wasm \
  --out-dir crates/oxmarkdown-editor/web/pkg --target web --no-typescript

python3 -m http.server 4176 --directory crates/oxmarkdown-editor/web
```

Then open `http://127.0.0.1:4176/`.

**SSR** (real content, zero JS, not yet hydrated/interactive):

```sh
# from ono/, the workspace root
cargo run --bin ssr_server --features ssr --no-default-features
curl http://127.0.0.1:4177/
```
