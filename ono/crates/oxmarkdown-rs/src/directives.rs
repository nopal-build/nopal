//! Generic directive support (`:name{}` text / `::name{}` leaf /
//! `:::name{}` container) layered ON TOP of unmodified `markdown-rs` via
//! a fence-tracking pre-pass, rather than forking `markdown-rs` itself —
//! see this crate's README for why.
//!
//! Scope of this pass: BLOCK-level directives only (leaf/container).
//! Inline text directives (`:name{}`) and `==highlight==` are a separate,
//! not-yet-built pass — see the crate README's status section.
//!
//! Known, deliberate limitation: a directive fence is only recognized at
//! the TOP level of a line (0-3 leading spaces, matching the same
//! block-starter leniency the JS implementation's own
//! `BLOCK_STARTER_LINE_RE` uses) — a directive written *inside* a
//! blockquote or list item isn't specifically handled yet. Real
//! OxMarkdown content writes directives as their own top-level blocks in
//! practice; revisit if that stops being true.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::inline::expand_inline_directives;
use crate::parse_baseline;

const MAX_LEADING_SPACES: usize = 3;

/// Strips up to `MAX_LEADING_SPACES` leading ASCII spaces. `None` means
/// the line is indented too far to be a block-starter at all (e.g. an
/// indented code block) — never a directive fence.
fn strip_leading_spaces(line: &str) -> Option<&str> {
    let mut count = 0;
    for (i, ch) in line.char_indices() {
        if ch == ' ' {
            count += 1;
            if count > MAX_LEADING_SPACES {
                return None;
            }
        } else {
            return Some(&line[i..]);
        }
    }
    Some("")
}

fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Splits `name{attrs}` (or bare `name`) into its parts. Returns `None`
/// if `rest` isn't a well-formed `name` or `name{...}` shape.
fn split_name_attrs(rest: &str) -> Option<(&str, &str)> {
    let rest = rest.trim_end();
    if let Some(brace_idx) = rest.find('{') {
        if !rest.ends_with('}') {
            return None;
        }
        let name = &rest[..brace_idx];
        let attrs = &rest[brace_idx + 1..rest.len() - 1];
        is_valid_name(name).then_some((name, attrs))
    } else {
        is_valid_name(rest).then_some((rest, ""))
    }
}

enum FenceLine<'a> {
    ContainerOpen { name: &'a str, attrs: &'a str },
    ContainerClose,
    Leaf { name: &'a str, attrs: &'a str },
    Other,
}

fn classify_line(line: &str) -> FenceLine<'_> {
    let Some(content) = strip_leading_spaces(line) else {
        return FenceLine::Other;
    };
    if let Some(rest) = content.strip_prefix(":::") {
        if rest.trim_end().is_empty() {
            return FenceLine::ContainerClose;
        }
        return match split_name_attrs(rest) {
            Some((name, attrs)) => FenceLine::ContainerOpen { name, attrs },
            None => FenceLine::Other,
        };
    }
    if let Some(rest) = content.strip_prefix("::") {
        return match split_name_attrs(rest) {
            Some((name, attrs)) => FenceLine::Leaf { name, attrs },
            None => FenceLine::Other,
        };
    }
    FenceLine::Other
}

/// Parses a directive's `{key="value" key2="value2"}` attribute string.
/// Deliberately simple (no escaping) — matches the same limitation the
/// JS implementation's `micromark-extension-directive` has (see the
/// `oxmarkdown`/`graphlog` skills' shared gotcha about `"` inside a
/// value breaking attribute parsing outright).
pub(crate) fn parse_attrs(attrs: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let chars: Vec<char> = attrs.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let key_start = i;
        while i < chars.len() && chars[i] != '=' && !chars[i].is_whitespace() {
            i += 1;
        }
        let key: String = chars[key_start..i].iter().collect();
        if key.is_empty() {
            i += 1;
            continue;
        }
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i < chars.len() && chars[i] == '=' {
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                i += 1;
            }
            if i < chars.len() && (chars[i] == '"' || chars[i] == '\'') {
                let quote = chars[i];
                i += 1;
                let val_start = i;
                while i < chars.len() && chars[i] != quote {
                    i += 1;
                }
                result.insert(key, chars[val_start..i].iter().collect());
                if i < chars.len() {
                    i += 1;
                }
            } else {
                let val_start = i;
                while i < chars.len() && !chars[i].is_whitespace() {
                    i += 1;
                }
                result.insert(key, chars[val_start..i].iter().collect());
            }
        } else {
            result.insert(key, String::new());
        }
    }
    result
}

enum Chunk {
    Markdown(String),
    Leaf {
        name: String,
        attrs: HashMap<String, String>,
    },
    Container {
        name: String,
        attrs: HashMap<String, String>,
        inner: String,
    },
}

fn flush_plain(buf: &mut Vec<&str>, chunks: &mut Vec<Chunk>) {
    if !buf.is_empty() {
        chunks.push(Chunk::Markdown(buf.join("\n")));
        buf.clear();
    }
}

/// A code-fence's own opening marker: which character, and how many of
/// them — a closing fence must use the SAME character and be at least
/// as long, straight out of the CommonMark fenced-code-block spec. This
/// is what keeps a `:::`/`::` INSIDE a code sample from ever being
/// misread as a directive fence.
struct CodeFence {
    marker: char,
    len: usize,
}

fn code_fence_open(line: &str) -> Option<CodeFence> {
    let content = line.trim_start();
    for marker in ['`', '~'] {
        let len = content.chars().take_while(|&c| c == marker).count();
        if len >= 3 {
            return Some(CodeFence { marker, len });
        }
    }
    None
}

fn split_chunks(markdown: &str) -> Result<Vec<Chunk>, String> {
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut chunks = Vec::new();
    let mut plain_buf: Vec<&str> = Vec::new();
    let mut i = 0;
    let mut code_fence: Option<CodeFence> = None;
    let mut checked_frontmatter = false;

    while i < lines.len() {
        let line = lines[i];

        if let Some(fence) = &code_fence {
            plain_buf.push(line);
            let trimmed = line.trim_start();
            let closer_len = trimmed.chars().take_while(|&c| c == fence.marker).count();
            if closer_len >= fence.len && trimmed.chars().all(|c| c == fence.marker) {
                code_fence = None;
            }
            i += 1;
            continue;
        }

        if let Some(fence) = code_fence_open(line) {
            plain_buf.push(line);
            code_fence = Some(fence);
            i += 1;
            continue;
        }

        // A leading frontmatter block (`---`/`+++` ... matching closer) is
        // only ever checked once, at the very start of the document —
        // skipped byte-for-byte so its own `---`/content lines never fall
        // through to directive-fence matching below.
        if !checked_frontmatter {
            checked_frontmatter = true;
            if line == "---" || line == "+++" {
                let fence = line;
                plain_buf.push(line);
                i += 1;
                while i < lines.len() {
                    plain_buf.push(lines[i]);
                    let is_close = lines[i] == fence;
                    i += 1;
                    if is_close {
                        break;
                    }
                }
                continue;
            }
        }

        match classify_line(line) {
            FenceLine::Leaf { name, attrs } => {
                flush_plain(&mut plain_buf, &mut chunks);
                chunks.push(Chunk::Leaf {
                    name: name.to_string(),
                    attrs: parse_attrs(attrs),
                });
                i += 1;
            }
            FenceLine::ContainerOpen { name, attrs } => {
                flush_plain(&mut plain_buf, &mut chunks);
                let name = name.to_string();
                let attrs = parse_attrs(attrs);
                let mut depth = 1;
                let mut inner_lines: Vec<&str> = Vec::new();
                i += 1;
                while i < lines.len() {
                    match classify_line(lines[i]) {
                        FenceLine::ContainerOpen { .. } => {
                            depth += 1;
                            inner_lines.push(lines[i]);
                        }
                        FenceLine::ContainerClose => {
                            depth -= 1;
                            if depth == 0 {
                                i += 1;
                                break;
                            }
                            inner_lines.push(lines[i]);
                        }
                        _ => inner_lines.push(lines[i]),
                    }
                    i += 1;
                }
                // An unclosed container directive implicitly closes at
                // EOF, exactly like the real reference implementation
                // it mirrors — confirmed directly, not assumed: a
                // `:::name` with no closing `:::` still parses as a
                // real `containerDirective` via `micromark-extension-
                // directive`/`mdast-util-directive` (the exact packages
                // `oxmarkdown-core`, the JS sibling, depends on), whose
                // children are everything through EOF. This used to be
                // a hard `Err` here — a real, confirmed divergence from
                // that reference, not a deliberate choice, and a much
                // worse one for `ono`'s live playground than for a
                // batch parse: a container directive is ALWAYS
                // transiently "unclosed" for the entire time its author
                // is still typing it, before the closing fence exists
                // at all.
                chunks.push(Chunk::Container {
                    name,
                    attrs,
                    inner: inner_lines.join("\n"),
                });
            }
            // A stray closer with nothing open — left as plain text
            // rather than erroring (a hand-written `:::` alone is
            // otherwise valid CommonMark, e.g. a thematic break).
            FenceLine::ContainerClose | FenceLine::Other => {
                plain_buf.push(line);
                i += 1;
            }
        }
    }
    flush_plain(&mut plain_buf, &mut chunks);
    Ok(chunks)
}

/// The real entry point: parses OxMarkdown (CommonMark + GFM +
/// frontmatter + generic directives) into a JSON tree shaped like the
/// JS implementation's mdast-plus-directives tree (`oxmarkdown-core`'s
/// `document.ts`) — same `type`/`name`/`attributes`/`children` shape —
/// so the two can be diffed directly against each other in tests.
pub fn parse_document(markdown: &str) -> Result<Value, String> {
    let chunks = split_chunks(markdown)?;
    let mut children: Vec<Value> = Vec::new();
    for chunk in chunks {
        match chunk {
            Chunk::Markdown(text) => {
                if text.trim().is_empty() {
                    continue;
                }
                let node = parse_baseline(&text).map_err(|e| e.to_string())?;
                let value = serde_json::to_value(&node).map_err(|e| e.to_string())?;
                if let Some(kids) = value.get("children").and_then(|v| v.as_array()) {
                    children.extend(kids.iter().cloned());
                }
            }
            Chunk::Leaf { name, attrs } => {
                children.push(json!({
                    "type": "leafDirective",
                    "name": name,
                    "attributes": attrs,
                    "children": [],
                }));
            }
            Chunk::Container { name, attrs, inner } => {
                let inner_value = parse_document(&inner)?;
                let inner_children = inner_value.get("children").cloned().unwrap_or(json!([]));
                children.push(json!({
                    "type": "containerDirective",
                    "name": name,
                    "attributes": attrs,
                    "children": inner_children,
                }));
            }
        }
    }
    let mut root = json!({ "type": "root", "children": children });
    expand_inline_directives(&mut root);
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directive_names(value: &Value) -> Vec<&str> {
        value["children"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|c| c["name"].as_str())
            .collect()
    }

    #[test]
    fn parses_a_leaf_directive() {
        let doc = parse_document("::file{fileId=\"abc\"}\n").unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["type"], "leafDirective");
        assert_eq!(children[0]["name"], "file");
        assert_eq!(children[0]["attributes"]["fileId"], "abc");
    }

    #[test]
    fn leaf_directive_interrupts_a_paragraph_with_no_blank_line() {
        let doc = parse_document("Some text\n::file{fileId=\"x\"}\nmore text\n").unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 3, "{children:#?}");
        assert_eq!(children[0]["type"], "paragraph");
        assert_eq!(children[1]["type"], "leafDirective");
        assert_eq!(children[2]["type"], "paragraph");
    }

    /// THE key test — this is exactly the case the old regex-based
    /// `nopalDirectives.ts`/`nopalEditorState.ts` era couldn't handle,
    /// and the reason OxMarkdown's real mdast-based parser was built in
    /// the first place (see the `oxmarkdown` skill's "Why replace
    /// MdxEditor"). A container directive wrapping MULTIPLE paragraphs
    /// separated by a blank line must come back as multiple children,
    /// not be truncated at the first blank line.
    #[test]
    fn container_directive_spans_a_blank_line() {
        let doc =
            parse_document(":::toggle\nRelease: **Sunny**\n\n- fence-line.jpg attached\n:::\n")
                .unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["type"], "containerDirective");
        assert_eq!(children[0]["name"], "toggle");
        let inner = children[0]["children"].as_array().unwrap();
        assert_eq!(inner.len(), 2, "{inner:#?}");
        assert_eq!(inner[0]["type"], "paragraph");
        assert_eq!(inner[1]["type"], "list");
    }

    #[test]
    fn nested_container_directives() {
        let doc =
            parse_document(":::grid{columns=\"2\"}\n:::toggle\nInner title\n:::\n:::\n").unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["name"], "grid");
        let inner = children[0]["children"].as_array().unwrap();
        assert_eq!(inner.len(), 1);
        assert_eq!(inner[0]["name"], "toggle");
    }

    #[test]
    fn directive_like_text_inside_a_code_fence_is_left_alone() {
        let doc = parse_document("```\n::file{fileId=\"x\"}\n```\n").unwrap();
        assert_eq!(directive_names(&doc), Vec::<&str>::new());
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children[0]["type"], "code");
    }

    #[test]
    fn unclosed_container_implicitly_closes_at_eof() {
        // Matches the real reference implementation exactly (confirmed
        // directly against `micromark-extension-directive`/`mdast-
        // util-directive`, not assumed) — no error, and everything
        // after the fence becomes the directive's own content.
        let doc = parse_document(":::toggle\nnever closed\n").unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 1, "{children:#?}");
        assert_eq!(children[0]["type"], "containerDirective");
        assert_eq!(children[0]["name"], "toggle");
        let inner = children[0]["children"].as_array().unwrap();
        assert_eq!(inner.len(), 1, "{inner:#?}");
        assert_eq!(inner[0]["type"], "paragraph");
    }

    #[test]
    fn unclosed_container_with_no_content_at_all_still_closes_at_eof() {
        let doc = parse_document(":::badge\n").unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 1, "{children:#?}");
        assert_eq!(children[0]["type"], "containerDirective");
        assert_eq!(children[0]["name"], "badge");
        assert_eq!(children[0]["children"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn unclosed_nested_container_closes_both_levels_at_eof() {
        let doc = parse_document(":::grid\n:::toggle\ninner\n").unwrap();
        let children = doc["children"].as_array().unwrap();
        assert_eq!(children.len(), 1, "{children:#?}");
        assert_eq!(children[0]["name"], "grid");
        let inner = children[0]["children"].as_array().unwrap();
        assert_eq!(inner.len(), 1, "{inner:#?}");
        assert_eq!(inner[0]["name"], "toggle");
    }

    #[test]
    fn plain_document_has_no_directives() {
        let doc = parse_document("# Title\n\nJust prose.\n").unwrap();
        assert!(directive_names(&doc).is_empty());
    }
}
