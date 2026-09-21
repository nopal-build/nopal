//! Editing-behavior fixups on top of `taino-edit`'s built-in defaults —
//! see this crate's README for the two real gaps these close:
//!
//! 1. **Enter always continues the current block's own type.**
//!    `taino-edit-core`'s base `Enter` binding (`split_block`) is a
//!    generic split with no "exit to paragraph" logic — confirmed by
//!    reading its source directly, not assumed. Real editors (Notion,
//!    Google Docs, ...) demote a heading's continuation to a plain
//!    paragraph, and treat Enter inside a code block as a literal
//!    newline rather than a block split. `Lists`'s own "smart Enter"
//!    (empty item -> lift, otherwise -> new item) already does the
//!    right thing for lists — nothing to fix there, confirmed by
//!    reading `taino-edit-extensions`'s source too.
//! 2. **No input rules are wired into the Leptos adapter at all.**
//!    `taino-edit-core` has a real `InputRules`/`InputRule` primitive
//!    (confirmed: `## ` -> heading, `> ` -> blockquote are both
//!    supported constructs), but `taino-edit-dom`/`taino-edit-leptos`
//!    never call `InputRules::apply` anywhere — confirmed by searching
//!    both crates' source, not assumed. `App`'s own `Effect` (see
//!    `lib.rs`) is what actually invokes this, since the library
//!    doesn't.

use regex::Captures;
use taino_edit_core::{textblock_type_rule, wrapping_rule, Fragment, InputRule, InputRules};
use taino_edit_extensions::Extension;
use taino_edit_leptos::{AttrValue, Attrs, Command, ResolvedPos, Schema, Selection, Slice};

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
        vec![("Enter".to_string(), enter_fixups())]
    }
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
            _ => false,
        }
    })
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
// comment) — `App`'s own `Effect` calls `InputRules::apply` after every
// state change; this just builds the ruleset once.

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
        // Past the list's own open token, the item's open token, and the
        // inner paragraph's open token — right where the original
        // content (now minus the trigger text) starts.
        tx.set_selection(Selection::caret(start + 3));
        Some(tx)
    }
}

pub fn build_input_rules(schema: &Schema) -> InputRules {
    let mut rules = Vec::new();

    if schema.node_type("heading").is_some() {
        if let Ok(rule) =
            textblock_type_rule(r"^(#{1,6})\x20$", "heading", heading_attrs_from_hashes)
        {
            rules.push(rule);
        }
    }
    if schema.node_type("blockquote").is_some() {
        if let Ok(rule) = wrapping_rule(r"^>\x20$", "blockquote", Attrs::new()) {
            rules.push(rule);
        }
    }
    if schema.node_type("bullet_list").is_some() && schema.node_type("list_item").is_some() {
        if let Ok(rule) = InputRule::new(r"^[-*]\x20$", wrap_in_list_on_input("bullet_list")) {
            rules.push(rule);
        }
    }
    if schema.node_type("ordered_list").is_some() && schema.node_type("list_item").is_some() {
        if let Ok(rule) = InputRule::new(r"^\d+\.\x20$", wrap_in_list_on_input("ordered_list")) {
            rules.push(rule);
        }
    }

    InputRules::new(rules)
}
