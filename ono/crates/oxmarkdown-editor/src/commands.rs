//! Editing-behavior fixups on top of `taino-edit`'s built-in defaults —
//! see this crate's README for the two real gaps these close:
//!
//! 1. **Enter always continues the current block's own type.**
//!    `taino-edit-core`'s base `Enter` binding (`split_block`) is a
//!    generic split with no "exit to paragraph" logic — confirmed by
//!    reading its source directly, not assumed. Real editors (Notion,
//!    Google Docs, ...) demote a heading's continuation to a plain
//!    paragraph, treat Enter inside a code block as a literal newline
//!    rather than a block split, and treat Enter on an EMPTY line
//!    directly inside a blockquote as "exit the blockquote" (mirroring
//!    how an empty list item already lifts out of its list). `Lists`'s
//!    own "smart Enter" (empty item -> lift, otherwise -> new item)
//!    already does the right thing for lists — nothing to fix there,
//!    confirmed by reading `taino-edit-extensions`'s source too.
//!
//!    The blockquote case is hand-rolled (`exit_blockquote_on_empty_
//!    paragraph`), NOT via `taino-edit-core`'s own generic `lift`
//!    command, for two REAL, confirmed-by-testing reasons: (a) `lift`
//!    never calls `tx.set_selection` after its replace, so the caret's
//!    default position-mapping through its "closed" slice replace lands
//!    somewhere else entirely (empirically: the FOLLOWING sibling, not
//!    the just-unwrapped content — confirmed live, reported as "cursor
//!    is placed on the line below"); and (b) `lift` only ever handles a
//!    wrapper with EXACTLY one child, declining outright for a
//!    blockquote with other paragraphs beside the empty one. The
//!    hand-rolled version instead mirrors `taino-edit-extensions`'s own
//!    `lift_list_item` (confirmed by reading its source): split the
//!    blockquote into a "before" piece, the lifted (now-unwrapped) empty
//!    paragraph, and an "after" piece — omitting whichever piece(s) end
//!    up empty — so pressing Enter on a trailing (or leading, or
//!    interior) empty line always exits at exactly that point, matching
//!    every real editor's own convention, with the caret explicitly
//!    placed inside the lifted paragraph.
//!
//!    **Shift+Enter has no soft/hard-break distinction at all** — a
//!    deliberate design call (this editor is closer to a code editor than
//!    a document editor): no `hard_break` node, no `<br>`, ever. In a
//!    plain paragraph or heading it's IDENTICAL to plain Enter (literally
//!    the same underlying functions); the only real difference is that
//!    inside a blockquote or list item, Shift+Enter never exits/lifts on
//!    an empty line the way plain Enter does — it always just splits,
//!    staying in the same container. See `shift_enter_fixups`'s own doc
//!    comment. (An earlier `hard_break`/`<br>`-atom-based version of this
//!    existed briefly and was removed: it hit a REAL, confirmed-by-
//!    testing `taino-edit-dom` bug where typing immediately after a
//!    trailing `<br>` in the live DOM merges into the preceding text run
//!    instead of following the break — moot now that there's no atom to
//!    trigger it at all.)
//! 2. **No input rules are wired into the Leptos adapter at all**, and
//!    `taino-edit-core`'s own `textblock_type_rule` helper (used for e.g.
//!    `## ` -> heading) has a REAL bug of its own: it never calls
//!    `tx.set_selection` after its `Transform::replace`, so the default
//!    selection-mapping behavior lands the caret OUTSIDE the newly
//!    retyped node entirely (confirmed by direct browser testing — typed
//!    text after `## ` landed as a bare, model-less DOM text node next to
//!    the empty `<h2>`, addable but not deletable, since depth-0
//!    positions decline every text command). This is specific to
//!    `textblock_type_rule`'s technique (delete the whole old block, then
//!    replace it with a brand-new, unrelated "closed" node) —
//!    `wrapping_rule` (used for `> ` -> blockquote) uses a
//!    content-PRESERVING `ReplaceAroundStep` instead, so its default
//!    mapping is fine and it's kept as-is. `taino-edit-core` has a real
//!    `InputRules`/`InputRule` primitive, but `taino-edit-dom`/
//!    `taino-edit-leptos` never call `InputRules::apply` anywhere —
//!    confirmed by searching both crates' source, not assumed. `App`'s
//!    own `on:input` listener (see `lib.rs`) is what actually invokes
//!    this, since the library doesn't.
//! 3. **Option/Ctrl+Backspace and Option/Ctrl+Delete (word delete) do
//!    nothing.** A REAL bug in `taino-edit-leptos`'s keydown handler,
//!    confirmed by reading its source directly: it decides whether to
//!    call `preventDefault()` using `matches!(key.key.as_str(),
//!    "Enter" | "Backspace" | "Delete")` — the raw key name only,
//!    ignoring modifiers entirely. So `preventDefault()` fires on ANY
//!    Backspace/Delete press regardless of Alt/Ctrl, blocking the
//!    browser's own native word-delete, while `base_keymap` registers
//!    only plain `"Backspace"`/`"Delete"` (no modifier variants) so
//!    nothing replaces it — exactly the reported "does nothing"
//!    symptom. Fixed here by registering explicit `"Alt-Backspace"`/
//!    `"Ctrl-Backspace"`/`"Alt-Delete"`/`"Ctrl-Delete"` keymap entries
//!    (both modifier conventions, since Mac uses Option/Alt and
//!    Windows/Linux use Ctrl for word-delete).
//! 4. **A directive atom is not actually atomic against ordinary
//!    commands** — a REAL, confirmed-live bug, root-caused (not
//!    papered over): `leaf_directive`/`text_directive` declare
//!    `content: Some("text*")` for their synthetic display label (see
//!    `oxmarkdown_schema`'s own doc comment on why), so `atom: true`
//!    only ever affects THIS crate's own click handling
//!    (`directive_popover.rs`) — it does nothing to stop plain keyboard
//!    ArrowLeft/Right navigation from an adjacent block landing a REAL
//!    `Text` caret one level inside a directive's own synthetic
//!    content, same as any ordinary textblock. Confirmed exactly how
//!    this manifested: with a caret trapped there, `split_block`'s own
//!    guard (`sel.is_empty()`, `rp.parent().node_type().is_block()`)
//!    has no atom-awareness at all and happily calls `Transform::split`
//!    on it — reported as "pressing Enter adds a new Badge", and it's
//!    exactly that: the ONE directive splits into TWO, each keeping the
//!    same name/attrs, because `split` doesn't know or care that this
//!    child's content isn't supposed to be human-edited text at all.
//!    Typing a plain character (confirmed live via Playwright, not
//!    guessed) is worse: Chrome's own native contenteditable
//!    "replace selected element" path fires (our `Selection::Node`,
//!    from clicking a directive — see `directive_popover.rs` — is a
//!    genuine DOM Range around the whole element), which deletes the
//!    element and inserts the typed text wrapped in copied-inline-style
//!    `<font>`/`<span style>`/`<b>` tags neither this schema nor
//!    `read_dom_changes` has any tracked meaning for — genuinely
//!    corrupted, unrecoverable markup.
//!
//!    Fixed with `directive_at_selection` (finds either case — a real
//!    `Selection::Node` on any of the three directive types, or a
//!    `Text` caret trapped inside a leaf/text directive's own content
//!    specifically; `container_directive` is deliberately excluded from
//!    the SECOND case, since its content is genuinely, normally
//!    editable and a caret one level inside a real child paragraph is
//!    exactly where it belongs), plus new keymap entries: `"ArrowLeft"`/
//!    `"ArrowRight"` chained ahead of the base `caret_left`/
//!    `caret_right`; `"ArrowUp"`/`"ArrowDown"`, unbound before now; and
//!    `" "`, also unbound before now — the ONLY way to intercept a
//!    keystroke BEFORE Chrome's own native contenteditable handling ever
//!    sees it and corrupts something, confirmed by reading `taino-edit-
//!    leptos`'s keydown handler: it calls `prevent_default()` whenever a
//!    bound command actually handles the key, same mechanism `Enter`/
//!    `Backspace`/`Delete` already lean on. Arrow keys escape via
//!    `exit_directive`, always landing in a REAL textblock: an adjacent
//!    sibling directive is selected as a `Node` in turn (individually
//!    navigable, matching the `oxmarkdown` skill's own convention), an
//!    adjacent plain block is landed inside directly, and — the part
//!    making "always able to arrow out, even with nothing next to it"
//!    true — a fresh empty paragraph is inserted and landed in when
//!    there's genuinely nothing there at all.
//!
//!    **Enter and Space each needed their OWN escape shape, not
//!    `exit_directive`'s — confirmed live, not assumed**: reported live,
//!    reusing the arrow-key escape for Enter meant pressing Enter right
//!    after a directive that HAPPENED to have another directive sitting
//!    next to it (e.g. a `::badge` immediately before a `:::gallery`)
//!    jumped straight to selecting that unrelated gallery — surprising,
//!    since Enter means "give me a new line," never "jump to select
//!    something else." `exit_directive_with_new_line` always inserts a
//!    fresh paragraph, unconditionally, ignoring whatever already
//!    follows. Space is different again: exiting immediately on the
//!    FIRST press felt like fighting the user — the real, confirmed-
//!    right call is for the first Space to append a literal space to
//!    the directive's own visible content (landing a caret right after
//!    it, `caret_trapped_in_directive`'s own case now), so a SECOND
//!    Space (typed right after, at that same trapped position) is what
//!    actually exits — see `space_in_directive`'s own doc comment for
//!    the known, accepted tradeoff (this edits visible content, not the
//!    underlying `attributes` attr).
//! 5. **The caret could land immediately BEFORE a `checkbox` atom** —
//!    reported live: a checkbox is always its list item's own leading
//!    glyph (`convert::convert_list_item`/`checkbox_on_input` both only
//!    ever prepend it as the paragraph's FIRST inline child), so "the
//!    position right before it" is never a meaningful place to type —
//!    it's the paragraph's own content-start, and typing there inserts
//!    text to the LEFT of the checkbox, which no real task-list syntax
//!    can even represent (GFM's own `[ ]`/`[x]` is always the line's
//!    first thing). `taino-edit-core`'s base `caret_left`/`caret_line_
//!    start` have no atom-awareness here either — same root shape as
//!    item 4, a DIFFERENT symptom. Fixed by peeking at what the base
//!    command would land on (running it against a throwaway capture,
//!    then inspecting the result via `state.apply`) and, if that's
//!    immediately before a leading checkbox, walking further back via
//!    `skip_before_checkbox` — to the END of whatever textblock precedes
//!    the checkbox's own list item (always a meaningful position,
//!    regardless of what THAT block itself starts with), recursing
//!    outward again if even THAT turns out to be `before_leading_
//!    checkbox` too (the list's own first item). Deliberately scoped to
//!    `"ArrowLeft"`/`"Home"` only — both real keymap entries we control;
//!    native vertical `"ArrowUp"` movement has no keymap hook to peek at
//!    all (confirmed: nothing binds plain `"ArrowUp"` for ordinary
//!    vertical movement, only this crate's OWN directive-escape entry,
//!    which declines whenever no directive is involved), so it can still
//!    land there — a known, narrower-than-ideal residual gap, not
//!    attempted here.

use regex::Captures;
use taino_edit_core::{
    caret_left, caret_line_start, wrapping_rule, Fragment, InputRule, InputRules,
};
use taino_edit_extensions::Extension;
use taino_edit_leptos::{
    split_block, AttrValue, Attrs, Command, Dispatch, EditorState, Node, ResolvedPos, Schema,
    Selection, Slice, Transaction,
};

/// Registered as one more `Extension` purely for its `Enter` override —
/// contributes no schema. Placed AFTER `Lists` in `lib.rs`'s extension
/// list so `build_keymap_with`'s own chaining (\"the later one is tried
/// first, the earlier becomes its fallback\") tries this first, then
/// falls back through `Lists`'s smart Enter, then the base keymap's
/// plain `split_block` — each one declining (returning `false`) when
/// it doesn't apply, exactly like `Lists`'s own chain already does.
pub struct EditingFixups;

impl Extension for EditingFixups {
    fn name(&self) -> &str {
        "editing_fixups"
    }

    fn keymap_entries(&self, _schema: &Schema) -> Vec<(String, Command)> {
        vec![
            ("Enter".to_string(), enter_fixups()),
            ("Shift-Enter".to_string(), shift_enter_fixups()),
            ("Alt-Backspace".to_string(), Box::new(word_delete_backward)),
            ("Ctrl-Backspace".to_string(), Box::new(word_delete_backward)),
            ("Alt-Delete".to_string(), Box::new(word_delete_forward)),
            ("Ctrl-Delete".to_string(), Box::new(word_delete_forward)),
            ("ArrowLeft".to_string(), arrow_left_fixups()),
            ("ArrowRight".to_string(), exit_directive_forward()),
            ("ArrowUp".to_string(), exit_directive_backward()),
            ("ArrowDown".to_string(), exit_directive_forward()),
            (" ".to_string(), space_in_directive()),
            ("Home".to_string(), caret_line_start_fixups()),
        ]
    }
}

/// Shift+Enter: on a philosophy call (this editor is closer to a code
/// editor than a document editor), there is deliberately NO soft/hard
/// line-break distinction at all — no `hard_break` node, no `<br>`. In a
/// plain paragraph or heading, Shift+Enter does EXACTLY what plain Enter
/// does (reusing the very same `code_block_literal_newline`/`exit_
/// heading_to_paragraph` functions `enter_fixups` uses — not just
/// matching behavior, but the identical code path). The one real
/// difference from plain Enter: inside a blockquote or list item,
/// Shift+Enter NEVER exits/lifts, even on an empty line — it always just
/// splits the current textblock into a sibling, staying in the same
/// container. That turns out to need no container-specific code at all:
/// a single-level `split_block` (the same base command a bare `"Enter"`
/// falls back to when nothing else claims it) inherently only ever splits
/// the immediate textblock, never lifts or joins anything — confirmed by
/// reading its source (see `enter_fixups`'s own doc comment on `lift`
/// elsewhere in this file for the contrast). The blockquote-exit-on-empty
/// and list-lift-on-empty behaviors are each an EXTRA layer bolted on top
/// of plain Enter (by `enter_fixups` and `Lists` respectively) that a
/// fresh `"Shift-Enter"` keymap entry simply never triggers by calling
/// `split_block` directly instead of going through either of them.
const DIRECTIVE_NODE_TYPES: [&str; 3] = ["leaf_directive", "container_directive", "text_directive"];
const CARET_TRAP_DIRECTIVE_TYPES: [&str; 2] = ["leaf_directive", "text_directive"];

/// Finds the directive an Enter/Arrow/Space press should ESCAPE rather
/// than edit — see this module's own doc comment (item 4) for the two
/// real cases this covers (`directive_selected_as_unit`/`caret_trapped_
/// in_directive`) and why `container_directive` is excluded from the
/// second one. `None` means the current selection has nothing to do
/// with a directive at all, so callers should fall through to their
/// ordinary behavior. Side-effect-free (only reads `state`), so callers
/// can check it BEFORE deciding whether to consume `dispatch`.
fn directive_at_selection(state: &EditorState) -> Option<(usize, Node)> {
    directive_selected_as_unit(state).or_else(|| caret_trapped_in_directive(state))
}

/// Case (a): the directive is genuinely selected as a whole unit —
/// either a real `Selection::Node`, or the degraded live-DOM shape a
/// `Selection::Node` decays into.
///
/// **A real, confirmed-live gap in `taino-edit-dom` itself, worked
/// around here, not upstream**: `EditorView::read_selection` ALWAYS
/// reconstructs `Selection::Text`, never `Selection::Node` — confirmed
/// by reading its source directly — and `taino-edit-leptos`'s keydown
/// handler re-reads the LIVE DOM selection at the top of every single
/// keydown, unconditionally overwriting whatever `Selection::Node` a
/// previous click (`directive_popover.rs`) had set. So by the time this
/// runs, a directive that's genuinely still selected on screen shows up
/// as a `Text` RANGE whose `anchor`/`head` happen to exactly bracket the
/// node, not as `Selection::Node` at all — checked for explicitly below
/// (the plain `Selection::Node` branch stays for direct model-level
/// callers, e.g. this module's own native tests, which never round-trip
/// through a live DOM read at all).
fn directive_selected_as_unit(state: &EditorState) -> Option<(usize, Node)> {
    let sel = state.selection();
    if let Selection::Node { pos } = sel {
        let node = state.doc().node_at(pos)?;
        return DIRECTIVE_NODE_TYPES
            .contains(&node.node_type().name())
            .then_some((pos, node));
    }
    if let Selection::Text { anchor, head } = sel {
        if anchor != head {
            let (from, to) = (anchor.min(head), anchor.max(head));
            let node = state.doc().node_at(from)?;
            return (DIRECTIVE_NODE_TYPES.contains(&node.node_type().name())
                && from + node.node_size() == to)
                .then_some((from, node));
        }
    }
    None
}

/// Case (b): a plain, empty `Text` caret ended up INSIDE a leaf/text
/// directive's own synthetic content (reachable via ordinary keyboard
/// navigation — see this module's own doc comment, item 4).
/// `container_directive` is deliberately excluded: its content is
/// genuinely, normally editable.
fn caret_trapped_in_directive(state: &EditorState) -> Option<(usize, Node)> {
    let sel = state.selection();
    if !sel.is_empty() {
        return None;
    }
    let rp = ResolvedPos::resolve(state.doc(), sel.from()).ok()?;
    if rp.depth() == 0 {
        return None;
    }
    let parent = rp.parent();
    if CARET_TRAP_DIRECTIVE_TYPES.contains(&parent.node_type().name()) {
        return Some((rp.before(rp.depth()), parent.clone()));
    }
    None
}

/// Escapes `state`'s current directive selection/trap (see `directive_
/// at_selection`) in `forward`/backward direction, ALWAYS landing in a
/// real textblock — selecting an adjacent directive in turn (matching
/// the `oxmarkdown` skill's own "individually navigable" convention),
/// landing inside an adjacent plain block directly, or inserting a
/// fresh empty paragraph when there's genuinely nothing there. Declines
/// (`false`) when the selection isn't actually at/inside a directive.
fn exit_directive(state: &EditorState, dispatch: Option<&mut Dispatch<'_>>, forward: bool) -> bool {
    let Some((start, node)) = directive_at_selection(state) else {
        return false;
    };
    let Some(d) = dispatch else {
        return true;
    };
    let mut tx = state.tr();
    let boundary = if forward {
        start + node.node_size()
    } else {
        start
    };
    let Some(sel) = landing_selection(&mut tx, state, boundary, forward) else {
        return false;
    };
    tx.set_selection(sel);
    d(tx);
    true
}

fn exit_directive_forward() -> Command {
    Box::new(|state, dispatch| exit_directive(state, dispatch, true))
}

fn exit_directive_backward() -> Command {
    Box::new(|state, dispatch| exit_directive(state, dispatch, false))
}

/// The actual landing spot for `exit_directive`, at `boundary` (the
/// directive's own start position when escaping backward, or the
/// position right after it when escaping forward).
fn landing_selection(
    tx: &mut Transaction,
    state: &EditorState,
    boundary: usize,
    forward: bool,
) -> Option<Selection> {
    let doc = state.doc();
    let sibling = if forward {
        doc.node_at(boundary)
    } else if boundary == 0 {
        None
    } else {
        ResolvedPos::resolve(doc, boundary).ok()?.node_before()
    };
    if let Some(sib) = sibling {
        if DIRECTIVE_NODE_TYPES.contains(&sib.node_type().name()) {
            let sel_pos = if forward {
                boundary
            } else {
                boundary - sib.node_size()
            };
            return Some(Selection::Node { pos: sel_pos });
        }
        // A real block — land just inside it, at its own content start
        // (forward) or content end (backward) — the same ±1 offset
        // `split_block` itself uses for a freshly split block's landing
        // caret.
        let caret = if forward { boundary + 1 } else { boundary - 1 };
        return Some(Selection::caret(caret));
    }
    // Nothing there at all — insert a fresh empty paragraph and land
    // inside it, so escaping is ALWAYS possible regardless of context.
    insert_landing_paragraph(tx, state, boundary)
}

/// Inserts a brand-new empty paragraph at `boundary` and returns a caret
/// landing inside it — UNCONDITIONALLY, regardless of whatever already
/// follows. Used by Enter specifically (see `exit_directive_with_new_
/// line`): reported live, and confirmed correct as a real UX call, not
/// just a bug — `landing_selection`'s "select an adjacent directive
/// instead of drilling in" is the right call for ARROW-key navigation
/// (moving onto the next thing), but Enter means "give me a new line,"
/// full stop — it should never jump to selecting some unrelated
/// directive that merely happens to already sit right after this one.
fn insert_landing_paragraph(
    tx: &mut Transaction,
    state: &EditorState,
    boundary: usize,
) -> Option<Selection> {
    let schema = state.schema();
    let para = schema
        .node("paragraph", Attrs::new(), vec![], vec![])
        .ok()?;
    tx.transform()
        .replace(
            boundary,
            boundary,
            Slice::new(Fragment::from_node(para), 0, 0),
            schema,
        )
        .ok()?;
    Some(Selection::caret(boundary + 1))
}

/// Enter's own directive-escape: ALWAYS inserts a fresh paragraph right
/// after the directive and lands there — see `insert_landing_paragraph`
/// for why this is deliberately NOT `exit_directive`'s own "select an
/// adjacent directive/land inside an adjacent block" logic.
fn exit_directive_with_new_line(state: &EditorState, dispatch: Option<&mut Dispatch<'_>>) -> bool {
    let Some((start, node)) = directive_at_selection(state) else {
        return false;
    };
    let Some(d) = dispatch else {
        return true;
    };
    let mut tx = state.tr();
    let boundary = start + node.node_size();
    let Some(sel) = insert_landing_paragraph(&mut tx, state, boundary) else {
        return false;
    };
    tx.set_selection(sel);
    d(tx);
    true
}

/// Space's own directive handling — NOT the same as Enter/Arrow's exit
/// (see this module's own doc comment, item 4, for the corruption this
/// replaces): reported live, and confirmed correct as a real UX call:
/// while the directive is genuinely still SELECTED AS A UNIT, Space
/// appends a literal space to its own visible content instead of
/// exiting outright — landing a real caret right after it, so a
/// SECOND Space (now `caret_trapped_in_directive`'s own case) exits
/// forward exactly like Enter/Arrow already do. A single Space thus
/// reads naturally as "start typing here"; a second reads as "okay,
/// move on."
///
/// Deliberately edits the directive's rendered CONTENT directly, not
/// its `attributes` attr (e.g. `"badge"`'s own `label`) — keeps this
/// generic across every directive kind (a generic fallback directive's
/// own raw-syntax label has no single "the text" attribute to update at
/// all), at the cost of a known, accepted tradeoff: reopening the
/// attrs-editing popover (`directive_popover.rs`) and hitting Save
/// regenerates content FROM `attributes` again, discarding a quick
/// Space-edit that was never written back into it.
fn space_in_directive() -> Command {
    Box::new(|state, dispatch| {
        if let Some((start, node)) = directive_selected_as_unit(state) {
            let Some(d) = dispatch else {
                return true;
            };
            let Ok(space) = state.schema().text(" ", vec![]) else {
                return false;
            };
            let content_end = start + node.node_size() - 1;
            let mut tx = state.tr();
            if tx
                .transform()
                .replace(
                    content_end,
                    content_end,
                    Slice::new(Fragment::from_node(space), 0, 0),
                    state.schema(),
                )
                .is_err()
            {
                return false;
            }
            tx.set_selection(Selection::caret(content_end + 1));
            d(tx);
            return true;
        }
        if caret_trapped_in_directive(state).is_some() {
            return exit_directive(state, dispatch, true);
        }
        false
    })
}

/// Whether `pos` sits immediately before a `checkbox` that is the very
/// FIRST inline child of its paragraph — see this module's own doc
/// comment (item 5) for why that's never a meaningful place for a
/// caret: a checkbox is always its list item's own leading glyph,
/// never preceded by real text within the same paragraph.
fn is_before_leading_checkbox(doc: &Node, pos: usize) -> bool {
    let Ok(rp) = ResolvedPos::resolve(doc, pos) else {
        return false;
    };
    rp.parent_offset() == 0
        && rp
            .node_after()
            .is_some_and(|n| n.node_type().name() == "checkbox")
}

/// The next position further back worth landing on, when `pos` would
/// otherwise sit right before a leading checkbox: the END of whatever
/// textblock precedes the checkbox's own list item, if anything —
/// always a meaningful position, regardless of what THAT block itself
/// happens to start with. Loops (not just one hop) since the list's own
/// FIRST item's checkbox has the exact same problem one level further
/// out. Returns the ORIGINAL `pos` unchanged when it was already fine
/// (the common case), so callers never need a separate "did this even
/// apply" check. `None` means there's genuinely nothing meaningful
/// further back either (the very start of the document) — callers
/// should decline entirely, same as the base command would there.
fn skip_before_checkbox(state: &EditorState, pos: usize) -> Option<usize> {
    let mut pos = pos;
    while is_before_leading_checkbox(state.doc(), pos) {
        let rp = ResolvedPos::resolve(state.doc(), pos).ok()?;
        if rp.depth() < 2 {
            return None;
        }
        let outer_depth = rp.depth() - 1;
        let before_outer = rp.before(outer_depth);
        if before_outer == 0 {
            return None;
        }
        // Jump to just before the ENCLOSING list_item, then let the
        // BASE `caret_left` find where that actually lands — it
        // already knows how to walk backward to the nearest valid text
        // position, correctly handling the depth ambiguity right at a
        // block boundary (confirmed live: hand-computing `before_outer
        // - 1` directly can resolve one level SHALLOWER than intended,
        // landing on the enclosing `list_item`'s own content-end rather
        // than the preceding paragraph's, which then fails the "is this
        // a real textblock" check below for no real reason). Naturally
        // recurses into this SAME loop if the list's own first item has
        // the identical problem one level further out.
        let mut probe = state.clone();
        let mut seek = probe.tr();
        seek.set_selection(Selection::caret(before_outer));
        probe = probe.apply(seek);
        let mut found = None;
        {
            let mut capture = |t: Transaction| found = Some(t);
            if !caret_left(&probe, Some(&mut capture)) {
                return None;
            }
        }
        let landed = probe.apply(found?);
        pos = landed.selection().from();
    }
    Some(pos)
}

/// ArrowLeft: directive-escape takes priority (see `exit_directive`),
/// then the checkbox fixup (item 5) — peeks at where the BASE `caret_
/// left` would land (by running it against a throwaway capture and
/// inspecting the result via `state.apply`, since `taino-edit-core`
/// keeps its own walking logic private) and corrects it via `skip_
/// before_checkbox` when needed.
fn arrow_left_fixups() -> Command {
    Box::new(|state, dispatch| {
        if directive_at_selection(state).is_some() {
            return exit_directive(state, dispatch, false);
        }
        let sel = state.selection();
        if !sel.is_empty() {
            return false;
        }
        let mut peeked_tx = None;
        {
            let mut capture = |tx: Transaction| peeked_tx = Some(tx);
            if !caret_left(state, Some(&mut capture)) {
                return false;
            }
        }
        let Some(tx) = peeked_tx else {
            return true;
        };
        let peeked = state.apply(tx);
        let Some(landing) = skip_before_checkbox(&peeked, peeked.selection().from()) else {
            return false;
        };
        let Some(d) = dispatch else {
            return true;
        };
        let mut fixed = state.tr();
        fixed.set_selection(Selection::caret(landing));
        d(fixed);
        true
    })
}

/// Home: same checkbox fixup as `arrow_left_fixups`, layered onto the
/// base `caret_line_start` — landing at "the start of this line" is
/// exactly the OTHER real way to reach the position right before a
/// leading checkbox. Unlike ArrowLeft (a pure navigation gesture, fine
/// declining outright at a true boundary — matching how it already
/// behaves at the very start of a document), Home should always land
/// SOMEWHERE: when `skip_before_checkbox` finds nothing meaningful
/// further back either, this falls back to right after the checkbox
/// itself — the most sensible "start of line" a checkbox-led paragraph
/// actually has.
fn caret_line_start_fixups() -> Command {
    Box::new(|state, dispatch| {
        let mut peeked_tx = None;
        {
            let mut capture = |tx: Transaction| peeked_tx = Some(tx);
            if !caret_line_start(state, Some(&mut capture)) {
                return false;
            }
        }
        let Some(tx) = peeked_tx else {
            return true;
        };
        let peeked = state.apply(tx);
        let landing = peeked.selection().from();
        let fixed_landing = skip_before_checkbox(&peeked, landing).unwrap_or(landing + 1);
        let Some(d) = dispatch else {
            return true;
        };
        let mut fixed = state.tr();
        fixed.set_selection(Selection::caret(fixed_landing));
        d(fixed);
        true
    })
}

fn shift_enter_fixups() -> Command {
    Box::new(|state, dispatch| {
        if directive_at_selection(state).is_some() {
            return exit_directive_with_new_line(state, dispatch);
        }
        let sel = state.selection();
        if !sel.is_empty() {
            return false;
        }
        let pos = sel.from();
        let Ok(rp) = ResolvedPos::resolve(state.doc(), pos) else {
            return false;
        };
        if rp.depth() == 0 {
            return false;
        }
        match rp.parent().node_type().name() {
            "code_block" => code_block_literal_newline(state, dispatch, pos),
            "heading" => exit_heading_to_paragraph(state, dispatch, pos),
            _ => split_block(state, dispatch),
        }
    })
}

/// Delete from an empty caret backward through any trailing whitespace and
/// then one "word" (a run of non-whitespace characters), all within the
/// current textblock — the standard Option/Ctrl+Backspace behavior. Declines
/// (returns `false`) at the very start of the textblock so the keymap's own
/// chaining (see `EditingFixups::keymap_entries`, tried before nothing else
/// is bound to `Alt-`/`Ctrl-Backspace`) leaves cross-block joining to a
/// plain Backspace instead of silently doing nothing there.
fn word_delete_backward(state: &EditorState, dispatch: Option<&mut Dispatch<'_>>) -> bool {
    let sel = state.selection();
    if !sel.is_empty() {
        return false;
    }
    let pos = sel.from();
    let Ok(rp) = ResolvedPos::resolve(state.doc(), pos) else {
        return false;
    };
    if rp.depth() == 0 {
        return false;
    }
    let start = rp.start(rp.depth());
    if pos <= start {
        return false;
    }
    let Ok(slice) = state.doc().slice(start, pos) else {
        return false;
    };
    let text: String = slice.content().iter().map(|n| n.text_content()).collect();
    let chars: Vec<char> = text.chars().collect();
    let mut i = chars.len();
    while i > 0 && chars[i - 1].is_whitespace() {
        i -= 1;
    }
    while i > 0 && !chars[i - 1].is_whitespace() {
        i -= 1;
    }
    if i == chars.len() {
        return false;
    }
    let delete_from = pos - (chars.len() - i);
    if let Some(d) = dispatch {
        let mut tx = state.tr();
        if tx
            .transform()
            .delete(delete_from, pos, state.schema())
            .is_ok()
        {
            tx.set_selection(Selection::caret(delete_from));
            d(tx);
        }
    }
    true
}

/// Delete from an empty caret forward through any leading whitespace and
/// then one "word", all within the current textblock — the standard
/// Option/Ctrl+Delete behavior. Declines at the very end of the textblock,
/// same reasoning as `word_delete_backward` above.
fn word_delete_forward(state: &EditorState, dispatch: Option<&mut Dispatch<'_>>) -> bool {
    let sel = state.selection();
    if !sel.is_empty() {
        return false;
    }
    let pos = sel.from();
    let Ok(rp) = ResolvedPos::resolve(state.doc(), pos) else {
        return false;
    };
    if rp.depth() == 0 {
        return false;
    }
    let end = rp.end(rp.depth());
    if pos >= end {
        return false;
    }
    let Ok(slice) = state.doc().slice(pos, end) else {
        return false;
    };
    let text: String = slice.content().iter().map(|n| n.text_content()).collect();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    while i < chars.len() && !chars[i].is_whitespace() {
        i += 1;
    }
    if i == 0 {
        return false;
    }
    let delete_to = pos + i;
    if let Some(d) = dispatch {
        let mut tx = state.tr();
        if tx
            .transform()
            .delete(pos, delete_to, state.schema())
            .is_ok()
        {
            d(tx);
        }
    }
    true
}

fn enter_fixups() -> Command {
    Box::new(|state, dispatch| {
        if directive_at_selection(state).is_some() {
            return exit_directive_with_new_line(state, dispatch);
        }
        let sel = state.selection();
        if !sel.is_empty() {
            return false;
        }
        let pos = sel.from();
        let Ok(rp) = ResolvedPos::resolve(state.doc(), pos) else {
            return false;
        };
        if rp.depth() == 0 {
            return false;
        }
        match rp.parent().node_type().name() {
            "code_block" => code_block_literal_newline(state, dispatch, pos),
            "heading" => exit_heading_to_paragraph(state, dispatch, pos),
            "paragraph" if is_empty_paragraph_in_blockquote(&rp) => {
                exit_blockquote_on_empty_paragraph(state, dispatch, &rp)
            }
            _ => false,
        }
    })
}

/// Whether `rp`'s immediate parent is an EMPTY `paragraph` directly inside
/// a `blockquote` — the trigger condition for "Enter on an empty line
/// exits the blockquote", mirroring the same convention `Lists`'s own
/// smart Enter already uses for empty list items (confirmed by reading
/// `taino-edit-extensions`'s source: it also checks for an empty
/// textblock before lifting, rather than lifting on ANY Enter).
fn is_empty_paragraph_in_blockquote(rp: &ResolvedPos) -> bool {
    if rp.parent().content().size() != 0 {
        return false;
    }
    let depth = rp.depth();
    depth >= 2 && rp.node(depth - 1).node_type().name() == "blockquote"
}

/// Extract JUST the current empty paragraph out of its enclosing
/// blockquote, splitting the blockquote into "before"/"after" pieces
/// around it as needed (omitting whichever piece ends up empty) — the
/// same generalized technique `taino-edit-extensions`'s own
/// `lift_list_item` uses for lists, confirmed by reading its source.
/// Deliberately NOT `taino-edit-core`'s generic `lift` command: see this
/// module's own doc comment for the two real, confirmed-by-testing
/// reasons (missing `set_selection`, and only handling a single-child
/// wrapper).
fn exit_blockquote_on_empty_paragraph(
    state: &EditorState,
    dispatch: Option<&mut Dispatch<'_>>,
    rp: &ResolvedPos,
) -> bool {
    let bq_depth = rp.depth() - 1;
    let blockquote = rp.node(bq_depth).clone();
    let item_idx = rp.index(bq_depth);
    let bq_start = rp.before(bq_depth);
    let bq_end = rp.after(bq_depth);
    let lifted = rp.parent().clone();

    let children = blockquote.content().children();
    let before_items = children[..item_idx].to_vec();
    let after_items = children[item_idx + 1..].to_vec();

    let mut replacement: Vec<Node> = Vec::new();
    let mut before_size = 0;
    if !before_items.is_empty() {
        let Ok(n) = state.schema().node(
            "blockquote",
            blockquote.attrs().clone(),
            before_items,
            blockquote.marks().to_vec(),
        ) else {
            return false;
        };
        before_size = n.node_size();
        replacement.push(n);
    }
    replacement.push(lifted);
    if !after_items.is_empty() {
        let Ok(n) = state.schema().node(
            "blockquote",
            blockquote.attrs().clone(),
            after_items,
            blockquote.marks().to_vec(),
        ) else {
            return false;
        };
        replacement.push(n);
    }

    let Some(d) = dispatch else { return true };
    let mut tx = state.tr();
    let slice = Slice::new(Fragment::from_nodes(replacement), 0, 0);
    if tx
        .transform()
        .replace(bq_start, bq_end, slice, state.schema())
        .is_err()
    {
        return false;
    }
    // Past any "before" blockquote, then the lifted paragraph's own open
    // token — right where its (empty) content starts.
    tx.set_selection(Selection::caret(bq_start + before_size + 1));
    d(tx);
    true
}

/// Enter inside a code block inserts a literal newline character
/// in-place, matching every real code editor's own convention, rather
/// than splitting into two separate `code_block` nodes.
fn code_block_literal_newline(
    state: &taino_edit_leptos::EditorState,
    dispatch: Option<&mut taino_edit_leptos::Dispatch<'_>>,
    pos: usize,
) -> bool {
    let Some(d) = dispatch else { return true };
    let Ok(text) = state.schema().text("\n", vec![]) else {
        return false;
    };
    let mut tx = state.tr();
    if tx
        .transform()
        .insert(
            pos,
            Slice::new(Fragment::from_node(text), 0, 0),
            state.schema(),
        )
        .is_err()
    {
        return false;
    }
    tx.set_selection(Selection::caret(pos + 1));
    d(tx);
    true
}

/// Enter at any point in a heading splits it (same physical split
/// `split_block` already does), then retypes the SECOND half to a
/// plain `paragraph` — matching every real editor's own convention
/// that a heading's continuation is prose, not another heading.
/// Reuses the same "compute positions against the transform's own
/// post-step document" technique `taino-edit-core`'s own
/// `textblock_type_rule`/`wrapping_rule` use internally, since
/// `Transform::split` has no "retype the result" option of its own.
fn exit_heading_to_paragraph(
    state: &taino_edit_leptos::EditorState,
    dispatch: Option<&mut taino_edit_leptos::Dispatch<'_>>,
    pos: usize,
) -> bool {
    let Some(d) = dispatch else { return true };
    let mut tx = state.tr();
    if tx.transform().split(pos, state.schema()).is_err() {
        return false;
    }
    // `split_block` places the caret at `pos + 2` (open + close tokens)
    // — right at the start of the new second block. Resolved against
    // the transform's OWN post-split document, not the original.
    let new_pos = pos + 2;
    let post_split_doc = tx.transform().doc().clone();
    if let Ok(rp2) = ResolvedPos::resolve(&post_split_doc, new_pos) {
        let depth = rp2.depth();
        if depth > 0 && rp2.parent().node_type().name() == "heading" {
            let start = rp2.before(depth);
            let end = rp2.after(depth);
            let content = rp2.parent().content().children().to_vec();
            let marks = rp2.parent().marks().to_vec();
            if let Ok(new_block) = state
                .schema()
                .node("paragraph", Attrs::new(), content, marks)
            {
                let _ = tx.transform().replace(
                    start,
                    end,
                    Slice::new(Fragment::from_node(new_block), 0, 0),
                    state.schema(),
                );
            }
        }
    }
    tx.set_selection(Selection::caret(new_pos));
    d(tx);
    true
}

// ── Input rules ──────────────────────────────────────────────────────────
//
// Not wired into `taino-edit-leptos` at all (see this module's own doc
// comment) — `App`'s own `on:input` listener calls `InputRules::apply`
// after every state change; this just builds the ruleset once.

fn heading_attrs_from_hashes(caps: &Captures<'_>) -> Attrs {
    let level = caps
        .get(1)
        .map(|m| m.as_str().len())
        .unwrap_or(1)
        .clamp(1, 6) as u64;
    let mut attrs = Attrs::new();
    attrs.insert("level".to_string(), AttrValue::from(level));
    attrs
}

/// `"- "`/`"* "` (bullet) or `"1. "` (ordered) -> a real list, wrapping
/// the current paragraph in BOTH levels a list needs (`bullet_list`/
/// `ordered_list` -> `list_item` -> the original paragraph) in one
/// transaction. `taino-edit-core`'s own `wrapping_rule` helper only
/// wraps a single level (correct for `blockquote`, not enough for a
/// list), so this is a hand-written `InputRule` using the same
/// "resolve against the transform's own post-delete document" technique
/// `wrapping_rule` itself uses internally.
fn wrap_in_list_on_input(
    list_name: &'static str,
) -> impl Fn(
    &taino_edit_leptos::EditorState,
    &Captures<'_>,
    usize,
    usize,
) -> Option<taino_edit_leptos::Transaction> {
    move |state, _caps, from, to| {
        let mut tx = state.tr();
        tx.transform().delete(from, to, state.schema()).ok()?;
        let after = tx.transform().doc().clone();
        let rp = ResolvedPos::resolve(&after, from).ok()?;
        if rp.depth() == 0 {
            return None;
        }
        let block = rp.node(1).clone();
        let (start, end) = (rp.before(1), rp.after(1));
        let inner_paragraph = state
            .schema()
            .node(
                "paragraph",
                Attrs::new(),
                block.content().children().to_vec(),
                block.marks().to_vec(),
            )
            .ok()?;
        let list_item = state
            .schema()
            .node("list_item", Attrs::new(), vec![inner_paragraph], vec![])
            .ok()?;
        let list = state
            .schema()
            .node(list_name, Attrs::new(), vec![list_item], vec![])
            .ok()?;
        tx.transform()
            .replace(
                start,
                end,
                Slice::new(Fragment::from_node(list), 0, 0),
                state.schema(),
            )
            .ok()?;
        // Past the list's own open token, the item's own open token, and the
        // inner paragraph's own open token — right where the original
        // content (now minus the trigger text) starts.
        tx.set_selection(Selection::caret(start + 3));
        Some(tx)
    }
}

/// `"[ ] "`/`"[x] "` (or `"[X] "`) -> a real `checkbox` atom, but ONLY
/// when typed at the very start of a paragraph that is itself a list
/// item's own child — never in a plain top-level paragraph. This is
/// deliberately a SEPARATE rule from `wrap_in_list_on_input` above, not
/// one combined `"- [ ] "` pattern: `InputRules::apply` fires on EVERY
/// keystroke, so by the time a user has typed `"- "` the bullet-list
/// rule has ALREADY fired (2 keystrokes in) and converted the paragraph
/// into a list item, well before `"[ ] "` exists to match against at
/// all — confirmed by reasoning through the actual keystroke-by-keystroke
/// sequence, not assumed. Splitting it into two independent rules (one
/// for entering a list, one for turning the START of a list item's own
/// content into a checkbox) matches how the keystrokes actually arrive.
///
/// The `rp.node(rp.depth() - 1).node_type().name() == "list_item"` check
/// is what keeps a bare `"[ ] hello"` (no list marker) from ever
/// matching — correct per both the GFm task-list spec (a checkbox only
/// exists inside a list item) and the real product's own convention (see
/// the `oxmarkdown` skill). The `^`-anchored regex (via `InputRules`'s
/// own `text_before_caret`, computed from the block's own start) already
/// guarantees `"[ ] "` is the ENTIRE text so far in this paragraph — no
/// separate "nothing before it" check needed.
fn checkbox_on_input(
    state: &taino_edit_leptos::EditorState,
    caps: &Captures<'_>,
    from: usize,
    to: usize,
) -> Option<taino_edit_leptos::Transaction> {
    let rp = ResolvedPos::resolve(state.doc(), from).ok()?;
    if rp.depth() < 2 {
        return None;
    }
    if rp.parent().node_type().name() != "paragraph" {
        return None;
    }
    if rp.node(rp.depth() - 1).node_type().name() != "list_item" {
        return None;
    }
    let checked = matches!(caps.get(1).map(|m| m.as_str()), Some("x") | Some("X"));
    let mut tx = state.tr();
    tx.transform().delete(from, to, state.schema()).ok()?;
    let mut attrs = Attrs::new();
    attrs.insert("checked".to_string(), AttrValue::from(checked));
    let checkbox = state
        .schema()
        .node("checkbox", attrs, vec![], vec![])
        .ok()?;
    tx.transform()
        .insert(
            from,
            Slice::new(Fragment::from_node(checkbox), 0, 0),
            state.schema(),
        )
        .ok()?;
    // Past the checkbox atom itself (atom size 1) — right where the
    // original content (now minus the trigger text) starts.
    tx.set_selection(Selection::caret(from + 1));
    Some(tx)
}

/// `"## "` -> heading, retyping the current block in place. A hand-rolled
/// replacement for `taino-edit-core`'s own `textblock_type_rule` helper —
/// see this module's own doc comment for the real bug being worked around
/// (that helper never sets the selection after its replace, so the caret
/// maps to OUTSIDE the new node). Identical body to `textblock_type_rule`
/// itself, plus one added `tx.set_selection` call.
fn heading_type_on_input(
) -> impl Fn(&EditorState, &Captures<'_>, usize, usize) -> Option<Transaction> {
    move |state, caps, from, to| {
        let attrs = heading_attrs_from_hashes(caps);
        let mut tx = state.tr();
        tx.transform().delete(from, to, state.schema()).ok()?;
        let after = tx.transform().doc().clone();
        let rp = ResolvedPos::resolve(&after, from).ok()?;
        if rp.depth() == 0 {
            return None;
        }
        let block = rp.node(1).clone();
        let (start, end) = (rp.before(1), rp.after(1));
        let new_block = state
            .schema()
            .node(
                "heading",
                attrs,
                block.content().children().to_vec(),
                block.marks().to_vec(),
            )
            .ok()?;
        tx.transform()
            .replace(
                start,
                end,
                Slice::new(Fragment::from_node(new_block), 0, 0),
                state.schema(),
            )
            .ok()?;
        // Past the heading's own open token — right where the (now empty,
        // since the trigger text WAS the entire old content) content
        // starts. This is the one line `textblock_type_rule` is missing.
        tx.set_selection(Selection::caret(start + 1));
        Some(tx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oxmarkdown_schema::Checkbox;
    use taino_edit_extensions::{
        build_schema_with, redo_command, undo_command, Blockquote, Bold, CodeBlock, Heading,
        Italic, Lists, Paragraph,
    };
    use taino_edit_leptos::{EditorState, NodeSpec, SchemaBuilder};

    fn test_schema() -> Schema {
        let base = SchemaBuilder::new()
            .node(
                "doc",
                NodeSpec {
                    content: Some("block+".into()),
                    ..Default::default()
                },
            )
            .node(
                "text",
                NodeSpec {
                    group: Some("inline".into()),
                    ..Default::default()
                },
            );
        let exts: Vec<&dyn Extension> = vec![
            &Paragraph,
            &Heading,
            &Bold,
            &Italic,
            &Blockquote,
            &Lists,
            &CodeBlock,
            &Checkbox,
        ];
        build_schema_with(base, &exts, "doc").expect("schema builds")
    }

    /// A doc with `bullet_list > list_item > paragraph(text)`, caret at
    /// the paragraph's own end.
    fn state_with_list_item_paragraph(schema: &Schema, text: &str) -> EditorState {
        let text_node = schema.text(text, vec![]).expect("text node");
        let para = schema
            .node("paragraph", Attrs::new(), vec![text_node], vec![])
            .expect("paragraph");
        let item = schema
            .node("list_item", Attrs::new(), vec![para], vec![])
            .expect("list_item");
        let list = schema
            .node("bullet_list", Attrs::new(), vec![item], vec![])
            .expect("bullet_list");
        let doc = schema
            .node("doc", Attrs::new(), vec![list], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        // Position 3: past bullet_list's, list_item's, and paragraph's own
        // open tokens.
        let pos = 3 + text.chars().count();
        tx.set_selection(Selection::caret(pos));
        state = state.apply(tx);
        state
    }

    /// A doc with one paragraph containing `text`, caret at its end.
    fn state_with_paragraph(schema: &Schema, text: &str) -> EditorState {
        let text_node = schema.text(text, vec![]).expect("text node");
        let para = schema
            .node("paragraph", Attrs::new(), vec![text_node], vec![])
            .expect("paragraph");
        let doc = schema
            .node("doc", Attrs::new(), vec![para], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        // Position 1: past the paragraph's OWN open token (text nodes
        // have no open/close tokens of their own, unlike element nodes)
        // — landing right after `text`'s own `text.chars().count()`
        // characters, still INSIDE the paragraph (depth 1), not past its
        // closing token.
        let pos = 1 + text.chars().count();
        tx.set_selection(Selection::caret(pos));
        state = state.apply(tx);
        state
    }

    #[test]
    fn bullet_list_input_rule_fires_on_dash_space() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "- ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '- '");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("bullet_list"), "{json}");
        assert!(json.contains("list_item"), "{json}");
    }

    #[test]
    fn ordered_list_input_rule_fires_on_number_dot_space() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "1. ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '1. '");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("ordered_list"), "{json}");
    }

    #[test]
    fn checkbox_input_rule_fires_on_bracket_space_bracket_space_in_a_list_item() {
        let schema = test_schema();
        let state = state_with_list_item_paragraph(&schema, "[ ] ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '[ ] '");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("checkbox"), "{json}");
        assert!(json.contains("\"checked\":false"), "{json}");
        // The bracket text itself is consumed, not left behind.
        assert!(
            !next.doc().text_content().contains('['),
            "{}",
            next.doc().text_content()
        );
    }

    #[test]
    fn checkbox_input_rule_recognizes_x_as_checked() {
        let schema = test_schema();
        let state = state_with_list_item_paragraph(&schema, "[x] ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '[x] '");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("\"checked\":true"), "{json}");
    }

    #[test]
    fn checkbox_input_rule_recognizes_uppercase_x_as_checked() {
        let schema = test_schema();
        let state = state_with_list_item_paragraph(&schema, "[X] ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '[X] '");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("\"checked\":true"), "{json}");
    }

    /// Regression check for the exact behavior confirmed against a real
    /// GFM parser: a bare `"[ ] hello"` (no list marker at all) must NEVER
    /// become a checkbox — matching both the GFM task-list spec (a
    /// checkbox only exists inside a list item) and the real product's
    /// own convention.
    #[test]
    fn checkbox_input_rule_declines_in_a_plain_paragraph_not_in_a_list() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "[ ] ");
        let rules = build_input_rules(&schema);
        assert!(rules.apply(&state).is_none());
    }

    #[test]
    fn checkbox_input_rule_leaves_caret_right_after_the_checkbox() {
        let schema = test_schema();
        let state = state_with_list_item_paragraph(&schema, "[ ] ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match");
        let next = state.apply(tx);
        let pos = next.selection().from();
        let rp = ResolvedPos::resolve(next.doc(), pos).expect("caret should resolve");
        assert_eq!(rp.parent().node_type().name(), "paragraph");
        assert_eq!(rp.node(rp.depth() - 1).node_type().name(), "list_item");
    }

    #[test]
    fn heading_input_rule_fires_on_hashes_space() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "## ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '## '");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("heading"), "{json}");
    }

    /// Regression test for the real bug this module's own doc comment
    /// documents: `taino-edit-core`'s `textblock_type_rule` never sets the
    /// selection after retyping the block, so the caret used to land
    /// OUTSIDE the new heading entirely. Merely checking the doc's JSON
    /// (as `heading_input_rule_fires_on_hashes_space` above does) was NOT
    /// enough to catch this — it missed it originally — so this asserts
    /// the resulting SELECTION resolves to depth > 0 with an ancestor
    /// named "heading", i.e. actually inside the node, not just that the
    /// node exists somewhere in the doc.
    #[test]
    fn heading_input_rule_leaves_caret_inside_the_new_heading() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "## ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '## '");
        let next = state.apply(tx);
        let pos = next.selection().from();
        let rp = ResolvedPos::resolve(next.doc(), pos).expect("caret should resolve");
        assert!(
            rp.depth() > 0,
            "caret landed at top level, outside any block"
        );
        assert_eq!(rp.parent().node_type().name(), "heading");
    }

    /// Same shape of check for `> ` -> blockquote, using the library's own
    /// `wrapping_rule` (not hand-rolled here) — confirming its
    /// content-preserving `ReplaceAroundStep` technique does NOT have the
    /// same caret-escapes-the-node bug `textblock_type_rule` has.
    #[test]
    fn blockquote_input_rule_leaves_caret_inside_the_new_blockquote() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "> ");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '> '");
        let next = state.apply(tx);
        let pos = next.selection().from();
        let rp = ResolvedPos::resolve(next.doc(), pos).expect("caret should resolve");
        assert!(
            rp.depth() > 0,
            "caret landed at top level, outside any block"
        );
        assert_eq!(rp.parent().node_type().name(), "paragraph");
        assert_eq!(rp.node(1).node_type().name(), "blockquote");
    }

    /// A doc with a single `blockquote` containing one EMPTY `paragraph`,
    /// caret inside it — the shape you get right after typing `"> "` and
    /// then immediately pressing Enter with nothing else typed.
    fn state_with_empty_paragraph_in_blockquote(schema: &Schema) -> EditorState {
        let para = schema
            .node("paragraph", Attrs::new(), vec![], vec![])
            .expect("empty paragraph");
        let blockquote = schema
            .node("blockquote", Attrs::new(), vec![para], vec![])
            .expect("blockquote");
        let doc = schema
            .node("doc", Attrs::new(), vec![blockquote], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        // Position 2: past the blockquote's own open token (1) and the
        // paragraph's own open token (1) — inside the (empty) paragraph.
        tx.set_selection(Selection::caret(2));
        state = state.apply(tx);
        state
    }

    /// Regression test for the reported behavior: Enter on an empty line
    /// directly inside a blockquote should exit it, the same way an empty
    /// list item already lifts out of its list — see `is_empty_paragraph_
    /// in_blockquote`'s own doc comment.
    #[test]
    fn enter_on_empty_paragraph_in_blockquote_lifts_out() {
        let schema = test_schema();
        let state = state_with_empty_paragraph_in_blockquote(&schema);
        let next = dispatch_and_apply(&state, |s, d| enter_fixups()(s, d)).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(!json.contains("blockquote"), "{json}");
        // Regression check for the reported "cursor is placed on the line
        // below" symptom: the caret must resolve INSIDE the lifted
        // paragraph, not merely somewhere valid in the doc.
        let pos = next.selection().from();
        let rp = ResolvedPos::resolve(next.doc(), pos).expect("caret should resolve");
        assert_eq!(
            rp.depth(),
            1,
            "caret should be directly inside the top-level paragraph"
        );
        assert_eq!(rp.parent().node_type().name(), "paragraph");
    }

    /// The generalized case: a blockquote with a non-empty quote line
    /// AND a trailing empty line. Enter on the trailing empty line should
    /// exit ONLY that line, leaving the quote text still quoted.
    #[test]
    fn enter_on_trailing_empty_paragraph_in_multi_paragraph_blockquote_exits_just_that_line() {
        let schema = test_schema();
        let text_node = schema.text("hi", vec![]).expect("text node");
        let quote_para = schema
            .node("paragraph", Attrs::new(), vec![text_node], vec![])
            .expect("paragraph");
        let quote_para_size = quote_para.node_size();
        let empty_para = schema
            .node("paragraph", Attrs::new(), vec![], vec![])
            .expect("empty paragraph");
        let blockquote = schema
            .node(
                "blockquote",
                Attrs::new(),
                vec![quote_para, empty_para],
                vec![],
            )
            .expect("blockquote");
        let doc = schema
            .node("doc", Attrs::new(), vec![blockquote], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        // Past the blockquote's own open token, the whole quote paragraph,
        // and the empty paragraph's own open token.
        let pos = 1 + quote_para_size + 1;
        tx.set_selection(Selection::caret(pos));
        state = state.apply(tx);

        let next = dispatch_and_apply(&state, |s, d| enter_fixups()(s, d)).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(
            json.contains("blockquote") && json.contains("hi"),
            "the quote text should still be quoted: {json}"
        );
        let caret = next.selection().from();
        let rp = ResolvedPos::resolve(next.doc(), caret).expect("caret should resolve");
        assert_eq!(
            rp.depth(),
            1,
            "caret should be directly inside a TOP-LEVEL paragraph, not the blockquote"
        );
        assert_eq!(rp.parent().node_type().name(), "paragraph");
    }

    /// A non-empty paragraph inside a blockquote should NOT be lifted on
    /// Enter — only truly empty ones. Falls through to a plain split
    /// instead (still inside the blockquote).
    #[test]
    fn enter_on_non_empty_paragraph_in_blockquote_does_not_lift() {
        let schema = test_schema();
        let text_node = schema.text("hi", vec![]).expect("text node");
        let para = schema
            .node("paragraph", Attrs::new(), vec![text_node], vec![])
            .expect("paragraph");
        let blockquote = schema
            .node("blockquote", Attrs::new(), vec![para], vec![])
            .expect("blockquote");
        let doc = schema
            .node("doc", Attrs::new(), vec![blockquote], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(4)); // end of "hi"
        state = state.apply(tx);
        assert!(
            !enter_fixups()(&state, None),
            "should decline and fall through to the base split"
        );
    }

    /// For a plain top-level paragraph, the FULL "Enter" keymap chain
    /// (`enter_fixups` declines -> `Lists` declines -> base `split_block`)
    /// bottoms out at plain `split_block` — `enter_fixups()` ALONE declines
    /// for this case (it only knows about its own special cases; the
    /// "fall through to split_block" part only happens via the outer
    /// keymap's chaining, not by calling it directly), so `split_block` is
    /// the correct thing to compare `shift_enter_fixups()` against here.
    #[test]
    fn shift_enter_in_a_plain_paragraph_matches_plain_enter() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "hi");
        let via_shift_enter =
            dispatch_and_apply(&state, |s, d| shift_enter_fixups()(s, d)).expect("dispatched");
        let via_enter = dispatch_and_apply(&state, split_block).expect("dispatched");
        assert_eq!(
            serde_json::to_string(&via_shift_enter.doc().to_json()).unwrap(),
            serde_json::to_string(&via_enter.doc().to_json()).unwrap(),
        );
    }

    #[test]
    fn shift_enter_in_a_heading_matches_plain_enter_exit_to_paragraph() {
        let schema = test_schema();
        let text_node = schema.text("Title", vec![]).expect("text node");
        let mut attrs = Attrs::new();
        attrs.insert("level".to_string(), AttrValue::from(1u64));
        let heading = schema
            .node("heading", attrs, vec![text_node], vec![])
            .expect("heading");
        let doc = schema
            .node("doc", Attrs::new(), vec![heading], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(6)); // end of "Title"
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| shift_enter_fixups()(s, d)).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(
            json.contains("heading") && json.contains("paragraph"),
            "{json}"
        );
        // Two blocks now: the original heading, then a plain paragraph --
        // same shape plain Enter produces (see `exit_heading_to_paragraph`).
        assert_eq!(next.doc().child_count(), 2);
        assert_eq!(
            next.doc().content().children()[0].node_type().name(),
            "heading"
        );
        assert_eq!(
            next.doc().content().children()[1].node_type().name(),
            "paragraph"
        );
    }

    #[test]
    fn shift_enter_in_a_code_block_matches_plain_enter_literal_newline() {
        let schema = test_schema();
        let text_node = schema.text("code", vec![]).expect("text node");
        let code_block = schema
            .node("code_block", Attrs::new(), vec![text_node], vec![])
            .expect("code_block");
        let doc = schema
            .node("doc", Attrs::new(), vec![code_block], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(5)); // end of "code"
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| shift_enter_fixups()(s, d)).expect("dispatched");
        // Still ONE code_block (no split), now containing a literal newline.
        assert_eq!(next.doc().child_count(), 1);
        assert_eq!(next.doc().text_content(), "code\n");
    }

    /// The one REAL difference from plain Enter: on an EMPTY line directly
    /// inside a blockquote, Shift+Enter must NOT exit (unlike plain Enter,
    /// see `enter_on_empty_paragraph_in_blockquote_lifts_out` above) — it
    /// should just split, staying in the same blockquote.
    #[test]
    fn shift_enter_on_empty_line_in_blockquote_does_not_exit() {
        let schema = test_schema();
        let state = state_with_empty_paragraph_in_blockquote(&schema);
        let next =
            dispatch_and_apply(&state, |s, d| shift_enter_fixups()(s, d)).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(
            json.contains("blockquote"),
            "should stay in the blockquote: {json}"
        );
        // Two paragraphs now, both still inside ONE blockquote.
        assert_eq!(next.doc().child_count(), 1);
        let bq = &next.doc().content().children()[0];
        assert_eq!(bq.node_type().name(), "blockquote");
        assert_eq!(bq.child_count(), 2);
    }

    /// The list-item analogue of the blockquote test above: Shift+Enter on
    /// an empty (or any) list item must split WITHIN the same item, never
    /// lifting out of the list the way plain Enter's `smart_enter_in_list`
    /// does for an empty item.
    #[test]
    fn shift_enter_in_a_list_item_splits_within_the_same_item() {
        let schema = test_schema();
        let para = schema
            .node("paragraph", Attrs::new(), vec![], vec![])
            .expect("empty paragraph");
        let item = schema
            .node("list_item", Attrs::new(), vec![para], vec![])
            .expect("list_item");
        let list = schema
            .node("bullet_list", Attrs::new(), vec![item], vec![])
            .expect("bullet_list");
        let doc = schema
            .node("doc", Attrs::new(), vec![list], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(3)); // inside the empty paragraph
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| shift_enter_fixups()(s, d)).expect("dispatched");
        assert_eq!(next.doc().child_count(), 1, "still a single list");
        let list = &next.doc().content().children()[0];
        assert_eq!(list.node_type().name(), "bullet_list");
        assert_eq!(
            list.child_count(),
            1,
            "still a single item, not a new bullet"
        );
        let item = &list.content().children()[0];
        assert_eq!(item.node_type().name(), "list_item");
        assert_eq!(item.child_count(), 2, "two paragraphs within that one item");
    }

    #[test]
    fn no_rule_fires_on_plain_text() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "just prose");
        let rules = build_input_rules(&schema);
        assert!(rules.apply(&state).is_none());
    }

    #[test]
    fn undo_reverts_the_last_edit_and_redo_reapplies_it() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "hi");
        let after_edit = dispatch_and_apply(&state, word_delete_backward).expect("dispatched");
        assert_eq!(after_edit.doc().text_content(), "");

        assert!(
            undo_command()(&after_edit, None),
            "undo should be applicable right after an edit"
        );
        let after_undo =
            dispatch_and_apply(&after_edit, |s, d| undo_command()(s, d)).expect("dispatched");
        assert_eq!(after_undo.doc().text_content(), "hi");

        assert!(
            redo_command()(&after_undo, None),
            "redo should be applicable right after an undo"
        );
        let after_redo =
            dispatch_and_apply(&after_undo, |s, d| redo_command()(s, d)).expect("dispatched");
        assert_eq!(after_redo.doc().text_content(), "");
    }

    #[test]
    fn undo_and_redo_are_not_applicable_with_nothing_to_undo_or_redo() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "hi");
        assert!(
            !undo_command()(&state, None),
            "nothing to undo on a fresh state"
        );
        assert!(
            !redo_command()(&state, None),
            "nothing to redo before any undo has happened"
        );
    }

    /// Documents (rather than fixes) a real characteristic of the
    /// underlying library: neither `taino-edit-dom` nor
    /// `taino-edit-leptos` ever calls `Transaction::join_history`
    /// (confirmed by searching both crates' source for it — zero
    /// matches), so every dispatched transaction becomes its OWN undo
    /// group by default. Two separate character insertions -- mimicking
    /// two separate keystrokes, the way real typing actually arrives --
    /// therefore take TWO separate undos to fully revert, not one "word"
    /// at a time the way most real editors coalesce fast, uninterrupted
    /// typing. Flagged as a follow-up in this crate's README rather than
    /// fixed here: doing it well needs each keystroke's OWN transaction
    /// to opt into `join_history()` based on adjacency/recency, which
    /// isn't something `EditingFixups`-style command overrides can reach
    /// (ordinary typed characters never go through OUR code at all --
    /// only Enter/Backspace/Delete/Shift+Enter do; plain character input
    /// is handled entirely inside `taino-edit-leptos`'s own keydown/input
    /// listener).
    #[test]
    fn each_keystroke_is_its_own_undo_group_by_default() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "");

        let insert_char = |state: &EditorState, ch: &str| -> EditorState {
            let pos = state.selection().from();
            let text = state.schema().text(ch, vec![]).expect("text node");
            let mut tx = state.tr();
            tx.transform()
                .insert(
                    pos,
                    Slice::new(Fragment::from_node(text), 0, 0),
                    state.schema(),
                )
                .expect("insert should succeed");
            tx.set_selection(Selection::caret(pos + 1));
            state.apply(tx)
        };
        let after_h = insert_char(&state, "h");
        let after_hi = insert_char(&after_h, "i");

        assert_eq!(after_hi.doc().text_content(), "hi");
        assert_eq!(
            after_hi.history().undo_depth(),
            2,
            "two separate keystrokes should currently produce two undo groups"
        );
    }

    /// Regression test for the real browser quirk documented on
    /// `TRIGGER_SPACE`: a space typed at the true end of a line (nothing
    /// after it) arrives as `\u{00A0}` (non-breaking space), not a plain
    /// `\u{0020}` -- this is exactly the case a bare `\x20` pattern used to
    /// miss, matching the reported "only works if there's a word after it"
    /// symptom (a space typed BETWEEN characters stays plain, since it's
    /// not trailing).
    #[test]
    fn bullet_list_input_rule_fires_on_dash_nbsp() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "-\u{00A0}");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '-' + nbsp");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("bullet_list"), "{json}");
    }

    #[test]
    fn heading_input_rule_fires_on_hashes_nbsp() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "##\u{00A0}");
        let rules = build_input_rules(&schema);
        let tx = rules.apply(&state).expect("rule should match '##' + nbsp");
        let next = state.apply(tx);
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("heading"), "{json}");
    }

    /// A doc with one paragraph containing `text`, caret placed `char_offset`
    /// characters into it (0 = start of the text).
    fn state_with_paragraph_caret_at(
        schema: &Schema,
        text: &str,
        char_offset: usize,
    ) -> EditorState {
        let text_node = schema.text(text, vec![]).expect("text node");
        let para = schema
            .node("paragraph", Attrs::new(), vec![text_node], vec![])
            .expect("paragraph");
        let doc = schema
            .node("doc", Attrs::new(), vec![para], vec![])
            .expect("doc");
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        let pos = 1 + char_offset;
        tx.set_selection(Selection::caret(pos));
        state = state.apply(tx);
        state
    }

    fn dispatch_and_apply(
        state: &EditorState,
        cmd: impl Fn(&EditorState, Option<&mut taino_edit_leptos::Dispatch<'_>>) -> bool,
    ) -> Option<EditorState> {
        assert!(cmd(state, None), "command should report applicable");
        let mut result = None;
        let mut dispatch = |tx| result = Some(tx);
        assert!(cmd(state, Some(&mut dispatch)));
        result.map(|tx| state.clone().apply(tx))
    }

    #[test]
    fn word_delete_backward_removes_trailing_word() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "hello world");
        let next = dispatch_and_apply(&state, word_delete_backward).expect("dispatched");
        assert_eq!(next.doc().text_content(), "hello ");
    }

    #[test]
    fn word_delete_backward_also_eats_trailing_whitespace() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "hello world  ");
        let next = dispatch_and_apply(&state, word_delete_backward).expect("dispatched");
        assert_eq!(next.doc().text_content(), "hello ");
    }

    #[test]
    fn word_delete_backward_declines_at_block_start() {
        let schema = test_schema();
        let state = state_with_paragraph_caret_at(&schema, "hello", 0);
        assert!(!word_delete_backward(&state, None));
    }

    #[test]
    fn word_delete_forward_removes_leading_word() {
        let schema = test_schema();
        let state = state_with_paragraph_caret_at(&schema, "hello world", 0);
        let next = dispatch_and_apply(&state, word_delete_forward).expect("dispatched");
        assert_eq!(next.doc().text_content(), " world");
    }

    #[test]
    fn word_delete_forward_also_eats_leading_whitespace() {
        let schema = test_schema();
        let state = state_with_paragraph_caret_at(&schema, "hello   world", 5);
        let next = dispatch_and_apply(&state, word_delete_forward).expect("dispatched");
        assert_eq!(next.doc().text_content(), "hello");
    }

    #[test]
    fn word_delete_forward_declines_at_block_end() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "hello");
        assert!(!word_delete_forward(&state, None));
    }

    fn test_schema_with_directives() -> Schema {
        let base = SchemaBuilder::new()
            .node(
                "doc",
                NodeSpec {
                    content: Some("block+".into()),
                    ..Default::default()
                },
            )
            .node(
                "text",
                NodeSpec {
                    group: Some("inline".into()),
                    ..Default::default()
                },
            );
        let exts: Vec<&dyn Extension> = vec![
            &Paragraph,
            &Lists,
            &crate::oxmarkdown_schema::Directives,
            &Checkbox,
        ];
        build_schema_with(base, &exts, "doc").expect("schema builds")
    }

    fn leaf_directive(schema: &Schema, name: &str) -> Node {
        let mut attrs = Attrs::new();
        attrs.insert("name".to_string(), AttrValue::from(name.to_string()));
        attrs.insert(
            "attributes".to_string(),
            AttrValue::Object(Default::default()),
        );
        let label = schema.text(name, vec![]).expect("label");
        schema
            .node("leaf_directive", attrs, vec![label], vec![])
            .expect("leaf_directive")
    }

    fn paragraph(schema: &Schema, text: &str) -> Node {
        let kids = if text.is_empty() {
            vec![]
        } else {
            vec![schema.text(text, vec![]).expect("text")]
        };
        schema
            .node("paragraph", Attrs::new(), kids, vec![])
            .expect("paragraph")
    }

    #[test]
    fn enter_after_selecting_a_leaf_directive_lands_in_the_following_paragraph() {
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let doc = schema
            .node(
                "doc",
                Attrs::new(),
                vec![badge, paragraph(&schema, "hello")],
                vec![],
            )
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: 0 });
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| exit_directive(s, d, true)).expect("dispatched");
        assert_eq!(next.doc().text_content(), "badgehello", "nothing lost");
        assert_eq!(
            next.selection(),
            Selection::caret(next.doc().node_at(0).unwrap().node_size() + 1)
        );
    }

    #[test]
    fn enter_after_selecting_a_leaf_directive_with_nothing_after_inserts_a_paragraph() {
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let doc = schema
            .node("doc", Attrs::new(), vec![badge], vec![])
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: 0 });
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| exit_directive(s, d, true)).expect("dispatched");
        assert_eq!(
            next.doc().child_count(),
            2,
            "a landing paragraph was created"
        );
        assert_eq!(next.doc().child(1).node_type().name(), "paragraph");
        assert!(
            next.selection().is_empty(),
            "a real caret, not stuck selected"
        );
    }

    #[test]
    fn exit_directive_backward_lands_at_the_end_of_the_preceding_paragraph() {
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let doc = schema
            .node(
                "doc",
                Attrs::new(),
                vec![paragraph(&schema, "hi"), badge],
                vec![],
            )
            .unwrap();
        let badge_pos = doc.child(0).node_size();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: badge_pos });
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| exit_directive(s, d, false)).expect("dispatched");
        // Position 3: past the paragraph's own open token and "hi".
        assert_eq!(next.selection(), Selection::caret(3));
    }

    #[test]
    fn a_text_caret_trapped_inside_a_leaf_directive_exits_on_enter_instead_of_splitting_it() {
        // The real bug this whole mechanism fixes: a plain caret ending up
        // inside a leaf_directive's own synthetic content (reachable via
        // ordinary ArrowLeft/Right navigation, since it's not a true
        // zero-content atom — ONLY `atom: true` for click handling, not for
        // any generic command). Before this fix, `split_block` would split
        // the directive itself in two.
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let doc = schema
            .node("doc", Attrs::new(), vec![badge], vec![])
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        // Position 1: one character into "badge"'s own synthetic text —
        // exactly where native ArrowRight navigation would land a caret.
        tx.set_selection(Selection::caret(1));
        state = state.apply(tx);

        assert!(
            directive_at_selection(&state).is_some(),
            "the trap is detected"
        );
        let next =
            dispatch_and_apply(&state, |s, d| exit_directive(s, d, true)).expect("dispatched");
        assert_eq!(
            next.doc().child_count(),
            2,
            "still ONE badge, plus a fresh landing paragraph — never split into two"
        );
        assert_eq!(next.doc().text_content(), "badge");
    }

    #[test]
    fn exit_directive_forward_onto_an_adjacent_directive_selects_it_instead_of_drilling_in() {
        let schema = test_schema_with_directives();
        let first = leaf_directive(&schema, "badge");
        let second = leaf_directive(&schema, "badge");
        let doc = schema
            .node("doc", Attrs::new(), vec![first, second], vec![])
            .unwrap();
        let second_pos = doc.child(0).node_size();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: 0 });
        state = state.apply(tx);

        let next =
            dispatch_and_apply(&state, |s, d| exit_directive(s, d, true)).expect("dispatched");
        assert_eq!(next.selection(), Selection::Node { pos: second_pos });
    }

    #[test]
    fn exit_directive_declines_for_an_ordinary_selection() {
        let schema = test_schema_with_directives();
        let state = state_with_paragraph(&schema, "hello");
        assert!(!exit_directive(&state, None, true));
        assert!(!exit_directive(&state, None, false));
    }

    #[test]
    fn enter_always_inserts_a_new_paragraph_even_next_to_an_unrelated_directive() {
        // Real bug found live: reusing `exit_directive`'s own "land on an
        // adjacent directive" logic for Enter meant pressing Enter right
        // after a badge that happened to sit next to a totally unrelated
        // directive (e.g. a gallery) jumped straight to SELECTING that
        // gallery instead of giving the user a new line.
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let gallery = leaf_directive(&schema, "gallery");
        let doc = schema
            .node("doc", Attrs::new(), vec![badge, gallery], vec![])
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: 0 });
        state = state.apply(tx);

        let next = dispatch_and_apply(&state, exit_directive_with_new_line).expect("dispatched");
        assert_eq!(
            next.doc().child_count(),
            3,
            "a real new paragraph was inserted between them"
        );
        assert_eq!(next.doc().child(1).node_type().name(), "paragraph");
        assert_eq!(next.doc().child(2).node_type().name(), "leaf_directive");
        assert!(
            next.selection().is_empty(),
            "a real caret in the new paragraph"
        );
    }

    #[test]
    fn enter_still_inserts_a_new_paragraph_when_one_already_follows() {
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let doc = schema
            .node(
                "doc",
                Attrs::new(),
                vec![badge, paragraph(&schema, "hello")],
                vec![],
            )
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: 0 });
        state = state.apply(tx);

        let next = dispatch_and_apply(&state, exit_directive_with_new_line).expect("dispatched");
        assert_eq!(
            next.doc().child_count(),
            3,
            "a BRAND NEW paragraph, not reusing the old one"
        );
        assert_eq!(next.doc().text_content(), "badgehello", "nothing lost");
    }

    #[test]
    fn first_space_appends_to_the_directive_content_second_space_exits() {
        let schema = test_schema_with_directives();
        let badge = leaf_directive(&schema, "badge");
        let doc = schema
            .node("doc", Attrs::new(), vec![badge], vec![])
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::Node { pos: 0 });
        state = state.apply(tx);

        let space_cmd = space_in_directive();
        let after_first =
            dispatch_and_apply(&state, |s, d| space_cmd(s, d)).expect("first space dispatched");
        assert_eq!(
            after_first.doc().child_count(),
            1,
            "still just the one directive"
        );
        assert_eq!(
            after_first.doc().text_content(),
            "badge ",
            "space appended to its content"
        );
        assert!(
            caret_trapped_in_directive(&after_first).is_some(),
            "caret now sits right after the appended space, inside the directive's own content"
        );

        let after_second = dispatch_and_apply(&after_first, |s, d| space_cmd(s, d))
            .expect("second space dispatched");
        assert_eq!(
            after_second.doc().child_count(),
            2,
            "the second space exits, landing in a fresh paragraph"
        );
        assert_eq!(after_second.doc().child(1).node_type().name(), "paragraph");
    }

    fn checkbox_node(schema: &Schema, checked: bool) -> Node {
        let mut attrs = Attrs::new();
        attrs.insert("checked".to_string(), AttrValue::from(checked));
        schema
            .node("checkbox", attrs, vec![], vec![])
            .expect("checkbox")
    }

    fn checkbox_list_item(schema: &Schema, text: &str) -> Node {
        let checkbox = checkbox_node(schema, false);
        let text_node = schema.text(text, vec![]).expect("text");
        let para = schema
            .node("paragraph", Attrs::new(), vec![checkbox, text_node], vec![])
            .expect("paragraph");
        schema
            .node("list_item", Attrs::new(), vec![para], vec![])
            .expect("list_item")
    }

    #[test]
    fn arrow_left_never_lands_right_before_a_checkbox() {
        let schema = test_schema_with_directives();
        let item = checkbox_list_item(&schema, "hello");
        let list = schema
            .node("bullet_list", Attrs::new(), vec![item], vec![])
            .unwrap();
        let doc = schema
            .node("doc", Attrs::new(), vec![list], vec![])
            .unwrap();
        // Position 4: doc(0) > bullet_list(1) > list_item(2) > paragraph(3)
        // > right after the checkbox atom (content start + 1).
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(4));
        state = state.apply(tx);

        // Nothing meaningful precedes the list at all — base `caret_
        // left` would have nowhere else to go either, so this declines
        // entirely rather than landing before the checkbox.
        let cmd = arrow_left_fixups();
        assert!(!cmd(&state, None));
    }

    #[test]
    fn arrow_left_lands_at_the_end_of_the_preceding_item_skipping_the_checkbox() {
        let schema = test_schema_with_directives();
        let first = checkbox_list_item(&schema, "first");
        let second = checkbox_list_item(&schema, "second");
        let list = schema
            .node("bullet_list", Attrs::new(), vec![first, second], vec![])
            .unwrap();
        let doc = schema
            .node("doc", Attrs::new(), vec![list], vec![])
            .unwrap();
        // Position right after the SECOND item's own checkbox.
        let second_item_start = doc.child(0).child(0).node_size();
        let pos = second_item_start + 4; // past bullet_list/list_item/paragraph opens + checkbox
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(pos));
        state = state.apply(tx);

        let cmd = arrow_left_fixups();
        let next = dispatch_and_apply(&state, |s, d| cmd(s, d)).expect("dispatched");
        assert!(!is_before_leading_checkbox(
            next.doc(),
            next.selection().from()
        ));
        // Lands at the END of the first item's own text, not its start.
        let rp_after = ResolvedPos::resolve(next.doc(), next.selection().from()).unwrap();
        assert_eq!(rp_after.parent().text_content(), "first");
    }

    #[test]
    fn home_never_lands_right_before_a_checkbox() {
        let schema = test_schema_with_directives();
        let item = checkbox_list_item(&schema, "hello");
        let list = schema
            .node("bullet_list", Attrs::new(), vec![item], vec![])
            .unwrap();
        let doc = schema
            .node("doc", Attrs::new(), vec![list], vec![])
            .unwrap();
        let mut state = EditorState::new(doc, schema.clone());
        let mut tx = state.tr();
        tx.set_selection(Selection::caret(6)); // somewhere inside "hello"
        state = state.apply(tx);

        let cmd = caret_line_start_fixups();
        let next = dispatch_and_apply(&state, |s, d| cmd(s, d)).expect("dispatched");
        assert!(!is_before_leading_checkbox(
            next.doc(),
            next.selection().from()
        ));
    }
}

// `[\x20\u00A0]` (plain space OR non-breaking space), never bare `\x20` --
// a REAL contenteditable/browser quirk, confirmed by direct testing: a
// space typed at the true end of a line (nothing after it) is inserted by
// the browser as `\u00A0` rather than a plain `\u0020`, since a trailing
// plain space would otherwise be visually collapsed away per normal HTML
// whitespace rules -- browsers substitute a non-breaking space to keep it
// visible. A space typed BETWEEN existing characters (e.g. turning "-Hi"
// into "- Hi" by placing the caret before "H" and typing a space) is not
// trailing, so it stays a plain space. Without this, "- "/"## "/etc. typed
// normally at the end of an otherwise-empty line silently never matched.
const TRIGGER_SPACE: &str = "[\\x20\\u00A0]";

pub fn build_input_rules(schema: &Schema) -> InputRules {
    let mut rules = Vec::new();

    if schema.node_type("heading").is_some() {
        let pattern = format!(r"^(#{{1,6}}){TRIGGER_SPACE}$");
        if let Ok(rule) = InputRule::new(&pattern, heading_type_on_input()) {
            rules.push(rule);
        }
    }
    if schema.node_type("blockquote").is_some() {
        let pattern = format!(r"^>{TRIGGER_SPACE}$");
        if let Ok(rule) = wrapping_rule(&pattern, "blockquote", Attrs::new()) {
            rules.push(rule);
        }
    }
    if schema.node_type("bullet_list").is_some() && schema.node_type("list_item").is_some() {
        let pattern = format!(r"^[-*]{TRIGGER_SPACE}$");
        if let Ok(rule) = InputRule::new(&pattern, wrap_in_list_on_input("bullet_list")) {
            rules.push(rule);
        }
    }
    if schema.node_type("ordered_list").is_some() && schema.node_type("list_item").is_some() {
        let pattern = format!(r"^\d+\.{TRIGGER_SPACE}$");
        if let Ok(rule) = InputRule::new(&pattern, wrap_in_list_on_input("ordered_list")) {
            rules.push(rule);
        }
    }
    if schema.node_type("checkbox").is_some() && schema.node_type("list_item").is_some() {
        let pattern = format!(r"^\[([ xX])\]{TRIGGER_SPACE}$");
        if let Ok(rule) = InputRule::new(&pattern, checkbox_on_input) {
            rules.push(rule);
        }
    }

    InputRules::new(rules)
}
