//! Nopal — native macOS app.
//!
//! Scope for this first pass: sign in (reusing the CLI's exact loopback
//! login flow) and browse/upload/download the Vault. Screen recording and
//! OxMarkdown editing are deliberately out of scope for now; syncing
//! management is the natural next step to build on this same shell.
//!
//! All networking/auth logic lives in `nopal_core` (shared with the `nopal`
//! CLI, `crates/cli`) — this crate is presentation only.

mod app;
mod login;
mod sync_view;
mod vault_view;

use app::NopalApp;

/// The default Nopal host — same default the CLI's `nopal login` uses.
pub const DEFAULT_HOST: &str = "https://nopal.build";

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([880.0, 620.0])
            .with_min_inner_size([560.0, 400.0])
            .with_title("Nopal"),
        ..Default::default()
    };

    eframe::run_native(
        "Nopal",
        options,
        Box::new(|cc| Ok(Box::new(NopalApp::new(cc)))),
    )
}
