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

pub(crate) fn text_node(schema: &Schema, value: &str, marks: Vec<Mark>) -> Option<Node> {
    if value.is_empty() {
        return None;
    }
    schema.text(value, marks).ok()
}

/// The two attrs every directive node shares (see `oxmarkdown_schema`'s
/// own doc comment for why a single JSON-object `attributes` attr,
/// rather than one attr per key).
pub(crate) fn directive_attrs(name: &str, attributes: &Value) -> Attrs {
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
pub(crate) fn format_directive_label(fence: &str, name: &str, attributes: &Value) -> String {
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

/// Real, per-directive-kind content for the two directives given a
/// specific rendering so far (see this crate's README — "badge"/"ref"
/// were the first two called out as still showing only the generic
/// fallback). Returns `None` for any other directive name, so the
/// caller falls back to the raw `::name{attrs}`/`:name{attrs}` syntax
/// label — the same "unknown directive" convention the real product's
/// own `OxRenderer` uses for anything without a registered renderer.
/// Still a synthetic text-child list either way (see `oxmarkdown_schema`'s
/// own doc comment on the `DomSpec` limitation this works around) — the
/// `name`/`attributes` node attrs stay the real source of truth.
pub(crate) fn directive_content(
    schema: &Schema,
    name: &str,
    attributes: &Value,
) -> Option<Vec<Node>> {
    match name {
        "ref" => Some(ref_directive_content(schema, attributes)),
        "badge" => {
            let label = attributes["label"]
                .as_str()
                .or_else(|| attributes["text"].as_str())
                .unwrap_or(name);
            Some(text_node(schema, label, vec![]).into_iter().collect())
        }
        _ => None,
    }
}

/// `:ref{...}` — a read-only GraphLog citation (see the `graphlog` skill's
/// own "The `:ref{...}` directive" section, mirrored exactly here). Two
/// renderings, chosen purely by the static `verbose` attribute (decided
/// by the WRITER, never by rendering context): `verbose="true"` is
/// fully spelled-out plain text (`name · date · source`, `source` a real
/// link to `location`); omitted/anything else is a single `*` glyph —
/// the real product's own small popover trigger, though the popover
/// itself is still deferred here (see this crate's README's
/// "Deliberately NOT done" list — rendering the two shapes correctly is
/// this step; making the glyph open a popover is a later one).
fn ref_directive_content(schema: &Schema, attributes: &Value) -> Vec<Node> {
    let is_verbose = attributes["verbose"].as_str() == Some("true");
    if !is_verbose {
        return text_node(schema, "*", vec![]).into_iter().collect();
    }

    let name = attributes["name"].as_str().unwrap_or("Unknown");
    let datetime = attributes["datetime"].as_str().map(format_ref_datetime);
    let location = attributes["location"].as_str().unwrap_or("");

    let mut prefix = name.to_string();
    if let Some(datetime) = datetime {
        prefix.push_str(" · ");
        prefix.push_str(&datetime);
    }
    prefix.push_str(" · ");

    let mut nodes = Vec::new();
    nodes.extend(text_node(schema, &prefix, vec![]));
    let source_marks = if location.is_empty() {
        vec![]
    } else {
        let mut href = Attrs::new();
        href.insert("href".to_string(), AttrValue::from(location.to_string()));
        with_mark(schema, &[], "link", href)
    };
    nodes.extend(text_node(schema, "source", source_marks));
    nodes
}

const MONTH_ABBR: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Formats a `:ref{datetime="..."}` ISO 8601 UTC timestamp (e.g.
/// `"2026-08-17T14:30:00Z"`) as `"Aug 17, 2026, 2:30 PM"` — mirrors the
/// real product's own `formatRefDatetime` (`OxRenderer.tsx`), pinned to
/// UTC for the same reason that function is (never the viewer's own
/// timezone — SSR/hydration disagree on that, a real hydration-mismatch
/// bug there once). Falls back to the raw string on anything that
/// doesn't parse the expected shape, rather than fabricating a bogus
/// date.
fn format_ref_datetime(raw: &str) -> String {
    fn parse(raw: &str) -> Option<String> {
        let (date, time) = raw.split_once('T')?;
        let mut d = date.split('-');
        let year: i32 = d.next()?.parse().ok()?;
        let month: usize = d.next()?.parse().ok()?;
        let day: u32 = d.next()?.parse().ok()?;
        let time = time.strip_suffix('Z').unwrap_or(time);
        let mut t = time.split(':');
        let hour: u32 = t.next()?.parse().ok()?;
        let minute: u32 = t.next()?.parse().ok()?;
        let month_name = MONTH_ABBR.get(month.checked_sub(1)?)?;
        let (hour12, period) = match hour {
            0 => (12, "AM"),
            1..=11 => (hour, "AM"),
            12 => (12, "PM"),
            _ => (hour.saturating_sub(12), "PM"),
        };
        Some(format!(
            "{month_name} {day}, {year}, {hour12}:{minute:02} {period}"
        ))
    }
    parse(raw).unwrap_or_else(|| raw.to_string())
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
            let content = directive_content(schema, name, attributes).unwrap_or_else(|| {
                let label = format_directive_label("::", name, attributes);
                text_node(schema, &label, vec![]).into_iter().collect()
            });
            schema
                .node(
                    "leaf_directive",
                    directive_attrs(name, attributes),
                    content,
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
            let content = directive_content(schema, name, attributes).unwrap_or_else(|| {
                let label = format_directive_label(":", name, attributes);
                text_node(schema, &label, vec![]).into_iter().collect()
            });
            schema
                .node(
                    "text_directive",
                    directive_attrs(name, attributes),
                    content,
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
        // A directive with a specific rendering (see `directive_content`)
        // shows its real label attribute alone now, not the raw
        // `::name{attrs}` syntax — still just a synthetic display child,
        // not the source of truth for round-tripping (that's the
        // `name`/`attributes` attrs asserted above).
        assert_eq!(node.text_content(), "hi");
    }

    #[test]
    fn unknown_directive_falls_back_to_the_raw_syntax_label() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "::mystery{x=\"1\"}\n");
        let mut found = Vec::new();
        find_all(&doc, "leaf_directive", &mut found);
        assert_eq!(found.len(), 1);
        // No specific rendering for "mystery" — same generic fallback as
        // before, so an as-yet-unhandled directive still shows something
        // legible rather than going blank.
        assert_eq!(found[0].text_content(), "::mystery{x=\"1\"}");
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
        // Non-verbose (the default, no `verbose` attr at all here) is a
        // single `*` glyph — the real product's own popover trigger (see
        // the `graphlog` skill's "The `:ref{...}` directive" section).
        assert_eq!(node.text_content(), "*");
    }

    #[test]
    fn verbose_ref_directive_renders_fully_spelled_out_with_a_source_link() {
        let schema = test_schema();
        let doc = markdown_to_doc(
            &schema,
            "Decided on cedar :ref{name=\"Jane Doe\" datetime=\"2026-08-17T14:30:00Z\" location=\"/x\" verbose=\"true\"} today.\n",
        );
        let mut found = Vec::new();
        find_all(&doc, "text_directive", &mut found);
        assert_eq!(found.len(), 1);
        let node = found[0];
        assert_eq!(
            node.text_content(),
            "Jane Doe \u{b7} Aug 17, 2026, 2:30 PM \u{b7} source"
        );
        // "source" is a real link to `location`, not plain text.
        let json = serde_json::to_string(&doc.to_json()).unwrap();
        assert!(json.contains("\"href\":\"/x\""), "{json}");
    }

    #[test]
    fn badge_directive_renders_its_label_attribute_alone() {
        let schema = test_schema();
        let doc = markdown_to_doc(&schema, "::badge{label=\"Ready\"}\n");
        let mut found = Vec::new();
        find_all(&doc, "leaf_directive", &mut found);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].text_content(), "Ready");
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
