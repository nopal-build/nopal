//! `nopal vault ...` — work with the Nopal Vault from the terminal.
//!
//! Commands address content by *path* (e.g. `projects/sunny/readme.md`),
//! resolved by walking the children API from the vault root. All policy
//! (locked root folders, daily-log locks, sharing rules) is enforced
//! server-side; this module just surfaces the server's error messages.

use serde::Deserialize;
use std::error::Error;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::auth;

/// Files larger than this upload via the S3 multipart endpoints.
const MULTIPART_THRESHOLD: u64 = 32 * 1024 * 1024; // 32 MB
/// Chunk size for multipart parts (matches the web client's 10 MB parts).
const MULTIPART_CHUNK: usize = 10 * 1024 * 1024;

// ─── API types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct Folder {
    pub _id: String,
    pub name: String,
    #[serde(default)]
    pub vault_root_key: Option<String>,
    #[serde(default)]
    pub shared_with: serde_json::Value,
    /// Published to a public, unauthenticated URL. Only reflects THIS
    /// folder's own flag — a folder can also be publicly reachable because
    /// an ancestor is published (see `link`, which checks the live page
    /// rather than re-deriving that inheritance client-side).
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

#[derive(Debug, Deserialize)]
pub(crate) struct Children {
    pub(crate) folders: Vec<Folder>,
    pub(crate) files: Vec<FileListing>,
}

#[derive(Debug, Deserialize)]
struct FullFile {
    _id: String,
    name: String,
    content_type: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    s3_key: Option<String>,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    is_public: Option<bool>,
}

/// What a vault path resolved to.
enum Resolved {
    Folder(Folder),
    File { file: FileListing },
    Root,
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

pub(crate) struct Client {
    http: reqwest::blocking::Client,
    pub(crate) host: String,
    token: String,
}

impl Client {
    pub(crate) fn new() -> Result<Self, Box<dyn Error>> {
        // NOPAL_HOST/NOPAL_TOKEN override the stored login — useful for
        // scripts, CI, and pointing at a local dev server.
        if let (Ok(host), Ok(token)) = (std::env::var("NOPAL_HOST"), std::env::var("NOPAL_TOKEN")) {
            return Ok(Client {
                http: reqwest::blocking::Client::new(),
                host: host.trim_end_matches('/').to_string(),
                token,
            });
        }
        let creds = auth::load_credentials().ok_or("Not logged in. Run 'nopal login' first.")?;
        Ok(Client {
            http: reqwest::blocking::Client::new(),
            host: creds.host,
            token: creds.token,
        })
    }

    /// Like `new`, but prefers the sync-scoped token when one is stored —
    /// used by the watcher so a long-running process never depends on the
    /// 30-day login session. Falls back to the normal login (or env vars).
    pub(crate) fn new_sync_preferred() -> Result<Self, Box<dyn Error>> {
        if std::env::var("NOPAL_TOKEN").is_err() {
            if let Some(creds) = auth::load_sync_credentials() {
                return Ok(Client {
                    http: reqwest::blocking::Client::new(),
                    host: creds.host,
                    token: creds.token,
                });
            }
        }
        Self::new()
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.host, path)
    }

    /// GET returning JSON, with a friendly error for non-2xx responses.
    pub(crate) fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<T, Box<dyn Error>> {
        let resp = self
            .http
            .get(self.url(path))
            .bearer_auth(&self.token)
            .send()?;
        Self::parse(resp)
    }

    pub(crate) fn post_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T, Box<dyn Error>> {
        let resp = self
            .http
            .post(self.url(path))
            .bearer_auth(&self.token)
            .json(body)
            .send()?;
        Self::parse(resp)
    }

    pub(crate) fn post_form<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        form: reqwest::blocking::multipart::Form,
    ) -> Result<T, Box<dyn Error>> {
        let resp = self
            .http
            .post(self.url(path))
            .bearer_auth(&self.token)
            .multipart(form)
            .send()?;
        Self::parse(resp)
    }

    pub(crate) fn patch_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T, Box<dyn Error>> {
        let resp = self
            .http
            .patch(self.url(path))
            .bearer_auth(&self.token)
            .json(body)
            .send()?;
        Self::parse(resp)
    }

    pub(crate) fn delete<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<T, Box<dyn Error>> {
        let resp = self
            .http
            .delete(self.url(path))
            .bearer_auth(&self.token)
            .send()?;
        Self::parse(resp)
    }

    /// DELETE with a JSON body (e.g. revoking a sync token).
    pub(crate) fn delete_with_body(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<(), Box<dyn Error>> {
        let resp = self
            .http
            .delete(self.url(path))
            .bearer_auth(&self.token)
            .json(body)
            .send()?;
        let _: serde_json::Value = Self::parse(resp)?;
        Ok(())
    }

    fn parse<T: serde::de::DeserializeOwned>(
        resp: reqwest::blocking::Response,
    ) -> Result<T, Box<dyn Error>> {
        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Session expired or invalid. Run 'nopal login' again.".into());
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

    pub(crate) fn children(&self, folder_id: &str) -> Result<Children, Box<dyn Error>> {
        self.get_json(&format!("/api/vault/folders/{folder_id}/children"))
    }
}

// ─── Path resolution ──────────────────────────────────────────────────────────

/// Case-insensitive segment match; also lets `Daily Logs` match `daily-logs`.
fn segment_matches(segment: &str, name: &str) -> bool {
    let norm = |s: &str| s.trim().to_lowercase().replace(' ', "-");
    norm(segment) == norm(name)
}

fn split_path(path: &str) -> Vec<&str> {
    path.split('/')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Walks the vault from the root, matching folders first and, for the final
/// segment only, files. Empty path resolves to the vault root.
fn resolve(client: &Client, path: &str) -> Result<Resolved, Box<dyn Error>> {
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

fn resolve_folder(client: &Client, path: &str) -> Result<Option<Folder>, Box<dyn Error>> {
    match resolve(client, path)? {
        Resolved::Root => Ok(None),
        Resolved::Folder(f) => Ok(Some(f)),
        Resolved::File { file } => Err(format!("'{}' is a file, not a folder", file.name).into()),
    }
}

fn resolve_file(client: &Client, path: &str) -> Result<FileListing, Box<dyn Error>> {
    match resolve(client, path)? {
        Resolved::File { file } => Ok(file),
        Resolved::Folder(f) => Err(format!("'{}' is a folder, not a file", f.name).into()),
        Resolved::Root => Err("Expected a file path, got the vault root".into()),
    }
}

// ─── Output helpers ───────────────────────────────────────────────────────────

pub(crate) fn format_size(size: Option<u64>) -> String {
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

fn format_date(iso: &str) -> String {
    iso.split('T').next().unwrap_or(iso).to_string()
}

/// Interactive y/N prompt — anything but y/yes is a no.
pub(crate) fn confirm(prompt: &str) -> bool {
    use std::io::Write;
    print!("{prompt}");
    std::io::stdout().flush().ok();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return false;
    }
    matches!(line.trim().to_lowercase().as_str(), "y" | "yes")
}

fn is_shared(folder: &Folder) -> bool {
    match &folder.shared_with {
        serde_json::Value::String(s) => s == "everyone",
        serde_json::Value::Array(a) => !a.is_empty(),
        _ => false,
    }
}

fn print_listing(folders: &[Folder], files: &[FileListing]) {
    for f in folders {
        println!(
            "{:<50} {:>10} {:>12}",
            format!("{}/", f.name),
            "",
            format_date(&f.updated_at)
        );
    }
    for f in files {
        println!(
            "{:<50} {:>10} {:>12}",
            f.name,
            format_size(f.size),
            format_date(&f.updated_at)
        );
    }
    if folders.is_empty() && files.is_empty() {
        println!("(empty)");
    }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

pub fn ls(path: &str, json: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let folder_id = match resolve_folder(&client, path)? {
        Some(f) => f._id,
        None => "root".to_string(),
    };
    let children = client.children(&folder_id)?;

    if json {
        println!(
            "{}",
            serde_json::json!({
                "folders": children.folders.iter().map(|f| serde_json::json!({
                    "id": f._id, "name": f.name, "updated_at": f.updated_at,
                    "shared": is_shared(f),
                })).collect::<Vec<_>>(),
                "files": children.files.iter().map(|f| serde_json::json!({
                    "id": f._id, "name": f.name, "content_type": f.content_type,
                    "size": f.size, "updated_at": f.updated_at, "has_s3": f.has_s3,
                })).collect::<Vec<_>>(),
            })
        );
    } else {
        print_listing(&children.folders, &children.files);
    }
    Ok(())
}

pub fn tree(path: &str, depth: u32, folders_only: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let (label, folder_id) = match resolve_folder(&client, path)? {
        Some(f) => (f.name.clone(), f._id),
        None => ("vault".to_string(), "root".to_string()),
    };
    println!("{label}/");
    tree_inner(&client, &folder_id, "", depth, folders_only)
}

fn tree_inner(
    client: &Client,
    folder_id: &str,
    prefix: &str,
    depth: u32,
    folders_only: bool,
) -> Result<(), Box<dyn Error>> {
    if depth == 0 {
        return Ok(());
    }
    let children = client.children(folder_id)?;
    let files: Vec<&FileListing> = if folders_only {
        vec![]
    } else {
        children.files.iter().collect()
    };
    let total = children.folders.len() + files.len();

    for (i, folder) in children.folders.iter().enumerate() {
        let last = i + 1 == total;
        let (branch, next_prefix) = branch_chars(prefix, last);
        println!("{branch}{}/", folder.name);
        tree_inner(client, &folder._id, &next_prefix, depth - 1, folders_only)?;
    }
    for (j, file) in files.iter().enumerate() {
        let last = children.folders.len() + j + 1 == total;
        let (branch, _) = branch_chars(prefix, last);
        println!("{branch}{}", file.name);
    }
    Ok(())
}

fn branch_chars(prefix: &str, last: bool) -> (String, String) {
    if last {
        (format!("{prefix}└── "), format!("{prefix}    "))
    } else {
        (format!("{prefix}├── "), format!("{prefix}│   "))
    }
}

pub fn cat(path: &str) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let listing = resolve_file(&client, path)?;
    let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", listing._id))?;
    let file: FullFile = serde_json::from_value(resp["file"].clone())?;

    match file.content {
        Some(content) => {
            print!("{content}");
            if !content.ends_with('\n') {
                println!();
            }
            Ok(())
        }
        None => Err(format!(
            "'{}' has no inline content ({}) — use 'nopal vault download' instead",
            file.name, file.content_type
        )
        .into()),
    }
}

pub fn download(path: &str, output: Option<PathBuf>) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let listing = resolve_file(&client, path)?;
    let out = output.unwrap_or_else(|| PathBuf::from(&listing.name));

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
        let mut file = fs::File::create(&out)?;
        s3_resp.copy_to(&mut file)?;
    } else {
        // Markdown/text cards live in the DB — write their content directly.
        let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", listing._id))?;
        let file: FullFile = serde_json::from_value(resp["file"].clone())?;
        let content = file
            .content
            .ok_or_else(|| format!("'{}' has no downloadable content", file.name))?;
        fs::write(&out, content)?;
    }

    println!("Downloaded {} -> {}", listing.name, out.display());
    Ok(())
}

pub fn info(path: &str, json: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    match resolve(&client, path)? {
        Resolved::Root => Err("Provide a folder or file path".into()),
        Resolved::Folder(f) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "kind": "folder", "id": f._id, "name": f.name,
                        "vault_root_key": f.vault_root_key,
                        "shared": is_shared(&f), "public": f.is_public.unwrap_or(false),
                        "updated_at": f.updated_at,
                    })
                );
            } else {
                println!("kind:      folder");
                println!("id:        {}", f._id);
                println!("name:      {}", f.name);
                println!("root:      {}", f.vault_root_key.as_deref().unwrap_or("-"));
                println!("shared:    {}", if is_shared(&f) { "yes" } else { "no" });
                println!(
                    "public:    {}",
                    if f.is_public.unwrap_or(false) {
                        "yes"
                    } else {
                        "no (may still be public via a parent folder — see 'nopal vault link')"
                    }
                );
                println!("updated:   {}", format_date(&f.updated_at));
            }
            Ok(())
        }
        Resolved::File { file: listing } => {
            let resp: serde_json::Value =
                client.get_json(&format!("/api/vault/{}", listing._id))?;
            let f: FullFile = serde_json::from_value(resp["file"].clone())?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "kind": "file", "id": f._id, "name": f.name,
                        "content_type": f.content_type, "size": f.size,
                        "storage": if f.s3_key.is_some() { "s3" } else { "inline" },
                        "public": f.is_public.unwrap_or(false),
                        "created_at": f.created_at, "updated_at": f.updated_at,
                    })
                );
            } else {
                println!("kind:      file");
                println!("id:        {}", f._id);
                println!("name:      {}", f.name);
                println!("type:      {}", f.content_type);
                println!("size:      {}", format_size(f.size));
                println!(
                    "storage:   {}",
                    if f.s3_key.is_some() { "s3" } else { "inline" }
                );
                println!(
                    "public:    {}",
                    if f.is_public.unwrap_or(false) {
                        "yes"
                    } else {
                        "no"
                    }
                );
                println!("created:   {}", format_date(&f.created_at));
                println!("updated:   {}", format_date(&f.updated_at));
            }
            Ok(())
        }
    }
}

pub fn open(path: &str) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let url = match resolve(&client, path)? {
        Resolved::Root => format!("{}/fruits/vault", client.host),
        Resolved::Folder(f) => format!("{}/fruits/vault?folder={}", client.host, f._id),
        Resolved::File { file } => {
            format!("{}/fruits/vault?file={}", client.host, file._id)
        }
    };
    println!("Opening {url}");
    if open::that(&url).is_err() {
        println!("Couldn't open a browser automatically — open the link above manually.");
    }
    Ok(())
}

pub fn upload(local_files: &[PathBuf], to: &str) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let folder = resolve_folder(&client, to)?
        .ok_or("Files can't be uploaded to the vault root — pick a folder like personal/")?;

    for local in local_files {
        upload_one(&client, local, &folder)?;
    }
    Ok(())
}

/// Uploads one file, returning the created file_ref's id (used by sync's
/// state tracking).
pub(crate) fn upload_one(
    client: &Client,
    local: &Path,
    folder: &Folder,
) -> Result<String, Box<dyn Error>> {
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

    println!(
        "Uploading {} ({}) -> {}/ ...",
        name,
        format_size(Some(size)),
        folder.name
    );

    let file_id = if size <= MULTIPART_THRESHOLD {
        let form = reqwest::blocking::multipart::Form::new()
            .file("file", local)?
            .text("folderId", folder._id.clone());
        let resp: serde_json::Value = client.post_form("/api/vault/upload", form)?;
        resp["fileRef"]["_id"]
            .as_str()
            .ok_or("Upload did not return a file id")?
            .to_string()
    } else {
        upload_multipart(client, local, folder, &name, &content_type, size)?
    };

    println!("  ✓ {name}");
    Ok(file_id)
}

/// `mkdir -p` semantics: walks the path from the vault root and creates any
/// missing folders. The first segment must be an existing Vault Root Folder
/// (daily-logs / projects / personal) — the root itself is locked.
pub fn mkdir(path: &str) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let segments = split_path(path);
    if segments.is_empty() {
        return Err("Provide a folder path to create, e.g. projects/greenhouse".into());
    }

    let mut children = client.children("root")?;
    let mut current: Option<Folder> = None;
    let mut created_any = false;

    for (i, segment) in segments.iter().enumerate() {
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
        if children
            .files
            .iter()
            .any(|f| segment_matches(segment, &f.name))
        {
            return Err(format!("'{segment}' already exists as a file").into());
        }
        let parent = current.as_ref().ok_or_else(|| {
            format!(
                "'{segment}' can't be created at the vault root — folders live inside \
                 daily-logs/, projects/, or personal/"
            )
        })?;

        let resp: serde_json::Value = client.post_json(
            "/api/vault/folders",
            &serde_json::json!({ "name": segment, "parent_folder_id": parent._id }),
        )?;
        let folder: Folder = serde_json::from_value(resp["folder"].clone())?;
        println!("Created {}/", segments[..=i].join("/"));
        created_any = true;
        children = Children {
            folders: vec![],
            files: vec![],
        };
        current = Some(folder);
    }

    if !created_any {
        println!("Folder already exists.");
    }
    Ok(())
}

/// Move a folder into another folder (possibly across vault roots — e.g.
/// personal → projects). Shared folders, cycles, and root containers are
/// rejected server-side.
pub fn mv(src: &str, dest: &str) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let folder = resolve_folder(&client, src)?.ok_or("The vault root can't be moved")?;
    let dest_folder = resolve_folder(&client, dest)?
        .ok_or("Folders can't be moved to the vault root — pick a destination like projects/")?;
    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/folders/{}", folder._id),
        &serde_json::json!({ "parent_folder_id": dest_folder._id }),
    )?;
    println!("Moved {}/ -> {}/", folder.name, dest_folder.name);
    Ok(())
}

/// Rename a folder. (Files can't be renamed — matching the web UI.)
pub fn rename(path: &str, new_name: &str) -> Result<(), Box<dyn Error>> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.contains('/') {
        return Err("NEW_NAME must be a plain folder name (no '/')".into());
    }
    let client = Client::new()?;
    match resolve(&client, path)? {
        Resolved::Root => Err("The vault root can't be renamed".into()),
        Resolved::File { file } => Err(format!(
            "'{}' is a file — only folders can be renamed right now",
            file.name
        )
        .into()),
        Resolved::Folder(folder) => {
            let _: serde_json::Value = client.patch_json(
                &format!("/api/vault/folders/{}", folder._id),
                &serde_json::json!({ "name": new_name }),
            )?;
            println!("Renamed {}/ -> {new_name}/", folder.name);
            Ok(())
        }
    }
}

/// Replace a vault file's bytes in place — same file id, so links keep
/// working. Locked daily-log files are rejected server-side.
pub fn replace(local: &Path, vault_path: &str) -> Result<(), Box<dyn Error>> {
    let meta = fs::metadata(local).map_err(|e| format!("{}: {e}", local.display()))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", local.display()).into());
    }
    let client = Client::new()?;
    let listing = resolve_file(&client, vault_path)?;

    println!(
        "Replacing {} with {} ({}) ...",
        listing.name,
        local.display(),
        format_size(Some(meta.len()))
    );
    let form = reqwest::blocking::multipart::Form::new().file("file", local)?;
    let _: serde_json::Value =
        client.post_form(&format!("/api/vault/replace/{}", listing._id), form)?;
    println!("  ✓ {}", listing.name);
    Ok(())
}

/// Delete a vault file or folder. Non-empty folders need --recursive;
/// everything asks for confirmation unless --force. Root containers and
/// locked daily-log content are rejected server-side.
pub fn rm(path: &str, force: bool, recursive: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    match resolve(&client, path)? {
        Resolved::Root => Err("Provide a folder or file path to delete".into()),
        Resolved::File { file } => {
            if !force && !confirm(&format!("Delete '{}'? [y/N] ", file.name)) {
                println!("Aborted.");
                return Ok(());
            }
            let _: serde_json::Value = client.delete(&format!("/api/vault/{}", file._id))?;
            println!("Deleted {}", file.name);
            Ok(())
        }
        Resolved::Folder(folder) => {
            let children = client.children(&folder._id)?;
            let (n_folders, n_files) = (children.folders.len(), children.files.len());
            if (n_folders + n_files) > 0 && !recursive {
                return Err(format!(
                    "'{}' is not empty ({n_folders} folder(s), {n_files} file(s)) — \
                     pass --recursive to delete everything inside",
                    folder.name
                )
                .into());
            }
            if !force
                && !confirm(&format!(
                    "Delete '{}/' and everything inside it? [y/N] ",
                    folder.name
                ))
            {
                println!("Aborted.");
                return Ok(());
            }
            let _: serde_json::Value =
                client.delete(&format!("/api/vault/folders/{}", folder._id))?;
            println!("Deleted {}/", folder.name);
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct RelatedHuman {
    _id: String,
    name: String,
    email: String,
}

fn related_humans(client: &Client) -> Result<Vec<RelatedHuman>, Box<dyn Error>> {
    let resp: serde_json::Value = client.get_json("/api/humans/related")?;
    Ok(serde_json::from_value(resp["humans"].clone())?)
}

/// Show or change a folder's sharing. With no mode flags this prints the
/// current sharing state. `--with` REPLACES the audience list (it doesn't
/// add to it). Sharing is only allowed inside `projects/` — the server
/// rejects everything else.
pub fn share(
    path: &str,
    everyone: bool,
    private: bool,
    with: &[String],
) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let folder = match resolve(&client, path)? {
        Resolved::Root => return Err("The vault root can't be shared".into()),
        Resolved::File { file } => {
            return Err(format!("'{}' is a file — sharing works on folders", file.name).into())
        }
        Resolved::Folder(f) => f,
    };

    // ── No flags: show the current state ────────────────────────────────
    if !everyone && !private && with.is_empty() {
        match &folder.shared_with {
            serde_json::Value::String(s) if s == "everyone" => {
                println!("{}/ is shared with everyone", folder.name);
            }
            serde_json::Value::Array(ids) if !ids.is_empty() => {
                let humans = related_humans(&client).unwrap_or_default();
                println!("{}/ is shared with:", folder.name);
                for id in ids {
                    let id = id.as_str().unwrap_or_default();
                    match humans.iter().find(|h| h._id == id) {
                        Some(h) => println!("  {} <{}>", h.name, h.email),
                        None => println!("  {id}"),
                    }
                }
            }
            _ => println!("{}/ is private (only you)", folder.name),
        }
        return Ok(());
    }

    // ── Build the new shared_with value ─────────────────────────────────
    let shared_with: serde_json::Value = if everyone {
        serde_json::Value::String("everyone".to_string())
    } else if private {
        serde_json::json!([])
    } else {
        let humans = related_humans(&client)?;
        let mut ids = Vec::new();
        let mut matched = Vec::new();
        let mut unknown = Vec::new();
        for email in with {
            let want = email.trim().to_lowercase();
            match humans
                .iter()
                .find(|h| h.email.trim().to_lowercase() == want)
            {
                Some(h) => {
                    ids.push(h._id.clone());
                    matched.push(format!("{} <{}>", h.name, h.email));
                }
                None => unknown.push(email.clone()),
            }
        }
        if !unknown.is_empty() {
            return Err(format!(
                "No shareable human found for: {}\n(They need an account and a \
                 relationship with you — see who's available on your profile page.)",
                unknown.join(", ")
            )
            .into());
        }
        println!("Sharing {}/ with:", folder.name);
        for m in &matched {
            println!("  {m}");
        }
        serde_json::json!(ids)
    };

    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/folders/{}", folder._id),
        &serde_json::json!({ "shared_with": shared_with }),
    )?;

    if everyone {
        println!("{}/ is now shared with everyone", folder.name);
    } else if private {
        println!("{}/ is now private", folder.name);
    } else {
        println!("  ✓ shared");
    }
    Ok(())
}

// ─── Publish ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Publishing is a folder-only, boolean flag (`is_public`), separate from
// `share` — sharing grants access to specific Nopal humans, publishing
// makes the folder (and everything in it, including things added later,
// resolved dynamically server-side) reachable at a public URL with no
// account at all. Only allowed inside publishable roots (currently
// projects/, personal/, syncs/ — not daily-logs/); the server rejects
// anything else.

fn public_url(host: &str, kind: &str, id: &str) -> String {
    format!("{host}/public/{kind}/{id}")
}

fn maybe_copy(url: &str, copy: bool) {
    if !copy {
        return;
    }
    match arboard::Clipboard::new().and_then(|mut cb| cb.set_text(url.to_string())) {
        Ok(()) => println!("(copied to clipboard)"),
        Err(e) => eprintln!("Couldn't copy to clipboard ({e}) — link printed above."),
    }
}

/// Publish a folder — it (and everything inside it, including anything
/// added later) becomes reachable at a public URL with no login required.
pub fn publish(path: &str, copy: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let folder = match resolve(&client, path)? {
        Resolved::Root => return Err("The vault root can't be published".into()),
        Resolved::File { file } => {
            return Err(format!(
                "'{}' is a file — publish the folder it's in, or use \
                 'nopal vault link' to grab a link to just this file",
                file.name
            )
            .into())
        }
        Resolved::Folder(f) => f,
    };

    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/folders/{}", folder._id),
        &serde_json::json!({ "is_public": true }),
    )?;

    let url = public_url(&client.host, "folder", &folder._id);
    println!(
        "Published {}/ — anyone with this link can view it:",
        folder.name
    );
    println!("{url}");
    maybe_copy(&url, copy);
    Ok(())
}

/// Unpublish a folder that was published directly (not one that's only
/// public because a parent folder is published — unpublish that parent to
/// revoke it).
pub fn unpublish(path: &str) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let folder = match resolve(&client, path)? {
        Resolved::Root => return Err("The vault root can't be unpublished".into()),
        Resolved::File { file } => {
            return Err(format!("'{}' is a file, not a folder", file.name).into())
        }
        Resolved::Folder(f) => f,
    };

    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/folders/{}", folder._id),
        &serde_json::json!({ "is_public": false }),
    )?;
    println!("Unpublished {}/", folder.name);
    Ok(())
}

/// Prints (and optionally copies) the public link for a folder or file.
/// Works for anything publicly reachable, not just folders you've directly
/// published — e.g. a file inside a published folder, or a folder that
/// inherits publicness from a published ancestor. Rather than re-deriving
/// that inheritance client-side, this asks the live public page directly
/// (no auth) and reports what it finds — always authoritative.
pub fn link(path: &str, copy: bool) -> Result<(), Box<dyn Error>> {
    let client = Client::new()?;
    let (kind, id, name) = match resolve(&client, path)? {
        Resolved::Root => return Err("The vault root doesn't have a public link".into()),
        Resolved::Folder(f) => ("folder", f._id, f.name),
        Resolved::File { file } => ("file", file._id, file.name),
    };

    let url = public_url(&client.host, kind, &id);
    let reachable = client
        .http
        .get(&url)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    if !reachable {
        return Err(format!(
            "'{name}' isn't published. Publish it (or a parent folder) first:\n  \
             nopal vault publish {path}"
        )
        .into());
    }

    println!("{url}");
    maybe_copy(&url, copy);
    Ok(())
}

fn upload_multipart(
    client: &Client,
    local: &Path,
    folder: &Folder,
    name: &str,
    content_type: &str,
    size: u64,
) -> Result<String, Box<dyn Error>> {
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
    );
    if result.is_err() {
        let _: Result<serde_json::Value, _> = client.post_json(
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
) -> Result<String, Box<dyn Error>> {
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
        let chunk_part = reqwest::blocking::multipart::Part::bytes(buf[..filled].to_vec())
            .file_name("chunk")
            .mime_str("application/octet-stream")?;
        let form = reqwest::blocking::multipart::Form::new()
            .text("uploadId", upload_id.to_string())
            .text("key", key.to_string())
            .text("partNumber", part_number.to_string())
            .part("chunk", chunk_part);

        let resp: serde_json::Value = client.post_form("/api/vault/multipart-part", form)?;
        let etag = resp["ETag"]
            .as_str()
            .ok_or_else(|| format!("No ETag for part {part_number}"))?;
        parts.push(serde_json::json!({ "PartNumber": part_number, "ETag": etag }));

        print!("\r  part {part_number}/{total_parts}");
        use std::io::Write;
        std::io::stdout().flush().ok();

        part_number += 1;
        if filled < buf.len() {
            break;
        }
    }
    println!();

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
