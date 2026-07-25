//! `nopal sort ...` — trigger the daily-log Sorter for your own account.
//!
//! Thin client over `POST /api/daily-log/sort` — the same authenticated
//! endpoint the web app's own once-a-day cron calls for every human (see
//! the `sorter.server.ts`/`api.daily-log.sort-all.tsx` doc comments). All
//! real logic (mentions → project backlinks, completed Card tasks, Card
//! file attachments → Release Log entries) lives server-side; this just
//! surfaces the result.

use serde::Deserialize;
use std::error::Error;

use crate::vault::Client;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SortSummary {
    date: String,
    #[serde(default)]
    already_sorted: bool,
    #[serde(default)]
    projects_touched: Vec<String>,
    #[serde(default)]
    entries_written: u32,
}

/// Runs the Sorter for `date` (YYYY-MM-DD; server defaults to yesterday
/// in UTC when omitted).
pub fn run(date: Option<String>, force: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;

    let mut body = serde_json::json!({ "force": force });
    if let Some(d) = &date {
        body["date"] = serde_json::Value::String(d.clone());
    }

    let summary: SortSummary = client.post_json("/api/daily-log/sort", &body)?;

    if summary.already_sorted {
        println!(
            "{} was already sorted — pass --force to re-run.",
            summary.date
        );
        return Ok(());
    }

    if summary.entries_written == 0 {
        println!(
            "{}: nothing to sort (no @mentions of a project, completed Card tasks, or Card file attachments found).",
            summary.date
        );
        return Ok(());
    }

    println!(
        "{}: wrote {} release-log entr{} across {} project{}.",
        summary.date,
        summary.entries_written,
        if summary.entries_written == 1 {
            "y"
        } else {
            "ies"
        },
        summary.projects_touched.len(),
        if summary.projects_touched.len() == 1 {
            ""
        } else {
            "s"
        },
    );
    for project in &summary.projects_touched {
        println!("  - {project}");
    }

    Ok(())
}
