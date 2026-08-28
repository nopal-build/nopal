//! Screen recording via ffmpeg's `avfoundation` input device.
//!
//! The key design decision: ffmpeg captures AND encodes in a single pass,
//! straight to H.264, using the exact same crf/preset/scale knobs
//! `video::prep` exposes for a one-off compress. There's no separate
//! "record raw, then optimize" step — recording something already produces
//! a small, shareable file the moment it stops. This answers the "can we
//! optimize as we record" question directly: yes, and it's simpler than
//! post-processing, not more complex — one ffmpeg invocation instead of
//! two, no large intermediate raw file to manage or clean up.
//!
//! macOS will prompt for Screen Recording permission the first time
//! whatever process invokes ffmpeg (a terminal, or this app once bundled/
//! signed) tries to open an `avfoundation` screen device — same TCC
//! prompt any other capture tool triggers. Nothing here can pre-grant it.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::video::resolve_ffmpeg;
use crate::Result;

#[derive(Debug, Clone)]
pub struct CaptureTarget {
    pub index: u32,
    /// ffmpeg's own device label, e.g. "Capture screen 0".
    pub name: String,
}

/// Lists capturable screens via ffmpeg's own `-list_devices` output —
/// reuses whatever ffmpeg `video::resolve_ffmpeg` already finds, so there's
/// no separate discovery mechanism (and no separate "is ffmpeg installed"
/// check) to keep in sync with the rest of the video pipeline.
pub fn list_screens() -> Result<Vec<CaptureTarget>> {
    let ffmpeg = resolve_ffmpeg()?;
    // This invocation always "fails" (ffmpeg has nothing real to open for
    // an empty input) — the device list is on stderr regardless of the
    // nonzero exit, so the `Output` is read directly rather than checked.
    let output = Command::new(&ffmpeg)
        .args(["-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
    let text = String::from_utf8_lossy(&output.stderr);

    let mut screens = Vec::new();
    for line in text.lines() {
        // e.g. "[AVFoundation indev @ 0x...] [4] Capture screen 0"
        let Some(after_video_devices) = line.split_once("] [") else {
            continue;
        };
        let Some((idx_str, rest)) = after_video_devices.1.split_once(']') else {
            continue;
        };
        let name = rest.trim();
        if !name.starts_with("Capture screen") {
            continue;
        }
        if let Ok(index) = idx_str.trim().parse::<u32>() {
            screens.push(CaptureTarget {
                index,
                name: name.to_string(),
            });
        }
    }

    if screens.is_empty() {
        return Err(
            "No capturable screens found in ffmpeg's avfoundation device list \
             (unexpected — try `ffmpeg -f avfoundation -list_devices true -i \"\"` directly)."
                .into(),
        );
    }
    Ok(screens)
}

pub struct RecordOptions {
    pub screen_index: u32,
    pub output: PathBuf,
    /// Screen content rarely benefits from more than 30fps, and halving
    /// the frame rate roughly halves the encoder's real-time workload —
    /// the main lever for keeping up live vs. dropping frames.
    pub fps: u32,
    pub crf: u8,
    /// A REAL-TIME-safe preset, unlike `video::prep`'s post-hoc default of
    /// "medium" — "medium"/"slow" can't keep up with encoding 1080p+ at
    /// 30fps live on a lot of hardware, which drops frames rather than
    /// slowing down (ffmpeg can't "pause" a live capture). "veryfast" (or
    /// "ultrafast" for older/slower Macs) trades a little compression
    /// efficiency for headroom.
    pub preset: String,
    pub max_height: u32,
    pub overwrite: bool,
}

impl Default for RecordOptions {
    fn default() -> Self {
        RecordOptions {
            screen_index: 0,
            output: PathBuf::new(),
            fps: 30,
            crf: 23,
            preset: "veryfast".to_string(),
            max_height: 1080,
            overwrite: false,
        }
    }
}

/// A recording in progress. Holds the live ffmpeg child process — dropping
/// this without calling `stop()` leaves ffmpeg running and the output file
/// unfinalized (no moov atom, won't play back); always call `stop()`.
pub struct Recording {
    child: Child,
    pub output: PathBuf,
    started_at: Instant,
}

pub fn start(opts: RecordOptions) -> Result<Recording> {
    let ffmpeg = resolve_ffmpeg()?;
    if opts.output.exists() && !opts.overwrite {
        return Err(format!(
            "{} already exists — pass overwrite, or choose a different output path.",
            opts.output.display()
        )
        .into());
    }
    if let Some(parent) = opts.output.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    // Same escaped-comma trick `video::prep` uses: `min(ih,H)` would
    // otherwise be parsed as two separate filtergraph arguments.
    let scale_filter = format!("scale=-2:min(ih\\,{})", opts.max_height);

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg(if opts.overwrite { "-y" } else { "-n" })
        // Suppresses the version/config banner AND ffmpeg's default
        // per-frame progress stats on stderr — not just noise: without
        // this, a long recording can write enough stderr to fill the OS
        // pipe buffer before `stop()` ever reads it (nothing drains stderr
        // until the recording ends), which would make ffmpeg block trying
        // to write more and silently stall the recording itself. Real
        // failures (bad device, permission denial, ...) still log at the
        // "error" level, so this doesn't hide anything `stop()` needs.
        .args(["-hide_banner", "-loglevel", "error"])
        .args(["-f", "avfoundation"])
        .args(["-framerate", &opts.fps.to_string()])
        // Draws the real cursor into the recording — off by default, a
        // screen recording without a visible pointer is hard to follow.
        .args(["-capture_cursor", "1"])
        .args(["-i", &format!("{}:none", opts.screen_index)])
        .args(["-vf", &scale_filter])
        .args(["-c:v", "libx264"])
        .args(["-crf", &opts.crf.to_string()])
        .args(["-preset", &opts.preset])
        .args(["-pix_fmt", "yuv420p"])
        .args(["-movflags", "+faststart"])
        .arg(&opts.output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {e}"))?;

    Ok(Recording {
        child,
        output: opts.output,
        started_at: Instant::now(),
    })
}

impl Recording {
    pub fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    /// Gracefully stops the recording — ffmpeg's own documented "press q
    /// to quit" mechanism, which flushes the encoder and writes a valid
    /// moov atom so the file is immediately playable, unlike killing the
    /// process outright. Blocks until ffmpeg actually exits (finalizing an
    /// mp4 takes a moment), then returns the finished file's path.
    pub fn stop(mut self) -> Result<PathBuf> {
        if let Some(mut stdin) = self.child.stdin.take() {
            let _ = stdin.write_all(b"q");
        }
        let output = self
            .child
            .wait_with_output()
            .map_err(|e| format!("Waiting for ffmpeg to finish failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // ffmpeg's own stderr is verbose (codec/build banners, per-frame
            // stats) — the actual failure reason is almost always in the
            // last few lines, so only that tail is surfaced.
            let tail: String = stderr
                .lines()
                .rev()
                .take(8)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(format!(
                "ffmpeg exited with {} — the recording may be missing or incomplete.\n{tail}",
                output.status
            )
            .into());
        }
        Ok(self.output)
    }
}
