//! `nopal phylog ...` — PhyLog's three-stage pipeline (see the `phylog`
//! skill for the full design):
//!
//!   pre-capture -> capture -> post-capture
//!
//! `nopal phylog run` runs all three, in order, for one project. Each
//! stage is ALSO independently runnable (`pre-capture`/`capture`/
//! `post-capture`) — useful while iterating on a project's own
//! `skills/PRE_CAPTURE.md`/`CAPTURE.md`/`POST_CAPTURE.md` without paying
//! for the other stages every time. `nopal phylog reset` wipes a
//! project's PhyLog-managed content (everything except its `skills`/
//! `syncs` folders) so it can be rebuilt from scratch.
//!
//! Thin client over `/api/phylog/*` — all real logic lives server-side,
//! see `phylogAgent.server.ts`/`preCapture.server.ts`/`capture.server.ts`/
//! `postCapture.server.ts`. ALWAYS APPLIES — there is no preview/dry-run
//! mode or `--apply` flag anymore; `nopal release-log revert` remains the
//! safety net for undoing a specific capture's README edit, and `phylog
//! reset` + `capture --full` is the "start over" workflow.

use serde::Deserialize;
use serde_json::json;
use std::error::Error;

use crate::vault::{resolve_file, resolve_folder, Client, Folder};

fn resolve_project(client: &Client, path: &str) -> Result<Folder, Box<dyn Error + Send + Sync>> {
    resolve_folder(client, path)?.ok_or_else(|| {
        "The vault root isn't a project — pass a path like 'projects/sunny' or 'personal'".into()
    })
}

fn print_log(log: &[String]) {
    for line in log {
        println!("{line}");
    }
}

// ─── Response shapes ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PreCaptureSummary {
    name: String,
    #[serde(default)]
    generated: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UnsupportedFile {
    name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PreCaptureResult {
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    summaries: Vec<PreCaptureSummary>,
    #[serde(default)]
    unsupported: Vec<UnsupportedFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreCaptureResponse {
    #[serde(flatten)]
    result: PreCaptureResult,
    #[serde(default)]
    log: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FiledAttachment {
    name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CaptureDayResult {
    date: String,
    #[serde(default)]
    filed: Vec<FiledAttachment>,
    #[serde(default)]
    organize_actions: Vec<String>,
    #[serde(default)]
    readme_updated: bool,
    #[serde(default)]
    already_applied: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ResetSummary {
    #[serde(default)]
    deleted_folders: Vec<String>,
    #[serde(default)]
    deleted_files: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CaptureResult {
    reset_summary: Option<ResetSummary>,
    #[serde(default)]
    days: Vec<CaptureDayResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureResponse {
    #[serde(flatten)]
    result: CaptureResult,
    #[serde(default)]
    log: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PostCaptureResult {
    #[serde(default)]
    skipped: bool,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostCaptureResponse {
    #[serde(flatten)]
    result: PostCaptureResult,
    #[serde(default)]
    log: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunResponse {
    #[serde(default)]
    pre_capture: PreCaptureResult,
    #[serde(default)]
    capture: CaptureResult,
    #[serde(default)]
    post_capture: PostCaptureResult,
    #[serde(default)]
    log: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetResponse {
    summary: ResetSummary,
}

// ─── Printing ───────────────────────────────────────────────────────────

fn print_pre_capture(result: &PreCaptureResult) {
    if result.skipped {
        println!("Pre-capture: skipped (skills/PRE_CAPTURE.md says skip).");
        return;
    }
    let generated: Vec<&PreCaptureSummary> =
        result.summaries.iter().filter(|s| s.generated).collect();
    if generated.is_empty() && result.unsupported.is_empty() {
        println!("Pre-capture: nothing new to summarize.");
    } else {
        for s in &generated {
            println!("Pre-capture: wrote a summary for \"{}\".", s.name);
        }
        for u in &result.unsupported {
            println!(
                "Pre-capture: \"{}\" couldn't be summarized (no readable content).",
                u.name
            );
        }
    }
}

fn print_capture(result: &CaptureResult) {
    if let Some(reset) = &result.reset_summary {
        println!(
            "Capture: --full reset removed {} folder(s) and {} file(s) before rebuilding.",
            reset.deleted_folders.len(),
            reset.deleted_files.len()
        );
    }
    if result.days.is_empty() {
        println!("Capture: no Card found for this project on any day in range.");
        return;
    }
    for day in &result.days {
        if day.already_applied {
            println!(
                "Capture: {} — already applied for this Card's current content.",
                day.date
            );
            continue;
        }
        for f in &day.filed {
            println!("Capture: {} — filed \"{}\".", day.date, f.name);
        }
        for action in &day.organize_actions {
            println!("Capture: {} — {action}.", day.date);
        }
        if day.readme_updated {
            println!("Capture: {} — README updated.", day.date);
        } else if day.filed.is_empty() && day.organize_actions.is_empty() {
            println!("Capture: {} — nothing warranted a change.", day.date);
        }
    }
}

fn print_post_capture(result: &PostCaptureResult) {
    if result.skipped {
        println!("Post-capture: skipped (skills/POST_CAPTURE.md says skip).");
    } else if let Some(note) = &result.note {
        println!("Post-capture: {note}");
    }
}

// ─── Commands ───────────────────────────────────────────────────────────

/// `nopal phylog run --project <path> [--full] [--since ...] [--until ...]`
pub fn run(
    project_path: &str,
    full: bool,
    since: Option<&str>,
    until: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog run: {project_path}/ ===");
    let mut body = json!({ "projectFolderId": folder._id, "full": full });
    if let Some(since) = since {
        body["since"] = serde_json::Value::String(since.to_string());
    }
    if let Some(until) = until {
        body["until"] = serde_json::Value::String(until.to_string());
    }

    let response: RunResponse = client.post_json("/api/phylog/run", &body)?;
    print_log(&response.log);
    println!("--- Stage 1/3: pre-capture ---");
    print_pre_capture(&response.pre_capture);
    println!("--- Stage 2/3: capture ---");
    print_capture(&response.capture);
    println!("--- Stage 3/3: post-capture ---");
    print_post_capture(&response.post_capture);
    println!("=== Done ===");
    Ok(())
}

/// `nopal phylog pre-capture --project <path> [--date ...] [--file <path>]`
pub fn pre_capture(
    project_path: &str,
    date: Option<&str>,
    file: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    let mut body = json!({ "projectFolderId": folder._id });
    if let Some(date) = date {
        body["date"] = serde_json::Value::String(date.to_string());
    }
    if let Some(file_path) = file {
        let file_listing = resolve_file(&client, file_path)?;
        body["fileId"] = serde_json::Value::String(file_listing._id);
    }

    println!("=== PhyLog pre-capture: {project_path}/ ===");
    let response: PreCaptureResponse = client.post_json("/api/phylog/pre-capture", &body)?;
    print_log(&response.log);
    print_pre_capture(&response.result);
    Ok(())
}

/// `nopal phylog capture --project <path> [--full] [--since ...] [--until ...]`
pub fn capture(
    project_path: &str,
    full: bool,
    since: Option<&str>,
    until: Option<&str>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    let mut body = json!({ "projectFolderId": folder._id, "full": full });
    if let Some(since) = since {
        body["since"] = serde_json::Value::String(since.to_string());
    }
    if let Some(until) = until {
        body["until"] = serde_json::Value::String(until.to_string());
    }

    println!(
        "=== PhyLog capture: {project_path}/ ({}) ===",
        if full { "full rebuild" } else { "incremental" }
    );
    let response: CaptureResponse = client.post_json("/api/phylog/capture", &body)?;
    print_log(&response.log);
    print_capture(&response.result);
    Ok(())
}

/// `nopal phylog post-capture --project <path>`
pub fn post_capture(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog post-capture: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let response: PostCaptureResponse = client.post_json("/api/phylog/post-capture", &body)?;
    print_log(&response.log);
    print_post_capture(&response.result);
    Ok(())
}

/// `nopal phylog reset --project <path> --yes`
pub fn reset(project_path: &str, confirmed: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This deletes everything in {project_path}/ except its skills/ and syncs/ folders. Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog reset: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let response: ResetResponse = client.post_json("/api/phylog/reset", &body)?;
    println!(
        "Reset removed {} folder(s) and {} file(s). skills/ and syncs/ were left untouched.",
        response.summary.deleted_folders.len(),
        response.summary.deleted_files.len()
    );
    println!("Run `nopal phylog capture --project {project_path} --full` to rebuild.");
    Ok(())
}
