//! `nopal graphlog ...` — GraphLog's pipeline for one `project-n02` project
//! (see the `graphlog` skill for the full design):
//!
//!   daily-log-sync -> sync-knowledge -> sync-graph -> graph-project-view
//!
//! Only `daily-log-sync` exists so far — deterministic and fast (a plain
//! Card→project copy, no LLM call), so unlike PhyLog's own stages this is
//! ONE synchronous request/response, not an enqueue-then-poll job (see
//! `api.graphlog.daily-log-sync.tsx`'s own doc — same shape as
//! `POST /api/daily-log/sort`, not `POST /api/phylog/*`). The later,
//! agentic stages are expected to need the enqueue/poll pattern
//! `phylog.rs` already established, once they exist.

use serde::Deserialize;
use serde_json::json;
use std::error::Error;

use crate::vault::{resolve_folder, Client, Folder};

fn resolve_project(client: &Client, path: &str) -> Result<Folder, Box<dyn Error + Send + Sync>> {
    resolve_folder(client, path)?.ok_or_else(|| {
        "The vault root isn't a project — pass a path like 'projects/sunny' or 'personal'".into()
    })
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SyncedEntry {
    date: String,
    #[serde(default)]
    human_id: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CopiedAttachment {
    date: String,
    #[serde(default)]
    human_id: String,
    name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DailyLogSyncResult {
    #[serde(default)]
    synced: Vec<SyncedEntry>,
    #[serde(default)]
    unchanged: Vec<SyncedEntry>,
    #[serde(default)]
    attachments_copied: Vec<CopiedAttachment>,
}

/// Runs `daily-log-sync` for `project_path` — every (day, contributor) with
/// a Card for this project gets mirrored into `syncs/Daily Logs/`. Omit
/// `date` to sweep every day this project has ever had a Card for.
pub fn daily_log_sync(
    project_path: &str,
    date: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog daily-log-sync: {project_path}/ ===");
    let mut body = json!({ "projectFolderId": folder._id });
    if let Some(d) = date {
        body["date"] = serde_json::Value::String(d.to_string());
    }

    let result: DailyLogSyncResult = client.post_json("/api/graphlog/daily-log-sync", &body)?;

    if result.synced.is_empty() && result.attachments_copied.is_empty() {
        println!(
            "Nothing new to sync ({} day(s) already up to date).",
            result.unchanged.len()
        );
        return Ok(());
    }

    for entry in &result.synced {
        println!("Synced Card for {} ({}).", entry.date, entry.human_id);
    }
    for attachment in &result.attachments_copied {
        println!(
            "Copied attachment \"{}\" from {} ({}).",
            attachment.name, attachment.date, attachment.human_id
        );
    }
    if !result.unchanged.is_empty() {
        println!(
            "{} day(s) already up to date, left unchanged.",
            result.unchanged.len()
        );
    }

    Ok(())
}
