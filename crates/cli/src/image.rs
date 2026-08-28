//! `nopal image ...` — utilities for working with image files.
//!
//! `ocr` shells out to `tesseract` to extract text embedded in an image
//! (screenshots, scanned documents, photos of signs/whiteboards, etc). This
//! is local-only and needs no network access or API key — Tesseract must be
//! installed separately (e.g. `brew install tesseract` on macOS).
//!
//! Tesseract (via its leptonica image backend) can't read HEIC/HEIF —
//! Apple's default photo format — so those inputs are transparently
//! converted to PNG in a temp file first, using `sips` (built into macOS)
//! or `ffmpeg` as a fallback elsewhere.
//!
//! `--markdown` writes the extracted text out as a `.md` file (defaulting
//! to `<input-stem>.md` alongside the source) with Markdown-significant
//! leading characters escaped, so it can be dropped straight into the
//! Vault as a Card without being misread as headings/lists/etc.

use crate::video;
use std::error::Error;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct OcrOptions {
    pub output: Option<PathBuf>,
    pub lang: String,
    pub psm: u8,
    pub markdown: bool,
}

pub fn ocr(input: &Path, opts: OcrOptions) -> Result<(), Box<dyn Error + Send + Sync>> {
    let tesseract = resolve_tesseract()?;

    if !input.is_file() {
        return Err(format!("No such file: {}", input.display()).into());
    }

    let converted = convert_if_needed(input)?;
    let _cleanup = TempFileGuard(converted.clone());
    let ocr_input = converted.as_deref().unwrap_or(input);

    // Always have tesseract emit to stdout (rather than letting it write
    // its own outputbase file directly) so we can post-process the text
    // (e.g. --markdown escaping) before deciding where it ends up.
    let mut cmd = Command::new(&tesseract);
    cmd.arg(ocr_input)
        .arg("stdout")
        .args(["-l", &opts.lang])
        .args(["--psm", &opts.psm.to_string()]);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run tesseract: {e}"))?;

    if !output.status.success() {
        io::stderr().write_all(&output.stderr)?;
        return Err(format!("tesseract exited with {}", output.status).into());
    }

    let text = String::from_utf8_lossy(&output.stdout).into_owned();

    match resolve_output_path(input, &opts) {
        Some(output_path) => {
            let contents = if opts.markdown {
                to_markdown(&text)
            } else {
                text
            };
            if let Some(parent) = output_path.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)?;
                }
            }
            fs::write(&output_path, contents)?;
            println!("{}", output_path.display());
        }
        None => {
            io::stdout().write_all(text.as_bytes())?;
        }
    }

    Ok(())
}

/// An explicit `--output` always wins. Otherwise, `--markdown` on its own
/// implies writing a `<input-stem>.md` file alongside the source (matching
/// `nopal video prep`'s "derive a sensible default next to the input"
/// convention) rather than printing to stdout.
fn resolve_output_path(input: &Path, opts: &OcrOptions) -> Option<PathBuf> {
    if let Some(path) = &opts.output {
        return Some(path.clone());
    }
    if opts.markdown {
        return Some(input.with_extension("md"));
    }
    None
}

/// Makes raw OCR text safe to write out as Markdown: escapes leading
/// characters on each line that Markdown would otherwise interpret as
/// block syntax (headings, blockquotes, bullet/numbered lists, fenced code,
/// horizontal rules), so the extracted text renders as plain paragraphs
/// instead of being accidentally reformatted.
fn to_markdown(text: &str) -> String {
    let mut out = text
        .lines()
        .map(escape_markdown_line)
        .collect::<Vec<_>>()
        .join("\n");
    out.push('\n');
    out
}

fn escape_markdown_line(line: &str) -> String {
    let indent_len = line.len() - line.trim_start().len();
    let (indent, rest) = line.split_at(indent_len);

    if rest.is_empty() {
        return line.to_string();
    }

    let bytes = rest.as_bytes();

    // Fenced code blocks: ``` or ~~~.
    if rest.starts_with("```") || rest.starts_with("~~~") {
        return format!("{indent}\\{rest}");
    }

    // Horizontal rules: a line of 3+ repeated -, *, or _ (ignoring trailing
    // whitespace).
    let trimmed_end = rest.trim_end();
    if trimmed_end.len() >= 3 {
        let first = trimmed_end.as_bytes()[0];
        if matches!(first, b'-' | b'*' | b'_') && trimmed_end.bytes().all(|b| b == first) {
            return format!("{indent}\\{rest}");
        }
    }

    // ATX headings: one or more '#' followed by a space (or end of line).
    if bytes[0] == b'#' {
        let hashes = rest.chars().take_while(|&c| c == '#').count();
        if rest.as_bytes().get(hashes).is_none_or(|b| *b == b' ') {
            return format!("{indent}\\{rest}");
        }
    }

    // Blockquotes and bullet lists: >, -, *, + followed by a space (or end
    // of line).
    let is_marker =
        |c: u8| bytes[0] == c && (bytes.len() == 1 || bytes[1] == b' ' || bytes[1] == b'\t');
    if is_marker(b'>') || is_marker(b'-') || is_marker(b'*') || is_marker(b'+') {
        return format!("{indent}\\{rest}");
    }

    // Ordered lists: digits followed by '.' or ')' then a space (or end of
    // line).
    let digit_len = rest.chars().take_while(|c| c.is_ascii_digit()).count();
    if digit_len > 0 {
        if let Some(marker) = rest.as_bytes().get(digit_len) {
            if (*marker == b'.' || *marker == b')')
                && rest
                    .as_bytes()
                    .get(digit_len + 1)
                    .is_none_or(|b| *b == b' ')
            {
                return format!("{indent}{}\\{}", &rest[..digit_len], &rest[digit_len..]);
            }
        }
    }

    line.to_string()
}

/// Finds tesseract: PATH first, then common install locations that a
/// non-login process might not have on PATH — notably Homebrew's bin dirs
/// on both Apple Silicon and Intel.
fn resolve_tesseract() -> Result<String, Box<dyn Error + Send + Sync>> {
    if command_works("tesseract") {
        return Ok("tesseract".to_string());
    }
    for candidate in [
        "/opt/homebrew/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/usr/bin/tesseract",
    ] {
        if command_works(candidate) {
            return Ok(candidate.to_string());
        }
    }
    Err(
        "tesseract not found. Install it first (e.g. `brew install tesseract` on macOS), \
         then run 'nopal image ocr' again."
            .into(),
    )
}

fn command_works(program: &str) -> bool {
    Command::new(program)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// If `input` is a format tesseract/leptonica can't read directly
/// (currently just HEIC/HEIF), converts it to a PNG in the system temp
/// directory and returns that path. Returns `None` when no conversion is
/// needed.
fn convert_if_needed(input: &Path) -> Result<Option<PathBuf>, Box<dyn Error + Send + Sync>> {
    let ext = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("heic") | Some("heif")) {
        return Ok(None);
    }

    let tmp_path = std::env::temp_dir().join(format!("nopal-ocr-{}.png", std::process::id()));
    convert_to_png(input, &tmp_path)?;
    Ok(Some(tmp_path))
}

/// Converts `input` to a PNG at `output`. Prefers `sips` (bundled with every
/// macOS install, so no extra dependency for the common HEIC-from-iPhone
/// case) and falls back to `ffmpeg` (already a soft dependency of `nopal
/// video prep`) elsewhere.
fn convert_to_png(input: &Path, output: &Path) -> Result<(), Box<dyn Error + Send + Sync>> {
    if cfg!(target_os = "macos") && command_works("sips") {
        let status = Command::new("sips")
            .args(["-s", "format", "png"])
            .arg(input)
            .arg("--out")
            .arg(output)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("Failed to run sips: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("sips failed to convert {}", input.display()).into());
    }

    let ffmpeg = video::resolve_ffmpeg().map_err(|_| {
        format!(
            "{} is HEIC/HEIF, which tesseract can't read directly, and no converter \
             (sips/ffmpeg) is available. Install ffmpeg (e.g. `apt install ffmpeg`) \
             and try again.",
            input.display()
        )
    })?;
    let status = Command::new(ffmpeg)
        .arg("-y")
        .arg("-i")
        .arg(input)
        .args(["-frames:v", "1", "-update", "1"])
        .arg(output)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg failed to convert {}", input.display()).into());
    }
    Ok(())
}

/// Removes the wrapped temp file (if any) when dropped, so the converted
/// PNG is cleaned up whether `ocr` succeeds, fails, or returns early.
struct TempFileGuard(Option<PathBuf>);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_headings() {
        assert_eq!(escape_markdown_line("# Title"), "\\# Title");
        assert_eq!(escape_markdown_line("### Sub"), "\\### Sub");
        assert_eq!(escape_markdown_line("  # Indented"), "  \\# Indented");
        // A lone '#' with no following text/space still gets escaped.
        assert_eq!(escape_markdown_line("#"), "\\#");
        // A '#' with no space after (a hashtag, not a heading) is untouched.
        assert_eq!(escape_markdown_line("#hashtag"), "#hashtag");
    }

    #[test]
    fn escapes_bullets_and_blockquotes() {
        assert_eq!(escape_markdown_line("- item"), "\\- item");
        assert_eq!(escape_markdown_line("* item"), "\\* item");
        assert_eq!(escape_markdown_line("+ item"), "\\+ item");
        assert_eq!(escape_markdown_line("> quoted"), "\\> quoted");
        // A hyphen mid-sentence (not a bullet) is untouched.
        assert_eq!(escape_markdown_line("9750-East"), "9750-East");
    }

    #[test]
    fn escapes_ordered_lists() {
        assert_eq!(escape_markdown_line("1. First"), "1\\. First");
        assert_eq!(escape_markdown_line("12) Second"), "12\\) Second");
        // A number that isn't followed by '.'/' )' + space is untouched.
        assert_eq!(escape_markdown_line("85003 zip"), "85003 zip");
    }

    #[test]
    fn escapes_fences_and_rules() {
        assert_eq!(escape_markdown_line("```rust"), "\\```rust");
        assert_eq!(escape_markdown_line("---"), "\\---");
        assert_eq!(escape_markdown_line("***"), "\\***");
    }

    #[test]
    fn leaves_plain_text_alone() {
        assert_eq!(escape_markdown_line("CITY OF PHOENIX"), "CITY OF PHOENIX");
        assert_eq!(escape_markdown_line(""), "");
    }

    #[test]
    fn to_markdown_joins_lines_with_trailing_newline() {
        let out = to_markdown("# Title\n\nBody text");
        assert_eq!(out, "\\# Title\n\nBody text\n");
    }
}
