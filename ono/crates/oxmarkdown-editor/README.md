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

Loads the real `DEFAULT_SAMPLE`, including `:::gallery{...}`. **As of
the real OxMarkdown schema work below, directives/checkboxes/highlight/
strikethrough are no longer placeholder fallbacks** — confirmed via the
SSR binary that the ENTIRE pipeline round-trips onto REAL node/mark
types: the `:::note{...}` container directive is a real
`container_directive` node (`<div class="ox-directive-container"
data-directive-name="note">`) with its two real inner paragraphs as
genuinely separate, individually-editable children (not text swallowed
into a placeholder), preserved correctly across the blank line between
them; task-list checkboxes are real (if not yet interactive) `<input
type="checkbox">` atoms, not a `"[ ] "` text prefix. The one remaining
placeholder-degradation is a hard line break (`break` → a plain space
stand-in) — see "What's real follow-up work" below.

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
- **Shift+Enter has no soft/hard-break distinction at all** — a
  deliberate product call: this editor is closer to a code editor than a
  document editor, so in a plain paragraph or heading Shift+Enter is
  IDENTICAL to plain Enter (same underlying functions, not just matching
  behavior). The only real difference: inside a blockquote or list item,
  Shift+Enter never exits/lifts on an empty line the way plain Enter
  does — it always just splits, staying in the same container. This
  needed zero container-specific code: a single-level `split_block` (the
  same base command plain `"Enter"` itself falls back to) inherently
  only ever splits the immediate textblock, never lifts or joins.
  **An earlier design briefly used a real `hard_break` atom (`<br>`)
  instead**, to give Shift+Enter an actual in-line soft break — removed
  after hitting a genuine, confirmed `taino-edit-dom` bug: typing
  immediately after a trailing `<br>` in the LIVE DOM merges the new text
  into the preceding run instead of following the break (isolated to the
  live incremental DOM patcher specifically; the document model and a
  full static render were both proven correct). Moot now — there's no
  atom left to trigger it.
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

## The real OxMarkdown schema: built, not yet interactive

`src/oxmarkdown_schema.rs` adds the real node/mark types the sections
above describe using: `Highlight`/`Strikethrough` marks, and three
directive node kinds (`leaf_directive`/`container_directive`/
`text_directive`) plus a `Checkbox` inline atom, wired into `convert.rs`.
That module's own doc comment is the authoritative record of two real
constraints found (not assumed) while building it:

- **`DomSpec` has no way to render arbitrary computed markup** the way a
  Lexical decorator node can render a whole React component — confirmed
  by reading its source (`tag` + HTML `attr`s + whether children render
  inside, nothing else). A leaf/text directive's human-readable
  `::name{...}` label is therefore stored as the node's own literal
  (synthetic, not user-typed) text content, generated once at parse
  time — still `atom: true` regardless (matching `Image`'s own
  precedent). The REAL source of truth for eventual round-tripping is
  the separate `name`/`attributes` attrs (`attributes` holds the ENTIRE
  `{key="value" ...}` set as one JSON object — possible at all because
  `AttrValue` is genuinely just `serde_json::Value`, confirmed by
  reading `taino-edit-core::attrs`'s source), not this display text.
- **Checkboxes deliberately do NOT follow the real product's own
  "attribute on the list item" convention.** `taino-edit-extensions`'s
  `Lists` extension already registers a `"list_item"` node type, and
  `SchemaBuilder::build` hard-errors on any duplicate type name
  (confirmed by reading its source) — a second, competing schema
  addition for `"list_item"` can't coexist with using `Lists` at all,
  and forking `Lists` entirely was disproportionate to what a checkbox
  needs. Used a `Checkbox` INLINE ATOM instead (the first inline child
  of a task item's first paragraph) — achieves the same practical goal
  (a real, losslessly round-trippable, individually-selectable state)
  without forking anything.

**Confirmed via the SSR binary against the real `DEFAULT_SAMPLE`**: the
`:::note{...}` container directive, `::badge{...}` leaf directive,
`:ref{...}` inline directive, both task checkboxes, and the GFM
strikethrough in the sample's own intro paragraph all render as their
real new node/mark types, not placeholders — see this crate's own
`convert.rs` test module for the equivalent native-test proof (leaf/
container/text directive attr preservation, checkbox state, highlight/
strikethrough marks, and confirming an `@`-mention-style link needs no
special handling at all).

## The markdown/rendered playground (`web/playground.html`)

A live, two-column split view — markdown source on the left, the SAME
`convert.rs`/`doc_view_html` render on the right, updating on every
keystroke — for isolating one directive/syntax construct at a time
instead of always testing against the full `DEFAULT_SAMPLE`. Mounted via
a separate `mount_playground()` CSR entry point (`index.html`/`App` are
untouched). The right column is deliberately a deterministic, read-only
render, not a second live editor, so it can never drift from the source.
See `../../e2e/tests/playground.spec.ts` for the e2e coverage. This is
what surfaced the real GFM parsing nuance documented in the next section.

## Live task-list input rule: typing `"- [ ] "` creates a real checkbox

`commands.rs`'s `checkbox_on_input` closes a real gap the schema work
above left open: checkboxes only ever came from the STATIC markdown→doc
conversion; typing task-list syntax directly into the live editor didn't
do anything special at all. Deliberately a SEPARATE input rule from the
bullet-list one, not one combined `"- [ ] "` pattern — `InputRules`
fires on every keystroke, so `"- "` alone ALREADY converts to a bullet
list two keystrokes in, well before `"[ ] "` exists to match against.
The new rule instead fires on `"[ ] "`/`"[x] "`/`"[X] "` at the very
start of a paragraph that is ITSELF a list item's own child — which also
correctly declines for a bare `"[ ] hello"` with no list marker at all,
matching a REAL GFM parsing nuance confirmed directly (not assumed) via
a throwaway `oxmarkdown-rs` example: `markdown-rs`'s own GFM task-list
parser only recognizes `"- [ ] "`/`"- [x] "` as a checked/unchecked item
when there's TEXT after the checkbox marker — `"- [ ] "` with nothing
following parses as a plain list item containing the literal text
`"[ ]"`, no `checked` field at all. Confirmed live in a real browser via
`e2e/tests/checkbox-input-rule.spec.ts`, not just natively.

## Checkbox click-to-toggle: real, via a `ViewPlugin` — and a real bug found doing it

The checkbox's `<input>` is no longer `disabled` — clicking it genuinely
toggles `checked` in the model, via `oxmarkdown_schema::
CheckboxTogglePlugin`, a `taino-edit-dom` `ViewPlugin` ("extensions ...
needing real pointer interaction", per that trait's own doc comment).
Two real, confirmed-by-reading-source constraints, not assumed:

- `TainoEditor` only ever pipes `"mousedown"`/`"mousemove"`/`"mouseup"`
  through `ViewPlugin::handle_event` — never `"click"` — so the plugin
  reacts to `"mousedown"` and calls `event.prevent_default()` itself, to
  stop the browser's OWN native checkbox toggle from ALSO firing now
  that the `<input>` can receive pointer events at all.
- `EditorView::pos_at_point` (`document.elementFromPoint` + walking up
  to the clicked element's own tracked position) reliably resolves a
  click squarely on the checkbox to its own atom position, confirmed via
  5 native tests covering flip-both-directions, the position-after
  fallback, decline-with-no-checkbox-there, and selection preservation.

**A real, SEPARATE, and more serious bug was found live-testing this**
(not by the click feature causing it — the click just exposed it): typing
text immediately after `checkbox_on_input` inserts the checkbox used to
be a REAL, correctly-placed new DOM text node that never synced into the
model at all — confirmed by reading `taino-edit-dom`'s own
`read_dom_changes` source directly, not guessed. It had exactly two
detection paths: diff an EXISTING tracked text run, or detect text in a
block with ZERO tracked children (`find_empty_block_text`). Neither
covered "a brand-new text node appeared next to an existing non-text atom
in an otherwise non-empty block" — the checkbox was the block's ONE
tracked child, so newly-typed text stayed a pure DOM/visual illusion,
invisible to the model, until something else forced a re-render built on
the stale (checkbox-only) doc — which then left the untracked text
orphaned in the DOM, and any FURTHER typing landed wherever the
(also-stale) tracked tree thought the block ended, not visually where you
just typed.

**Fixed, not deferred** — decided against the two other options
considered (an unverified empty-text-node workaround, or documenting it
as a narrow-scope limitation and moving on) in favor of forking
`taino-edit-dom` and patching the real root cause: see `../../vendor/
taino-edit` (a git submodule, patched fork, branch
`fix/checkbox-atom-text-sync`, pushed to `gwing33/taino-edit` for an
eventual upstream PR) and the `[patch.crates-io]` entries in the
workspace `Cargo.toml`. Two gaps fixed there, mirror images of each
other: `find_empty_block_text`'s detection-side gap above, widened from
"block has zero tracked children" to "block has no tracked *text*
children" (empty OR atom-only), plus a second gap found FIXING the
first live: `try_patch`'s DOM-cleanup step only stripped foreign/orphaned
nodes when the OLD children list was fully empty, so an atom-only block
never got that cleanup and grew a duplicate stray character on every
keystroke after the first. Confirmed fixed live via
`../../e2e/tests/checkbox-interactivity.spec.ts` (no longer
`test.fail()`-marked) and a new regression test in the fork itself
(`taino-edit-dom`'s own `tests/atom_text_sync.rs`).

**Deliberately NOT done in this pass** (real follow-up work, not
oversights):

- **No HTML `parse_dom` for the new node/mark types** — pasting
  externally-formatted content shaped like a directive/checkbox won't
  reconstruct one; out of scope until paste itself is a real feature
  for this crate.

## Directive click-to-select + attrs-editing popover: `directive_popover.rs`, real now

Clicking a directive (or the `:ref{...}` glyph) used to do nothing at
all. Now it selects the directive and, for every directive except
`:ref{...}` (see below), opens a real popover for editing its attrs —
matching the real product's own "Interactables" convention (see the
`oxmarkdown` skill).

- **Bridges a `ViewPlugin` (no Leptos knowledge, lives in
  `taino-edit-dom`) to the surrounding Leptos component tree via a
  plain `Rc<dyn Fn(Option<PopoverTarget>)>` callback** — the ONE place a
  `ViewPlugin` genuinely holds a live `&EditorView` is inside
  `handle_event` itself, so popover POSITIONING (`node_dom_at` +
  `get_bounding_client_rect()`) is computed right there, at click time,
  not by the Leptos side reaching back into the view later (it can't —
  `EditorView` isn't a reactive value it can hold onto).
- **Finding the clicked directive needed no separate DOM-class check,
  only `pos_at_point`** — confirmed by reading its source: leaf/text
  directive nodes here are NOT true zero-content atoms (`content:
  Some("text*")` for the synthetic label — see `oxmarkdown_schema`'s
  own doc comment), so a click on a directive's own wrapping element
  already resolves to that node's exact position; a click inside a
  CONTAINER directive's nested child paragraph resolves to that
  paragraph's position instead (a different `ViewDesc`, matched
  first), correctly declining to open the popover for ordinary editing.
- **A real bug found and fixed live, not by reasoning alone**:
  `checkbox_at_or_before`'s own `pos - 1` fallback (for imprecise pixel
  coordinates landing just past a true zero-content atom) does NOT
  transfer here — a live browser test caught it directly. Clicking a
  container's FIRST child paragraph's own content wrongly opened the
  popover, because `pos - 1` from that click legitimately resolves to
  the ENCLOSING container's own boundary (a real, different, OUTER
  node), not "the same atom, slightly off" the way it does for a true
  atom like `checkbox`. Fixed by dropping the fallback entirely for
  directives — `pos_at_point`'s own primary resolution is already
  exact enough for these (larger, non-atom) elements.
- **Save regenerates the synthetic display content, never just patches
  attrs in place** — reuses `convert.rs`'s own `directive_content`/
  `format_directive_label` (now `pub(crate)`) so an edited `"badge"`'s
  pill or a `:ref{...}`'s spelled-out text never goes stale relative to
  its new attrs. A `container_directive`'s real child content is left
  completely untouched — only its `attributes` attr changes.
- **`:ref{...}` is excluded from the popover entirely** (`is_editable_
  directive`), per the `graphlog` skill's own "The `:ref{...}` directive"
  section: GraphLog is the only writer, so it never gets the generic
  attrs-editing popover every other directive gets. Confirmed live.
- Attrs are edited as plain key/value string rows (add/remove freely),
  matching the real `{key="value" ...}` syntax model — no nested/
  non-string JSON values in this UI, since the parser itself never
  produces any. A "Remove directive" action deletes the whole node.
- Confirmed live via 7 new e2e tests
  (`../../e2e/tests/directive-popover.spec.ts`): open pre-filled, edit +
  save updates the render, add-then-reopen persists, cancel is a true
  no-op, remove deletes it, `:ref{...}` never opens it, and clicking a
  container's nested content edits normally instead of opening it.

## A directive atom wasn't actually atomic against Enter/Arrow/Space — fixed, then reversed back to the `oxmarkdown` skill's spec

Reported live: pressing Enter after selecting a `::badge{...}` duplicated
it into two; arrowing away from one with nothing adjacent had nowhere to
land; typing a character (even just Space) could corrupt the document
outright. All three were the SAME root cause, in `commands.rs`'s own
module doc comment (item 4) in full — short version: `leaf_directive`/
`text_directive` declare `content: Some("text*")` for their synthetic
display label (see `oxmarkdown_schema`'s doc comment on why), so
`atom: true` only ever governed THIS crate's own click handling
(`directive_popover.rs`) — nothing stopped a plain keyboard ArrowLeft/
Right from an adjacent block landing a real `Text` caret one level
inside a directive's own content, same as any ordinary textblock. Once
there, `split_block` (Enter's base command) has no atom-awareness at
all and happily split the directive in two; typing a character hit a
genuinely corrupting native-Chrome "replace selected element" code
path (confirmed live: produced literal `<font>`/`<span style>`/`<b>`
garbage neither this schema nor `read_dom_changes` has any tracked
meaning for).

**This section originally described two more rounds of live-feedback
fixes that let Space enter a directive's content and type directly into
it, with arrow keys moving freely within that content once inside. Both
were fully REVERSED (`commands.rs`'s own module doc comment, item 7),
by explicit product decision, after re-reading the `oxmarkdown` skill's
own "Selection model" carefully: it never described a directive's
rendered content as something you type into directly at all — only
"click/tap selects and shows a tooltip or a popover for editing its
attributes."** The design below is what actually ships today:

- **`directive_at_selection`** finds either trap case (a real
  `Selection::Node`/its degraded live-DOM shape, or a caret stuck
  inside a leaf/text directive's own content), backing new `"ArrowLeft"`/
  `"ArrowRight"` entries chained ahead of the base `caret_left`/
  `caret_right`, and brand new `"ArrowUp"`/`"ArrowDown"` entries
  (unbound before now).
- **Arrow keys now always SELECT a directive they land on, never enter
  its content** — matching the skill's own wording exactly ("arrow-key
  navigation onto it ... always selects only — never ... places a bare
  caret inside it"). `arrow_left_fixups`/`arrow_right_fixups` peek at
  where the base `caret_left`/`caret_right` would land (same
  throwaway-capture technique the checkbox fixup below uses); if that
  landing spot would be `caret_trapped_in_directive`, it's overridden to
  `select_directive_as_unit` (a real `Selection::Node`) instead of being
  left as a bare caret. A caret found ALREADY trapped (native vertical
  `ArrowUp`/`ArrowDown` movement is the one entry point that can still
  produce this — no keymap hook to peek at, same residual gap the
  checkbox fixup documents) self-heals into a `Selection::Node` on the
  very next ArrowLeft/Right press, rather than being treated as
  editable text.
- **Once selected, arrow keys escape via `exit_directive`, always
  landing in a real textblock**: an adjacent sibling directive is
  selected as a `Node` in turn (individually navigable, matching the
  `oxmarkdown` skill's own convention), an adjacent plain block is
  landed inside directly, and — the part making "always able to arrow
  out, even with nothing next to it" true — a fresh empty paragraph is
  inserted and landed in when there's genuinely nothing there at all.
- **Enter needed its OWN escape shape, not `exit_directive`'s**:
  reported live, reusing the arrow-key escape for Enter meant pressing
  Enter right after a badge that happened to sit next to a totally
  unrelated directive (e.g. a `:::gallery` immediately following) jumped
  straight to SELECTING that gallery — surprising, since Enter means
  "give me a new line," never "jump to something else."
  `exit_directive_with_new_line` always inserts a fresh paragraph,
  unconditionally, ignoring whatever already follows.
- **Space has no directive-specific action at all anymore** —
  `space_in_directive` is deleted outright. The skill's own
  interactable list gives directives exactly one action ("click/tap
  selects and shows ... a popover for editing its attributes"); Space
  isn't in it. Editing a directive's own label now happens ONLY through
  the attrs popover (`directive_popover.rs`).
- **The anti-corruption mechanism moved from a per-key keymap allowlist
  to a real, generic fix in the vendored `taino-edit-leptos` fork**
  (`vendor/taino-edit`) — the original fix only ever intercepted Space
  specifically, leaving every OTHER printable key free to reach
  Chrome's native "replace selected element" corruption path. The new
  `selection_touches_an_atom` helper (fully generic, no `oxmarkdown`
  knowledge — just `NodeType::is_atom()`, which already existed in
  `taino-edit-core` but was never actually consulted by the DOM/Leptos
  adapters before this patch) makes ANY key, not just ones this crate
  happens to bind, as unconditionally structural as `"Enter"`/
  `"Backspace"`/`"Delete"` already were, whenever the live selection is
  a whole atom. **This patch had to be added to `ono/Cargo.toml`'s own
  `[patch.crates-io]` table as a NEW entry** (`taino-edit-leptos`,
  alongside the pre-existing `taino-edit-dom`/`taino-edit-core` ones) —
  a real, confirmed-live gap of its own: `cargo check`/`cargo test`
  against the submodule directly (its own separate Cargo workspace)
  happily succeed even when `ono`'s own build isn't patched to use it at
  all, silently exercising the unpatched crates.io version instead. Only
  a live e2e test caught this (the fix visibly doing nothing until the
  patch entry was added).
- **A second real, confirmed-live `taino-edit-dom` gap found WHILE
  fixing this, not by reasoning alone**: `EditorView::read_selection`
  ALWAYS reconstructs `Selection::Text`, never `Selection::Node` —
  confirmed by reading its source — and `taino-edit-leptos`'s keydown
  handler re-reads the live DOM selection at the top of EVERY keydown,
  unconditionally overwriting whatever `Selection::Node` a previous
  click had set. A directive that's genuinely still selected on screen
  therefore shows up, by the time any keymap command runs, as a `Text`
  RANGE whose `anchor`/`head` happen to exactly bracket the node — not
  as `Selection::Node` at all. First version of this fix checked only
  for literal `Selection::Node` and silently did nothing on every real
  keypress; caught immediately by live testing (never trust that a
  model-level `Selection::Node` "just stays set" across a keydown
  round-trip without confirming it against the ACTUAL live browser
  path, not just a native unit test). `directive_at_selection` (and the
  fork's own `selection_touches_an_atom`) both detect both shapes
  explicitly.
- Confirmed live via e2e tests
  (`../../e2e/tests/directive-escape.spec.ts`), reproducing the exact
  reported symptoms before asserting each fix: Enter never duplicates
  and always inserts a genuinely NEW paragraph (never reusing or
  jumping to whatever's already next, including an unrelated adjacent
  directive); arrow keys always escape even with nothing after the
  directive; arrowing FROM an adjacent block onto a directive always
  SELECTS it (confirmed by a single Backspace removing it outright,
  never just editing one character of its label); Space and ordinary
  character typing do nothing at all while a directive is selected, with
  no corruption; and a caret that reaches the trap via native vertical
  arrow movement (never clicking at all) self-heals into a selection and
  still escapes cleanly on Enter.

## The caret could land right before a checkbox — fixed

Reported live: a checkbox is always its list item's own leading glyph
(GFM's own `[ ]`/`[x]` is always the line's first thing — there's no
syntax for text before it at all), yet ArrowLeft/Home could still land
the caret in the one position right before it. Same root shape as the
directive fixes above, a different symptom: `taino-edit-core`'s base
`caret_left`/`caret_line_start` have no atom-awareness either.

- **`skip_before_checkbox`** peeks at where the base command would
  land (running it against a throwaway capture, then inspecting the
  result via `state.apply` — `taino-edit-core` keeps its own walking
  logic private, so there's no way to ask it directly) and, when
  that's immediately before a leading checkbox, walks further back to
  the END of whatever textblock precedes the checkbox's own list item
  — always a meaningful position, regardless of what THAT block itself
  starts with — looping outward again if even THAT turns out to be
  `before_leading_checkbox` too (the list's own first item).
- **A real bug found live, not by arithmetic alone**: the first version
  computed the "skip back" landing spot by hand (`before(outer_depth)
  - 1`), which can resolve one level SHALLOWER than intended right at a
  block boundary — landing on the enclosing `list_item`'s own
  content-end instead of the preceding paragraph's, failing a
  "is this a real textblock" check for no real reason. Fixed by
  delegating that sub-problem back to the base `caret_left` itself
  (which already resolves this ambiguity correctly) instead of
  reimplementing its own position arithmetic.
- **Home and ArrowLeft deliberately behave differently when there's
  truly nothing to skip back to**: ArrowLeft (a pure navigation
  gesture) declines outright, matching how it already behaves at the
  very start of a document. Home always lands somewhere — falling back
  to right after the checkbox itself, the most sensible "start of
  line" a checkbox-led paragraph actually has.
- Deliberately scoped to `"ArrowLeft"`/`"Home"` only, both real keymap
  entries this crate controls. Native vertical `"ArrowUp"` movement has
  no keymap hook to peek at all (confirmed: nothing binds plain
  `"ArrowUp"` for ordinary vertical movement, only this crate's OWN
  directive-escape entry, which declines whenever no directive is
  involved), so it can still land there — a known, narrower-than-ideal
  residual gap, not attempted here.
- Confirmed live via 4 new e2e tests
  (`../../e2e/tests/checkbox-navigation.spec.ts`).

## Markdown serialization back out: `serialize.rs`, real now

`convert.rs` was one-way (markdown → taino tree only) until now — nothing
typed or toggled could actually be saved. `serialize.rs` is the reverse
direction: taino `Node` → mdast-shaped JSON → real OxMarkdown text, the
last step reusing `oxmarkdown_rs::serialize_document` (the SAME
mdast-JSON → markdown half `oxmarkdown-rs`'s own round-trip tests
already prove), not a second hand-rolled writer.

- **Directive attrs are the source of truth on the way out, too** —
  `directive_to_mdast`/the `text_directive` case rebuild straight from a
  node's real `name`/`attributes` attrs, never from `convert.rs`'s own
  synthetic display content (the `"badge"`/`"ref"` label, the `*`
  glyph, ...). Confirmed round-tripping cleanly by dedicated tests for
  both.
- **The checkbox atom is un-done, not re-serialized as itself** —
  `list_item_to_mdast` pulls a leading `checkbox` atom off a list item's
  first paragraph and sets mdast `listItem.checked` from it, the exact
  reverse of `convert::convert_list_item`'s own extraction (see
  `oxmarkdown_schema`'s doc comment for why a checkbox is an inline atom
  here at all, not a `list_item` attribute).
- **Mark nesting order is a deliberate, fixed choice** — `taino-edit-
  core`'s `Node::marks()` is an unordered set on a text run, not a
  nested tree the way mdast's own wrapper nodes are. `code` always wins
  outright (drops every other mark — a real code span's content is
  literal, no nested markup); otherwise link wraps outermost, since a
  "linked run of styled text" reads as a link wrapping styled content,
  not the reverse.
- **Proven by the strongest test this bridge can get**: parse →
  serialize → parse again must produce the identical tree (the same
  convention `oxmarkdown-rs`'s own `serialize.rs` tests already hold
  the JS-side half to) — 14 round-trip tests covering every construct
  this schema has: marks, headings, blockquotes, code blocks, both list
  kinds, mixed-checked task lists, highlight/strikethrough, images, and
  all three directive kinds (generic, `"badge"`, both `:ref{...}`
  renderings).
- **`doc_to_markdown`/`markdown_to_doc` are now real public API** of
  this crate (re-exported from `lib.rs`), not playground-only internals
  — needed by any future embedder (a save feature, or merging with
  `oxmarkdown-leptos`), and incidentally what keeps `doc_to_markdown`
  genuinely reachable under the `ssr` feature alone, whose only
  INTERNAL caller (the playground) is CSR-only.
- **Live, hands-on proof**: the playground (`web/playground.html`) grew
  a third column, "Round-tripped markdown" — the SAME parsed document
  re-serialized back, live on every keystroke, so comparing column 1
  against column 3 is the interactive version of the round-trip tests
  above. Confirmed via `../../e2e/tests/playground.spec.ts`.

## Per-directive-kind rendering: `"badge"`/`"ref"` are the first two, real interactivity still deferred

Every directive used to render as the same generic, raw-syntax
`::name{attrs}`/`:name{attrs}` label regardless of its name — honest,
but clearly not the final look for anything. `convert.rs`'s
`directive_content` now dispatches on the directive's own `name` to
build real, specific content for the two names called out first:

- **`"ref"`** (a `:ref{...}` text directive) mirrors the `graphlog`
  skill's own "The `:ref{...}` directive" section exactly: `verbose=
  "true"` renders fully spelled out (`name · date · source`, `source` a
  REAL link mark pointing at `location`, via the same `with_mark`
  helper `[text](url)` links already use — not a second link
  mechanism); omitted/anything else renders as a single `*` glyph. A
  hand-rolled `format_ref_datetime` (no date crate needed — the
  `datetime` attr's shape is fixed enough to parse by hand) mirrors the
  real product's own `formatRefDatetime`, pinned to UTC for the same
  reason that one is (SSR/hydration would otherwise disagree on the
  viewer's own timezone).
- **`"badge"`** (a `::badge{label="..."}` leaf directive, the generic
  example directive both this crate's own `PLAYGROUND_SAMPLE`/
  `DEFAULT_SAMPLE` and the real product's own `/maker/stamps/oxmarkdown`
  demo use) renders its `label` (falling back to `text`, then the
  directive name itself) alone, styled as a real pill
  (`.ox-directive-badge`, `web/shared.css`) — not the website-specific
  `::badge{text=... variant=...}` directive `fruits/app/oxmarkdown/
  websiteDirectives.tsx` registers for website pages specifically; there
  is no "website" domain concept in this crate yet.
- Any OTHER directive name still falls through to the original generic
  raw-syntax label — the same "unknown directive" convention the real
  product's own `OxRenderer` uses, confirmed still working by
  `convert.rs`'s own `unknown_directive_falls_back_to_the_raw_syntax_
  label` test.

`oxmarkdown_schema.rs`'s `directive_kind_class` adds the matching CSS
hook (`ox-directive-badge`/`ox-directive-ref-verbose`/
`ox-directive-ref-glyph`) onto the SAME three node types every directive
already used (no new node type per name) — reading the `verbose` attr
back out of the `attributes` JSON blob via a small `directive_attribute`
helper. Confirmed live via `../../e2e/tests/playground.spec.ts` and a
fresh SSR build of the real `DEFAULT_SAMPLE`, not just native tests.
**Still explicitly NOT interactivity** — the `*` glyph doesn't open a
popover yet (see "Deliberately NOT done" above); this is presentation
only.

## What's real follow-up work (not started)

The entire point of this spike was answering "does taino-edit work at
all in our stack," not building the real editor. Still ahead:

- The directive/checkbox interactivity and serialization gaps just
  above.
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

Then open `http://127.0.0.1:4176/`, or
`http://127.0.0.1:4176/playground.html` for the markdown-source /
rendered-output split view (`web/playground.html`, mounted via the
separate `mount_playground()` CSR entry point) — a live, isolated way to
test one directive/syntax construct at a time (type on the left, see
the exact `convert.rs`/`doc_view_html` output on the right, no need to
edit `DEFAULT_SAMPLE` or reload the page) without needing to rebuild
anything between edits. The right column is a deterministic, read-only
render, not a second live editor, so it can never drift from the source.

**SSR** (real content, zero JS, not yet hydrated/interactive):

```sh
# from ono/, the workspace root
cargo run --bin ssr_server --features ssr --no-default-features
curl http://127.0.0.1:4177/
```
