//! `nopal sync watch ...` — the background sync worker and its lifecycle.
//!
//! The worker itself is `nopal sync run --watch`: a foreground process that
//! watches every sync target registered on this device (FSEvents via the
//! `notify` crate), debounces changes, and re-runs the sync engine. It also
//! wakes on a timer so two-way targets pick up *remote* changes that file
//! watching can't see.
//!
//! Lifecycle management is delegated to the OS — a plain background process
//! would neither survive reboots nor be discoverable to cancel. On macOS:
//!
//!   nopal sync watch enable    mint a sync-scoped token, write a launchd
//!                              LaunchAgent (RunAtLoad + KeepAlive), load it
//!   nopal sync watch disable   unload + delete the agent, revoke the token
//!   nopal sync watch status    agent loaded? worker alive? token present?
//!   nopal sync watch logs      tail the worker's log file
//!
//! The worker authenticates with a sync-scoped, never-expiring, revocable
//! token (see auth::SyncCredentials) — NOT the 30-day login session — so the
//! agent doesn't quietly die a month after setup, and a leaked token can
//! only touch syncs/ content.

use serde::{Deserialize, Serialize};
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::auth;
use crate::sync;
use crate::vault::Client;

const LAUNCH_AGENT_LABEL: &str = "build.nopal.sync-watch";
/// Quiet period after the last file event before a sync run kicks off.
const DEBOUNCE: Duration = Duration::from_secs(5);
/// Timer wake-up: catches remote changes for two-way targets and any local
/// edits the FS watcher missed.
const POLL_INTERVAL: Duration = Duration::from_secs(5 * 60);

// ─── Paths ────────────────────────────────────────────────────────────────────

fn launch_agent_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library/LaunchAgents")
        .join(format!("{LAUNCH_AGENT_LABEL}.plist"))
}

fn log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library/Logs/nopal/sync-watch.log")
}

fn heartbeat_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("nopal").join("watch-heartbeat.json")
}

// ─── Heartbeat (read by `status`) ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct Heartbeat {
    at: String,
    ok: bool,
    #[serde(default)]
    error: Option<String>,
}

fn write_heartbeat(ok: bool, error: Option<String>) {
    let hb = Heartbeat {
        at: jiff::Timestamp::now().to_string(),
        ok,
        error,
    };
    let path = heartbeat_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(&hb).unwrap_or_default());
}

// ─── The foreground worker (`nopal sync run --watch`) ─────────────────────────

pub fn run_watch() -> Result<(), Box<dyn Error + Send + Sync>> {
    use notify::{RecursiveMode, Watcher};

    let client = Client::new_sync_preferred()?;
    let device = sync::device_id()?;

    // Initial pass + collect the paths to watch.
    let mut watched_paths = run_all(&client, &device);
    if watched_paths.is_empty() {
        return Err(
            "No sync targets registered on this device — add one with 'nopal sync add'.".into(),
        );
    }

    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // Any event is just a "something changed" signal — the sync engine
        // itself diffs by hash, so we don't care what the event says.
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;
    for path in &watched_paths {
        watcher.watch(path, RecursiveMode::Recursive)?;
        println!("watching {}", path.display());
    }
    println!(
        "watch: debounce {}s, remote poll every {}m — Ctrl-C to stop",
        DEBOUNCE.as_secs(),
        POLL_INTERVAL.as_secs() / 60
    );

    let mut dirty = false;
    let mut last_event = Instant::now();
    let mut last_run = Instant::now();

    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(()) => {
                dirty = true;
                last_event = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        let debounced = dirty && last_event.elapsed() >= DEBOUNCE;
        let poll_due = last_run.elapsed() >= POLL_INTERVAL;
        if !debounced && !poll_due {
            continue;
        }

        dirty = false;
        last_run = Instant::now();
        let paths = run_all(&client, &device);

        // Watch any target directories that appeared since we started
        // (e.g. `nopal sync add` while the worker was running).
        for path in &paths {
            if !watched_paths.contains(path)
                && watcher.watch(path, RecursiveMode::Recursive).is_ok()
            {
                println!("watching {}", path.display());
                watched_paths.push(path.clone());
            }
        }
    }
    Ok(())
}

/// One pass over every target on this device. Errors are logged and written
/// to the heartbeat, never fatal — the worker keeps running.
fn run_all(client: &Client, device_id: &str) -> Vec<PathBuf> {
    match sync::run_device_targets(client, device_id, &mut |line| println!("{line}")) {
        Ok((paths, errors)) => {
            if errors.is_empty() {
                write_heartbeat(true, None);
            } else {
                for e in &errors {
                    eprintln!("[{}] {e}", jiff::Timestamp::now());
                }
                write_heartbeat(false, Some(errors.join("; ")));
            }
            paths
        }
        Err(e) => {
            eprintln!("[{}] sync failed: {e}", jiff::Timestamp::now());
            write_heartbeat(false, Some(e.to_string()));
            Vec::new()
        }
    }
}

// ─── launchd management ───────────────────────────────────────────────────────

fn ensure_macos() -> Result<(), Box<dyn Error + Send + Sync>> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err(
            "The managed watcher currently supports macOS (launchd) only. \
             Run 'nopal sync run --watch' in the foreground instead."
                .into(),
        )
    }
}

/// The PATH to run the worker with: whatever this process inherited (i.e.
/// the shell PATH at the moment `enable` was run) unioned with the standard
/// locations launchd's own minimal PATH omits — Homebrew's bin dirs on both
/// Apple Silicon and Intel, plus the usual system paths. launchd agents
/// never source .zshrc/.bash_profile, so without this ffmpeg (and anything
/// else installed via Homebrew) is invisible to the watcher even though
/// it's on PATH in every terminal.
fn launchd_path_env() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut dirs: Vec<String> = inherited.split(':').map(|s| s.to_string()).collect();

    for extra in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        if !dirs.iter().any(|d| d == extra) {
            dirs.push(extra.to_string());
        }
    }
    dirs.retain(|d| !d.is_empty());
    dirs.join(":")
}

fn launchctl(args: &[&str]) -> Result<bool, Box<dyn Error + Send + Sync>> {
    let status = Command::new("launchctl")
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    Ok(status.success())
}

/// Restarts the watcher (unload + load the SAME plist, same binary path) if
/// it's currently enabled — a no-op otherwise. Called automatically by
/// `nopal update` so a freshly-installed binary takes effect immediately
/// instead of waiting for the process to next crash/reboot.
///
/// Deliberately does NOT touch the sync-scoped token (unlike `disable` +
/// `enable`, which would mint a brand new one and leave the old one
/// orphaned on the server every time you update). `self_replace` swaps the
/// binary in place at the same path `ProgramArguments` already points at,
/// so nothing about the plist needs to change — launchd just needs to be
/// told to relaunch the job.
pub fn restart_if_enabled() -> Result<(), Box<dyn Error + Send + Sync>> {
    let plist_path = launch_agent_path();
    if !plist_path.exists() {
        return Ok(());
    }

    println!("Restarting the sync watcher to pick up the new version...");
    // Best-effort unload — if it wasn't actually loaded (e.g. after a
    // reboot before login), that's fine, `load` below is what matters.
    let _ = launchctl(&["unload", &plist_path.to_string_lossy()]);
    if !launchctl(&["load", &plist_path.to_string_lossy()])? {
        return Err("launchctl load failed — run 'nopal sync watch enable' manually.".into());
    }
    println!("  ✓ watcher restarted");
    Ok(())
}

pub fn enable() -> Result<(), Box<dyn Error + Send + Sync>> {
    ensure_macos()?;

    // 1. Mint a sync-scoped token using the CURRENT (full) login, so the
    //    worker never depends on the 30-day session.
    let client = Client::new()?;
    let label = format!(
        "Sync watcher on {}",
        hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "unknown-device".to_string())
    );
    let resp: serde_json::Value =
        client.post_json("/api/sync-tokens", &serde_json::json!({ "name": label }))?;
    let token = resp["token"]
        .as_str()
        .ok_or("Server did not return a token")?
        .to_string();
    let token_id = resp["tokenId"]
        .as_str()
        .ok_or("Server did not return a token id")?
        .to_string();
    auth::save_sync_credentials(&auth::SyncCredentials {
        host: client.host.clone(),
        token,
        token_id,
    })?;
    println!("Minted a sync-scoped token (never expires; revocable from your profile).");

    // 2. Write + load the LaunchAgent. Re-points at the current binary, so
    //    re-running enable after `nopal update` refreshes the path.
    let exe = std::env::current_exe()?;
    let log = log_path();
    if let Some(parent) = log.parent() {
        fs::create_dir_all(parent)?;
    }
    let path_env = launchd_path_env();
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
    <string>sync</string>
    <string>run</string>
    <string>--watch</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{path_env}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#,
        exe = exe.display(),
        log = log.display(),
    );
    let plist_path = launch_agent_path();
    if let Some(parent) = plist_path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Reload cleanly if it was already enabled.
    let _ = launchctl(&["unload", &plist_path.to_string_lossy()]);
    fs::write(&plist_path, plist)?;
    if !launchctl(&["load", &plist_path.to_string_lossy()])? {
        return Err("launchctl load failed — check `nopal sync watch logs`.".into());
    }

    println!("Watcher enabled — starts at login, restarts on crash.");
    println!("  agent: {}", plist_path.display());
    println!("  logs:  {}", log.display());
    println!("  stop:  nopal sync watch disable");
    Ok(())
}

pub fn disable() -> Result<(), Box<dyn Error + Send + Sync>> {
    ensure_macos()?;
    let plist_path = launch_agent_path();
    let mut did_anything = false;

    if plist_path.exists() {
        let _ = launchctl(&["unload", &plist_path.to_string_lossy()]);
        fs::remove_file(&plist_path)?;
        println!("Watcher stopped and removed from login items.");
        did_anything = true;
    }

    // Revoke the sync-scoped token (needs the full login). If that fails,
    // the local copy is still deleted and the user is told how to revoke.
    if let Some(creds) = auth::load_sync_credentials() {
        match Client::new().and_then(|client| {
            client.delete_with_body(
                "/api/sync-tokens",
                &serde_json::json!({ "tokenId": creds.token_id }),
            )
        }) {
            Ok(()) => println!("Sync token revoked."),
            Err(e) => println!(
                "Couldn't revoke the sync token ({e}) — revoke it from your \
                 profile page (CLI sessions)."
            ),
        }
        auth::delete_sync_credentials();
        did_anything = true;
    }

    let _ = fs::remove_file(heartbeat_path());
    if !did_anything {
        println!("Watcher was not enabled.");
    }
    Ok(())
}

pub fn status() -> Result<(), Box<dyn Error + Send + Sync>> {
    ensure_macos()?;
    let plist_path = launch_agent_path();
    println!(
        "agent:     {}",
        if plist_path.exists() {
            "installed (starts at login)"
        } else {
            "not installed"
        }
    );

    // launchctl list <label> exits 0 when the job is loaded.
    let loaded = launchctl(&["list", LAUNCH_AGENT_LABEL]).unwrap_or(false);
    println!("loaded:    {}", if loaded { "yes" } else { "no" });

    println!(
        "token:     {}",
        if auth::load_sync_credentials().is_some() {
            "sync-scoped token present"
        } else {
            "none (worker would fall back to the 30-day login)"
        }
    );

    match fs::read_to_string(heartbeat_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Heartbeat>(&s).ok())
    {
        Some(hb) => {
            println!(
                "last run:  {} — {}",
                hb.at,
                if hb.ok {
                    "ok".to_string()
                } else {
                    format!("FAILED: {}", hb.error.unwrap_or_default())
                }
            );
        }
        None => println!("last run:  never"),
    }
    println!("logs:      {}", log_path().display());
    Ok(())
}

pub fn logs(lines: usize) -> Result<(), Box<dyn Error + Send + Sync>> {
    let path = log_path();
    let contents =
        fs::read_to_string(&path).map_err(|_| format!("No log file yet at {}", path.display()))?;
    for line in contents
        .lines()
        .rev()
        .take(lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
    {
        println!("{line}");
    }
    Ok(())
}
