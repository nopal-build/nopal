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
//!
//! EVERY subcommand below is now enqueue-then-poll, not one blocking
//! request: PhyLog runs happen in a separate worker process (`worker.ts`,
//! see `phylogQueue.server.ts`), and the API routes just enqueue and
//! return a job id (`202` + `{ jobId }`) immediately. Each command POSTs
//! to enqueue, then polls `GET /api/phylog/jobs/:jobId` until the job
//! finishes, printing new progress-log lines as they arrive (the server
//! always returns the FULL cumulative log, so `poll_job` tracks how many
//! lines it's already printed and only prints the new ones each poll —
//! see `phylogQueue.server.ts`'s own doc on why there's no delta API).

use serde::Deserialize;
use serde_json::json;
use std::error::Error;
use std::time::Duration;

use crate::vault::{resolve_file, resolve_folder, Client, Folder};

/// How often to poll a running job for new log lines / completion.
const POLL_INTERVAL: Duration = Duration::from_millis(1200);

fn resolve_project(client: &Client, path: &str) -> Result<Folder, Box<dyn Error + Send + Sync>> {
    resolve_folder(client, path)?.ok_or_else(|| {
        "The vault root isn't a project — pass a path like 'projects/sunny' or 'personal'".into()
    })
}

// ─── Queue plumbing ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueResponse {
    job_id: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct JobStatusResponse {
    #[serde(default)]
    state: String,
    #[serde(default)]
    log: Vec<String>,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

/// POSTs `body` to `path` to enqueue a PhyLog job, returning its id.
fn enqueue(
    client: &Client,
    path: &str,
    body: &serde_json::Value,
) -> Result<String, Box<dyn Error + Send + Sync>> {
    let response: EnqueueResponse = client.post_json(path, body)?;
    println!(
        "Queued as job {} — waiting for the worker…",
        response.job_id
    );
    Ok(response.job_id)
}

/// Polls `GET /api/phylog/jobs/:jobId` until the job completes or fails,
/// printing new progress-log lines as they show up, then deserializes the
/// job's return value into `T`.
fn poll_job<T: serde::de::DeserializeOwned>(
    client: &Client,
    job_id: &str,
) -> Result<T, Box<dyn Error + Send + Sync>> {
    let mut printed = 0usize;
    loop {
        let status: JobStatusResponse = client.get_json(&format!("/api/phylog/jobs/{job_id}"))?;

        if status.log.len() > printed {
            for line in &status.log[printed..] {
                println!("{line}");
            }
            printed = status.log.len();
        }

        match status.state.as_str() {
            "completed" => {
                let value = status
                    .result
                    .ok_or("PhyLog job completed without a result")?;
                return Ok(serde_json::from_value(value)?);
            }
            "failed" => {
                return Err(status
                    .error
                    .unwrap_or_else(|| "PhyLog job failed".to_string())
                    .into());
            }
            _ => {
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

// ─── Result shapes (deserialized from a completed job's return value) ──

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

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FiledAttachment {
    name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CaptureDayResult {
    date: String,
    /// Whose own Card this entry came from -- capture sweeps EVERY
    /// collaborator's Cards for the project, not just whoever's running
    /// the CLI, so the same `date` can appear more than once here, one
    /// entry per human.
    #[serde(default)]
    human_id: String,
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
    #[serde(default)]
    duration_ms: u64,
}

/// Matches `formatDurationMs` in `capture.server.ts` -- kept in sync by
/// hand since this is the only Rust-side consumer of that value.
fn format_duration_ms(ms: u64) -> String {
    let total_seconds = ms as f64 / 1000.0;
    if total_seconds < 60.0 {
        format!("{total_seconds:.1}s")
    } else {
        let minutes = (total_seconds / 60.0).floor();
        let seconds = total_seconds - minutes * 60.0;
        format!("{minutes}m {seconds:.1}s")
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PostCaptureResult {
    #[serde(default)]
    skipped: bool,
    note: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RunResult {
    #[serde(default)]
    pre_capture: PreCaptureResult,
    #[serde(default)]
    capture: CaptureResult,
    #[serde(default)]
    post_capture: PostCaptureResult,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ResetResult {
    summary: ResetSummary,
}

// `ok` is omitted on purpose -- the worker throws on `{ ok: false }`
// before this ever reaches a completed job's `result`, same convention
// every other job result here already relies on.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReorganizeResult {
    #[serde(default)]
    changed: bool,
    #[serde(default)]
    summary: Vec<String>,
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

    let entry_count = result.days.len();

    // Capture sweeps every collaborator's Cards, not just whoever's
    // running this command -- only bother labeling entries with WHO wrote
    // the Card once more than one human actually shows up, so the common
    // single-contributor case stays exactly as quiet as before.
    let distinct_humans: std::collections::HashSet<&str> =
        result.days.iter().map(|d| d.human_id.as_str()).collect();
    let multi_human = distinct_humans.len() > 1;
    let who = |id: &str| -> String {
        if multi_human {
            format!(" ({id})")
        } else {
            String::new()
        }
    };

    for day in &result.days {
        let label = who(&day.human_id);
        if day.already_applied {
            println!(
                "Capture: {}{label} — already applied for this Card's current content.",
                day.date
            );
            continue;
        }
        for f in &day.filed {
            println!("Capture: {}{label} — filed \"{}\".", day.date, f.name);
        }
        for action in &day.organize_actions {
            println!("Capture: {}{label} — {action}.", day.date);
        }
        if day.readme_updated {
            println!("Capture: {}{label} — README updated.", day.date);
        } else if day.filed.is_empty() && day.organize_actions.is_empty() {
            println!("Capture: {}{label} — nothing warranted a change.", day.date);
        }
    }

    println!(
        "Capture: done in {} ({entry_count} entr{} processed).",
        format_duration_ms(result.duration_ms),
        if entry_count == 1 { "y" } else { "ies" }
    );
}

fn print_post_capture(result: &PostCaptureResult) {
    if result.skipped {
        println!("Post-capture: skipped (skills/POST_CAPTURE.md says skip).");
    } else if let Some(note) = &result.note {
        println!("Post-capture: {note}");
    }
}

fn print_reorganize(result: &ReorganizeResult) {
    if !result.changed {
        println!("Reorganize: no changes made -- the current structure already looked fine.");
        return;
    }
    for action in &result.summary {
        println!("Reorganize: {action}.");
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

    let job_id = enqueue(&client, "/api/phylog/run", &body)?;
    let result: RunResult = poll_job(&client, &job_id)?;

    println!("--- Results ---");
    print_pre_capture(&result.pre_capture);
    print_capture(&result.capture);
    print_post_capture(&result.post_capture);
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
    let job_id = enqueue(&client, "/api/phylog/pre-capture", &body)?;
    let result: PreCaptureResult = poll_job(&client, &job_id)?;
    print_pre_capture(&result);
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
    let job_id = enqueue(&client, "/api/phylog/capture", &body)?;
    let result: CaptureResult = poll_job(&client, &job_id)?;
    print_capture(&result);
    Ok(())
}

/// `nopal phylog post-capture --project <path>`
pub fn post_capture(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog post-capture: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/phylog/post-capture", &body)?;
    let result: PostCaptureResult = poll_job(&client, &job_id)?;
    print_post_capture(&result);
    Ok(())
}

/// `nopal phylog reset --project <path> --yes`
pub fn reset(project_path: &str, confirmed: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This deletes everything in {project_path}/ except its skills/, syncs/, and daily-logs/ folders. Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog reset: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/phylog/reset", &body)?;
    let result: ResetResult = poll_job(&client, &job_id)?;
    println!(
        "Reset removed {} folder(s) and {} file(s). skills/, syncs/, and daily-logs/ were left untouched.",
        result.summary.deleted_folders.len(),
        result.summary.deleted_files.len()
    );
    println!(
        "Run `nopal phylog capture --project {project_path} --full` to rebuild from daily-logs/."
    );
    Ok(())
}

/// `nopal phylog reset-pre-capture --project <path> --yes`
///
/// The DEEPER reset -- everything `reset` wipes, PLUS the project's own
/// `daily-logs` staging folder (pre-capture's own output). Needed when
/// pre-capture's own output itself should be regenerated from scratch
/// (e.g. after editing `skills/PRE_CAPTURE.md`). Requires `nopal phylog
/// pre-capture` (to restage `daily-logs`) before `capture --full` has
/// anything to rebuild from again.
pub fn reset_pre_capture(
    project_path: &str,
    confirmed: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This deletes everything in {project_path}/ except its skills/ and syncs/ folders -- INCLUDING daily-logs/ (pre-capture's own staged output). Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog reset-pre-capture: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/phylog/reset-pre-capture", &body)?;
    let result: ResetResult = poll_job(&client, &job_id)?;
    println!(
        "Reset removed {} folder(s) and {} file(s), including daily-logs/. skills/ and syncs/ were left untouched.",
        result.summary.deleted_folders.len(),
        result.summary.deleted_files.len()
    );
    println!("Run `nopal phylog pre-capture --project {project_path}` to restage daily-logs/, then `nopal phylog capture --project {project_path} --full` to rebuild.");
    Ok(())
}

/// `nopal phylog reorganize --project <path>`
///
/// A DEDICATED, whole-README structure pass -- distinct from `capture`'s
/// own one-day-at-a-time loop. Given the entire current README at once
/// (not one day's log), explicitly asked to evaluate and fix the
/// project's overall structure -- section boundaries, and what's inlined
/// versus already split into its own file. `capture` also runs this
/// automatically, mid-cycle, whenever a daily log explicitly asks for a
/// reorganization (`request_reorganize`, `capture.server.ts`); this
/// command is for triggering it directly, without writing (or waiting
/// for) such a request.
pub fn reorganize(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== PhyLog reorganize: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/phylog/reorganize", &body)?;
    let result: ReorganizeResult = poll_job(&client, &job_id)?;
    print_reorganize(&result);
    Ok(())
}
