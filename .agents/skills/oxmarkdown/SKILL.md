---
name: oxmarkdown
description: Vision, syntax, and design-language spec for OxMarkdown (OxRenderer + OxEditor), the planned successor to MdxEditor/MdxRenderer. Use when discussing or building the new nopal editor/renderer, its markdown conventions (generic directives, @ mentions, slash commands), or its visual design (dot grid, typography, mobile UX). Also consult the mdx-editor skill for what's carried over from the current system.
---

# OxMarkdown

**Status: actively being built, incrementally replacing MdxEditor.** This
skill is a living design doc — read AND update it as thinking evolves, same
as `mdx-editor`'s skill is kept current for the system it describes. Before
writing `OxEditor`/`OxRenderer` code, re-read both skills.

The umbrella name is **OxMarkdown**: **OxRenderer** is the fully static,
non-interactive renderer (replaces `MdxRenderer` for public/SSR pages).
**OxEditor** is the one interactive component, taking a `mode` prop
(`"interacting"` / `"editing"`) instead of MdxEditor's three separate
components — because Editing is a strict superset of Interacting, there's
no reason for them to be different components.

## Why replace MdxEditor

Not because it's broken — its core parser has real structural limits:

- `nopalEditorState.ts` splits documents into `\n\n`-delimited paragraphs,
  each rendered by an independent `<ReactMarkdown>` call. There's no single
  AST for the whole document, so a container block can't wrap multiple
  paragraphs with blank lines inside.
- Everything non-standard (`[[wiki-links]]`, `![[embeds]]`, CSV chips,
  directives) is bolted on via regex string-preprocessing, not real AST
  nodes.

OxMarkdown starts from a real block-level document model (mdast, via
`mdast-util-from-markdown`/micromark) so directives, mentions, and future
block kinds are first-class nodes, not regex placeholders.

## Modes: Interacting and Editing

Two modes, replacing MdxEditor's three-tier View/Workable/Editable split.
Editing is Interacting plus free-form typing:

- **Interacting** — select interactables and trigger their built-in
  actions (e.g. checking a checkbox rewrites `[ ]` → `[x]`), but no
  free-form typing/deleting of plain prose.
- **Editing** — everything Interacting allows, plus typing/deleting
  anywhere and inserting new interactables via slash commands.

"Workable" doesn't survive as its own mode — it was always Interacting
with one interactable kind (tasks) enabled. Generalized: **which
interactables are enabled is a per-interactable, permission-driven
decision, not a mode switch.** A logged-out viewer might get zero enabled
interactables; a collaborator might get checkboxes and mentions but not
directive popovers; the owner gets everything — same rendered document
throughout.

## Interactables

An **interactable** is any rendered unit that isn't plain flowing text —
a discrete, selectable element with its own behavior: `@`-mentions,
directives (`::name{...}`, `:::name{...}`, `:name{...}`), and task
checkboxes (`[ ]`/`[x]`). (A csv-key chip is a kind of text-directive, not
a separate category.)

**Selection model** — every interactable selects the same way:
arrow-key navigation onto it, or a first Backspace approaching it from the
right, always selects only — never acts and never places a bare caret
inside it. Clicking/tapping always selects, and for some kinds also fires
the default action in the same motion.

**Acting on a selected interactable** (depends on kind and mode):
- Task checkbox — click/tap selects AND toggles in one motion; once
  selected by any method, Space or Tab also toggles it.
- `@mention` — click/tap selects and shows a tooltip with the resolved
  path/target.
- Directive — click/tap selects and shows a tooltip or a popover for
  editing its attributes (e.g. a `::gallery{...}` popover for
  `folder`/`title`/`size` without hand-editing the directive text).
- **Backspace or Delete again, once selected** (Editing mode only) —
  fully removes the interactable. Both keys behave identically; recovery
  relies on ordinary undo. (An earlier design had Backspace *revert to raw
  text* instead of deleting; reversed — the export-escaping machinery it
  needed wasn't worth it when retyping via `/` is easy.)

**Range selection is different**: a Shift+arrow or click-drag selection
treats any interactable it contains as a single atomic "character."
Deleting a range deletes everything inside outright — no tooltip, no
popover, no revert step. The select-then-act model only applies when an
interactable is the exact, sole selection target.

## What carries over from MdxEditor unchanged

- **Markdown is the only saved format.** Everything rich is an
  interpretation of markdown at render time, never a divergent internal
  format. Anything OxMarkdown adds must degrade to plain, readable
  markdown elsewhere (Obsidian, GitHub, a bare text editor).
- **Dynamic content references** — linking to typed content (a CSV
  key/value pair, a vault file, a folder of images) and rendering it
  richly inline. Directives are the general mechanism for this; csv-key
  chips are the first concrete case.

## Generic directives (shipped on both MdxRenderer and OxRenderer)

Inspired by `remark-directive`/the CommonMark directives proposal:

```
:name{attrs}        text directive       — inline,  e.g. :csv-key{key="location"}
::name{attrs}       leaf directive       — block, own line, no children
:::name{attrs}      container directive — wraps nested markdown
content
:::
```

- On the legacy path (`webapp/app/util/nopalDirectives.ts`), this is a
  hand-rolled regex preprocessor, wired into `MdxRenderer.tsx` and
  `project.server.ts` (server-side `file=`/`folder=` resolution for
  Vault's project rollup views — see the `vault` skill's "Projects"
  section). It doesn't support container directives spanning blank lines.
- On OxRenderer/OxEditor, directives are real mdast nodes via
  `mdast-util-directive`/`micromark-extension-directive`, so container
  directives work with arbitrary nested content.
- `csv-key` (the old `[key]` bracket syntax) is fully retired in favor of
  `:csv-key{key="..."}` — the template for how new conventions replace old
  ones: build the primitive, prove it in one real feature, then delete the
  old path.

## `@` mentions (replaces `[[wiki-links]]`) — shipped

`@` replaces `[[double-bracket]]` wiki-links: one tap vs. two on mobile,
reads naturally as "at," and is muscle memory from Zed/Slack/Notion/GitHub.

- **Saved as an ordinary markdown link**, not a directive: selecting a
  result inserts `[@Name](path)` — real `[text](url)` CommonMark. No new
  parsing/rendering needed; `link` mdast nodes already round-trip through
  `editingTransforms.ts` and render via `OxRenderer`'s existing
  `case "link"`. A mention is just a link — a caret inside it is ordinary.
- **Path is human-readable, not an opaque ID**, scoped to a human's vault
  tree: `/humanId:root/.../Name` (e.g. `/abc123:projects/Casa Verde
  Remodel`) — the colon separates human id from folder path, needed
  because folders/files can be shared between humans.
- **`@` never appears bare in saved markdown** — it's purely the trigger
  character; the resulting `[...]` brackets are what make the label
  unambiguous.
- **Search is a plain function `OxEditor` is handed**: `mentionSearch`,
  `(query: string) => MentionItem[] | Promise<MentionItem[]>`
  (`oxmarkdown/mention.ts`). The editor has no concept of "vault" or
  "human" — it just calls this and shows what comes back. "Create a page
  when nothing matches" isn't a mention-plugin feature either: an
  implementation is free to include a synthetic "create" result and act on
  it only once selected. See the `fruits/styles/oxmarkdown` demo
  (`#mentions`) for a working mock of this pattern.
- Built on `@lexical/react`'s `LexicalTypeaheadMenuPlugin` +
  `useBasicTypeaheadTriggerMatch("@", { minLength: 0 })`, which already
  implements "`@` at the start of a word" (so `user@example.com` doesn't
  trigger it) and positions safely against scroll-clipping without needing
  `.ox-popover`.
- **Deliberately deferred**: the real Vault-backed `mentionSearch`
  (currently only an in-memory mock) and "embed" (`![[...]]`'s old job —
  see the directive-based plan below).

## `/` slash commands

Typing `/` opens a menu (headings, list types, directive blocks, etc.) for
*inserting* things. **`/` never appears in saved markdown** — it's purely
UI sugar over the real syntax (directives, mentions), most valuable on
mobile where remembering `::name{attrs}` by hand isn't reasonable.

## Design principle

Ease of typing/input is a first-class constraint, on par with correctness
— Obsidian and Zed are the reference points (fast fuzzy-find,
low-punctuation syntax, keyboard-first but not keyboard-only). Weigh every
syntax decision against "how does this feel to type on a phone,
one-handed, in a hurry," not just "is this a clean file format." Lean on
established conventions (front matter, directives, `@`-mentions) over new
punctuation unless ease-of-input clearly demands otherwise.

## Design language

The dot-grid visual identity (`webapp/app/styles/oxmarkdown.css`,
`.ox-content`) — confirmed working in light and dark mode (see
`dark-mode-review` skill to re-verify after changes):

- **41×41px dot grid background** behind all content:
  `background-image: radial-gradient(var(--moon) 1px, transparent 0);
  background-size: 41px 41px;` — dark mode swaps the dot to
  `var(--dark-midground)`.
- **Vertical rhythm locked to the grid.** Every block element's
  `line-height` is exactly `41px` (one cell). Headings add whole-cell
  top margins: `h1`/`h2` → `82px` (2 cells), `h3` → `41px` (1 cell).
- **Gutter markers** — `#`/`##`/`###`/`>` render as absolutely positioned,
  low-opacity monospace pseudo-elements to the left of headings/
  blockquotes (`left: -38px`), echoing the raw markdown next to its
  rendered form. `.ox-content`'s `padding` reserves a full `--ox-grid`
  (41px) on BOTH the left AND right (not left-only, as it once was) —
  the right side exists so a `::file{...}` directive's remove button can
  stick out past the row's own right edge the same way markers stick out
  past the left, without `overflow-x: hidden` clipping it. A caller with
  no need for either reserved band (a `::file{...}` caption) opts out of
  both via `.ox-no-gutter`.
- **Color tokens** (`webapp/app/styles/root.css`): `--purple` (primary
  text), `--purple-light` (accents/headings), `--moon` (light-mode dot
  color), `--text-subtle`; full dark-mode counterparts via
  `prefers-color-scheme`, no in-app toggle.
- **Editing mode specifically must act like a code editor**: one line in
  the markdown = one row in the editor, every row the same height off the
  41px grid — no margins standing in for blank lines that should just be
  real rows. (The static `OxRenderer` keeps ordinary margin-based prose
  rhythm; this principle is specific to the live-editable surface.)
- **TODO — typewriter font.** Explore a monospace body font for precise
  gutter/column alignment. Needs a real visual pass before committing.

## Key resolved decisions

A few designs that were tried, found lacking, and revised — recorded so
they aren't re-litigated from scratch:

- **Foundation for Editing mode: trimmed Lexical, not a custom
  `<textarea>`.** A `<textarea>` can only ever show its own literal text —
  no real checkbox glyphs, directive pills, or dot grid rendered inline —
  so rich rendering would need a pixel-synced overlay layer, which is more
  risk than contentEditable, not less. A trimmed `@lexical/react` config
  (plain-text + history + node-selection, no rich-text/list/link/
  CodeMirror/Sandpack/Radix/table plugins) measured ~48 KB gzip for the
  engine itself — a small fraction of the old `MdxEditorEditable` chunk's
  287 KB gzip, which was almost entirely CodeMirror/Sandpack/Radix/table
  weight nopal doesn't visually use, not Lexical's own cost.
- **Backspace and Delete are symmetric — both fully remove a selected
  interactable.** An earlier design had Backspace revert to raw,
  re-editable source text instead; reversed because the revert path needed
  real, ongoing machinery (escaping a reverted directive's raw text on
  export so it isn't mistaken for a live directive again) for a marginal
  benefit over just retyping via `/`.
- **No hand-splitting the document by `\n\n`.** Parse once into a real
  mdast tree (`mdast-util-from-markdown` + micromark) and use that as the
  document model, so blocks nest structurally instead of being
  reconstructed from independently-parsed chunks. `mdast-util-directive`,
  `micromark-extension-directive`, `mdast-util-frontmatter`, and
  `micromark-extension-frontmatter` are already transitive dependencies
  (via `@mdxeditor/editor`) — adopting them directly costs nothing new.
- **Embedding gets no new punctuation.** Fold it into the directive
  mechanism (e.g. `::embed{ref="Some Page"}`) reached through an
  `@mention`'s popover ("Embed" action), with a symmetric "Convert to
  link" action on the embed directive's popover. General pattern: when two
  forms are just different presentations of the same reference, make
  converting between them an interaction, not a second syntax.
- **Nested interactables inside a container directive are individually
  navigable by default** (the natural behavior once the document model is
  a real mdast tree) — treating a directive as fully atomic is a per-kind
  exception to add only if a real use case needs it.
- **No roaming caret in Interacting mode.** Keyboard focus moves between
  enabled interactables via Tab/Shift+Tab, matching ordinary web
  accessibility expectations.
- **Detecting "caret hit a boundary, nowhere left to move" is done from
  the document TREE, not by observing native ArrowDown/Up outcome.**
  Cross-editor arrow navigation (`CrossEditorArrowPlugin.tsx`) needs to
  know when a caret is at the true start/end of an editor's document. The
  first approach tried let the browser handle the key normally and
  checked a frame later whether the caret had moved ("unchanged" =
  boundary) — confirmed BROKEN by direct testing: a native ArrowDown from
  the end of a paragraph into a following list (or between list items)
  can simply fail to move the caret at all, indistinguishable from a real
  boundary if you're only watching browser outcome. The robust version
  instead checks the selection against `$getRoot().getFirstDescendant()`/
  `getLastDescendant()` directly, before any key is dispatched — since
  every OxEditor document flows top-to-bottom in a single column, "last
  leaf in tree order" and "last visual line" are always the same
  position, so this is both correct and fully immune to native-navigation
  quirks.
- **Undo/redo coalescing**: `@lexical/history`'s default grouping is
  time/pause-based, not word/punctuation-boundary-based — a continuous
  typing burst is one undo step regardless of word boundaries; a real
  pause or a non-typing action (e.g. an arrow key) starts a new group.
  Matches expected editor behavior (Zed, VS Code); no custom work needed.
- **Blank lines between blocks are real rows, not CSS margin, in Editing
  mode.** They're ordinary empty `ParagraphNode`s (`convertBlockList` in
  `editingTransforms.ts`), giving them full native text-editing behavior
  for free. Export uses a stateless `blankLineJoin` function passed to
  `mdast-util-to-markdown`'s `join` option, inspecting each adjacent pair
  of real mdast nodes directly (`type === "paragraph" && children.length
  === 0`) rather than tracking a separate gap map. The static `OxRenderer`
  keeps CSS margin-based rhythm instead (`.ox-content > *:not(:first-child)`),
  since that's the normal, correct approach for read-only prose.
- **Checklists never use `@lexical/list`'s native `"check"` list type.**
  Every list is plain `"bullet"`; whether an item has a checkbox is a
  field on a custom `OxListItemNode extends ListItemNode`
  (`oxmarkdown/OxListItemNode.ts`), registered via Lexical's
  `{replace, with, withKlass}` node-override config. This lets one `<ul>`
  freely mix checkbox and plain-bullet items (needed so Enter's outdent
  behavior can downgrade a checkbox item to a plain bullet in place,
  without the two-adjacent-lists markdown/render mismatch that a "split
  into a separate list" approach produced). `isRealCheckbox()`
  (`checked !== undefined`) is the one predicate both rendering and export
  use. An empty checkbox item's checkbox state is preserved on export via
  a zero-width-space placeholder paragraph
  (`CHECKBOX_PLACEHOLDER`/`\u200b`) so the exported markdown always
  actually contains the `[ ]`/`[x]` the render shows — GFM's own
  checkbox-injection regex can't otherwise represent an empty item's
  checkbox at all.
- **Paste is always "paste without formatting."** `MarkdownPastePlugin.tsx`
  prefers `text/plain`; when only `text/html` is available, it strips tags
  to text (converting block boundaries to newlines first) rather than
  letting any external rich formatting into the document. The only saved
  format is markdown, so paste should never let external styling leak in.
- **Popover positioning is one shared component**, `oxmarkdown/OxPopover.tsx`,
  built on `@floating-ui/react` (already a transitive dependency via
  `@lexical/react`) rather than hand-rolled per-popover scroll/resize
  listeners. Handles `flip`/`shift`/`size`/`offset`/`autoUpdate`, and below
  a `640px` viewport renders as a full-width, bottom-anchored sheet with a
  backdrop instead of a floating dropdown. Both the slash-command menu and
  the directive-attribute popover use it. The `@`-mention menu doesn't (it
  has its own already-safe `LexicalTypeaheadMenuPlugin` anchor, given the
  same mobile treatment via a plain CSS media query instead).

## Mobile UX — needs a dedicated hands-on pass

Some decisions are made, but this area needs real-device iteration before
being considered settled:

- **Popovers/menus: full-width, bottom-anchored sheet** (see `OxPopover`
  above) rather than a floating dropdown — one predictable location beats
  a contextually-positioned one that risks fighting the on-screen keyboard.
- **Tap targets sized to the grid**: an interactable's tappable area
  should round out to a full 41px grid cell even when the visible glyph is
  smaller.
- **Discoverability via a persistent quick-actions bar** (not yet built):
  `@`, `[ ]`, `/`, `#` as always-visible buttons (e.g. an accessory bar
  above the keyboard), so users don't have to remember trigger characters.
  Typing the real characters should still work.

## Build status

Sequenced by risk/dependency: the Lexical-vs-custom decision only ever
blocked *Editing* mode, so the document model, directives, mentions,
checkboxes, and the interactables model were built and shipped for
Interacting mode first, without needing that decision resolved.

1. **Done — real document model + `OxRenderer`.** `oxmarkdown/document.ts`
   (parse/serialize, no React import), `OxRenderer`/`OxTreeRenderer`
   (`components/OxRenderer.tsx`), themed via `styles/oxmarkdown.css` +
   `oxmarkdown/theme.ts`. Demo/decision log:
   `routes/fruits_.styles_.oxmarkdown.tsx`.
2. **Done — interactables + Interacting-mode `OxEditor`**, no Lexical
   needed. `oxmarkdown/interactive.ts` (the `OxInteractive` contract),
   `OxTreeRenderer` (so `OxEditor` mutates the exact tree it renders,
   not a fresh re-parse), `components/OxEditor.tsx`. Shipped: task
   checkboxes and a generic directive-attribute popover. Deferred:
   `@`-mention tooltips (mentions weren't parsed yet), arrow-key entry
   (needs Editing mode's roaming caret).
3. **Done — foundation spike, resolved: trimmed Lexical.** See "Key
   resolved decisions" above. Spike code deleted per the temp-code
   convention; findings preserved here.
4. **Done — full Editing mode**, on trimmed Lexical
   (`@lexical/rich-text` + `list` + `link` + `code` + custom nodes).
   - `oxmarkdown/editingTransforms.ts` converts real mdast ↔ Lexical
     nodes (not `@lexical/markdown`'s own parser — that stays reserved for
     live-typing shortcuts like `**x**`/`# `/`> ` auto-formatting).
   - `oxmarkdown/editingNodes.tsx`: `OxDirectiveNode` (reuses
     `InteractiveDirective` from `OxRenderer.tsx` directly — Interacting
     and Editing render directives through the same component) and
     `OxOpaqueNode`, a lossless read-only passthrough for anything not yet
     mapped (tables, raw HTML), still select-then-remove like a directive.
   - `oxmarkdown/InteractablesPlugin.tsx` implements select-as-unit and
     select-then-remove once, generically, against Lexical's own
     `$isDecoratorNode` — a future `@mention` node needs zero extra code
     for this.
   - `oxmarkdown/SlashCommandPlugin.tsx` — `/` menu (headings, list types,
     divider, one example directive).
   - Live-typing/paste conversion: `checklistTransformer.ts` (`[ ] `/`[x] `
     → checkbox), `ChecklistUpgradePlugin.tsx` (closes the `- [ ] `
     with-dash gap the transformer alone can't reach, since by the time
     `[ ] ` is typed the text is already inside a list item),
     `DirectiveShortcutPlugin.tsx` (Enter after a leaf directive on its
     own line converts it), `MarkdownPastePlugin.tsx` (routes plain-text
     paste through the real `parseOxDocument`/`importOxDocument`
     pipeline for full fidelity, e.g. container directives/tables that
     live-typing shortcuts can't reach).
   - Known, deliberate limitations: a container directive's nested content
     isn't independently editable yet (renders read-only via the static
     renderer); checklist visuals are matched, not pixel-identical, to
     Interacting mode's static rendering (different underlying DOM shape).
   - Bundle cost: `OxEditor`'s own code is ~23 KB gzip; the shared Lexical
     rich-text/list/link/code vendor chunk is ~108 KB gzip (shared with
     the old `MdxEditorEditable` while both coexist) — well under half the
     old fat chunk's 287 KB gzip once MdxEditor is fully retired.
5. **Not started — dedicated mobile UX pass.** Quick-actions bar and
   grid-sized tap targets (see "Mobile UX" above). Deliberately last —
   needs real-device iteration, not a spec implemented blind.
6. **In progress — incremental migration**, route by route, not a
   big-bang cutover. `MdxEditorClient`/`MdxEditorEditable` stay in place
   for real typing until every route needing it is migrated.
   - **Done**: Daily Log (`routes/fruits_.daily-log.tsx`) — rebuilt fresh
     on `OxEditor` rather than preserving exact old behavior (explicit
     product call; negligible real content was at risk). Today's entry
     uses `mode="editing"`, past entries use `mode="interacting"`. `@`
     mentions are wired to a REAL, vault-backed search now (see step 7) —
     the one real feature drop from the old `[[wiki-link]]` flow that's
     since been properly replaced, not just left dropped. File/image
     upload is ALSO now real (see step 10) — `TodayLogEntry` passes
     `allowFileAttachments` + an `onUploadFile` that posts to a new
     `POST /api/daily-log/upload` endpoint, which resolves that day's own
     vault folder (the exact same `daily-logs/YYYY-MM-DD/` tree
     `readme.md` itself lives in) and marks the resulting `file_ref`
     `source: "daily_log"`/`date` — the same convention `isFileRefLocked`
     already uses, so an attachment added today automatically becomes
     read-only once the day is over. Not yet ported: Cards/`::card{...}`
     itself (still mockup-only — see step 10's own note and the `vault`
     skill's Daily Log section).
   - **Not started**: `ProjectView.tsx` and the Vault file-view page
     (`routes/fruits_.vault.tsx`) — still on `MdxEditorView`. These have a
     real, non-trivial directive registry (`csv-table`/`gallery`/`svg`/
     `note`) worth a careful compatibility pass rather than a rebuild.
7. **Done — `@` mentions** (`oxmarkdown/mention.ts`, `MentionPlugin.tsx`).
   See "`@` mentions" above. Shipped first as a mock on the Design System
   page, then moved to `fruits/styles/oxmarkdown` (`#mentions`). Next:
   a real Vault-backed `mentionSearch` (including real "create a page on
   the fly" behavior) and resolving a mention's `/humanId:path` href into
   real in-app navigation instead of a literal browser-followed `<a href>`.
8. **Done — cross-editor arrow navigation**, for when several independent
   `OxEditor`s are stacked and should still feel like one continuous
   document (the Daily Log "Cards" design: each Card is its own file with
   its own `OxEditor` instance, not nested markdown inside the day's
   `readme.md` — see the `vault` skill's Daily Log section). Wrap the
   stack in `oxmarkdown/OxEditorGroup.tsx`'s `<OxEditorGroup order={[...]}>`
   and pass each `OxEditor` a matching `groupId`; ArrowDown at the bottom
   of one jumps into the top of the next, ArrowUp at the top jumps into
   the end of the previous — `oxmarkdown/CrossEditorArrowPlugin.tsx`.
   Editing mode only (Interacting mode has no roaming caret to move — see
   "No roaming caret in Interacting mode" below); entirely opt-in, so an
   `OxEditor` without a `groupId` is unaffected. Each editor's
   document/undo history stays fully separate — this only ever moves
   keyboard focus, never merges content. First wired up on the
   `daily-log-v2` visual mockup (`routes/fruits_.daily-log-v2.tsx`); not
   yet ported to the real Daily Log route.
9. **Done — minimum-rows padding**, so an Editing-mode document is always
   clickable anywhere within a minimum box, not just wherever real
   content happens to reach. `oxmarkdown/MinRowsPlugin.tsx` registers a
   `RootNode` transform that tops the document's children up to a
   `minRows` prop (default `DEFAULT_MIN_EDITOR_ROWS = 4`; any value below
   `0` is treated as `1` via `normalizeMinRows`) with plain empty
   `ParagraphNode`s whenever it falls short (short initial content, or
   Backspace merging away a row) — it only ever ADDS to reach the floor,
   never removes. `.ox-editing-surface`'s `min-height` reads the SAME
   clamped value via an inline `--ox-min-rows` custom property
   (`components/OxEditor.tsx` sets it; `oxmarkdown.css` consumes it) —
   CSS can't reference a JS prop directly, so this is how the two stay in
   sync instead of drifting apart the way two independently-hand-kept
   constants eventually would. The padding is real, clickable rows, not
   just empty CSS space — clicking the Nth row lands the caret exactly
   there, which a min-height alone (with no backing content) can't
   guarantee. Never leaks into saved markdown: `exportOxDocument` always
   trims wholly-blank trailing paragraphs before serializing
   (`editingTransforms.ts`), regardless of whether they're this padding
   or a user's own trailing Enter presses. A `::file{...}` directive's
   caption editor (step 10) uses `minRows={1}` — it starts small and
   just grows, unlike a full card/prose editor's 4-row canvas.
10. **Done — the `::file{...}` interactable**, a built-in leaf directive
    (own row, no children — same "mount point, not nested markdown" shape
    already planned for `::card{file=...}`) representing an attached
    file: a fixed 74×74px thumbnail offset left by one grid cell via
    `margin-left: calc(-1 * var(--ox-grid))` so it sits IN the gutter (the
    same column heading/list markers use) instead of the normal
    text-indent position, plus a caption alongside it.
    `oxmarkdown/fileDirective.ts` holds the shared insertion logic (pure
    Lexical-tree code, no React) and the native-file-picker wrapper;
    reachable two ways, both landing on the same code:
    - **A block-level decorator (this directive; any future one) can
      never be the FIRST row of the document** — enforced generically,
      not just on insert, by `oxmarkdown/LeadingBlockGuardPlugin.tsx`: a
      `RootNode` transform (same pattern as `MinRowsPlugin`) that splices
      a plain paragraph in ahead of the first child whenever it's a
      block decorator (`$isDecoratorNode(first) && !first.isInline()`).
      Reruns on every root mutation (including initial load, since
      `registerNodeTransform` marks existing nodes dirty the moment it's
      registered), so this holds even for a document that already
      starts with one when loaded/pasted/undone into that state, not
      just newly-typed ones. Why: there's nothing above a leading block
      decorator to ArrowUp FROM, so this guarantees a real, clickable
      row always precedes it — which is also what lets
      `fileCaptionFlow.ts`'s cross-editor ArrowUp treat "there's a
      landing spot one level up" as the common case rather than needing
      its own fabricate-one-on-the-fly fallback for this specific
      direction (it still has one anyway, defensively — see below).
    - **Upload is real** — `OxEditor`'s `onUploadFile` prop (a
      `(file: File) => Promise<{fileId, contentType}>`, `UploadFileFn` in
      `fileDirective.ts`) is threaded through both trigger paths below.
      `OxEditor` itself stays ignorant of vault/folder specifics — it only
      knows how to call this and write the result back onto the SAME
      node (found again by KEY, since real async time passes between
      insertion and the upload resolving). The Daily Log route
      (`routes/fruits_.daily-log.tsx`) supplies one that posts to
      `POST /api/daily-log/upload`, which resolves that day's own vault
      folder and marks the file `source: "daily_log"`/`date` — the same
      convention `isFileRefLocked` already uses. A caller that omits
      `onUploadFile` entirely (e.g. the `daily-log-v2` visual mockup)
      gets the old browser-only behavior — just a filename, no bytes
      ever leave the browser, no error. On a real upload failure, the
      node is marked `uploadError="1"` (shown as a plain placeholder with
      an explanatory `title`) rather than looking like it's stuck
      uploading forever.
    - Once `fileId`/`contentType` land on the directive, the thumbnail
      renders as a real `<img src="/api/vault/view/:fileId">`
      (`FileDirectiveLayout` in `components/OxRenderer.tsx`) for image
      content types; anything else (non-image, or still mid-upload)
      keeps the plain placeholder box. This is the ONE part of the file
      pipeline that reaches real vault storage today — the caption text
      itself still lives only in the directive's own `caption` attribute
      (see below), and OCR/transcript extraction from the uploaded bytes
      is still parked behind the separate media-processing spike (see
      the project handoff notes) — this only covers upload + display.
    - The `/files` slash command (also matches `/file`) — gated by
      `OxEditor`'s `allowFileAttachments` prop, on for both plain prose
      and cards. Inserts at the current cursor's block.
    - The persistent "add file" link below the editor
      (`oxmarkdown/AddFileLinkPlugin.tsx`, gated by a SEPARATE
      `showAddFileLink` prop — on for cards only, off for plain prose,
      which still gets `/files` without the link) — always appends at
      the document's END regardless of cursor position.
    - Both call `pickFilesAndInsertAtBlock`/`pickFilesAndAppend`
      respectively; found and fixed a real bug building this: a nested
      `editor.update()` call (one made while `editor._updating` is
      already true, e.g. from INSIDE `SlashCommandPlugin`'s own
      `runCommand` wrapper) doesn't run its function immediately — it
      QUEUES it for after the current update finishes (confirmed directly
      in Lexical's own source) — which silently broke opening the file
      dialog synchronously within the original trusted click. Fixed by
      calling the needed `$`-prefixed functions directly, relying on
      already being inside the caller's active update, instead of
      wrapping them in a second one.
    - The `/files` slash command (also matches `/file`) — gated by
      `OxEditor`'s `allowFileAttachments` prop, on for both plain prose
      and cards. Inserts at the current cursor's block.
    - The persistent "add file" link below the editor
      (`oxmarkdown/AddFileLinkPlugin.tsx`, gated by a SEPARATE
      `showAddFileLink` prop — on for cards only, off for plain prose,
      which still gets `/files` without the link) — always appends at
      the document's END regardless of cursor position.
    - Both call `pickFilesAndInsertAtBlock`/`pickFilesAndAppend`
      respectively; found and fixed a real bug building this: a nested
      `editor.update()` call (one made while `editor._updating` is
      already true, e.g. from INSIDE `SlashCommandPlugin`'s own
      `runCommand` wrapper) doesn't run its function immediately — it
      QUEUES it for after the current update finishes (confirmed directly
      in Lexical's own source) — which silently broke opening the file
      dialog synchronously within the original trusted click. Fixed by
      calling the needed `$`-prefixed functions directly, relying on
      already being inside the caller's active update, instead of
      wrapping them in a second one.
    - The caption is a REAL, live nested `<OxEditor>` in Editing mode
      (the first real use of the "leaf directive mounts a nested
      independent OxEditor" pattern already planned for `::card`) —
      made possible by `oxmarkdown/OxEditorContext.tsx`, a neutral file
      breaking what would otherwise be a circular import
      (`editingNodes.tsx` needs `OxEditor`, but `OxEditor.tsx` already
      imports `OxDirectiveNode` FROM `editingNodes.tsx`): `OxEditor.tsx`
      provides itself as a context value; `editingNodes.tsx` only ever
      imports the neutral context file, never `OxEditor.tsx` directly.
      Confirmed safe to nest one live Lexical editor inside another's
      decorator this way — Lexical's own event system explicitly guards
      against exactly this (`stopLexicalPropagation`/
      `hasStoppedLexicalPropagation`, tagging a DOM event once an inner
      editor's listener has handled it so an outer editor's listener on
      the same bubbled event is a deliberate no-op).
    - The caption's nested editor also gets its own dot-grid-free look
      (`className="ox-file-caption-editor"`, overriding `.ox-content`'s
      background-image — it reads as a small annotation field, not its
      own document) and flows ArrowUp/ArrowDown into a SIBLING file
      directive's caption within the same outer document
      (`oxmarkdown/fileCaptionFlow.ts` + `FileCaptionArrowPlugin.tsx`) —
      deliberately NOT built on `OxEditorGroup` (that mechanism wants an
      externally-supplied flat `order`; here the members are decorator
      nodes already ordered by the outer tree itself, so this walks that
      tree directly instead, skipping blank-line paragraphs but stopping
      at any other real content).
    - **The caption feels like a fully integrated part of the outer
      document, not a separate little box** — three more pieces:
      - ArrowUp/ArrowDown at a caption's own true start/end, once a
        sibling caption search comes up empty, falls through to
        `focusOuterEditorAcrossBoundary` instead of stopping there: it
        lands the caret in the nearest real OUTER content immediately
        before/after the file directive (a paragraph, heading, list,
        ...), or fabricates a fresh blank paragraph to land in if
        there's truly nothing there. The one case left deliberately
        unhandled: the adjacent outer sibling is some OTHER kind of block
        decorator (not a file — that's already caught by the sibling-
        caption search) — e.g. a table; Lexical's default jump-past-the-
        decorator behavior still applies there.
      - **Enter on an already-empty caption line "escapes"** to the outer
        editor instead of padding the caption with yet another blank
        row — hitting Enter twice (once to end the line you were on, once
        more on the now-empty line) reads as "I'm done with this
        caption," landing the caret right after the image in the OUTER
        document (reusing an existing following paragraph if there is
        one, same as the ArrowDown fallback above) and removing the now-
        redundant blank line from the caption. Deliberately keyed off
        "the current line is already empty," not document-boundary —
        simpler, and matches what "hit Enter twice" actually means
        char-by-char. Left alone (falls through to ordinary Enter) when
        the empty line has no siblings at all yet — that's just the
        caption's normal untouched starting state, not an escape signal.
      - **The OTHER direction — outer editor into a caption — is a
        separate plugin, `oxmarkdown/FileDirectiveArrowPlugin.tsx`**,
        mounted unconditionally on every Editing-mode `OxEditor` (like
        `InteractablesPlugin`). ArrowDown approaching a `::file{...}`
        row from above, or ArrowUp approaching one from below, lands the
        caret directly in that file's caption (start/end respectively)
        instead of the browser's default "jump straight past the whole
        non-editable decorator" behavior, which otherwise made a file
        directive's caption unreachable by vertical arrow keys alone.
        Reuses `InteractablesPlugin.tsx`'s own
        `siblingBeforeCollapsedCaret`/`siblingAfterCollapsedCaret`
        (exported for this) — the same ancestor-climbing "what's
        immediately adjacent to a collapsed caret" check that plugin
        already uses for Left/Right, so the two agree on what "adjacent"
        means. Looks up the caption via `getFileCaptionMember(editor,
        nodeKey)` — `editor` here already IS the outer editor the
        caption registered itself against, so no extra wiring is needed
        beyond mounting the plugin. The SAME plugin also handles
        Backspace approaching a file directive from below (the row right
        after it): lands the caret at the caption's END, matching how
        backspacing at the start of an ordinary line merges into the end
        of the PREVIOUS line, rather than `InteractablesPlugin`'s usual
        select-then-delete treatment for decorators —
        `InteractablesPlugin.tsx`'s own `isFileDirective` check steps its
        higher-priority (`COMMAND_PRIORITY_CRITICAL`) Backspace handler
        aside specifically for file directives so this one gets a
        chance to run at all. A file directive can still be removed via
        its own remove button, or Delete approaching it from the other
        side (deliberately left unchanged — only this one Backspace case
        moved).
      - **Real pitfall, confirmed by direct testing, not just
        theorized**: whichever editor is handing focus OFF to the other
        one (either direction) MUST clear its OWN recorded selection
        first, via `$setSelection(null)`, or the very NEXT keystroke
        typed in the editor that just gained focus bounces straight back
        to whichever editor still has a stale selection. Root cause: a
        caption's `onChange` round-trips into `editingNodes.tsx`'s
        `editDirectiveAttr`, which mutates the OUTER editor's own
        `OxDirectiveNode` and commits an ordinary update THERE — and if
        the outer editor still has an old `RangeSelection` recorded from
        before focus moved away (nothing had ever changed it), Lexical's
        reconciliation for that unrelated commit re-asserts it into the
        native DOM, which visibly steals focus back since the caption's
        contenteditable is a DOM DESCENDANT of the outer editor's own
        root, not a sibling. A plain deferred focus-shift (a microtask,
        or `fileDirective.ts`'s own rAF-polling pattern) does NOT fix
        this — tested directly, confirmed still broken — so this isn't a
        timing/ordering issue; the stale selection has to be explicitly
        cleared. Both directions need this fix independently: outer ->
        caption in `FileDirectiveArrowPlugin.tsx`, caption -> outer in
        `FileCaptionArrowPlugin.tsx`. Relevant to any FUTURE nested-editor
        flow too (e.g. `::card`'s own planned nested `OxEditor`) —
        clearing the handoff side's selection isn't specific to files.
    - The static/Interacting-mode path (`components/OxRenderer.tsx`'s
      `FileDirectiveLayout`/`FileDirectiveStatic`) renders the same
      caption as plain read-only markdown instead — Interacting mode
      never allows free-form typing, so a live editor there would be
      inconsistent with how locked/read-only content behaves everywhere
      else.
    - Bypasses the generic `DirectiveRegistry`/`InteractiveDirective`
      attrs-popover entirely (checked in `renderDirective` and
      `OxDirectiveDecorator` before the registry lookup) — same category
      as task checkboxes: a built-in interactable, not a caller-registered
      directive. A raw-text-field popover for `caption` would be
      redundant with the real rendering right there, and `name` (the
      file's own original filename) isn't meant to be hand-edited at all.
    - The caption editor also disables the LEFT GUTTER, via a new
      general-purpose modifier, `.ox-no-gutter` (`oxmarkdown.css`) —
      applied through the ordinary `className` prop
      (`"ox-file-caption-editor ox-no-gutter"`), not a new boolean prop.
      Reduces `.ox-content`'s `padding-left` to match its other three
      sides and suppresses every marker glyph that hangs in that band
      (`#`/`##`/`###`/`>`, bullet/ordered-list markers, the checklist
      dash — `content: none`, not `display: none`, so no box is
      generated at all) — without it, the caption's text sat a further
      grid cell right of where it should align next to the thumbnail.
      Any other OxEditor/OxRenderer instance can reuse this the same way.
    - `placeholder` is now a real `OxEditorProps` prop (default: the
      usual "Start typing…" hint) — the caption editor passes
      `"add words"` instead.
    - After inserting, the FIRST newly-added file's caption gets focus
      automatically, so typing a caption needs no extra click
      (`focusFileCaptionOnceMounted` in `fileDirective.ts`). Needs to
      POLL across a few animation frames rather than focus once, right
      after `editor.update()` returns: the new decorator's own nested
      `<OxEditor>` (and its `FileCaptionArrowPlugin` registration) hasn't
      necessarily mounted yet at that exact instant — Lexical's DOM
      reconciliation and React's rendering of that decorator's content
      are two separate, only loosely-synchronized steps. Wins out over
      the outer editor's own trailing-paragraph selection naturally,
      just by running later.
    - The thumbnail sets `contentEditable={false}` on the directive's
      own root (`FileDirectiveLayout`) — without it, clicking the
      thumbnail (a plain presentational `<div>`, no real text/Lexical
      node behind it) could still place a native caret there;
      `OxDirectiveNode`'s own wrapper element doesn't set this itself
      (unlike `OxOpaqueNode`, which does), so this directive's own
      rendered content has to. The caption's nested `<OxEditor>` is
      unaffected — a nested `contenteditable="true"` region works
      normally inside a `contenteditable="false"` ancestor.
    - A `.circle-btn-red` `CircleButton` (root.css; transparent at rest,
      `--red-light` background + `--red` border on hover — both
      already-shipped nopal tokens, no new colors), at its normal default
      36px size, removes the whole directive on click. Rendered by
      `FileDirectiveLayout` only when an `onRemove` callback is supplied
      (Editing mode only — `editingNodes.tsx` wires it to `node.remove()`;
      the static/Interacting-mode path passes nothing, so no button
      renders there). Lives OUTSIDE the row's own flex layout entirely
      - `.ox-file-remove-slot` is `position: absolute` against
      `.ox-file-directive` (`position: relative`), not a flex child, so
      it sticks out `--ox-grid` (41px) past the row's own right edge
      exactly the way the thumbnail sticks out past the left edge,
      rather than taking up space the caption would otherwise get.
      Vertically centered via `top: 50%` + `transform: translateY(-50%)`
      (the normal way to center an absolutely-positioned element without
      knowing its own height). Still exactly one grid cell wide so the
      36px button inside it sits centered within a real grid-cell-sized
      column - CircleButton sets its own width/height via an inline
      style (from its `size` prop), which no CSS class can ever
      override, so sizing/centering has to live on this wrapper
      regardless of flow.
      - This ONLY works because `.ox-content`'s `padding-right` is now
        `--ox-grid` too (see "Gutter markers" above) - it started as
        just 8px, and the remove button poking 41px past the row's edge
        got silently clipped by `.ox-content`'s own `overflow-x: hidden`
        until the right padding was widened to match the left. Confirmed
        directly by measuring the clipped button's actual bounding box
        against `.ox-content`'s, not assumed.
    - The persistent "add file" link (`AddFileLinkPlugin.tsx`) is a
      direct child of `.ox-content` in Editing mode (every OTHER plugin
      there renders `null`), which meant `.ox-content`'s own
      `*:not(:first-child) { margin-top: var(--ox-grid) }` rule (meant
      for spacing between STATIC content blocks) was silently
      overriding the link's own, smaller `margin-top` — same
      specificity tier, later in cascade order. Fixed by excluding it
      explicitly (`:not(.ox-add-file-link)`) rather than reordering
      rules, so the exclusion stays obvious at the selector itself.

## Testing convention — verify three things together, never one alone

The core principle: **the editor should almost always represent the
markdown it will produce.** Little should be held as UI-only state that
renders differently from what's exported — an action (click, popover
field, toggle) should write straight to the markdown-backed model, not
layer display-only state on top that could drift from it.

Every check verifies all three legs together, in this order:

1. **Input markdown** — the exact source being loaded/edited.
2. **Rendered editor** — what it actually looks like/produces as DOM.
3. **Output markdown** — what re-serializing the live document produces.

Checking only 1-vs-2 or only 2-vs-3 is exactly the gap that let a real bug
(checklist checkbox rendering disagreeing with what the exported markdown
could actually contain) ship twice before being caught by hand-testing —
a decorator/glyph can render something plausible that export can't
reproduce, or vice versa, and nothing catches it unless both are checked
side by side, every time.

## Related skills

- `mdx-editor` — the current, live system this replaces. Keep both skills
  in sync as work progresses; concepts move from "current" to "carried
  over" or get explicitly superseded here.
