//! `nopal graphlog ...` — GraphLog's pipeline for one `project-n02` project
//! (see the `graphlog` skill for the full design):
//!
//!   daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure
//!     -> graph-project-view
//!
//! `daily-log-sync` is deterministic and fast (a plain Card→project copy,
//! no LLM call), so it's ONE synchronous request/response (see
//! `api.graphlog.daily-log-sync.tsx`'s own doc — same shape as
//! `POST /api/daily-log/sort`). Every AGENTIC stage from here on
//! (`sync-knowledge`, `sync-graph`, `graph-structure`, `graph-project-view`)
//! follows an enqueue-then-poll shape instead, against GraphLog's own
//! queue/job routes.

use serde::Deserialize;
use serde_json::json;
use std::error::Error;
use std::time::Duration;

use crate::vault::{resolve_folder, Client, Folder};

/// How often to poll a running GraphLog job for new log lines / completion.
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

// ─── Queue plumbing (agentic stages only) ───────────────────
// A plain enqueue/poll pair against GraphLog's own `/api/graphlog/*`
// routes/queue.

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
struct GraphStructureResult {
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    changed: bool,
}

/// Runs `graph-structure` for `project_path` — see the `graphlog` skill.
/// Agentic (real LLM calls), so this enqueues and polls rather than
/// blocking on one request.
pub fn graph_structure(project_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog graph-structure: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/graph-structure", &body)?;
    let result: GraphStructureResult = poll_job(&client, &job_id)?;

    if result.skipped {
        println!("graph-structure: skipped (skills/GRAPH_STRUCTURE.md says skip).");
    } else if result.changed {
        println!("graph-structure: rebuilt graph-structure.md.");
    } else {
        println!("graph-structure: nothing new to process.");
    }

    Ok(())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphProjectViewResult {
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    changed: bool,
    #[serde(default)]
    summary: Vec<String>,
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
    if !result.changed {
        println!("graph-project-view: nothing new to apply (README.md already up to date).");
        return Ok(());
    }
    for line in &result.summary {
        println!("graph-project-view: {line}.");
    }

    Ok(())
}

/// Runs GraphLog's full pipeline for `project_path`, in order:
/// daily-log-sync -> sync-knowledge -> sync-graph -> graph-structure ->
/// graph-project-view. See the `graphlog` skill. Enqueues one job
/// covering all five stages and polls it — the individual stage commands
/// above remain useful for iterating on one project's own skill files
/// without paying for the others every time.
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

// ─── Reset ───────────────────────────────────────────────────
// `nopal graphlog reset` and its three narrower siblings — see the
// `graphlog` skill and `graphLogReset.server.ts`'s own module doc for
// exactly what each depth deletes. Destructive, requires --yes.

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectViewResetResult {
    #[serde(default)]
    deleted_folders: Vec<String>,
    #[serde(default)]
    deleted_files: Vec<String>,
    #[serde(default)]
    readme_cleared: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GraphResetResult {
    #[serde(default)]
    deleted_folders: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct KnowledgeResetResult {
    #[serde(default)]
    deleted_folders: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FullResetResult {
    #[serde(default)]
    project_view: ProjectViewResetResult,
    #[serde(default)]
    graph: GraphResetResult,
    #[serde(default)]
    knowledge: KnowledgeResetResult,
}

fn print_project_view_reset(result: &ProjectViewResetResult) {
    if !result.deleted_folders.is_empty() {
        println!("Deleted folders: {}", result.deleted_folders.join(", "));
    }
    if !result.deleted_files.is_empty() {
        println!("Deleted files: {}", result.deleted_files.join(", "));
    }
    if result.readme_cleared {
        println!("README.md's body was cleared (front matter preserved).");
    }
    if result.deleted_folders.is_empty()
        && result.deleted_files.is_empty()
        && !result.readme_cleared
    {
        println!("Nothing to reset — project view was already empty.");
    }
}

fn print_graph_reset(result: &GraphResetResult) {
    if result.deleted_folders.is_empty() {
        println!("Nothing to reset — no Graph folder exists yet.");
    } else {
        println!("Deleted the Graph folder.");
    }
}

fn print_knowledge_reset(result: &KnowledgeResetResult) {
    if result.deleted_folders.is_empty() {
        println!("Nothing to reset — no _knowledge folders exist yet.");
    } else {
        println!(
            "Deleted _knowledge folder(s): {}",
            result.deleted_folders.join(", ")
        );
    }
}

/// `nopal graphlog reset-project-view --project <path> --yes`
///
/// Deletes everything in the project folder EXCEPT `skills`/`syncs`/
/// `graph`, and clears `README.md`'s body (front matter preserved).
pub fn reset_project_view(
    project_path: &str,
    confirmed: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This deletes everything in {project_path}/ except its skills/, syncs/, and Graph/ folders (README.md's body is cleared, not the file itself). Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog reset-project-view: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/reset-project-view", &body)?;
    let result: ProjectViewResetResult = poll_job(&client, &job_id)?;
    print_project_view_reset(&result);

    Ok(())
}

/// `nopal graphlog reset-graph --project <path> --yes`
///
/// Deletes the project's `Graph` folder outright — every
/// `graph-log-*.md` file, and every `graph-project-view` idempotency
/// marker they carry.
pub fn reset_graph(
    project_path: &str,
    confirmed: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This deletes the entire Graph/ folder in {project_path}/ — every graph-log-*.md file. Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog reset-graph: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/reset-graph", &body)?;
    let result: GraphResetResult = poll_job(&client, &job_id)?;
    print_graph_reset(&result);

    Ok(())
}

/// `nopal graphlog reset-knowledge --project <path> --yes`
///
/// Deletes every `_knowledge/` sidecar folder nested anywhere under the
/// project's `syncs/` tree.
pub fn reset_knowledge(
    project_path: &str,
    confirmed: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This deletes every _knowledge/ folder nested under {project_path}/syncs/. Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog reset-knowledge: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/reset-knowledge", &body)?;
    let result: KnowledgeResetResult = poll_job(&client, &job_id)?;
    print_knowledge_reset(&result);

    Ok(())
}

/// `nopal graphlog reset --project <path> --yes`
///
/// Runs all three resets above, in order: reset-project-view ->
/// reset-graph -> reset-knowledge (`resetProjectAll`,
/// `graphLogReset.server.ts`). The single deepest "start completely
/// over" reset — a fresh `nopal graphlog run` afterward rebuilds
/// everything from `syncs/`'s remaining raw content.
pub fn reset(project_path: &str, confirmed: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    if !confirmed {
        return Err(format!(
            "This runs reset-project-view, reset-graph, and reset-knowledge on {project_path}/, in order — deleting everything GraphLog has generated except the skill files themselves. Pass --yes to confirm."
        )
        .into());
    }

    let client = Client::new()?;
    let folder = resolve_project(&client, project_path)?;

    println!("=== GraphLog reset: {project_path}/ ===");
    let body = json!({ "projectFolderId": folder._id });
    let job_id = enqueue(&client, "/api/graphlog/reset", &body)?;
    let result: FullResetResult = poll_job(&client, &job_id)?;

    println!("-- reset-project-view --");
    print_project_view_reset(&result.project_view);
    println!("-- reset-graph --");
    print_graph_reset(&result.graph);
    println!("-- reset-knowledge --");
    print_knowledge_reset(&result.knowledge);

    Ok(())
}
