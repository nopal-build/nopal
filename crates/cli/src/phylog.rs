//! `nopal phylog run ...` — run the PhyLog agent for one project's Card, on
//! one day (`--date`) or across every day it has a Card for, up to today
//! (`--date` omitted, optionally bounded by `--since`).
//!
//! Thin client over `POST /api/phylog/run` / `POST /api/phylog/run-all` —
//! all real logic (reading the Card + the project's own SKILL.md + its
//! current README.md, then asking an LLM whether to propose a README
//! update) lives server-side, see `phylogAgent.server.ts`'s module doc.
//! Defaults to a DRY RUN (preview only, nothing written) — pass `--apply`
//! to actually commit.

use serde::Deserialize;
use std::error::Error;

use crate::vault::{resolve_folder, Client};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FiledAttachment {
    name: String,
}

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
    /// Attachments actually filed into the project this call — only
    /// present on a real (`--apply`) run.
    #[serde(default)]
    filed_attachments: Vec<FiledAttachment>,
    /// Attachments not yet filed — only present on a preview run.
    #[serde(default)]
    pending_attachments: Vec<FiledAttachment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatedAgentResult {
    date: String,
    #[serde(flatten)]
    result: AgentResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RangeResponse {
    results: Vec<DatedAgentResult>,
}

/// Runs the PhyLog agent for `project_path`. Pass `date` for one specific
/// day; omit it to run every day this project already has a Card for, up
/// to today (optionally bounded below by `since`). Preview-only unless
/// `apply` is set.
pub fn run(
    project_path: &str,
    date: Option<&str>,
    since: Option<&str>,
    apply: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_folder(&client, project_path)?
        .ok_or("The vault root isn't a project — pass a path like 'projects/sunny'")?;

    match date {
        Some(date) => run_one(&client, &folder._id, date, apply),
        None => run_all(&client, &folder._id, since, apply),
    }
}

fn run_one(
    client: &Client,
    project_folder_id: &str,
    date: &str,
    apply: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let body = serde_json::json!({
        "projectFolderId": project_folder_id,
        "date": date,
        "dryRun": !apply,
    });
    let result: AgentResult = client.post_json("/api/phylog/run", &body)?;
    print_result(date, &result, apply);
    Ok(())
}

fn run_all(
    client: &Client,
    project_folder_id: &str,
    since: Option<&str>,
    apply: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut body = serde_json::json!({
        "projectFolderId": project_folder_id,
        "dryRun": !apply,
    });
    if let Some(since) = since {
        body["since"] = serde_json::Value::String(since.to_string());
    }
    let response: RangeResponse = client.post_json("/api/phylog/run-all", &body)?;

    if response.results.is_empty() {
        println!(
            "No Card found for this project on any day{}.",
            match since {
                Some(since) => format!(" since {since}"),
                None => String::new(),
            }
        );
        return Ok(());
    }

    for dated in &response.results {
        print_result(&dated.date, &dated.result, apply);
    }
    Ok(())
}

fn print_result(date: &str, result: &AgentResult, apply: bool) {
    // Attachment filing is deterministic and independent of the model's own
    // README decision below, so it's reported regardless of which branch
    // that decision falls into.
    if apply {
        for f in &result.filed_attachments {
            println!("{date}: filed \"{}\" into the project.", f.name);
        }
    } else {
        for f in &result.pending_attachments {
            println!(
                "{date}: \"{}\" would be filed into the project (pass --apply to commit).",
                f.name
            );
        }
    }

    if result.already_applied {
        println!("{date}: already applied for this Card's current content — nothing to do.");
        return;
    }

    if !result.proposed_change {
        println!("{date}: PhyLog decided no README update was warranted.");
        return;
    }

    if apply && result.applied {
        println!("{date}: applied — README.md updated.");
    } else {
        println!("{date}: PREVIEW (nothing written — pass --apply to commit):");
    }
    if let Some(reason) = &result.reason {
        println!("  reason: {reason}");
    }
    if let Some(body) = &result.new_readme_body {
        println!("\n--- proposed README body ---\n{body}\n--- end ---");
    }
}
