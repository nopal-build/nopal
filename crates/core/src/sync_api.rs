//! `sync-api` analyses — a typed CSV data-collection folder living inside a
//! project's (or Personal's) `syncs/` folder. See the vault skill's "Sync
//! types" section and the webapp's `syncApi.server.ts` for the full
//! design.
//!
//! An analysis defines a column schema once (`_schema.json`, set via `PUT
//! /api/vault/sync-api/:folderId/schema`), then any number of RUNS are
//! created against it (`<name>.md` + `<name>.csv`), each one accepting any
//! number of row-append calls over whatever timeframe fits that data
//! source — one bulk call at the end of a session, or many small batches
//! spread over hours/days. This module is the thin HTTP wrapper the CLI
//! (and, someday, the native app) calls into — no printing/prompting here,
//! same split `nopal_core::sync` uses.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::sync::syncs_folder;
use crate::vault::{self, Client, Folder};
use crate::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncApiColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub column_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncApiSchema {
    pub columns: Vec<SyncApiColumn>,
}

#[derive(Debug, Clone, Deserialize)]
struct RunFileListing {
    _id: String,
    #[allow(dead_code)]
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RunResponse {
    name: String,
    #[serde(rename = "mdFile")]
    md_file: RunFileListing,
    #[serde(rename = "csvFile")]
    csv_file: RunFileListing,
}

/// A created (or looked-up) run — enough to append rows to it and to point
/// a human at its `.md`/`.csv` files.
#[derive(Debug, Clone)]
pub struct RunHandle {
    pub name: String,
    pub md_file_id: String,
    pub csv_file_id: String,
}

/// Resolves the target space for an analysis: `project` is a full vault
/// path (e.g. `"projects/sunny"`), defaulting to `"personal"` when omitted
/// — same convention `nopal graphlog` commands use for their own
/// `--project` flag (unlike `nopal sync add --project`, which takes a bare
/// project name).
pub fn resolve_space(client: &Client, project: Option<&str>) -> Result<Folder> {
    let path = project.unwrap_or("personal");
    vault::resolve_folder(client, path)?.ok_or_else(|| {
        format!("'{path}' not found — pass a path like 'projects/sunny' or 'personal'").into()
    })
}

/// Finds an existing `sync-api` analysis named `name` inside `space`'s
/// Syncs folder.
pub fn find_analysis(client: &Client, space: &Folder, name: &str) -> Result<Option<Folder>> {
    let syncs = syncs_folder(client, space)?;
    Ok(client
        .children(&syncs._id)?
        .folders
        .into_iter()
        .find(|f| f.name == name && f.folder_type.as_deref() == Some("sync-api")))
}

/// Resolves an existing analysis by name, with a friendly error if it
/// isn't there yet.
pub fn resolve_analysis(client: &Client, project: Option<&str>, name: &str) -> Result<Folder> {
    let space = resolve_space(client, project)?;
    find_analysis(client, &space, name)?.ok_or_else(|| {
        format!(
            "No sync-api analysis named '{name}' in {}/syncs — create it first with \
             `nopal sync-api create-analysis {name} --schema ...`",
            space.name
        )
        .into()
    })
}

/// Creates the analysis folder if it doesn't already exist, then sets (or
/// replaces) its schema. Safe to call every time a program starts up — the
/// folder lookup is idempotent, and re-setting the schema only affects
/// runs created AFTER this call (existing runs keep the header their own
/// CSV was created with).
pub fn ensure_analysis(
    client: &Client,
    project: Option<&str>,
    name: &str,
    schema: &SyncApiSchema,
) -> Result<Folder> {
    let space = resolve_space(client, project)?;
    let syncs = syncs_folder(client, &space)?;

    let folder = match find_analysis(client, &space, name)? {
        Some(f) => f,
        None => {
            if client
                .children(&syncs._id)?
                .folders
                .iter()
                .any(|f| f.name == name)
            {
                return Err(format!(
                    "{}/syncs/{name}/ already exists but isn't a sync-api analysis",
                    space.name
                )
                .into());
            }
            let resp: serde_json::Value = client.post_json(
                "/api/vault/folders",
                &json!({
                    "name": name,
                    "parent_folder_id": syncs._id,
                    "folder_type": "sync-api",
                }),
            )?;
            serde_json::from_value(resp["folder"].clone())?
        }
    };

    let _: serde_json::Value = client.put_json(
        &format!("/api/vault/sync-api/{}/schema", folder._id),
        &json!({ "schema": schema }),
    )?;

    Ok(folder)
}

/// Creates a new run inside `analysis`. Exactly one of `name`/`prefix` is
/// meaningful — `name` for an exact, caller-chosen run name; `prefix` (e.g.
/// `"test"`) to auto-number against existing runs sharing that prefix
/// (`"test-1"`, `"test-2"`, ...). Defaults to prefix `"test"` when neither
/// is given.
pub fn create_run(
    client: &Client,
    analysis: &Folder,
    name: Option<&str>,
    prefix: Option<&str>,
    title: Option<&str>,
    body: Option<&str>,
) -> Result<RunHandle> {
    let resp: serde_json::Value = client.post_json(
        &format!("/api/vault/sync-api/{}/runs", analysis._id),
        &json!({
            "name": name,
            "prefix": prefix,
            "title": title,
            "body": body,
        }),
    )?;
    let run: RunResponse = serde_json::from_value(resp["run"].clone())?;
    Ok(RunHandle {
        name: run.name,
        md_file_id: run.md_file._id,
        csv_file_id: run.csv_file._id,
    })
}

/// Appends `rows` to an existing run's CSV — always a server-side
/// read-append-write; this never fetches or re-uploads the CSV itself.
/// Returns the number of rows the server actually appended.
pub fn append_rows(
    client: &Client,
    analysis: &Folder,
    run_name: &str,
    rows: &[serde_json::Value],
) -> Result<usize> {
    if rows.is_empty() {
        return Ok(0);
    }
    let resp: serde_json::Value = client.post_json(
        &format!(
            "/api/vault/sync-api/{}/runs/{}/rows",
            analysis._id, run_name
        ),
        &json!({ "rows": rows }),
    )?;
    Ok(resp["appended"].as_u64().unwrap_or(0) as usize)
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunListing {
    pub name: String,
}

/// Lists every run currently in `analysis` (name only — fetch the files
/// directly via the vault client for content).
pub fn list_runs(client: &Client, analysis: &Folder) -> Result<Vec<RunListing>> {
    let resp: serde_json::Value =
        client.get_json(&format!("/api/vault/sync-api/{}/runs", analysis._id))?;
    Ok(serde_json::from_value(resp["runs"].clone())?)
}

/// Parses a CLI-friendly schema spec like `"elapsed:number,type:string"`
/// into a `SyncApiSchema`.
pub fn parse_schema_spec(spec: &str) -> Result<SyncApiSchema> {
    let mut columns = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (name, ty) = part
            .split_once(':')
            .ok_or_else(|| format!("Invalid column spec '{part}' — expected name:type"))?;
        let ty = ty.trim();
        if !matches!(ty, "string" | "number" | "boolean" | "timestamp") {
            return Err(format!(
                "Unknown column type '{ty}' for '{}' — expected string, number, boolean, or timestamp",
                name.trim()
            )
            .into());
        }
        columns.push(SyncApiColumn {
            name: name.trim().to_string(),
            column_type: ty.to_string(),
        });
    }
    if columns.is_empty() {
        return Err("Schema must have at least one column".into());
    }
    Ok(SyncApiSchema { columns })
}

/// Parses a CLI-friendly row spec like `"elapsed=1.5,type=force"` into a
/// JSON object, best-effort coercing each value to a number or boolean
/// before falling back to a plain string — good enough for manual testing
/// via `nopal sync-api append-row`. Production callers (e.g. the
/// `record-load-cell` command) should build the JSON object directly
/// instead, so values keep their real types.
pub fn parse_row_spec(spec: &str) -> Result<serde_json::Value> {
    let mut map = serde_json::Map::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (key, value) = part
            .split_once('=')
            .ok_or_else(|| format!("Invalid row field '{part}' — expected key=value"))?;
        let value = value.trim();
        let json_value = if let Ok(n) = value.parse::<f64>() {
            json!(n)
        } else if value.eq_ignore_ascii_case("true") {
            json!(true)
        } else if value.eq_ignore_ascii_case("false") {
            json!(false)
        } else {
            json!(value)
        };
        map.insert(key.trim().to_string(), json_value);
    }
    Ok(serde_json::Value::Object(map))
}
