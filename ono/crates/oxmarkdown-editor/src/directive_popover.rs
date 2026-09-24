//! Real click-to-select + a real attribute-editing popover for
//! directives — the interactivity gap `oxmarkdown_schema`'s own doc
//! comment (and this crate's README) called out as still missing after
//! per-directive-kind rendering landed. Mirrors the real product's own
//! convention (see the `oxmarkdown` skill's "Interactables" section):
//! "Directive — click/tap selects and shows a tooltip or a popover for
//! editing its attributes ... without hand-editing the directive text."
//!
//! **`:ref{...}` is deliberately excluded** — see the `graphlog` skill's
//! own "The `:ref{...}` directive" section: GraphLog is the only writer,
//! so it does NOT get the generic attrs-editing popover every other
//! directive gets. `is_editable_directive` is the one place that
//! exclusion lives.
//!
//! **Positioning is computed at click time, inside the `ViewPlugin`
//! itself** (`view.node_dom_at(pos)` + `get_bounding_client_rect()`),
//! not by the Leptos component reaching back into `EditorView` later —
//! `EditorView` isn't a reactive Leptos value the surrounding app can
//! hold onto; the click is the one moment a `ViewPlugin` genuinely has
//! it. The `Rc<dyn Fn(...)>` callback is how a `ViewPlugin` (living in
//! `taino-edit-dom`, with no Leptos knowledge at all) talks back to the
//! Leptos component tree around `<TainoEditor>` — the same bridging
//! problem `CheckboxTogglePlugin` never had to solve (it only ever
//! mutates the SHARED `EditorState`, never renders anything of its own
//! outside the contenteditable tree).
//!
//! **Finding the clicked directive reuses `EditorView::pos_at_point`'s
//! own documented behavior directly, no separate DOM-class check
//! needed** — confirmed by reading its source, not assumed: leaf/text
//! directive nodes here are NOT true zero-content atoms (they declare
//! `content: Some("text*")` for their synthetic label — see
//! `oxmarkdown_schema`'s own doc comment), so `pos_at_point`'s own
//! element-to-position lookup already resolves a click on a directive's
//! own wrapping element to that NODE's exact position; a click on a
//! CONTAINER directive's nested child paragraph resolves to THAT
//! PARAGRAPH's position instead (a different `ViewDesc`, matched
//! first), correctly and automatically declining to open the popover
//! for ordinary editing inside a container's real content.

use std::rc::Rc;

use leptos::prelude::*;
use serde_json::Value;
use taino_edit_core::Fragment;
use taino_edit_leptos::{
    EditorState, EditorView, Node, Schema, Selection, Slice, ViewAction, ViewPlugin,
};
use wasm_bindgen::JsCast;

use crate::convert;
use crate::oxmarkdown_schema::directive_name;

/// Where the popover should render, computed once at click time. `x`/`y`
/// are viewport-relative (from `get_bounding_client_rect`), matching
/// `position: fixed` — safe regardless of page scroll.
#[derive(Clone, Copy, PartialEq)]
pub struct PopoverTarget {
    pub pos: usize,
    pub x: f64,
    pub y: f64,
}

const DIRECTIVE_NODE_TYPES: [&str; 3] = ["leaf_directive", "container_directive", "text_directive"];

/// `:ref{...}` never gets the generic attrs-editing popover \u2014 see this
/// module's own doc comment.
fn is_editable_directive(node_type: &str, name: &str) -> bool {
    !(node_type == "text_directive" && name == "ref")
}

/// Deliberately NO `pos - 1` fallback here, unlike `checkbox_at_or_
/// before`'s own version of this check — confirmed by a real, live
/// browser test failure, not assumed safe by analogy. A `checkbox` is a
/// true zero-content atom (`node_size() == 1`), so `pos` and `pos - 1`
/// can only ever disagree by IMPRECISE pixel rounding on the SAME atom.
/// A directive here is NOT that: `container_directive` (and even leaf/
/// text directives, which declare `content: Some("text*")` for their
/// synthetic label — see `oxmarkdown_schema`'s own doc comment) has
/// real internal positions, so `pos - 1` from a click on its FIRST
/// child's own content can legitimately resolve to the ENCLOSING
/// container's own boundary instead — a real, different, OUTER node,
/// not the same one slightly off. Falling back there wrongly opened the
/// popover for an ordinary click inside a container's nested paragraph.
fn directive_at(doc: &Node, pos: usize) -> Option<(usize, Node)> {
    use taino_edit_leptos::ResolvedPos;
    let is_directive = |n: &Node| DIRECTIVE_NODE_TYPES.contains(&n.node_type().name());
    let rp = ResolvedPos::resolve(doc, pos).ok()?;
    let n = rp.node_after()?;
    is_directive(&n).then_some((pos, n))
}

/// The `ViewPlugin` half: intercepts a `mousedown` squarely on an
/// editable directive, stops the browser's own caret placement, and
/// tells the Leptos layer (via `on_select`) where to render the popover
/// — or that none should be showing, for any other click. Also fixes a
/// SECOND, separate click-related trap on `mouseup` — see
/// `handle_mouseup`'s own doc comment.
pub struct DirectivePopoverPlugin {
    on_select: Rc<dyn Fn(Option<PopoverTarget>)>,
}

impl DirectivePopoverPlugin {
    pub fn new(on_select: Rc<dyn Fn(Option<PopoverTarget>)>) -> Self {
        Self { on_select }
    }

    fn handle_mousedown(&self, view: &EditorView, event: &web_sys::Event) -> Option<ViewAction> {
        let mouse = event.dyn_ref::<web_sys::MouseEvent>()?;
        let pos = view.pos_at_point(mouse.client_x() as f32, mouse.client_y() as f32)?;
        let Some((start, node)) = directive_at(view.doc(), pos) else {
            (self.on_select)(None);
            return None;
        };
        let name = directive_name(&node);
        if !is_editable_directive(node.node_type().name(), &name) {
            (self.on_select)(None);
            return None;
        }
        let rect = view
            .node_dom_at(start)
            .map(|el| el.get_bounding_client_rect());
        let (x, y) = rect
            .map(|r| (r.left(), r.bottom() + 4.0))
            .unwrap_or((mouse.client_x() as f64, mouse.client_y() as f64 + 4.0));
        event.prevent_default();
        let _ = view.focus();
        (self.on_select)(Some(PopoverTarget { pos: start, x, y }));
        Some(ViewAction::Select(Selection::Node { pos: start }))
    }

    /// A SECOND, genuinely different click-related trap than the one
    /// `handle_mousedown` fixes: reported live — clicking in the empty
    /// space just past a leaf/text directive's own rendered pill (still
    /// on the same row, but not actually ON the pill) never reaches
    /// `handle_mousedown`'s own `pos_at_point`/`directive_at` check at
    /// all (that only matches a click resolving to the position
    /// immediately BEFORE the directive starts), so `event.
    /// prevent_default()` is never called and the BROWSER's own native
    /// caret-from-point placement runs unopposed — which, since the
    /// directive's own text is the nearest actual content to a click
    /// past its right edge, lands a bare caret INSIDE it (confirmed live
    /// via Playwright: `window.getSelection()` resolved into the
    /// directive's own text node at its last character). Once there,
    /// per the `oxmarkdown` skill's own "never places a bare caret
    /// inside it" rule (already enforced for arrow-key navigation — see
    /// `commands.rs` item 7 — but never for a raw mouse click landing
    /// there by accident), the fork's own `selection_touches_an_atom`
    /// guard then blocks every further keystroke, reading live as
    /// "I can no longer add a new line or write anything."
    ///
    /// Checked on `mouseup`, not `mousedown`: the browser's own native
    /// placement for this click is exactly what needs correcting, so it
    /// must be allowed to happen first; `EditorView::read_selection` then
    /// reads back wherever it actually landed (bypassing any assumption
    /// about `pos_at_point`'s own, separate resolution). If that lands
    /// `caret_trapped_in_directive_at`, the actual click coordinates are
    /// compared against the directive's own rendered bounding rect to
    /// decide the fix: genuinely within it (a rarer, defensive case —
    /// the ordinary "click squarely on it" path is already fully
    /// handled, and prevented, at `mousedown`) selects it as a whole
    /// unit, same as clicking directly on it; outside it (the reported
    /// case) runs the exact same "land outside" escape Enter/Arrow keys
    /// already use (`exit_directive_from`), forward if the click was to
    /// the right of the rect, backward if to the left.
    fn handle_mouseup(&self, view: &EditorView, event: &web_sys::Event) -> Option<ViewAction> {
        let mouse = event.dyn_ref::<web_sys::MouseEvent>()?;
        let Selection::Text { anchor, head } = view.read_selection()? else {
            return None;
        };
        if anchor != head {
            return None;
        }
        let (start, node) = crate::commands::caret_trapped_in_directive_at(view.doc(), anchor)?;
        let rect = view.node_dom_at(start)?.get_bounding_client_rect();
        let x = mouse.client_x() as f64;
        let y = mouse.client_y() as f64;
        let within = x >= rect.left() && x <= rect.right() && y >= rect.top() && y <= rect.bottom();
        event.prevent_default();
        let _ = view.focus();
        if within {
            let name = directive_name(&node);
            if is_editable_directive(node.node_type().name(), &name) {
                (self.on_select)(Some(PopoverTarget {
                    pos: start,
                    x: rect.left(),
                    y: rect.bottom() + 4.0,
                }));
            } else {
                (self.on_select)(None);
            }
            return Some(ViewAction::Select(Selection::Node { pos: start }));
        }
        (self.on_select)(None);
        let forward = x > rect.right();
        Some(ViewAction::Command(Box::new(move |s, d| {
            crate::commands::exit_directive_from(s, d, start, &node, forward)
        })))
    }
}

impl ViewPlugin for DirectivePopoverPlugin {
    fn handle_event(&self, view: &EditorView, event: &web_sys::Event) -> Option<ViewAction> {
        match event.type_().as_str() {
            "mousedown" => self.handle_mousedown(view, event),
            "mouseup" => self.handle_mouseup(view, event),
            _ => None,
        }
    }
}

/// Rebuilds a directive node with new `attributes`, regenerating its
/// synthetic display content the same way `convert.rs` does at parse
/// time (see that module's `directive_content`/`format_directive_label`)
/// \u2014 the display label is never itself the source of truth, so an
/// attrs edit must regenerate it, not try to patch it in place. A
/// `container_directive`'s real content (its actual child blocks) is
/// left completely untouched; only its `attributes` attr changes.
fn rebuild_directive_node(schema: &Schema, node: &Node, new_attributes: &Value) -> Option<Node> {
    let name = directive_name(node);
    let type_name = node.node_type().name();
    let attrs = convert::directive_attrs(&name, new_attributes);
    match type_name {
        "container_directive" => {
            let children = node.content().children().to_vec();
            schema
                .node(type_name, attrs, children, node.marks().to_vec())
                .ok()
        }
        "leaf_directive" | "text_directive" => {
            let fence = if type_name == "leaf_directive" {
                "::"
            } else {
                ":"
            };
            let content =
                convert::directive_content(schema, &name, new_attributes).unwrap_or_else(|| {
                    let label = convert::format_directive_label(fence, &name, new_attributes);
                    convert::text_node(schema, &label, vec![])
                        .into_iter()
                        .collect()
                });
            schema
                .node(type_name, attrs, content, node.marks().to_vec())
                .ok()
        }
        _ => None,
    }
}

fn input_value(ev: &leptos::ev::Event) -> String {
    ev.target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlInputElement>().ok())
        .map(|el| el.value())
        .unwrap_or_default()
}

/// The popover itself \u2014 renders nothing when `target` is `None`.
/// Mounted once, alongside `<TainoEditor>`, sharing the SAME `state`
/// signal (so Save/Remove are ordinary `state.set(...)` calls, no
/// `Dispatch`/`Command` indirection needed \u2014 that machinery exists for
/// `ViewPlugin`s reacting to raw DOM events INSIDE the contenteditable
/// tree; a click on this popover's own Save button is a plain Leptos
/// event handler with direct signal access already).
#[component]
pub fn DirectiveAttrsPopover(
    state: RwSignal<EditorState>,
    target: RwSignal<Option<PopoverTarget>>,
) -> impl IntoView {
    view! {
        <Show when=move || target.get().is_some()>
            {move || {
                let Some(t) = target.get() else {
                    return ().into_any();
                };
                let Some(node) = state.get_untracked().doc().node_at(t.pos) else {
                    target.set(None);
                    return ().into_any();
                };
                let name = directive_name(&node);
                let mut initial: Vec<(String, String)> = node
                    .attrs()
                    .get("attributes")
                    .and_then(|v| v.as_object())
                    .map(|map| {
                        map.iter()
                            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                initial.sort();
                let rows = RwSignal::new(initial);
                let title = format!("::{name}");
                let style = format!("left: {}px; top: {}px;", t.x, t.y);

                let save = move |_| {
                    let current = state.get_untracked();
                    let Some(current_node) = current.doc().node_at(t.pos) else {
                        target.set(None);
                        return;
                    };
                    let mut obj = serde_json::Map::new();
                    for (k, v) in rows.get_untracked() {
                        if !k.is_empty() {
                            obj.insert(k, Value::String(v));
                        }
                    }
                    let Some(new_node) =
                        rebuild_directive_node(current.schema(), &current_node, &Value::Object(obj))
                    else {
                        target.set(None);
                        return;
                    };
                    let mut tx = current.tr();
                    let old_size = current_node.node_size();
                    let replaced = tx.transform().replace(
                        t.pos,
                        t.pos + old_size,
                        Slice::new(Fragment::from_node(new_node), 0, 0),
                        current.schema(),
                    );
                    if replaced.is_ok() {
                        tx.set_selection(Selection::Node { pos: t.pos });
                        state.set(current.apply(tx));
                    }
                    target.set(None);
                };
                let cancel = move |_| target.set(None);
                let remove = move |_| {
                    let current = state.get_untracked();
                    let Some(current_node) = current.doc().node_at(t.pos) else {
                        target.set(None);
                        return;
                    };
                    let mut tx = current.tr();
                    let removed = tx.transform().replace(
                        t.pos,
                        t.pos + current_node.node_size(),
                        Slice::empty(),
                        current.schema(),
                    );
                    if removed.is_ok() {
                        state.set(current.apply(tx));
                    }
                    target.set(None);
                };
                let add_row = move |_| rows.update(|r| r.push((String::new(), String::new())));

                view! {
                    <div class="ox-directive-popover" style=style>
                        <div class="ox-directive-popover-title">{title}</div>
                        {move || {
                            rows.get()
                                .into_iter()
                                .enumerate()
                                .map(|(i, (k, v))| {
                                    view! {
                                        <div class="ox-directive-popover-row">
                                            <input
                                                class="ox-directive-popover-key"
                                                prop:value=k
                                                on:input=move |ev| {
                                                    let val = input_value(&ev);
                                                    rows.update(|r| {
                                                        if let Some(entry) = r.get_mut(i) {
                                                            entry.0 = val;
                                                        }
                                                    });
                                                }
                                            />
                                            <span>"="</span>
                                            <input
                                                class="ox-directive-popover-value"
                                                prop:value=v
                                                on:input=move |ev| {
                                                    let val = input_value(&ev);
                                                    rows.update(|r| {
                                                        if let Some(entry) = r.get_mut(i) {
                                                            entry.1 = val;
                                                        }
                                                    });
                                                }
                                            />
                                            <button
                                                class="ox-directive-popover-row-remove"
                                                on:click=move |_| rows.update(|r| {
                                                    if i < r.len() {
                                                        r.remove(i);
                                                    }
                                                })
                                            >
                                                "\u{d7}"
                                            </button>
                                        </div>
                                    }
                                })
                                .collect::<Vec<_>>()
                        }}
                        <button class="ox-directive-popover-add" on:click=add_row>
                            "+ attribute"
                        </button>
                        <div class="ox-directive-popover-actions">
                            <button class="ox-directive-popover-save" on:click=save>
                                "Save"
                            </button>
                            <button class="ox-directive-popover-cancel" on:click=cancel>
                                "Cancel"
                            </button>
                            <button class="ox-directive-popover-remove" on:click=remove>
                                "Remove directive"
                            </button>
                        </div>
                    </div>
                }
                .into_any()
            }}
        </Show>
    }
}
