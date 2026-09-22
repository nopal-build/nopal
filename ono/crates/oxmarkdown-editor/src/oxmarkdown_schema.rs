//! Real OxMarkdown-specific schema additions, on top of `taino-edit`'s
//! own built-in extensions (see `lib.rs`'s `build_editor`) — the actual
//! follow-up work `commands.rs`'s own README pointer promised once the
//! editing-behavior fixups proved out. See the `oxmarkdown` skill for
//! the real product's own conventions this mirrors (and, where it
//! doesn't, documents exactly why).
//!
//! `AttrValue` is genuinely just `serde_json::Value` (confirmed by
//! reading `taino-edit-core::attrs`'s source, not assumed) — that's what
//! makes representing a directive's own open-ended `{key="value" ...}`
//! attribute set possible at all here: one declared `"attributes"`
//! schema attribute holding a whole JSON object, rather than needing to
//! predeclare every possible directive's own attribute keys up front
//! (which the schema system has no mechanism for regardless — every
//! OTHER node type's attributes are a fixed, known set).
//!
//! **Real, structural constraint found and worked around**: `DomSpec`
//! (confirmed by reading its source) can only describe `tag` + HTML
//! `attr`s + whether children render inside it — there is no way for a
//! node's `to_dom` closure to inject arbitrary COMPUTED text/markup the
//! way Lexical's own decorator nodes render arbitrary React components.
//! So a leaf/text directive's human-readable `::name{...}` label is
//! stored as the node's own literal (synthetic, not user-typed) TEXT
//! CONTENT child, generated once at parse time by `convert.rs` — still
//! marked `atom: true` (matching `Image`'s own precedent: atom-ness and
//! having content aren't mutually exclusive) so it's still selected/
//! deleted as one unit despite technically having content. The REAL
//! source of truth for round-tripping is the separate `name`/`attributes`
//! attrs, not this display text.
//!
//! **Checkboxes deliberately do NOT follow the real product's own
//! "attribute on the list item" convention** — confirmed infeasible here,
//! not just skipped: `taino-edit-extensions`'s `Lists` extension already
//! registers a `"list_item"` node type of its own, and
//! `SchemaBuilder::build` hard-errors on any duplicate type name
//! (confirmed by reading its source), so a second, competing
//! `SchemaAdditions` entry for `"list_item"` (to add a `checked` attr)
//! cannot coexist with using `Lists` at all. Forking `Lists` entirely
//! (copying its node specs AND its keymap commands, since the latter
//! only work against a schema that still has nodes named exactly
//! `"list_item"`/`"bullet_list"`/`"ordered_list"`) was rejected as
//! disproportionate to what a checkbox actually needs. Used a `Checkbox`
//! INLINE ATOM instead, placed as the first inline child of a task list
//! item's first paragraph — achieves the same practical goal (a real,
//! non-text, losslessly-round-trippable, individually-selectable
//! checkbox state) and, incidentally, the same "freely mix checkbox and
//! plain-bullet items" flexibility the real product's own reasoning
//! calls out, without forking anything.

use std::collections::HashMap;

use taino_edit_core::{Fragment, ParseRule};
use taino_edit_extensions::{Extension, SchemaAdditions};
use taino_edit_leptos::{
    AttrSpec, AttrValue, Attrs, Dispatch, DomSpec, EditorState, EditorView, MarkSpec, Node,
    NodeSpec, ResolvedPos, Slice, ViewAction, ViewPlugin,
};
use wasm_bindgen::JsCast;

/// `==highlighted text==` -> `<mark>`. Mirrors the real product's own
/// choice (see the `oxmarkdown` skill, item 16: Lexical's built-in
/// `"highlight"` format renders the same way) — just a real mark type,
/// nothing more exotic needed.
pub struct Highlight;

impl Extension for Highlight {
    fn name(&self) -> &str {
        "highlight"
    }

    fn schema_additions(&self) -> SchemaAdditions {
        SchemaAdditions {
            marks: vec![(
                "highlight".to_string(),
                MarkSpec {
                    to_dom: Some(|_| DomSpec::element("mark")),
                    parse_dom: vec![ParseRule::tag("mark")],
                    ..Default::default()
                },
            )],
            ..Default::default()
        }
    }
}

/// GFM `~~struck through~~` -> `<s>`.
pub struct Strikethrough;

impl Extension for Strikethrough {
    fn name(&self) -> &str {
        "strikethrough"
    }

    fn schema_additions(&self) -> SchemaAdditions {
        SchemaAdditions {
            marks: vec![(
                "strikethrough".to_string(),
                MarkSpec {
                    to_dom: Some(|_| DomSpec::element("s")),
                    parse_dom: vec![
                        ParseRule::tag("s"),
                        ParseRule::tag("del"),
                        ParseRule::tag("strike"),
                    ],
                    ..Default::default()
                },
            )],
            ..Default::default()
        }
    }
}

/// The two attrs every directive node shares: `name` (the directive's own
/// name, e.g. `"file"` for `::file{...}`) and `attributes` (its ENTIRE
/// `{key="value" ...}` set, as one JSON object) — see this module's own
/// doc comment for why a single JSON-object attr, not one attr per key.
fn directive_attrs() -> HashMap<String, AttrSpec> {
    let mut attrs = HashMap::new();
    attrs.insert(
        "name".to_string(),
        AttrSpec {
            default: Some(AttrValue::from(String::new())),
        },
    );
    attrs.insert(
        "attributes".to_string(),
        AttrSpec {
            default: Some(AttrValue::Object(Default::default())),
        },
    );
    attrs
}

fn directive_name(n: &Node) -> String {
    n.attrs()
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Reads one key out of a directive's own `attributes` JSON-object attr
/// (see this module's own doc comment for why the whole `{key="value"
/// ...}` set is stored as one attr, not one per key).
fn directive_attribute<'a>(n: &'a Node, key: &str) -> Option<&'a str> {
    n.attrs().get("attributes")?.get(key)?.as_str()
}

/// Real per-directive-kind CSS hooks, layered on top of the shared
/// `ox-directive*` classes every directive gets regardless — see
/// `convert.rs`'s own `directive_content` for the matching per-kind
/// synthetic-label content this styles. Falls through to nothing extra
/// for any other directive name, same "unknown directive" fallback
/// convention as that function.
fn directive_kind_class(n: &Node) -> &'static str {
    match directive_name(n).as_str() {
        "badge" => " ox-directive-badge",
        "ref" if directive_attribute(n, "verbose") == Some("true") => {
            " ox-directive-ref ox-directive-ref-verbose"
        }
        "ref" => " ox-directive-ref ox-directive-ref-glyph",
        _ => "",
    }
}

/// The three generic directive kinds (`:name{}` text / `::name{}` leaf /
/// `:::name{}` container) as real node types — see the `oxmarkdown`
/// skill's own "Generic directives" section for the source syntax these
/// mirror. Every directive still shares these three node TYPES
/// (structure, losslessly preserved attrs, container content genuinely
/// editable) regardless of its name — there's no per-name node type.
/// `"badge"` and `"ref"` (see `convert.rs`'s own `directive_content`/
/// `directive_kind_class` below) are the first two names given a real,
/// specific RENDER (content + CSS), since a generic `::name{attrs}`
/// raw-syntax label was never meant to be the final look for every
/// directive, just the honest placeholder until each one earns its own.
/// Still no ATTRIBUTE-EDITING interactivity for any directive yet
/// (popover, click-to-select, ...) — that remains real follow-up work.
pub struct Directives;

impl Extension for Directives {
    fn name(&self) -> &str {
        "directives"
    }

    fn schema_additions(&self) -> SchemaAdditions {
        SchemaAdditions {
            nodes: vec![
                (
                    "leaf_directive".to_string(),
                    NodeSpec {
                        // A single synthetic text child carries the
                        // display label — see this module's own doc
                        // comment on the real `DomSpec` limitation this
                        // works around.
                        content: Some("text*".into()),
                        group: Some("block".into()),
                        atom: true,
                        attrs: directive_attrs(),
                        to_dom: Some(|n: &Node| {
                            let class = format!(
                                "ox-directive ox-directive-leaf{}",
                                directive_kind_class(n)
                            );
                            DomSpec::element("div")
                                .attr("class", class)
                                .attr("data-directive-name", directive_name(n))
                        }),
                        ..Default::default()
                    },
                ),
                (
                    "container_directive".to_string(),
                    NodeSpec {
                        content: Some("block+".into()),
                        group: Some("block".into()),
                        attrs: directive_attrs(),
                        to_dom: Some(|n: &Node| {
                            DomSpec::element("div")
                                .attr("class", "ox-directive ox-directive-container")
                                .attr("data-directive-name", directive_name(n))
                        }),
                        ..Default::default()
                    },
                ),
                (
                    "text_directive".to_string(),
                    NodeSpec {
                        content: Some("text*".into()),
                        group: Some("inline".into()),
                        inline: true,
                        atom: true,
                        attrs: directive_attrs(),
                        to_dom: Some(|n: &Node| {
                            let class = format!(
                                "ox-directive ox-directive-text{}",
                                directive_kind_class(n)
                            );
                            DomSpec::element("span")
                                .attr("class", class)
                                .attr("data-directive-name", directive_name(n))
                        }),
                        ..Default::default()
                    },
                ),
            ],
            ..Default::default()
        }
    }
}

/// A GFM task-list item's checkbox, as a real, genuinely interactive
/// inline atom (click-to-toggle — see `CheckboxTogglePlugin` below),
/// placed as the first inline child of a task list item's first
/// paragraph.
pub struct Checkbox;

impl Extension for Checkbox {
    fn name(&self) -> &str {
        "checkbox"
    }

    fn schema_additions(&self) -> SchemaAdditions {
        let mut attrs = HashMap::new();
        attrs.insert(
            "checked".to_string(),
            AttrSpec {
                default: Some(AttrValue::from(false)),
            },
        );
        SchemaAdditions {
            nodes: vec![(
                "checkbox".to_string(),
                NodeSpec {
                    group: Some("inline".into()),
                    inline: true,
                    atom: true,
                    attrs,
                    to_dom: Some(|n: &Node| {
                        let checked = n
                            .attrs()
                            .get("checked")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let mut spec = DomSpec::void("input")
                            .attr("type", "checkbox")
                            .attr("class", "ox-checkbox");
                        if checked {
                            spec = spec.attr("checked", "checked");
                        }
                        spec
                    }),
                    ..Default::default()
                },
            )],
            ..Default::default()
        }
    }
}

/// Real click-to-toggle for the `checkbox` atom above, via
/// `taino-edit-dom`'s own `ViewPlugin` mechanism ("extensions ... needing
/// real pointer interaction", per that trait's own doc comment — exactly
/// this case). A REAL constraint confirmed by reading `taino-edit-
/// leptos`'s own wiring, not assumed: `TainoEditor` only ever pipes
/// `"mousedown"`/`"mousemove"`/`"mouseup"` events through
/// `ViewPlugin::handle_event` — never `"click"` — so this reacts to
/// `"mousedown"` and calls `event.prevent_default()` itself, stopping
/// the browser's OWN native checkbox toggle from ALSO firing (the
/// `<input>` is no longer `disabled`, so it can now receive pointer
/// events at all — a disabled form control is normally excluded from
/// receiving them, including by our own listener).
///
/// `EditorView::pos_at_point`'s own documented behavior (confirmed by
/// reading its source: `document.elementFromPoint` then walking up to
/// find the clicked element's own position via `pos_before_element`)
/// already returns the position immediately BEFORE the clicked element
/// when a click lands squarely on it — exactly a checkbox atom's own
/// position — so `checkbox_at_or_before`'s primary check should always
/// hit; the `pos - 1` fallback only guards against imprecise edge
/// coordinates.
///
/// **A real focus-loss bug found and fixed while testing this live**:
/// toggling `checked` gives the checkbox DIFFERENT attrs, so `taino-
/// edit-dom`'s own `try_patch` (confirmed by reading its source: it
/// declines an in-place patch whenever `node.attrs() != new.attrs()`)
/// REPLACES the `<input>` DOM element outright rather than patching it
/// in place — and replacing a focused-or-recently-interacted-with
/// element can silently drop focus off the editor root entirely.
/// `taino-edit-leptos`'s own reactive DOM-selection-resync effect
/// (confirmed by reading its source) only ever re-syncs the caret
/// `if r.view.has_focus()` — skipped entirely otherwise — so losing
/// focus here left the LIVE DOM caret stale (still wherever it was
/// before the click) even though the MODEL's own selection was
/// correctly preserved, reproducing exactly as "click a checkbox, then
/// End+type lands text at the wrong spot" in real browser testing.
/// Fixed by explicitly calling `view.focus()` before returning the
/// action, so the editor root already has focus back by the time that
/// effect runs.
pub struct CheckboxTogglePlugin;

impl ViewPlugin for CheckboxTogglePlugin {
    fn handle_event(&self, view: &EditorView, event: &web_sys::Event) -> Option<ViewAction> {
        if event.type_() != "mousedown" {
            return None;
        }
        let mouse = event.dyn_ref::<web_sys::MouseEvent>()?;
        let target = event.target()?.dyn_into::<web_sys::Element>().ok()?;
        if target.tag_name().to_lowercase() != "input"
            || !target.class_list().contains("ox-checkbox")
        {
            return None;
        }
        let pos = view.pos_at_point(mouse.client_x() as f32, mouse.client_y() as f32)?;
        event.prevent_default();
        let _ = view.focus();
        Some(ViewAction::Command(Box::new(move |state, dispatch| {
            toggle_checkbox_at(state, dispatch, pos)
        })))
    }
}

fn checkbox_at_or_before(state: &EditorState, pos: usize) -> Option<(usize, Node)> {
    let rp = ResolvedPos::resolve(state.doc(), pos).ok()?;
    if let Some(n) = rp.node_after() {
        if n.node_type().name() == "checkbox" {
            return Some((pos, n));
        }
    }
    if pos > 0 {
        let rp2 = ResolvedPos::resolve(state.doc(), pos - 1).ok()?;
        if let Some(n) = rp2.node_after() {
            if n.node_type().name() == "checkbox" {
                return Some((pos - 1, n));
            }
        }
    }
    None
}

fn toggle_checkbox_at(
    state: &EditorState,
    dispatch: Option<&mut Dispatch<'_>>,
    pos: usize,
) -> bool {
    let Some((start, node)) = checkbox_at_or_before(state, pos) else {
        return false;
    };
    let checked = node
        .attrs()
        .get("checked")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let Some(d) = dispatch else { return true };
    let mut attrs = Attrs::new();
    attrs.insert("checked".to_string(), AttrValue::from(!checked));
    let Ok(new_checkbox) = state.schema().node("checkbox", attrs, vec![], vec![]) else {
        return false;
    };
    let mut tx = state.tr();
    if tx
        .transform()
        .replace(
            start,
            start + 1,
            Slice::new(Fragment::from_node(new_checkbox), 0, 0),
            state.schema(),
        )
        .is_err()
    {
        return false;
    }
    // The replaced content is the SAME shape (one atom for another, same
    // size) at a FIXED position — unlike the `lift`/`textblock_type_rule`
    // bugs documented in `commands.rs`, default selection-mapping through
    // this kind of replace is well-defined. Still explicitly preserved
    // (not left to the default mapping) so a click on a checkbox can
    // never move the caret, regardless of where it currently is.
    tx.set_selection(state.selection());
    d(tx);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use taino_edit_extensions::{build_schema_with, Lists, Paragraph};
    use taino_edit_leptos::{EditorState, NodeSpec, Schema, SchemaBuilder, Selection};

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
        let exts: Vec<&dyn Extension> = vec![&Paragraph, &Lists, &Checkbox];
        build_schema_with(base, &exts, "doc").expect("schema builds")
    }

    /// `bullet_list > list_item > paragraph(checkbox, "todo")`. Returns
    /// the state and the checkbox's own document position (3: past the
    /// list's, item's, and paragraph's own open tokens).
    fn state_with_checkbox(schema: &Schema, checked: bool) -> (EditorState, usize) {
        let mut attrs = Attrs::new();
        attrs.insert("checked".to_string(), AttrValue::from(checked));
        let checkbox = schema
            .node("checkbox", attrs, vec![], vec![])
            .expect("checkbox");
        let text = schema.text("todo", vec![]).expect("text");
        let para = schema
            .node("paragraph", Attrs::new(), vec![checkbox, text], vec![])
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
        (EditorState::new(doc, schema.clone()), 3)
    }

    fn dispatch_and_apply(state: &EditorState, pos: usize) -> Option<EditorState> {
        let mut result = None;
        let mut dispatch = |tx| result = Some(tx);
        assert!(toggle_checkbox_at(state, Some(&mut dispatch), pos));
        result.map(|tx| state.clone().apply(tx))
    }

    #[test]
    fn toggle_flips_unchecked_to_checked() {
        let schema = test_schema();
        let (state, pos) = state_with_checkbox(&schema, false);
        let next = dispatch_and_apply(&state, pos).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("\"checked\":true"), "{json}");
    }

    #[test]
    fn toggle_flips_checked_to_unchecked() {
        let schema = test_schema();
        let (state, pos) = state_with_checkbox(&schema, true);
        let next = dispatch_and_apply(&state, pos).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("\"checked\":false"), "{json}");
    }

    /// `pos + 1` (right AFTER the checkbox, the position matching
    /// `node_before()` rather than `node_after()`) should ALSO resolve
    /// correctly, via `checkbox_at_or_before`'s own `pos - 1` fallback.
    #[test]
    fn toggle_works_via_the_position_after_fallback() {
        let schema = test_schema();
        let (state, pos) = state_with_checkbox(&schema, false);
        let next = dispatch_and_apply(&state, pos + 1).expect("dispatched");
        let json = serde_json::to_string(&next.doc().to_json()).unwrap();
        assert!(json.contains("\"checked\":true"), "{json}");
    }

    #[test]
    fn toggle_declines_when_there_is_no_checkbox_at_that_position() {
        let schema = test_schema();
        let (state, _pos) = state_with_checkbox(&schema, false);
        assert!(!toggle_checkbox_at(&state, None, 0));
    }

    #[test]
    fn toggle_preserves_the_current_selection_even_when_elsewhere() {
        let schema = test_schema();
        let (mut state, pos) = state_with_checkbox(&schema, false);
        let mut tx = state.tr();
        // Move the caret to the end of "todo", far from the checkbox.
        tx.set_selection(Selection::caret(pos + 1 + 4));
        state = state.apply(tx);
        let before = state.selection();

        let next = dispatch_and_apply(&state, pos).expect("dispatched");
        assert_eq!(next.selection(), before);
    }
}
