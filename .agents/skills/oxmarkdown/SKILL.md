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

1. **Foundation review** — now backed by real measurements, not just
   theory:
   - **Lexical isn't used everywhere today.** Only the full Editing surface
     (`MdxEditorClient`/`MdxEditorEditable`) is built on `@mdxeditor/editor`
     (Lexical). Interacting — today's View + Workable — is *already*
     entirely hand-rolled (`nopalEditorState.ts` + `MdxRenderer.tsx`, zero
     Lexical). So "roll our own" isn't hypothetical for half the system —
     it's already the shipped approach there. The genuinely open question
     is narrower: for *Editing* specifically (typing, caret, structural
     edits), keep Lexical or go custom?
   - **Real bundle cost, measured** (production build, `npm run build`): the
     lazy-loaded Editing chunk (`MdxEditorEditable`) is **1.12 MB raw /
     361.56 KB gzipped** — versus the render/interact path (`MdxRenderer`,
     loaded far more often across the app) at 364.72 KB raw / 101.66 KB
     gzipped. The gap is real, not negligible.
   - **Why it's that big**: `@mdxeditor/editor`'s transitive dependencies
     include a full CodeMirror 6 (`@codemirror/language-data` alone bundles
     grammars for dozens of languages), `@codesandbox/sandpack-react` (a
     live code-sandbox library), most of Radix UI (for MDXEditor's own
     toolbar/dialogs, which nopal doesn't use visually — it restyles/hides
     them), a table plugin, `react-hook-form` + `js-yaml` (link dialog +
     frontmatter UI), and `unidiff` (a diff/merge view). Most of this isn't
     earning its keep for nopal's actual feature set.
   - **Already-proven extension points — real signal, mixed verdict**:
     nopal has already written custom Lexical node plugins
     (`wikiLinkPlugin.tsx`, `csvRefPlugin.tsx`, `refPopoverPlugin.tsx`) to
     hook `[[wiki-links]]` and CSV chips into the Editing surface. Per
     Gerald: building them **wasn't hard** — the Lexical plugin API itself
     isn't the blocker — but the *results* are **imperfect**, which gives
     pause. Open follow-up, not yet answered: is the imperfection coming
     from Lexical's plugin model itself (hard to get the last 20% right,
     even though the first 80% is easy), or from other factors — time/
     polish, or the unevenness of mixing real Lexical nodes (wiki-links)
     with regex-based interactables (csv-key, directives) in the same
     document? Worth digging into *why* it's imperfect before deciding
     whether that's a Lexical problem or a "we didn't finish polishing it"
     problem — those point to very different conclusions for `OxEditor`.
   - **Working hypothesis, not a decision**: a *trimmed* Lexical config
     (drop CodeMirror/Sandpack/table/link-dialog, keep only
     `@lexical/react` + rich-text + list + link + selection + utils + our
     own plugins) would likely shrink that 361 KB substantially — plausibly
     to a fraction of it — without giving up Lexical's mobile/IME/selection
     handling, which is the genuinely hard part to rebuild from scratch
     (contentEditable across iOS Safari/Android Chrome is a well-known
     minefield — the actual reason mature editor frameworks like
     Lexical/ProseMirror/Slate exist at all). A fully custom contentEditable
     implementation carries real, ongoing risk there regardless of how
     well-scoped our interactables model is.
   - **Next step, not a conclusion**: prototype the interactables model
     (select-as-unit, backspace-to-revert) two ways — (a) a trimmed Lexical
     config with custom decorator-like nodes, (b) a from-scratch surface,
     possibly `<textarea>`-based rather than contentEditable-based, to get
     native mobile text input for free and only hand-build the "selection
     skips over/selects interactables as units" logic on top of
     `selectionStart`/`selectionEnd`. Compare real bundle size AND
     implementation pain from both spikes before deciding — we now have a
     concrete way to measure this instead of deciding from theory alone.
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
9. **Undo/revert granularity — decided: atomic units, word-level for typed
   text.** Reverting an interactable is always one atomic undo step (it's
   one syntactic unit — a directive's `{attrs}` isn't going to partially
   revert). For ordinary typed text, undo should coalesce by natural units
   (word boundaries) rather than one step per keystroke, the way Zed's
   undo already feels. This is genuinely the standard approach, not an
   unusual choice: essentially every mature editor (VS Code, Sublime,
   IntelliJ, Zed, Google Docs, even modern browser `<textarea>`s) groups
   contiguous typing into undo "runs" and starts a new group on a word/
   punctuation boundary, a pause, or a non-typing action (arrow key, click,
   paste). Implementation-wise it's a solved problem with real prior art to
   copy from (Lexical's own `@lexical/history` package — already a
   transitive dependency here — implements exactly this; CodeMirror 6's and
   ProseMirror's history modules are open-source references too if we go
   fully custom). Bounded, known work, not a research problem — treat it as
   part of whichever foundation gets picked in TODO 1, not a separate build.

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

1. **Real document model (`OxRenderer`)** — replace the `\n\n`-split
   `nopalEditorState.ts` approach with a real mdast parse
   (`mdast-util-from-markdown` + micromark, with directive/frontmatter/
   GFM-task-list extensions — see TODO 3). Resolves TODO 3 and makes TODO 5
   fall out for free. Output should be visually identical to today's
   `.nopal-content` rendering — no design-language changes yet, just a
   different parser underneath. This alone is a shippable, low-risk win:
   it fixes multi-paragraph containers even before any interaction work.
2. **Interactables + Interacting-mode `OxEditor`, on `OxRenderer`** — no
   Lexical needed. Build: selection (click/tap, Tab/Shift+Tab per TODO 8,
   arrow-key entry per TODO 7), and the per-kind "act" behaviors (checkbox
   toggle → reserialize markdown, `@mention` tooltip, directive popover for
   adjusting attributes). Range-selection-deletes-flatly (see above) applies
   here too. This is a full, real replacement for today's `MdxEditorWorkable`
   — shippable on its own, independent of TODO 1.
3. **Foundation spike for Editing mode** — now informed by a real
   interactables engine from step 2 to test against, not a toy example.
   Prototype both directions from TODO 1 (trimmed Lexical config vs.
   from-scratch/textarea-based) implementing the same one real interactable
   end-to-end, and compare bundle size + how naturally select/revert/act
   falls out of each. Answer TODO 1 for real, from evidence.
4. **Full Editing mode** on the chosen foundation — free-form typing,
   Backspace-revert (TODO 6/9), slash-command insertion, undo coalescing
   (TODO 9). Should reuse the *same* document model from step 1 — Editing
   is a strict superset of Interacting, not a parallel implementation.
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
