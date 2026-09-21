//! Phase 0 spike — see this crate's README. Baseline first: confirm
//! `markdown-rs` (the Rust sibling of the JS `micromark`/`mdast`
//! ecosystem OxMarkdown is built on) parses plain CommonMark + GFM +
//! frontmatter correctly, before touching the one real gap: generic
//! directives (`:name{}`/`::name{}`/`:::name{}`) and the custom
//! `==highlight==` mark, neither of which `markdown-rs` supports today.

use markdown::mdast::Node;
use markdown::{to_mdast, Constructs, ParseOptions};

mod directives;
mod inline;
mod interact;
mod serialize;
pub use directives::parse_document;
pub use interact::toggle_checkbox_by_index;
pub use serialize::serialize_document;

pub(crate) fn parse_baseline(input: &str) -> Result<Node, markdown::message::Message> {
    let options = ParseOptions {
        constructs: Constructs::gfm(),
        ..ParseOptions::gfm()
    };
    to_mdast(input, &options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_commonmark() {
        let node = parse_baseline("# Hello\n\nSome *text*.\n").expect("should parse");
        let json = serde_json::to_string_pretty(&node).unwrap();
        println!("{json}");
        assert!(json.contains("\"heading\""));
        assert!(json.contains("\"emphasis\""));
    }

    #[test]
    fn parses_gfm_task_list() {
        let node = parse_baseline("- [ ] not done\n- [x] done\n").expect("should parse");
        let json = serde_json::to_string_pretty(&node).unwrap();
        println!("{json}");
        assert!(json.contains("\"checked\""));
    }

    #[test]
    fn directives_are_not_understood_yet() {
        // This is the actual gap — documenting the CURRENT (wrong) behavior
        // so the fix can be measured against it. A `::file{...}` leaf
        // directive should be its own node; today it's swallowed into a
        // plain paragraph's text, exactly like the old regex-based
        // `nopalDirectives.ts` era OxMarkdown replaced (see the
        // `oxmarkdown` skill).
        let node = parse_baseline("::file{fileId=\"abc\"}\n").expect("should parse");
        let json = serde_json::to_string_pretty(&node).unwrap();
        println!("{json}");
        assert!(
            json.contains("\"paragraph\""),
            "expected today's WRONG behavior — a bare paragraph, not a directive node"
        );
    }
}
