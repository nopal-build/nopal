//! Small, tree-level interaction helpers — mutating a parsed AST in
//! response to a UI action, ahead of re-serializing via
//! `serialize_document`. Kept here (not in a UI-specific crate) since
//! it's plain tree logic with more than one consumer now
//! (`oxmarkdown-web`, `oxmarkdown-leptos`), and any future consumer
//! should mutate the tree the same way rather than reimplementing this
//! per front end.

use serde_json::Value;

/// Flips the Nth task checkbox's `checked` field, found by a plain
/// depth-first walk in document order — checkbox identity is
/// deliberately this simple (an index, not a stable id) for now; see
/// callers' own docs for why that's an accepted, temporary shortcut.
/// Returns `false` (no mutation) if `target` is out of range.
pub fn toggle_checkbox_by_index(node: &mut Value, target: usize) -> bool {
    let mut counter = 0usize;
    toggle_checkbox_by_index_inner(node, target, &mut counter)
}

fn toggle_checkbox_by_index_inner(node: &mut Value, target: usize, counter: &mut usize) -> bool {
    if node["type"] == "listItem" && node["checked"].is_boolean() {
        if *counter == target {
            let current = node["checked"].as_bool().unwrap_or(false);
            node["checked"] = Value::Bool(!current);
            return true;
        }
        *counter += 1;
    }
    if let Some(children) = node.get_mut("children").and_then(|c| c.as_array_mut()) {
        for child in children.iter_mut() {
            if toggle_checkbox_by_index_inner(child, target, counter) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_document, serialize_document};

    #[test]
    fn toggles_the_right_checkbox_by_index() {
        let mut tree = parse_document("- [ ] one\n- [x] two\n- [ ] three\n").unwrap();
        assert!(toggle_checkbox_by_index(&mut tree, 1));
        let out = serialize_document(&tree);
        assert_eq!(out, "- [ ] one\n- [ ] two\n- [ ] three\n");
    }

    #[test]
    fn out_of_range_index_is_a_no_op_false() {
        let mut tree = parse_document("- [ ] one\n").unwrap();
        assert!(!toggle_checkbox_by_index(&mut tree, 5));
    }

    #[test]
    fn ignores_non_checkbox_list_items() {
        let mut tree = parse_document("- plain\n- [ ] real checkbox\n").unwrap();
        assert!(toggle_checkbox_by_index(&mut tree, 0));
        let out = serialize_document(&tree);
        assert_eq!(out, "- plain\n- [x] real checkbox\n");
    }
}
