//! `nopal skills ...` — reference docs for how to write/work with things in
//! Nopal (OxMarkdown syntax, the Vault, etc).
//!
//! These mirror the agent skills that live under `.agents/skills/` in this
//! repo, embedded into the binary at compile time via `include_str!`. That
//! keeps the CLI usable offline and pins each release to whatever skill
//! content shipped with it — no server round-trip for what is fundamentally
//! static reference material. If a skill changes, a new CLI release (`nopal
//! update`) picks it up.

use std::error::Error;

struct Skill {
    id: &'static str,
    source: &'static str,
}

const SKILLS: &[Skill] = &[
    Skill {
        id: "oxmarkdown",
        source: include_str!("../../../.agents/skills/oxmarkdown/SKILL.md"),
    },
    Skill {
        id: "vault",
        source: include_str!("../../../.agents/skills/vault/SKILL.md"),
    },
    Skill {
        id: "passkey",
        source: include_str!("../../../.agents/skills/passkey/SKILL.md"),
    },
    Skill {
        id: "dark-mode-review",
        source: include_str!("../../../.agents/skills/dark-mode-review/SKILL.md"),
    },
];

/// Pulls the `description:` line out of a SKILL.md's YAML frontmatter, so
/// `nopal skills` can list a one-line summary without a YAML dependency.
fn frontmatter_description(source: &str) -> &str {
    let mut lines = source.lines();
    if lines.next() != Some("---") {
        return "";
    }
    for line in lines {
        if line == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix("description:") {
            return rest.trim();
        }
    }
    ""
}

pub fn list() {
    let width = SKILLS.iter().map(|s| s.id.len()).max().unwrap_or(0);
    for skill in SKILLS {
        println!(
            "{:width$}  {}",
            skill.id,
            frontmatter_description(skill.source),
            width = width
        );
    }
    println!("\nRun `nopal skills show <name>` to print a skill's full reference.");
}

pub fn show(name: &str) -> Result<(), Box<dyn Error>> {
    match SKILLS.iter().find(|s| s.id == name) {
        Some(skill) => {
            print!("{}", skill.source);
            Ok(())
        }
        None => {
            let available: Vec<&str> = SKILLS.iter().map(|s| s.id).collect();
            Err(format!(
                "unknown skill '{name}' — available: {}",
                available.join(", ")
            )
            .into())
        }
    }
}
