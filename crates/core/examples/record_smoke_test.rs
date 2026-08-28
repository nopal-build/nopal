//! Temporary manual smoke test for `nopal_core::record`, used to validate
//! the recording engine directly while `crates/cli` has an unrelated,
//! in-progress compile break (a project-sharing feature mid-edit). Not
//! meant to stick around — delete once `nopal record` itself is testable
//! via the CLI again.

use std::time::Duration;

fn main() {
    let screens = nopal_core::record::list_screens().expect("list_screens failed");
    for s in &screens {
        println!("available: {}: {}", s.index, s.name);
    }
    let target = screens.first().expect("no screens found");
    println!(
        "recording {} for 4s -> /tmp/nopal-record-smoke.mp4",
        target.name
    );

    let opts = nopal_core::record::RecordOptions {
        screen_index: target.index,
        output: "/tmp/nopal-record-smoke.mp4".into(),
        overwrite: true,
        ..Default::default()
    };
    eprintln!("calling start()...");
    let recording = nopal_core::record::start(opts).expect("start failed");
    eprintln!("start() returned, sleeping...");
    std::thread::sleep(Duration::from_secs(2));
    eprintln!("calling stop()...");
    let path = recording.stop().expect("stop failed");
    eprintln!("stop() returned");
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("done: {} ({} bytes)", path.display(), size);
}
