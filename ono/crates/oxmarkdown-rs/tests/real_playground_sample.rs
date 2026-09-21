//! Validates against a REAL document, not just hand-written fixtures —
//! the exact `DEFAULT_SAMPLE` string from the JS playground
//! (`fruits/app/routes/styles_.oxmarkdown.tsx`), copied verbatim. This is
//! the same document the actual JS implementation demos its own
//! directive/highlight/spacing behavior against, so it's a real,
//! representative slice of OxMarkdown syntax rather than something
//! invented to make this crate look good.

const SAMPLE: &str = r#"# Try editing this

Bold, *italic*, ~~strikethrough~~, inline `code`, and a [link](https://example.com).

Spacing   preserved   exactly   as   saved — even   runs   of   2+ — on every surface (see the oxmarkdown skill's Design language section).

:::note{title="Container directive"}
This paragraph is followed by a blank line inside the directive —

the exact case that broke the old regex-based system. It survives here.
:::

::badge{label="Leaf directive"}

::unregistered{demo="unknown directive fallback"}

:::grid{columns="3"}
First cell — any block content works here (headings, lists, ...).

::col
Second cell.

::col
Third cell.
:::

:::gallery{max-columns="3"}
![Sunset over the bay](https://picsum.photos/seed/nopal1/400)
![Trail markers](https://picsum.photos/seed/nopal2/400)
![Fence line repair](https://picsum.photos/seed/nopal3/400)
:::

- [ ] Unchecked task
- [x] Checked task
- Plain bullet

1. Ordered
2. List

Decided to use cedar for the fence :ref{name="Jane Doe" human-id="h_demo" datetime="2026-08-17T14:30:00Z" location="/h_demo:personal/syncs/Daily Logs/2026-08-17.md"}
non-verbose — click the asterisk.

Decided to use cedar for the fence :ref{name="Jane Doe" human-id="h_demo" datetime="2026-08-17T14:30:00Z" location="/h_demo:personal/syncs/Daily Logs/2026-08-17.md" verbose="true"}
verbose — always fully spelled out, no popover.
"#;

fn directive_children(doc: &serde_json::Value) -> Vec<&serde_json::Value> {
    doc["children"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| {
            matches!(
                c["type"].as_str(),
                Some("leafDirective") | Some("containerDirective") | Some("textDirective")
            )
        })
        .collect()
}

#[test]
fn parses_the_real_playground_sample_without_erroring() {
    let doc = oxmarkdown_rs::parse_document(SAMPLE).expect("should parse");
    println!("{}", serde_json::to_string_pretty(&doc).unwrap());

    let directives = directive_children(&doc);
    let names: Vec<&str> = directives
        .iter()
        .filter_map(|d| d["name"].as_str())
        .collect();

    // Every BLOCK-level directive (leaf/container) in the real sample is
    // found, in document order — this is the part this crate's
    // fence-tracking pre-pass actually implements today.
    assert_eq!(
        names,
        vec!["note", "badge", "unregistered", "grid", "gallery"]
    );
}

#[test]
fn container_directive_body_spans_a_blank_line_in_the_real_sample() {
    let doc = oxmarkdown_rs::parse_document(SAMPLE).expect("should parse");
    let note = directive_children(&doc)
        .into_iter()
        .find(|d| d["name"] == "note")
        .expect("note directive");
    let body = note["children"].as_array().unwrap();
    // Two paragraphs, not one truncated at the blank line — the exact
    // case the sample text itself calls out as "the exact case that
    // broke the old regex-based system."
    assert_eq!(body.len(), 2, "{body:#?}");
    assert_eq!(body[0]["type"], "paragraph");
    assert_eq!(body[1]["type"], "paragraph");
}

#[test]
fn grid_leaf_directive_cells_are_siblings_inside_the_container() {
    let doc = oxmarkdown_rs::parse_document(SAMPLE).expect("should parse");
    let grid = directive_children(&doc)
        .into_iter()
        .find(|d| d["name"] == "grid")
        .expect("grid directive");
    let body = grid["children"].as_array().unwrap();
    // paragraph, ::col, paragraph, ::col, paragraph — cell-splitting
    // itself is a RENDERER concern (see the oxmarkdown skill), not
    // something the parser does; the parser's only job is making sure
    // `::col` shows up as a real sibling leaf directive, not swallowed
    // into surrounding text.
    let col_count = body.iter().filter(|n| n["name"] == "col").count();
    assert_eq!(col_count, 2, "{body:#?}");
}

fn find_all<'a>(
    value: &'a serde_json::Value,
    node_type: &str,
    out: &mut Vec<&'a serde_json::Value>,
) {
    if value["type"] == node_type {
        out.push(value);
    }
    if let Some(children) = value["children"].as_array() {
        for child in children {
            find_all(child, node_type, out);
        }
    }
}

#[test]
fn real_sample_round_trips_through_serialize() {
    fn strip_positions(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                map.remove("position");
                for v in map.values_mut() {
                    strip_positions(v);
                }
            }
            serde_json::Value::Array(arr) => {
                for v in arr.iter_mut() {
                    strip_positions(v);
                }
            }
            _ => {}
        }
    }

    let first = oxmarkdown_rs::parse_document(SAMPLE).expect("first parse");
    let serialized = oxmarkdown_rs::serialize_document(&first);
    let second = oxmarkdown_rs::parse_document(&serialized).expect("second parse");

    let mut a = first;
    let mut b = second;
    strip_positions(&mut a);
    strip_positions(&mut b);
    assert_eq!(a, b, "--- serialized ---\n{serialized}");
}

#[test]
fn inline_ref_directives_in_the_real_sample_are_both_found() {
    // The real sample has both the non-verbose and verbose `:ref{...}`
    // forms, inline mid-paragraph — confirms the inline pass (added
    // after block-level directives) actually covers real content, not
    // just hand-written fixtures.
    let doc = oxmarkdown_rs::parse_document(SAMPLE).expect("should parse");
    let mut refs = Vec::new();
    find_all(&doc, "textDirective", &mut refs);
    assert_eq!(refs.len(), 2, "{doc:#?}");
    assert!(refs.iter().all(|r| r["name"] == "ref"));
    assert_eq!(refs[0]["attributes"]["verbose"], serde_json::Value::Null);
    assert_eq!(refs[1]["attributes"]["verbose"], "true");
}
