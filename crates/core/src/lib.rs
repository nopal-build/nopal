//! Shared Nopal client core: authentication and the Vault REST client.
//!
//! This crate holds everything that isn't specific to a particular
//! front-end — the `nopal` CLI (`crates/cli`) and the native macOS app
//! (`crates/app`) both depend on it rather than duplicating auth/Vault
//! logic. Anything here should stay UI-agnostic: no `println!`-driven
//! terminal UX and no GUI framework types. Callers own presentation;
//! this crate owns "talk to the Nopal server correctly."

pub mod auth;
pub mod record;
pub mod sync;
pub mod sync_api;
pub mod vault;
pub mod video;

/// A boxed error that's `Send + Sync`, so it can cross an `await` point /
/// be sent back from a background thread to a GUI event loop — plain
/// `Box<dyn Error>` (as the CLI still uses locally) isn't `Send`. Standard
/// library `From` impls make `?` work in both directions between the two.
pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;
