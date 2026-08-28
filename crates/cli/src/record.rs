//! `nopal record ...` — screen recording, capturing and compressing in a
//! single ffmpeg pass (see `nopal_core::record`'s own doc comment for why
//! this beats "record raw, then run `nopal video prep`" afterward).

use std::error::Error;
use std::io::BufRead;
use std::path::PathBuf;

use nopal_core::record::{self, RecordOptions};

pub fn list_screens() -> Result<(), Box<dyn Error + Send + Sync>> {
    let screens = record::list_screens()?;
    for screen in screens {
        println!("{}: {}", screen.index, screen.name);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn start(
    output: PathBuf,
    screen: u32,
    fps: u32,
    crf: u8,
    preset: String,
    max_height: u32,
    overwrite: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let opts = RecordOptions {
        screen_index: screen,
        output,
        fps,
        crf,
        preset,
        max_height,
        overwrite,
    };
    let output_path = opts.output.clone();

    println!("Recording screen {screen} -> {}", output_path.display());
    println!("(macOS will prompt for Screen Recording permission the first time.)");
    let recording = record::start(opts)?;
    println!("Press Enter to stop...");
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line)?;

    println!("Stopping...");
    let path = recording.stop()?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("Saved {} ({})", path.display(), human_size(size));
    Ok(())
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
