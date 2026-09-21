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
//!    confirmed by reading `taino-edit-extensions`'s source too. The
//!    blockquote case reuses `taino-edit-core`'s own generic `lift`
//!    command (also used internally by that same list logic), which
//!    only fires when the blockquote has exactly one child block — the
//!    common "just typed `> `" case; a multi-paragraph blockquote falls
//!    through to a plain split instead of being blown apart, matching
//!    `lift`'s own conservative contract.
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

use regex::Captures;
use taino_edit_core::{wrapping_rule, Fragment, InputRule, InputRules};
use taino_edit_extensions::Extension;
use taino_edit_leptos::{
    lift, AttrValue, Attrs, Command, Dispatch, EditorState, ResolvedPos, Schema, Selection, Slice,
    Transaction,
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
            ("Alt-Backspace".to_string(), Box::new(word_delete_backward)),
            ("Ctrl-Backspace".to_string(), Box::new(word_delete_backward)),
            ("Alt-Delete".to_string(), Box::new(word_delete_forward)),
            ("Ctrl-Delete".to_string(), Box::new(word_delete_forward)),
        ]
    }
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
            "paragraph" if is_empty_paragraph_in_blockquote(&rp) => lift(state, dispatch),
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
    use taino_edit_extensions::{
        build_schema_with, Blockquote, Bold, Heading, Italic, Lists, Paragraph,
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
        let exts: Vec<&dyn Extension> =
            vec![&Paragraph, &Heading, &Bold, &Italic, &Blockquote, &Lists];
        build_schema_with(base, &exts, "doc").expect("schema builds")
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

    #[test]
    fn no_rule_fires_on_plain_text() {
        let schema = test_schema();
        let state = state_with_paragraph(&schema, "just prose");
        let rules = build_input_rules(&schema);
        assert!(rules.apply(&state).is_none());
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

    InputRules::new(rules)
}
