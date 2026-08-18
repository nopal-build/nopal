---
name: oxmarkdown
description: Vision, syntax, and design-language spec for OxMarkdown (OxRenderer + OxEditor), nopal's markdown editor/renderer. Use when discussing or building the nopal editor/renderer, its markdown conventions (generic directives, @ mentions, slash commands), or its visual design (dot grid, typography, mobile UX).
---

# OxMarkdown

**Status: fully built and rolled out — `MdxEditor`/`MdxRenderer` are
retired and deleted.** This skill is a living design doc — read AND update
it as thinking evolves. Keep entries here terse: a fact + a file pointer +
the one-line "why," not a forensic replay of how a bug was found.

The old `mdx-editor` skill (describing the now-deleted `MdxRenderer`/
`MdxEditorView`/`MdxEditorClient`/`MdxEditorWorkable`/`MdxEditorEditable`/
`mdxeditor.css` system) has been deleted along with the code it described —
references to it below are historical context for why OxMarkdown exists,
not a pointer to a real skill anymore.

The umbrella name is **OxMarkdown**: **OxRenderer** is the fully static,
non-interactive renderer (replaces `MdxRenderer` for public/SSR pages).
**OxEditor** is the one interactive component, taking a `mode` prop
(`"interacting"` / `"editing"`) instead of MdxEditor's three separate
components — because Editing is a strict superset of Interacting, there's
no reason for them to be different components.

## Why replace MdxEditor

Not because it's broken — its core parser has real structural limits:
`nopalEditorState.ts` splits documents into `\n\n`-delimited paragraphs, each
rendered by an independent `<ReactMarkdown>` call (no single AST for the
whole document, so a container block can't wrap multiple paragraphs with
blank lines inside), and everything non-standard (`[[wiki-links]]`,
`![[embeds]]`, CSV chips, directives) is bolted on via regex
string-preprocessing, not real AST nodes.

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

"Workable" doesn't survive as its own mode — it was always Interacting with
one interactable kind (tasks) enabled. Generalized: **which interactables
are enabled is a per-interactable, permission-driven decision, not a mode
switch.** A logged-out viewer might get zero enabled interactables; a
collaborator might get checkboxes and mentions but not directive popovers;
the owner gets everything — same rendered document throughout.

## Interactables

An **interactable** is any rendered unit that isn't plain flowing text — a
discrete, selectable element with its own behavior: `@`-mentions, directives
(`::name{...}`, `:::name{...}`, `:name{...}`), and task checkboxes
(`[ ]`/`[x]`). (A csv-key chip is a kind of text-directive, not a separate
category.)

**Selection model** — every interactable selects the same way: arrow-key
navigation onto it, or a first Backspace approaching it from the right,
always selects only — never acts and never places a bare caret inside it.
Clicking/tapping always selects, and for some kinds also fires the default
action in the same motion.

**Acting on a selected interactable** (depends on kind and mode):
- Task checkbox — click/tap selects AND toggles in one motion; once
  selected by any method, Space or Tab also toggles it.
- `@mention` — click/tap selects and shows a tooltip with the resolved
  path/target.
- Directive — click/tap selects and shows a tooltip or a popover for
  editing its attributes (e.g. a `::gallery{...}` popover for
  `folder`/`title`/`size` without hand-editing the directive text).
- **Backspace or Delete again, once selected** (Editing mode only) — fully
  removes the interactable. Both keys behave identically; recovery relies
  on ordinary undo. (An earlier design had Backspace *revert to raw text*
  instead; reversed — the export-escaping machinery it needed wasn't worth
  it when retyping via `/` is easy.)

**Range selection is different**: a Shift+arrow or click-drag selection
treats any interactable it contains as a single atomic "character" — deleted
outright, no tooltip/popover/revert step. The select-then-act model only
applies when an interactable is the exact, sole selection target.

## What carries over from MdxEditor unchanged

- **Markdown is the only saved format.** Everything rich is an
  interpretation of markdown at render time, never a divergent internal
  format. Anything OxMarkdown adds must degrade to plain, readable markdown
  elsewhere (Obsidian, GitHub, a bare text editor).
- **Dynamic content references** — linking to typed content (a CSV
  key/value pair, a vault file, a folder of images) and rendering it richly
  inline. Directives are the general mechanism for this; csv-key chips are
  the first concrete case.

## Generic directives (shipped on OxRenderer)

Inspired by `remark-directive`/the CommonMark directives proposal:

```
:name{attrs}        text directive       — inline,  e.g. :csv-key{key="location"}
::name{attrs}       leaf directive       — block, own line, no children
:::name{attrs}      container directive — wraps nested markdown
content
:::
```

- Directives are real mdast nodes via `mdast-util-directive`/
  `micromark-extension-directive`, so container directives work with
  arbitrary nested content.
- The old legacy path (`webapp/app/util/nopalDirectives.ts`'s
  `preprocessDirectives`/`extractLeafDirectives`, wired into `MdxRenderer`
  and `project.server.ts`'s old `resolveProjectManifest`) is deleted along
  with `MdxEditor` — a hand-rolled regex preprocessor that didn't support
  container directives spanning blank lines. `nopalDirectives.ts` itself
  survives, trimmed to just the leaf-directive matcher
  `fileReferences.server.ts` uses for rename propagation (unrelated to
  rendering).
- `csv-key` (the old `[key]` bracket syntax) is fully retired in favor of
  `:csv-key{key="..."}` — the template for how new conventions replace old
  ones: build the primitive, prove it in one real feature, then delete the
  old path.

## `@` mentions (replaces `[[wiki-links]]`) — shipped

`@` replaces `[[double-bracket]]` wiki-links: one tap vs. two on mobile,
reads naturally as "at," and is muscle memory from Zed/Slack/Notion/GitHub.

- **Saved as an ordinary markdown link**, not a directive: selecting a
  result inserts `[@Name](path)` — real `[text](url)` CommonMark, so no new
  parsing/rendering is needed (`link` mdast nodes already round-trip
  through `editingTransforms.ts` and render via `OxRenderer`'s existing
  `case "link"`). A mention is just a link — a caret inside it is ordinary.
- **Path is human-readable, not an opaque ID**, scoped to a human's vault
  tree: `/humanId:root/.../Name` — the colon separates human id from folder
  path, needed because folders/files can be shared between humans.
- **`@` never appears bare in saved markdown** — it's purely the trigger
  character; the resulting `[...]` brackets make the label unambiguous.
- **Search is a plain function `OxEditor` is handed**: `mentionSearch`,
  `(query: string) => MentionItem[] | Promise<MentionItem[]>`
  (`oxmarkdown/mention.ts`) — the editor has no concept of "vault" or
  "human," it just calls this and shows what comes back. "Create a page
  when nothing matches" isn't a mention-plugin feature either: an
  implementation can include a synthetic "create" result and act on it
  once selected. See `fruits/styles/oxmarkdown` (`#mentions`) for a working
  mock.
- Built on `@lexical/react`'s `LexicalTypeaheadMenuPlugin` +
  `useBasicTypeaheadTriggerMatch("@", { minLength: 0 })` — already
  implements "`@` at the start of a word" (`user@example.com` doesn't
  trigger it).
- **Deliberately deferred**: a real Vault-backed `mentionSearch` (currently
  an in-memory mock) and "embed" (`![[...]]`'s old job — see the
  directive-based plan in "Key resolved decisions").

## `/` slash commands

Typing `/` opens a menu (headings, list types, directive blocks, etc.) for
*inserting* things. **`/` never appears in saved markdown** — it's purely
UI sugar over the real syntax (directives, mentions), most valuable on
mobile where remembering `::name{attrs}` by hand isn't reasonable.

## Design principle

Ease of typing/input is a first-class constraint, on par with correctness —
Obsidian and Zed are the reference points (fast fuzzy-find, low-punctuation
syntax, keyboard-first but not keyboard-only). Weigh every syntax decision
against "how does this feel to type on a phone, one-handed, in a hurry,"
not just "is this a clean file format." Lean on established conventions
(front matter, directives, `@`-mentions) over new punctuation unless
ease-of-input clearly demands otherwise.

## Design language

The dot-grid visual identity (`webapp/app/styles/oxmarkdown.css`,
`.ox-content`) — confirmed working in light and dark mode (see
`dark-mode-review` skill to re-verify after changes):

- **41×41px dot grid background** behind all content, on a NESTED
  `.ox-dot-grid` child `<div>` inside `.ox-content`
  (`OxEditor.tsx`/`OxRenderer.tsx` both render
  `<div class="ox-content ..."><div class="ox-dot-grid">...`), not on
  `.ox-content` itself. Any modifier suppressing the dots for one surface
  (e.g. `.ox-file-caption-editor`) must target
  `.ox-content.<modifier> > .ox-dot-grid`, not just `.ox-content.<modifier>`
  — `background-image` isn't inherited, so overriding it on the outer
  element alone is a silent no-op.
- **Vertical rhythm locked to the grid.** Every block element's
  `line-height` is exactly `41px` (`var(--ox-grid)`, one cell) — this must
  hold even for INLINE decorated elements: `.ox-content code`'s own
  vertical padding was found inflating whichever wrapped line it sat on by
  2px despite a correct computed `line-height`, fixed with an explicit
  `line-height: 1` on the inline element (padding on a padded inline
  element can still grow its line's rendered height even when line-height
  looks right). `.ox-code-block code` (a block's nested element) needs its
  own `line-height: inherit` right back, same specificity/later in cascade,
  so it isn't caught by that same fix.
- **Gutter markers** — `#`/`##`/`###`/`>` render as absolutely positioned,
  low-opacity monospace pseudo-elements to the left of headings/
  blockquotes (`left: -38px`), echoing the raw markdown next to its
  rendered form. `.ox-content`'s `padding` reserves a full `--ox-grid`
  (41px) on BOTH the left and right — the right side lets a `::file{...}`
  directive's remove button stick out past the row's own right edge the
  same way markers stick out past the left, without `overflow-x: hidden`
  clipping it. A caller needing neither band (a `::file{...}` caption)
  opts out of both via `.ox-no-gutter`.
- **Color tokens** (`webapp/app/styles/root.css`): `--purple` (primary
  text), `--purple-light` (accents/headings), `--moon` (light-mode dot
  color), `--text-subtle`; full dark-mode counterparts via
  `prefers-color-scheme`, no in-app toggle.
- **Three separate color tokens in `.ox-tokens` (`oxmarkdown.css`)** for
  headings/decorative accents/links — `--ox-color-heading` (h1, and
  h2/h3/h4 via `--ox-color-accent`), `--ox-color-accent` (h2/h3/h4,
  blockquote border, checkbox border, bullets, table headers, popover
  title), and `--ox-color-link` (`<a>`, "add file," a Card's "open
  project" link). Genuinely independent even though light mode shares
  values today, so dark mode can diverge per-token (`--ox-color-heading`/
  `--ox-color-accent` → `--moon`, `--ox-color-link` → plain `white`, so a
  link never blends into heading text). **Convention**: give a token a
  different dark-mode value by swapping to a DIFFERENT named token at the
  point of use, never by relying on a CSS custom-property fallback on a
  variable nopal already defines unconditionally (`var(--purple-light,
  #a78bfa)`-style fallbacks are dead code there and shipped as a real,
  invisible bug once already).
- **Editing mode specifically must act like a code editor**: one line in
  the markdown = one row in the editor, every row the same height off the
  41px grid — no margins standing in for blank lines that should just be
  real rows. (The static `OxRenderer` keeps ordinary margin-based prose
  rhythm; this principle is specific to the live-editable surface.)
- **TODO — typewriter font.** Explore a monospace body font for precise
  gutter/column alignment. Needs a real visual pass before committing.

## Key resolved decisions

Designs that were tried, found lacking, and revised — recorded so they
aren't re-litigated from scratch:

- **A controlled `OxEditor` must never mount with a placeholder value
  before the REAL one is known.** Rendering it with `markdown=""` before
  hydration fills in the real content actively corrupted saved data once
  (Daily Log's `TodayLogEntry`): the editor's own mount-time reseed can
  itself fire an `onChange("")` echo that lands AFTER the real hydration
  update, silently overwriting it. Fixed by not mounting the component at
  all until the real value is known (`{today && <TodayLogEntry .../>}`),
  matching how `pastEntries` was already gated. Generalizes: any controlled
  `OxEditor` without a synchronously-known initial `markdown` should stay
  unmounted, not mount with a temporary value.
- **Foundation for Editing mode: trimmed Lexical, not a custom
  `<textarea>`.** A `<textarea>` can't render real checkbox glyphs/
  directive pills/the dot grid inline, so rich rendering would need a
  pixel-synced overlay — more risk than contentEditable. A trimmed
  `@lexical/react` config measured ~48 KB gzip vs. the old
  `MdxEditorEditable` chunk's 287 KB gzip (almost entirely
  CodeMirror/Sandpack/Radix/table weight nopal doesn't use).
- **Backspace and Delete are symmetric** — both fully remove a selected
  interactable (no "revert to raw text" step; retyping via `/` is easy
  enough that the extra export-escaping machinery wasn't worth it).
- **No hand-splitting the document by `\n\n`.** Parse once into a real
  mdast tree (`mdast-util-from-markdown` + micromark); `mdast-util-directive`,
  `micromark-extension-directive`, `mdast-util-frontmatter`, and
  `micromark-extension-frontmatter` were already transitive deps via
  `@mdxeditor/editor`, so adopting them directly cost nothing new.
- **Embedding gets no new punctuation.** Folded into the directive
  mechanism (e.g. `::embed{ref="Some Page"}`) reached through an
  `@mention`'s popover ("Embed" action), with a symmetric "Convert to
  link" action on the embed side. General pattern: when two forms are just
  different presentations of the same reference, make converting between
  them an interaction, not a second syntax.
- **Nested interactables inside a container directive are individually
  navigable by default** — the natural behavior on a real mdast tree.
  Treating a directive as fully atomic is a per-kind exception to add only
  if a real use case needs it.
- **No roaming caret in Interacting mode.** Keyboard focus moves between
  enabled interactables via Tab/Shift+Tab, matching ordinary web
  accessibility expectations.
- **Boundary detection ("caret has nowhere left to move") reads the
  document TREE, not native ArrowUp/Down outcome.** Cross-editor arrow
  navigation (`CrossEditorArrowPlugin.tsx`) checks selection against
  `$getRoot().getFirstDescendant()`/`getLastDescendant()` directly before
  dispatching a key — watching whether the browser's own native arrow
  press moved the caret is NOT reliable (a native ArrowDown from a
  paragraph into a following list can simply fail to move the caret,
  indistinguishable from a real boundary).
- **Undo/redo coalescing** uses `@lexical/history`'s default time/pause-based
  grouping (not word/punctuation-boundary-based) — matches Zed/VS Code, no
  custom work needed.
- **Blank lines between blocks are real rows, not CSS margin, in Editing
  mode.** Ordinary empty `ParagraphNode`s (`convertBlockList` in
  `editingTransforms.ts`), giving full native text-editing behavior for
  free. Export uses a stateless `blankLineJoin` (`mdast-util-to-markdown`'s
  `join` option) that inspects adjacent real mdast nodes directly, so N
  empty paragraphs serialize to exactly N blank lines. The static
  `OxRenderer` keeps CSS margin-based rhythm instead
  (`.ox-content > *:not(:first-child)`) — normal for read-only prose.
- **Checklists never use `@lexical/list`'s native `"check"` list type.**
  Every list is plain `"bullet"`; whether an item has a checkbox is a field
  on a custom `OxListItemNode extends ListItemNode`
  (`oxmarkdown/OxListItemNode.ts`), via Lexical's `{replace, with,
  withKlass}` node-override config. Lets one `<ul>` freely mix checkbox and
  plain-bullet items (needed so Enter's outdent can downgrade a checkbox
  item to a plain bullet in place). `isRealCheckbox()` (`checked !==
  undefined`) is the one predicate both rendering and export use. An empty
  checkbox item's state survives export via a zero-width-space placeholder
  paragraph (`CHECKBOX_PLACEHOLDER`/`\u200b`), since GFM's own
  checkbox-injection regex can't otherwise represent an empty item's
  checkbox.
- **Paste is always "paste without formatting."** `MarkdownPastePlugin.tsx`
  prefers `text/plain`; falls back to stripping `text/html` tags to text
  (converting block boundaries to newlines first). The only saved format is
  markdown, so paste should never let external styling leak in.
- **Popover positioning is one shared component**, `oxmarkdown/OxPopover.tsx`,
  on `@floating-ui/react` (already transitive via `@lexical/react`).
  Handles `flip`/`shift`/`size`/`offset`/`autoUpdate`; below `640px`
  renders as a full-width, bottom-anchored sheet instead of a floating
  dropdown. Used by the slash-command menu and directive-attribute
  popover; the `@`-mention menu uses its own already-safe
  `LexicalTypeaheadMenuPlugin` anchor instead, with the same mobile
  treatment via a plain media query.
- **Nested-editor focus handoff must explicitly clear the losing editor's
  selection** (`$setSelection(null)`), or the next keystroke in the editor
  that just gained focus bounces back to whichever editor still has a
  stale `RangeSelection` — Lexical reconciles that stale selection back
  into the DOM on any unrelated update and visibly steals focus, since a
  nested `<OxEditor>` (e.g. a `::file` caption, a `::card`'s content) is a
  DOM descendant of the outer editor's root. A deferred/microtask focus
  shift does NOT fix this; the stale selection must be cleared explicitly.
  Keyboard-driven handoffs (arrow keys, Backspace, Enter) clear it in their
  own plugins; a plain MOUSE CLICK into a nested editor doesn't go through
  any of them, so `oxmarkdown/NestedEditorBlurPlugin.tsx` (mounted on every
  Editing-mode `OxEditor`) covers that generically via Lexical's
  `BLUR_COMMAND` + checking `document.activeElement` a frame later. Applies
  to any current/future nested-editor entry point without each one
  remembering to clear selection by hand.
- **A block-level decorator (or `OxToggleNode`) can never be the first row
  of a document** — `oxmarkdown/LeadingBlockGuardPlugin.tsx`, a `RootNode`
  transform that splices a plain paragraph ahead of the first child
  whenever it's a block decorator/toggle. Guarantees a real, clickable row
  always precedes it (nothing to ArrowUp from otherwise), including for
  documents already loaded/pasted/undone into that state.
- **`isShadowRoot` was considered and rejected** as a fix for toggle-body
  paragraphs not getting live-typing shortcuts (`- `, `**bold**`, `# `):
  it satisfies `@lexical/markdown`'s "parent must be root/shadow root"
  check, but has a much wider blast radius across Lexical's own core
  (caret-boundary lookups, `canBeEmpty` exemptions, indent/outdent,
  select-all boundaries). Used a narrower, proven workaround instead
  (`oxmarkdown/ToggleListPlugin.tsx`, mirroring
  `ChecklistUpgradePlugin.tsx`'s own pattern): a plain
  `registerUpdateListener` matching typed text against
  `@lexical/markdown`'s own list `regExp`s and converting by hand, entirely
  outside `MarkdownShortcutPlugin`'s dispatch.
- **Optimistic UI is only safe when the client can predict the server's
  own key.** "Add a card" adds a placeholder to the UI and appends the
  `::card{...}` markdown synchronously, before the server round trip
  resolves — possible only because a Card's filename is deterministic from
  the project folder id alone (`cardFileName`, an isomorphic helper in
  `oxmarkdown/cardDirective.ts`), so the client computes the same filename
  the server will. The one thing the client can't predict (the real vault
  file id) gets a synthetic placeholder (`pendingCardFileId`/
  `isPendingCardFileId`) that renders a dimmed, non-interactive "Creating
  card…" state until the real id lands.

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
   `OxTreeRenderer` (so `OxEditor` mutates the exact tree it renders, not a
   fresh re-parse), `components/OxEditor.tsx`. Shipped: task checkboxes and
   a generic directive-attribute popover.
3. **Done — foundation spike, resolved: trimmed Lexical.** See "Key
   resolved decisions." Spike code deleted per the temp-code convention;
   findings preserved here.
4. **Done — full Editing mode**, on trimmed Lexical (`@lexical/rich-text` +
   `list` + `link` + `code` + custom nodes).
   - `oxmarkdown/editingTransforms.ts` converts real mdast ↔ Lexical nodes
     (not `@lexical/markdown`'s own parser — that stays reserved for
     live-typing shortcuts like `**x**`/`# `/`> ` auto-formatting).
   - `oxmarkdown/editingNodes.tsx`: `OxDirectiveNode` (reuses
     `InteractiveDirective` from `OxRenderer.tsx` — Interacting and Editing
     render directives through the same component) and `OxOpaqueNode`, a
     lossless read-only passthrough for anything not yet mapped (tables,
     raw HTML), select-then-remove like a directive.
   - `oxmarkdown/InteractablesPlugin.tsx` implements select-as-unit and
     select-then-remove once, generically, against Lexical's own
     `$isDecoratorNode`.
   - `oxmarkdown/SlashCommandPlugin.tsx` — `/` menu (headings, list types,
     divider, directive blocks).
   - Live-typing/paste conversion: `checklistTransformer.ts` (`[ ] `/`[x] `
     → checkbox), `ChecklistUpgradePlugin.tsx` (closes the `- [ ] `
     with-dash gap the transformer alone can't reach),
     `DirectiveShortcutPlugin.tsx` (Enter after a leaf directive on its own
     line converts it), `MarkdownPastePlugin.tsx` (routes plain-text paste
     through the real `parseOxDocument`/`importOxDocument` pipeline for
     full fidelity).
   - Known, deliberate limitations: a container directive's nested content
     isn't independently editable yet (renders read-only via the static
     renderer, except `:::toggle` — see step 12); checklist visuals are
     matched, not pixel-identical, to Interacting mode's static rendering.
   - Bundle cost: `OxEditor`'s own code is ~23 KB gzip; the shared Lexical
     vendor chunk is ~108 KB gzip — well under half the old (deleted)
     `MdxEditorEditable` chunk's 287 KB gzip.
5. **Not started — dedicated mobile UX pass.** Quick-actions bar and
   grid-sized tap targets (see "Mobile UX" above). Deliberately last —
   needs real-device iteration, not a spec implemented blind.
6. **Done — full migration, `MdxEditor` fully deleted.** Was incremental,
   route by route; the whole `MdxEditor*`/`MdxRenderer` family (plus
   supporting files: `csvRefPlugin.tsx`, `refPopoverPlugin.tsx`,
   `wikiLinkPlugin.tsx`, `util/nopalEditorState.ts`, `util/nopalMarkdown.ts`,
   `util/decodeMarkdownEntities.ts`, `styles/mdxeditor.css`, the
   `@mdxeditor/editor`/`react-markdown`/`rehype-raw`/`remark-gfm` npm deps,
   and the `mdx-editor` skill itself) is deleted now that every consumer is
   migrated. `robustness-core/util/nopalDirectives.ts` is the one survivor —
   trimmed down to just the leaf-directive matcher
   (`findLeafDirectiveOccurrences`/`replaceDirectiveAttrInMatch`)
   `fileReferences.server.ts` still uses for File Referencing & Renaming's
   rename propagation, independent of rendering.
   - **Done**: Daily Log (`routes/fruits_.daily-log.tsx`) — rebuilt fresh on
     `OxEditor` (today's entry `mode="editing"`, past entries
     `mode="interacting"`), not a compatibility-preserving port. `@`
     mentions, file/image upload (step 10), and Cards (step 11) are all
     real, vault-backed features here, not mocks. Deliberately dropped as a
     product decision: carrying a previous day's unchecked tasks forward
     (confusing in practice) — today always starts blank. The page's
     visual frame (`DayContainer`/`DayTitle`,
     `components/DailyLogDay.tsx`, `styles/dailyLog.css`) was promoted out
     of the (deleted) `daily-log-v2` mockup once its design settled, giving
     a Card real visual contrast against the day's prose.
   - **Gotcha, generalizes beyond this route**: a descendant's negative-margin
     "bleed" (e.g. `.ox-card-directive` overhanging `.ox-content`'s own
     gutter) is clipped at `.ox-content`'s OWN border-box edge by its
     `overflow-x: hidden`, no matter how large the negative margin —
     padding never moves that edge, only the ancestor's own margin does.
     `.ox-card-host` (an `OxEditor` `className` modifier) works around this
     by widening `.ox-content`'s own border-box with a small negative
     margin + matching inward padding increase (so text position doesn't
     shift), giving the bleeding child a wider edge to land against.
   - **Done — every markdown view in the Vault and its public/card routes,
     including `ProjectView.tsx`.** `fruits_.vault.tsx` (folder README
     fallback, file-view fallback, `skills`/`graph` carve-outs, and the
     `project-n01` anchor README branch via `ProjectView`),
     `card.$fileId.tsx`, `public.file.$fileId.tsx`,
     `public.folder.$folderId.tsx`, and the Newspaper route
     (`fruits_.newspaper.$folderId.tsx`) all render via plain `OxRenderer`
     now. `ProjectView.tsx` dropped its whole `csv-table`/`gallery`/`svg`/
     `note` directive registry and `layout: "grid"`/per-block `size`
     support entirely, rather than porting it — an explicit product
     decision, not an oversight: legacy directives in old `project-n01`
     README content render as `OxRenderer`'s generic "unknown directive"
     marker unless rewritten. `project.server.ts`'s `resolveProjectManifest`
     was trimmed to match (`ResolvedProject` is now just `{ manifest, body
     }` — no more `files`/`folders`/`csvFields` directive resolution).
     A project's own `skills/PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md`
     files (see the `vault`/`phylog` skills) render via a real `<OxEditor>`
     (`SkillFileEditor` in `fruits_.vault.tsx`, mode `"editing"`/
     `"interacting"` per the existing write-permission check), since they
     never contained the legacy directive registry's directives at all.
7. **Done — `@` mentions** (`oxmarkdown/mention.ts`, `MentionPlugin.tsx`).
   See "`@` mentions" above. Next: a real Vault-backed `mentionSearch`
   (including real "create a page on the fly" behavior) and resolving a
   mention's `/humanId:path` href into real in-app navigation instead of a
   literal browser-followed `<a href>`.
8. **Done — cross-editor arrow navigation**, for when several independent
   `OxEditor`s are stacked and should feel like one continuous document
   (Daily Log Cards: each Card is its own file/`OxEditor` instance, not
   nested markdown — see the `vault` skill's Daily Log section). Wrap the
   stack in `oxmarkdown/OxEditorGroup.tsx`'s `<OxEditorGroup order={[...]}>`
   and give each `OxEditor` a matching `groupId`; ArrowDown/Up at an
   editor's edge jumps into the next/previous
   (`oxmarkdown/CrossEditorArrowPlugin.tsx`). Editing mode only; opt-in;
   each editor's document/undo history stays fully separate. The
   underlying machinery is also used internally by the Card/file-caption
   arrow flows (`CardEditorArrowPlugin.tsx`, `FileCaptionArrowPlugin.tsx`),
   but the real Daily Log route doesn't yet wrap its prose+Cards stack in
   an explicit `<OxEditorGroup>`.
9. **Done — minimum-rows padding**, so an Editing-mode document is always
   clickable anywhere within a minimum box. `oxmarkdown/MinRowsPlugin.tsx`
   tops the document up to a `minRows` prop (default `DEFAULT_MIN_EDITOR_ROWS
   = 4`, clamped via `normalizeMinRows`) with real empty `ParagraphNode`s —
   only ever adds, never removes. `.ox-editing-surface`'s `min-height`
   reads the SAME clamped value via an inline `--ox-min-rows` custom
   property so CSS and JS can't drift apart. Never leaks into saved
   markdown — `exportOxDocument` always trims wholly-blank trailing
   paragraphs first. A `::file{...}` caption uses `minRows={1}`.
10. **Done — the `::file{...}` interactable**, a built-in leaf directive
    (own row, no children) for an attached file: a 74×74px thumbnail
    offset into the gutter (`margin-left: calc(-1 * var(--ox-grid))`) plus
    a caption alongside it. `oxmarkdown/fileDirective.ts` holds the shared
    insertion logic (pure Lexical-tree code) and native-file-picker
    wrapper.
    - **Upload is real** via `OxEditor`'s `onUploadFile` prop
      (`(file: File) => Promise<{fileId, contentType}>`, `UploadFileFn` in
      `fileDirective.ts`) — `OxEditor` itself stays ignorant of
      vault/folder specifics, just calls this and writes the result back
      onto the same node (found again by key, since async time passes
      before the upload resolves). The Daily Log route's implementation
      posts to `POST /api/daily-log/upload`, resolving that day's own
      vault folder and marking `source: "daily_log"`/`date` (the same
      convention `isFileRefLocked` uses). Omitting `onUploadFile` falls
      back to filename-only, no-bytes-leave-the-browser behavior. A real
      upload failure sets `uploadError="1"` rather than looking stuck.
    - Once `fileId`/`contentType` land, the thumbnail renders as a real
      `<img src="/api/vault/view/:fileId">` (`FileDirectiveLayout` in
      `components/OxRenderer.tsx`) for image types; anything else keeps a
      placeholder box.
    - Reachable via the `/files` (or `/file`) slash command (gated by
      `allowFileAttachments`, inserts at the cursor's block) or a
      persistent "add file" link below the editor
      (`oxmarkdown/AddFileLinkPlugin.tsx`, gated by a separate
      `showAddFileLink` prop, always appends at the document's end). Both
      call directly into `$`-prefixed Lexical functions rather than
      opening a second nested `editor.update()` — a nested update queues
      instead of running immediately when already inside one (e.g. inside
      `SlashCommandPlugin`'s `runCommand`), which silently broke opening
      the file dialog synchronously from the trusted click.
    - The caption is a REAL, live nested `<OxEditor>` in Editing mode (the
      first use of the "leaf directive mounts a nested independent
      OxEditor" pattern later reused by `::card`), made possible by
      `oxmarkdown/OxEditorContext.tsx` — breaks what would otherwise be a
      circular import between `OxEditor.tsx` and `editingNodes.tsx` by
      having `OxEditor.tsx` provide itself as a context value. Confirmed
      safe to nest one live Lexical editor inside another's decorator —
      Lexical's own event system guards against double-handling a bubbled
      DOM event across editor boundaries.
    - The caption flows ArrowUp/ArrowDown into a sibling file's caption
      (`oxmarkdown/fileCaptionFlow.ts` + `FileCaptionArrowPlugin.tsx`, plus
      the reverse direction `FileDirectiveArrowPlugin.tsx`, mounted
      unconditionally on every Editing-mode `OxEditor`), falls through to
      the nearest outer content once sibling captions are exhausted, and
      double-Enter on an already-empty caption line "escapes" to the outer
      document instead of padding another blank row. Both directions use
      the nested-editor selection-clearing fix from "Key resolved
      decisions."
    - The static/Interacting-mode path renders the same caption as plain
      read-only markdown (`FileDirectiveLayout`/`FileDirectiveStatic` in
      `components/OxRenderer.tsx`) — no live editor when free-form typing
      isn't allowed anyway.
    - Bypasses the generic `DirectiveRegistry`/attrs-popover entirely (same
      category as task checkboxes — a built-in interactable, not a
      caller-registered directive).
    - The caption editor uses `.ox-no-gutter` (general-purpose modifier,
      `oxmarkdown.css`) to disable the left gutter band/marker glyphs, and
      a custom `placeholder` prop (`"add words"`).
    - After inserting, the first new file's caption gets focus
      automatically (`focusFileCaptionOnceMounted`, polling across a few
      frames since the nested editor's own mount isn't synchronous with
      the outer `editor.update()` returning).
    - The thumbnail sets `contentEditable={false}` on its own root so
      clicking it can't place a native caret (the caption's own nested
      `contenteditable="true"` region is unaffected, nested inside a
      `false` ancestor normally).
    - A `.circle-btn-red` `CircleButton` removes the whole directive on
      click, rendered only when Editing mode supplies `onRemove`. Lives
      OUTSIDE the row's flex layout (`position: absolute` against
      `.ox-file-directive`), sticking `--ox-grid` past the row's right
      edge to mirror the thumbnail's left overhang — only works because
      `.ox-content`'s `padding-right` is `--ox-grid` too (see Design
      language's gutter-markers note).
    - **Done — click-to-zoom modal**, `FileImageModal` (`OxRenderer.tsx`),
      shared by both rendering paths via `FileDirectiveLayout` itself
      (owns its own open/closed state, no per-caller wiring). Clicking an
      image thumbnail opens a `good-box`-panel modal on a dimmed backdrop
      (closes on Escape or a backdrop click); the SAME `caption` node
      (live nested `<OxEditor>` in Editing mode, plain rendered markdown
      otherwise) moves into the modal below the image while it's open —
      never rendered in both the inline row AND the modal at once, since
      two mounted copies of the same live caption editor would drift out
      of sync the moment either is typed in (each mounts independent
      Lexical state from the same initial `markdown` prop). Moving it
      costs a remount (loses cursor position, not content) on open/close,
      an accepted trade-off. Two-step zoom: opens "fit" (`object-fit:
      contain`, never upscales past the image's real size), and a further
      click on the image enlarges to true 100% (`canZoomFurther`, compares
      `naturalWidth`/`naturalHeight` against the fit-rendered
      `clientWidth`/`clientHeight`) — an image that was never scaled down
      to fit in the first place skips this second state entirely and just
      always renders at its real size, per product decision (never
      artificially upscale a small image, and don't offer a meaningless
      second zoom click).
    - `AddFileLinkPlugin.tsx`'s link is excluded
      (`:not(.ox-add-file-link)`) from `.ox-content`'s own
      `*:not(:first-child) { margin-top: var(--ox-grid) }` static-rhythm
      rule, which otherwise silently overrides its own smaller
      `margin-top` at equal specificity.
11. **Done — the `::card{file="..."}` interactable**, a built-in leaf
    directive marking where a Card appears in a day's flow. See the
    `vault` skill's "Cards" section for the vault-side data model
    (`dailyLog.server.ts`) — this entry covers OxMarkdown-side rendering.
    - Unlike a file's caption, a Card's content is never an attribute on
      this directive — it's a whole separate vault file, resolved from
      outside via `OxEditor`'s `resolveCard` prop
      (`oxmarkdown/cardDirective.ts`'s `CardResolver`), same spirit as
      `mentionSearch`/`onUploadFile`.
    - Reached via "Add a card" (`AddCardSection`, project chips filtered to
      projects without a card yet today) working at the plain mdast level
      (parse → append `::card{...}` → re-serialize) rather than through a
      live editor instance, since it's triggered from outside any
      `OxEditor` (a chip click). Optimistic-UI mechanics: see "Key resolved
      decisions."
    - Reuses `OxEditorContext` to mount its own nested `<OxEditor>` (whole
      document, not a short caption; `allowFileAttachments`/
      `showAddFileLink` both on). A new `UploadFileContext` threads the
      OUTER editor's own `onUploadFile` down so a Card's own attachments
      upload to the same place the outer document's do.
    - Renders differently per mode, all in `OxRenderer.tsx`'s
      `CardDirectiveStatic`/`CardDirectiveLayout` and
      `editingNodes.tsx`'s `OxDirectiveDecorator`: a real nested
      `<OxEditor>` in both Editing AND Interacting mode (a past day's card
      still needs working checkboxes/thumbnails), but plain static
      markdown (`OxStaticNodes`) with NO live interaction at all when
      there's no `interactive` context (e.g. a public unauthenticated
      view) — mounting a live editor there would let a checkbox toggle
      silently call `resolved.onChange` (a save) with nothing that should
      be saving.
    - Visually bleeds outward past `.ox-content`'s own gutters on both
      sides (same technique as `::file`'s thumbnail, here on both sides);
      `.good-box` fill/border; header row (project name, "open project →"
      link, remove button) + content slot. Ported from the deleted
      `daily-log-v2` mockup's `CardBox`.
    - Symmetric arrow-key flow in/out of a card via `oxmarkdown/cardFlow.ts`
      + `CardDirectiveArrowPlugin.tsx`/`CardEditorArrowPlugin.tsx`, same
      selection-clearing fix as the file-caption pair. **Known, deliberate
      scope line**: no sibling-card-to-sibling-card flow, no double-Enter
      escape gesture yet — can grow the same way `::file`'s flow did if a
      real need shows up.
    - **Deliberately out of scope**: cross-human projects as Card targets,
      and nested cards (a `::card{...}` inside another Card's content
      resolves to nothing — `resolveCard` isn't threaded that deep).
12. **Done — the Toggle List** (`:::toggle{collapsed="true"}`), a
    Notion-style collapsible title + body block, triggered by typing `> `
    at the start of a line (repurposed from blockquotes — see below).
    Motivating case: a generic replacement for a bespoke "release-item"
    directive in the Release Log (see the `vault` skill).
    - **Architecturally a real container `ElementNode`
      (`oxmarkdown/OxToggleNode.ts`), NOT a directive/decorator** — the one
      deliberate exception to "leaf directive, own row, no children" every
      other built-in interactable follows, sidestepping the
      directive/decorator system's "container content isn't independently
      editable" limitation for this one proven need (same reasoning that
      gave checklists their own `OxListItemNode`). Proven safe by the same
      pattern blockquotes already used.
    - **Markdown shape**: the node's own first child is always the title
      (any inline markdown, not a lossy `title="..."` attribute string);
      everything after is body content:
      ```
      :::toggle
      Release: **Sunny**

      - fence-line.jpg file put in [./gallery/fence-line.jpg](...)
      :::
      ```
      `collapsed="true"` only appears when true. Degrades gracefully for
      hand-edited/foreign markdown that doesn't follow the
      "first-child-is-title" convention (treated as body with a blank
      title, nothing lost).
    - `OxToggleNode`'s children are always `[OxToggleSummaryNode, ...body]`
      — the summary is a thin `ElementNode` subclass so
      rendering/CSS/keyboard behavior can target it specifically; always
      present as the first child (same "always a real clickable row"
      invariant `MinRowsPlugin`/`LeadingBlockGuardPlugin` use elsewhere).
    - **`> ` moved from blockquotes to the Toggle List** (a product
      decision — reads like Notion's own mnemonic). Blockquotes moved to
      `"` (literal double-quote + space) —
      `oxmarkdown/quoteTransformer.ts`/`toggleTransformer.ts` are
      trigger-`regExp`-only forks of `@lexical/markdown`'s default `QUOTE`
      transformer; `OxEditor.tsx`'s `OX_TRANSFORMERS` filters the
      library's own `QUOTE` out of `TRANSFORMERS` so the two don't
      conflict.
    - **Click-to-collapse/expand differs by rendering path, on purpose**:
      Editing mode (`oxmarkdown/OxTogglePlugin.tsx`) hit-tests a CSS
      `::before` pseudo-element's own computed width (same convention
      `OxChecklistPlugin.tsx` established), mirrored to the LEFT since the
      caret sits in the gutter before the title. Static/Interacting mode
      is a real native `<details>`/`<summary>` pair, needing zero JS — its
      collapse state is deliberately EPHEMERAL (native `open` state seeded
      from the saved attribute, not re-saved), unlike Editing mode's own
      persisted `OxToggleNode.__collapsed` field. Both paths suppress the
      native disclosure marker (`::-webkit-details-marker`/`::marker`)
      since only the static path's `<summary>` actually has one.
    - **Full keyboard-flow parity** (`OxTogglePlugin.tsx` unless noted):
      guarded from ever being the document's first line
      (`LeadingBlockGuardPlugin.tsx`, extended to cover `OxToggleNode` too,
      not just decorators); double-Enter on the body's last empty line
      escapes to the outer document (same idea as the file-caption escape,
      adapted for a multi-paragraph body); Backspace on a wholly empty
      toggle removes it outright; `OxToggleSummaryNode.insertNewAfter`
      reuses an existing empty next-sibling paragraph on Enter rather than
      always creating a new one (a real bug — creating an extra one broke
      the double-Enter-escape check, which requires the current empty
      paragraph to be the toggle's actual last child).
    - Lists (`- `/`* `/`+ `/`1. `) work inside a toggle's own body via
      `oxmarkdown/ToggleListPlugin.tsx` — see "Key resolved decisions" for
      why this needed a hand-rolled workaround rather than an
      `isShadowRoot` override.
13. **Done — a basic grid (`:::grid{columns="N"}` / `::col`), STATIC/
    Interacting-mode rendering only, by deliberate, documented design.**
    Motivating case: side-by-side layouts (image comparisons, small
    galleries of cells) with no live-editing need.
    - **Built directly into `renderDirective` (`components/OxRenderer.tsx`),
      NOT a caller-registered `DirectiveRegistry` entry** — a registry
      entry was tried first but rejected once cell-splitting needed the
      container's RAW child mdast nodes, which the `DirectiveRenderer`
      contract doesn't expose (it only ever hands back already-rendered
      `children: ReactNode`).
    - `::col` is a LEAF directive used as a flat cell-break marker inside
      `:::grid{...}`'s own children (`splitGridCells`); content before the
      first `::col` is always the first cell, so zero `::col` markers
      degrades to one full-width cell rather than erroring. `columns`
      defaults to the cell count (`clampGridColumns`, clamped `1..6`), only
      needing to be set to force a different count than the number of
      `::col` groups.
    - `.ox-grid-directive`/`.ox-grid-cell` (`oxmarkdown.css`): plain CSS
      Grid, `gap: var(--ox-grid)`, collapsing to one column below `640px`.
    - **Deliberately, explicitly NOT given an Editing-mode rendering** —
      `editingTransforms.ts`'s `convertBlock` has no `"grid"` case, so it
      falls through to the generic `$createOxDirectiveNode(node)`/"Unknown
      block" placeholder while editing. Nothing is lost: the mdast node
      round-trips losslessly through export regardless — confirmed via the
      three-leg testing convention below. Promote it the way Toggle List
      was promoted if live grid editing becomes a real need.
14. **Done — a basic gallery (`:::gallery{max-columns="N"}`), STATIC/
    Interacting-mode rendering only, same deliberate scope as Grid (13).**
    Purpose-built for photos, with an auto-computed column count instead
    of an explicit `columns` attribute.
    - Same built-in-vs-registry reasoning as Grid (needs raw child mdast
      nodes, recursively, to find every `image` node).
    - **No new per-photo syntax** — children are ordinary `![alt](url)`
      images; `collectGalleryImages` walks descendants recursively
      (`collectGalleryImages`), so a renderer that doesn't understand
      `gallery` at all still shows every photo, just stacked.
    - Column count: 1 photo → 1 column, 2–6 → 2, 7+ → 3
      (`computeGalleryColumns`'s `auto`), then capped by `max-columns`
      (default AND hard cap `GALLERY_COLUMN_CAP = 3` — unlike Grid's `6`
      sanity ceiling, this is a real current product constraint; there's
      no way to get 4+ columns today). Final count is `min(auto,
      clamp(max-columns, 1, 3))`.
    - `.ox-gallery-directive`/`.ox-gallery-item` (`oxmarkdown.css`): CSS
      Grid, square `aspect-ratio: 1 / 1` tiles, `alt` text doubling as an
      optional `<figcaption>`.
    - **Deliberately, explicitly NOT given an Editing-mode rendering** —
      identical mechanism and reasoning to Grid.
15. **Done — a folder-based gallery (`::gallery{folder="..." title="..."}`),
    the LEAF-directive sibling of 14 above, same name, distinguished by
    mdast node TYPE (`leafDirective` vs `containerDirective`), same
    deliberate STATIC/Interacting-mode-only scope.** Added after
    discovering PhyLog's capture stage (see the `phylog` skill) had been
    instructing its AI to write exactly this syntax the whole time, under
    the mistaken assumption it was an MdxEditor-only directive being
    retired along with everything else — it wasn't; OxMarkdown just didn't
    have it yet.
    - Resolved from OUTSIDE via `resolveGalleryFolder`
      (`GalleryFolderResolver`, `oxmarkdown-core/galleryDirective.ts`),
      same "resolved externally" shape as `::card{file="..."}`'s
      `CardResolver` — threaded through `OxRendererProps`/
      `OxTreeRendererProps`/`RenderCtx`/`OxEditorProps` (Interacting mode
      only, mirroring `resolveCard`'s own threading) exactly in parallel.
    - `project.server.ts`'s `resolveProjectManifest` is the one real
      implementation today: scans the body for `::gallery{folder="..."}`
      occurrences via `nopalDirectives.ts`'s (still-alive)
      `findLeafDirectiveOccurrences`, resolves each named folder's direct
      children images, returns them as `ResolvedProject.galleryFolders`.
      `ProjectView.tsx` closes over that map to build the resolver it
      hands `OxRenderer`.
    - Shares `renderGalleryGrid`/`computeGalleryColumns`/
      `.ox-gallery-directive`/`.ox-gallery-item` with the container form —
      same visual result either way, they only differ in where `images`
      came from. Adds an optional `title` attribute (rendered via the
      existing generic `.ox-directive-title` class) since a named-folder
      reference has no natural place to write a heading inline the way the
      container form does (a heading just above `:::gallery{...}` in the
      surrounding markdown).
    - Renders nothing at all (not an empty box, not an error marker) when
      `resolveGalleryFolder` is omitted, the name doesn't resolve, or it
      resolves to zero images.

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
could actually contain) ship twice before being caught by hand-testing — a
decorator/glyph can render something plausible that export can't
reproduce, or vice versa, and nothing catches it unless both are checked
side by side, every time.

## Related skills

- `mdx-editor` — the current, live system this replaces. Keep both skills
  in sync as work progresses; concepts move from "current" to "carried
  over" or get explicitly superseded here.
