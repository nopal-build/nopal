//! `nopal camp ...` — Camps + Log Books, a journey of sequential
//! goal-posts ("a place we are headed to"), each with its own running
//! journal. See `garden/3-growing/camps-and-log-books.md` and
//! `robustness-core/data/camps.server.ts` (the one server-side module
//! that owns this shape).
//!
//! Unlike `nopal garden`, which reimplements its board-reading logic
//! directly over the generic `nopal vault` primitives, Camps' frontmatter
//! shape (focused-camp tracking, Observations-marks-complete, entry
//! date-vs-edited-date) is bespoke enough that this is a thin client over
//! dedicated JSON endpoints (`/api/vault/camps/...`) instead — same
//! shape as `nopal org`'s own `/api/org/holidays` client. Every camp and
//! log entry is still a REAL vault folder, so plain vault paths (e.g.
//! `projects/roadmap/Camps/camp-1`) resolve exactly like any other
//! `nopal vault` path — no separate ID bookkeeping needed here.

use std::error::Error;

use nopal_core::vault::{resolve_folder, resolve_with_ancestors, Client, Resolved};

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;

fn str_field<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn opt_str_field<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn bool_field(v: &serde_json::Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Truncates a one-line preview for list views — full text is always
/// available via `nopal camp show`.
fn preview(s: &str, max: usize) -> String {
    let s = s.trim().replace('\n', " ");
    if s.chars().count() <= max {
        return s;
    }
    let truncated: String = s.chars().take(max).collect();
    format!("{truncated}…")
}

fn camp_folder_id(client: &Client, path: &str) -> Result<String> {
    let folder = resolve_folder(client, path)?
        .ok_or_else(|| format!("'{path}' is the vault root, not a camp"))?;
    if folder.folder_type.as_deref() != Some("camp") || folder.is_folder_type_root == Some(true) {
        return Err(
            format!("'{path}' isn't a camp (expected a path like <anchor>/Camps/camp-1)").into(),
        );
    }
    Ok(folder._id)
}

/// Resolves `anchor` (a project, Personal, or an Organization root path)
/// to the folder id the `/api/vault/camps` endpoints expect — the vault
/// root itself isn't a valid anchor.
fn anchor_folder_id(client: &Client, anchor: &str) -> Result<String> {
    let folder = resolve_folder(client, anchor)?.ok_or_else(|| {
        "Provide an anchor — a project, 'personal', or an Organization path".to_string()
    })?;
    Ok(folder._id)
}

/// `nopal camp create <anchor> --statement "..." --target-arrival YYYY-MM-DD`
/// — creates the next sequential camp under `anchor`'s `Camps/` folder
/// (provisioning it on first use) and makes it the focused camp.
pub fn create(anchor: &str, statement: &str, target_arrival: &str) -> Result<()> {
    let client = Client::new()?;
    let anchor_id = anchor_folder_id(&client, anchor)?;

    let body = serde_json::json!({
        "anchorFolderId": anchor_id,
        "statement": statement,
        "targetArrival": target_arrival,
    });
    let resp: serde_json::Value = client.post_json("/api/vault/camps", &body)?;
    let folder = &resp["folder"];
    println!("Created {} under '{}'.", str_field(folder, "name"), anchor);
    Ok(())
}

/// `nopal camp list <anchor> [--json]` — every camp under `anchor`, in
/// sequence order.
pub fn list(anchor: &str, json: bool) -> Result<()> {
    let client = Client::new()?;
    let anchor_id = anchor_folder_id(&client, anchor)?;

    let resp: serde_json::Value =
        client.get_json(&format!("/api/vault/camps?anchor={anchor_id}"))?;

    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let empty = Vec::new();
    let camps = resp
        .get("camps")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    if camps.is_empty() {
        println!("No camps yet under '{anchor}'. Create one with 'nopal camp create'.");
        return Ok(());
    }
    for camp in camps {
        let name = str_field(&camp["folder"], "name");
        let statement = opt_str_field(camp, "statement").unwrap_or("(no statement)");
        let target_arrival = opt_str_field(camp, "targetArrival").unwrap_or("?");
        let status = if bool_field(camp, "completed") {
            "done"
        } else {
            "in progress"
        };
        println!("{name}  [{status}]  target: {target_arrival}");
        println!("  {}", preview(statement, 100));
    }
    Ok(())
}

/// `nopal camp show <camp> [--json]` — one camp's statement, target
/// arrival, main content, and Observations (if recorded).
pub fn show(camp: &str, json: bool) -> Result<()> {
    let client = Client::new()?;
    let camp_id = camp_folder_id(&client, camp)?;

    let resp: serde_json::Value = client.get_json(&format!("/api/vault/camps/{camp_id}"))?;
    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let c = &resp["camp"];
    println!("=== {} ===", str_field(&c["folder"], "name"));
    println!(
        "Statement: {}",
        opt_str_field(c, "statement").unwrap_or("(none)")
    );
    println!(
        "Target arrival: {}",
        opt_str_field(c, "targetArrival").unwrap_or("?")
    );
    println!(
        "Status: {}",
        if bool_field(c, "completed") {
            "done"
        } else {
            "in progress"
        }
    );
    if let Some(obs) = c.get("observations").filter(|o| !o.is_null()) {
        println!("\n--- Observations ---");
        println!(
            "Statement: {}",
            opt_str_field(obs, "statement").unwrap_or("(none)")
        );
        println!(
            "Arrival date: {}",
            opt_str_field(obs, "arrivalDate").unwrap_or("?")
        );
    }
    let body = opt_str_field(c, "body").unwrap_or("").trim();
    if !body.is_empty() {
        println!("\n--- Content ---");
        println!("{body}");
    }
    Ok(())
}

/// `nopal camp observe <camp> --statement "..." --arrival-date YYYY-MM-DD`
/// — records (or replaces) the camp's `OBSERVATIONS.md`, the one and
/// only thing that marks it complete.
pub fn observe(camp: &str, statement: &str, arrival_date: &str) -> Result<()> {
    let client = Client::new()?;
    let camp_id = camp_folder_id(&client, camp)?;

    let body = serde_json::json!({ "statement": statement, "arrivalDate": arrival_date });
    let _: serde_json::Value =
        client.post_json(&format!("/api/vault/camps/{camp_id}/observations"), &body)?;
    println!("Recorded Observations for '{camp}' — camp marked complete.");
    Ok(())
}

/// `nopal camp log add <camp> --statement "..." [--entry-date YYYY-MM-DD]`
/// — creates the next sequential log entry, provisioning the camp's
/// `Log/` folder on first use.
pub fn log_add(camp: &str, statement: &str, entry_date: Option<&str>) -> Result<()> {
    let client = Client::new()?;
    let camp_id = camp_folder_id(&client, camp)?;

    let mut body = serde_json::json!({ "statement": statement });
    if let Some(d) = entry_date {
        body["entryDate"] = serde_json::Value::String(d.to_string());
    }
    let resp: serde_json::Value =
        client.post_json(&format!("/api/vault/camps/{camp_id}/log/entries"), &body)?;
    let folder = &resp["folder"];
    println!("Added log entry {} to '{camp}'.", str_field(folder, "name"));
    Ok(())
}

/// `nopal camp log list <camp> [--json]` — every entry in the camp's log
/// book, oldest-first.
pub fn log_list(camp: &str, json: bool) -> Result<()> {
    let client = Client::new()?;
    let camp_id = camp_folder_id(&client, camp)?;

    let resp: serde_json::Value =
        client.get_json(&format!("/api/vault/camps/{camp_id}/log/entries"))?;
    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let empty = Vec::new();
    let entries = resp
        .get("entries")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    if entries.is_empty() {
        println!("No log entries yet for '{camp}'. Add one with 'nopal camp log add'.");
        return Ok(());
    }
    for entry in entries {
        let name = str_field(&entry["folder"], "name");
        let statement = opt_str_field(entry, "statement").unwrap_or("(no statement)");
        let entry_date = opt_str_field(entry, "entryDate").unwrap_or("?");
        println!("{name}  ({entry_date})");
        println!("  {}", preview(statement, 100));
    }
    Ok(())
}

/// `nopal camp log show <entry> [--json]` — one log entry's statement,
/// dates, content, and asset file names. `<entry>` is a full vault path,
/// e.g. `projects/roadmap/Camps/camp-1/Log/entry-1`.
pub fn log_show(entry: &str, json: bool) -> Result<()> {
    let client = Client::new()?;
    let (ancestors, resolved) = resolve_with_ancestors(&client, entry)?;
    let folder = match resolved {
        Resolved::Folder(f) => f,
        _ => return Err(format!("'{entry}' is the vault root, not a log entry").into()),
    };
    if folder.folder_type.as_deref() != Some("log-book") || folder.is_folder_type_root == Some(true)
    {
        return Err(format!(
            "'{entry}' isn't a log entry (expected a path like <camp>/Log/entry-1)"
        )
        .into());
    }
    // The route's `:campFolderId` segment is never actually read server-side
    // (the entry's own id is enough to look it up) — still, prefer the real
    // owning camp's id over a placeholder when the ancestor chain has one.
    let camp_id = ancestors
        .iter()
        .rev()
        .find(|f| f.folder_type.as_deref() == Some("camp") && f.is_folder_type_root != Some(true))
        .map(|f| f._id.clone())
        .unwrap_or_else(|| folder._id.clone());

    let resp: serde_json::Value = client.get_json(&format!(
        "/api/vault/camps/{camp_id}/log/entries/{}",
        folder._id
    ))?;
    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let e = &resp["entry"];
    println!("=== {} ===", str_field(&e["folder"], "name"));
    println!(
        "Statement: {}",
        opt_str_field(e, "statement").unwrap_or("(none)")
    );
    println!(
        "Entry date: {}",
        opt_str_field(e, "entryDate").unwrap_or("?")
    );
    println!("Edited: {}", opt_str_field(e, "editedDate").unwrap_or("?"));
    let body = opt_str_field(e, "body").unwrap_or("").trim();
    if !body.is_empty() {
        println!("\n--- Content ---");
        println!("{body}");
    }
    let empty = Vec::new();
    let assets = e.get("assets").and_then(|v| v.as_array()).unwrap_or(&empty);
    if !assets.is_empty() {
        println!("\n--- Assets ---");
        for a in assets {
            println!("  {}", str_field(a, "name"));
        }
    }
    Ok(())
}
