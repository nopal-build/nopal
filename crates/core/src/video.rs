//! Video preprocessing shared by the CLI's `nopal video prep` and the sync
//! engine's `--preprocess` option: shells out to `ffmpeg` to re-encode a
//! video (typically a desktop screen recording) into a smaller,
//! web-friendly H.264 mp4 before it's uploaded anywhere.
//!
//! No printing here — progress is reported through the `log` callback so
//! both a terminal (`println!`) and a GUI (append to an on-screen log) can
//! consume the exact same events.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::Result;

pub struct PrepOptions {
    pub output: Option<PathBuf>,
    pub crf: u8,
    pub max_height: u32,
    pub preset: String,
    pub overwrite: bool,
}

pub struct PrepResult {
    pub output_path: PathBuf,
    pub original_size: u64,
    pub new_size: u64,
}

pub fn prep(input: &Path, opts: PrepOptions, log: &mut dyn FnMut(&str)) -> Result<PrepResult> {
    let ffmpeg = resolve_ffmpeg()?;

    if !input.is_file() {
        return Err(format!("No such file: {}", input.display()).into());
    }

    let output_path = opts.output.unwrap_or_else(|| default_output_path(input));

    if output_path.exists() && !opts.overwrite {
        return Err(format!(
            "{} already exists — pass overwrite, or choose a different output path.",
            output_path.display()
        )
        .into());
    }

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let original_size = fs::metadata(input)?.len();

    // Escaped comma: `min(ih,H)` would otherwise be parsed by ffmpeg's own
    // filtergraph syntax as two separate filter arguments.
    let scale_filter = format!("scale=-2:min(ih\\,{})", opts.max_height);

    log(&format!(
        "Compressing {} -> {}",
        input.display(),
        output_path.display()
    ));

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg(if opts.overwrite { "-y" } else { "-n" })
        .arg("-i")
        .arg(input)
        .arg("-vf")
        .arg(&scale_filter)
        .args(["-c:v", "libx264"])
        .args(["-crf", &opts.crf.to_string()])
        .args(["-preset", &opts.preset])
        .args(["-c:a", "aac", "-b:a", "128k"])
        .args(["-movflags", "+faststart"])
        .arg(&output_path);

    // Inherits stdio by default, so ffmpeg's own progress output stays
    // visible when run from a terminal. A GUI caller won't see this
    // (nothing routes it through `log`) — acceptable for a first pass,
    // since the `log` callback still gets the before/after summary.
    let status = cmd
        .status()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg exited with {status}").into());
    }

    let new_size = fs::metadata(&output_path)?.len();
    let reduction = if original_size > 0 {
        100.0 - (new_size as f64 / original_size as f64 * 100.0)
    } else {
        0.0
    };
    log(&format!(
        "Done: {} -> {} ({:.0}% smaller)",
        human_size(original_size),
        human_size(new_size),
        reduction,
    ));

    Ok(PrepResult {
        output_path,
        original_size,
        new_size,
    })
}

/// Finds ffmpeg: PATH first, then common install locations that a
/// non-login process (e.g. a launchd agent, whose PATH is minimal and never
/// sources .zshrc/.bash_profile) might not have on PATH — notably
/// Homebrew's bin dirs on both Apple Silicon and Intel.
pub fn resolve_ffmpeg() -> Result<String> {
    if command_works("ffmpeg") {
        return Ok("ffmpeg".to_string());
    }
    for candidate in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ] {
        if command_works(candidate) {
            return Ok(candidate.to_string());
        }
    }
    Err(
        "ffmpeg not found. Install it first (e.g. `brew install ffmpeg` on macOS), \
         then try again."
            .into(),
    )
}

fn command_works(program: &str) -> bool {
    Command::new(program)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn default_output_path(input: &Path) -> PathBuf {
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let parent = input.parent().filter(|p| !p.as_os_str().is_empty());
    let filename = format!("{stem}.web.mp4");
    match parent {
        Some(parent) => parent.join(filename),
        None => PathBuf::from(filename),
    }
}

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    format!("{size:.1} {}", UNITS[unit])
}
