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

::file{url="https://....", description="Description"}

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
  `var(--dark-midground)`. Lives on a NESTED `.ox-dot-grid` child `<div>`
  inside `.ox-content` (`OxEditor.tsx`/`OxRenderer.tsx` all render
  `<div class="ox-content ..."><div class="ox-dot-grid">...`), not on
  `.ox-content` itself — so any modifier that wants to suppress the dots
  for one particular surface (e.g. `.ox-file-caption-editor`) must target
  `.ox-content.<modifier> > .ox-dot-grid`, not just
  `.ox-content.<modifier>` — `background-image` isn't inherited, so
  overriding it on the outer element is a silent no-op once the child
  sets its own. **Real bug found and fixed this way**: the
  `::file{...}` caption editor's own dot-suppression rule had drifted to
  target `.ox-content.ox-file-caption-editor` directly (dead code left
  over from before `.ox-dot-grid` was split out into its own child div),
  so the caption editor kept silently showing the dot grid despite the
  rule intended to suppress it — fixed by retargeting the rule at
  `.ox-content.ox-file-caption-editor > .ox-dot-grid` instead.
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
- **Three separate color tokens in `.ox-tokens` (`oxmarkdown.css`) for
  headings/decorative accents/links** — `--ox-color-heading` (h1, and h2/
  h3/h4 via `--ox-color-accent` below — the whole heading hierarchy
  agrees), `--ox-color-accent` (h2/h3/h4, blockquote border, checkbox
  border, bullets, table headers, popover title), and `--ox-color-link`
  (`<a>`, the "add file" trigger, a Card's "open project" link). All
  three happen to share light-mode values today (`black` for heading,
  `--purple-light` for accent/link) but are genuinely independent, split
  apart specifically so dark mode can give each its own distinct color
  without conflating them. Current dark-mode values: `--ox-color-heading`/
  `--ox-color-accent` → `--moon` (`#c4c6fc`, the whole heading hierarchy
  converges here), `--ox-color-link` → plain `white` — chosen specifically
  so a link never blends into surrounding heading text. Swap any one
  token's dark value to taste (e.g. `--pink`, `#d3a0e5`, was tried for
  links first and is a reasonable alternative to white); nothing else
  needs to change since every consumer reads through these three custom
  properties, never a raw color. `h4` previously had NO explicit color
  rule at all (silently fell through to plain body text, `--ox-color-text`)
  — now reads `--ox-color-accent` like h2/h3, matching a minor heading's
  lighter-weight treatment rather than h1's bold black. **A real,
  confirmed bug lived here before this pass**: the dark-mode block used
  to read `--ox-color-accent: var(--purple-light, #a78bfa)`, trying to
  use the CSS custom-property FALLBACK to sneak in a dark-mode-only
  lighter purple — except that fallback only applies when `--purple-light`
  is UNDEFINED, which it never is (nopal defines it once, unconditionally,
  in `:root`). So that line was a complete no-op versus light mode: every
  heading/link/checkbox/bullet/table-header rendered the EXACT SAME
  purple in both color schemes, confirmed directly by reading computed
  styles (not assumed from a screenshot). The general lesson: nopal's OWN
  convention for "this token needs a different value in dark mode" is to
  swap to a DIFFERENT named token at the point of use (`var(--moon)`,
  `white`, ...), never to try overriding a token nopal itself already
  defines unconditionally — a fallback on an always-defined variable is
  dead code.
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

- **A controlled `OxEditor` must never mount with a placeholder value
  before the REAL one is known — confirmed to actively corrupt data, not
  just flicker.** The Daily Log's `today`/`todayContent` intentionally
  start as `""` (so server and initial client render match, avoiding a
  hydration mismatch), with a `useEffect` filling in the real values
  right after hydration. `TodayLogEntry`'s `<OxEditor>` used to render
  UNCONDITIONALLY through that whole window, including with `markdown=""`.
  Found by direct testing (a real, previously-saved day's content was
  silently overwritten with blank): `OxEditor`'s OWN mount-time reseed
  (`MarkdownSyncPlugin`) can itself be dirty enough (e.g. padding an
  empty document up via `MinRowsPlugin`) to fire its update listener,
  which echoes an `onChange("")` back up — and depending on effect
  ordering (children's effects run before their parent's, so the child
  editor's echo can fire either side of the PARENT's own hydration
  effect), that echoed `setTodayContent("")` can land AFTER — and so
  overwrite — the hydration effect's `setTodayContent(realContent)`
  call, for the exact same reason `handleChange` exists at all: there's
  no way to tell "this onChange is a real edit" from "this onChange is
  my own placeholder mount echoing back" from the callback's own
  perspective. Fixed by not rendering `<TodayLogEntry>`/its `<OxEditor>`
  AT ALL until `today` resolves (`{today && <TodayLogEntry .../>}`) —
  matching the SAME gating `pastEntries` already used, so there's no
  "mount with a placeholder, then fix it up" step to race in the first
  place. Generalizes beyond the Daily Log: any controlled `OxEditor`
  whose real initial `markdown` isn't known synchronously on first
  render should stay unmounted (or otherwise not commit its `onChange`
  anywhere) until it is, not mount with a temporary placeholder value.
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
     read-only once the day is over. Cards are ALSO now real (see step 11)
     — `TodayLogEntry`/`AddCardSection` use real project data
     (`getProjectFolders`) and real one-card-per-project-per-day
     enforcement (`createDailyLogCard`'s idempotency), with `resolveCard`
     wired through to both `TodayLogEntry` and `PastLogEntry`. Deliberately
     NOT ported: a Card's own keyboard-flow polish (see step 11's own
     scope note) and cross-human/shared projects as Card targets.
     **The page's whole visual FRAME is also now real**, not just the
     Cards data — `DayContainer`/`DayTitle`
     (`components/DailyLogDay.tsx`, `styles/dailyLog.css`) were promoted
     out of the (now-deleted) `daily-log-v2` visual mockup once its design
     settled. This mattered more than it might sound: the real route had
     kept its OLD pre-mockup look (a generic `good-box` wrapper around the
     editor, ad hoc per-day heading styles) even after Cards were wired
     in, which meant a Card had no visual contrast to "pop" against — the
     day's own prose area was the SAME warm `good-box` tone as the card
     itself, not the mockup's deliberately different near-white/dark-plum
     `.daily-log-day` frame. Confirmed fixed by direct side-by-side
     screenshot comparison in both color schemes, not just assumed from
     reading the code.
   - **A second, subtler bug found the same way**: even with the shared
     frame in place, a Card still sat visibly WITHIN both gutters instead
     of overflowing them — confirmed by measuring, not just eyeballing,
     that it fell ~33px short of the day frame's own edge on both sides.
     Root cause: `DayContainer`'s own right-padding (`var(--ox-grid)`,
     41px) was a STALE compensation for `.ox-content` once being
     LEFT-gutter-only — by the time this feature was built, `.ox-content`
     had already become symmetric (see step 10's gutter-markers note), so
     that right-padding was pure double-counting, not doing anything
     useful anymore. Fixed by removing it (`DayContainer` now adds ZERO
     padding of its own on either side — `.ox-content`'s own symmetric
     gutter is the whole story). Separately, `.ox-card-directive`'s own
     bleed amount needed recalculating for a reason that has nothing to
     do with the stale padding: it lives NESTED inside the prose's own
     `.ox-content` (unlike the old `daily-log-v2` mockup's `CardBox`, a
     top-level DayContainer SIBLING, unconstrained by anything) — and
     `.ox-content`'s `overflow-x: hidden` clips any descendant's bleed at
     `.ox-content`'s OWN edge, no matter how large a negative margin is
     applied. Confirmed directly: trying to replicate the mockup's exact
     `CARD_BLEED` (an extra `8px` past the gutter) got that extra sliver
     silently clipped, squaring off the card's rounded corner instead of
     extending it.

     Reaching (not exceeding) the shared edge still wasn't the real goal,
     though — a GENUINE `8px` overhang past the day frame's own border
     (matching the mockup's own `CARD_BLEED` exactly) turned out to still
     be achievable, just not via the card's own margin alone. The key
     realization: `overflow-x: hidden` clips at `.ox-content`'s OWN
     border-box edge specifically, and PADDING never moves that edge
     (padding is inside the border-box) — only `.ox-content`'s OWN
     MARGIN does. So the OUTER prose editor that hosts a Card gets a new
     modifier, `.ox-card-host` (applied via `OxEditor`'s ordinary
     `className` prop, in `fruits_.daily-log.tsx`): a small negative
     margin (`-8px` each side) that widens `.ox-content`'s OWN border-box
     by exactly the overhang amount, with a MATCHING increase to its own
     padding (`+8px` each side) so the prose text's position doesn't
     shift at all — only the (otherwise invisible) edge of the box
     itself moves outward. The card's bleed then exactly cancels THAT
     wider padding (`-1 * (var(--ox-grid) + 8px)`), landing its edge at
     `.ox-card-host`'s new, wider border-box edge — which sits exactly
     `8px` past the day frame's real visual border. Confirmed by
     measuring actual rendered bounding boxes (Playwright), not just
     eyeballing a screenshot — 8px is subtle enough that eyeballing alone
     had already produced a false sense of "close enough" earlier in
     this exact investigation.
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
   `daily-log-v2` visual mockup (since deleted — its design fully ported
   to the real Daily Log route, see step 6 above); the underlying
   `OxEditorGroup` machinery is now also used internally by the Card/file-
   caption arrow flows (`CardEditorArrowPlugin.tsx`,
   `FileCaptionArrowPlugin.tsx`), but the real Daily Log route itself does
   not yet wrap its prose+Cards stack in an explicit `<OxEditorGroup>`.
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
      (`className="ox-file-caption-editor"`, overriding the background-
      image on the NESTED `.ox-dot-grid` child div — see "Design
      language" below for why it's a child, not `.ox-content` itself —
      it reads as a small annotation field, not its own document) and
      flows ArrowUp/ArrowDown into a SIBLING file directive's caption
      within the same outer document
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
      - **That per-plugin fix only covers focus handoffs routed through
        those specific keyboard flows (ArrowUp/Down, Backspace, Enter) —
        a plain MOUSE CLICK directly into a caption/card's nested editor
        never goes through any of them**, so the outer (or Card-hosting)
        editor's selection was never cleared and the identical
        bounce-back reproduced on the very first keystroke — reported
        as "with several files in the same document, I can't type in a
        caption without focus jumping back to the containing editor,"
        confirmed as exactly this bug (clicking straight into a caption,
        skipping the arrow-key plugins entirely, is the common case once
        there's more than one file to click between). Fixed generically
        with a new plugin, `oxmarkdown/NestedEditorBlurPlugin.tsx`,
        mounted unconditionally on every Editing-mode `OxEditor`
        (alongside `InteractablesPlugin`/`MinRowsPlugin`): listens for
        Lexical's own `BLUR_COMMAND` and, a frame later (checking
        `document.activeElement` rather than trusting the blur
        `FocusEvent`'s own `relatedTarget`, whose support for plain
        `focus`/`blur` — as opposed to `focusin`/`focusout` — has
        historically been inconsistent across engines), clears THIS
        editor's selection if-and-only-if focus landed inside a DOM
        DESCENDANT of its own root — which only ever means a nested
        `<OxEditor>` mounted inside one of its own decorators. Losing
        focus to anything else (outside the page, the add-file link, a
        popover, ...) leaves the selection untouched, matching Lexical's
        own default behavior for those cases. This makes the fix apply to
        ANY current or future nested-editor entry point, mouse or
        keyboard, without each one needing to remember to clear selection
        by hand — the existing arrow-key-driven plugins' own explicit
        `$setSelection(null)` calls are still in place (harmless,
        idempotent alongside this) rather than removed.
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
11. **Done — the `::card{file="..."}` interactable**, a built-in leaf
    directive (own row, no children, same "mount point, not nested
    markdown" shape as `::file{...}`) marking where a Card appears in a
    day's flow. See the `vault` skill's "Cards" section for the vault-side
    data model (`dailyLog.server.ts`'s `getDailyLogCards`/
    `createDailyLogCard`/`saveDailyLogCard`) — this entry covers the
    OxMarkdown-side rendering.
    - Unlike `::file{...}`'s caption, a Card's content is NEVER stored in
      an attribute on this directive — it's a whole separate vault file
      with its own load/save lifecycle, resolved from OUTSIDE via a new
      `OxEditor` prop, `resolveCard` (`oxmarkdown/cardDirective.ts`'s
      `CardResolver` — `(fileName) => {projectName, projectHref,
      markdown, onChange} | undefined`), same spirit as `mentionSearch`/
      `onUploadFile`: `OxEditor` stays ignorant of vault/project
      specifics, the caller (`fruits_.daily-log.tsx`) owns resolving real
      data and debouncing the actual save.
    - Reached two ways, both landing on the same directive shape: "Add a
      card" (`AddCardSection`, always-visible project chips — filtered to
      projects WITHOUT a card yet today via `cardedProjectFolderIds`,
      which scans the readme's OWN markdown for existing `::card{...}`
      occurrences rather than a separately-tracked list that could drift
      from it) or, in principle, a future `/card` slash command (not
      built) triggering the identical insertion from the cursor instead
      of a chip click. "Add a card" itself works at the plain mdast level
      (`appendCardDirectiveMarkdown`: parse → append → re-serialize)
      rather than through a live Lexical editor instance — it's
      triggered from OUTSIDE the editor (a Chip click), with no live
      `LexicalEditor` reference at hand; the caller feeds the result
      straight back in as `OxEditor`'s own controlled `markdown` prop,
      which `MarkdownSyncPlugin` re-seeds from as an ordinary "changed
      from outside" update.
    - **Reuses `OxEditorContext`'s existing circular-import workaround**
      to mount its OWN nested `<OxEditor>` — the SAME pattern `::file`'s
      caption already proved safe, just with a whole document's worth of
      content instead of a short caption, and `allowFileAttachments`/
      `showAddFileLink` both ON (a Card, unlike a caption, is meant to
      hold real attachments). A NEW context, `UploadFileContext`
      (`components/OxRenderer.tsx`, alongside `DirectiveRegistryContext`/
      `CardResolverContext`), threads the OUTER editor's own
      `onUploadFile` down to the Card's nested editor, so an attachment
      added inside a Card uploads to the exact same place (that day's
      vault folder) the outer document's own attachments do, not a
      second, divergent path.
    - **Renders differently depending on mode**, all in
      `components/OxRenderer.tsx`'s `CardDirectiveStatic`/
      `CardDirectiveLayout` (the static/Interacting-mode path) and
      `editingNodes.tsx`'s `OxDirectiveDecorator` (the live Editing-mode
      path, alongside `::file`'s own branch):
      - Editing mode: a real nested `<OxEditor mode="editing">`, wired to
        `resolveCard`'s `markdown`/`onChange`.
      - Interacting mode (`interactive` prop present, e.g. a past,
        locked day): ALSO a real nested `<OxEditor mode="interacting">`
        rather than a second, bespoke static-render path — a past day's
        card still needs working checkbox toggles/file thumbnails, same
        as the outer document's own past-day content does. Reached via
        `OxEditorContext` too, which is why `OxInteractingSurface` (not
        just `OxEditingSurface`) now ALSO provides `OxEditorContext`/
        `CardResolverContext` — it didn't need to before this.
      - No `interactive` at all (a fully passive render, e.g. a public
        unauthenticated view): plain static markdown via `OxStaticNodes`,
        matching how the rest of a non-interactive render behaves — no
        live interaction of any kind, anywhere. Mounting a live editor
        here would let a checkbox toggle silently call `resolved.onChange`
        (a save) from a context with no business saving anything.
      - `resolveCard` returning nothing yet (still loading) renders a
        plain "Loading card…" placeholder inside the SAME header shell,
        rather than vanishing, so the row's presence stays visible.
    - Visually: `.ox-card-directive` bleeds outward past `.ox-content`'s
      own gutters on both sides (negative margin + matching inward
      padding, same technique `::file`'s thumbnail uses for the LEFT
      gutter alone, here on both), `.good-box` (root.css) for the actual
      fill/border, a header row (project name + "open project →" link to
      `/fruits/vault?folder=<projectFolderId>`, plus a remove button) and
      a content slot below. Ported directly from the `daily-log-v2`
      visual mockup's `CardBox`.
    - **Done — a fully symmetric arrow-key flow in and out of a card**,
      the SAME job `fileCaptionFlow.ts`/`FileDirectiveArrowPlugin.tsx`/
      `FileCaptionArrowPlugin.tsx` do together for a file's caption, via a
      new, independent registry (`oxmarkdown/cardFlow.ts`) and plugin
      pair: `CardDirectiveArrowPlugin.tsx` (mounted unconditionally on
      every Editing-mode `OxEditor` — outer editor → card) and
      `CardEditorArrowPlugin.tsx` (mounted INSIDE a card's own nested
      editor via the `cardFlow={{ outerEditor, nodeKey }}` `OxEditor`
      prop, wired in `editingNodes.tsx` — registration AND card → outer
      editor). Both directions reuse the SAME `$setSelection(null)`-
      before-handoff fix `FileDirectiveArrowPlugin.tsx`'s header documents
      in full — confirmed still necessary here too, not re-derived from
      scratch.
      **Known, deliberate scope line**: unlike the file caption's pair,
      no sibling-card-to-sibling-card flow and no double-Enter escape
      gesture — neither was asked for; `::file`'s own full keyboard-flow
      niceties were built incrementally across several rounds of
      hands-on iteration, so the same treatment for a Card (a full
      document, not a short caption) can grow the same way if a real need
      for it shows up, rather than guessing at it blind.
    - **Also deliberately out of scope**: cross-human projects (Cards can
      only target projects the human OWNS — see the `vault` skill's
      `getProjectFolders`) and nested cards (a `::card{...}` rendered
      inside another Card's own content resolves to nothing, since
      `resolveCard` isn't threaded to that depth — an accepted, not
      actively guarded-against, degenerate case).
12. **Done — the Toggle List** (`:::toggle{collapsed="true"}`), a
    Notion-style collapsible title + body block. Motivating case: a more
    generic replacement for a bespoke "release-item" directive — the
    Release Log (see the `vault` skill's Daily Log section) can just use a
    Toggle List directly (title = the short one-line summary, body = the
    expanded detail/cascading effects) instead of a special-purpose
    directive of its own. Triggered by typing `> ` at the start of a line
    (repurposed FROM blockquotes — see below).
    - **Architecturally a REAL container `ElementNode`
      (`oxmarkdown/OxToggleNode.ts`), NOT a directive/decorator** — the
      one deliberate exception to "leaf directive, own row, no children"
      every other built-in interactable (`::file`, `::card`) follows.
      Sidesteps the OxDirectiveNode/decorator system's own known
      limitation ("a container directive's nested content isn't
      independently editable yet") entirely for this ONE proven, real
      need, the same way checklists got their own dedicated
      `OxListItemNode` instead of a generic fix to `@lexical/list`. Proven
      safe by the SAME pattern blockquotes already use
      (`editingTransforms.ts`'s `blockquote` case: `$createQuoteNode().append(
      ...convertBlockList(node.children, defs))`) — a real, multi-block,
      natively-editable container was already shipped and working before
      this, just never generalized into its own primitive until now.
    - **Markdown shape**: the directive's OWN first child is always the
      title (any inline markdown — bold, links, ... — same as a
      paragraph's, NOT a `title="..."` attribute string, which could only
      ever hold plain text and would lossy-round-trip a formatted title);
      everything after it is body content:
      ```
      :::toggle
      Release: **Sunny**

      - fence-line.jpg file put in [./gallery/fence-line.jpg](...)
      :::
      ```
      `collapsed="true"` is added only when true — keeps the common
      (expanded) case's markdown clean. Degrades gracefully for hand-
      edited/foreign markdown that doesn't follow the "first child is the
      title" convention (treats the whole thing as body with a blank
      title, never loses content).
    - **`OxToggleNode`'s children are ALWAYS `[OxToggleSummaryNode, ...body
      block nodes]`** — the summary (title) is a thin `ElementNode`
      sibling-shaped subclass (not a plain `ParagraphNode`) purely so
      rendering/CSS/keyboard behavior can target it specifically; always
      exactly the first child, always present, same "always a real
      clickable row" invariant `MinRowsPlugin`/`LeadingBlockGuardPlugin`
      already use elsewhere — `convertToggle` (`editingTransforms.ts`)
      synthesizes an empty body paragraph on import if the source had
      none, matching the live-typing shortcut's own behavior
      (`toggleTransformer.ts`).
    - **`> ` deliberately repurposed FROM blockquotes onto the Toggle
      List** — a product decision (reads more like Notion's own toggle
      mnemonic), not a limitation. Blockquotes moved to `"` (a literal
      double-quote, then a space) instead — `oxmarkdown/quoteTransformer.ts`
      (`OX_QUOTE`) is a copy of `@lexical/markdown`'s own default `QUOTE`
      transformer with only the trigger `regExp` changed; `OxEditor.tsx`'s
      `OX_TRANSFORMERS` filters the library's own default `QUOTE` out of
      `TRANSFORMERS` (`.filter((t) => t !== QUOTE)`) so `> ` and `"` don't
      both create blockquotes. `oxmarkdown/toggleTransformer.ts`
      (`OX_TOGGLE`) is modeled the same way, building an `OxToggleNode`
      instead: whatever was already typed on the line becomes the title,
      and a fresh empty paragraph becomes the initial body.
    - **Click-to-collapse/expand, two totally different mechanisms per
      rendering path, on purpose**:
      - Editing mode (`oxmarkdown/OxTogglePlugin.tsx`): the caret is a CSS
        `::before` pseudo-element on `.ox-toggle-summary` (same "gutter
        marker" convention as `#`/`##`/`###`/`>`/the checkbox glyph), so a
        root-level click listener does hit-test math against the
        pseudo's OWN computed width (`getComputedStyle(el, "::before")`)
        rather than attaching a handler to a real DOM child — copied
        directly from `OxChecklistPlugin.tsx`'s own established pattern
        for exactly this problem, mirrored to the LEFT side (the toggle
        caret sits in the gutter BEFORE the title, unlike the checkbox
        glyph's `::after`, to the right of the dash) with the hit region
        starting AT the element's own left edge (`left: 0` in CSS, not a
        negative/outside offset) so the math and the paint agree.
      - Static/Interacting mode (`OxRenderer.tsx`): a REAL native
        `<details>`/`<summary>` pair — zero JS needed for the toggle
        itself, works even in a fully passive/non-interactive render (no
        `ctx.interactive` required at all, unlike checkbox toggling).
        Collapse state here is deliberately EPHEMERAL (the browser's own
        managed `open` state, seeded from the saved `collapsed` attribute
        on mount) — NOT re-saved back to the markdown the way Editing
        mode's own toggle persists (`OxToggleNode.__collapsed` is a real
        Lexical field, exported on every save). This asymmetry is
        deliberate, matching how a native disclosure widget's open/closed
        state is ordinarily per-view, not part of a document's content —
        not yet wired through `OxInteractive`'s mutate-and-persist
        contract the way checkbox toggling is, which would be the natural
        next step if a real need for it shows up.
      - Both paths needed the SAME native browser default disclosure
        marker suppressed (`list-style: none` +
        `::-webkit-details-marker { display: none }` + `::marker {
        content: none }` on `.ox-toggle-summary`) — only the STATIC path's
        `.ox-toggle-summary` is a real `<summary>` element (Editing
        mode's is a plain `<div>`, so these rules are harmless no-ops
        there), and a real `<summary>` gets a native marker by default
        that would otherwise show up ALONGSIDE the custom `::before`
        caret. Confirmed via a minimal isolated repro (not just the real
        page) that suppressing the native marker this way does NOT also
        hide the custom one — they're independent pseudo-elements; an
        earlier attempt at this fix looked broken only because the
        resulting icon is legitimately small (14px within a 24px box) and
        subtle against the dot-grid background at normal screenshot
        resolution, confirmed by a tight zoomed crop, not because
        anything was actually wrong.
    - **Done — full keyboard-flow parity, all in `OxTogglePlugin.tsx`
      unless noted**:
      - **Never the first line of the document**: `LeadingBlockGuardPlugin.tsx`
        (previously decorator-only) now ALSO guards `OxToggleNode` even
        though a toggle isn't a decorator at all — the same underlying
        reason still applies (a real block needs SOMETHING above it to
        arrow/click into, and a toggle sitting first would make it
        impossible to ever add content before it by typing alone).
      - **Double-Enter on the body's last (empty) line escapes** to the
        outer document right after the toggle, reusing an existing
        following paragraph if there is one or creating a fresh one
        otherwise — the same idea `FileCaptionArrowPlugin.tsx` already
        uses for a file's caption, adapted for a body that holds several
        real paragraphs rather than just one line: the toggle's OWN
        initial construction-time empty paragraph doesn't count as
        escape-worthy by itself (its previous sibling is the SUMMARY, not
        a real body line) — only once a genuine Enter has created a
        SECOND empty paragraph (real previous sibling exists) does
        pressing Enter again escape, which is what makes it feel like
        "press Enter twice" regardless of how much real content came
        before it.
      - **Backspace on a wholly EMPTY toggle** (blank title, single blank
        body paragraph, nothing ever typed) removes it outright rather
        than merging its two empty parts together — cleanly undoes the
        `> ` conversion when nothing was added.
      - **Real bug found and fixed by testing, not assumed**:
        `OxToggleSummaryNode.insertNewAfter` (Enter on the title) used to
        UNCONDITIONALLY create a fresh paragraph — wrong, because a
        toggle ALREADY has its own construction-time empty body paragraph
        as the summary's next sibling from the moment `> ` converts it
        (see `toggleTransformer.ts`'s own "always a real clickable row"
        invariant). Always inserting another one there left TWO
        indistinguishable empty paragraphs side by side, which silently
        broke the double-Enter escape check above (it requires the
        current empty paragraph to be the toggle's LAST child, and it
        no longer was). Fixed to REUSE the existing next sibling when it's
        already an empty paragraph, only falling back to creating a new
        one when there genuinely isn't one, or it already has real
        content (Enter fired mid-title with real body text already
        typed) — that narrower case can still mis-place split-off
        trailing title text at the END of existing content rather than
        ahead of it, left as a known, much rarer limitation rather than
        solved here.
    - **The caret lives IN THE GUTTER** (`left: -38px` on
      `.ox-toggle-summary::before`, same convention as the `#`/`>`
      markers), NOT in reserved inline padding the way the checkbox glyph
      is — the title text itself stays flush with the rest of the
      document's column, matching how a Card's own title has no icon
      pushing its text sideways either. `OxTogglePlugin.tsx`'s click
      hit-test reads this pseudo's OWN computed `left`/`width` directly
      (not a hardcoded offset), so the two can't drift out of sync.
    - **Done — lists (`- `/`* `/`+ `/`1. `) work inside a toggle's own
      body**, via a new `oxmarkdown/ToggleListPlugin.tsx`. Needed because
      `registerMarkdownShortcuts`'s `ElementTransformer` dispatch
      (confirmed directly reading `runElementTransformers`'s source in
      `@lexical/markdown`) REQUIRES a paragraph's own PARENT to be the
      root/a shadow root before ANY live-typing shortcut fires — the
      SAME restriction `checklistTransformer.ts`'s own header already
      documents for checkboxes, just newly relevant because a toggle
      body paragraph's parent is the `OxToggleNode`, never root. A
      `RootNode`-shaped fix (overriding `OxToggleNode.isShadowRoot()` to
      return `true`, which WOULD satisfy that check) was considered and
      rejected — `isShadowRoot` has a much wider blast radius across
      Lexical's own core (caret-boundary lookups, `canBeEmpty`
      exemptions, indent/outdent and select-all boundary checks, ...—
      confirmed by reading every call site in `Lexical.dev.mjs`, not
      assumed), too speculative a change for the specific, narrow gap
      actually asked for. Instead mirrors `ChecklistUpgradePlugin.tsx`'s
      OWN proven workaround for the identical restriction: a plain
      `registerUpdateListener` matching single-keystroke typing against
      `UNORDERED_LIST.regExp`/`ORDERED_LIST.regExp` (reused directly from
      `@lexical/markdown`, not hand-copied) and performing the same
      conversion `listReplace()` does internally, by hand, entirely
      outside `MarkdownShortcutPlugin`'s constrained dispatch. Builds
      `OxListItemNode` specifically (not `@lexical/list`'s plain
      `ListItemNode`) — required, not stylistic: `editingTransforms.ts`'s
      export path only recognizes `OxListItemNode` children when
      serializing a list, so a plain `ListItemNode` here would be
      silently DROPPED on save. Scoped specifically to a toggle's own
      body (not generalized to "any non-root paragraph," e.g.
      blockquotes) — that's the concrete, requested gap; broadening
      further can follow if a real need shows up elsewhere.
13. **Done — a basic grid (`:::grid{columns="N"}` / `::col`), STATIC/
    Interacting-mode rendering only, by deliberate, documented design.**
    Motivating case: side-by-side layouts (image comparisons, a small
    gallery of cells) that don't need any of the live-editing machinery
    every other built-in interactable above was built for.
    - **Built directly into `renderDirective` (`components/OxRenderer.tsx`),
      same category as `::file`/`::card`/`:::toggle` — NOT a
      caller-registered `DirectiveRegistry` entry**, even though a plain
      registry entry was the first idea floated (see "Key resolved
      decisions" pattern of starting narrow via the registry before
      reaching for a built-in). Rejected once it became clear cell-
      splitting needs the container's RAW child mdast nodes — the
      `DirectiveRenderer` contract only ever hands a registered renderer
      the already-rendered `children: ReactNode` for a container
      directive, which is exactly the wrong shape once cells need to be
      cut apart on `::col` markers first.
    - **Markdown shape, no nested `:::` fences needed**: `::col` is a
      LEAF directive (never nests, no fence-length bookkeeping the way a
      nested container directive would need), used purely as a
      cell-break marker within the outer `:::grid{...}` container's own
      flat child list:
      ```
      :::grid{columns="3"}
      First cell

      ::col
      Second cell

      ::col
      Third cell
      :::
      ```
      `splitGridCells` walks `node.children` once, starting a new cell
      array every time it hits a `leafDirective` named `col`; content
      before the first `::col` is always the first cell, so a `:::grid`
      with zero `::col` markers degrades to one full-width cell rather
      than an error. A stray `::col` used OUTSIDE a `:::grid{...}` falls
      through to the ordinary "unknown directive" rendering every other
      directive misuse already gets — no special-casing needed there.
    - **`columns` defaults to the cell count, not a fixed number** —
      `clampGridColumns` only falls back to a hardcoded default when the
      attribute is missing/invalid, and clamps either way to a sane
      `1..6` range. This means the common case ("split content into N
      groups, lay them out side by side") needs no attribute at all;
      `columns` only needs setting to force a DIFFERENT column count than
      the number of `::col`-separated groups (e.g. 4 cells wrapping at 2
      columns).
    - **`.ox-grid-directive`/`.ox-grid-cell` (`oxmarkdown.css`)**: plain
      CSS Grid, `gap: var(--ox-grid)` so the seams between cells stay on
      the same 41px rhythm as everything else, collapsing to a single
      column below the same `640px` breakpoint `OxPopover`/the `@`-mention
      menu already use for mobile. Each cell keeps its own normal
      `renderBlockNodes` rhythm internally (a cell with a heading and
      several paragraphs reads top-to-bottom exactly like ordinary prose,
      just narrower).
    - **Deliberately, explicitly NOT given an Editing-mode rendering.**
      `editingTransforms.ts`'s `convertBlock` has no special case for
      `name === "grid"` (unlike `"toggle"`) — a `:::grid{...}` container
      falls through to the ordinary `$createOxDirectiveNode(node)` path,
      same as any other unregistered container directive, which means
      `editingNodes.tsx`'s `OxDirectiveDecorator` shows it as a plain
      "Unknown block: ::grid" placeholder while editing rather than a
      real grid preview. This is a genuine, intentional gap, not an
      oversight: **a grid's whole point is a passive, read-only layout**
      (image galleries, side-by-side comparisons) — unlike `::file`'s
      caption or `::card`'s content, there was never a real need for live
      per-cell typing to justify the much bigger lift a real Editing-mode
      preview would need (either teaching the generic directive-decorator
      path to render arbitrary nested content read-only, or promoting
      `grid` to a real container `ElementNode` the way `:::toggle` needed
      to become). Nothing is destroyed by this gap — `OxDirectiveNode`
      holds the exact original mdast node and round-trips it losslessly
      through export regardless of how (or whether) it's previewed while
      typing — confirmed by the project's own three-leg testing
      convention (below): input markdown, rendered static/Interacting
      output, and re-exported markdown for a `:::grid{...}` sample all
      agree. If a real need for live grid editing shows up later, promote
      it the same way Toggle List was promoted, rather than guessing at
      it blind now.
    - Demoed on the `fruits/styles/oxmarkdown` decision log (`DEFAULT_SAMPLE`)
      alongside the other built-in directives.
14. **Done — a basic gallery (`:::gallery{max-columns="N"}`), STATIC/
    Interacting-mode rendering only, same deliberate scope as Grid (step
    13) and for the same reasons.** Motivating case: the actual thing Grid
    itself was originally motivated by ("side-by-side layouts, image
    comparisons, a small gallery of cells") but purpose-built for photos
    specifically, with an auto-computed column count instead of an
    explicit `columns` attribute.
    - **Built directly into `renderDirective` (`components/OxRenderer.tsx`),
      same built-in category as `::file`/`::card`/`:::toggle`/`:::grid` —
      NOT a caller-registered `DirectiveRegistry` entry**, for the exact
      same reason Grid isn't one: laying photos out needs the container's
      RAW child mdast nodes (to find every `image` node recursively), and
      the `DirectiveRenderer` contract only ever hands a registered
      renderer the already-rendered `children: ReactNode` for a container
      directive.
    - **Deliberately NO new per-photo syntax** — a gallery's children are
      just ordinary, standard `![alt](url)` markdown images, typically one
      per line/paragraph:
      ```
      :::gallery{max-columns="3"}
      ![First photo caption](https://example.com/1.jpg)
      ![Second photo caption](https://example.com/2.jpg)
      ![](https://example.com/3.jpg)
      :::
      ```
      `collectGalleryImages` walks `node.children` recursively (any
      descendant, not just direct children, since a real markdown image
      normally sits one level down inside its own `paragraph`) collecting
      every `image` node in document order. This is what makes a gallery
      degrade GRACEFULLY: a renderer that doesn't understand the `gallery`
      directive at all (Obsidian, GitHub, a bare text editor) still shows
      every photo, just stacked instead of tiled, unlike a bespoke
      `::photo{fileId=...}`-style directive would. An empty gallery (no
      `image` nodes found at all) degrades further still, falling back to
      plain `renderBlockNodes` of whatever content IS there — same
      graceful-degradation instinct as Grid's own "zero `::col` markers"
      case.
    - **Column count is auto-computed from the photo count, then capped
      by `max-columns`** — deliberately different from Grid's own
      `columns` attribute (which defaults to the literal cell count with
      no other logic): 1 photo → 1 column always, 2–6 photos → 2 columns,
      7+ photos → 3 columns (`computeGalleryColumns`'s `auto` value).
      `max-columns` defaults to, AND is hard-capped at, `GALLERY_COLUMN_CAP`
      (`3`) — unlike Grid's `MAX_GRID_COLUMNS` (`6`, a sanity ceiling
      against typos), this ceiling is a real, current product constraint:
      `max-columns` can only ever bring the column count DOWN from what
      the photo count would otherwise produce, never raise it past 3 —
      there is no way to get a 4+ column gallery right now. Final column
      count is `min(auto, clamp(max-columns, 1, 3))`.
    - **`.ox-gallery-directive`/`.ox-gallery-item` (`oxmarkdown.css`)**:
      plain CSS Grid (`grid-template-columns: repeat(var(--ox-gallery-
      columns, 3), 1fr)`), `gap: var(--ox-grid)` for the same 41px rhythm
      every other seam in OxMarkdown uses, collapsing to a single column
      below the same `640px` breakpoint `OxPopover`/the `@`-mention
      menu/`:::grid` already use for mobile. Each photo renders as a
      square `aspect-ratio: 1 / 1` tile (`object-fit: cover`), with the
      image's own `alt` text doubling as an optional `<figcaption>` below
      it when non-empty — no separate caption attribute/syntax needed,
      since standard markdown images already carry exactly that field.
    - **Deliberately, explicitly NOT given an Editing-mode rendering** —
      identical reasoning and identical mechanism to Grid (step 13):
      `editingTransforms.ts`'s `convertBlock` has no special case for
      `name === "gallery"`, so a `:::gallery{...}` container falls through
      to the ordinary `$createOxDirectiveNode(node)` path, same as any
      other unregistered container directive — `editingNodes.tsx`'s
      `OxDirectiveDecorator` shows it as a plain "Unknown block: ::gallery"
      placeholder while editing. Nothing is destroyed by this: the real
      mdast node round-trips losslessly through export regardless of
      whether (or how) it's previewed while typing — confirmed via the
      project's own three-leg testing convention (below). A gallery's
      whole point, same as Grid's, is a passive, read-only layout — there
      was never a real need for live per-photo editing to justify the
      bigger lift a real Editing-mode preview would need.
    - Demoed on the `fruits/styles/oxmarkdown` decision log (`DEFAULT_SAMPLE`)
      alongside Grid and the other built-in directives.

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
