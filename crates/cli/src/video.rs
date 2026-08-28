//! `nopal video ...` — utilities for working with video files.
//!
//! `prep` is the first of these: re-encode a video (typically a desktop
//! screen recording) into a smaller, web-friendly H.264 mp4 before it's
//! uploaded anywhere. The actual ffmpeg work lives in `nopal_core::video`
//! (shared with the sync engine's `--preprocess` option) — this module is
//! just the CLI's printing wrapper over it.

use std::error::Error;
use std::path::Path;

pub(crate) use nopal_core::video::resolve_ffmpeg;
pub use nopal_core::video::PrepOptions;

pub fn prep(input: &Path, opts: PrepOptions) -> Result<(), Box<dyn Error + Send + Sync>> {
    let result = nopal_core::video::prep(input, opts, &mut |line| println!("{line}"))?;
    println!("{}", result.output_path.display());
    Ok(())
}
