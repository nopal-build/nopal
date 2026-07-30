//! `nopal vault ...` — work with the Nopal Vault from the terminal.
//!
//! Commands address content by *path* (e.g. `projects/sunny/readme.md`),
//! resolved by walking the children API from the vault root. All policy
//! (locked root folders, daily-log locks, sharing rules) is enforced
//! server-side; this module just surfaces the server's error messages.
//!
//! The actual HTTP client, path resolution, and upload/download mechanics
//! live in `nopal_core::vault` (shared with the native app) — this module
//! is the CLI-specific presentation layer on top: printing, `--json`,
//! interactive confirmation prompts, and clipboard/browser integration.

use serde::Deserialize;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) use nopal_core::vault::{
    format_date, format_size, is_shared, resolve, resolve_file, resolve_folder, segment_matches,
    split_path, Children, Client, FileListing, Folder, Resolved,
};

// ─── Output helpers ───────────────────────────────────────────────────────────

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

pub fn ls(path: &str, json: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
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

pub fn tree(path: &str, depth: u32, folders_only: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
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
) -> Result<(), Box<dyn Error + Send + Sync>> {
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

pub fn cat(path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let listing = resolve_file(&client, path)?;
    let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", listing._id))?;
    let file: nopal_core::vault::FullFile = serde_json::from_value(resp["file"].clone())?;

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

pub fn download(path: &str, output: Option<PathBuf>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let listing = resolve_file(&client, path)?;
    let out = output.unwrap_or_else(|| PathBuf::from(&listing.name));

    nopal_core::vault::download_file(&client, &listing, &out)?;

    println!("Downloaded {} -> {}", listing.name, out.display());
    Ok(())
}

pub fn info(path: &str, json: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
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
            let f: nopal_core::vault::FullFile = serde_json::from_value(resp["file"].clone())?;
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

pub fn open(path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
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

pub fn upload(local_files: &[PathBuf], to: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let folder = resolve_folder(&client, to)?
        .ok_or("Files can't be uploaded to the vault root — pick a folder like personal/")?;

    for local in local_files {
        upload_one(&client, local, &folder)?;
    }
    Ok(())
}

/// Uploads one file, printing progress, and returning the created
/// file_ref's id (used by sync's state tracking). A thin, printing wrapper
/// over `nopal_core::vault::upload_file`.
pub(crate) fn upload_one(
    client: &Client,
    local: &Path,
    folder: &Folder,
) -> Result<String, Box<dyn Error + Send + Sync>> {
    let meta = fs::metadata(local).map_err(|e| format!("{}: {e}", local.display()))?;
    let name = local
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    println!(
        "Uploading {} ({}) -> {}/ ...",
        name,
        format_size(Some(meta.len())),
        folder.name
    );

    let mut printed_progress = false;
    let uploaded = nopal_core::vault::upload_file(client, local, folder, |progress| {
        let nopal_core::vault::UploadProgress::Part {
            part_number,
            total_parts,
        } = progress;
        print!("\r  part {part_number}/{total_parts}");
        use std::io::Write;
        std::io::stdout().flush().ok();
        printed_progress = true;
    })?;
    if printed_progress {
        println!();
    }
    println!("  ✓ {}", uploaded.name);
    Ok(uploaded.file_id)
}

/// `mkdir -p` semantics: walks the path from the vault root and creates any
/// missing folders. The first segment must be an existing Vault Root Folder
/// (daily-logs / projects / personal) — the root itself is locked.
pub fn mkdir(path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
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
pub fn mv(src: &str, dest: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
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
pub fn rename(path: &str, new_name: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
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
pub fn replace(local: &Path, vault_path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
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
    let _: serde_json::Value = client
        .post_form(&format!("/api/vault/replace/{}", listing._id), || {
            Ok(reqwest::blocking::multipart::Form::new().file("file", local)?)
        })?;
    println!("  ✓ {}", listing.name);
    Ok(())
}

/// Delete a vault file or folder. Non-empty folders need --recursive;
/// everything asks for confirmation unless --force. Root containers and
/// locked daily-log content are rejected server-side.
pub fn rm(path: &str, force: bool, recursive: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
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

fn related_humans(client: &Client) -> Result<Vec<RelatedHuman>, Box<dyn Error + Send + Sync>> {
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
) -> Result<(), Box<dyn Error + Send + Sync>> {
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
pub fn publish(path: &str, copy: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
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
pub fn unpublish(path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
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
pub fn link(path: &str, copy: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let (kind, id, name) = match resolve(&client, path)? {
        Resolved::Root => return Err("The vault root doesn't have a public link".into()),
        Resolved::Folder(f) => ("folder", f._id, f.name),
        Resolved::File { file } => ("file", file._id, file.name),
    };

    let url = public_url(&client.host, kind, &id);
    if !client.get_reachable(&url) {
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
