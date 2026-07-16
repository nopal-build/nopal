//! `nopal login` / `logout` / `whoami`.
//!
//! Login flow ("loopback" pattern, same as `gh`/`vercel`/`supabase` CLIs):
//!
//! 1. Bind an ephemeral local HTTP server on `127.0.0.1`.
//! 2. Open the user's browser to `{host}/cli-login?port=...&state=...`. The
//!    web app authenticates the human (existing session/passkey/TOTP flow)
//!    and, once approved, redirects the browser to
//!    `http://127.0.0.1:{port}/callback?code=...&state=...`.
//! 3. This process receives that callback, checks `state` (CSRF), and
//!    exchanges the short-lived one-time `code` for a real bearer token via
//!    a direct server-to-server HTTPS call — the long-lived token itself
//!    never appears in a browser URL/history.
//! 4. The token is stored in the OS keychain (falling back to a
//!    `~/.config/nopal/credentials.json` file with `0600` permissions if no
//!    keychain is available).

use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tiny_http::{Header, Response, Server};

const KEYRING_SERVICE: &str = "nopal-cli";
const KEYRING_USER: &str = "default";
const LOGIN_TIMEOUT_SECS: u64 = 300; // 5 minutes

const CALLBACK_HTML_OK: &str = r#"<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Nopal CLI</title></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; margin-top: 15vh; color: #222;">
    <h2>You're logged in</h2>
    <p>You can close this tab and return to your terminal.</p>
  </body>
</html>"#;

const CALLBACK_HTML_ERR: &str = r#"<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Nopal CLI</title></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; margin-top: 15vh; color: #222;">
    <h2>Something went wrong</h2>
    <p>Return to your terminal for details. You can close this tab.</p>
  </body>
</html>"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub host: String,
    pub token: String,
    pub email: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
struct ExchangeResponse {
    token: String,
    email: String,
    expires_at: String,
}

/// Runs the full loopback login flow against `host` and persists the
/// resulting credentials on success.
pub fn login(host: &str, no_browser: bool) -> Result<(), Box<dyn Error>> {
    let host = host.trim_end_matches('/').to_string();

    let server = Server::http("127.0.0.1:0")
        .map_err(|e| format!("Failed to start local callback server: {e}"))?;
    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
        #[allow(unreachable_patterns)]
        _ => return Err("Local callback server did not bind to a TCP port".into()),
    };

    let state = generate_state();
    let hostname = local_hostname();

    let login_url = format!(
        "{host}/cli-login?port={port}&state={state}&hostname={}",
        urlencoding::encode(&hostname)
    );

    println!("To authorize this CLI, open the following URL:\n\n  {login_url}\n");
    if no_browser {
        println!("(--no-browser set — open the link above manually)");
    } else if open::that(&login_url).is_err() {
        println!("Couldn't open a browser automatically — open the link above manually.");
    }
    println!(
        "Waiting for approval (up to {} minutes)...",
        LOGIN_TIMEOUT_SECS / 60
    );

    let deadline = Instant::now() + Duration::from_secs(LOGIN_TIMEOUT_SECS);

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(
                "Login timed out waiting for browser approval. Run 'nopal login' again.".into(),
            );
        }

        let request = match server
            .recv_timeout(remaining)
            .map_err(|e| format!("Local callback server error: {e}"))?
        {
            Some(req) => req,
            None => continue, // recv_timeout elapsed within the overall deadline; loop re-checks it
        };

        if !request.url().starts_with("/callback") {
            let _ = request.respond(Response::from_string("not found").with_status_code(404));
            continue;
        }

        let params = parse_query(request.url());
        let received_state = params.get("state").cloned().unwrap_or_default();
        let code = params.get("code").cloned();

        let state_ok = received_state == state;
        let html = if state_ok && code.is_some() {
            CALLBACK_HTML_OK
        } else {
            CALLBACK_HTML_ERR
        };
        let content_type =
            Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                .expect("static header is valid");
        let _ = request.respond(Response::from_string(html).with_header(content_type));

        if !state_ok {
            return Err(
                "State mismatch on callback — possible interference. Run 'nopal login' again."
                    .into(),
            );
        }
        let code = code.ok_or("Callback did not include an authorization code")?;

        let exchanged = exchange_code(&host, &code)?;
        let creds = Credentials {
            host: host.clone(),
            token: exchanged.token,
            email: exchanged.email.clone(),
            expires_at: exchanged.expires_at.clone(),
        };
        save_credentials(&creds)?;

        println!(
            "Logged in as {} — session valid until {}.",
            exchanged.email, exchanged.expires_at
        );
        return Ok(());
    }
}

pub fn logout() -> Result<(), Box<dyn Error>> {
    delete_credentials()?;
    println!("Logged out.");
    Ok(())
}

pub fn whoami() -> Result<(), Box<dyn Error>> {
    match load_credentials() {
        Some(creds) => {
            println!("Logged in as {} ({})", creds.email, creds.host);
            println!("Session valid until {}", creds.expires_at);
            Ok(())
        }
        None => Err("Not logged in. Run 'nopal login' first.".into()),
    }
}

fn exchange_code(host: &str, code: &str) -> Result<ExchangeResponse, Box<dyn Error>> {
    let url = format!("{host}/api/cli-auth/exchange");
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(url)
        .json(&serde_json::json!({ "code": code }))
        .send()
        .map_err(|e| format!("Failed to reach {host}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("Code exchange failed ({status}): {body}").into());
    }

    Ok(resp.json()?)
}

fn generate_state() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn local_hostname() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "unknown-host".to_string())
}

fn parse_query(url: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some((_, query)) = url.split_once('?') else {
        return map;
    };
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = urlencoding::decode(k)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| k.to_string());
        let val = urlencoding::decode(v)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| v.to_string());
        map.insert(key, val);
    }
    map
}

// ─── Sync-scoped credentials (the watcher's token) ───────────────────────
//
// Stored in a 0600 file rather than the keychain ON PURPOSE: the watcher
// runs as a launchd agent, and background keychain access triggers macOS
// permission prompts. The token is sync-scoped (syncs/ content only) and
// revocable from the profile page, which bounds the exposure.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCredentials {
    pub host: String,
    pub token: String,
    pub token_id: String,
}

pub fn sync_credentials_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("nopal").join("sync-credentials.json")
}

pub fn save_sync_credentials(creds: &SyncCredentials) -> Result<(), Box<dyn Error>> {
    let path = sync_credentials_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(creds)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub fn load_sync_credentials() -> Option<SyncCredentials> {
    let contents = fs::read_to_string(sync_credentials_path()).ok()?;
    serde_json::from_str(&contents).ok()
}

pub fn delete_sync_credentials() -> bool {
    fs::remove_file(sync_credentials_path()).is_ok()
}

// ─── Credential storage ─────────────────────────────────────────────

fn save_credentials(creds: &Credentials) -> Result<(), Box<dyn Error>> {
    let json = serde_json::to_string(creds)?;
    let keyring_result =
        Entry::new(KEYRING_SERVICE, KEYRING_USER).and_then(|e| e.set_password(&json));

    match keyring_result {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!(
                "Warning: couldn't use the OS keychain ({e}); falling back to a local config file."
            );
            save_credentials_to_file(creds)
        }
    }
}

pub fn load_credentials() -> Option<Credentials> {
    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if let Ok(json) = entry.get_password() {
            if let Ok(creds) = serde_json::from_str(&json) {
                return Some(creds);
            }
        }
    }
    load_credentials_from_file()
}

fn delete_credentials() -> Result<(), Box<dyn Error>> {
    let mut removed_any = false;

    if let Ok(entry) = Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if entry.delete_password().is_ok() {
            removed_any = true;
        }
    }

    let path = credentials_file_path();
    if path.exists() {
        fs::remove_file(&path)?;
        removed_any = true;
    }

    if removed_any {
        Ok(())
    } else {
        Err("No stored credentials found.".into())
    }
}

fn credentials_file_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("nopal").join("credentials.json")
}

fn save_credentials_to_file(creds: &Credentials) -> Result<(), Box<dyn Error>> {
    let path = credentials_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(creds)?;
    fs::write(&path, json)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

fn load_credentials_from_file() -> Option<Credentials> {
    let contents = fs::read_to_string(credentials_file_path()).ok()?;
    serde_json::from_str(&contents).ok()
}
