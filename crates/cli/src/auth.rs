//! `nopal login` / `logout` / `whoami`.
//!
//! The actual login flow, credential storage, and sync-scoped credential
//! handling live in `nopal_core::auth` (shared with the native app) — this
//! module just re-exports it under `crate::auth` so the rest of the CLI
//! (`main.rs`, `sync.rs`, `watch.rs`) doesn't need to know the difference.
//! See `nopal_core::auth`'s own doc comment for the full loopback-login
//! flow explanation.

pub use nopal_core::auth::*;
