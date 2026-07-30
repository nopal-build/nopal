//! `nopal sync ...` — mirror local directories into a `syncs`-typed vault
//! folder (a project's own, or the Personal space's — see the vault
//! skill). The actual sync engine (device identity, target CRUD, the
//! push-only/two-way diff-and-apply logic) lives in `nopal_core::sync`
//! (shared with the native app's Sync tab) — this module is the CLI's
//! printing/confirmation wrapper over it.

use std::error::Error;
use std::path::Path;

use nopal_core::sync::{self, fetch_targets};
pub(crate) use nopal_core::sync::{device_id, run_device_targets, SyncTarget};
use nopal_core::vault::Client;

use crate::vault;

/// Register LOCAL_DIR as a sync target (creating a Syncs connector folder
/// inside `project`'s — or Personal's — Syncs folder) and push.
pub fn add(
    local_dir: &Path,
    name: Option<String>,
    preprocess: bool,
    two_way: bool,
    project: Option<String>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let (target, space) = sync::create_target(
        &client,
        local_dir,
        name,
        preprocess,
        two_way,
        project.as_deref(),
    )?;

    println!(
        "Registered '{}' — {} {} {}/syncs/{}/{}",
        target.name,
        target.local_path,
        if target.two_way { "<->" } else { "->" },
        space.name,
        target.name,
        if target.preprocess {
            " (videos optimized before upload)"
        } else {
            ""
        }
    );
    if target.two_way {
        println!(
            "  two-way: vault changes are pulled down; local deletions archive \
             the vault copy; vault deletions remove unchanged local files."
        );
    }

    // Initial push.
    sync::run_target(&client, &target, &mut |line| println!("{line}"))?;
    Ok(())
}

pub fn ls() -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let identity = sync::device_identity()?;
    let targets = fetch_targets(&client)?;
    if targets.is_empty() {
        println!("No sync targets. Add one with 'nopal sync add <dir>'.");
        return Ok(());
    }
    for t in targets {
        let here = if t.device_id == identity.device_id {
            ""
        } else {
            " (other device)"
        };
        println!(
            "{:<24} {:<40} {}{}last synced: {}{}",
            t.name,
            t.local_path,
            if t.two_way { "[two-way] " } else { "" },
            if t.preprocess { "[preprocess] " } else { "" },
            t.last_synced_at
                .as_deref()
                .map(|s| s.split('T').next().unwrap_or(s).to_string())
                .unwrap_or_else(|| "never".to_string()),
            if here.is_empty() {
                String::new()
            } else {
                format!("{here} [{}]", t.device_label)
            }
        );
    }
    Ok(())
}

pub fn rm(name: &str, keep_remote: bool, force: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let target = fetch_targets(&client)?
        .into_iter()
        .find(|t| t.name == name)
        .ok_or_else(|| format!("No sync target named '{name}'"))?;

    let prompt = if keep_remote {
        format!("Stop syncing '{name}' (vault copy is kept)? [y/N] ")
    } else {
        format!("Stop syncing '{name}' AND delete syncs/{name}/ from the vault? [y/N] ")
    };
    if !force && !vault::confirm(&prompt) {
        println!("Aborted.");
        return Ok(());
    }

    sync::remove_target(&client, &target, keep_remote)?;
    if keep_remote {
        println!("Removed '{name}' — syncs/{name}/ kept in the vault.");
    } else {
        println!("Removed '{name}' and deleted syncs/{name}/.");
    }
    Ok(())
}

/// Push local changes for one target (by name) or all targets on this device.
pub fn run(name: Option<String>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let identity = sync::device_identity()?;
    let targets = fetch_targets(&client)?;

    let selected: Vec<SyncTarget> = match &name {
        Some(n) => {
            let t = targets
                .into_iter()
                .find(|t| &t.name == n)
                .ok_or_else(|| format!("No sync target named '{n}'"))?;
            vec![t]
        }
        None => targets
            .into_iter()
            .filter(|t| t.device_id == identity.device_id)
            .collect(),
    };

    if selected.is_empty() {
        println!("No sync targets registered on this device.");
        return Ok(());
    }

    for target in &selected {
        if target.device_id != identity.device_id {
            return Err(format!(
                "'{}' belongs to another device ({}). One device per target — \
                 add this directory as its own target here.",
                target.name, target.device_label
            )
            .into());
        }
        sync::run_target(&client, target, &mut |line| println!("{line}"))?;
    }
    Ok(())
}
