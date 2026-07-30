//! The Nopal Vault REST client — shared by the CLI and the native app.
//!
//! This module is the *data layer* only: HTTP calls, path resolution, and
//! upload/download mechanics. It never prints anything or prompts for
//! input — that's presentation, and belongs to whichever front-end is
//! calling in (the CLI's own `vault` command module, or the native app's
//! views). See the `vault` skill (`.agents/skills/vault`) for the server
//! side this talks to.

use serde::Deserialize;
use std::fs;
use std::io::Read;
use std::path::Path;

use crate::auth;
use crate::Result;

/// Chunk size for multipart parts (matches the web client's 10 MB parts;
/// the server route caps parts at 10 MB specifically so each part finishes
/// quickly and doesn't get killed by an intermediary proxy on a slow
/// connection).
const MULTIPART_CHUNK: usize = 10 * 1024 * 1024;
/// Files larger than this upload via the S3 multipart endpoints instead of
/// one single POST. Deliberately equal to the chunk size — ANY file that
/// would need more than one chunk gets the more resilient, independently-
/// retryable path. A single-shot POST for a large file (e.g. a 30 MB screen
/// recording over a slow home upload) can take long enough that Fly's
/// proxy-to-machine backhaul gives up on the still-arriving body
/// (`unexpected end of file` / error code PU02) — splitting into several
/// quick 10 MB requests avoids that failure mode entirely.
const MULTIPART_THRESHOLD: u64 = MULTIPART_CHUNK as u64;
/// Retries for a request that fails at the transport level (dropped/reset
/// connection, DNS blip, etc.) — never for a definite HTTP error response,
/// since retrying a 403/404 changes nothing.
const MAX_ATTEMPTS: u32 = 4;

fn retry_delay(attempt: u32) -> std::time::Duration {
    std::time::Duration::from_secs(2u64.pow(attempt.min(4))) // 2s, 4s, 8s, 16s
}

// ─── API types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct Folder {
    pub _id: String,
    pub name: String,
    #[serde(default)]
    pub vault_root_key: Option<String>,
    /// Which Vault Folder Type (see the webapp's `vaultFolderTypes.ts`)
    /// this folder carries — either because it IS one (a project's own
    /// "Skills"/"Syncs" folder, or a sync connector inside a "Syncs"
    /// folder) or because it inherits one from the nearest typed ancestor.
    /// `None` for an ordinary, untyped folder.
    #[serde(default)]
    pub folder_type: Option<String>,
    #[serde(default)]
    pub shared_with: Vec<String>,
    /// Published to a public, unauthenticated URL. Only reflects THIS
    /// folder's own flag — a folder can also be publicly reachable because
    /// an ancestor is published.
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileListing {
    pub _id: String,
    pub name: String,
    pub content_type: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub has_s3: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Children {
    pub folders: Vec<Folder>,
    pub files: Vec<FileListing>,
}

#[derive(Debug, Deserialize)]
pub struct FullFile {
    pub _id: String,
    pub name: String,
    pub content_type: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub s3_key: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub is_public: Option<bool>,
}

/// What a vault path resolved to.
pub enum Resolved {
    Folder(Folder),
    File { file: FileListing },
    Root,
}

// ─── HTTP client ──────────────────────────────────────────────────────────

pub struct Client {
    http: reqwest::blocking::Client,
    pub host: String,
    token: String,
}

/// A fresh connection per request rather than reqwest's default pooling.
/// This client is used by long-running processes (the CLI's `--watch`
/// worker, a GUI app that stays open for a session) that issue requests
/// sporadically — a pooled/kept-alive connection can sit idle long enough
/// that Fly's proxy (or a home router's NAT) silently closes it, and the
/// next large upload to reuse it fails with an opaque transport error
/// (`error sending request for url`) partway through sending the body. A
/// fresh connection costs one extra TLS handshake per request, which is
/// noise next to an upload that takes seconds anyway.
fn build_http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .pool_max_idle_per_host(0)
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

impl Client {
    pub fn new() -> Result<Self> {
        // NOPAL_HOST/NOPAL_TOKEN override the stored login — useful for
        // scripts, CI, and pointing at a local dev server.
        if let (Ok(host), Ok(token)) = (std::env::var("NOPAL_HOST"), std::env::var("NOPAL_TOKEN")) {
            return Ok(Client {
                http: build_http_client(),
                host: host.trim_end_matches('/').to_string(),
                token,
            });
        }
        let creds = auth::load_credentials().ok_or("Not logged in. Run 'nopal login' first.")?;
        Ok(Client {
            http: build_http_client(),
            host: creds.host,
            token: creds.token,
        })
    }

    /// Like `new`, but prefers the sync-scoped token when one is stored —
    /// used by the watcher so a long-running process never depends on the
    /// 30-day login session. Falls back to the normal login (or env vars).
    pub fn new_sync_preferred() -> Result<Self> {
        if std::env::var("NOPAL_TOKEN").is_err() {
            if let Some(creds) = auth::load_sync_credentials() {
                return Ok(Client {
                    http: build_http_client(),
                    host: creds.host,
                    token: creds.token,
                });
            }
        }
        Self::new()
    }

    /// Builds a `Client` directly from already-known credentials — used by
    /// callers (the native app) that just finished a `LoginFlow` and don't
    /// want a redundant round-trip back through credential storage.
    pub fn from_credentials(host: impl Into<String>, token: impl Into<String>) -> Self {
        Client {
            http: build_http_client(),
            host: host.into(),
            token: token.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.host, path)
    }

    /// Runs `send_request` up to `MAX_ATTEMPTS` times, retrying ONLY when
    /// the request fails at the transport level (never received a response
    /// at all — a dropped connection, DNS blip, etc). A definite HTTP
    /// response, even an error one, returns immediately: retrying a 403
    /// changes nothing.
    fn send_with_retry(
        &self,
        mut send_request: impl FnMut() -> reqwest::Result<reqwest::blocking::Response>,
    ) -> Result<reqwest::blocking::Response> {
        let mut last_err: Option<reqwest::Error> = None;
        for attempt in 0..MAX_ATTEMPTS {
            if attempt > 0 {
                eprintln!(
                    "  network error, retrying ({attempt}/{})...",
                    MAX_ATTEMPTS - 1
                );
                std::thread::sleep(retry_delay(attempt));
            }
            match send_request() {
                Ok(resp) => return Ok(resp),
                Err(e) => last_err = Some(e),
            }
        }
        Err(Box::new(last_err.expect("MAX_ATTEMPTS > 0")))
    }

    /// GET returning JSON, with a friendly error for non-2xx responses.
    pub fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let resp = self.send_with_retry(|| {
            self.http
                .get(self.url(path))
                .bearer_auth(&self.token)
                .send()
        })?;
        Self::parse(resp)
    }

    pub fn post_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        let resp = self.send_with_retry(|| {
            self.http
                .post(self.url(path))
                .bearer_auth(&self.token)
                .json(body)
                .send()
        })?;
        Self::parse(resp)
    }

    /// Multipart POST. `build_form` is called fresh on every attempt (not
    /// passed a pre-built `Form`) so a retry re-reads the file/bytes rather
    /// than reusing a body that's already been partially consumed.
    pub fn post_form<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        build_form: impl Fn() -> Result<reqwest::blocking::multipart::Form>,
    ) -> Result<T> {
        let mut last_err: Option<crate::Error> = None;
        for attempt in 0..MAX_ATTEMPTS {
            if attempt > 0 {
                eprintln!(
                    "  network error, retrying ({attempt}/{})...",
                    MAX_ATTEMPTS - 1
                );
                std::thread::sleep(retry_delay(attempt));
            }
            let form = match build_form() {
                Ok(f) => f,
                Err(e) => return Err(e),
            };
            match self
                .http
                .post(self.url(path))
                .bearer_auth(&self.token)
                .multipart(form)
                .send()
            {
                Ok(resp) => return Self::parse(resp),
                Err(e) => last_err = Some(Box::new(e)),
            }
        }
        Err(last_err.expect("MAX_ATTEMPTS > 0"))
    }

    pub fn patch_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        let resp = self.send_with_retry(|| {
            self.http
                .patch(self.url(path))
                .bearer_auth(&self.token)
                .json(body)
                .send()
        })?;
        Self::parse(resp)
    }

    pub fn put_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        let resp = self.send_with_retry(|| {
            self.http
                .put(self.url(path))
                .bearer_auth(&self.token)
                .json(body)
                .send()
        })?;
        Self::parse(resp)
    }

    pub fn delete<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let resp = self.send_with_retry(|| {
            self.http
                .delete(self.url(path))
                .bearer_auth(&self.token)
                .send()
        })?;
        Self::parse(resp)
    }

    /// DELETE with a JSON body (e.g. revoking a sync token).
    pub fn delete_with_body(&self, path: &str, body: &serde_json::Value) -> Result<()> {
        let resp = self.send_with_retry(|| {
            self.http
                .delete(self.url(path))
                .bearer_auth(&self.token)
                .json(body)
                .send()
        })?;
        let _: serde_json::Value = Self::parse(resp)?;
        Ok(())
    }

    /// True if `url` (an arbitrary, possibly-unauthenticated full URL, e.g.
    /// a public share link) currently responds successfully. Used by
    /// `nopal vault link` to confirm a link is actually live without
    /// re-deriving publish-inheritance rules client-side.
    pub fn get_reachable(&self, url: &str) -> bool {
        self.http
            .get(url)
            .send()
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    fn parse<T: serde::de::DeserializeOwned>(resp: reqwest::blocking::Response) -> Result<T> {
        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Session expired or invalid.".into());
        }
        let text = resp.text()?;
        if !status.is_success() {
            // Surface the server's { error } message when present.
            let msg = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
                .unwrap_or_else(|| format!("Request failed ({status})"));
            return Err(msg.into());
        }
        Ok(serde_json::from_str(&text)?)
    }

    pub fn children(&self, folder_id: &str) -> Result<Children> {
        self.get_json(&format!("/api/vault/folders/{folder_id}/children"))
    }
}

// ─── Path resolution ────────────────────────────────────────────────────

/// Case-insensitive segment match; also lets `Daily Logs` match `daily-logs`.
pub fn segment_matches(segment: &str, name: &str) -> bool {
    let norm = |s: &str| s.trim().to_lowercase().replace(' ', "-");
    norm(segment) == norm(name)
}

pub fn split_path(path: &str) -> Vec<&str> {
    path.split('/')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Walks the vault from the root, matching folders first and, for the final
/// segment only, files. Empty path resolves to the vault root.
pub fn resolve(client: &Client, path: &str) -> Result<Resolved> {
    let segments = split_path(path);
    if segments.is_empty() {
        return Ok(Resolved::Root);
    }

    let mut children = client.children("root")?;
    let mut current: Option<Folder> = None;

    for (i, segment) in segments.iter().enumerate() {
        let is_last = i == segments.len() - 1;

        if let Some(folder) = children
            .folders
            .iter()
            .find(|f| segment_matches(segment, &f.name))
            .cloned()
        {
            children = client.children(&folder._id)?;
            current = Some(folder);
            continue;
        }

        if is_last && current.is_some() {
            if let Some(file) = children
                .files
                .iter()
                .find(|f| segment_matches(segment, &f.name))
                .cloned()
            {
                return Ok(Resolved::File { file });
            }
        }

        let where_ = current
            .as_ref()
            .map(|f| f.name.clone())
            .unwrap_or_else(|| "the vault root".to_string());
        return Err(format!("'{segment}' not found in {where_}").into());
    }

    Ok(Resolved::Folder(
        current.expect("non-empty path sets current"),
    ))
}

pub fn resolve_folder(client: &Client, path: &str) -> Result<Option<Folder>> {
    match resolve(client, path)? {
        Resolved::Root => Ok(None),
        Resolved::Folder(f) => Ok(Some(f)),
        Resolved::File { file } => Err(format!("'{}' is a file, not a folder", file.name).into()),
    }
}

/// Every direct child folder of the human's `projects` root — the simple
/// list of "what projects exist," used by anything that needs to let a
/// human pick a project scope (sync targets, screen-recording uploads,
/// ...). Empty (not an error) if the `projects` root itself can't be
/// resolved, so callers can treat "no projects yet" and "couldn't check"
/// the same way — just offer Personal.
pub fn list_projects(client: &Client) -> Result<Vec<Folder>> {
    let Some(projects_root) = resolve_folder(client, "projects")? else {
        return Ok(Vec::new());
    };
    Ok(client.children(&projects_root._id)?.folders)
}

pub fn resolve_file(client: &Client, path: &str) -> Result<FileListing> {
    match resolve(client, path)? {
        Resolved::File { file } => Ok(file),
        Resolved::Folder(f) => Err(format!("'{}' is a folder, not a file", f.name).into()),
        Resolved::Root => Err("Expected a file path, got the vault root".into()),
    }
}

// ─── Formatting helpers (pure — presentation-adjacent but shared) ────────

pub fn format_size(size: Option<u64>) -> String {
    match size {
        None => String::new(),
        Some(b) if b < 1024 => format!("{b} B"),
        Some(b) if b < 1024 * 1024 => format!("{:.1} KB", b as f64 / 1024.0),
        Some(b) if b < 1024 * 1024 * 1024 => {
            format!("{:.1} MB", b as f64 / (1024.0 * 1024.0))
        }
        Some(b) => format!("{:.1} GB", b as f64 / (1024.0 * 1024.0 * 1024.0)),
    }
}

pub fn format_date(iso: &str) -> String {
    iso.split('T').next().unwrap_or(iso).to_string()
}

pub fn is_shared(folder: &Folder) -> bool {
    !folder.shared_with.is_empty()
}

// ─── Download ─────────────────────────────────────────────────────────────

/// Downloads a file's bytes/content to `out`. No printing — callers report
/// progress/completion themselves.
pub fn download_file(client: &Client, listing: &FileListing, out: &Path) -> Result<()> {
    if listing.has_s3 {
        let resp: serde_json::Value =
            client.get_json(&format!("/api/vault/download/{}", listing._id))?;
        let url = resp["url"]
            .as_str()
            .ok_or("Server did not return a download URL")?;
        let mut s3_resp = reqwest::blocking::get(url)?;
        if !s3_resp.status().is_success() {
            return Err(format!("Download failed ({})", s3_resp.status()).into());
        }
        let mut file = fs::File::create(out)?;
        s3_resp.copy_to(&mut file)?;
    } else {
        // Markdown/text cards live in the DB — write their content directly.
        let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", listing._id))?;
        let file: FullFile = serde_json::from_value(resp["file"].clone())?;
        let content = file
            .content
            .ok_or_else(|| format!("'{}' has no downloadable content", file.name))?;
        fs::write(out, content)?;
    }
    Ok(())
}

// ─── Upload ─────────────────────────────────────────────────────────────

pub struct UploadedFile {
    pub file_id: String,
    pub name: String,
    pub size: u64,
}

/// Reported during `upload_file` so a caller (CLI or GUI) can show
/// progress. Only ever emitted for the multipart path — a small,
/// single-POST upload has no meaningful sub-progress to report.
pub enum UploadProgress {
    Part { part_number: u32, total_parts: u64 },
}

/// Uploads one local file into `folder`, returning the created file_ref's
/// id/name/size. Automatically switches to the resumable-friendly S3
/// multipart path for anything over `MULTIPART_THRESHOLD`.
pub fn upload_file(
    client: &Client,
    local: &Path,
    folder: &Folder,
    mut on_progress: impl FnMut(UploadProgress),
) -> Result<UploadedFile> {
    let meta = fs::metadata(local).map_err(|e| format!("{}: {e}", local.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", local.display()).into());
    }
    let name = local
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid file name: {}", local.display()))?
        .to_string();
    let content_type = mime_guess::from_path(local)
        .first_or_octet_stream()
        .to_string();
    let size = meta.len();

    let file_id = if size <= MULTIPART_THRESHOLD {
        let folder_id = folder._id.clone();
        let resp: serde_json::Value = client.post_form("/api/vault/upload", || {
            Ok(reqwest::blocking::multipart::Form::new()
                .file("file", local)?
                .text("folderId", folder_id.clone()))
        })?;
        resp["fileRef"]["_id"]
            .as_str()
            .ok_or("Upload did not return a file id")?
            .to_string()
    } else {
        upload_multipart(
            client,
            local,
            folder,
            &name,
            &content_type,
            size,
            &mut on_progress,
        )?
    };

    Ok(UploadedFile {
        file_id,
        name,
        size,
    })
}

fn upload_multipart(
    client: &Client,
    local: &Path,
    folder: &Folder,
    name: &str,
    content_type: &str,
    size: u64,
    on_progress: &mut impl FnMut(UploadProgress),
) -> Result<String> {
    let init: serde_json::Value = client.post_json(
        "/api/vault/multipart-init",
        &serde_json::json!({
            "filename": name,
            "contentType": content_type,
            "folderId": folder._id,
            "originalName": name,
            "size": size,
        }),
    )?;
    let upload_id = init["uploadId"]
        .as_str()
        .ok_or("multipart-init did not return an uploadId")?
        .to_string();
    let key = init["key"]
        .as_str()
        .ok_or("multipart-init did not return a key")?
        .to_string();

    // Abort the S3 upload on any failure so we don't leak storage.
    let result = upload_parts(
        client,
        local,
        &upload_id,
        &key,
        folder,
        name,
        content_type,
        size,
        on_progress,
    );
    if result.is_err() {
        let _: std::result::Result<serde_json::Value, _> = client.post_json(
            "/api/vault/multipart-abort",
            &serde_json::json!({ "uploadId": upload_id, "key": key }),
        );
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn upload_parts(
    client: &Client,
    local: &Path,
    upload_id: &str,
    key: &str,
    folder: &Folder,
    name: &str,
    content_type: &str,
    size: u64,
    on_progress: &mut impl FnMut(UploadProgress),
) -> Result<String> {
    use sha2::Digest;
    let mut file = fs::File::open(local)?;
    let mut parts: Vec<serde_json::Value> = Vec::new();
    let total_parts = size.div_ceil(MULTIPART_CHUNK as u64);
    let mut part_number: u32 = 1;
    let mut buf = vec![0u8; MULTIPART_CHUNK];
    // Hash while chunking — the server never holds the whole file during a
    // multipart upload, so the content hash must come from us.
    let mut hasher = sha2::Sha256::new();

    loop {
        let mut filled = 0;
        while filled < buf.len() {
            let n = file.read(&mut buf[filled..])?;
            if n == 0 {
                break;
            }
            filled += n;
        }
        if filled == 0 {
            break;
        }

        hasher.update(&buf[..filled]);
        // Cloned into the closure so a retry re-sends the same bytes rather
        // than reusing an already-consumed Form/Part (each is single-use).
        let chunk_bytes = buf[..filled].to_vec();
        let resp: serde_json::Value = client.post_form("/api/vault/multipart-part", || {
            let chunk_part = reqwest::blocking::multipart::Part::bytes(chunk_bytes.clone())
                .file_name("chunk")
                .mime_str("application/octet-stream")?;
            Ok(reqwest::blocking::multipart::Form::new()
                .text("uploadId", upload_id.to_string())
                .text("key", key.to_string())
                .text("partNumber", part_number.to_string())
                .part("chunk", chunk_part))
        })?;
        let etag = resp["ETag"]
            .as_str()
            .ok_or_else(|| format!("No ETag for part {part_number}"))?;
        parts.push(serde_json::json!({ "PartNumber": part_number, "ETag": etag }));

        on_progress(UploadProgress::Part {
            part_number,
            total_parts,
        });

        part_number += 1;
        if filled < buf.len() {
            break;
        }
    }

    let content_hash = format!("{:x}", hasher.finalize());
    let resp: serde_json::Value = client.post_json(
        "/api/vault/multipart-complete",
        &serde_json::json!({
            "uploadId": upload_id,
            "key": key,
            "parts": parts,
            "name": name,
            "folderId": folder._id,
            "contentType": content_type,
            "size": size,
            "contentHash": content_hash,
        }),
    )?;
    resp["fileRef"]["_id"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "multipart-complete did not return a file id".into())
}
