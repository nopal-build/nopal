// app/routes/fruits_.styles_.oxmarkdown.tsx
//
// A dedicated, evolving page for OxMarkdown — reachable from the Design
// System page (`/fruits/styles`), not nested under it (this file's name
// breaks nesting at both `fruits_` and `styles_`, same convention as
// `fruits_.vault.tsx` breaking nesting under `fruits`).
//
// Two purposes, both maintained going forward as OxMarkdown grows:
//   1. A live playground — edit markdown, see it render, try theme
//      overrides — so decisions can be checked visually, not just by
//      reading code.
//   2. A running decision log — short, human-scannable entries on what
//      changed and why, a companion to the full technical detail in the
//      `oxmarkdown` skill (`.agents/skills/oxmarkdown/SKILL.md`).
//
// Convention for future edits: add a new `DECISIONS` entry (newest last)
// each time a build-plan step lands, and extend the "Try it" section with
// whatever the step actually added (a new directive example, an
// interactable demo, ...). Keep entries short — this page is for a quick
// visual reminder, not the full rationale (that's the skill file).
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import OxRenderer from "../components/OxRenderer";
import OxEditor from "../components/OxEditor";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  return { user };
}

// ─── Helpers (mirrors fruits_.styles.tsx's Section/Label pattern) ────────────

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: "64px" }}>
      <h2
        className="font-bold text-lg font-mono mb-6 pb-2 purple-text"
        style={{ borderBottom: "1px solid var(--midground)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-mono mb-1 subtle-text">{children}</div>;
}

/** A single labeled, static preview of one interactable state — hand-built
 * markup (same classes OxRenderer/OxEditor actually produce), not the live
 * components, so a state that only exists transiently (focused, mid-edit)
 * can sit still long enough to look at and compare against its neighbors.
 * `.ox-tokens` alongside `.ox-content` because that's the pairing every
 * real usage needs now — see `styles/oxmarkdown.css`. */
function StateSwatch({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 items-start">
      <Label>{label}</Label>
      <div className="good-box ox-content ox-tokens p-3" style={{ minWidth: "140px" }}>
        {children}
      </div>
    </div>
  );
}

// ─── Decision log ──────────────────────────────────────────────────
// Newest last. Keep each entry to a couple of sentences — link to the
// oxmarkdown skill (mentioned once in the page header) for full detail.

const DECISIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Two modes, not three",
    body: (
      <>
        MdxEditor's View / Workable / Editable became <strong>Interacting</strong> and{" "}
        <strong>Editing</strong> — Editing is a strict superset of Interacting, not a
        separate thing. "Workable" was never really a third mode; it was Interacting
        with one specific interactable (tasks) enabled. Which interactables are
        enabled is a per-viewer permission, not a mode.
      </>
    ),
  },
  {
    title: "Interactables: select, then act",
    body: (
      <>
        Every non-plain-text element (a mention, a directive, a checkbox) is an{" "}
        <strong>interactable</strong>. Arrow-onto, click/tap, or a first Backspace
        always selects one as a whole unit first — never a bare caret inside it. A
        second Backspace reverts it to raw text (soft, reversible); Delete instead
        removes it outright (relies on undo). A range selection that happens to span
        an interactable treats it as one plain character — no special behavior there.
      </>
    ),
  },
  {
    title: "Generic directives replace the old `[key]` chip syntax",
    body: (
      <>
        <code>:name{"{"}attrs{"}"}</code> (inline), <code>::name{"{"}attrs{"}"}</code>{" "}
        (block), and <code>:::name{"{"}attrs{"}"} ... :::</code> (container) are the
        one extension mechanism for typed content — csv-key chips, project blocks
        (budget tables, galleries), and anything future all use the same syntax
        instead of one-off conventions.
      </>
    ),
  },
  {
    title: "Step 1: a real document model, not `\\n\\n`-split strings",
    body: (
      <>
        The old system split markdown into paragraphs by blank line, before anything
        knew directives existed — so a container directive could never wrap a blank
        line without breaking. Replaced with a real mdast parse (the same tree shape
        `remark`/`mdast-util-*` use), which nests real block content regardless of
        blank lines. Proved this by round-tripping a container directive with a blank
        line inside it — the exact case that broke before.
      </>
    ),
  },
  {
    title: "The core is framework-agnostic on purpose",
    body: (
      <>
        `oxmarkdown/document.ts` (parse/serialize) has no React import at all — it's
        plain data transformation. Not because a native app is imminent, but because
        keeping the model pure costs nothing now and keeps a future port (Rust, or
        anything else) a translation exercise instead of a redesign, if it's ever
        actually needed.
      </>
    ),
  },
  {
    title: "Its own themable stylesheet, not a `.nopal-content` port",
    body: (
      <>
        `.ox-content` reads every value from an `--ox-*` custom property — nopal's
        current palette is just this file's default, not something baked into the
        rules. Dark mode redefines the same variables in one block instead of
        duplicating every component's colors. A caller can override individual
        tokens (try the font field below) without touching the stylesheet at all.
      </>
    ),
  },
  {
    title: "Step 2: interactables, built on OxRenderer, no Lexical needed",
    body: (
      <>
        <code>OxEditor</code> is one component covering both modes via a{" "}
        <code>mode</code> prop — only <code>"interacting"</code> is implemented so
        far. It reuses OxRenderer's tree walk directly (a new <code>OxTreeRenderer</code>{" "}
        export) rather than re-parsing, so a click can mutate the exact node object a
        render already produced and re-serialize that same tree — see the
        Interactables demo below. Confirms the build plan's bet: Interacting mode
        needed zero progress on the Lexical-vs-custom question (TODO 1) to ship for
        real.
      </>
    ),
  },
  {
    title: "Found (not yet fixed): extra blank lines between paragraphs are lost",
    body: (
      <>
        Confirmed by filling the textarea above with 1 vs. 3 blank lines between two
        paragraphs and checking the rendered layout: both produce identical output.
        Not a CSS issue — standard CommonMark parsing treats "1 blank line" and "5
        blank lines" as the same signal ("these are separate blocks") and discards
        the count before OxRenderer ever sees it. The old system special-cased this
        (an empty node per extra blank line); the mdast model needs the same trick,
        using each node's `position.start.line`/`end.line` to detect a gap bigger
        than the minimum and render spacer paragraphs for the difference. Not done
        yet — noted for a follow-up pass, not blocking step 2.
      </>
    ),
  },
  {
    title: "Found (and fixed): popovers need to portal out, not just have a big z-index",
    body: (
      <>
        A high `z-index` alone doesn't save a popover from a scrolling ancestor —
        `position: fixed` computed relative to a container that's inside a scroll
        region still scrolls away with it. `.ox-popover` is now rendered via a real
        portal straight into `document.body`, with its position computed from the
        trigger's `getBoundingClientRect()` and recomputed on scroll/resize (capture
        phase, so it catches scrolling on any nested container, not just the
        window). Side effect worth knowing: once portaled, the usual
        `relatedTarget`/`contains` check for "did focus leave this widget" stops
        working, since the popover's DOM parent is `body`, not the trigger — fixed
        by tracking both elements by ref and checking `document.activeElement`
        against both on a deferred tick after blur.
      </>
    ),
  },
  {
    title: "Selected state: lighter, no border, hugs its content",
    body: (
      <>
        `.ox-selected` dropped its `outline` entirely and the tint went from 16% to
        8%. Separately, a leaf directive's wrapper defaulted to `display: block`
        (an ordinary `&lt;div&gt;`), so the highlight stretched across the full row
        instead of just the pill — forced to `inline-block` so it always hugs
        whatever width the content actually needs.
      </>
    ),
  },
  {
    title: "Found (and fixed): a portaled popover loses its CSS variables",
    body: (
      <>
        The `--ox-*` tokens lived only on `.ox-content` — custom properties
        inherit through the real DOM tree, not the React tree, so once the popover
        portals to `document.body` (outside `.ox-content`'s subtree entirely) it
        couldn't see any of them: transparent background, unreadable text. Split
        the tokens into their own `.ox-tokens` class, paired with `.ox-content`
        everywhere real content renders, and added to `.ox-popover` directly so it
        always carries its own copy regardless of where it ends up in the DOM.
      </>
    ),
  },
  {
    title: "Found (and fixed): a grid-aligned pill still shouldn't look 41px tall",
    body: (
      <>
        First pass made <code>.ox-pill</code> itself 41px tall via `line-height` so it
        wouldn't throw off the grid — correct for alignment, but it visually read as an
        oversized capsule. Split it into two layers: `.ox-pill` is an invisible slot
        exactly one grid row tall (for rhythm), `.ox-pill-chip` is the actual small
        visible capsule, centered inside it. Same idea as the mobile tap-target sizing
        already decided in the skill's TODO 2 — the *hit/visual* area and the *grid*
        area don't have to be the same box, as long as something reserves the grid
        space.
      </>
    ),
  },
  {
    title: "Static states gallery, alongside the live demo",
    body: (
      <>
        Several interactable states (focused, mid-edit, an open popover) are
        transient by nature — easy to trigger, hard to hold still and actually look
        at. Added a states section below using the exact same classes
        OxRenderer/OxEditor produce, applied directly rather than through real
        focus/click, so every state sits still side by side for comparison.
      </>
    ),
  },
  {
    title: "Found (and fixed): gutter markers need their own room",
    body: (
      <>
        The heading/bullet/list-number markers hang in a negative-offset margin —
        and `overflow-x: hidden` clips relative to an element's own box, not the
        viewport, so no amount of padding on a wrapper could ever give them room.
        `.ox-content` now reserves its own left padding (one grid cell) instead of
        depending on incidental space from wherever it's embedded. The old
        `.nopal-content` likely has this same latent bug, just masked by whatever
        page happens to wrap it.
      </>
    ),
  },
  {
    title: "Step 3: trimmed Lexical wins, decided from two real spikes",
    body: (
      <>
        Built the same one interactable (a <code>[ ]</code>/<code>[x]</code> checkbox,
        with select-as-unit + backspace-to-revert) two ways, measured both, then
        deleted the throwaway routes. A plain <code>&lt;textarea&gt;</code> can hand-roll
        the selection mechanics fine — arrow-onto/backspace-approaching genuinely work
        via <code>selectionStart</code>/<code>selectionEnd</code> alone — but it can
        never render an actual checkbox glyph, a pill, or the dot grid; it only ever
        shows raw characters. That's disqualifying on its own, so: trimmed Lexical.
        Measured cost is small — the shared Lexical-core chunk is ~48&nbsp;KB gzip
        (already shared with today's MdxEditor, not new weight), versus ~287&nbsp;KB
        gzip for the old fat chunk, almost all of which is CodeMirror/Sandpack/Radix
        nopal doesn't visually use, not Lexical itself.
      </>
    ),
  },
  {
    title: "Step 4: Editing mode lands — same document model, new node classes",
    body: (
      <>
        <code>editingTransforms.ts</code> converts real mdast to/from real Lexical
        nodes — deliberately not <code>@lexical/markdown</code>'s own parser, so
        Editing mode reuses step 1's document model instead of forking it. Two new
        decorator classes cover what plain rich-text can't: <code>OxDirectiveNode</code>{" "}
        (reuses <code>InteractiveDirective</code> from <code>OxRenderer</code> directly —
        both modes render directives through the literal same component) and{" "}
        <code>OxOpaqueNode</code>, a lossless passthrough for anything not mapped yet
        (tables, raw HTML) — shown read-only rather than silently dropped, verified by
        round-tripping a real table through it with zero data loss. Checklists
        deliberately use <code>@lexical/list</code>'s native checkbox support rather
        than a custom decorator — real node state, not inline text, so there's nothing
        to "revert to raw text" there.
      </>
    ),
  },
  {
    title: "Found (and fixed): a decorator's own onClick isn't enough",
    body: (
      <>
        A plain React <code>onClick</code> on a decorator set its selection for one
        render, then Lexical's own click-driven selection sync silently overwrote it
        back a beat later — verified directly (isSelected flips true, then false, with
        no focus/blur involved at all). Fixed by intercepting Lexical's own{" "}
        <code>CLICK_COMMAND</code> instead — it's dispatched through the same pipeline
        that sync runs in, so returning <code>true</code> actually suppresses it, unlike
        a bare DOM listener racing against it.
      </>
    ),
  },
  {
    title: "Found (and fixed): reverting a block-level directive threw",
    body: (
      <>
        Backspace-reverting a <code>::directive</code> or a table to raw text by
        replacing it with a bare <code>TextNode</code> threw "Only element or decorator
        nodes can be inserted into the root node" — its parent (often the document
        root) doesn't accept inline content directly. Fixed by wrapping the reverted
        text in a paragraph specifically when the node being reverted is block-level;
        an inline directive (<code>:name</code>) still reverts to a bare text node,
        which is correct there.
      </>
    ),
  },
  {
    title: "Bundle cost, measured again: ~130 KB gzip once MdxEditor retires",
    body: (
      <>
        This page's own new code (OxEditor + editingNodes + editingTransforms + both
        plugins) is 71&nbsp;KB raw / 22.7&nbsp;KB gzip. The shared Lexical rich-text/
        list/link/code chunk it needs is 107.5&nbsp;KB gzip — but that chunk is
        already shared with today's <em>old</em> MdxEditorEditable too, so it's not
        new weight while both systems coexist. Once MdxEditor is fully retired,
        OxEditor's total cost lands around 130&nbsp;KB gzip — under half the old fat
        chunk's 287&nbsp;KB gzip on its own.
      </>
    ),
  },
  {
    title: "Refinement pass, before starting mobile UX: undo verified, a real dark-mode contrast bug, two real bugs from a code sweep",
    body: (
      <>
        Paused after step 4 rather than building straight through. <strong>Undo</strong>{" "}
        coalescing verified with real keystrokes — a continuous typing burst is one undo
        step even across word/punctuation boundaries; only a real pause or a non-typing
        action starts a new group (corrects TODO 9's original "splits on word boundaries"
        claim — no code change, the actual behavior already matches the design intent).{" "}
        <strong>Dark mode</strong>: the directive popover's own title text was low-contrast
        against its own background — found by reading computed colors, not eyeballing a
        screenshot: nopal's real <code>--purple-light</code> (accent) and{" "}
        <code>--dark-midground</code> (this token's old dark background) are two
        similarly-toned mid purples, fine almost everywhere except accent-colored text
        directly on it. Fixed with a genuinely darker background token.{" "}
        <strong>Code sweep</strong> caught two real bugs: <code>OxOpaqueNode</code> (the
        table/raw-HTML passthrough) had the exact click-selection race already fixed on{" "}
        <code>OxDirectiveNode</code>, just never applied there — now a shared hook so a
        third decorator can't repeat the miss; and the "Divider"/"Note" slash commands left
        the caret in a dead spot above the inserted block instead of a fresh line below it.
      </>
    ),
  },
  {
    title: "Blank lines: three real bugs deep, not one — found by Gerald testing, not by us",
    body: (
      <>
        Reported as "collapsing new lines" while testing Editing mode directly — turned out
        to be three separate bugs stacked on top of each other. (1) The static-renderer spacer
        fix from the last decision-log entry never touched <strong>Editing-mode import</strong>{" "}
        at all, so opening existing markdown there still collapsed every gap to zero regardless
        of source. (2) Fixing that surfaced something deeper: an empty <code>ParagraphNode</code>{" "}
        is the WRONG way to represent "N blank lines" — CommonMark has no blank-line node type,
        and a real Lexical element always gets its own default join on EACH side, so one empty
        paragraph between two blocks serialized as 3 blank lines, not 1 (confirmed directly).
        Fixed with a dedicated <code>OxBlankLinesNode</code> that's never emitted as a real mdast
        node — export turns its count into a custom <code>join</code> function,{" "}
        <code>mdast-util-to-markdown</code>'s own real mechanism for exact gaps between two
        specific siblings. Verified
        with exact round-trips this time, not eyeballing. (3) Still didn't look right after all
        that — a single ordinary blank line showed ZERO visual gap, everywhere, always, because
        paragraphs/lists have <code>margin: 0</code> by design. Every other markdown renderer
        shows some gap for a plain paragraph break; fixed with a CSS rule giving every block
        sibling one grid unit of margin by default, with extra blank lines stacking more on top.
      </>
    ),
  },
  {
    title: "Empty checklist items: a real upstream limitation, not a bug we could fully fix",
    body: (
      <>
        Pressing Enter inside a checklist item renders a fresh checkbox glyph regardless of
        that item's own content, then exports as a bare <code>-</code> with no{" "}
        <code>[ ]</code> once it's empty. Root cause: <code>mdast-util-gfm-task-list-item</code>{" "}
        genuinely cannot represent a checkbox on a list item with no text at all — its{" "}
        <code>[ ]</code>/<code>[x]</code> injection is a regex anchored on the bullet's trailing
        separator space, which an empty item's rendered <code>-</code> never has (confirmed
        directly against its source, not assumed). An empty item ALWAYS exports as a bare{" "}
        <code>-</code>, full stop — not something fixable in our own code. Rather than fight
        that with an invisible sentinel character (a zero-width space works and round-trips,
        confirmed directly, but adds ongoing fragility for a cosmetic win), the glyph fell back to
        looking like a plain bullet whenever empty — <strong>this specific fix was itself wrong
        and got reworked two rounds later</strong>, see below.
      </>
    ),
  },
  {
    title: "Reframed around one rule: 1 markdown line = 1 editor line, no margins standing in",
    body: (
      <>
        Gerald's framing, verbatim: this should function more like a code editor where one
        line in the markdown must equal one line in the editor, each line the exact same
        height. That directly contradicted two earlier decisions above (margin standing in for
        blank lines; a CSS fallback that silently changed a checkbox's glyph based on incidental
        emptiness). Both got reworked this round, for Editing mode specifically — the static{" "}
        <code>OxRenderer</code> keeps margin-based prose rhythm as-is, since that's normal for
        read-only reading. See the next two entries for what actually changed.
      </>
    ),
  },
  {
    title: "Blank lines are ordinary empty paragraphs now, not a decorator node",
    body: (
      <>
        The custom <code>OxBlankLinesNode</code> is gone. Each blank line is now a literal,
        empty <code>ParagraphNode</code> — completely standard, so clicking, arrowing, typing,
        Backspace, and undo all just work with zero custom code (this also fixes a real bug: the
        old decorator's wrapper was non-editable, so clicking a blank line did nothing at all).
        The earlier "an empty paragraph always doubles blank lines" finding was real but
        incomplete: it was a limitation of the library's default spacing, not of empty paragraphs
        themselves. Once every sibling pair gets an explicit opinion via a stateless{" "}
        <code>join</code> function (checking the two real nodes directly — 0 if either side is a
        blank placeholder, otherwise the library's own default), N empty paragraphs serialize to
        exactly N blank lines, confirmed directly. Editing mode's default per-block margin is
        gone too, for the same reason — verified with real geometry: every row, blank or not,
        lands at an exact 41px/82px grid multiple, back to back.
      </>
    ),
  },
  {
    title: "Checklists rebuilt on our own node, after a real render/markdown mismatch caught live",
    body: (
      <>
        The "split the downgraded item into a second list" fix (previous entry) looked correct,
        seamless, zero visual gap, and was still wrong. Fed the exact structure it produces
        straight to a markdown serializer in isolation: two adjacent bullet lists serialize with a
        real extra blank line and a bullet character switched to an asterisk, invisible in the
        rendered editor the whole time. Exactly the rule this violated: the editor should almost
        always represent the markdown it will produce, now the standing testing convention for
        every check going forward.
      </>
    ),
  },
  {
    title: "OxListItemNode: checkbox-ness is now a real per-item field, not tied to list type",
    body: (
      <>
        The actual fix: a real <code>ListItemNode</code> subclass, checklists never use{" "}
        <code>@lexical/list</code>'s <code>&quot;check&quot;</code> list type at all anymore, every
        list is a plain bullet list, and whether one ITEM has a checkbox is this class's own
        field. One predicate, <code>isRealCheckbox()</code>, is called by both rendering and
        export, so they cannot disagree. Two real traps found and fixed along the way, both
        confirmed by direct testing: the base node's own modern config API silently clears
        checked state whenever the parent list is not check-type, which is now always, worked
        around with a separate field the base logic never touches; and calling the older
        editor-state read API from a raw click handler threw a real runtime error until an
        explicit editor reference was passed. Click-to-toggle, Space-to-toggle, and Escape/Arrow
        checklist-focus behavior were all rebuilt from scratch to match, replacing the native
        checklist plugin entirely. Every priority case reverified end to end with the three-way
        protocol, including the case where dropping the checkbox is genuinely invisible in both
        the render and the markdown, because the item is empty.
      </>
    ),
  },
  {
    title: "A separate finding, not caused by this work: undo looked broken via automation",
    body: (
      <>
        Plain typing in a fresh paragraph, no lists involved at all, did not revert on Ctrl+Z when
        driven through Playwright. Checked against the unmodified, last-committed baseline before
        concluding anything: identical result there too. Whatever this is, it predates this
        session and is not specific to checklists, flagged for separate investigation rather than
        chased down in this pass.
      </>
    ),
  },
  {
    title: "Briefly un-fixed, then actually fixed: an empty checkbox item now really has one",
    body: (
      <>
        First tried showing the checkbox glyph for an empty item again (matching most other
        editors) without changing what gets exported — caught immediately: that's the exact
        mismatch this whole rewrite exists to eliminate, and reverted right away. The real
        question was the productive one: why not make the exported markdown capable of actually
        containing <code>[ ]</code>, instead of choosing which side has to lie? Verified in
        isolation first, before touching any code: a lone zero-width space after the checkbox
        satisfies GFM's real requirement for non-whitespace content and round-trips exactly.
        Implemented on both sides — export injects it only when a checkbox item has no real text,
        import recognizes and strips it back out so it never becomes visible or typeable — and
        verified with a full headless round-trip (import a file containing it, confirm the live
        node is genuinely empty, re-export, confirm it's stable). The render and the file now
        agree completely, with no exception on either side of it.
      </>
    ),
  },
  {
    title: "Found a real Firefox-only bug from a screenshot, not reproducible in Chromium",
    body: (
      <>
        An empty checkbox row looked visibly mispositioned in a screenshot, but measured
        byte-identical to every other row in Chromium, repeatedly. Installed Playwright's actual
        Firefox engine and reproduced it on the first try: a real, confirmed{" "}
        <code>height: 0px</code>. Root cause: the checklist item's shared class also sets{" "}
        <code>display: flex</code>, correct for the static renderer's real two-element checkbox
        layout, meaningless for Editing mode's single-element structure. Flex containers size
        from their items, not <code>line-height</code> — an empty item's bare line break
        contributes zero height as a flex item in Firefox specifically; Chromium quietly tolerates
        the same mismatch. Fixed with a targeted <code>display: block</code> override, reverified
        in both engines afterward, including that click-to-toggle still works in both. Chromium-only
        testing missed a real, user-visible bug entirely.
      </>
    ),
  },
  {
    title: "A vague report got misread at first: checkboxes should show a dash TOO, not never",
    body: (
      <>
        First read as "plain bullets should show a dash, real checkboxes shouldn't" (matching the
        design at the time) — corrected directly afterward: a checkbox is still a list item, and
        the markdown still starts with the same <code>-</code> marker (<code>- [ ] text</code>),
        so hiding the dash specifically for checkboxes was visually claiming they're a different
        kind of list than they actually are. Fixed by swapping which pseudo-element holds what —
        the dash moves to <code>::before</code> (matching every other list item exactly), the
        checkbox box and its checkmark both move to <code>::after</code>. That moved a real
        dependency: the click-to-toggle hit-test reads a pseudo-element's width to know where the
        clickable glyph is, updated to match, reverified in both Chromium and Firefox afterward
        (click-to-toggle still works in both; clicking the dash itself deliberately does not).
      </>
    ),
  },
  {
    title: "That misread still surfaced a real bug: a stray dash from how @lexical/list wraps nesting",
    body: (
      <>
        Investigating the (initially wrong) reading led to a real, separate bug that needed fixing
        regardless: a mixed list and a fresh single-item list both rendered correctly, ruling out
        the obvious theories first. The actual cause only showed up testing a NESTED checkbox
        specifically: <code>@lexical/list</code> wraps a nested list inside a parent{" "}
        <code>&lt;li&gt;</code> with no text and no checkbox class of its own, so it matched the
        plain-bullet marker rule and picked up a dash that had nothing to do with its own
        (nonexistent) content — confirmed with a screenshot showing the stray dash floating right
        next to the nested checkbox's own glyph. Fixed by suppressing the marker specifically for
        a list item whose SOLE content is a nested list, verified not to affect a real
        parent-with-text-and-nested-sublist case, and confirmed the static renderer (a completely
        different DOM shape for nesting) was never affected by either the bug or the fix.
      </>
    ),
  },
  {
    title: "Delete no longer has a soft ‘revert to text’ step",
    body: (
      <>
        Selecting a directive and pressing Backspace used to revert it to its raw,
        re-editable markdown text (a second Backspace then deleted it); Delete instead
        removed it outright, no revert. Removed the revert step entirely — retyping a
        directive via <code>/</code> is simple enough that the extra machinery (including
        escaping a reverted directive's raw text on export, so it wouldn't be mistaken for a
        live directive again) wasn't earning its complexity. Backspace and Delete are now
        byte-for-byte identical once something is selected: both fully remove, relying on
        ordinary undo to bring something back.
      </>
    ),
  },
  {
    title: "Typing [ ] and ::name{…} now live-convert, and paste re-parses through the real pipeline",
    body: (
      <>
        Typing <code>[ ] </code>/<code>[x] </code> at the start of a line now live-converts into
        a real checkbox the same way <code>**bold**</code> does (a hand-written transformer, not
        <code>@lexical/markdown</code>'s own <code>CHECK_LIST</code> — that one creates a native
        <code>"check"</code>-type list, which this codebase never uses). Typing a leaf directive
        (<code>::badge{'{label="x"}'}</code>) alone on a line and pressing Enter does the same for
        directives — built as its own Enter handler rather than a live-typing transformer, since
        that mechanism only fires right after a space, which a directive's closing{" "}
        <code>{"}"}</code> doesn't have. Pasting plain text now re-parses the whole clipboard
        through the real parser too (container directives, tables, <code>- [ ] </code> with its
        dash — anything live-typing doesn't reach), instead of inserting literal characters. Rich
        (HTML) paste is untouched. Verified with the three-way protocol in both Chromium and
        Firefox; one real finding along the way turned out to be a Playwright/Firefox synthetic-
        event testing quirk, not a bug — see the skill doc's build-plan entry for the full trail.
      </>
    ),
  },
];

// ─── Sample content for the playground ────────────────────────────────────────────────────────

const DEFAULT_SAMPLE = `# Try editing this

Bold, *italic*, ~~strikethrough~~, inline \`code\`, and a [link](https://example.com).

:::note{title="Container directive"}
This paragraph is followed by a blank line inside the directive —

the exact case that broke the old regex-based system. It survives here.
:::

::badge{label="Leaf directive"}

::unregistered{demo="unknown directive fallback"}

- [ ] Unchecked task
- [x] Checked task
- Plain bullet

1. Ordered
2. List
`;

const DEMO_DIRECTIVES: DirectiveRegistry = {
  note: ({ attrs, children }) => (
    <div style={{ borderLeft: "3px solid var(--ox-color-accent)", paddingLeft: 12 }}>
      {attrs.title && <div className="ox-directive-title">{attrs.title}</div>}
      {children}
    </div>
  ),
  badge: ({ attrs }) => (
    <span className="ox-pill">
      <span className="ox-pill-chip">{attrs.label}</span>
    </span>
  ),
};

// ─── Main ───────────────────────────────────────────────────────────────────

const INTERACTABLES_SAMPLE = `::badge{label="Try me" size="half"}

- [ ] Click to check
- [x] Click to uncheck
- Plain bullet, not a task
`;

const EDITING_SAMPLE = `# Try typing here

Free-form text, **bold**, *italic*, and a [link](https://example.com) all work
as real typing — try \`/\` at the start of a line for the slash-command menu.

- [ ] A real checklist (native @lexical/list, click or Tab+Space to toggle)
- [x] Already checked

::badge{label="Directive"}

Arrow onto the badge above, or click it — either Backspace or Delete then
removes it outright.

No real table-editing UI exists yet, but a table still round-trips losslessly
— click it to select, Backspace to see its raw markdown, undo to bring it back.

| Fruit | Qty |
| ----- | --- |
| Apple | 3   |
| Pear  | 5   |
`;

export default function OxMarkdownStyles() {
  const [markdown, setMarkdown] = useState(DEFAULT_SAMPLE);
  const [fontFamily, setFontFamily] = useState("");
  const [colorAccent, setColorAccent] = useState("");
  const [interactiveMarkdown, setInteractiveMarkdown] = useState(INTERACTABLES_SAMPLE);
  const [editingMarkdown, setEditingMarkdown] = useState(EDITING_SAMPLE);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "1000px" }}>
        {/* Page header */}
        <div className="mb-12">
          <Link
            to="/fruits/styles"
            className="text-xs subtle-text hover:opacity-80"
            style={{ textDecoration: "none" }}
          >
            ← Design System
          </Link>
          <h1 className="font-bold text-2xl mt-2 mb-2">OxMarkdown</h1>
          <p className="text-sm font-mono subtle-text">
            The planned successor to MdxEditor — this page is a live playground and
            running decision log, updated as each build step lands. Full technical
            detail lives in the <code>oxmarkdown</code> agent skill; this page is the
            quick, visual version.
          </p>
        </div>

        <Section id="status" title="Status">
          <p className="text-sm mb-2">
            <strong>Build plan steps 1–4 done</strong> — real document model
            (<code>oxmarkdown/document.ts</code>), themable renderer
            (<code>OxRenderer</code>, <code>oxmarkdown.css</code>), Interacting-mode{" "}
            <code>OxEditor</code> (task checkboxes, directive attribute popovers — try
            the Interactables section below), and now full Editing mode on a trimmed
            Lexical foundation — free-form typing, live markdown shortcuts, a native
            checklist, directive select/remove, undo, and a <code>/</code>{" "}
            slash-command menu (try the Editing mode section below), plus a refinement
            pass (undo coalescing verified, a dark-mode contrast bug fixed, two real bugs
            caught by a deliberate code sweep), plus a hands-on editing-behavior pass driven
            entirely by Gerald testing the live surface — blank lines reworked into ordinary
            empty paragraphs (no more decorator node, no more margin standing in for a real
            line), checklists rebuilt on a real <code>OxListItemNode</code> after a live-
            caught render/markdown mismatch showed the previous fix wasn't good enough, delete
            simplified to always fully remove (no more soft revert-to-text step), and typing{" "}
            <code>[ ] </code>/<code>::name{'{attrs}'}</code>/pasting plain text now all live-convert
            through the real parser instead of landing as literal text (see the decision log for
            the full arc on all of these). Step 5 (a hands-on mobile UX pass) is next.
          </p>
        </Section>

        <Section id="try-it" title="Try it">
          <Label>Markdown source</Label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            className="w-full text-sm font-mono p-3 rounded mb-6"
            style={{
              minHeight: "220px",
              background: "var(--midground)",
              color: "var(--purple)",
              border: "1px solid var(--foreground)",
            }}
          />

          <div className="flex flex-wrap gap-4 mb-6">
            <div style={{ minWidth: "220px" }}>
              <Label>Theme: font-family override</Label>
              <input
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                placeholder="e.g. ui-monospace, monospace"
                className="text-sm font-mono p-2 rounded w-full"
                style={{
                  background: "var(--midground)",
                  color: "var(--purple)",
                  border: "1px solid var(--foreground)",
                }}
              />
            </div>
            <div style={{ minWidth: "160px" }}>
              <Label>Theme: accent color override</Label>
              <input
                value={colorAccent}
                onChange={(e) => setColorAccent(e.target.value)}
                placeholder="e.g. #2f855a"
                className="text-sm font-mono p-2 rounded w-full"
                style={{
                  background: "var(--midground)",
                  color: "var(--purple)",
                  border: "1px solid var(--foreground)",
                }}
              />
            </div>
          </div>

          <Label>Rendered (OxRenderer)</Label>
          <div className="good-box p-4">
            <OxRenderer
              markdown={markdown}
              directives={DEMO_DIRECTIVES}
              theme={{
                fontFamily: fontFamily || undefined,
                colorAccent: colorAccent || undefined,
              }}
            />
          </div>
        </Section>

        <Section id="interactables" title="Interactables (Interacting mode)">
          <p className="text-sm subtle-text mb-4">
            <code>OxEditor</code> with <code>mode="interacting"</code>. Click a
            checkbox to select-and-toggle in one motion; Tab to it and press Space or
            Tab to toggle without a mouse. Click a directive to select it and open a
            popover listing its attributes — editing a value there rewrites the
            directive's markdown directly. No free-form typing yet (that's Editing
            mode, step 4) — everything else here is read-only prose.
          </p>
          <Label>OxEditor (mode="interacting")</Label>
          <div className="good-box p-4 mb-3">
            <OxEditor
              mode="interacting"
              markdown={interactiveMarkdown}
              onChange={setInteractiveMarkdown}
              directives={DEMO_DIRECTIVES}
            />
          </div>
          <Label>Resulting markdown (re-serialized after each toggle/edit)</Label>
          <pre
            className="text-xs font-mono p-3 rounded"
            style={{ background: "var(--midground)", color: "var(--purple)", whiteSpace: "pre-wrap" }}
          >
            {interactiveMarkdown}
          </pre>
        </Section>

        <Section id="editing" title="Editing mode (build plan step 4)">
          <p className="text-sm subtle-text mb-4">
            <code>OxEditor</code> with <code>mode="editing"</code> — a trimmed Lexical
            config (see TODO 1 in the decision log). Free-form typing, real headings/
            lists/links/code via <code>@lexical/rich-text</code>/<code>list</code>/
            <code>link</code>/<code>code</code>, live markdown shortcuts (type{" "}
            <code>**bold**</code>, <code># heading</code>, <code>&gt; quote</code>, ...),
            a native checklist, undo/redo, and the same select-then-act model as
            Interacting mode for directives — arrow onto one or click it, then either
            key (Backspace or Delete) removes it outright. Try <code>/</code> at
            the start of a line for the slash-command menu (heading, list, divider,
            note) — or just type <code>[ ] </code> for a live checkbox, or type a
            leaf directive (<code>::badge{'{label="x"}'}</code>) and press Enter. Pasting
            plain text (a checklist, a directive, a whole snippet) re-parses it through
            the real parser too, not just literal characters. Known gap: a container
            directive's nested content isn't independently editable yet (renders
            read-only) — and anything this bridge doesn't have a real mapping for yet
            (tables, raw HTML) shows as a read-only passthrough rather than being
            silently dropped.
          </p>
          <Label>OxEditor (mode="editing")</Label>
          <div className="good-box p-4 mb-3">
            <OxEditor
              mode="editing"
              markdown={editingMarkdown}
              onChange={setEditingMarkdown}
              directives={DEMO_DIRECTIVES}
            />
          </div>
          <Label>Resulting markdown (re-serialized on every content change)</Label>
          <pre
            className="text-xs font-mono p-3 rounded"
            style={{ background: "var(--midground)", color: "var(--purple)", whiteSpace: "pre-wrap" }}
          >
            {editingMarkdown}
          </pre>
        </Section>

        <Section id="states" title="Interactable states (static)">
          <p className="text-sm subtle-text mb-4">
            The demo above is live — fine for trying things, but several of these
            states are transient (focus, an open popover) and hard to hold still
            long enough to actually look at. These are the same classes
            OxRenderer/OxEditor produce, applied directly, side by side.
          </p>

          <Label>Task checkbox</Label>
          <div className="flex flex-wrap gap-4 mb-6">
            <StateSwatch label="Unchecked">
              <span className="ox-task-checkbox" role="checkbox" aria-checked={false} />
            </StateSwatch>
            <StateSwatch label="Checked">
              <span className="ox-task-checkbox checked" role="checkbox" aria-checked={true} />
            </StateSwatch>
            <StateSwatch label="Selected, unchecked">
              <span
                className="ox-task-checkbox ox-selected"
                role="checkbox"
                aria-checked={false}
              />
            </StateSwatch>
            <StateSwatch label="Selected, checked">
              <span
                className="ox-task-checkbox checked ox-selected"
                role="checkbox"
                aria-checked={true}
              />
            </StateSwatch>
          </div>

          <Label>Directive (leaf)</Label>
          <div className="flex flex-wrap gap-4">
            <StateSwatch label="Default">
              <span className="ox-pill">
                <span className="ox-pill-chip">Try me</span>
              </span>
            </StateSwatch>
            <StateSwatch label="Selected (popover open)">
              <div className="ox-selected" style={{ position: "relative", display: "inline-block" }}>
                <span className="ox-pill">
                  <span className="ox-pill-chip">Try me</span>
                </span>
                {/* .ox-popover is `position: fixed` + JS-computed inset by
                    default (see OxRenderer.tsx) so it can escape any scroll
                    container in the real interactive component — this static
                    swatch has no trigger element to compute a position from,
                    so it overrides back to a plain relative placement. */}
                <div className="ox-popover" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0 }}>
                  <div className="ox-popover-title">::badge</div>
                  <label className="ox-popover-field">
                    <span>label</span>
                    <input defaultValue="Try me" />
                  </label>
                  <label className="ox-popover-field">
                    <span>size</span>
                    <input defaultValue="half" />
                  </label>
                </div>
              </div>
            </StateSwatch>
            <StateSwatch label="Unknown name">
              <div className="ox-directive-unknown ox-directive-unknown--block">
                Unknown block: ::mystery
              </div>
            </StateSwatch>
          </div>
        </Section>

        <Section id="decisions" title="Decision log">
          <div className="flex flex-col gap-6">
            {DECISIONS.map((d, i) => (
              <div key={i}>
                <div className="font-bold text-sm mb-1">{d.title}</div>
                <p className="text-sm subtle-text">{d.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AppLayout>
  );
}
