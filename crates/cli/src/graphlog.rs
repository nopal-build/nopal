//! `nopal graphlog ...` — GraphLog's pipeline for one `project-n02` project
//! (see the `graphlog` skill for the full design):
//!
//!   daily-log-sync -> sync-knowledge -> sync-graph -> graph-project-view
//!
//! `daily-log-sync` is deterministic and fast (a plain Card→project copy,
//! no LLM call), so it's ONE synchronous request/response (see
//! `api.graphlog.daily-log-sync.tsx`'s own doc — same shape as
//! `POST /api/daily-log/sort`, not `POST /api/phylog/*`). Every AGENTIC
//! stage from here on (`sync-knowledge`, and later `sync-graph`/
//! `graph-project-view`) follows PhyLog's own enqueue-then-poll shape
//! instead (`phylog.rs`'s pattern, mirrored here against GraphLog's own
//! queue/job routes).

use serde::Deserialize;
use serde_json::json;
use std::error::Error;
use std::time::Duration;

use crate::vault::{resolve_folder, Client, Folder};

/// How often to poll a running GraphLog job for new log lines / completion
/// — same cadence `phylog.rs` uses.
const POLL_INTERVAL: Duration = Duration::from_millis(1200);

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

// ─── Queue plumbing (agentic stages only) ───────────────────────────
// Mirrors `phylog.rs`'s own `enqueue`/`poll_job` exactly, against
// GraphLog's own `/api/graphlog/*` routes/queue instead of PhyLog's.

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

fn poll_job<T: serde::de::DeserializeOwned>(
    client: &Client,
    job_id: &str,
) -> Result<T, Box<dyn Error + Send + Sync>> {
    let mut printed = 0usize;
    loop {
        let status: JobStatusResponse = client.get_json(&format!("/api/graphlog/jobs/{job_id}"))?;

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
                    .ok_or("GraphLog job completed without a result")?;
                return Ok(serde_json::from_value(value)?);
            }
            "failed" => {
                return Err(status
                    .error
                    .unwrap_or_else(|| "GraphLog job failed".to_string())
                    .into());
            }
            _ => {
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct KnowledgeEntry {
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
struct SyncKnowledgeResult {
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    entries: Vec<KnowledgeEntry>,
    #[serde(default)]
    unsupported: Vec<UnsupportedFile>,
}

/// Runs `sync-knowledge` for `project_path` — see the `graphlog` skill.
/// Agentic (real LLM calls), so this enqueues and polls rather than
/// blocking on one request.
pub fn sync_knowledge(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog sync-knowledge: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/sync-knowledge", &body)?;
    let result: SyncKnowledgeResult = poll_job(&client, &job_id)?;

    if result.skipped {
        println!("sync-knowledge: skipped (skills/KNOWLEDGE.md says skip).");
        return Ok(());
    }

    let generated: Vec<&KnowledgeEntry> = result.entries.iter().filter(|e| e.generated).collect();
    if generated.is_empty() && result.unsupported.is_empty() {
        println!("sync-knowledge: nothing new to process.");
        return Ok(());
    }
    for e in &generated {
        println!("sync-knowledge: wrote knowledge for \"{}\".", e.name);
    }
    for u in &result.unsupported {
        println!(
            "sync-knowledge: \"{}\" couldn't be processed (no readable content).",
            u.name
        );
    }

    Ok(())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphDayResult {
    date: String,
    #[serde(default)]
    changed: bool,
    #[serde(default)]
    empty: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SyncGraphResult {
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    days: Vec<GraphDayResult>,
}

/// Runs `sync-graph` for `project_path` — see the `graphlog` skill.
/// Agentic (real LLM calls), so this enqueues and polls rather than
/// blocking on one request.
pub fn sync_graph(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog sync-graph: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/sync-graph", &body)?;
    let result: SyncGraphResult = poll_job(&client, &job_id)?;

    if result.skipped {
        println!("sync-graph: skipped (skills/GRAPH.md says skip).");
        return Ok(());
    }
    if result.days.is_empty() {
        println!("sync-graph: nothing new to process.");
        return Ok(());
    }

    for day in &result.days {
        if !day.changed {
            continue;
        }
        if day.empty {
            println!("sync-graph: {} — nothing worth capturing.", day.date);
        } else {
            println!("sync-graph: wrote graph-log-{}.md.", day.date);
        }
    }
    let unchanged = result.days.iter().filter(|d| !d.changed).count();
    if unchanged > 0 {
        println!("{unchanged} day(s) already up to date, left unchanged.");
    }

    Ok(())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectViewDayResult {
    date: String,
    #[serde(default)]
    changed: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphProjectViewResult {
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    days: Vec<ProjectViewDayResult>,
}

/// Runs `graph-project-view` for `project_path` — see the `graphlog`
/// skill. Agentic (real LLM calls), so this enqueues and polls rather
/// than blocking on one request.
pub fn graph_project_view(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog graph-project-view: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/graph-project-view", &body)?;
    let result: GraphProjectViewResult = poll_job(&client, &job_id)?;

    if result.skipped {
        println!("graph-project-view: skipped (skills/PROJECT_VIEW.md says skip).");
        return Ok(());
    }
    if result.days.is_empty() {
        println!("graph-project-view: nothing new to process.");
        return Ok(());
    }

    let changed: Vec<&ProjectViewDayResult> = result.days.iter().filter(|d| d.changed).collect();
    if changed.is_empty() {
        println!("graph-project-view: nothing new to apply (every day already up to date).");
        return Ok(());
    }
    for day in &changed {
        println!("graph-project-view: applied {} to README.md.", day.date);
    }
    let unchanged = result.days.len() - changed.len();
    if unchanged > 0 {
        println!("{unchanged} day(s) already up to date, left unchanged.");
    }

    Ok(())
}

/// Runs GraphLog's full pipeline for `project_path`, in order:
/// daily-log-sync -> sync-knowledge -> sync-graph -> graph-project-view.
/// See the `graphlog` skill. Enqueues one job covering all four stages
/// and polls it — the individual stage commands above remain useful for
/// iterating on one project's own skill files without paying for the
/// others every time.
pub fn run(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog run: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/run", &body)?;
    // The combined result's exact shape isn't printed piece by piece here
    // (each stage already logs its own progress lines, printed live by
    // `poll_job` as they arrive) — just confirm it finished.
    let _: serde_json::Value = poll_job(&client, &job_id)?;
    println!("run: finished.");

    Ok(())
}
