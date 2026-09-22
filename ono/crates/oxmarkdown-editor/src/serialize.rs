//! The other half of the markdown \u{27f7} taino-edit bridge (see
//! `convert.rs`'s own doc comment for the forward direction): converts a
//! real `taino-edit` document `Node` back into mdast-shaped JSON, then
//! hands that to `oxmarkdown_rs::serialize_document` (the SAME
//! mdast-JSON \u{27f7} markdown half `oxmarkdown-rs`'s own round-trip tests
//! already prove) \u2014 not a second, hand-rolled markdown writer. This is
//! the missing piece `convert.rs`'s own doc comment and this crate's
//! README both called out: editing didn't survive a save at all until
//! this existed.
//!
//! **The synthetic display content `convert.rs` generates for
//! leaf/text directives is never read back here** \u2014 every directive's
//! `name`/`attributes` node attrs are the real, lossless source of
//! truth (see `oxmarkdown_schema`'s own doc comment on why), so
//! `directive_to_mdast`/`text_directive_to_mdast` reconstruct straight
//! from those attrs, exactly mirroring `convert.rs`'s forward direction
//! rather than trying to parse the display label back apart.
//!
//! **A GFM task-list checkbox is extracted back out**, not serialized as
//! itself: `oxmarkdown_schema`'s own doc comment explains why it's a real
//! inline atom here rather than a `list_item` attribute (a schema
//! constraint, not a design preference) \u2014 `list_item_to_mdast` undoes
//! that by pulling a leading `checkbox` atom off the item's first
//! paragraph and setting mdast `listItem.checked` from it, mirroring
//! `convert.rs`'s `convert_list_item` in reverse.
//!
//! **Mark nesting order is a real, deliberate choice, not incidental**:
//! `taino-edit-core`'s `Node::marks()` is an unordered SET of marks on a
//! text run, not a nested tree the way mdast's own `strong`/`emphasis`/
//! `delete`/`mark`/`link` wrapper nodes are \u2014 so `text_node_to_mdast`
//! picks one fixed nesting order (link outermost, since a "linked run of
//! styled text" reads as a link wrapping styled content, not the other
//! way around; `code` always wins outright and drops every other mark,
//! since a real CommonMark code span's content is literal and can't
//! contain nested emphasis/strikethrough/highlight/link markup at all).

use serde_json::{json, Value};
use taino_edit_leptos::Node;

/// The one entry point \u2014 the reverse of `convert::markdown_to_doc`.
/// Converts `doc` to mdast-shaped JSON, then serializes that to real
/// OxMarkdown text via `oxmarkdown_rs::serialize_document` (the same
/// mdast-JSON \u2192 markdown half `markdown_to_doc` implicitly trusts on the
/// way in, via `oxmarkdown_rs::parse_document`).
pub fn doc_to_markdown(doc: &Node) -> String {
    let root = json!({ "type": "root", "children": blocks_to_mdast(doc) });
    oxmarkdown_rs::serialize_document(&root)
}

fn attr_str<'a>(node: &'a Node, key: &str) -> &'a str {
    node.attrs().get(key).and_then(|v| v.as_str()).unwrap_or("")
}

fn directive_name(node: &Node) -> &str {
    attr_str(node, "name")
}

fn directive_attributes(node: &Node) -> Value {
    node.attrs()
        .get("attributes")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default()))
}

/// Every direct block-level child of `node` (its own `content()`), each
/// converted via `node_to_mdast_block`. Shared by the document root,
/// `blockquote`, `container_directive`, and a list item's own body \u2014
/// every one of those has a `"block+"`/`"block*"` content model.
fn blocks_to_mdast(node: &Node) -> Vec<Value> {
    node.content()
        .children()
        .iter()
        .filter_map(node_to_mdast_block)
        .collect()
}

fn node_to_mdast_block(node: &Node) -> Option<Value> {
    match node.node_type().name() {
        "paragraph" => Some(json!({
            "type": "paragraph",
            "children": inline_children_to_mdast(node),
        })),
        "heading" => {
            let depth = node
                .attrs()
                .get("level")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .clamp(1, 6);
            Some(json!({
                "type": "heading",
                "depth": depth,
                "children": inline_children_to_mdast(node),
            }))
        }
        "blockquote" => Some(json!({
            "type": "blockquote",
            "children": blocks_to_mdast(node),
        })),
        "code_block" => Some(json!({
            "type": "code",
            "lang": Value::Null,
            "value": node.text_content(),
        })),
        "bullet_list" => Some(json!({
            "type": "list",
            "ordered": false,
            "children": list_items_to_mdast(node),
        })),
        "ordered_list" => {
            let start = node
                .attrs()
                .get("start")
                .and_then(|v| v.as_u64())
                .unwrap_or(1);
            Some(json!({
                "type": "list",
                "ordered": true,
                "start": start,
                "children": list_items_to_mdast(node),
            }))
        }
        "leaf_directive" => Some(json!({
            "type": "leafDirective",
            "name": directive_name(node),
            "attributes": directive_attributes(node),
        })),
        "container_directive" => Some(json!({
            "type": "containerDirective",
            "name": directive_name(node),
            "attributes": directive_attributes(node),
            "children": blocks_to_mdast(node),
        })),
        // Anything not yet mapped (tables, raw HTML, ...) is dropped
        // rather than panicking \u2014 the same lossy-passthrough gap
        // `oxmarkdown_rs::serialize_document` itself already documents
        // for its own unhandled cases, not a new one introduced here.
        _ => None,
    }
}

fn list_items_to_mdast(list_node: &Node) -> Vec<Value> {
    list_node
        .content()
        .children()
        .iter()
        .map(list_item_to_mdast)
        .collect()
}

/// The reverse of `convert::convert_list_item`: a `checkbox` atom
/// prepended as the first inline child of the item's first paragraph
/// becomes mdast `listItem.checked`, and is NOT also serialized as
/// inline content \u2014 GFM's own `[ ]`/`[x]` marker is written by
/// `oxmarkdown_rs::serialize_document`'s `serialize_list` FROM that
/// `checked` field, not from anything inline.
fn list_item_to_mdast(item: &Node) -> Value {
    let children = item.content().children();
    let mut checked: Option<bool> = None;
    let mut mdast_children = Vec::with_capacity(children.len());

    for (i, child) in children.iter().enumerate() {
        if i == 0 && child.node_type().name() == "paragraph" {
            let inline_kids = child.content().children();
            if let Some(first) = inline_kids.first() {
                if first.node_type().name() == "checkbox" {
                    checked = first.attrs().get("checked").and_then(|v| v.as_bool());
                    let rest: Vec<Value> = inline_kids[1..]
                        .iter()
                        .filter_map(inline_node_to_mdast)
                        .collect();
                    mdast_children.push(json!({ "type": "paragraph", "children": rest }));
                    continue;
                }
            }
        }
        if let Some(v) = node_to_mdast_block(child) {
            mdast_children.push(v);
        }
    }

    let mut value = json!({ "type": "listItem", "children": mdast_children });
    if let Some(c) = checked {
        value["checked"] = Value::Bool(c);
    }
    value
}

fn inline_children_to_mdast(node: &Node) -> Vec<Value> {
    node.content()
        .children()
        .iter()
        .filter_map(inline_node_to_mdast)
        .collect()
}

fn inline_node_to_mdast(node: &Node) -> Option<Value> {
    if node.is_text() {
        return Some(text_node_to_mdast(node));
    }
    match node.node_type().name() {
        "image" => Some(json!({
            "type": "image",
            "url": attr_str(node, "src"),
            "alt": attr_str(node, "alt"),
        })),
        "text_directive" => Some(json!({
            "type": "textDirective",
            "name": directive_name(node),
            "attributes": directive_attributes(node),
        })),
        // A standalone `checkbox` outside a list item's leading position
        // (shouldn't happen from our own conversions, but defensively:
        // there's no mdast inline equivalent for one) is dropped, same
        // as any other unmapped inline node.
        _ => None,
    }
}

/// Wraps a text run's raw value in whatever mdast mark-wrapper nodes its
/// `taino-edit` marks call for \u2014 see this module's own doc comment for
/// why the nesting order is a deliberate, fixed choice, not incidental.
fn text_node_to_mdast(node: &Node) -> Value {
    let marks = node.marks();
    let value = node.text().unwrap_or("").to_string();

    // A real code span's content is literal \u2014 no nested markup, ever.
    if marks.iter().any(|m| m.mark_type().name() == "code") {
        return json!({ "type": "inlineCode", "value": value });
    }

    let mut wrapped = json!({ "type": "text", "value": value });
    // Innermost first: strikethrough, then highlight, then emphasis,
    // then strong, then link outermost.
    for name in ["strikethrough", "highlight", "em", "strong", "link"] {
        if let Some(mark) = marks.iter().find(|m| m.mark_type().name() == name) {
            wrapped = wrap_mark(name, mark, wrapped);
        }
    }
    wrapped
}

fn wrap_mark(name: &str, mark: &taino_edit_leptos::Mark, inner: Value) -> Value {
    match name {
        "strong" => json!({ "type": "strong", "children": [inner] }),
        "em" => json!({ "type": "emphasis", "children": [inner] }),
        "strikethrough" => json!({ "type": "delete", "children": [inner] }),
        "highlight" => json!({ "type": "mark", "children": [inner] }),
        "link" => {
            let href = mark
                .attrs()
                .get("href")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            json!({ "type": "link", "url": href, "children": [inner] })
        }
        _ => inner,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::markdown_to_doc;
    use crate::oxmarkdown_schema::{Checkbox, Directives, Highlight, Strikethrough};
    use taino_edit_extensions::{
        build_schema_with, Blockquote, Bold, Code, CodeBlock, Extension, Heading, Image, Italic,
        Link, Lists, Paragraph,
    };
    use taino_edit_leptos::{NodeSpec, Schema, SchemaBuilder};

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
            &Code,
            &Link,
            &Image,
            &Blockquote,
            &CodeBlock,
            &Lists,
            &Highlight,
            &Strikethrough,
            &Directives,
            &Checkbox,
        ];
        build_schema_with(base, &exts, "doc").unwrap()
    }

    /// The strongest test this bridge can get: parse -> serialize ->
    /// parse again must produce the SAME tree (same convention
    /// `oxmarkdown-rs`'s own `serialize.rs` round-trip tests already
    /// hold the markdown-JS-JSON half to).
    fn assert_round_trips(markdown: &str) {
        let schema = test_schema();
        let first = markdown_to_doc(&schema, markdown);
        let serialized = doc_to_markdown(&first);
        let second = markdown_to_doc(&schema, &serialized);
        assert_eq!(
            serde_json::to_string_pretty(&first.to_json()).unwrap(),
            serde_json::to_string_pretty(&second.to_json()).unwrap(),
            "round trip mismatch.\n--- serialized ---\n{serialized}"
        );
    }

    #[test]
    fn round_trips_plain_prose_with_marks() {
        assert_round_trips(
            "Bold **b**, italic *i*, code `c`, and a [link](https://example.com).\n",
        );
    }

    #[test]
    fn round_trips_a_heading() {
        assert_round_trips("### A heading\n");
    }

    #[test]
    fn round_trips_a_blockquote() {
        assert_round_trips("> quoted text\n");
    }

    #[test]
    fn round_trips_a_code_block() {
        assert_round_trips("```\nfn main() {}\n```\n");
    }

    #[test]
    fn round_trips_bullet_and_ordered_lists() {
        assert_round_trips("- one\n- two\n\n1. first\n2. second\n");
    }

    #[test]
    fn round_trips_a_task_list_with_mixed_checked_state() {
        assert_round_trips("- [ ] todo\n- [x] done\n- plain bullet\n");
    }

    #[test]
    fn round_trips_highlight_and_strikethrough() {
        assert_round_trips("==important== and ~~gone~~ text.\n");
    }

    #[test]
    fn round_trips_a_generic_leaf_directive() {
        assert_round_trips("::mystery{x=\"1\"}\n");
    }

    #[test]
    fn round_trips_a_badge_directive() {
        assert_round_trips("::badge{label=\"Ready\"}\n");
    }

    #[test]
    fn round_trips_a_container_directive_with_multiple_paragraphs() {
        assert_round_trips(":::note{title=\"x\"}\nfirst\n\nsecond\n:::\n");
    }

    #[test]
    fn round_trips_a_non_verbose_ref_directive() {
        assert_round_trips("Decided to use cedar :ref{name=\"Jane\" location=\"/x\"} today.\n");
    }

    #[test]
    fn round_trips_a_verbose_ref_directive() {
        assert_round_trips(
            "Decided on cedar :ref{name=\"Jane Doe\" datetime=\"2026-08-17T14:30:00Z\" location=\"/x\" verbose=\"true\"} today.\n",
        );
    }

    #[test]
    fn round_trips_an_image() {
        assert_round_trips("![alt text](https://example.com/x.png)\n");
    }

    #[test]
    fn code_span_drops_any_other_mark_since_a_real_one_never_combines() {
        // A text node that is BOTH `code`-marked and (hypothetically)
        // something else must still serialize as a plain inline code
        // span \u2014 real CommonMark code spans have no nested markup.
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "`literal *not emphasis*`\n");
        let markdown = doc_to_markdown(&doc);
        assert_eq!(markdown, "`literal *not emphasis*`\n");
    }
}
