//! The markdown \u{27f7} taino-edit conversion layer — parses real
//! OxMarkdown text via `oxmarkdown_rs::parse_document` (the same
//! proven parser `oxmarkdown-leptos` uses for rendering) into mdast-
//! shaped JSON, then converts THAT into a real `taino-edit` `Node`
//! tree, rather than routing through `taino-edit`'s own Markdown
//! parser (which doesn't know OxMarkdown's dialect at all — no
//! directives, no `==highlight==`). Mirrors the shape the real product
//! already uses (`editingTransforms.ts` converts mdast \u{27f7} Lexical
//! nodes) — same idea, different framework, same reason: two AST
//! shapes need a real bridge, not a second parser.
//!
//! Directives, checkboxes, `==highlight==`, and GFM strikethrough now
//! convert to the real node/mark types in `oxmarkdown_schema` — see that
//! module's own doc comment for what each is and the real constraints
//! found building them. A hard line break (`break`) is still a plain
//! space stand-in (no real line-break equivalent in this schema — see
//! `ono/README.md`'s follow-up list), and `@`-mentions need no special
//! handling at all: they're already just `link` nodes.

use serde_json::Value;
use taino_edit_leptos::{AttrValue, Attrs, Mark, Node, Schema};

/// The one entry point — parses `markdown` and converts it into a real
/// `doc` node for this schema. Falls back to a single paragraph
/// reporting the parse error rather than panicking, since a malformed
/// document should never crash the editor.
pub fn markdown_to_doc(schema: &Schema, markdown: &str) -> Node {
    let mdast = match oxmarkdown_rs::parse_document(markdown) {
        Ok(tree) => tree,
        Err(err) => return error_doc(schema, &format!("Parse error: {err}")),
    };
    let blocks = convert_blocks(schema, &mdast);
    let blocks = if blocks.is_empty() {
        vec![empty_paragraph(schema)]
    } else {
        blocks
    };
    schema
        .node("doc", Attrs::new(), blocks, vec![])
        .unwrap_or_else(|_| error_doc(schema, "Failed to build document"))
}

fn error_doc(schema: &Schema, message: &str) -> Node {
    let text = schema
        .text(message, vec![])
        .expect("plain text always valid");
    let para = schema
        .node("paragraph", Attrs::new(), vec![text], vec![])
        .expect("paragraph of plain text always valid");
    schema
        .node("doc", Attrs::new(), vec![para], vec![])
        .expect("doc of one paragraph always valid")
}

fn empty_paragraph(schema: &Schema) -> Node {
    schema
        .node("paragraph", Attrs::new(), vec![], vec![])
        .expect("empty paragraph always valid")
}

fn text_node(schema: &Schema, value: &str, marks: Vec<Mark>) -> Option<Node> {
    if value.is_empty() {
        return None;
    }
    schema.text(value, marks).ok()
}

/// The two attrs every directive node shares (see `oxmarkdown_schema`'s
/// own doc comment for why a single JSON-object `attributes` attr,
/// rather than one attr per key).
fn directive_attrs(name: &str, attributes: &Value) -> Attrs {
    let mut attrs = Attrs::new();
    attrs.insert("name".to_string(), AttrValue::from(name.to_string()));
    attrs.insert("attributes".to_string(), attributes.clone());
    attrs
}

/// Reconstructs a human-readable `fence + name + {key="value" ...}`
/// label from a directive's name/attributes, for the synthetic display
/// text `oxmarkdown_schema`'s leaf/text directive nodes need (see that
/// module's own doc comment on the real `DomSpec` limitation this works
/// around). Attribute ORDER is not preserved (`attributes` came from a
/// `HashMap`, which has none) — sorted here purely for a deterministic
/// display string; the actual source of truth for round-tripping is the
/// `attributes` JSON value stored as a real node attr, which is
/// order-independent.
fn format_directive_label(fence: &str, name: &str, attributes: &Value) -> String {
    let mut label = format!("{fence}{name}");
    if let Some(map) = attributes.as_object() {
        if !map.is_empty() {
            let mut pairs: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{k}=\"{}\"", v.as_str().unwrap_or("")))
                .collect();
            pairs.sort();
            label.push('{');
            label.push_str(&pairs.join(" "));
            label.push('}');
        }
    }
    label
}

fn convert_blocks(schema: &Schema, node: &Value) -> Vec<Node> {
    node["children"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| convert_block(schema, c))
                .collect()
        })
        .unwrap_or_default()
}

fn convert_block(schema: &Schema, node: &Value) -> Option<Node> {
    match node["type"].as_str().unwrap_or("") {
        "heading" => {
            let depth = node["depth"].as_u64().unwrap_or(1).clamp(1, 6);
            let mut attrs = Attrs::new();
            attrs.insert("level".to_string(), AttrValue::from(depth));
            let children = convert_inline_children(schema, node, &[]);
            schema.node("heading", attrs, children, vec![]).ok()
        }
        "paragraph" => {
            let children = convert_inline_children(schema, node, &[]);
            schema
                .node("paragraph", Attrs::new(), children, vec![])
                .ok()
        }
        "blockquote" => {
            let children = convert_blocks(schema, node);
            schema
                .node("blockquote", Attrs::new(), children, vec![])
                .ok()
        }
        "code" => {
            let value = node["value"].as_str().unwrap_or("");
            let children = text_node(schema, value, vec![]).into_iter().collect();
            schema
                .node("code_block", Attrs::new(), children, vec![])
                .ok()
        }
        "list" => {
            let ordered = node["ordered"].as_bool().unwrap_or(false);
            let name = if ordered {
                "ordered_list"
            } else {
                "bullet_list"
            };
            let items: Vec<Node> = node["children"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| convert_list_item(schema, item))
                        .collect()
                })
                .unwrap_or_default();
            schema.node(name, Attrs::new(), items, vec![]).ok()
        }
        // No `horizontal_rule`/frontmatter node in this minimal schema
        // yet — dropped, not shown as a placeholder, since neither
        // carries meaningful content of its own to preserve.
        "thematicBreak" | "yaml" => None,
        // A leaf directive is a real, atomic `leaf_directive` node now
        // (see `oxmarkdown_schema`) — `name`/`attributes` are preserved
        // losslessly as real node attrs; the text child is only a
        // synthetic display label.
        "leafDirective" => {
            let name = node["name"].as_str().unwrap_or("");
            let attributes = &node["attributes"];
            let label = format_directive_label("::", name, attributes);
            let text = text_node(schema, &label, vec![])?;
            schema
                .node(
                    "leaf_directive",
                    directive_attrs(name, attributes),
                    vec![text],
                    vec![],
                )
                .ok()
        }
        // A container directive is a real `container_directive` node
        // whose children convert NORMALLY (genuinely, individually
        // editable content — not a placeholder wrapping degraded text
        // the way this used to fall back to a `blockquote`).
        "containerDirective" => {
            let name = node["name"].as_str().unwrap_or("");
            let attributes = &node["attributes"];
            let mut children = convert_blocks(schema, node);
            if children.is_empty() {
                // `container_directive`'s content model is `block+` (at
                // least one child) — an empty `:::name\n:::` still needs
                // something to satisfy it.
                children.push(empty_paragraph(schema));
            }
            schema
                .node(
                    "container_directive",
                    directive_attrs(name, attributes),
                    children,
                    vec![],
                )
                .ok()
        }
        _ => None,
    }
}

/// A GFM task-list item's checkbox is now a real (if not yet
/// interactive) `checkbox` inline atom — see `oxmarkdown_schema`'s own
/// doc comment for why this diverges from the real product's own
/// "attribute on the list item" convention (a real, confirmed
/// constraint of `taino-edit-extensions`'s `Lists` already owning the
/// `"list_item"` node type, not an oversight). Prepended as the first
/// inline child of the item's first paragraph after that paragraph
/// converts normally, rather than mutating the pre-conversion JSON the
/// way the old text-marker version did.
fn convert_list_item(schema: &Schema, node: &Value) -> Option<Node> {
    let checked = node["checked"].as_bool();
    let mut converted: Vec<Node> = node["children"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| convert_block(schema, c))
                .collect()
        })
        .unwrap_or_default();
    if let Some(is_checked) = checked {
        if let Some(first) = converted.first() {
            if first.node_type().name() == "paragraph" {
                let mut attrs = Attrs::new();
                attrs.insert("checked".to_string(), AttrValue::from(is_checked));
                if let Ok(checkbox) = schema.node("checkbox", attrs, vec![], vec![]) {
                    let mut children = first.content().children().to_vec();
                    children.insert(0, checkbox);
                    if let Ok(rebuilt) =
                        schema.node("paragraph", Attrs::new(), children, first.marks().to_vec())
                    {
                        converted[0] = rebuilt;
                    }
                }
            }
        }
    }
    schema
        .node("list_item", Attrs::new(), converted, vec![])
        .ok()
}

fn convert_inline_children(schema: &Schema, node: &Value, marks: &[Mark]) -> Vec<Node> {
    node["children"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .flat_map(|c| convert_inline(schema, c, marks))
                .collect()
        })
        .unwrap_or_default()
}

fn with_mark(schema: &Schema, marks: &[Mark], mark_name: &str, attrs: Attrs) -> Vec<Mark> {
    let mut next = marks.to_vec();
    if let Some(mark_type) = schema.mark_type(mark_name) {
        next.push(mark_type.create(attrs));
    }
    next
}

fn convert_inline(schema: &Schema, node: &Value, marks: &[Mark]) -> Vec<Node> {
    match node["type"].as_str().unwrap_or("") {
        "text" => text_node(schema, node["value"].as_str().unwrap_or(""), marks.to_vec())
            .into_iter()
            .collect(),
        "strong" => {
            let next = with_mark(schema, marks, "strong", Attrs::new());
            convert_inline_children(schema, node, &next)
        }
        "emphasis" => {
            let next = with_mark(schema, marks, "em", Attrs::new());
            convert_inline_children(schema, node, &next)
        }
        "inlineCode" => {
            let next = with_mark(schema, marks, "code", Attrs::new());
            text_node(schema, node["value"].as_str().unwrap_or(""), next)
                .into_iter()
                .collect()
        }
        // `@`-mentions need no special case at all: the real product's
        // own convention (see the `oxmarkdown` skill) saves a mention as
        // a plain `[@Name](path)` link — already just this.
        "link" => {
            let mut attrs = Attrs::new();
            attrs.insert(
                "href".to_string(),
                AttrValue::from(node["url"].as_str().unwrap_or("").to_string()),
            );
            let next = with_mark(schema, marks, "link", attrs);
            convert_inline_children(schema, node, &next)
        }
        "image" => {
            let mut attrs = Attrs::new();
            attrs.insert(
                "src".to_string(),
                AttrValue::from(node["url"].as_str().unwrap_or("").to_string()),
            );
            attrs.insert(
                "alt".to_string(),
                AttrValue::from(node["alt"].as_str().unwrap_or("").to_string()),
            );
            schema
                .node("image", attrs, vec![], marks.to_vec())
                .ok()
                .into_iter()
                .collect()
        }
        // A hard line break has no equivalent in this minimal schema —
        // a plain space is the closest lossless-enough stand-in
        // (loses the line-break itself, keeps the word boundary).
        "break" => text_node(schema, " ", marks.to_vec()).into_iter().collect(),
        // GFM strikethrough and `==highlight==` are now real marks
        // (`oxmarkdown_schema::Strikethrough`/`Highlight`).
        "delete" => {
            let next = with_mark(schema, marks, "strikethrough", Attrs::new());
            convert_inline_children(schema, node, &next)
        }
        "mark" => {
            let next = with_mark(schema, marks, "highlight", Attrs::new());
            convert_inline_children(schema, node, &next)
        }
        // An inline text directive (`:ref{...}`) is now a real, atomic
        // `text_directive` node (see the block-level directives above
        // for the same reasoning).
        "textDirective" => {
            let name = node["name"].as_str().unwrap_or("");
            let attributes = &node["attributes"];
            let label = format_directive_label(":", name, attributes);
            let Some(text) = text_node(schema, &label, vec![]) else {
                return Vec::new();
            };
            schema
                .node(
                    "text_directive",
                    directive_attrs(name, attributes),
                    vec![text],
                    marks.to_vec(),
                )
                .ok()
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oxmarkdown_schema::{Checkbox, Directives, Highlight, Strikethrough};
    use taino_edit_extensions::{
        build_schema_with, Blockquote, Bold, Code, CodeBlock, Extension, Heading, Image, Italic,
        Link, Lists, Paragraph,
    };
    use taino_edit_leptos::{NodeSpec, SchemaBuilder};

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
        build_schema_with(base, &exts, "doc").expect("schema builds")
    }

    fn find_all<'a>(node: &'a Node, type_name: &str, out: &mut Vec<&'a Node>) {
        if node.node_type().name() == type_name {
            out.push(node);
        }
        for child in node.content().children() {
            find_all(child, type_name, out);
        }
    }

    #[test]
    fn leaf_directive_becomes_a_real_atomic_node_with_preserved_attrs() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "::badge{label=\"hi\"}\n");
        let mut found = Vec::new();
        find_all(&doc, "leaf_directive", &mut found);
        assert_eq!(found.len(), 1);
        let node = found[0];
        assert_eq!(
            node.attrs().get("name").and_then(|v| v.as_str()),
            Some("badge")
        );
        assert_eq!(
            node.attrs()
                .get("attributes")
                .and_then(|v| v.get("label"))
                .and_then(|v| v.as_str()),
            Some("hi")
        );
        // Synthetic display label child, for visibility, not the source
        // of truth for round-tripping.
        assert_eq!(node.text_content(), "::badge{label=\"hi\"}");
    }

    #[test]
    fn container_directive_preserves_multiple_real_child_paragraphs() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, ":::note{title=\"x\"}\nfirst\n\nsecond\n:::\n");
        let mut found = Vec::new();
        find_all(&doc, "container_directive", &mut found);
        assert_eq!(found.len(), 1);
        let node = found[0];
        assert_eq!(
            node.attrs().get("name").and_then(|v| v.as_str()),
            Some("note")
        );
        assert_eq!(node.child_count(), 2, "both paragraphs, not truncated");
        assert_eq!(node.text_content(), "firstsecond");
    }

    #[test]
    fn text_directive_becomes_a_real_inline_atomic_node() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "See :ref{name=\"Jane\"} for details.\n");
        let mut found = Vec::new();
        find_all(&doc, "text_directive", &mut found);
        assert_eq!(found.len(), 1);
        let node = found[0];
        assert_eq!(
            node.attrs().get("name").and_then(|v| v.as_str()),
            Some("ref")
        );
        assert_eq!(
            node.attrs()
                .get("attributes")
                .and_then(|v| v.get("name"))
                .and_then(|v| v.as_str()),
            Some("Jane")
        );
    }

    #[test]
    fn task_list_checkboxes_become_real_checkbox_atoms() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "- [ ] todo\n- [x] done\n- plain\n");
        let mut found = Vec::new();
        find_all(&doc, "checkbox", &mut found);
        assert_eq!(found.len(), 2, "only the two task items get a checkbox");
        assert_eq!(
            found[0].attrs().get("checked").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(
            found[1].attrs().get("checked").and_then(|v| v.as_bool()),
            Some(true)
        );
        // The checkbox is a real inline atom, prepended before the text --
        // NOT a "[ ] "/"[x] " text marker anymore.
        assert!(!doc.text_content().contains('['));
    }

    #[test]
    fn highlight_and_strikethrough_become_real_marks() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "==important== and ~~gone~~ text.\n");
        assert!(schema.mark_type("highlight").is_some());
        assert!(schema.mark_type("strikethrough").is_some());
        let json = serde_json::to_string(&doc.to_json()).unwrap();
        assert!(json.contains("highlight"), "{json}");
        assert!(json.contains("strikethrough"), "{json}");
        assert_eq!(doc.text_content(), "important and gone text.");
    }

    #[test]
    fn a_mention_style_link_needs_no_special_handling() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "[@Jane Doe](/alice:root/Jane)\n");
        let json = serde_json::to_string(&doc.to_json()).unwrap();
        assert!(json.contains("link"), "{json}");
        assert!(json.contains("/alice:root/Jane"), "{json}");
        assert_eq!(doc.text_content(), "@Jane Doe");
    }
}
