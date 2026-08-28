//! `nopal release-log ...` — manage structured Release Log entries.
//!
//! Thin client over `POST /api/release-log/:entryId/revert` — all real
//! logic (undoing a changeset, then replaying every later entry that
//! touched the same file) lives server-side, see `releaseLog.server.ts`'s
//! module doc. Deliberately not surfaced anywhere in the web UI yet — this
//! CLI command is the only way to actually trigger a revert today.

use serde::Deserialize;
use std::error::Error;

use crate::vault::Client;

#[derive(Debug, Deserialize)]
struct RevertResponse {
    #[serde(default)]
    success: bool,
}

/// Reverts one Release Log entry by id. Only entries that changed a
/// project file (not a plain @mention backlink or a completed task) can
/// be reverted — the server rejects anything else with a clear error.
pub fn revert(entry_id: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let path = format!("/api/release-log/{entry_id}/revert");
    let response: RevertResponse = client.post_json(&path, &serde_json::json!({}))?;

    if response.success {
        println!("Reverted release log entry {entry_id}.");
    } else {
        println!("Revert request completed, but the server didn't confirm success.");
    }
    Ok(())
}
