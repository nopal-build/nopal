//! `nopal sync ...` — mirror local directories into the `syncs/` vault root.
//!
//! Phase B: one-way PUSH (local → vault). Nothing is ever deleted or pulled
//! from the vault; local is the source of truth. Change detection compares
//! local sha256 hashes against the server's `content_hash` via the
//! sync-manifest endpoint (one request per run).
//!
//! One device per target (enforced at registration): a second machine syncs
//! into its own target folder, which keeps this single-writer and
//! conflict-free by construction.

use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::vault::{self, Client, Folder};

/// Files/dirs skipped during scans: hidden entries and OS noise.
fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "Thumbs.db" || name == "desktop.ini"
}

// ─── Device identity ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct DeviceIdentity {
    device_id: String,
    device_label: String,
}

/// Stable per-machine identity, created on first use.
fn device_identity() -> Result<DeviceIdentity, Box<dyn Error>> {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let path = base.join("nopal").join("device.json");

    if let Ok(contents) = fs::read_to_string(&path) {
        if let Ok(id) = serde_json::from_str(&contents) {
            return Ok(id);
        }
    }

    let mut bytes = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut bytes);
    let identity = DeviceIdentity {
        device_id: bytes.iter().map(|b| format!("{b:02x}")).collect(),
        device_label: hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "unknown-device".to_string()),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(&identity)?)?;
    Ok(identity)
}

// ─── API types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
struct SyncTarget {
    _id: String,
    name: String,
    #[serde(rename = "folderId")]
    folder_id: String,
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "deviceLabel")]
    device_label: String,
    #[serde(rename = "localPath")]
    local_path: String,
    #[serde(rename = "lastSyncedAt")]
    last_synced_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestFolder {
    _id: String,
    name: String,
    parent_folder_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    _id: String,
    name: String,
    folder_id: Option<String>,
    content_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    folders: Vec<ManifestFolder>,
    files: Vec<ManifestFile>,
}

fn fetch_targets(client: &Client) -> Result<Vec<SyncTarget>, Box<dyn Error>> {
    let resp: serde_json::Value = client.get_json("/api/sync-targets")?;
    Ok(serde_json::from_value(resp["targets"].clone())?)
}

/// Finds the human's `syncs/` root container (provisioned server-side).
fn syncs_root(client: &Client) -> Result<Folder, Box<dyn Error>> {
    let children = client.children("root")?;
    children
        .folders
        .into_iter()
        .find(|f| f.vault_root_key.as_deref() == Some("syncs"))
        .ok_or_else(|| "No syncs/ root folder found — is the server up to date?".into())
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/// Register LOCAL_DIR as a sync target (creating syncs/<name>/) and push.
pub fn add(local_dir: &Path, name: Option<String>) -> Result<(), Box<dyn Error>> {
    let local_dir = local_dir
        .canonicalize()
        .map_err(|e| format!("{}: {e}", local_dir.display()))?;
    if !local_dir.is_dir() {
        return Err(format!("{} is not a directory", local_dir.display()).into());
    }

    let name = match name {
        Some(n) => n.trim().to_string(),
        None => local_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string(),
    };
    if name.is_empty() || name.contains('/') {
        return Err("Sync name must be a plain folder name (no '/')".into());
    }

    let client = Client::new()?;
    let identity = device_identity()?;

    // Refuse duplicate names up front for a clearer error than the server 409.
    if fetch_targets(&client)?.iter().any(|t| t.name == name) {
        return Err(format!(
            "A sync target named '{name}' already exists — pick another with --name"
        )
        .into());
    }

    let root = syncs_root(&client)?;
    if client
        .children(&root._id)?
        .folders
        .iter()
        .any(|f| f.name == name)
    {
        return Err(format!("syncs/{name}/ already exists in the vault").into());
    }

    let resp: serde_json::Value = client.post_json(
        "/api/vault/folders",
        &serde_json::json!({ "name": name, "parent_folder_id": root._id }),
    )?;
    let folder: Folder = serde_json::from_value(resp["folder"].clone())?;

    let resp: serde_json::Value = client.post_json(
        "/api/sync-targets",
        &serde_json::json!({
            "name": name,
            "folderId": folder._id,
            "deviceId": identity.device_id,
            "deviceLabel": identity.device_label,
            "localPath": local_dir.to_string_lossy(),
        }),
    )?;
    let target: SyncTarget = serde_json::from_value(resp["target"].clone())?;

    println!(
        "Registered '{}' — {} -> syncs/{}/",
        target.name,
        local_dir.display(),
        target.name
    );

    // Initial push
    run_target(&client, &target, &identity)
}

pub fn ls() -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let identity = device_identity()?;
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
            "{:<24} {:<40} last synced: {}{}",
            t.name,
            t.local_path,
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

pub fn rm(name: &str, keep_remote: bool, force: bool) -> Result<(), Box<dyn Error>> {
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

    let _: serde_json::Value = client.delete(&format!("/api/sync-targets/{}", target._id))?;
    if !keep_remote {
        let _: serde_json::Value =
            client.delete(&format!("/api/vault/folders/{}", target.folder_id))?;
        println!("Removed '{name}' and deleted syncs/{name}/.");
    } else {
        println!("Removed '{name}' — syncs/{name}/ kept in the vault.");
    }
    // The local directory is never touched.
    Ok(())
}

/// Push local changes for one target (by name) or all targets on this device.
pub fn run(name: Option<String>) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let identity = device_identity()?;
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
        run_target(&client, target, &identity)?;
    }
    Ok(())
}

// ─── The push engine ──────────────────────────────────────────────────────────

fn run_target(
    client: &Client,
    target: &SyncTarget,
    _identity: &DeviceIdentity,
) -> Result<(), Box<dyn Error>> {
    let local_root = PathBuf::from(&target.local_path);
    if !local_root.is_dir() {
        return Err(format!(
            "Local directory for '{}' not found: {}",
            target.name, target.local_path
        )
        .into());
    }

    println!("Syncing '{}' ({}) ...", target.name, target.local_path);

    // 1. Scan local: relative path -> absolute path, for every regular file.
    let mut local_files: Vec<(String, PathBuf)> = Vec::new();
    scan_dir(&local_root, "", &mut local_files)?;

    // 2. Remote state in one request.
    let manifest: Manifest = client.get_json(&format!(
        "/api/vault/sync-manifest?folderId={}",
        target.folder_id
    ))?;

    // Remote folders by relative dir path ("" = target root), and remote
    // files by relative file path.
    let mut folder_paths: HashMap<String, String> = HashMap::new(); // rel dir -> folder id
    folder_paths.insert(String::new(), target.folder_id.clone());
    let mut remaining: Vec<&ManifestFolder> = manifest.folders.iter().collect();
    // Parents always precede children given BFS manifest order, but don't
    // rely on it — loop until no progress.
    loop {
        let before = remaining.len();
        remaining.retain(|f| {
            let parent = f.parent_folder_id.clone().unwrap_or_default();
            let parent_rel = folder_paths
                .iter()
                .find(|(_, id)| **id == parent)
                .map(|(rel, _)| rel.clone());
            if let Some(parent_rel) = parent_rel {
                let rel = if parent_rel.is_empty() {
                    f.name.clone()
                } else {
                    format!("{parent_rel}/{}", f.name)
                };
                folder_paths.insert(rel, f._id.clone());
                false
            } else {
                true
            }
        });
        if remaining.is_empty() || remaining.len() == before {
            break;
        }
    }

    let id_to_rel: HashMap<String, String> = folder_paths
        .iter()
        .map(|(rel, id)| (id.clone(), rel.clone()))
        .collect();
    let mut remote_files: HashMap<String, &ManifestFile> = HashMap::new();
    for file in &manifest.files {
        let dir_rel = file
            .folder_id
            .as_ref()
            .and_then(|id| id_to_rel.get(id))
            .cloned()
            .unwrap_or_default();
        let rel = if dir_rel.is_empty() {
            file.name.clone()
        } else {
            format!("{dir_rel}/{}", file.name)
        };
        remote_files.insert(rel, file);
    }

    // 3. Diff + push.
    let (mut uploaded, mut replaced, mut unchanged) = (0u32, 0u32, 0u32);
    for (rel, abs) in &local_files {
        let local_hash = sha256_file(abs)?;
        match remote_files.get(rel) {
            Some(remote) if remote.content_hash.as_deref() == Some(local_hash.as_str()) => {
                unchanged += 1;
            }
            Some(remote) => {
                // Changed: replace in place (same file id).
                println!("  ~ {rel}");
                let form = reqwest::blocking::multipart::Form::new().file("file", abs)?;
                let _: serde_json::Value =
                    client.post_form(&format!("/api/vault/replace/{}", remote._id), form)?;
                replaced += 1;
            }
            None => {
                // New: ensure the folder chain exists, then upload.
                println!("  + {rel}");
                let dir_rel = match rel.rsplit_once('/') {
                    Some((dir, _)) => dir.to_string(),
                    None => String::new(),
                };
                let folder_id = ensure_remote_dir(client, target, &mut folder_paths, &dir_rel)?;
                let folder = Folder {
                    _id: folder_id,
                    name: dir_rel.clone(),
                    vault_root_key: Some("syncs".to_string()),
                    shared_with: serde_json::json!([]),
                    updated_at: String::new(),
                };
                vault::upload_one(client, abs, &folder)?;
                uploaded += 1;
            }
        }
    }

    // 4. Mark the run.
    let _: serde_json::Value = client.patch_json(
        &format!("/api/sync-targets/{}", target._id),
        &serde_json::json!({}),
    )?;

    println!(
        "  done: {uploaded} new, {replaced} updated, {unchanged} unchanged \
         ({} local file(s))",
        local_files.len()
    );
    if !remote_files.is_empty() {
        let local_set: std::collections::HashSet<&String> =
            local_files.iter().map(|(rel, _)| rel).collect();
        let remote_only = remote_files
            .keys()
            .filter(|rel| !local_set.contains(rel))
            .count();
        if remote_only > 0 {
            println!(
                "  note: {remote_only} vault file(s) have no local counterpart — \
                 push never deletes (two-way sync is a later phase)"
            );
        }
    }
    Ok(())
}

/// Recursively collects regular files as (relative path, absolute path).
fn scan_dir(
    dir: &Path,
    rel_prefix: &str,
    out: &mut Vec<(String, PathBuf)>,
) -> Result<(), Box<dyn Error>> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored(&name) {
            continue;
        }
        let path = entry.path();
        // symlink_metadata so symlinks are skipped rather than followed.
        let meta = fs::symlink_metadata(&path)?;
        let rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        if meta.is_dir() {
            scan_dir(&path, &rel, out)?;
        } else if meta.is_file() {
            out.push((rel, path));
        }
        // symlinks / other: skipped
    }
    Ok(())
}

/// Ensures `syncs/<target>/<dir_rel>` exists remotely, creating levels as
/// needed; returns its folder id and caches every level in `folder_paths`.
fn ensure_remote_dir(
    client: &Client,
    target: &SyncTarget,
    folder_paths: &mut HashMap<String, String>,
    dir_rel: &str,
) -> Result<String, Box<dyn Error>> {
    if let Some(id) = folder_paths.get(dir_rel) {
        return Ok(id.clone());
    }
    let mut parent_id = target.folder_id.clone();
    let mut built = String::new();
    for segment in dir_rel.split('/').filter(|s| !s.is_empty()) {
        built = if built.is_empty() {
            segment.to_string()
        } else {
            format!("{built}/{segment}")
        };
        if let Some(id) = folder_paths.get(&built) {
            parent_id = id.clone();
            continue;
        }
        let resp: serde_json::Value = client.post_json(
            "/api/vault/folders",
            &serde_json::json!({ "name": segment, "parent_folder_id": parent_id }),
        )?;
        let folder: Folder = serde_json::from_value(resp["folder"].clone())?;
        folder_paths.insert(built.clone(), folder._id.clone());
        parent_id = folder._id;
    }
    Ok(parent_id)
}

fn sha256_file(path: &Path) -> Result<String, Box<dyn Error>> {
    let mut file = fs::File::open(path)?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
