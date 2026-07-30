//! Vault folder sync: mirrors a local directory into a `syncs`-typed vault
//! folder (a project's own, or the Personal space's — see the `vault`
//! skill). Shared by the CLI's `nopal sync ...` commands, its background
//! watcher, and the native app's Sync tab.
//!
//! One-way PUSH: local is truth, the vault never loses a file. Two-way:
//! a three-way diff (local / last-synced state / remote) that can also
//! pull remote changes down and reflect deletions either direction — see
//! `run_two_way`'s own comment for the full decision table.
//!
//! One device per target (enforced at registration): a second machine
//! syncs into its own target folder, which keeps this single-writer and
//! conflict-free by construction.
//!
//! No printing here — every step reports through the `log` callback so a
//! terminal (`println!`) and a GUI (append to an on-screen log) can share
//! the exact same engine.

use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::vault::{self, Client, Folder};
use crate::video;
use crate::Result;

/// Files/dirs skipped during scans: hidden entries and OS noise.
fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name == "Thumbs.db" || name == "desktop.ini"
}

// ─── Device identity ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub device_label: String,
}

/// Stable per-machine identity, created on first use.
pub fn device_identity() -> Result<DeviceIdentity> {
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

pub fn device_id() -> Result<String> {
    Ok(device_identity()?.device_id)
}

// ─── API types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct SyncTarget {
    pub _id: String,
    pub name: String,
    #[serde(rename = "folderId")]
    pub folder_id: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "deviceLabel")]
    pub device_label: String,
    #[serde(rename = "localPath")]
    pub local_path: String,
    #[serde(default)]
    pub preprocess: bool,
    #[serde(rename = "twoWay", default)]
    pub two_way: bool,
    #[serde(rename = "lastSyncedAt")]
    pub last_synced_at: Option<String>,
}

/// Raw video extensions eligible for `preprocess` optimization. Prepped
/// outputs (`*.web.mp4`) are recognized and never re-prepped.
const RAW_VIDEO_EXTS: [&str; 5] = ["mov", "mp4", "m4v", "avi", "mkv"];

fn is_prepped_video(rel: &str) -> bool {
    rel.to_lowercase().ends_with(".web.mp4")
}

fn is_raw_video(rel: &str) -> bool {
    if is_prepped_video(rel) {
        return false;
    }
    let lower = rel.to_lowercase();
    RAW_VIDEO_EXTS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// The sibling path video preprocessing writes for an input: `<stem>.web.mp4`.
fn prepped_sibling(abs: &Path) -> PathBuf {
    let stem = abs.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    abs.with_file_name(format!("{stem}.web.mp4"))
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
    #[serde(default)]
    has_s3: bool,
}

/// Owned remote-side view of one file, keyed by relative path.
struct RemoteEntry {
    file_id: String,
    hash: Option<String>,
    has_s3: bool,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    folders: Vec<ManifestFolder>,
    files: Vec<ManifestFile>,
}

pub fn fetch_targets(client: &Client) -> Result<Vec<SyncTarget>> {
    let resp: serde_json::Value = client.get_json("/api/sync-targets")?;
    Ok(serde_json::from_value(resp["targets"].clone())?)
}

/// Resolves the "space" a sync target belongs to: a named project folder
/// (`projects/<name>`), or the Personal space when no project is given.
/// Every project (and Personal) has its OWN `syncs`-typed folder — see the
/// vault skill.
pub fn resolve_space(client: &Client, project: Option<&str>) -> Result<Folder> {
    match project {
        Some(name) => vault::resolve_folder(client, &format!("projects/{name}"))?.ok_or_else(|| {
            format!(
                "No project named '{name}' — create it first (e.g. `nopal vault mkdir projects/{name}`)"
            )
            .into()
        }),
        None => {
            let children = client.children("root")?;
            children
                .folders
                .into_iter()
                .find(|f| f.vault_root_key.as_deref() == Some("personal"))
                .ok_or_else(|| "No personal/ root folder found — is the server up to date?".into())
        }
    }
}

/// Finds `space`'s `syncs`-typed folder, creating it if missing (each
/// project, and Personal, gets its own — see the vault skill).
pub fn syncs_folder(client: &Client, space: &Folder) -> Result<Folder> {
    let children = client.children(&space._id)?;
    if let Some(folder) = children
        .folders
        .into_iter()
        .find(|f| f.folder_type.as_deref() == Some("syncs"))
    {
        return Ok(folder);
    }

    let resp: serde_json::Value = client.post_json(
        "/api/vault/folders",
        &serde_json::json!({
            "name": "syncs",
            "parent_folder_id": space._id,
            "folder_type": "syncs",
        }),
    )?;
    Ok(serde_json::from_value(resp["folder"].clone())?)
}

// ─── Target management (create / list / remove) ─────────────────────────

/// Registers `local_dir` as a new sync target: creates its connector folder
/// inside the resolved space's `syncs` folder, then registers it with the
/// server. Does NOT perform the initial push — call `run_target`
/// afterwards if that's wanted (the CLI does; a GUI might want to show the
/// new target first and let a spinner cover the push separately).
pub fn create_target(
    client: &Client,
    local_dir: &Path,
    name: Option<String>,
    preprocess: bool,
    two_way: bool,
    project: Option<&str>,
) -> Result<(SyncTarget, Folder)> {
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

    let identity = device_identity()?;

    // Refuse duplicate names up front for a clearer error than the server 409.
    if fetch_targets(client)?.iter().any(|t| t.name == name) {
        return Err(
            format!("A sync target named '{name}' already exists — pick another name").into(),
        );
    }

    let space = resolve_space(client, project)?;
    let syncs = syncs_folder(client, &space)?;
    if client
        .children(&syncs._id)?
        .folders
        .iter()
        .any(|f| f.name == name)
    {
        return Err(format!("{}/syncs/{name}/ already exists in the vault", space.name).into());
    }

    let resp: serde_json::Value = client.post_json(
        "/api/vault/folders",
        &serde_json::json!({
            "name": name,
            "parent_folder_id": syncs._id,
            "folder_type": if two_way { "sync-two-way" } else { "sync-one-way" },
        }),
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
            "preprocess": preprocess,
            "twoWay": two_way,
        }),
    )?;
    let target: SyncTarget = serde_json::from_value(resp["target"].clone())?;
    Ok((target, space))
}

/// Unregisters a sync target. `keep_remote` leaves its vault folder (and
/// contents) in place; otherwise it's deleted along with the target. The
/// local directory is never touched either way.
pub fn remove_target(client: &Client, target: &SyncTarget, keep_remote: bool) -> Result<()> {
    let _: serde_json::Value = client.delete(&format!("/api/sync-targets/{}", target._id))?;
    let _ = fs::remove_file(state_file_path(&target._id));
    if !keep_remote {
        let _: serde_json::Value =
            client.delete(&format!("/api/vault/folders/{}", target.folder_id))?;
    }
    Ok(())
}

/// One resilient pass over every target on this device — used by the CLI's
/// `nopal sync run` (no name given) and its background watcher. Individual
/// target failures are reported in the returned error list but don't stop
/// the others. Returns (target local paths, errors).
pub fn run_device_targets(
    client: &Client,
    device_id: &str,
    log: &mut dyn FnMut(&str),
) -> Result<(Vec<PathBuf>, Vec<String>)> {
    let targets: Vec<SyncTarget> = fetch_targets(client)?
        .into_iter()
        .filter(|t| t.device_id == device_id)
        .collect();

    let mut paths = Vec::new();
    let mut errors = Vec::new();
    for target in &targets {
        if let Err(e) = run_target(client, target, log) {
            errors.push(format!("{}: {e}", target.name));
        }
        // Watch the directory either way — a transient failure shouldn't
        // stop us noticing future changes.
        paths.push(PathBuf::from(&target.local_path));
    }
    Ok((paths, errors))
}

// ─── The sync engine ──────────────────────────────────────────────────────

/// What a completed `run_target` did, in the shape matching whichever
/// engine (push-only or two-way) actually ran.
#[derive(Debug, Clone)]
pub enum RunSummary {
    PushOnly {
        uploaded: u32,
        replaced: u32,
        unchanged: u32,
        total_local: usize,
        remote_only: usize,
    },
    TwoWay {
        pushed: u32,
        pulled: u32,
        unchanged: u32,
        archived: u32,
        deleted_local: u32,
        conflicts: u32,
    },
}

impl RunSummary {
    /// One-line human summary, same wording the CLI has always printed.
    pub fn summary_line(&self) -> String {
        match self {
            RunSummary::PushOnly {
                uploaded,
                replaced,
                unchanged,
                total_local,
                remote_only,
            } => {
                let mut line = format!(
                    "done: {uploaded} new, {replaced} updated, {unchanged} unchanged ({total_local} local file(s))"
                );
                if *remote_only > 0 {
                    line.push_str(&format!(
                        " — note: {remote_only} vault file(s) have no local counterpart \
                         (push-only sync never deletes; use two-way to pull)"
                    ));
                }
                line
            }
            RunSummary::TwoWay {
                pushed,
                pulled,
                unchanged,
                archived,
                deleted_local,
                conflicts,
            } => format!(
                "done: {pushed} pushed, {pulled} pulled, {unchanged} unchanged, \
                 {archived} archived, {deleted_local} deleted locally, {conflicts} conflict(s)"
            ),
        }
    }
}

/// Runs one sync target: scans local files, fetches the remote manifest,
/// diffs, and applies (push-only or two-way, per `target.two_way`).
pub fn run_target(
    client: &Client,
    target: &SyncTarget,
    log: &mut dyn FnMut(&str),
) -> Result<RunSummary> {
    let local_root = PathBuf::from(&target.local_path);
    if !local_root.is_dir() {
        return Err(format!(
            "Local directory for '{}' not found: {}",
            target.name, target.local_path
        )
        .into());
    }

    log(&format!(
        "Syncing '{}' ({}) ...",
        target.name, target.local_path
    ));

    // 1. Scan local: relative path -> absolute path, for every regular file.
    let mut local_files: Vec<(String, PathBuf)> = Vec::new();
    scan_dir(&local_root, "", &mut local_files)?;

    // 1b. Preprocess: raw videos are optimized into a `.web.mp4` sibling
    // (once — existing siblings are reused) and the SIBLING is what syncs;
    // the raw recording never uploads. Because the prepped file is a real
    // local file, hash diffing stays consistent across runs.
    if target.preprocess {
        let mut prepped: Vec<(String, PathBuf)> = Vec::new();
        for (rel, abs) in &local_files {
            if !is_raw_video(rel) {
                continue;
            }
            let sibling = prepped_sibling(abs);
            if !sibling.exists() {
                log(&format!("  \u{25b6} optimizing {rel}"));
                video::prep(
                    abs,
                    video::PrepOptions {
                        output: Some(sibling.clone()),
                        crf: 23,
                        max_height: 1080,
                        preset: "medium".to_string(),
                        overwrite: false,
                    },
                    log,
                )?;
                let sibling_rel = match rel.rsplit_once('/') {
                    Some((dir, _)) => format!(
                        "{dir}/{}",
                        sibling.file_name().unwrap_or_default().to_string_lossy()
                    ),
                    None => sibling
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                };
                prepped.push((sibling_rel, sibling));
            }
        }
        // Newly-created siblings weren't in the scan — add them; then drop
        // every raw video from the push list.
        local_files.extend(prepped);
        local_files.retain(|(rel, _)| !is_raw_video(rel));
        local_files.sort();
        local_files.dedup_by(|a, b| a.0 == b.0);
    }

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
    let mut remote_files: HashMap<String, RemoteEntry> = HashMap::new();
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
        // With preprocess on, raw videos are unmanaged on BOTH sides — a raw
        // recording uploaded via the web is left alone rather than pulled
        // down and re-pushed.
        if target.preprocess && is_raw_video(&rel) {
            continue;
        }
        remote_files.insert(
            rel,
            RemoteEntry {
                file_id: file._id.clone(),
                hash: file.content_hash.clone(),
                has_s3: file.has_s3,
            },
        );
    }

    // 3. Diff + apply.
    let summary = if target.two_way {
        run_two_way(
            client,
            target,
            &local_root,
            &local_files,
            &remote_files,
            &mut folder_paths,
            log,
        )?
    } else {
        run_push_only(
            client,
            target,
            &local_files,
            &remote_files,
            &mut folder_paths,
            log,
        )?
    };
    log(&format!("  {}", summary.summary_line()));

    // 4. Mark the run.
    let _: serde_json::Value = client.patch_json(
        &format!("/api/sync-targets/{}", target._id),
        &serde_json::json!({}),
    )?;
    Ok(summary)
}

/// The original push-only engine: local is truth, the vault never loses a
/// file, no state needed.
fn run_push_only(
    client: &Client,
    target: &SyncTarget,
    local_files: &[(String, PathBuf)],
    remote_files: &HashMap<String, RemoteEntry>,
    folder_paths: &mut HashMap<String, String>,
    log: &mut dyn FnMut(&str),
) -> Result<RunSummary> {
    let (mut uploaded, mut replaced, mut unchanged) = (0u32, 0u32, 0u32);
    for (rel, abs) in local_files {
        let local_hash = sha256_file(abs)?;
        match remote_files.get(rel) {
            Some(remote) if remote.hash.as_deref() == Some(local_hash.as_str()) => {
                unchanged += 1;
            }
            Some(remote) => {
                log(&format!("  ~ {rel}"));
                replace_remote(client, &remote.file_id, abs)?;
                replaced += 1;
            }
            None => {
                log(&format!("  + {rel}"));
                push_new(client, target, folder_paths, rel, abs, log)?;
                uploaded += 1;
            }
        }
    }

    let local_set: std::collections::HashSet<&String> =
        local_files.iter().map(|(rel, _)| rel).collect();
    let remote_only = remote_files
        .keys()
        .filter(|rel| !local_set.contains(rel))
        .count();

    Ok(RunSummary::PushOnly {
        uploaded,
        replaced,
        unchanged,
        total_local: local_files.len(),
        remote_only,
    })
}

// ─── Two-way engine ──────────────────────────────────────────────────────
//
// Three-way diff per path: local now (L) vs last-synced state (S) vs remote
// now (R). The state file is this device's memory of "what both sides agreed
// on last time" — without it, a missing file is ambiguous (never-synced vs
// deleted).
//
//   L==R                      → in sync (adopt into state)
//   L!=R, S==L                → remote changed  → pull
//   L!=R, S==R                → local changed   → push (replace)
//   L!=R, S neither/absent    → conflict        → save remote copy, local wins
//   L only, S absent          → new local       → push (upload)
//   L only, S==L              → remote deleted  → delete local
//   L only, S!=L              → remote deleted but local changed → re-upload
//   R only, S absent          → new remote      → pull
//   R only, S==R              → local deleted   → archive remote
//   R only, S!=R              → local deleted but remote changed → pull
//
// Remote hash null (legacy/web-multipart files) can't signal remote change:
// those files only push when local differs from state.

#[allow(clippy::too_many_arguments)]
fn run_two_way(
    client: &Client,
    target: &SyncTarget,
    local_root: &Path,
    local_files: &[(String, PathBuf)],
    remote_files: &HashMap<String, RemoteEntry>,
    folder_paths: &mut HashMap<String, String>,
    log: &mut dyn FnMut(&str),
) -> Result<RunSummary> {
    let mut state = load_state(&target._id);
    let local_map: HashMap<&String, &PathBuf> =
        local_files.iter().map(|(rel, abs)| (rel, abs)).collect();

    // Union of every path any side knows about.
    let mut all_rels: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    all_rels.extend(local_files.iter().map(|(rel, _)| rel.clone()));
    all_rels.extend(remote_files.keys().cloned());
    all_rels.extend(state.files.keys().cloned());

    let (mut pushed, mut pulled, mut unchanged, mut archived, mut deleted_local, mut conflicts) =
        (0u32, 0u32, 0u32, 0u32, 0u32, 0u32);

    for rel in all_rels {
        let local_abs = local_map.get(&rel).cloned();
        let remote = remote_files.get(&rel);
        let state_entry = state.files.get(&rel).cloned();

        match (local_abs, remote) {
            // ── Present on both sides ────────────────────────────────────
            (Some(abs), Some(remote)) => {
                let l = sha256_file(abs)?;
                match &remote.hash {
                    Some(r) if *r == l => {
                        unchanged += 1;
                        state.files.insert(
                            rel.clone(),
                            StateEntry {
                                hash: l,
                                file_id: remote.file_id.clone(),
                            },
                        );
                    }
                    Some(r) => {
                        let s = state_entry.as_ref().map(|e| e.hash.as_str());
                        if s == Some(l.as_str()) {
                            // Local unchanged since last sync → remote changed.
                            log(&format!("  \u{2193} {rel}"));
                            let new_hash = pull_file(client, remote, abs)?;
                            state.files.insert(
                                rel.clone(),
                                StateEntry {
                                    hash: new_hash,
                                    file_id: remote.file_id.clone(),
                                },
                            );
                            pulled += 1;
                        } else if s == Some(r.as_str()) {
                            // Remote unchanged since last sync → local changed.
                            log(&format!("  \u{2191} {rel}"));
                            replace_remote(client, &remote.file_id, abs)?;
                            state.files.insert(
                                rel.clone(),
                                StateEntry {
                                    hash: l,
                                    file_id: remote.file_id.clone(),
                                },
                            );
                            pushed += 1;
                        } else {
                            // Both changed (or first two-way run on diverged
                            // content): preserve the remote copy locally,
                            // then local wins.
                            let conflict_rel = conflict_rel_name(&rel);
                            log(&format!(
                                "  ! {rel} \u{2014} conflict; remote saved as {conflict_rel}"
                            ));
                            let conflict_abs = local_root.join(&conflict_rel);
                            pull_file(client, remote, &conflict_abs)?;
                            replace_remote(client, &remote.file_id, abs)?;
                            state.files.insert(
                                rel.clone(),
                                StateEntry {
                                    hash: l,
                                    file_id: remote.file_id.clone(),
                                },
                            );
                            conflicts += 1;
                        }
                    }
                    None => {
                        // No remote hash to compare — push only if local
                        // moved since last sync; replacing sets the hash.
                        if state_entry.as_ref().map(|e| e.hash.as_str()) != Some(l.as_str()) {
                            log(&format!("  \u{2191} {rel}"));
                            replace_remote(client, &remote.file_id, abs)?;
                            pushed += 1;
                        } else {
                            unchanged += 1;
                        }
                        state.files.insert(
                            rel.clone(),
                            StateEntry {
                                hash: l,
                                file_id: remote.file_id.clone(),
                            },
                        );
                    }
                }
            }

            // ── Local only ─────────────────────────────────────────────────
            (Some(abs), None) => {
                let l = sha256_file(abs)?;
                match state_entry {
                    Some(entry) if entry.hash == l => {
                        // Was synced, unchanged locally, gone remotely → the
                        // deletion happened in the vault; honor it.
                        log(&format!("  \u{2717} {rel} (deleted in vault)"));
                        fs::remove_file(abs)?;
                        state.files.remove(&rel);
                        deleted_local += 1;
                    }
                    _ => {
                        // Never synced, or changed since — (re-)upload.
                        log(&format!("  + {rel}"));
                        let file_id = push_new(client, target, folder_paths, &rel, abs, log)?;
                        state
                            .files
                            .insert(rel.clone(), StateEntry { hash: l, file_id });
                        pushed += 1;
                    }
                }
            }

            // ── Remote only ───────────────────────────────────────────────
            (None, Some(remote)) => {
                match &state_entry {
                    Some(entry)
                        if remote.hash.is_none()
                            || remote.hash.as_deref() == Some(entry.hash.as_str()) =>
                    {
                        // Was synced, unchanged remotely, gone locally → the
                        // deletion happened here; archive in the vault
                        // (recoverable) rather than hard-deleting.
                        log(&format!(
                            "  \u{2717} {rel} (archived in vault \u{2014} deleted locally)"
                        ));
                        archive_remote(client, &remote.file_id)?;
                        state.files.remove(&rel);
                        archived += 1;
                    }
                    _ => {
                        // New remote file — or deleted locally but changed
                        // remotely since (remote wins; nothing local to lose).
                        log(&format!("  \u{2193} {rel}"));
                        let abs = local_root.join(&rel);
                        let new_hash = pull_file(client, remote, &abs)?;
                        state.files.insert(
                            rel.clone(),
                            StateEntry {
                                hash: new_hash,
                                file_id: remote.file_id.clone(),
                            },
                        );
                        pulled += 1;
                    }
                }
            }

            // ── In state only: both sides gone — forget it ───────────────────
            (None, None) => {
                state.files.remove(&rel);
            }
        }
    }

    save_state(&target._id, &state)?;

    Ok(RunSummary::TwoWay {
        pushed,
        pulled,
        unchanged,
        archived,
        deleted_local,
        conflicts,
    })
}

// ─── Shared apply helpers ─────────────────────────────────────────────────

/// Upload a brand-new file, creating remote folders as needed. Returns the
/// new file_ref id.
fn push_new(
    client: &Client,
    target: &SyncTarget,
    folder_paths: &mut HashMap<String, String>,
    rel: &str,
    abs: &Path,
    log: &mut dyn FnMut(&str),
) -> Result<String> {
    let dir_rel = match rel.rsplit_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => String::new(),
    };
    let folder_id = ensure_remote_dir(client, target, folder_paths, &dir_rel)?;
    let folder = Folder {
        _id: folder_id,
        name: if dir_rel.is_empty() {
            target.name.clone()
        } else {
            dir_rel.clone()
        },
        vault_root_key: None,
        folder_type: None,
        shared_with: vec![],
        is_public: None,
        updated_at: String::new(),
    };
    let uploaded = vault::upload_file(client, abs, &folder, |progress| {
        let vault::UploadProgress::Part {
            part_number,
            total_parts,
        } = progress;
        log(&format!("    part {part_number}/{total_parts}"));
    })?;
    Ok(uploaded.file_id)
}

fn replace_remote(client: &Client, file_id: &str, abs: &Path) -> Result<()> {
    let _: serde_json::Value = client
        .post_form(&format!("/api/vault/replace/{file_id}"), || {
            Ok(reqwest::blocking::multipart::Form::new().file("file", abs)?)
        })?;
    Ok(())
}

/// Archive (not delete) a vault file — recoverable for ~30 days via the
/// existing archive cleanup.
fn archive_remote(client: &Client, file_id: &str) -> Result<()> {
    let now = jiff::Timestamp::now().to_string();
    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/{file_id}"),
        &serde_json::json!({ "archived_at": now }),
    )?;
    Ok(())
}

/// Download a remote file to `abs` (temp file + rename, parents created).
/// Returns the sha256 of what was written.
fn pull_file(client: &Client, remote: &RemoteEntry, abs: &Path) -> Result<String> {
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = abs.with_file_name(format!(
        ".{}.nopal-tmp",
        abs.file_name().unwrap_or_default().to_string_lossy()
    ));

    if remote.has_s3 {
        let resp: serde_json::Value =
            client.get_json(&format!("/api/vault/download/{}", remote.file_id))?;
        let url = resp["url"]
            .as_str()
            .ok_or("Server did not return a download URL")?;
        let mut s3_resp = reqwest::blocking::get(url)?;
        if !s3_resp.status().is_success() {
            return Err(format!("Download failed ({})", s3_resp.status()).into());
        }
        let mut file = fs::File::create(&tmp)?;
        s3_resp.copy_to(&mut file)?;
    } else {
        // Inline content (e.g. a markdown card created in the web UI).
        let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", remote.file_id))?;
        let content = resp["file"]["content"]
            .as_str()
            .ok_or("Remote file has no downloadable content")?
            .to_string();
        fs::write(&tmp, content)?;
    }

    fs::rename(&tmp, abs)?;
    sha256_file(abs)
}

/// `report.md` → `report.conflict-20260716-104502.md`
fn conflict_rel_name(rel: &str) -> String {
    let ts = jiff::Zoned::now().strftime("%Y%m%d-%H%M%S").to_string();
    let (dir, name) = match rel.rsplit_once('/') {
        Some((d, n)) => (Some(d), n),
        None => (None, rel),
    };
    let renamed = match name.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem}.conflict-{ts}.{ext}"),
        None => format!("{name}.conflict-{ts}"),
    };
    match dir {
        Some(d) => format!("{d}/{renamed}"),
        None => renamed,
    }
}

// ─── Per-target sync state (this device's "last agreed" snapshot) ───────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateEntry {
    hash: String,
    file_id: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SyncState {
    #[serde(default)]
    files: HashMap<String, StateEntry>,
}

fn state_file_path(target_id: &str) -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("nopal")
        .join("sync-state")
        .join(format!("{target_id}.json"))
}

fn load_state(target_id: &str) -> SyncState {
    fs::read_to_string(state_file_path(target_id))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(target_id: &str, state: &SyncState) -> Result<()> {
    let path = state_file_path(target_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(state)?)?;
    Ok(())
}

/// Recursively collects regular files as (relative path, absolute path).
fn scan_dir(dir: &Path, rel_prefix: &str, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
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
) -> Result<String> {
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

fn sha256_file(path: &Path) -> Result<String> {
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
