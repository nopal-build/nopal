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

// The one set of prep defaults: `nopal video prep`'s flags and sync's
// `--preprocess` both read these, so a tuning change lands in both.
//
// Tuned for a filmic texture over maximum sharpness, small enough to share:
// - CRF 21 with x264's `film` tune and `aq-mode=3` keeps fine grain and
//   spends bits in dark flat areas, which is where 8-bit banding shows.
// - 1440 tall keeps UI text legible from a Retina capture (1080 visibly
//   softened it); lanczos is only the downscale kernel, no sharpening
//   filter is added.
// - `slow` costs little wall time here because decoding a large 10-bit
//   source, not the encoder, is the bottleneck; it bought ~15% size.
// - Frame rate is capped at 30: screen content gains nothing past it, and
//   the bits go to detail instead.
pub const DEFAULT_CRF: u8 = 21;
pub const DEFAULT_MAX_HEIGHT: u32 = 1440;
pub const DEFAULT_PRESET: &str = "slow";
pub const DEFAULT_MAX_FPS: u32 = 30;

pub struct PrepOptions {
    pub output: Option<PathBuf>,
    pub crf: u8,
    pub max_height: u32,
    pub preset: String,
    pub max_fps: u32,
    pub overwrite: bool,
}

impl Default for PrepOptions {
    fn default() -> Self {
        PrepOptions {
            output: None,
            crf: DEFAULT_CRF,
            max_height: DEFAULT_MAX_HEIGHT,
            preset: DEFAULT_PRESET.to_string(),
            max_fps: DEFAULT_MAX_FPS,
            overwrite: false,
        }
    }
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

    let source = probe(input);
    if source.as_ref().is_some_and(|p| p.is_hdr()) {
        log("  ! HDR source: encoding as 8-bit with its HDR tags kept; there is no tone mapping yet, so it may look flat or dim in some players");
    }
    let filters = web_filters(Some(opts.max_height), source.as_ref());

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
        .arg(&filters)
        .args(["-fpsmax", &opts.max_fps.to_string()])
        .args(["-c:v", "libx264"])
        .args(["-crf", &opts.crf.to_string()])
        .args(["-preset", &opts.preset])
        .args(["-tune", "film", "-x264-params", "aq-mode=3"])
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

/// What every browser decodes: 8-bit 4:2:0 H.264. Leaving the pixel format
/// to ffmpeg keeps the source's, and a 10-bit 4:2:2 recording then becomes
/// High 4:2:2 H.264, which desktop browsers show as a green frame with
/// working audio.
pub const WEB_PIX_FMT: &str = "yuv420p";

/// The filter chain that makes a frame web-safe: optional downscale, the
/// conversion to 8-bit 4:2:0 BT.709 (error-diffusion dither so a 10-bit
/// source's dark gradients don't step into bands), and the colour tags.
/// The tags go on the frames (`setparams`), not as output flags, because
/// current ffmpeg lets the frames' own (unknown) properties win over
/// `-color_primaries`/`-color_trc`.
pub fn web_filters(max_height: Option<u32>, source: Option<&SourceProbe>) -> String {
    // Escaped comma: `min(ih,H)` would otherwise be parsed by ffmpeg's own
    // filtergraph syntax as two separate filter arguments.
    let size = match max_height {
        Some(h) => format!("-2:min(ih\\,{h})"),
        None => "iw:ih".to_string(),
    };
    let scale = format!("scale={size}:flags=lanczos+accurate_rnd+full_chroma_int:sws_dither=ed");
    if source.is_some_and(|p| p.is_hdr()) {
        // Converting the matrix or tagging BT.709 would mislabel PQ/HLG
        // pixels; keep the source's tags until there is a tone map.
        return format!("{scale},format={WEB_PIX_FMT}");
    }
    // An untagged source is read as BT.709, as browsers do for HD;
    // swscale's own default would read it as BT.601 and shift colour.
    let in_matrix = match source.and_then(|p| p.color_space.as_deref()) {
        Some("bt709" | "bt470bg" | "smpte170m" | "bt2020nc") => "",
        _ => ":in_color_matrix=bt709",
    };
    format!(
        "{scale}{in_matrix}:out_color_matrix=bt709:out_range=tv,format={WEB_PIX_FMT},\
         setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
    )
}

/// The first video stream's format and colour tags, as ffprobe reports
/// them. `None` fields are ffprobe's "unknown".
#[derive(Debug, Clone, Default)]
pub struct SourceProbe {
    pub pix_fmt: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
}

impl SourceProbe {
    pub fn is_hdr(&self) -> bool {
        matches!(
            self.color_transfer.as_deref(),
            Some("smpte2084" | "arib-std-b67")
        )
    }

    /// Whether a browser will decode this file's video.
    pub fn is_web_playable(&self) -> bool {
        self.pix_fmt.as_deref() == Some(WEB_PIX_FMT)
    }
}

/// Probes a video with ffprobe. `None` when ffprobe isn't installed or
/// can't read the file; callers treat that as "don't know", never as bad.
pub fn probe(path: &Path) -> Option<SourceProbe> {
    let ffprobe = resolve_ffprobe()?;
    let out = Command::new(ffprobe)
        .args(["-v", "error", "-select_streams", "v:0"])
        .args(["-show_entries", "stream=pix_fmt,color_space,color_transfer"])
        .args(["-of", "default=noprint_wrappers=1"])
        .arg(path)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut probe = SourceProbe::default();
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = match value.trim() {
            "" | "unknown" => None,
            v => Some(v.to_string()),
        };
        match key {
            "pix_fmt" => probe.pix_fmt = value,
            "color_space" => probe.color_space = value,
            "color_transfer" => probe.color_transfer = value,
            _ => {}
        }
    }
    Some(probe)
}

/// ffprobe ships beside ffmpeg (Homebrew, distro packages), so look next to
/// whichever ffmpeg `resolve_ffmpeg` found before trying PATH.
fn resolve_ffprobe() -> Option<String> {
    let ffmpeg = resolve_ffmpeg().ok()?;
    let sibling = Path::new(&ffmpeg).with_file_name("ffprobe");
    if sibling.is_absolute() && command_works(&sibling.to_string_lossy()) {
        return Some(sibling.to_string_lossy().into_owned());
    }
    command_works("ffprobe").then(|| "ffprobe".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn probe_with(color_space: Option<&str>, color_transfer: Option<&str>) -> SourceProbe {
        SourceProbe {
            pix_fmt: Some("yuv422p10le".into()),
            color_space: color_space.map(Into::into),
            color_transfer: color_transfer.map(Into::into),
        }
    }

    #[test]
    fn every_chain_ends_in_the_web_pixel_format() {
        for source in [
            None,
            Some(probe_with(Some("bt709"), None)),
            Some(probe_with(None, Some("smpte2084"))),
        ] {
            let chain = web_filters(Some(1440), source.as_ref());
            assert!(chain.contains("format=yuv420p"), "{chain}");
        }
    }

    #[test]
    fn untagged_source_is_read_as_bt709_not_swscales_bt601() {
        assert!(web_filters(Some(1440), None).contains("in_color_matrix=bt709"));
        assert!(
            !web_filters(Some(1440), Some(&probe_with(Some("bt709"), None)))
                .contains("in_color_matrix")
        );
    }

    #[test]
    fn hdr_source_is_not_relabelled_bt709() {
        let chain = web_filters(
            Some(1440),
            Some(&probe_with(Some("bt2020nc"), Some("arib-std-b67"))),
        );
        assert!(!chain.contains("bt709"), "{chain}");
    }

    /// End to end through ffmpeg: a 10-bit 4:2:2 source (the format that
    /// came out as a green frame) must leave prep as 8-bit 4:2:0 tagged
    /// BT.709. Skipped where ffmpeg/ffprobe aren't installed.
    #[test]
    fn ten_bit_422_source_comes_out_browser_playable() {
        let (Ok(ffmpeg), Some(_)) = (resolve_ffmpeg(), resolve_ffprobe()) else {
            eprintln!("skipping: ffmpeg/ffprobe not installed");
            return;
        };
        let dir = std::env::temp_dir().join(format!("nopal-video-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mov");
        let made = Command::new(ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=640x360:r=60:d=1",
            ])
            .args(["-c:v", "libx264", "-pix_fmt", "yuv422p10le"])
            .arg(&src)
            .status()
            .unwrap();
        assert!(made.success());
        assert!(!probe(&src).unwrap().is_web_playable());

        let out = prep(
            &src,
            PrepOptions {
                output: Some(dir.join("out.mp4")),
                preset: "ultrafast".into(),
                ..Default::default()
            },
            &mut |_| {},
        )
        .unwrap();
        let got = probe(&out.output_path).unwrap();
        fs::remove_dir_all(&dir).ok();
        assert!(got.is_web_playable(), "{got:?}");
        assert_eq!(got.color_space.as_deref(), Some("bt709"));
        assert_eq!(got.color_transfer.as_deref(), Some("bt709"));
    }
}
