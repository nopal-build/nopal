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

use taino_edit_core::ParseRule;
use taino_edit_extensions::{Extension, SchemaAdditions};
use taino_edit_leptos::{AttrSpec, AttrValue, DomSpec, MarkSpec, Node, NodeSpec};

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

/// The three generic directive kinds (`:name{}` text / `::name{}` leaf /
/// `:::name{}` container) as real node types — see the `oxmarkdown`
/// skill's own "Generic directives" section for the source syntax these
/// mirror. No per-directive-kind (`::file`, `::card`, ...) rendering or
/// interactivity yet, deliberately: this proves the STRUCTURE (real
/// nodes, losslessly preserved attrs, container content genuinely
/// editable) before any specific directive gets a rich UI, matching how
/// `oxmarkdown-editor` proved taino-edit's own integration before this.
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
                            DomSpec::element("div")
                                .attr("class", "ox-directive ox-directive-leaf")
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
                            DomSpec::element("span")
                                .attr("class", "ox-directive ox-directive-text")
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

/// A GFM task-list item's checkbox, as a real (if not yet interactive —
/// see this module's own doc comment) inline atom, placed as the first
/// inline child of a task list item's first paragraph. Renders a real,
/// but currently `disabled`, `<input type="checkbox">`: genuinely
/// interactive click-to-toggle needs a `taino-edit-dom` "change"/"click"
/// listener wired to a model-updating command, which doesn't exist yet
/// for ANY node in this schema (not a checkbox-specific gap) — left
/// disabled rather than shipping a checkbox that looks clickable but
/// silently does nothing, which would be a worse, more confusing
/// interim state than an honestly-inert one.
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
                            .attr("disabled", "disabled")
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
