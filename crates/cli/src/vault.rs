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
struct Children {
    folders: Vec<Folder>,
    files: Vec<FileListing>,
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

struct Client {
    http: reqwest::blocking::Client,
    host: String,
    token: String,
}

impl Client {
    fn new() -> Result<Self, Box<dyn Error>> {
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

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.host, path)
    }

    /// GET returning JSON, with a friendly error for non-2xx responses.
    fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, Box<dyn Error>> {
        let resp = self
            .http
            .get(self.url(path))
            .bearer_auth(&self.token)
            .send()?;
        Self::parse(resp)
    }

    fn post_json<T: serde::de::DeserializeOwned>(
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

    fn post_form<T: serde::de::DeserializeOwned>(
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

    fn children(&self, folder_id: &str) -> Result<Children, Box<dyn Error>> {
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

fn format_size(size: Option<u64>) -> String {
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
                        "shared": is_shared(&f), "updated_at": f.updated_at,
                    })
                );
            } else {
                println!("kind:      folder");
                println!("id:        {}", f._id);
                println!("name:      {}", f.name);
                println!("root:      {}", f.vault_root_key.as_deref().unwrap_or("-"));
                println!("shared:    {}", if is_shared(&f) { "yes" } else { "no" });
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

fn upload_one(client: &Client, local: &Path, folder: &Folder) -> Result<(), Box<dyn Error>> {
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

    if size <= MULTIPART_THRESHOLD {
        let form = reqwest::blocking::multipart::Form::new()
            .file("file", local)?
            .text("folderId", folder._id.clone());
        let _: serde_json::Value = client.post_form("/api/vault/upload", form)?;
    } else {
        upload_multipart(client, local, folder, &name, &content_type, size)?;
    }

    println!("  ✓ {name}");
    Ok(())
}

fn upload_multipart(
    client: &Client,
    local: &Path,
    folder: &Folder,
    name: &str,
    content_type: &str,
    size: u64,
) -> Result<(), Box<dyn Error>> {
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
) -> Result<(), Box<dyn Error>> {
    let mut file = fs::File::open(local)?;
    let mut parts: Vec<serde_json::Value> = Vec::new();
    let total_parts = size.div_ceil(MULTIPART_CHUNK as u64);
    let mut part_number: u32 = 1;
    let mut buf = vec![0u8; MULTIPART_CHUNK];

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

    let _: serde_json::Value = client.post_json(
        "/api/vault/multipart-complete",
        &serde_json::json!({
            "uploadId": upload_id,
            "key": key,
            "parts": parts,
            "name": name,
            "folderId": folder._id,
            "contentType": content_type,
            "size": size,
        }),
    )?;
    Ok(())
}
