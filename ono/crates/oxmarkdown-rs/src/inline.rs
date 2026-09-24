//! Inline directives (`:name{}`, e.g. `:ref{...}`) and the custom
//! `==highlight==` mark — the other half of Phase 0 (see this crate's
//! README). A separate pre-pass from `directives.rs`'s block-level one,
//! applied AFTER `markdown-rs` has already parsed a chunk into its own
//! tree, not before — running on raw text before parsing would risk
//! rewriting directive/highlight-looking text that's actually inside an
//! inline code span (`` `:foo{bar}` `` should stay literal). Running
//! after parsing means `markdown-rs` has already correctly identified
//! `inlineCode`/`code` nodes, and this pass simply never descends into
//! them — matching how the JS tokenizer-level extensions never fire
//! inside a code span either, just by a different mechanism.
//!
//! Known limitation (documented, not silently missing): this operates
//! on each mdast `text` node's own contiguous `.value` independently, so
//! a delimiter pair split across two adjacent inline nodes (e.g.
//! `` `code`==high==lighted `` spanning a code span boundary, or
//! `**bold ==high==**` where emphasis's own text node already contains
//! the closing `==`) is handled per-text-node, not with full
//! tokenizer-level delimiter-run resolution. Matches the same class of
//! simplification the JS implementation itself accepts (see the
//! `oxmarkdown` skill: "a formatted run that spans an embedded line
//! break re-exports as two separate adjacent runs instead of one").

use serde_json::{json, Value};

use crate::directives::parse_attrs;

/// Walks `value`'s `children` (if any) recursively, splitting every
/// `text` leaf into `text`/`textDirective`/`mark` runs. Never descends
/// into `inlineCode`/`code` — their `.value` is left completely alone.
pub(crate) fn expand_inline_directives(value: &mut Value) {
    let Some(children) = value.get_mut("children").and_then(|c| c.as_array_mut()) else {
        return;
    };
    let mut expanded = Vec::with_capacity(children.len());
    for child in children.drain(..) {
        let node_type = child.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if node_type == "text" {
            if let Some(text) = child.get("value").and_then(|v| v.as_str()) {
                expanded.extend(split_inline_text(text));
                continue;
            }
        }
        expanded.push(child);
    }
    for child in expanded.iter_mut() {
        let node_type = child.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if node_type != "inlineCode" && node_type != "code" {
            expand_inline_directives(child);
        }
    }
    *children = expanded;
}

/// Splits one contiguous run of plain text into `text`/`textDirective`/
/// `mark` nodes. A `mark` node's own inner text is NOT expanded here —
/// `expand_inline_directives` recurses into it afterward, so a directive
/// nested inside a highlight span (`==see :ref{...}==`) still resolves,
/// on the second pass over the freshly-created node.
fn split_inline_text(text: &str) -> Vec<Value> {
    let chars: Vec<char> = text.chars().collect();
    let mut result = Vec::new();
    let mut buf = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ':' {
            if let Some((name, attrs, consumed)) = try_match_text_directive(&chars[i..]) {
                flush_text(&mut buf, &mut result);
                result.push(json!({
                    "type": "textDirective",
                    "name": name,
                    "attributes": parse_attrs(&attrs),
                    "children": [],
                }));
                i += consumed;
                continue;
            }
        }
        if chars[i] == '=' && chars.get(i + 1) == Some(&'=') {
            if let Some((inner, consumed)) = try_match_highlight(&chars[i..]) {
                flush_text(&mut buf, &mut result);
                result.push(json!({
                    "type": "mark",
                    "children": [{"type": "text", "value": inner}],
                }));
                i += consumed;
                continue;
            }
        }
        buf.push(chars[i]);
        i += 1;
    }
    flush_text(&mut buf, &mut result);
    result
}

fn flush_text(buf: &mut String, result: &mut Vec<Value>) {
    if !buf.is_empty() {
        result.push(json!({"type": "text", "value": buf.clone()}));
        buf.clear();
    }
}

/// `chars[0]` is always `:`. Requires a `{...}` attribute block — unlike
/// the block-level leaf directive (which allows a bare `::name` with no
/// braces), an inline `:name` with nothing after it is deliberately NOT
/// matched, so ordinary prose punctuation (`3:30pm`, a URL's `:`) is
/// never misread as a directive.
fn try_match_text_directive(chars: &[char]) -> Option<(String, String, usize)> {
    let mut i = 1;
    let name_start = i;
    while i < chars.len()
        && (chars[i].is_ascii_alphanumeric() || chars[i] == '-' || chars[i] == '_')
    {
        i += 1;
    }
    if i == name_start || chars.get(i) != Some(&'{') {
        return None;
    }
    let name: String = chars[name_start..i].iter().collect();
    let attrs_start = i + 1;
    let mut depth = 1;
    let mut j = attrs_start;
    while j < chars.len() {
        match chars[j] {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        j += 1;
    }
    if j >= chars.len() {
        return None; // unclosed `{...}` — leave as plain text.
    }
    let attrs: String = chars[attrs_start..j].iter().collect();
    Some((name, attrs, j + 1))
}

/// `chars[0..2]` is always `==`. Requires non-empty inner content — an
/// empty `====` run is left as plain text rather than an empty highlight,
/// and (per the JS implementation's own documented behavior) an
/// unmatched opening `==` with no closer anywhere in this text run is
/// also left as plain text.
fn try_match_highlight(chars: &[char]) -> Option<(String, usize)> {
    let mut j = 2;
    while j + 1 < chars.len() {
        if chars[j] == '=' && chars[j + 1] == '=' {
            if j == 2 {
                return None;
            }
            let inner: String = chars[2..j].iter().collect();
            return Some((inner, j + 2));
        }
        j += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use crate::parse_document;

    fn find_all<'a>(value: &'a Value, node_type: &str, out: &mut Vec<&'a Value>) {
        if value.get("type").and_then(|v| v.as_str()) == Some(node_type) {
            out.push(value);
        }
        if let Some(children) = value.get("children").and_then(|c| c.as_array()) {
            for child in children {
                find_all(child, node_type, out);
            }
        }
    }
    use serde_json::Value;

    #[test]
    fn parses_an_inline_ref_directive() {
        let doc = parse_document(
            "Decided to use cedar :ref{name=\"Jane\" datetime=\"2026-01-01T00:00:00Z\" location=\"/x\"} for the fence.\n",
        )
        .unwrap();
        let mut found = Vec::new();
        find_all(&doc, "textDirective", &mut found);
        assert_eq!(found.len(), 1, "{doc:#?}");
        assert_eq!(found[0]["name"], "ref");
        assert_eq!(found[0]["attributes"]["name"], "Jane");
        assert_eq!(found[0]["attributes"]["location"], "/x");
    }

    #[test]
    fn parses_a_highlight_mark() {
        let doc = parse_document("This is ==highlighted== text.\n").unwrap();
        let mut marks = Vec::new();
        find_all(&doc, "mark", &mut marks);
        assert_eq!(marks.len(), 1, "{doc:#?}");
        assert_eq!(marks[0]["children"][0]["value"], "highlighted");
    }

    #[test]
    fn directive_nested_inside_a_highlight_is_still_found() {
        let doc = parse_document(
            "See ==this :ref{name=\"A\" datetime=\"2026-01-01T00:00:00Z\" location=\"/x\"} note==.\n",
        )
        .unwrap();
        let mut marks = Vec::new();
        find_all(&doc, "mark", &mut marks);
        assert_eq!(marks.len(), 1, "{doc:#?}");
        let mut nested = Vec::new();
        find_all(marks[0], "textDirective", &mut nested);
        assert_eq!(nested.len(), 1, "{marks:#?}");
    }

    #[test]
    fn unmatched_highlight_delimiter_stays_plain_text() {
        let doc = parse_document("Unmatched ==oops here.\n").unwrap();
        let mut marks = Vec::new();
        find_all(&doc, "mark", &mut marks);
        assert!(marks.is_empty(), "{doc:#?}");
    }

    #[test]
    fn colon_in_ordinary_prose_is_not_a_directive() {
        let doc = parse_document("Meet at 3:30pm near the shed.\n").unwrap();
        let mut found = Vec::new();
        find_all(&doc, "textDirective", &mut found);
        assert!(found.is_empty(), "{doc:#?}");
    }

    #[test]
    fn directive_like_text_inside_inline_code_is_left_alone() {
        let doc = parse_document("Use `:ref{x=\"1\"}` literally.\n").unwrap();
        let mut found = Vec::new();
        find_all(&doc, "textDirective", &mut found);
        assert!(found.is_empty(), "{doc:#?}");
    }
}
