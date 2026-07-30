//! `nopal phylog run ...` — run the PhyLog agent for one project's Card on
//! one day.
//!
//! Thin client over `POST /api/phylog/run` — all real logic (reading the
//! Card + the project's own SKILL.md + its current README.md, then asking
//! an LLM whether to propose a README update) lives server-side, see
//! `phylogAgent.server.ts`'s module doc. Defaults to a DRY RUN (preview
//! only, nothing written) — pass `--apply` to actually commit.

use serde::Deserialize;
use std::error::Error;

use crate::vault::{resolve_folder, Client};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentResult {
    #[serde(default)]
    proposed_change: bool,
    new_readme_body: Option<String>,
    reason: Option<String>,
    #[serde(default)]
    applied: bool,
    #[serde(default)]
    already_applied: bool,
}

/// Runs the PhyLog agent for `project_path`'s Card on `date`. Preview-only
/// unless `apply` is set.
pub fn run(
    project_path: &str,
    date: &str,
    apply: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_folder(&client, project_path)?
        .ok_or("The vault root isn't a project — pass a path like 'projects/sunny'")?;

    let body = serde_json::json!({
        "projectFolderId": folder._id,
        "date": date,
        "dryRun": !apply,
    });
    let result: AgentResult = client.post_json("/api/phylog/run", &body)?;

    if result.already_applied {
        println!("Already applied for this Card's current content — nothing to do.");
        return Ok(());
    }

    if !result.proposed_change {
        println!("PhyLog decided no README update was warranted for {date}.");
        return Ok(());
    }

    if apply && result.applied {
        println!("Applied — README.md updated.");
    } else {
        println!("PREVIEW (nothing written — pass --apply to commit):");
    }
    if let Some(reason) = &result.reason {
        println!("  reason: {reason}");
    }
    if let Some(body) = &result.new_readme_body {
        println!("\n--- proposed README body ---\n{body}\n--- end ---");
    }

    Ok(())
}
