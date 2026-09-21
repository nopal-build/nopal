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
//! Scope: this crate's minimal schema only (paragraph, heading, bold,
//! italic, code (inline mark), link, image, blockquote, code_block,
//! bullet/ordered lists). Anything the schema has no real node/mark for
//! yet (directives, `==highlight==`, GFM strikethrough, task-list
//! checkboxes as a REAL interactive state) degrades to plain, visible
//! text — see each `match` arm below for exactly how — rather than
//! silently dropping content. Building the actual OxMarkdown schema
//! (directives as real node types via `Extension`, checkboxes as a
//! real attribute, mentions, highlight as a real mark) is the next,
//! separate step once this conversion shape itself is proven.

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
        // Directives (leaf/container) have no real node type yet — a
        // plain, visible placeholder paragraph, so content is never
        // silently lost even though it isn't really editable as a
        // directive. Real per-directive node types are the actual
        // follow-up work (see this crate's README).
        "leafDirective" => {
            let name = node["name"].as_str().unwrap_or("?");
            let label = format!("[::{name}{{...}} \u{2014} directive not yet supported here]");
            let text = text_node(schema, &label, vec![])?;
            schema
                .node("paragraph", Attrs::new(), vec![text], vec![])
                .ok()
        }
        "containerDirective" => {
            let name = node["name"].as_str().unwrap_or("?");
            let label = format!("[:::{name}{{...}} \u{2014} directive not yet supported here]");
            let text = text_node(schema, &label, vec![])?;
            let placeholder = schema
                .node("paragraph", Attrs::new(), vec![text], vec![])
                .ok()?;
            let mut children = vec![placeholder];
            children.extend(convert_blocks(schema, node));
            schema
                .node("blockquote", Attrs::new(), children, vec![])
                .ok()
        }
        _ => None,
    }
}

/// A GFM task-list item's `checked` state has no real attribute on
/// this minimal schema's `list_item` yet (`taino-edit-extensions`'s
/// built-in `Lists` has no checkbox support at all — confirmed by
/// reading its source, not assumed) — represented as a plain, visible
/// `[ ]`/`[x]` text marker spliced onto the item's first paragraph
/// rather than silently dropped. NOT a real interactive checkbox; that
/// needs a real schema addition, matching the JS implementation's own
/// approach of a custom attribute rather than a separate node type
/// (see the `oxmarkdown` skill's Checklists section).
fn convert_list_item(schema: &Schema, node: &Value) -> Option<Node> {
    let checked = node["checked"].as_bool();
    let mut blocks: Vec<Value> = node["children"].as_array().cloned().unwrap_or_default();
    if let Some(is_checked) = checked {
        if let Some(first) = blocks.first_mut() {
            if first["type"] == "paragraph" {
                let marker = if is_checked { "[x] " } else { "[ ] " };
                if let Some(children) = first["children"].as_array_mut() {
                    children.insert(0, serde_json::json!({"type": "text", "value": marker}));
                } else {
                    first["children"] = serde_json::json!([{"type": "text", "value": marker}]);
                }
            }
        }
    }
    let children: Vec<Node> = blocks
        .iter()
        .filter_map(|c| convert_block(schema, c))
        .collect();
    schema
        .node("list_item", Attrs::new(), children, vec![])
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
        // GFM strikethrough and the custom `==highlight==` mark have no
        // real mark type on this minimal schema yet — render the text
        // plainly (marks dropped) rather than lose the words themselves.
        "delete" | "mark" => convert_inline_children(schema, node, marks),
        // An inline text directive (`:ref{...}`) has no real node/mark
        // yet — a plain, visible placeholder run.
        "textDirective" => {
            let name = node["name"].as_str().unwrap_or("?");
            text_node(schema, &format!(":{name}{{...}}"), marks.to_vec())
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}
