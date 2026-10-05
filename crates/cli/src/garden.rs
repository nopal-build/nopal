//! `nopal garden ...` — Kanban Garden board helpers layered on top of the
//! generic `nopal vault` primitives, same shape as `nopal sync-api`/`nopal
//! graphlog`/`nopal sort` (a narrow, purpose-built subcommand tree on top
//! of lower-level vault commands, not a new idiom). See the `vault` skill
//! and the `kanban-garden-vault-plumbing` garden seed.
//!
//! **Not a security boundary.** Both commands here use the same
//! already-authenticated session as any other `nopal vault` command —
//! there's no scoped credential for board movement. Everything they do
//! could also be done with the lower-level `nopal vault mkdir`/`nopal
//! vault mv` directly; their only value is ergonomics/safety-rails:
//! resolving a card's own board automatically from its path, and catching
//! a typo'd destination column before anything actually moves.

use std::error::Error;

use nopal_core::vault::{
    resolve_with_ancestors, segment_matches, split_path, Children, Client, Folder, Resolved,
};

/// Creates a new Kanban Garden board anchor at `path`, creating any
/// missing intermediate folders as plain folders along the way (same
/// `mkdir -p` semantics as `nopal vault mkdir`) — except the FINAL
/// segment, which is created with `folder_type: "kanban-garden"`. The
/// server validates `path`'s parent is a context this type actually
/// allows (directly inside `projects`, inside a project, or inside
/// `personal` — see `validateFolderTypeForParent`).
///
/// Columns are **not** auto-created — run plain `nopal vault mkdir
/// <path>/<column-name>` for each one afterward; that's already fully
/// general and needs no board-specific support.
pub fn init(path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let segments = split_path(path);
    if segments.is_empty() {
        return Err("Provide a board path to create, e.g. projects/roadmap".into());
    }

    let mut children = client.children("root")?;
    let mut current: Option<Folder> = None;

    for (i, segment) in segments.iter().enumerate() {
        let is_last = i + 1 == segments.len();

        if let Some(folder) = children
            .folders
            .iter()
            .find(|f| segment_matches(segment, &f.name))
            .cloned()
        {
            if is_last {
                return Err(format!(
                    "'{}' already exists — 'nopal garden init' only creates a NEW board \
                     (an existing folder can't be retyped in place)",
                    segments.join("/")
                )
                .into());
            }
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
            "A board can't be created at the vault root — pick a path like \
             projects/roadmap, projects/some-project/roadmap, or personal/roadmap"
                .to_string()
        })?;

        let body = if is_last {
            serde_json::json!({
                "name": segment,
                "parent_folder_id": parent._id,
                "folder_type": "kanban-garden",
            })
        } else {
            serde_json::json!({ "name": segment, "parent_folder_id": parent._id })
        };

        let resp: serde_json::Value = client.post_json("/api/vault/folders", &body)?;
        let folder: Folder = serde_json::from_value(resp["folder"].clone())?;

        if is_last {
            println!("Created Kanban Garden board: {}/", segments.join("/"));
        } else {
            println!("Created {}/", segments[..=i].join("/"));
        }

        children = Children {
            folders: vec![],
            files: vec![],
        };
        current = Some(folder);
    }

    Ok(())
}

/// Moves a card to a different column within its OWN Kanban Garden
/// board. `card` must be a full vault path (same convention every other
/// `nopal vault` command already uses) — the board is found
/// automatically by walking that path's ancestor chain, so there's no
/// `--board`/`--project` flag to pass.
pub fn mv(card: &str, column: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let (ancestors, resolved) = resolve_with_ancestors(&client, card)?;

    let file = match resolved {
        Resolved::File { file } => file,
        Resolved::Root => return Err("Provide a card path, not the vault root".into()),
        Resolved::Folder(f) => return Err(format!("'{}' is a folder, not a card", f.name).into()),
    };

    let current_column = ancestors
        .last()
        .ok_or("A card can't live at the vault root")?;

    let anchor_pos = ancestors
        .iter()
        .rposition(|f| {
            f.is_folder_type_root == Some(true) && f.folder_type.as_deref() == Some("kanban-garden")
        })
        .ok_or_else(|| format!("'{card}' isn't inside a Kanban Garden board"))?;
    let anchor = &ancestors[anchor_pos];

    // The card's own column must be a DIRECT child of the anchor — not the
    // anchor itself (a card dropped straight in the board root, no column
    // yet) and not nested any deeper than one column folder.
    if anchor_pos + 1 != ancestors.len() - 1 {
        return Err(format!(
            "'{}' must live directly inside one of the '{}' board's column folders",
            file.name, anchor.name
        )
        .into());
    }

    let siblings = client.children(&anchor._id)?;
    let destination = siblings
        .folders
        .iter()
        .find(|f| segment_matches(column, &f.name))
        .ok_or_else(|| {
            let valid: Vec<&str> = siblings.folders.iter().map(|f| f.name.as_str()).collect();
            format!(
                "'{column}' isn't a column on the '{}' board. Valid columns: {}",
                anchor.name,
                if valid.is_empty() {
                    "(none)".to_string()
                } else {
                    valid.join(", ")
                }
            )
        })?;

    if destination._id == current_column._id {
        println!("'{}' is already in '{}'", file.name, destination.name);
        return Ok(());
    }

    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/{}", file._id),
        &serde_json::json!({ "folder_id": destination._id }),
    )?;
    println!(
        "Moved '{}': {} -> {}",
        file.name, current_column.name, destination.name
    );
    Ok(())
}
