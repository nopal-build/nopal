//! `nopal org ...` — direct read access to the Organization's observed
//! holidays (`organizations.server.ts`'s `holidays`, edited at the
//! `/org` web page). Office hours used to live here too, org-wide —
//! superseded 2026-11-03: each Human now sets their own weekly
//! availability ("professor's hours") on their own Profile page instead
//! (`humans.server.ts`'s `availability`) — not yet exposed over the CLI.
//!
//! Thin client over `GET /api/org/holidays` (Admin/Super, or a Human
//! who's specifically a Guide on the Organization — same gate as the
//! `/org` page itself; needs a login with that role, see `nopal login`).
//! `--json` prints the server's own JSON response verbatim, same
//! convention as `nopal perf`'s own `--json`.

use std::error::Error;

use crate::vault::Client;

fn str_field<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// `nopal org holidays [--json]` — every date the Organization observes
/// and is closed for, each shown as its own date or, for a multi-day
/// holiday, a range.
pub fn holidays(json: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let resp: serde_json::Value = client.get_json("/api/org/holidays")?;

    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let org_name = str_field(&resp, "organizationName");
    let org_name = if org_name.is_empty() { "Org" } else { org_name };
    println!("=== {org_name} Organization — holidays observed ===");

    let empty = Vec::new();
    let holidays = resp
        .get("holidays")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    if holidays.is_empty() {
        println!("No holidays observed yet.");
    } else {
        for h in holidays {
            let date = str_field(h, "date");
            let end_date = str_field(h, "endDate");
            let name = str_field(h, "name");
            if !end_date.is_empty() && end_date != date {
                println!("  {date} – {end_date}  {name}");
            } else {
                println!("  {date}  {name}");
            }
        }
    }
    Ok(())
}
