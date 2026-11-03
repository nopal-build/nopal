//! `nopal garden ...` (alias: `nopal kanban ...`) — Kanban Garden board
//! helpers layered on top of the generic `nopal vault` primitives, same
//! shape as `nopal sync-api`/`nopal graphlog`/`nopal sort` (a narrow,
//! purpose-built subcommand tree on top of lower-level vault commands,
//! not a new idiom). See the `vault` skill and the
//! `kanban-garden-vault-plumbing`/`guide-projects-phases` garden seeds.
//!
//! **Not a security boundary.** Every command here uses the same
//! already-authenticated session as any other `nopal vault` command —
//! there's no scoped credential for board movement. Everything they do
//! could also be done with the lower-level `nopal vault` primitives
//! directly; their value is ergonomics/safety-rails: resolving a card's
//! own board automatically from its path, catching a typo'd destination
//! column before anything actually moves, and (`phase`/`columns`)
//! understanding a board's own README-declared, ORDERED phase list
//! (`phases: [{name, type}]` front matter — see `guide-projects-phases`),
//! which no generic `nopal vault` command has any concept of.

use std::error::Error;
use std::path::Path;

use nopal_core::vault::{
    resolve_file, resolve_folder, resolve_with_ancestors, segment_matches, split_path, Children,
    Client, Folder, FullFile, Resolved,
};
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;

/// A board anchor's declared phase, from its README's `phases:` front
/// matter (`guide-projects-phases`) — `type` defaults to `"normal"` when
/// absent, same convention the webapp's own `guideProjectsBoard.server.ts`
/// uses. Independent of whether the matching column folder actually
/// exists yet (`phase add` creates both together; the two CAN drift if
/// someone edits the README by hand, same as the webapp side already
/// tolerates — see `listBoardPhases`'s own doc there).
#[derive(Debug, Clone, Deserialize, Serialize)]
struct PhaseDef {
    name: String,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    phase_type: Option<String>,
}

impl PhaseDef {
    fn type_or_default(&self) -> &str {
        self.phase_type.as_deref().unwrap_or("normal")
    }
}

/// Prefers the README-declared display name (e.g. "Seed") over the
/// folder's own literal name (e.g. "seed") when both exist — purely
/// cosmetic, for `columns`/`cards` output; every actual lookup still
/// matches case-insensitively via `segment_matches`, so this never
/// affects behavior, only what gets printed.
fn display_name<'a>(folder: &'a Folder, def: &'a Option<PhaseDef>) -> &'a str {
    def.as_ref()
        .map(|d| d.name.as_str())
        .unwrap_or(&folder.name)
}

/// Splits a markdown string into (frontmatter YAML text, body) — mirrors
/// the webapp's own `splitFrontmatter` (`project.types.ts`); this needs
/// to read/write the exact same shape. `None` frontmatter when there's
/// no leading `---` block.
fn split_frontmatter(markdown: &str) -> (Option<&str>, &str) {
    let Some(rest) = markdown
        .strip_prefix("---\n")
        .or_else(|| markdown.strip_prefix("---\r\n"))
    else {
        return (None, markdown);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return (Some(&rest[..offset]), &rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    (None, markdown)
}

/// Rebuilds a markdown string from a (possibly mutated) YAML mapping plus
/// the ORIGINAL body (untouched) — mirrors `withProjectStatus`'s own
/// "preserve every other field" convention. An empty mapping removes the
/// front matter block entirely.
fn with_frontmatter(body: &str, data: &serde_yaml::Mapping) -> Result<String> {
    if data.is_empty() {
        return Ok(body.to_string());
    }
    let yaml_text = serde_yaml::to_string(&serde_yaml::Value::Mapping(data.clone()))?;
    Ok(format!("---\n{}---\n{body}", yaml_text))
}

fn parse_frontmatter_mapping(fm: Option<&str>) -> serde_yaml::Mapping {
    let Some(fm) = fm else {
        return serde_yaml::Mapping::new();
    };
    match serde_yaml::from_str::<serde_yaml::Value>(fm) {
        Ok(serde_yaml::Value::Mapping(m)) => m,
        _ => serde_yaml::Mapping::new(),
    }
}

fn read_phase_defs(fm: Option<&str>) -> Vec<PhaseDef> {
    let mapping = parse_frontmatter_mapping(fm);
    let Some(phases) = mapping.get(serde_yaml::Value::String("phases".to_string())) else {
        return Vec::new();
    };
    serde_yaml::from_value(phases.clone()).unwrap_or_default()
}

/// Fetches an anchor's own `README.md` full content, if it has one —
/// `None` (not an error) for a board with no README at all, which is a
/// perfectly valid (just undeclared-order) board.
fn read_board_readme(client: &Client, anchor: &Folder) -> Result<Option<FullFile>> {
    let children = client.children(&anchor._id)?;
    let Some(listing) = children
        .files
        .iter()
        .find(|f| f.name.eq_ignore_ascii_case("README.md"))
    else {
        return Ok(None);
    };
    let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", listing._id))?;
    Ok(Some(serde_json::from_value(resp["file"].clone())?))
}

/// Resolves `path` and confirms it's really a Kanban Garden anchor (its
/// OWN `folder_type`, not merely inherited from one, same distinction
/// `is_folder_type_root` exists for) — the one check every command below
/// that takes a `<board-path>` needs first.
fn resolve_anchor(client: &Client, path: &str) -> Result<Folder> {
    let folder = resolve_folder(client, path)?
        .ok_or_else(|| format!("'{path}' is the vault root, not a board"))?;
    if folder.is_folder_type_root != Some(true)
        || folder.folder_type.as_deref() != Some("kanban-garden")
    {
        return Err(format!("'{path}' isn't a Kanban Garden board anchor").into());
    }
    Ok(folder)
}

/// An anchor's direct subfolders (its columns), in README-declared order
/// when the README declares one (`phases:` front matter, matched
/// case-insensitively by name) — any column folder NOT named in that
/// list is appended afterward, alphabetically (the server's own default
/// order), rather than silently hidden; any DECLARED phase with no
/// matching folder is simply skipped (same "don't fail closed" tolerance
/// `listBoardPhases` already has on the webapp side).
fn ordered_columns(client: &Client, anchor: &Folder) -> Result<Vec<(Folder, Option<PhaseDef>)>> {
    let children = client.children(&anchor._id)?;
    let readme = read_board_readme(client, anchor)?;
    let (fm, _) = readme
        .as_ref()
        .and_then(|r| r.content.as_deref())
        .map(split_frontmatter)
        .unwrap_or((None, ""));
    let phase_defs = read_phase_defs(fm);

    let mut ordered: Vec<(Folder, Option<PhaseDef>)> = Vec::new();
    let mut used = vec![false; children.folders.len()];
    for def in &phase_defs {
        if let Some((i, folder)) = children
            .folders
            .iter()
            .enumerate()
            .find(|(i, f)| !used[*i] && segment_matches(&def.name, &f.name))
        {
            used[i] = true;
            ordered.push((folder.clone(), Some(def.clone())));
        }
    }
    for (i, folder) in children.folders.iter().enumerate() {
        if !used[i] {
            ordered.push((folder.clone(), None));
        }
    }
    Ok(ordered)
}

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
pub fn init(path: &str) -> Result<()> {
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
pub fn mv(card: &str, column: &str) -> Result<()> {
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

/// Lists every Kanban Garden board anchor reachable under `scope`
/// (recursively) — no server endpoint for this, so it's a plain walk,
/// same cost class as e.g. `nopal vault tree`. `scope` empty (default)
/// means the whole vault.
pub fn boards(scope: &str, json: bool) -> Result<()> {
    let client = Client::new()?;
    let start_id = match resolve_folder(&client, scope)? {
        Some(f) => f._id,
        None => "root".to_string(),
    };
    let start_path = split_path(scope).join("/");

    let mut found: Vec<String> = Vec::new();
    let mut stack: Vec<(String, String)> = vec![(start_id, start_path)];
    while let Some((folder_id, path)) = stack.pop() {
        let children = client.children(&folder_id)?;
        for folder in children.folders {
            let child_path = if path.is_empty() {
                folder.name.clone()
            } else {
                format!("{path}/{}", folder.name)
            };
            if folder.is_folder_type_root == Some(true)
                && folder.folder_type.as_deref() == Some("kanban-garden")
            {
                found.push(child_path.clone());
            }
            stack.push((folder._id.clone(), child_path));
        }
    }
    found.sort();

    if json {
        println!("{}", serde_json::to_string_pretty(&found)?);
    } else if found.is_empty() {
        println!(
            "No Kanban Garden boards found under '{}'.",
            if scope.is_empty() { "/" } else { scope }
        );
    } else {
        for b in &found {
            println!("{b}");
        }
    }
    Ok(())
}

/// Lists a board's columns, in README-declared order when it has one
/// (see `ordered_columns`), with each column's declared TYPE shown when
/// known.
pub fn columns(board: &str, json: bool) -> Result<()> {
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let ordered = ordered_columns(&client, &anchor)?;

    if json {
        let out: Vec<serde_json::Value> = ordered
            .iter()
            .map(|(f, def)| {
                serde_json::json!({
                    "name": display_name(f, def),
                    "folder_name": f.name,
                    "type": def.as_ref().map(|d| d.type_or_default().to_string()),
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&out)?);
        return Ok(());
    }

    if ordered.is_empty() {
        println!("No columns yet on '{}'.", anchor.name);
        return Ok(());
    }
    for (folder, def) in &ordered {
        match def {
            Some(d) => println!("{} ({})", display_name(folder, def), d.type_or_default()),
            None => println!("{}", folder.name),
        }
    }
    Ok(())
}

/// Lists cards — every column's, or just one's when `column` is given,
/// with each card's front-matter `title` shown inline when a markdown
/// card happens to have one readable this cheaply; otherwise just its
/// file name (a full per-card content fetch for every listing would be
/// one request per card, not worth it for a quick overview — use `nopal
/// garden show <card>` for a single card's actual content).
pub fn cards(board: &str, column: Option<&str>, json: bool) -> Result<()> {
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let ordered = ordered_columns(&client, &anchor)?;

    let selected: Vec<&(Folder, Option<PhaseDef>)> = match column {
        Some(name) => {
            let found = ordered.iter().find(|(f, _)| segment_matches(name, &f.name));
            match found {
                Some(c) => vec![c],
                None => {
                    let valid: Vec<&str> = ordered.iter().map(|(f, _)| f.name.as_str()).collect();
                    return Err(format!(
                        "'{name}' isn't a column on '{}'. Valid columns: {}",
                        anchor.name,
                        if valid.is_empty() {
                            "(none)".to_string()
                        } else {
                            valid.join(", ")
                        }
                    )
                    .into());
                }
            }
        }
        None => ordered.iter().collect(),
    };

    #[derive(Serialize)]
    struct CardRow {
        column: String,
        name: String,
    }
    let mut rows: Vec<CardRow> = Vec::new();
    for (folder, def) in &selected {
        let children = client.children(&folder._id)?;
        for f in children
            .files
            .iter()
            .filter(|f| !f.name.eq_ignore_ascii_case("README.md"))
        {
            rows.push(CardRow {
                column: display_name(folder, def).to_string(),
                name: f.name.clone(),
            });
        }
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&rows)?);
        return Ok(());
    }
    if rows.is_empty() {
        println!("No cards found.");
        return Ok(());
    }
    let mut last_column: Option<&str> = None;
    for row in &rows {
        if last_column != Some(row.column.as_str()) {
            println!("{}:", row.column);
            last_column = Some(row.column.as_str());
        }
        println!("  {}", row.name);
    }
    Ok(())
}

/// Creates a new card directly in a column, validating the destination
/// is a real column of a real Kanban Garden board first (a clearer error
/// than a generic `nopal vault upload` into the wrong place). With
/// `--file`, that local file's content becomes the card's content
/// (created blank, then its content replaced in one extra PATCH — both
/// already-generic, already-existing endpoints; no new server-side
/// capability needed).
pub fn new_card(board: &str, column: &str, name: &str, file: Option<&Path>) -> Result<()> {
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
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

    let resp: serde_json::Value = client.post_json(
        "/api/vault/files",
        &serde_json::json!({ "name": name, "folder_id": destination._id }),
    )?;
    let created: FullFile = serde_json::from_value(resp["file"].clone())?;

    if let Some(path) = file {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let _: serde_json::Value = client.patch_json(
            &format!("/api/vault/{}", created._id),
            &serde_json::json!({ "content": content }),
        )?;
    }

    println!(
        "Created '{}' in {}/{}",
        created.name, anchor.name, destination.name
    );
    Ok(())
}

/// Prints a card's full content (front matter + body) — for scripting,
/// or an agent inspecting a board non-interactively without needing to
/// download it to disk first (`nopal vault download` already exists for
/// that; this is the read-only, no-file-left-behind equivalent).
pub fn show(card: &str) -> Result<()> {
    let client = Client::new()?;
    let file = resolve_file(&client, card)?;
    let resp: serde_json::Value = client.get_json(&format!("/api/vault/{}", file._id))?;
    let full: FullFile = serde_json::from_value(resp["file"].clone())?;
    match full.content {
        Some(content) => print!("{content}"),
        None => println!(
            "'{}' has no text content (binary/attachment file).",
            full.name
        ),
    }
    Ok(())
}

// ─── Phase editing — the board's README `phases:` front matter ───────────

fn validate_phase_type(phase_type: &str) -> Result<()> {
    if !["start", "normal", "end"].contains(&phase_type) {
        return Err(
            format!("Unknown phase type '{phase_type}' — must be start, normal, or end").into(),
        );
    }
    Ok(())
}

fn load_phases_and_readme(
    client: &Client,
    anchor: &Folder,
) -> Result<(Vec<PhaseDef>, Option<FullFile>)> {
    let readme = read_board_readme(client, anchor)?;
    let (fm, _) = readme
        .as_ref()
        .and_then(|r| r.content.as_deref())
        .map(split_frontmatter)
        .unwrap_or((None, ""));
    let phases = read_phase_defs(fm);
    Ok((phases, readme))
}

fn save_phases(
    client: &Client,
    anchor: &Folder,
    readme: Option<&FullFile>,
    phases: &[PhaseDef],
) -> Result<()> {
    let content = readme.and_then(|r| r.content.clone()).unwrap_or_default();
    let (fm, body) = split_frontmatter(&content);
    let mut mapping = parse_frontmatter_mapping(fm);
    mapping.insert(
        serde_yaml::Value::String("phases".to_string()),
        serde_yaml::to_value(phases)?,
    );
    let new_content = with_frontmatter(body, &mapping)?;

    let readme_id = match readme {
        Some(r) => r._id.clone(),
        None => {
            let resp: serde_json::Value = client.post_json(
                "/api/vault/files",
                &serde_json::json!({ "name": "README", "folder_id": anchor._id }),
            )?;
            let created: FullFile = serde_json::from_value(resp["file"].clone())?;
            created._id
        }
    };
    let _: serde_json::Value = client.patch_json(
        &format!("/api/vault/{readme_id}"),
        &serde_json::json!({ "content": new_content }),
    )?;
    Ok(())
}

/// Declares a new phase (and creates its matching column folder, if one
/// doesn't already exist) — appended at the end, or inserted right after
/// `after` when given.
pub fn phase_add(board: &str, name: &str, phase_type: &str, after: Option<&str>) -> Result<()> {
    validate_phase_type(phase_type)?;
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let (mut phases, readme) = load_phases_and_readme(&client, &anchor)?;

    if phases.iter().any(|p| segment_matches(name, &p.name)) {
        return Err(format!("'{name}' is already a phase on '{}'", anchor.name).into());
    }

    let new_phase = PhaseDef {
        name: name.to_string(),
        phase_type: Some(phase_type.to_string()),
    };
    match after {
        Some(after_name) => {
            let idx = phases
                .iter()
                .position(|p| segment_matches(after_name, &p.name))
                .ok_or_else(|| {
                    format!(
                        "'{after_name}' isn't an existing phase on '{}'",
                        anchor.name
                    )
                })?;
            phases.insert(idx + 1, new_phase);
        }
        None => phases.push(new_phase),
    }

    save_phases(&client, &anchor, readme.as_ref(), &phases)?;

    let siblings = client.children(&anchor._id)?;
    if !siblings
        .folders
        .iter()
        .any(|f| segment_matches(name, &f.name))
    {
        let _: serde_json::Value = client.post_json(
            "/api/vault/folders",
            &serde_json::json!({ "name": name, "parent_folder_id": anchor._id }),
        )?;
    }

    println!("Added phase '{name}' ({phase_type}) to '{}'", anchor.name);
    Ok(())
}

/// Removes a phase from the board's declared list — refuses if its
/// matching column still has cards in it. The column folder itself is
/// deliberately left in place either way (non-destructive); delete it
/// separately with `nopal vault rm` if it should actually go away too.
pub fn phase_rm(board: &str, name: &str) -> Result<()> {
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let (mut phases, readme) = load_phases_and_readme(&client, &anchor)?;

    let idx = phases
        .iter()
        .position(|p| segment_matches(name, &p.name))
        .ok_or_else(|| format!("'{name}' isn't a declared phase on '{}'", anchor.name))?;

    let siblings = client.children(&anchor._id)?;
    if let Some(folder) = siblings
        .folders
        .iter()
        .find(|f| segment_matches(name, &f.name))
    {
        let inside = client.children(&folder._id)?;
        let count = inside
            .files
            .iter()
            .filter(|f| !f.name.eq_ignore_ascii_case("README.md"))
            .count();
        if count > 0 {
            return Err(format!("'{name}' still has {count} card(s) — move them out first").into());
        }
    }

    phases.remove(idx);
    save_phases(&client, &anchor, readme.as_ref(), &phases)?;
    println!(
        "Removed phase '{name}' from '{}' (its folder, now empty, was left in place — \
         delete it separately with 'nopal vault rm' if you want it gone too)",
        anchor.name
    );
    Ok(())
}

/// Reorders a declared phase relative to another — exactly one of
/// `before`/`after` must be given.
pub fn phase_mv(board: &str, name: &str, before: Option<&str>, after: Option<&str>) -> Result<()> {
    if before.is_some() == after.is_some() {
        return Err("Provide exactly one of --before or --after".into());
    }
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let (mut phases, readme) = load_phases_and_readme(&client, &anchor)?;

    let idx = phases
        .iter()
        .position(|p| segment_matches(name, &p.name))
        .ok_or_else(|| format!("'{name}' isn't a declared phase on '{}'", anchor.name))?;
    let moved = phases.remove(idx);

    let anchor_name = before
        .or(after)
        .expect("exactly one is Some, checked above");
    let anchor_idx = phases
        .iter()
        .position(|p| segment_matches(anchor_name, &p.name))
        .ok_or_else(|| {
            format!(
                "'{anchor_name}' isn't an existing phase on '{}'",
                anchor.name
            )
        })?;
    let insert_at = if before.is_some() {
        anchor_idx
    } else {
        anchor_idx + 1
    };
    phases.insert(insert_at, moved);

    save_phases(&client, &anchor, readme.as_ref(), &phases)?;
    println!(
        "Reordered '{}': {}",
        anchor.name,
        phases
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>()
            .join(" -> ")
    );
    Ok(())
}

/// Renames a declared phase — and its matching column folder, if one
/// exists, to keep the two in sync (the display name and the folder name
/// are expected to match, same convention `listBoardPhases` relies on
/// server-side).
pub fn phase_rename(board: &str, old_name: &str, new_name: &str) -> Result<()> {
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let (mut phases, readme) = load_phases_and_readme(&client, &anchor)?;

    let phase = phases
        .iter_mut()
        .find(|p| segment_matches(old_name, &p.name))
        .ok_or_else(|| format!("'{old_name}' isn't a declared phase on '{}'", anchor.name))?;
    phase.name = new_name.to_string();

    save_phases(&client, &anchor, readme.as_ref(), &phases)?;

    let siblings = client.children(&anchor._id)?;
    if let Some(folder) = siblings
        .folders
        .iter()
        .find(|f| segment_matches(old_name, &f.name))
    {
        let _: serde_json::Value = client.patch_json(
            &format!("/api/vault/folders/{}", folder._id),
            &serde_json::json!({ "name": new_name }),
        )?;
    }

    println!(
        "Renamed phase '{old_name}' -> '{new_name}' on '{}'",
        anchor.name
    );
    Ok(())
}

/// Changes a declared phase's type (`start`/`normal`/`end`).
pub fn phase_set_type(board: &str, name: &str, phase_type: &str) -> Result<()> {
    validate_phase_type(phase_type)?;
    let client = Client::new()?;
    let anchor = resolve_anchor(&client, board)?;
    let (mut phases, readme) = load_phases_and_readme(&client, &anchor)?;

    let phase = phases
        .iter_mut()
        .find(|p| segment_matches(name, &p.name))
        .ok_or_else(|| format!("'{name}' isn't a declared phase on '{}'", anchor.name))?;
    phase.phase_type = Some(phase_type.to_string());

    save_phases(&client, &anchor, readme.as_ref(), &phases)?;
    println!("Set '{name}' to type '{phase_type}' on '{}'", anchor.name);
    Ok(())
}
