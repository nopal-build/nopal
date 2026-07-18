---
name: oxmarkdown
description: Vision, syntax, and design-language spec for OxMarkdown (OxRenderer + OxEditor), the planned successor to MdxEditor/MdxRenderer. Use when discussing or building the new nopal editor/renderer, its markdown conventions (generic directives, @ mentions, slash commands), or its visual design (dot grid, typography, mobile UX). Also consult the mdx-editor skill for what's carried over from the current system.
---

# OxMarkdown

**Status: design vision, not yet built.** The live system today is MdxEditor
(`MdxRenderer`, `MdxEditorView`, `MdxEditorWorkable`, `MdxEditorEditable` —
see the `mdx-editor` skill). OxMarkdown is its planned successor: a new
editor (`OxEditor`) and renderer (`OxRenderer`) pair, sharing the umbrella
name `OxMarkdown`. This skill is a living design doc — read AND update it as
thinking evolves, the same way `mdx-editor`'s skill should be kept current
for the system it describes. Before writing any `OxEditor`/`OxRenderer`
code, re-read both skills; don't start from scratch from memory.

One directive-syntax feature described below is **already implemented** on
top of the *current* MdxEditor as a pragmatic bridge — see "What's already
shipped" — so the migration path isn't all-at-once.

## Why replace MdxEditor at all

Not because it's broken — because its core parser has real structural
limits that show up the moment you push on it:

- `nopalEditorState.ts` splits a document into nodes by `\n\n`-delimited
  paragraph (`ProseNode`), and each one is rendered by an **independent**
  `<ReactMarkdown>` call. There is no single AST for the whole document.
- Consequence: a container-style block that should wrap multiple paragraphs
  (with blank lines inside) structurally can't work without teaching the
  core paragraph-splitting loop to be block-aware — real surgery on code
  that's about to be replaced anyway. See the "KNOWN LIMITATION" note in
  `webapp/app/util/nopalDirectives.ts`.
- Everything non-standard (`[[wiki-links]]`, `![[embeds]]`, CSV chips, and
  now generic directives) is bolted on via regex string-preprocessing before
  handing text to `react-markdown`, not real AST nodes. It works, but it's a
  ceiling, not a foundation.

OxMarkdown should start from a real block-level document model (however
minimal) so directives, mentions, and future block kinds are first-class
nodes, not regex placeholders.

## Naming

- **OxMarkdown** — the umbrella: syntax conventions + design language.
- **OxRenderer** — fully static rendering, no interaction engine at all
  (replaces `MdxRenderer`'s static-use-cases, e.g. SSR'd/public pages that
  never need selection, tooltips, or checkbox toggling).
- **OxEditor** — **one** component covering both modes via a `mode`
  prop (`"interacting"` / `"editing"`), replacing the old *three* separate
  components (`MdxEditorClient` / `MdxEditorWorkable` / `MdxEditorEditable`)
  with one. This falls directly out of Editing being a strict superset of
  Interacting (see below) — there's no longer a reason for them to be
  different components, just a different capability level of the same one.

## Modes: Interacting, and Editing

Simplified down from MdxEditor's three-tier View / Workable / Editable split
to **two** modes. Editing is a strict superset of Interacting — the editor
is "interacting, plus":

- **Interacting** — you can select interactables and trigger their
  built-in actions. Some of those actions DO modify the document — e.g.
  checking a checkbox rewrites `[ ]` → `[x]` in the underlying markdown —
  but only as a well-defined, structured operation belonging to that
  interactable. What Interacting mode does NOT allow is free-form
  type-editing: placing a caret in plain prose and typing or deleting
  arbitrary text.
- **Editing** ("interacting AND editing") — everything Interacting allows,
  PLUS free-form text editing: typing/deleting anywhere, inserting new
  interactables via slash commands, etc.

This fully replaces "Workable" — it was never really a third *mode*, it was
"Interacting" with one specific interactable kind (tasks/references)
enabled. That generalizes cleanly under the new model: **Interacting never
means every interactable is available to every viewer.** Which
interactables are enabled vs. disabled/hidden for a given viewer is a
per-interactable, permission-driven decision, not a mode switch. A
logged-out public viewer might get zero enabled interactables (what used to
be called "View"); a signed-in collaborator might get task checkboxes and
`@`-mentions enabled but not directive-editing popovers; the owner gets
everything. It's the same rendered document throughout — only which
interactables respond to input changes.

## Interactables

An **interactable** is any rendered unit in the document that isn't plain
flowing text — a discrete, selectable element with its own behavior,
produced by parsing a specific bit of markdown syntax. This is the
unifying concept behind what used to be separate special cases in
MdxRenderer: `@`-mentions, directives (`::name{...}`, `:::name{...}`,
`:name{...}` — "remark items"), and task checkboxes (`[ ]`/`[x]`) are all
interactables. (A csv-key chip is a specific *kind* of text-directive
interactable, not a separate category from directives generally.)

### The interaction model — select, then act (usually at once)

Every interactable can be selected the same way, regardless of kind.
Arrow-key navigation and a first backspace onto it are pure selection —
they never also act:

1. **Getting selected.**
   - Arrow-key navigation onto it, from either side — selects only, never
     placing a bare text caret inside it.
   - Backspacing onto it from the right — the *first* backspace selects it;
     it does not delete or otherwise act.
   - Clicking or tapping it — always selects it, but for some interactable
     kinds the *same* click/tap also fires that kind's default action in
     one motion. Selection still conceptually happens either way; it just
     isn't always a separate, later step when the input method is a
     click/tap.
2. **Acting on a selected interactable** — depends on both the mode and the
   interactable kind:
   - A task checkbox: a single click/tap both selects it AND toggles it —
     one motion, the same as an ordinary HTML checkbox. Once selected (by
     any method — arrow, backspace, or click), Space or Tab also toggles
     it as a separate step.
   - An `@mention`: click/tap selects it and shows a tooltip with the full
     resolved path/target — useful when the visible label alone is
     ambiguous or generic.
   - A directive ("remark item"): click/tap selects it and shows a tooltip,
     or a full popover of options to adjust its attributes — e.g. a
     `::gallery{...}` block's popover might let you change
     `folder`/`title`/`size` without hand-editing the directive text.
   - **Backspace again**, once already selected (Editing mode only) —
     *reverts* the interactable to the raw source text it came from, in
     place, as plain editable text. This is un-rendering, not deletion — a
     further backspace after that behaves like ordinary character
     deletion, because by then it's just text again. This always works,
     for any interactable, because markdown is the only source of truth
     (see below): every interactable's rendered form has an exact
     corresponding raw-text span to fall back to, regardless of whether it
     was typed, pasted, inserted via a slash command, or loaded from a file
     that was never "typed" in this editing session at all. If nothing
     changes before deselecting, it simply re-parses back into the same
     interactable — no functional round-trip loss.
   - **Delete (forward-delete), once already selected** — fully removes
     the interactable outright. Unlike Backspace, there's no intermediate
     "revert to raw text" step; recovering from an accidental delete relies
     on ordinary undo. Deliberately asymmetric with Backspace — Delete
     already reads as more final/decisive in ordinary text editing, so this
     matches that expectation rather than forcing the two keys to mirror
     each other.

### Range selection is not the same as single-interactable selection

Everything above describes selecting exactly **one** interactable on
purpose (arrow-onto, click/tap, or backspace/delete-onto it specifically).
A **range** selection — Shift+arrow-key navigation, click-drag, etc. — is
different: any interactable caught inside that range counts as a single
atomic "character" for the purposes of the selection, nothing more.
Deleting a range deletes everything inside it outright — no revert-to-text
step, no tooltip, no popover. The whole select-then-act model above only
applies when an interactable is the *exact, sole* target of the selection,
not when it's incidentally swept up inside a larger range.

## What else carries over from MdxEditor unchanged

Pull these concepts forward as-is — they're not being reconsidered:

- **Markdown is the only saved format.** The editor always saves to plain
  markdown; everything rich (chips, embeds, directive blocks) is an
  *interpretation* of that markdown at render time, never a divergent
  internal format. Anything OxMarkdown adds must still degrade to plain,
  readable markdown when opened elsewhere (Obsidian, GitHub, a bare text
  editor) — this is the same principle that shaped generic directives (see
  below) over a frontmatter block array.
- **Dynamic content references** — linking to typed content (a CSV
  key/value pair, a vault file, a folder of images) and rendering it richly
  inline, rather than just as a link. Directives are the new, general
  mechanism for this (see below); csv-key chips are the first concrete case.

## What's already shipped (the bridge)

Generic directives — inspired by the `remark-directive` / CommonMark
directives proposal — are implemented **today**, on the current
MdxRenderer, as the extension mechanism for typed blocks:

```
:name{attrs}        text directive       — inline,  e.g. :csv-key{key="location"}
::name{attrs}       leaf directive       — block, own line, no children
:::name{attrs}      container directive — wraps nested markdown
content
:::
```

- Implementation: `webapp/app/util/nopalDirectives.ts` (parsing, both forms
  used client + server), wired into `webapp/app/components/MdxRenderer.tsx`
  (rendering) and `webapp/app/data/project.server.ts` (server-side resolution
  of `file=`/`folder=` attributes for the Vault's project rollup views —
  see the `vault` skill's "Projects" section and `ProjectView.tsx`).
- It's a **hand-rolled regex preprocessor**, not the real `remark-directive`
  package — same spirit as the pre-existing `[[wiki-link]]` preprocessing,
  chosen to avoid a remark/unified dependency inside the old per-paragraph
  pipeline. OxRenderer should implement the same *syntax* against a real
  parser/AST instead, which also lifts the container-directive
  single-paragraph limitation.
- `csv-key` (the old, disliked `[key]` bracket chip syntax) has been fully
  retired in favor of `:csv-key{key="..."}`. This is the template for how
  new conventions should replace old ones going forward: build the
  primitive, prove it in one real feature end-to-end, then delete the old
  path once nothing depends on it — don't keep both indefinitely "for
  compatibility" unless something real is actually depending on the old one.

## What's new and NOT yet implemented (design targets for OxEditor)

### `@` mentions replace `[[wiki-links]]`

Zed's `@`-reference pattern should replace the current `[[double-bracket]]`
wiki-link/embed syntax everywhere. Rationale:

- `[` and `]` require a shift/symbols-keyboard tap on mobile — twice, for
  `[[`. `@` is a single tap and exists on the primary mobile keyboard layer.
- `@` reads naturally as "at" in speech-to-text dictation; `[[` doesn't map
  to speech at all.
- It's a pattern people already have muscle memory for from Zed, Slack,
  Notion, GitHub, etc. — least-surprise, not inventing new conventions where
  an established one already fits.

Open question to resolve before implementing: `[[link]]` and `![[embed]]`
today are two distinct affordances (link vs. inline-render). `@` naturally
covers the "reference/link" case (`@Some Page`); embeds need either a
second, still-ergonomic prefix, or should become a slash-command-inserted
directive instead of a punctuation convention at all (e.g. `::embed{ref="Some Page"}`,
reusing the directive mechanism rather than adding a second punctuation
scheme). Decide this before touching `resolveWikiLink`/`EmbedCard`.

### `/` slash commands — an editing affordance, not a saved syntax

Typing `/` should open a menu (templates / functions / block kinds) for
*inserting* things — directive blocks (`/table` → `::csv-table{...}`),
`@`-mentions, maybe formatting shortcuts. Critical distinction: **`/` never
appears in saved markdown.** It's purely how OxEditor helps you type the
real syntax (directives, `@`-mentions) faster and more discoverably —
especially valuable on mobile, where remembering `::name{attrs}` syntax by
hand is unreasonable but browsing a menu isn't. Treat it as UI sugar layered
on top of the syntax in this doc, not a fourth syntax to design.

## Design principle behind all of the above

Ease of typing/input is a first-class design constraint, not a nice-to-have
— on par with correctness. Obsidian and Zed are the reference points: both
are "easy to use" specifically because they minimize friction between having
a thought and getting it captured (fast fuzzy-find, low-punctuation syntax,
keyboard-first but not keyboard-*only*). Every syntax decision here should be
weighed against "how does this feel to type on a phone, one-handed, in a
hurry" as much as "is this a clean file format." Lean on established
conventions (front matter, directives, `@`-mentions) rather than inventing
new punctuation, *unless* ease-of-input clearly demands otherwise.

## Design language

The dot-grid visual identity is already implemented for MdxEditor
(`webapp/app/styles/mdxeditor.css`, `.nopal-content`) — carry it forward
as-is, it's confirmed working in both light and dark mode (see the
`dark-mode-review` skill to re-verify after any change):

- **41×41px dot grid background**, behind all content:
  ```css
  background-image: radial-gradient(var(--moon) 1px, transparent 0);
  background-size: 41px 41px;
  ```
  Dark mode swaps the dot color to `var(--dark-midground)`.
- **Vertical rhythm locked to the grid, exactly.** Every block-level element's
  `line-height` is `41px` — one dot cell — not an approximation:
  `h1, h2, h3, blockquote, p, ul, ol { line-height: 41px }`. Headings add
  whole-cell top margins: `h1`/`h2` → `margin-top: 82px` (2 cells), `h3` →
  `margin-top: 41px` (1 cell). Every element's height is an exact multiple
  of 41px.
- **Gutter markers** — `#` / `##` / `###` / `>` render as absolutely
  positioned, low-opacity, monospace pseudo-elements to the left of headings
  and blockquotes (`left: -38px`), echoing the raw markdown syntax next to
  its rendered form — a permanent, ambient reminder of "this is markdown,"
  Typewriter-margin flavored.
- **Color tokens** (`webapp/app/styles/root.css`): `--purple` (`#3f2b46`,
  primary text), `--purple-light` (`#7f5b8b`, accents/headings), `--moon`
  (`#c4c6fc`, light-mode dot color), `--text-subtle`; full dark-mode
  counterparts via `prefers-color-scheme`, no in-app toggle.

### TODO — typewriter font

Explore switching body copy to a monospace/typewriter-style font. Knowing a
fixed per-character width unlocks things a proportional font can't (precise
gutter/column alignment, maybe literal character-grid layouts echoing the
dot grid horizontally as well as vertically). Not decided — needs a real
visual pass (try it, screenshot both color schemes, judge legibility at body
text sizes) before committing.

## Open TODOs — deliberately unresolved, review before building

1. **Foundation for Editing mode — RESOLVED: trimmed Lexical.** Backed by
   two real spikes (both built, verified with real clicks/keypresses, then
   deleted per the temp-code convention — findings below are what survive):
   - **Lexical isn't used everywhere today.** Only the full Editing surface
     (`MdxEditorClient`/`MdxEditorEditable`) is built on `@mdxeditor/editor`
     (Lexical). Interacting — today's View + Workable, and now OxEditor's
     Interacting mode too — is entirely hand-rolled, zero Lexical. So this
     decision only ever affected Editing mode specifically.
   - **Prototype A — trimmed Lexical, real measurement.** Built one
     interactable (a decorator node checkbox) with select-as-unit and
     backspace-to-revert on a minimal config (`@lexical/react` plain-text +
     history + node-selection only — no rich-text, list, link, CodeMirror,
     Sandpack, Radix, or table plugin). Production build showed the shared
     Lexical-core-plus-React-bindings chunk
     (`useLexicalNodeSelection.prod-*.js`) at **144 KB raw / 47.9 KB
     gzipped**, with the spike's *own* custom-node code on top of it at just
     **7.4 KB raw / 2.9 KB gzipped**. That core chunk is already shared with
     today's `MdxEditorEditable` — it's not new weight during migration, and
     it's the *only* Lexical weight `OxEditor` would carry once the old fat
     config is fully retired.
   - **Where the old 361 KB (now measured at 287 KB gzip, build has since
     changed) actually goes**: confirmed directly — `MdxEditorEditable`'s own
     chunk bundles CodeMirror 6, Sandpack, Radix, the table plugin, and the
     link-dialog/frontmatter form libraries *inline*, separately from the
     144 KB core-chunk above. None of that is Lexical-the-engine's cost; it's
     all plugins/UI nopal doesn't visually use. A trimmed config sheds it
     entirely rather than needing to "shrink" it.
   - **Prototype B — from-scratch `<textarea>`, real measurement.**
     Implemented the identical interactable's behavior — arrow-key-onto
     selects a `[ ]`/`[x]` token as a unit, arrow-past lands the caret
     cleanly on the far side, first Backspace-approaching-from-the-right
     selects instead of deleting a character, second Backspace deletes the
     selected token — entirely via `selectionStart`/`selectionEnd`
     manipulation in a `keydown` handler, no library. Verified live with
     Playwright: every step worked exactly as designed. **This part of the
     interactables model is not hard to hand-roll.**
   - **Where Prototype B breaks down — the actual deciding factor**: a
     `<textarea>` can only ever display its own literal text content. There
     is no way to render an actual checkbox glyph, bold/italic, a directive
     pill, or the dot grid *inside* the input itself — `[ ]` shown selected
     is still literally the three characters `[`, ` `, `]`, in the textarea's
     one uniform font. "Revert to raw text" has no distinct meaning here
     either, because raw text is all that's ever shown — the two-step
     Backspace model degrades to plain select-then-delete. Getting real
     rich rendering on top of a textarea would require a second, absolutely-
     positioned overlay layer, kept pixel-perfectly in sync with the
     textarea's scroll position, line-wrapping, and selection on every
     keystroke — which is not a shortcut around contentEditable's hard
     parts, it's a *reimplementation* of them, split awkwardly across two
     DOM layers that both have to agree. That's more risk than
     contentEditable directly, not less.
   - **Conclusion: trimmed Lexical.** The interactables model itself is easy
     either way — that was never the deciding factor. What decides it is
     that OxMarkdown's whole design language (real checkbox glyphs,
     directive pills/badges, the dot grid, inline formatting) requires
     actually rendering non-text UI inline with text, which is precisely
     what contentEditable-based editors exist to do and precisely what a
     textarea structurally cannot do. Lexical's mobile/IME/selection
     handling for contentEditable is the genuinely hard, well-trodden
     problem (why Lexical/ProseMirror/Slate exist at all) — a trimmed
     config gets that for a real, now-measured ~48 KB gzip, not the ~287 KB
     the fat config implied.
   - **Follow-up on "imperfect" existing plugins — still open, not blocking**:
     Gerald's read after this spike is that the existing custom Lexical
     plugins (`wikiLinkPlugin.tsx`, `csvRefPlugin.tsx`, `refPopoverPlugin.tsx`)
     weren't hard to build, just imperfect — consistent with what the spike
     found too (getting a decorator node's happy path working was quick;
     getting Backspace to *fully* suppress native contentEditable behavior
     needed `event.preventDefault()` plus `COMMAND_PRIORITY_CRITICAL`, or
     text silently corrupted). Read as "easy to get 80% working, real care
     needed for the last 20%" rather than a Lexical-specific flaw — worth
     keeping in mind as a real, recurring cost while building step 4 (full
     Editing mode), not a one-time toll paid by this spike alone.
2. **Mobile UX** — some decisions made below, but explicitly flagged for
   active review once real development starts: this is true of the whole
   interactables model to some degree, but mobile specifically is worth
   calling out again — how select/act/revert/quick-actions actually feel
   together won't be fully known until it's built and used on a real
   device.
   - **Popovers/menus: always full-width, always bottom-anchored.** Any
     popover or menu on mobile — the slash-command menu, an `@`-mention
     picker, a directive's attribute-editing popover — renders as a
     full-width sheet pinned to the bottom of the screen, consistently,
     rather than a floating dropdown positioned near the caret. One
     predictable location beats a contextually-positioned one that risks
     getting clipped by or fighting with the on-screen keyboard.
   - **Tap targets sized to the grid, on purpose.** The 41px dot grid isn't
     just visual — use it for touch target sizing too. An interactable's
     tappable area should be its *hot* target (e.g. ~35×35px) plus enough
     margin to round out to a full 41px grid cell, so the effective tap
     target is always a whole grid unit even when the visible glyph is
     smaller.
   - **Discoverability via a persistent quick-actions bar**, not by relying
     on users to type trigger characters from memory: `@`, `[ ]`, `/`, and
     `#` as always-visible quick-action buttons (e.g. an accessory bar
     above the keyboard) — covering mentions, tasks, the slash-command menu
     itself, and headings. Typing the actual characters should still work
     for anyone who prefers it; the bar is a discoverability aid, not a
     replacement.
3. **Stop splitting on `\n\n` — decided: don't. Plan below.**
   - **Best-guess rationale for why it's like this today** (no comment in
     the code states this outright, so treat as inferred, not confirmed):
     `nopalEditorState.ts` only needs to special-case the couple of things
     that must become interactive React components — task groups and image
     placement tokens — everything else ("prose") is handed to
     `react-markdown` as a raw string and parsed there. Splitting the whole
     document into `\n\n`-paragraphs first was almost certainly the cheap
     way to find "is this paragraph a task list?" with a regex, without
     writing a real block-level markdown parser (nested lists, lazy
     continuation lines, code-fence boundaries, etc. are genuinely fiddly
     to get right by hand — that's the actual complexity CommonMark spends
     most of its spec on). Whatever the original reasoning, it doesn't hold
     up as a reason to keep doing it in a from-scratch build.
   - **The plan**: don't hand-split the document at all — parse it ONCE
     into a real markdown AST (mdast) via `mdast-util-from-markdown` +
     micromark, and make that real nested tree the document model, not a
     flat list of paragraph strings. Blocks nest structurally (a container
     directive's children are just its real AST children, blank lines and
     all) instead of being reconstructed from independently-parsed chunks
     — this is what actually fixes the multi-paragraph container problem,
     not a bigger regex.
   - **This is closer to free than it sounds**: `mdast-util-directive` and
     `micromark-extension-directive` — the real, spec-compliant
     implementation of the exact generic-directives syntax we hand-rolled
     in `nopalDirectives.ts` — are *already* sitting in `node_modules`,
     pulled in transitively by `@mdxeditor/editor` but never imported by
     nopal's own code. Same story for `mdast-util-frontmatter` /
     `micromark-extension-frontmatter` (we hand-rolled a frontmatter regex
     in `project.types.ts` too). Adopting the real packages directly, now
     that we know the exact shape we want, costs no new dependency and
     buys real spec compliance (proper attribute escaping, nested content,
     multiline handling) we didn't build by hand.
   - Task-list items and interactable mentions become recognized node
     *types* within that real tree (GFM task-list extension for the
     former; a small custom micromark/mdast extension for `@`-mentions),
     not separately regex-matched substrings layered on top.
4. **`@`-embed syntax — leaning resolved**: don't give embedding its own
   punctuation at all. Embedding is likely uncommon enough not to deserve
   a memorized second syntax next to `@mention` — fold it into the
   directive mechanism instead (e.g. `::embed{ref="Some Page"}`), and reach
   it through the interaction model rather than typing: an `@mention`
   interactable's popover gets an "Embed" action that rewrites it in place
   into the directive form, and the embed directive's popover gets a
   symmetric "Convert to link" action that reverts it back to a plain
   `@mention`. This is a nice general pattern worth reusing elsewhere: when
   two forms are just different presentations of the same reference, make
   converting between them an *interaction*, not a second syntax to
   remember.
5. **Nested interactables inside a container directive — decided (default)**:
   arrow-key navigation moves between interactables *nested inside* a
   container individually, by default — with a real mdast tree as the
   model (see TODO 3), that's the natural behavior anyway, not something
   extra to build. Treating a specific directive kind as fully atomic
   (opaque, select-all-or-nothing) is left as a per-kind exception to add
   later, only if a real use case actually needs it — not designed for
   preemptively.
6. **Forward-Delete vs. Backspace — decided: NOT symmetric.** Backspace
   (approaching from the right) selects, then *reverts to raw text* on the
   second press — a soft, reversible step. Delete (approaching from the
   left) selects, then *fully removes* the interactable on the second
   press — no revert-to-text step. Reasoning: a full delete can always be
   recovered with ordinary undo, and that feels like the more natural
   behavior for the Delete key specifically — Delete already reads as more
   decisive/final than Backspace in ordinary text editing, so matching that
   expectation beats forcing artificial symmetry between the two keys.
7. **Block-level vs. inline interactable entry — decided: no distinction.**
   Entering an interactable selects it as a whole unit regardless of how
   the cursor arrives — Up, Down, Left, Right, or any other navigation
   means all behave the same way. One remaining detail, not blocking: the
   *visual* treatment of a selected block-level directive (e.g. a whole
   `::gallery{...}`) vs. a selected inline one (an `@mention` chip) will
   likely still look different just because their shapes differ — that's
   an implementation/visual-design detail to work out while building, not
   an open interaction-model question anymore.
8. **Keyboard focus model in Interacting mode — decided: Tab/Shift+Tab.**
   No roaming text caret in Interacting mode; keyboard focus moves directly
   between enabled interactables via Tab/Shift+Tab, standard focus-order
   navigation. Matches ordinary web accessibility expectations (tabbing
   between links/controls on a page you can't edit).
9. **Undo/revert granularity — DONE, verified against real behavior, one
   claim corrected.** Reverting an interactable is always one atomic undo
   step (confirmed in step 4: a directive's Backspace-revert undoes in a
   single press). For ordinary typed text, `@lexical/history` (already
   wired in via `<HistoryPlugin />`) handles coalescing automatically —
   verified directly with real keystrokes, not assumed:
   - **A continuous typing burst is one undo step, including across word
     and punctuation boundaries** — typing `"FOO BAR"` or `"foo. bar"`
     with no pause undoes FULLY in a single press, not one press per word.
     This corrects the original claim above (word/punctuation boundaries
     alone do NOT split a group) — the actual mechanism is time/pause-
     based, not boundary-based, at least for Lexical's default history.
   - **A real pause, or a non-typing action, DOES start a new group** —
     confirmed separately: typing `"ABC"`, pausing over a second, then
     typing `"DEF"` undoes as two steps (DEF first, then ABC); typing
     `"AAA"`, pressing an arrow key, then typing `"BBB"` with NO pause
     still undoes as two steps (arrow-key navigation alone breaks the
     group, same as a real pause would).
   - **Verdict: no further work needed.** One continuous typing burst as
     one undo step is standard, expected editor behavior (matches Zed,
     VS Code, and others closely enough) — the original design intent
     ("don't undo one keystroke at a time") is fully met; the doc just had
     the specific mechanism half-wrong. Implementation-wise this remains a
     solved problem via real prior art (Lexical's own `@lexical/history`;
     CodeMirror 6's and ProseMirror's history modules are open-source
     references too if a fully custom editor is ever built) — came for
     free by wiring up `<HistoryPlugin />` in step 4, not a separate build.
10. **Extra blank lines between paragraphs — DONE, in two real passes, not
    one.** First pass only fixed `OxRenderer`'s static path (spacer `<div>`s
    inserted via `renderBlockNodes`, using `position.start.line`/`end.line`
    gaps — `oxmarkdown/document.ts`'s `countExtraBlankLines`, shared so
    every consumer agrees). That turned out to be incomplete — caught by
    Gerald testing Editing mode directly, not by us finding it first:
    - **Editing-mode import needed the same fix independently** — the
      static-renderer fix never touched `importOxDocument`, so opening ANY
      existing markdown in Editing mode still collapsed every gap to zero,
      regardless of source. Fixed with `convertBlockList` (import) and
      `exportBlockList` (export), both in `editingTransforms.ts`, mirroring
      the static renderer's gap detection.
    - **Found something deeper while fixing that: representing a gap as an
      empty `ParagraphNode` is the WRONG data model, not just unfinished.**
      CommonMark has no "blank line" node type at all — blank lines are
      pure whitespace between blocks, nothing more. A real Lexical element
      always gets its own default 1-blank-line join on EACH side when
      serialized, so one empty paragraph between two real blocks came out
      as 3 blank lines, not 1 (confirmed directly) — and no arrangement of
      empty paragraphs can ever produce an EVEN blank-line count (always
      2K+1 for K empty paragraphs). Fixed properly with a dedicated
      `OxBlankLinesNode` (`editingNodes.tsx`) that carries the count as
      plain data and is never emitted as a real mdast node — export turns
      it into a custom `join` function passed to `serializeOxDocument`,
      `mdast-util-to-markdown`'s own real mechanism for controlling exactly
      how many blank lines separate two specific siblings. Verified with
      exact round-trips (3 blank lines in → 3 out, including nested inside
      a blockquote), not just "looks right."
    - **Found a THIRD thing while verifying the fix visually: an ordinary
      SINGLE blank line showed zero visual gap, everywhere, always.**
      `oxmarkdown.css` gives paragraphs/lists `margin: 0` deliberately (each
      block's own `line-height` was assumed to carry rhythm on its own) —
      but that means the spacer mechanism above (which only ever adds
      space for EXTRA blank lines beyond the default one) had nothing to
      build on for the ordinary, default case. Every other markdown
      renderer shows SOME gap for a plain one-blank-line paragraph break;
      this one showed none. Fixed with a CSS rule giving every block-level
      sibling (past the first) one grid unit of margin-top by default —
      `.ox-content > *:not(:first-child)`, plus the same for a blockquote's
      children and for `.ox-editing-surface` specifically (Editing mode's
      real content sits two DOM levels below `.ox-content`, not as its
      direct child, so the first selector alone didn't reach it — confirmed
      by checking computed `margin-top`, not assumed). `:not(:first-child)`
      instead of the equivalent `* + *` on purpose: a plain `* + *` has
      LOWER specificity than the existing `margin: 0` rules and silently
      lost to them (confirmed directly — computed `margin-top` was still
      `0px` before this fix); `:not(:first-child)` carries a class's worth
      of specificity, enough to win.
    - **Known, deliberate gap, not fixed**: a container directive's own
      children still rely on whatever wrapper its registry renderer
      provides for this default margin — there's no single reliable CSS
      selector for arbitrary caller-authored markup. Revisit if a real
      directive with multi-block content actually needs it.

## Build plan — where to start

Sequenced by risk and dependency, not by
"importance" — the goal is to defer the one genuinely open, high-risk
decision (TODO 1) until it's the only thing left blocking progress, since
everything else can move without it.

**Key insight driving the order**: TODO 1 (Lexical vs. custom) only
blocks *Editing* mode (free-form typing). It does not block *Interacting*
mode at all — and Interacting mode is exactly what today's Workable
already proves is buildable with zero Lexical. So the new document model,
directives, mentions, checkboxes, and the whole select-then-act
interactables model can all be built and shipped for real, in Interacting
mode, before TODO 1 needs an answer.

1. **DONE — Real document model (`OxRenderer`)**. `oxmarkdown/document.ts`
   (parse/serialize, no React import) + `OxRenderer`/`OxTreeRenderer`
   (`components/OxRenderer.tsx`) + a themable `.ox-content` stylesheet
   (`styles/oxmarkdown.css`, tokens in `oxmarkdown/theme.ts`). Verified live:
   a container directive wrapping a blank line round-trips correctly (the
   exact case that broke the old regex bridge). Found and fixed a real bug
   along the way — gutter markers/bullets/list-numbers need `.ox-content`
   to reserve its own left padding, not borrow a wrapper's. One confirmed
   regression, deliberately deferred: extra blank lines between paragraphs
   don't produce extra space (CommonMark discards the count) — see the
   decision log at `/fruits/styles/oxmarkdown` for the fix path. Demo/decision
   log: `routes/fruits_.styles_.oxmarkdown.tsx`, updated every step since.
2. **DONE — Interactables + Interacting-mode `OxEditor`, on `OxRenderer`**.
   No Lexical needed, as predicted. Built: `oxmarkdown/interactive.ts` (the
   `OxInteractive` contract), `OxTreeRenderer` (extracted from `OxRenderer`
   so `OxEditor` can mutate the exact tree it renders, not a fresh
   re-parse), and `components/OxEditor.tsx`. Shipped: task checkboxes
   (click selects+toggles in one motion; Tab/Space toggles once focused,
   Tab also still advances focus per the skill's explicit call) and a
   generic directive-attribute popover (click selects, shows editable
   fields for whatever attrs the node has, commits on blur/Enter) — both
   verified end-to-end via real clicks/keypresses, not just typechecked.
   Deliberately deferred, not blocking: `@`-mention tooltips (mentions
   aren't parsed yet at all), arrow-key entry (needs a roaming caret, which
   only exists once Editing mode's typing surface does), and interactive
   selection inside container directives (TODO 5's default behavior, not
   needed by any real directive yet). Range-selection-deletes-flatly is
   also N/A until there's a text caret to make a range with.
3. **DONE — Foundation spike for Editing mode, TODO 1 resolved: trimmed
   Lexical.** Built and measured both prototypes for real (see TODO 1
   above for the full write-up), then deleted the spike code per the
   temp-code convention — findings are preserved in the skill doc and the
   decision log page, not in leftover throwaway routes. Net result: the
   select-as-unit/backspace-to-revert mechanics are easy to hand-roll
   either way, but only a contentEditable-based approach (Lexical) can
   actually render OxMarkdown's rich inline UI (checkboxes, pills, the dot
   grid) — a `<textarea>` is permanently limited to showing raw text. A
   trimmed Lexical config measures at ~48 KB gzip for the engine itself
   (already-shared, not new weight), a small fraction of the old fat
   361 KB/287 KB gzip `MdxEditorEditable` chunk, which is almost entirely
   CodeMirror/Sandpack/Radix/table-plugin weight nopal doesn't visually use
   — not Lexical's own cost.
4. **DONE — Full Editing mode**, built on trimmed Lexical
   (`@lexical/rich-text` + `list` + `link` + `code` + our own nodes).
   `oxmarkdown/editingTransforms.ts` converts real mdast (from
   `oxmarkdown/document.ts`, step 1's model) to/from real Lexical nodes —
   deliberately NOT `@lexical/markdown`'s own parser, so Editing mode
   reuses the same document model rather than forking it (that package's
   `TRANSFORMERS` ARE used, but only for live-typing convenience — typing
   `**x**`/`# `/`> ` auto-formats, same as Notion/Obsidian — since that only
   ever touches Lexical's own node tree, which the transform layer has to
   handle regardless of how a node was produced). `oxmarkdown/
   editingNodes.tsx` adds two decorator classes: `OxDirectiveNode` (reuses
   `InteractiveDirective` from `OxRenderer.tsx` directly — Interacting and
   Editing modes render directives through the literal same component) and
   `OxOpaqueNode`, a lossless passthrough for anything this bridge doesn't
   map yet (tables, raw HTML, any future mdast node type) — shown read-only
   via the static renderer rather than silently dropped, and still
   Backspace-revertible/Delete-removable like a directive. `oxmarkdown/
   InteractablesPlugin.tsx` implements select-as-unit/Backspace-revert/
   Delete-remove ONCE, generically, against a small `getRevertText()` duck
   type both node classes implement — a future `@mention` node gets this
   for free. `oxmarkdown/SlashCommandPlugin.tsx` adds a minimal `/`
   command menu (headings, list types, divider, one example directive).
   Task checklists deliberately use `@lexical/list`'s NATIVE checklist
   support (`ListItemNode.setChecked`/`CheckListPlugin`) rather than a
   custom decorator — real Lexical state, not inline text, so Backspace at
   a checklist item's start correctly falls through to ordinary list-
   outdent/merge instead of a revert-to-text step that wouldn't mean
   anything there.
   - **Verified end-to-end with real clicks/keypresses/round-trips, not
     just typechecked**: free-form typing and re-serialization; the
     `**bold**` live shortcut; checklist click-to-toggle; a directive's
     click-to-select, Backspace-revert, and Delete-remove; undo restoring
     a reverted directive; arrow-key selecting a block-level directive
     approached from an adjacent paragraph (crossing a block boundary, not
     just within one inline run); the `/` slash menu inserting a heading;
     and a table round-tripping losslessly through `OxOpaqueNode` with zero
     real Lexical table support.
   - **Found and fixed, real bugs, not hypothetical**: (1) a plain React
     `onClick` on a decorator selects it for one render, then Lexical's own
     click-driven selection sync silently overwrites it back — fixed by
     intercepting Lexical's own `CLICK_COMMAND` (dispatched through the
     same pipeline that sync runs in, so returning `true` actually
     suppresses it) instead of relying on a bare DOM listener. (2)
     Reverting a BLOCK-level decorator (a leaf/container directive, or an
     opaque table) to a bare `TextNode` throws — "Only element or decorator
     nodes can be inserted into the root node" — since its parent (often
     the root) doesn't accept inline content; fixed by wrapping the
     reverted text in a paragraph specifically for block-level nodes,
     inline ones unaffected. (3) The checklist glyph's CSS position has to
     agree with `@lexical/list`'s own click hit-test (it measures the
     `::before` pseudo-element's computed width from the `<li>`'s left
     edge to decide what counts as "clicked the checkbox") — a centered
     glyph (matching the static mode's visual) silently ate clicks.
   - **Bundle cost, measured for real** (not the TODO 1 spike's isolated
     estimate): the demo route's own new code (`OxEditor` + `editingNodes`
     + `editingTransforms` + both new plugins + the demo page itself) is
     71 KB raw / **22.7 KB gzip**. The shared Lexical rich-text/list/link/
     code/markdown vendor chunk it pulls in is 346 KB raw / 107.5 KB gzip
     — but that chunk is ALREADY shared with the OLD `MdxEditorEditable`
     too (confirmed by checking its own import graph), so it's not new
     weight while both systems coexist. Once MdxEditor is fully retired,
     `OxEditor`'s total realistic cost is roughly 107.5 + 22.7 ≈ **130 KB
     gzip** — well under half of the old fat `MdxEditorEditable` chunk's
     287 KB gzip on its own (which didn't even include this shared cost).
   - **Known, deliberate limitations, not oversights**: a container
     directive's nested content isn't independently editable in Editing
     mode yet (renders read-only via the static renderer — same scope line
     `editingNodes.tsx`'s header calls out); `TabIndentationPlugin` trades
     away standard Tab-key focus-escape for list-indent convenience (its
     own doc comment flags the accessibility tradeoff — worth revisiting
     in the mobile/accessibility pass); checklist visuals are matched, not
     pixel-identical, to Interacting mode's static rendering (native
     `@lexical/list` DOM shape genuinely differs from the static markup).
   - **Refinement pass, before starting step 5** — deliberately paused after
     step 4 to verify a few claims and sweep for loose ends rather than
     build straight through on an unreviewed foundation:
     - **TODO 9 (undo coalescing) verified, one claim corrected**: a
       continuous typing burst is ONE undo step even across word/
       punctuation boundaries (typing `"FOO BAR"` or `"foo. bar"` with no
       pause undoes fully in one press) — `@lexical/history`'s real
       grouping is time/pause-based and non-typing-action-based, not
       boundary-based as the original TODO 9 text claimed. A real pause, or
       any non-typing action (an arrow key), does start a new group. Net
       effect matches the original design intent either way — no code
       change, just a corrected mechanism description.
     - **Found and fixed (dark mode): a popover's own title text was low-
       contrast against its own background.** `.ox-popover-title` reads
       `--ox-color-accent`; nopal's real `--purple-light` (accent) and
       `--dark-midground` (this token's old dark value for
       `--ox-color-code-bg`) are two similarly-toned mid purples — fine
       almost everywhere `--ox-color-code-bg` is used (plain text on it
       reads fine), but exactly wrong for accent-colored text ON it. Found
       by reading actual computed colors, not eyeballing a screenshot.
       Fixed by switching `--ox-color-code-bg`'s dark value to the
       genuinely-darker `--dark-farground`; verified no regression on
       inline code/code blocks, which also use this token.
     - **Found and fixed: `OxOpaqueNode` had the exact click-selection bug
       already fixed on `OxDirectiveNode`, just missed.** Both decorators
       need the same `CLICK_COMMAND` interception (see the bug write-up
       above) — it was only applied to one. Extracted into a shared
       `useSelectDecoratorOnClick` hook so a third decorator can't repeat
       the same miss. Verified by adding a real table to the live demo
       (`EDITING_SAMPLE`) and clicking it — which also means the demo now
       demonstrates `OxOpaqueNode` live, not just via a headless test.
     - **Found and fixed: the "Divider"/"Note" slash commands left the
       caret in a dead spot.** They inserted the new block but never moved
       selection there, so Lexical's default behavior left the caret in
       whatever empty paragraph the `/` was typed into — ABOVE the newly
       inserted block, not below it, and typing continued there instead of
       flowing naturally after the new content. Fixed by always adding a
       fresh paragraph immediately after the inserted node and selecting
       it. (The heading/list commands never had this problem —
       `$setBlocksType`/`$insertList` naturally continue selection in the
       transformed block itself.)
     - **Minor cleanup, no behavior change**: removed a dead re-export
       block in `editingTransforms.ts` (nothing imported it — `OxEditor.tsx`
       and `SlashCommandPlugin.tsx` both import the node classes/factories
       directly from `editingNodes.tsx`) and an unnecessary `as never` cast.
5. **Mobile UX pass** — quick-actions bar, bottom-sheet popovers, grid-sized
   tap targets (see TODO 2). Deliberately last and explicitly a hands-on
   review/iterate pass on real devices, not a spec to implement blind —
   flagged earlier as the area needing the most active review once
   something real exists to test.
6. **Incremental migration**, not a big-bang cutover: swap real routes
   (Vault `ProjectView`, daily log, vault file view) from MdxEditor to
   `OxRenderer`/Interacting-mode `OxEditor` as soon as step 2 is solid —
   that alone covers everything View and Workable do today. Keep
   `MdxEditorClient`/`MdxEditorEditable` (real typing) in place for actual
   text editing until step 4 lands, then retire them.

## Related skills

- `mdx-editor` — the current, live system this replaces. Keep both skills
  in sync as work progresses; concepts move from "current" to "carried
  over" or get explicitly superseded here.
- `vault` — the Vault's "Projects" root and the project rollup view
  (`ProjectView.tsx`) are the first real consumer of generic directives.
- `dark-mode-review` — re-run after any visual change to the design
  language above.
