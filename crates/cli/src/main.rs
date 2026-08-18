use clap::{Parser, Subcommand}; // Args, ValueEnum
use jiff;
use std::fs::File;
use std::io::Write;
use std::io::{self, Read};
use std::path::PathBuf;
use std::time::Duration;

mod auth;
mod graphlog;
mod image;
mod phylog;
mod record;
mod release_log;
mod skills;
mod sort;
mod sync;
mod update;
mod vault;
mod video;
mod watch;

const DEFAULT_HOST: &str = "https://nopal.build";

#[derive(Debug, Subcommand)]
enum Command {
    Test {},
    RecordLoadCell {},
    /// Log in via your browser and store a session token for the CLI.
    Login {
        /// Nopal host to authenticate against.
        #[arg(long, default_value = DEFAULT_HOST)]
        host: String,
        /// Print the login URL instead of opening a browser automatically.
        #[arg(long)]
        no_browser: bool,
    },
    /// Remove the locally stored CLI session.
    Logout {},
    /// Show who the CLI is currently logged in as.
    Whoami {
        /// Also print the raw bearer token this session is using — a real
        /// secret, handle it like a password. Useful for feeding a script
        /// (e.g. `webapp/scripts/pull-daily-logs.ts`) that calls the HTTP
        /// API directly.
        #[arg(long)]
        token: bool,
    },
    /// Utilities for working with video files (compression, etc). Uploading
    /// lives under its own separate command.
    Video {
        #[command(subcommand)]
        command: VideoCommand,
    },
    /// Utilities for working with image files (OCR text extraction, etc).
    Image {
        #[command(subcommand)]
        command: ImageCommand,
    },
    /// Record your screen — captures and compresses in a single ffmpeg
    /// pass (see `nopal_core::record`'s doc comment), so there's no
    /// separate `nopal video prep` step needed afterward.
    Record {
        #[command(subcommand)]
        command: RecordCommand,
    },
    /// Browse and upload to your Nopal Vault.
    Vault {
        #[command(subcommand)]
        command: VaultCommand,
    },
    /// Mirror local directories into a project's (or your Personal space's)
    /// Syncs folder (push-only by default; --two-way for both directions).
    Sync {
        #[command(subcommand)]
        command: SyncCommand,
    },
    /// Trigger the daily-log Sorter (mentions → project backlinks,
    /// completed Card tasks, Card file attachments → Release Log entries).
    /// Runs automatically once a day; this is for triggering it on demand.
    Sort {
        #[command(subcommand)]
        command: SortCommand,
    },
    /// Manage structured Release Log entries (see the `vault` skill's
    /// Release Log section) — today, just reverting one.
    ReleaseLog {
        #[command(subcommand)]
        command: ReleaseLogCommand,
    },
    /// PhyLog's pre-capture -> capture -> post-capture pipeline for one
    /// project (see the `phylog` skill). Always applies for real.
    Phylog {
        #[command(subcommand)]
        command: PhylogCommand,
    },
    /// GraphLog's pipeline for one `project-n02` project (see the
    /// `graphlog` skill): daily-log-sync -> sync-knowledge -> sync-graph
    /// -> graph-project-view. Only daily-log-sync exists so far.
    Graphlog {
        #[command(subcommand)]
        command: GraphlogCommand,
    },
    /// Reference docs for how to write things in Nopal (OxMarkdown syntax,
    /// the Vault, etc). Lists available skills by default.
    Skills {
        #[command(subcommand)]
        command: Option<SkillsCommand>,
    },
    /// Check for and install a newer version of the nopal CLI.
    #[command(alias = "upgrade")]
    Update {
        /// Only check whether a newer version is available; don't install it.
        #[arg(long)]
        check: bool,
    },
}

#[derive(Debug, Subcommand)]
enum VideoCommand {
    /// Compress a video (e.g. a screen recording) into a smaller,
    /// web-friendly H.264 mp4 — a local-only step, run before uploading.
    Prep {
        /// Path to the source video.
        input: PathBuf,
        /// Output path. Defaults to `<input>.web.mp4` alongside the source.
        #[arg(long)]
        output: Option<PathBuf>,
        /// H.264 quality (lower = better quality, larger file). Typical range 18-28.
        #[arg(long, default_value_t = 23)]
        crf: u8,
        /// Cap the output height, preserving aspect ratio; never upscales.
        #[arg(long, default_value_t = 1080)]
        max_height: u32,
        /// ffmpeg encoding speed/efficiency tradeoff (e.g. fast, medium, slow).
        #[arg(long, default_value = "medium")]
        preset: String,
        /// Overwrite the output file if it already exists.
        #[arg(long)]
        overwrite: bool,
    },
}

#[derive(Debug, Subcommand)]
enum RecordCommand {
    /// List capturable screens (feed the index into `start --screen`).
    ListScreens {},
    /// Start recording; press Enter in this terminal to stop.
    Start {
        /// Output path (e.g. `recording.mp4`).
        output: PathBuf,
        /// Which screen to capture — see `nopal record list-screens` for
        /// the index (NOT a plain 0-based count — avfoundation shares one
        /// index space across cameras and screens). Defaults to the first
        /// screen `list-screens` finds.
        #[arg(long)]
        screen: Option<u32>,
        /// Capture frame rate. Screen content rarely benefits from > 30.
        #[arg(long, default_value_t = 30)]
        fps: u32,
        /// H.264 quality (lower = better quality, larger file). Typical range 18-28.
        #[arg(long, default_value_t = 23)]
        crf: u8,
        /// Cap the output height, preserving aspect ratio; never upscales.
        #[arg(long, default_value_t = 1080)]
        max_height: u32,
        /// ffmpeg encoding speed/efficiency tradeoff — defaults to a
        /// real-time-safe preset ("medium"/"slow" can drop frames live).
        #[arg(long, default_value = "veryfast")]
        preset: String,
        /// Overwrite the output file if it already exists.
        #[arg(long)]
        overwrite: bool,
    },
}

#[derive(Debug, Subcommand)]
enum ImageCommand {
    /// Extract text from an image via OCR. Runs entirely locally via
    /// Tesseract — no network access or API key required.
    Ocr {
        /// Path to the source image.
        input: PathBuf,
        /// Write extracted text to this file instead of printing to stdout.
        #[arg(long)]
        output: Option<PathBuf>,
        /// Tesseract language code(s), e.g. `eng`, `eng+fra`.
        #[arg(long, default_value = "eng")]
        lang: String,
        /// Tesseract page segmentation mode. Defaults to 1 (automatic
        /// layout with orientation/script detection), which corrects
        /// sideways or upside-down photos automatically. See `tesseract
        /// --help-psm` for other modes.
        #[arg(long, default_value_t = 1)]
        psm: u8,
        /// Write output as Markdown-safe text (escapes stray #/-/>/etc. so
        /// it renders as plain paragraphs). Without --output, defaults to
        /// writing `<input-stem>.md` alongside the source instead of
        /// printing to stdout.
        #[arg(long)]
        markdown: bool,
    },
}

#[derive(Debug, Subcommand)]
enum VaultCommand {
    /// List a vault folder (the root folders when no path is given).
    Ls {
        /// Vault path, e.g. `projects/sunny` (omit for the vault root).
        #[arg(default_value = "")]
        path: String,
        /// Emit machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Print a tree of folders (and files) under a vault path.
    Tree {
        /// Vault path (omit for the vault root).
        #[arg(default_value = "")]
        path: String,
        /// Maximum depth to descend.
        #[arg(long, default_value_t = 2)]
        depth: u32,
        /// Only show folders, not files.
        #[arg(long)]
        folders_only: bool,
    },
    /// Print a markdown/text card's content to stdout.
    Cat {
        /// Vault path to a file, e.g. `projects/sunny/readme.md`.
        path: String,
    },
    /// Download a vault file.
    Download {
        /// Vault path to a file.
        path: String,
        /// Where to write the file (defaults to the file's name in the
        /// current directory).
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Show metadata for a vault folder or file.
    Info {
        /// Vault path to a folder or file.
        path: String,
        /// Emit machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Open a vault folder or file in your browser.
    Open {
        /// Vault path (omit for the vault root).
        #[arg(default_value = "")]
        path: String,
    },
    /// Upload local files into a vault folder. Large files upload in
    /// chunks automatically.
    Upload {
        /// Local file(s) to upload.
        #[arg(required = true)]
        files: Vec<PathBuf>,
        /// Destination vault folder, e.g. `personal` or `projects/sunny`.
        #[arg(long)]
        to: String,
    },
    /// Create a vault folder (creates missing intermediate folders too).
    Mkdir {
        /// Vault path to create, e.g. `projects/greenhouse/photos`.
        path: String,
    },
    /// Move a folder into another folder (works across vault roots).
    Mv {
        /// Vault path of the folder to move.
        src: String,
        /// Vault path of the destination folder.
        dest: String,
    },
    /// Rename a folder.
    Rename {
        /// Vault path of the folder to rename.
        path: String,
        /// The new folder name (not a path).
        new_name: String,
    },
    /// Replace a vault file's contents in place (same file, new bytes).
    Replace {
        /// Local file with the new contents.
        local: PathBuf,
        /// Vault path of the file to replace.
        path: String,
    },
    /// Show or change a project's collaborators and their Sharing Roles
    /// (e.g. Owner, Crafter, Observer — see `sharing_roles`). Only works on
    /// a project folder (one directly under `projects/`).
    Share {
        /// Vault path of the project folder (no flags → show current sharing).
        path: String,
        /// Stop sharing — clears the whole collaborator list.
        #[arg(long, conflicts_with = "with")]
        private: bool,
        /// Share with a person and assign their role, as EMAIL:ROLE
        /// (repeatable). Replaces the current collaborator list rather
        /// than adding to it.
        #[arg(long = "with", value_name = "EMAIL:ROLE")]
        with: Vec<String>,
    },
    /// Publish a folder to a public URL — no login required to view it.
    Publish {
        /// Vault path of the folder to publish.
        path: String,
        /// Copy the public link to the clipboard.
        #[arg(long)]
        copy: bool,
    },
    /// Unpublish a folder (see 'nopal vault publish').
    Unpublish {
        /// Vault path of the folder to unpublish.
        path: String,
    },
    /// Print the public link for a folder or file, if it's reachable
    /// (published directly, or inside a published folder).
    Link {
        /// Vault path of the folder or file.
        path: String,
        /// Copy the link to the clipboard.
        #[arg(long)]
        copy: bool,
    },
    /// Delete a vault file or folder.
    Rm {
        /// Vault path of the file or folder to delete.
        path: String,
        /// Skip the confirmation prompt.
        #[arg(long, short = 'f')]
        force: bool,
        /// Required to delete a folder that isn't empty.
        #[arg(long, short = 'r')]
        recursive: bool,
    },
}

#[derive(Debug, Subcommand)]
enum SyncCommand {
    /// Register a local directory as a sync target and push it.
    Add {
        /// The local directory to sync.
        dir: PathBuf,
        /// Name for the target (defaults to the directory name). Also the
        /// connector folder's name inside the space's Syncs folder.
        #[arg(long)]
        name: Option<String>,
        /// Optimize videos with `nopal video prep` before uploading — the
        /// smaller .web.mp4 is synced instead of the raw recording.
        #[arg(long)]
        preprocess: bool,
        /// Two-way sync: also pull vault changes down and propagate
        /// deletions (local deletes archive the vault copy; vault deletes
        /// remove unchanged local files). Default is push-only — the local
        /// directory is never modified.
        #[arg(long)]
        two_way: bool,
        /// Which project's Syncs folder to add this to (its Syncs folder is
        /// created on first use if it doesn't exist yet). Defaults to your
        /// Personal space when omitted.
        #[arg(long)]
        project: Option<String>,
    },
    /// List sync targets (all devices).
    Ls {},
    /// Unregister a sync target.
    Rm {
        /// The target's name (see 'nopal sync ls').
        name: String,
        /// Keep the synced folder in the vault (only stop syncing).
        #[arg(long)]
        keep_remote: bool,
        /// Skip the confirmation prompt.
        #[arg(long, short = 'f')]
        force: bool,
    },
    /// Push local changes to the vault — one target by name, or every
    /// target registered on this device.
    Run {
        /// Target name (omit to run all of this device's targets).
        name: Option<String>,
        /// Keep running: watch the target directories and sync on change
        /// (plus a periodic remote poll for two-way targets). Foreground —
        /// Ctrl-C stops it. For a managed background worker that survives
        /// reboots, use 'nopal sync watch enable'.
        #[arg(long)]
        watch: bool,
    },
    /// Manage the background sync worker (macOS launchd).
    Watch {
        #[command(subcommand)]
        command: WatchCommand,
    },
}

#[derive(Debug, Subcommand)]
enum SortCommand {
    /// Sort one day (yours) — defaults to yesterday (UTC) if --date is omitted.
    Run {
        /// YYYY-MM-DD. Defaults to yesterday (UTC).
        #[arg(long)]
        date: Option<String>,
        /// Re-run even if this day was already sorted.
        #[arg(long)]
        force: bool,
    },
}

#[derive(Debug, Subcommand)]
enum GraphlogCommand {
    /// Runs the full pipeline, in order: daily-log-sync -> sync-knowledge
    /// -> sync-graph -> graph-project-view. See the `graphlog` skill.
    Run {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
    },
    /// Converts an existing project-n01 space into project-n02.
    /// DESTRUCTIVE (deletes everything except skills/ and syncs/, clears
    /// README.md's body) — requires --yes. See the `graphlog` skill's
    /// "Planned: migration" section.
    MigrateToN02 {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        /// Required unless --full is given.
        #[arg(long)]
        project: Option<String>,
        /// Discover and convert EVERY project-n01 space you own (your own
        /// `personal` root plus every owned project) in one command,
        /// instead of one path at a time. Mutually exclusive with
        /// --project.
        #[arg(long)]
        full: bool,
        /// Required to actually run — this is destructive.
        #[arg(long)]
        yes: bool,
    },
    /// Deterministic Card→project copy into `syncs/Daily Logs/` — no LLM
    /// call, always applies for real (see the `graphlog` skill).
    DailyLogSync {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
        /// Only sync this one day, YYYY-MM-DD. Omit to sweep every day this
        /// project has ever had a Card for.
        #[arg(long)]
        date: Option<String>,
    },
    /// Extracts concrete metadata (names, dates, decisions) from every file
    /// under `syncs/`, per `skills/KNOWLEDGE.md`'s own instructions, into
    /// `_knowledge/<name>.knowledge.md` sidecars. Agentic (real LLM calls).
    SyncKnowledge {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
    },
    /// Extracts citable nodes from each day's synced content, per
    /// `skills/GRAPH.md`'s own instructions, into
    /// `Graph/graph-log-YYYY-MM-DD.md`. Agentic (real LLM calls).
    SyncGraph {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
    },
    /// Applies each not-yet-applied `Graph/graph-log-*.md` file, oldest
    /// first, to README.md per `skills/PROJECT_VIEW.md`'s own
    /// instructions. Agentic (real LLM calls).
    GraphProjectView {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
    },
}

#[derive(Debug, Subcommand)]
enum PhylogCommand {
    /// Runs all three stages, in order: pre-capture -> capture ->
    /// post-capture. Always applies for real (no preview mode) — use
    /// `phylog reset` + `--full` if you want to start over and inspect
    /// the result before rebuilding.
    Run {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
        /// Reset this project's PhyLog-managed content and reprocess
        /// EVERY day from scratch (capture's full-rebuild mode).
        #[arg(long)]
        full: bool,
        /// Only relevant with --full: earliest day to include (inclusive),
        /// YYYY-MM-DD. Omit to start from this project's very first Card.
        #[arg(long)]
        since: Option<String>,
        /// Only relevant with --full: latest day to include (inclusive),
        /// YYYY-MM-DD. Defaults to today.
        #[arg(long)]
        until: Option<String>,
    },
    /// Stage 1: stages each Card's text/attachments into this project's
    /// own daily-logs/ folder (always, regardless of skill), and
    /// generates `*-summary.md` sidecars for daily-logs attachments and
    /// syncs/ files per skills/PRE_CAPTURE.md's own instructions
    /// (summaries are skipped by default; staging never is).
    PreCapture {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
        /// Process just this day's Card attachments (plus, always, a
        /// syncs sweep). Omit (with --file also omitted) to process every
        /// day this project has a Card for.
        #[arg(long)]
        date: Option<String>,
        /// Process just this one file (a vault path), ignoring --date.
        #[arg(long)]
        file: Option<String>,
    },
    /// Stage 2: files Card attachments into the project and organizes/
    /// updates the README, per skills/CAPTURE.md's own instructions.
    /// Always applies for real.
    Capture {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
        /// Full rebuild: reset this project's managed content first, then
        /// reprocess EVERY day from scratch. Default is incremental (only
        /// days not yet applied).
        #[arg(long)]
        full: bool,
        /// Only relevant with --full: earliest day to include (inclusive),
        /// YYYY-MM-DD.
        #[arg(long)]
        since: Option<String>,
        /// Only relevant with --full: latest day to include (inclusive),
        /// YYYY-MM-DD. Defaults to today.
        #[arg(long)]
        until: Option<String>,
    },
    /// Stage 3: runs post-capture, per skills/POST_CAPTURE.md's own
    /// instructions. Currently mostly a placeholder — see the `phylog`
    /// skill.
    PostCapture {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
    },
    /// A DEDICATED, whole-README structure pass -- distinct from
    /// `capture`'s own one-day-at-a-time loop. Given the entire current
    /// README at once, explicitly asked to evaluate and fix the
    /// project's overall structure. `capture` also runs this
    /// automatically, mid-cycle, whenever a daily log explicitly asks
    /// for a reorganization -- this is for triggering it directly.
    Reorganize {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
    },
    /// Deletes everything in this project EXCEPT its skills/, syncs/, and
    /// daily-logs/ folders — the "start over" operation, always explicit
    /// and never run implicitly. Follow with `capture --full` to rebuild
    /// straight from what's already staged in daily-logs/.
    Reset {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
        /// Required to actually delete anything — this is destructive.
        #[arg(long)]
        yes: bool,
    },
    /// The DEEPER reset: everything `reset` wipes, PLUS daily-logs/
    /// itself (pre-capture's own staged output). Follow with `pre-capture`
    /// (to restage daily-logs/) then `capture --full` (to rebuild).
    ResetPreCapture {
        /// Vault path of the project, e.g. `projects/sunny`, or `personal`.
        #[arg(long)]
        project: String,
        /// Required to actually delete anything — this is destructive.
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Debug, Subcommand)]
enum ReleaseLogCommand {
    /// Reverts one entry — only entries that changed a project file (a
    /// Card file attachment being filed into the project) can be
    /// reverted; a plain @mention backlink or completed-task entry has
    /// nothing to undo and the server will reject it.
    Revert {
        /// The entry's own id (see the invisible `<!-- release-log-entry:... -->`
        /// marker on each bullet in a project's/day's release-log.md).
        entry_id: String,
    },
}

#[derive(Debug, Subcommand)]
enum SkillsCommand {
    /// List available skill references. (default)
    List {},
    /// Print a skill's full reference doc.
    #[command(alias = "cat")]
    Show {
        /// Skill name, e.g. `oxmarkdown`.
        name: String,
    },
}

#[derive(Debug, Subcommand)]
enum WatchCommand {
    /// Install + start the worker: runs at login, restarts on crash, and
    /// authenticates with a sync-scoped (never-expiring, revocable) token.
    Enable {},
    /// Stop the worker, remove it from login items, revoke its token.
    Disable {},
    /// Is the worker installed/running? When did it last sync?
    Status {},
    /// Show the tail of the worker's log file.
    Logs {
        /// Number of lines to show.
        #[arg(long, default_value_t = 40)]
        lines: usize,
    },
}

#[derive(Debug, Parser)]
#[command(name = "nopal")]
#[command(version)]
#[command(about = concat!("Nopal CLI v", env!("CARGO_PKG_VERSION")), long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

fn main() {
    let args = Cli::parse();
    match args.command {
        Command::Test {} => {
            println!("Testing");
        }
        Command::RecordLoadCell {} => {
            println!("Recording load cell info");
            if let Err(e) = read_serial_port_interactive("DK0HR7JK") {
                eprintln!("Error: {}", e);
            }
        }
        Command::Login { host, no_browser } => {
            if let Err(e) = auth::login(&host, no_browser) {
                eprintln!("Login failed: {e}");
                std::process::exit(1);
            }
        }
        Command::Logout {} => {
            if let Err(e) = auth::logout() {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Whoami { token } => {
            if let Err(e) = auth::whoami(token) {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Video { command } => match command {
            VideoCommand::Prep {
                input,
                output,
                crf,
                max_height,
                preset,
                overwrite,
            } => {
                let opts = video::PrepOptions {
                    output,
                    crf,
                    max_height,
                    preset,
                    overwrite,
                };
                if let Err(e) = video::prep(&input, opts) {
                    eprintln!("video prep failed: {e}");
                    std::process::exit(1);
                }
            }
        },
        Command::Image { command } => match command {
            ImageCommand::Ocr {
                input,
                output,
                lang,
                psm,
                markdown,
            } => {
                let opts = image::OcrOptions {
                    output,
                    lang,
                    psm,
                    markdown,
                };
                if let Err(e) = image::ocr(&input, opts) {
                    eprintln!("image ocr failed: {e}");
                    std::process::exit(1);
                }
            }
        },
        Command::Record { command } => {
            let result = match command {
                RecordCommand::ListScreens {} => record::list_screens(),
                RecordCommand::Start {
                    output,
                    screen,
                    fps,
                    crf,
                    max_height,
                    preset,
                    overwrite,
                } => (|| {
                    let screen = match screen {
                        Some(s) => s,
                        None => {
                            let first = nopal_core::record::list_screens()?
                                .into_iter()
                                .next()
                                .ok_or("No capturable screens found")?;
                            println!("No --screen given — using {}: {}", first.index, first.name);
                            first.index
                        }
                    };
                    record::start(output, screen, fps, crf, preset, max_height, overwrite)
                })(),
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Vault { command } => {
            let result = match command {
                VaultCommand::Ls { path, json } => vault::ls(&path, json),
                VaultCommand::Tree {
                    path,
                    depth,
                    folders_only,
                } => vault::tree(&path, depth, folders_only),
                VaultCommand::Cat { path } => vault::cat(&path),
                VaultCommand::Download { path, output } => vault::download(&path, output),
                VaultCommand::Info { path, json } => vault::info(&path, json),
                VaultCommand::Open { path } => vault::open(&path),
                VaultCommand::Upload { files, to } => vault::upload(&files, &to),
                VaultCommand::Mkdir { path } => vault::mkdir(&path),
                VaultCommand::Mv { src, dest } => vault::mv(&src, &dest),
                VaultCommand::Rename { path, new_name } => vault::rename(&path, &new_name),
                VaultCommand::Replace { local, path } => vault::replace(&local, &path),
                VaultCommand::Share {
                    path,
                    private,
                    with,
                } => vault::share(&path, private, &with),
                VaultCommand::Publish { path, copy } => vault::publish(&path, copy),
                VaultCommand::Unpublish { path } => vault::unpublish(&path),
                VaultCommand::Link { path, copy } => vault::link(&path, copy),
                VaultCommand::Rm {
                    path,
                    force,
                    recursive,
                } => vault::rm(&path, force, recursive),
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Sync { command } => {
            let result = match command {
                SyncCommand::Add {
                    dir,
                    name,
                    preprocess,
                    two_way,
                    project,
                } => sync::add(&dir, name, preprocess, two_way, project),
                SyncCommand::Ls {} => sync::ls(),
                SyncCommand::Rm {
                    name,
                    keep_remote,
                    force,
                } => sync::rm(&name, keep_remote, force),
                SyncCommand::Run { name, watch } => {
                    if watch {
                        if name.is_some() {
                            Err("--watch runs every target on this device; drop the name".into())
                        } else {
                            watch::run_watch()
                        }
                    } else {
                        sync::run(name)
                    }
                }
                SyncCommand::Watch { command } => match command {
                    WatchCommand::Enable {} => watch::enable(),
                    WatchCommand::Disable {} => watch::disable(),
                    WatchCommand::Status {} => watch::status(),
                    WatchCommand::Logs { lines } => watch::logs(lines),
                },
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Graphlog { command } => {
            let result = match command {
                GraphlogCommand::Run { project } => graphlog::run(&project),
                GraphlogCommand::MigrateToN02 { project, full, yes } => match (project, full) {
                    (Some(_), true) => Err("Pass either --project or --full, not both.".into()),
                    (Some(project), false) => graphlog::migrate_to_n02(&project, yes),
                    (None, true) => graphlog::migrate_to_n02_full(yes),
                    (None, false) => Err(
                        "Pass --project <path>, or --full to convert everything you own.".into(),
                    ),
                },
                GraphlogCommand::DailyLogSync { project, date } => {
                    graphlog::daily_log_sync(&project, date.as_deref())
                }
                GraphlogCommand::SyncKnowledge { project } => graphlog::sync_knowledge(&project),
                GraphlogCommand::SyncGraph { project } => graphlog::sync_graph(&project),
                GraphlogCommand::GraphProjectView { project } => {
                    graphlog::graph_project_view(&project)
                }
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Sort { command } => {
            let result = match command {
                SortCommand::Run { date, force } => sort::run(date, force),
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::ReleaseLog { command } => {
            let result = match command {
                ReleaseLogCommand::Revert { entry_id } => release_log::revert(&entry_id),
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Phylog { command } => {
            let result = match command {
                PhylogCommand::Run {
                    project,
                    full,
                    since,
                    until,
                } => phylog::run(&project, full, since.as_deref(), until.as_deref()),
                PhylogCommand::PreCapture {
                    project,
                    date,
                    file,
                } => phylog::pre_capture(&project, date.as_deref(), file.as_deref()),
                PhylogCommand::Capture {
                    project,
                    full,
                    since,
                    until,
                } => phylog::capture(&project, full, since.as_deref(), until.as_deref()),
                PhylogCommand::PostCapture { project } => phylog::post_capture(&project),
                PhylogCommand::Reorganize { project } => phylog::reorganize(&project),
                PhylogCommand::Reset { project, yes } => phylog::reset(&project, yes),
                PhylogCommand::ResetPreCapture { project, yes } => {
                    phylog::reset_pre_capture(&project, yes)
                }
            };
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
        Command::Skills { command } => match command.unwrap_or(SkillsCommand::List {}) {
            SkillsCommand::List {} => skills::list(),
            SkillsCommand::Show { name } => {
                if let Err(e) = skills::show(&name) {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
        },
        Command::Update { check } => {
            if let Err(e) = update::update(check) {
                eprintln!("update failed: {e}");
                std::process::exit(1);
            }
        }
    }
}

// These are the calibration values for the load cell
const COMPRESSION_10000_LBS: f64 = -1.9870;
const TENSION_10000_LBS: f64 = 1.9857;

fn read_serial_port_interactive(port_name: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Find and open the serial port
    let ports = serialport::available_ports()?;
    let port = ports.iter().find(|p| p.port_name.contains(port_name));

    match port {
        Some(p) => {
            println!("Connected to {}", p.port_name);
            let mut port = serialport::new(p.port_name.clone(), 2_000_000)
                .timeout(Duration::from_millis(10))
                .open()?;

            let now = jiff::Timestamp::now();
            // Write output relative to wherever the command is invoked from,
            // creating the `data` directory if it doesn't already exist.
            std::fs::create_dir_all("./data")?;
            let filename = format!(
                "./data/load_cell_data_{}.csv",
                now.strftime("%Y-%m-%d_%H:%M").to_string()
            );
            let mut file = File::create(&filename)?;
            // Add header in
            writeln!(file, "Distance (in),Force (lbs)")?;

            loop {
                println!("Enter distance (or 'q' to quit): ");
                let mut input = String::new();
                io::stdin().read_line(&mut input)?;

                let input = input.trim();
                if input.to_lowercase().eq("q") {
                    break;
                }
                let distance = fraction_to_float(input);
                if let Err(e) = distance {
                    println!("Invalid distance: {}", e);
                    continue;
                }
                let distance = distance.unwrap();

                // Read the latest value from the serial port
                match read_single_measurement(&mut port) {
                    Ok((force, raw_value)) => {
                        println!(
                            "Distance: {}, Force: {}, Raw: {}",
                            distance, force, raw_value
                        );
                        // Write to file: distance,force
                        writeln!(file, "{},{}", distance, force)?;
                        file.flush()?;
                    }
                    Err(e) => {
                        println!("Error reading measurement: {}", e);
                    }
                }
            }
        }
        None => {
            eprintln!("Error: Port not found");
        }
    }

    Ok(())
}

fn read_single_measurement(
    port: &mut Box<dyn serialport::SerialPort>,
) -> Result<(f64, f64), Box<dyn std::error::Error>> {
    let mut serial_buf: Vec<u8> = vec![0; 1000];

    // The load cell streams readings continuously, so by the time the user
    // enters a distance, stale readings (taken before they moved anything)
    // have already piled up in the OS input buffer. Discard them so the
    // reading we return below reflects fresh data only.
    let _ = port.clear(serialport::ClearBuffer::Input);

    // Try to get a valid measurement for up to 1 second
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(1) {
        match port.read(serial_buf.as_mut_slice()) {
            Ok(t) => {
                let data = String::from_utf8_lossy(&serial_buf[..t]);
                for line in data.lines() {
                    if let Some(value) = line.trim().strip_suffix("mV/V") {
                        if let Ok(number) = value.parse::<f64>() {
                            let force = if number < 0.0 {
                                number * (10000.0 / COMPRESSION_10000_LBS)
                            } else {
                                number * (10000.0 / TENSION_10000_LBS)
                            };
                            return Ok((force, number));
                        }
                    }
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::TimedOut => continue,
            Err(e) => return Err(Box::new(e)),
        }
    }

    Err("Timeout waiting for measurement".into())
}

fn fraction_to_float(fraction_str: &str) -> Result<f64, Box<dyn std::error::Error>> {
    // Split the string by whitespace
    let parts: Vec<&str> = fraction_str.trim().split_whitespace().collect();

    let mut result = 0.0;

    match parts.len() {
        // Just a fraction like "1/2"
        1 => {
            if parts[0].contains('/') {
                let frac_parts: Vec<&str> = parts[0].split('/').collect();
                if frac_parts.len() == 2 {
                    let numerator: f64 = frac_parts[0].parse()?;
                    let denominator: f64 = frac_parts[1].parse()?;
                    result = numerator / denominator;
                }
            } else {
                // Just a whole number
                result = parts[0].parse()?;
            }
        }
        // Whole number and fraction like "1 1/2"
        2 => {
            let whole: f64 = parts[0].parse()?;
            let frac_parts: Vec<&str> = parts[1].split('/').collect();
            if frac_parts.len() == 2 {
                let numerator: f64 = frac_parts[0].parse()?;
                let denominator: f64 = frac_parts[1].parse()?;
                result = whole + (numerator / denominator);
            }
        }
        _ => return Err("Invalid fraction format".into()),
    }

    Ok(result)
}
