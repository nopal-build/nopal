//! AST -> markdown, the other half of Phase 0 (see the crate README).
//! Mirrors the shape of the JS `serializeOxDocument`'s DEFAULT behavior
//! (one blank line between top-level blocks) — not yet its Editing-mode
//! variant, which preserves EXTRA blank lines via a custom `join`
//! option; this crate has no live-editing surface yet to need that for.
//!
//! Deliberately not attempting to preserve every stylistic choice
//! (bullet character, list-marker style) byte-for-byte against
//! arbitrary hand-written input — the correctness bar this crate's
//! tests hold it to is round-tripping (parse -> serialize -> parse
//! again produces the SAME tree, ignoring position info), matching how
//! `format_oxmarkdown` in the JS tooling already normalizes formatting
//! rather than preserving it exactly.

use serde_json::Value;

pub fn serialize_document(node: &Value) -> String {
    let mut out = serialize_blocks(
        node["children"]
            .as_array()
            .map(|v| v.as_slice())
            .unwrap_or(&[]),
    );
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn serialize_blocks(children: &[Value]) -> String {
    children
        .iter()
        .map(serialize_block)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn indent_lines(text: &str, prefix: &str) -> String {
    text.lines()
        .map(|line| {
            if line.is_empty() {
                prefix.trim_end().to_string()
            } else {
                format!("{prefix}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn serialize_block(node: &Value) -> String {
    match node["type"].as_str().unwrap_or("") {
        "heading" => {
            let depth = node["depth"].as_u64().unwrap_or(1).clamp(1, 6) as usize;
            format!("{} {}", "#".repeat(depth), serialize_inline_children(node))
        }
        "paragraph" => serialize_inline_children(node),
        "blockquote" => {
            let inner = serialize_blocks(
                node["children"]
                    .as_array()
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]),
            );
            indent_lines(&inner, "> ")
        }
        "list" => serialize_list(node),
        "code" => {
            let lang = node["lang"].as_str().unwrap_or("");
            let value = node["value"].as_str().unwrap_or("");
            format!("```{lang}\n{value}\n```")
        }
        "thematicBreak" => "---".to_string(),
        "yaml" => {
            let value = node["value"].as_str().unwrap_or("");
            format!("---\n{value}\n---")
        }
        "leafDirective" => format!(
            "::{}{}",
            node["name"].as_str().unwrap_or(""),
            serialize_attrs_braced(&node["attributes"])
        ),
        "containerDirective" => {
            let inner = serialize_blocks(
                node["children"]
                    .as_array()
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]),
            );
            let head = format!(
                ":::{}{}",
                node["name"].as_str().unwrap_or(""),
                serialize_attrs_braced(&node["attributes"])
            );
            if inner.is_empty() {
                format!("{head}\n:::")
            } else {
                format!("{head}\n{inner}\n:::")
            }
        }
        // Anything not yet handled (tables, raw HTML, ...) is dropped
        // rather than panicking — a lossy passthrough is a real, known
        // gap to fix if real content needs it (none of the current
        // fixtures do).
        _ => String::new(),
    }
}

fn serialize_list(node: &Value) -> String {
    let ordered = node["ordered"].as_bool().unwrap_or(false);
    let start = node["start"].as_u64().unwrap_or(1);
    let items = node["children"].as_array().cloned().unwrap_or_default();
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let marker = if ordered {
                format!("{}. ", start + i as u64)
            } else {
                "- ".to_string()
            };
            let checkbox = match item["checked"].as_bool() {
                Some(true) => "[x] ",
                Some(false) => "[ ] ",
                None => "",
            };
            let body = serialize_blocks(
                item["children"]
                    .as_array()
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]),
            );
            let prefix_len = marker.len() + checkbox.len();
            let indent = " ".repeat(prefix_len);
            let indented_continuation = indent_lines(&body, &indent);
            // The first line carries the marker; every line after it
            // (a multi-paragraph list item) is indented to line up
            // under the first line's own content column.
            let mut lines = indented_continuation.lines();
            let first = lines
                .next()
                .unwrap_or("")
                .trim_start_matches(&indent[..])
                .to_string();
            let rest: Vec<&str> = lines.collect();
            let mut out = format!("{marker}{checkbox}{first}");
            for line in rest {
                out.push('\n');
                out.push_str(line);
            }
            out
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn serialize_inline_children(node: &Value) -> String {
    node["children"]
        .as_array()
        .map(|children| children.iter().map(serialize_inline).collect::<String>())
        .unwrap_or_default()
}

fn serialize_inline(node: &Value) -> String {
    match node["type"].as_str().unwrap_or("") {
        "text" => node["value"].as_str().unwrap_or("").to_string(),
        "strong" => format!("**{}**", serialize_inline_children(node)),
        "emphasis" => format!("*{}*", serialize_inline_children(node)),
        "delete" => format!("~~{}~~", serialize_inline_children(node)),
        "mark" => format!("=={}==", serialize_inline_children(node)),
        "inlineCode" => format!("`{}`", node["value"].as_str().unwrap_or("")),
        "break" => "\\\n".to_string(),
        "link" => format!(
            "[{}]({})",
            serialize_inline_children(node),
            node["url"].as_str().unwrap_or("")
        ),
        "image" => format!(
            "![{}]({})",
            node["alt"].as_str().unwrap_or(""),
            node["url"].as_str().unwrap_or("")
        ),
        "textDirective" => format!(
            ":{}{}",
            node["name"].as_str().unwrap_or(""),
            serialize_attrs_braced(&node["attributes"])
        ),
        _ => String::new(),
    }
}

/// `{key="value" key2="value2"}` — keys sorted alphabetically for
/// deterministic output (attributes are stored in a `HashMap`, which
/// has no defined iteration order of its own).
fn serialize_attrs_braced(attrs: &Value) -> String {
    let Some(map) = attrs.as_object() else {
        return "{}".to_string();
    };
    if map.is_empty() {
        return String::new();
    }
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    let parts: Vec<String> = keys
        .into_iter()
        .map(|k| format!("{k}=\"{}\"", map[k].as_str().unwrap_or("")))
        .collect();
    format!("{{{}}}", parts.join(" "))
}

#[cfg(test)]
mod tests {
    use crate::parse_document;

    use super::*;

    fn strip_positions(value: &mut Value) {
        if let Value::Object(map) = value {
            map.remove("position");
            for v in map.values_mut() {
                strip_positions(v);
            }
        } else if let Value::Array(arr) = value {
            for v in arr.iter_mut() {
                strip_positions(v);
            }
        }
    }

    fn assert_round_trips(markdown: &str) {
        let first = parse_document(markdown).expect("first parse");
        let serialized = serialize_document(&first);
        let second = parse_document(&serialized).expect("second parse");

        let mut a = first;
        let mut b = second;
        strip_positions(&mut a);
        strip_positions(&mut b);
        assert_eq!(
            a, b,
            "round trip mismatch.\n--- serialized ---\n{serialized}\n--- first ---\n{a:#}\n--- second ---\n{b:#}"
        );
    }

    #[test]
    fn round_trips_plain_prose() {
        assert_round_trips("# Title\n\nSome *text* with **bold** and ~~strike~~.\n");
    }

    #[test]
    fn round_trips_a_leaf_directive() {
        assert_round_trips("::file{fileId=\"abc\" title=\"A Title\"}\n");
    }

    #[test]
    fn round_trips_a_container_directive_spanning_a_blank_line() {
        assert_round_trips(":::toggle\nRelease: **Sunny**\n\n- fence-line.jpg attached\n:::\n");
    }

    #[test]
    fn round_trips_task_list() {
        assert_round_trips("- [ ] Unchecked task\n- [x] Checked task\n- Plain bullet\n");
    }

    #[test]
    fn round_trips_an_inline_ref_directive() {
        assert_round_trips(
            "Decided to use cedar :ref{name=\"Jane\" datetime=\"2026-01-01T00:00:00Z\" location=\"/x\"} for the fence.\n",
        );
    }

    #[test]
    fn round_trips_a_highlight_mark() {
        assert_round_trips("This is ==highlighted== text.\n");
    }

    #[test]
    fn round_trips_nested_containers() {
        assert_round_trips(":::grid{columns=\"2\"}\n:::toggle\nInner title\n:::\n:::\n");
    }
}
