//! `nopal update` (alias `upgrade`) — checks GitHub Releases for a newer
//! `nopal` build and, if one exists, downloads and installs it in place of
//! the currently running executable.
//!
//! Deliberately hand-rolled rather than pulling in `axoupdater` (which needs
//! tokio + a fairly large dependency tree for a single subcommand) — we
//! already know exactly where our releases live and how they're named, so
//! there's nothing generic to solve here. `self_replace` handles the one
//! genuinely tricky part (safely swapping out a running executable).

use serde::Deserialize;
use std::env;
use std::error::Error;
use std::fs;
use std::path::Path;
use std::process::Command;

const REPO: &str = "gwing33/nopal";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

pub fn update(check_only: bool) -> Result<(), Box<dyn Error>> {
    let target = current_target().ok_or(
        "Self-update isn't supported on this platform yet \u{2014} download a build manually \
         from https://github.com/gwing33/nopal/releases/latest",
    )?;

    println!("Checking for updates...");
    let release = fetch_latest_release()?;

    let latest_str = release
        .tag_name
        .strip_prefix("nopal-v")
        .or_else(|| release.tag_name.strip_prefix('v'))
        .unwrap_or(&release.tag_name);

    let current = semver::Version::parse(CURRENT_VERSION)
        .map_err(|e| format!("Couldn't parse current version {CURRENT_VERSION}: {e}"))?;
    let latest = semver::Version::parse(latest_str).map_err(|e| {
        format!(
            "Couldn't parse latest release tag {:?}: {e}",
            release.tag_name
        )
    })?;

    if latest <= current {
        println!("Already up to date (v{CURRENT_VERSION}).");
        return Ok(());
    }

    if check_only {
        println!(
            "A new version is available: v{latest} (you have v{CURRENT_VERSION}). Run \
             `nopal update` to install it."
        );
        return Ok(());
    }

    let asset_name = format!("nopal-{target}.tar.xz");
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| format!("Release v{latest} has no asset named {asset_name}"))?;

    println!("Downloading nopal v{latest} for {target}...");
    let tmp_dir = env::temp_dir().join(format!("nopal-update-{}", std::process::id()));
    fs::create_dir_all(&tmp_dir)?;

    let archive_path = tmp_dir.join(&asset_name);
    let result = (|| -> Result<(), Box<dyn Error>> {
        download_file(&asset.browser_download_url, &archive_path)?;

        println!("Installing...");
        let status = Command::new("tar")
            .arg("-xJf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&tmp_dir)
            .status()
            .map_err(|e| format!("Failed to run tar: {e}"))?;
        if !status.success() {
            return Err(format!("tar exited with {status}").into());
        }

        let new_binary = tmp_dir.join(format!("nopal-{target}")).join("nopal");
        if !new_binary.is_file() {
            return Err(format!(
                "Extracted archive did not contain the expected binary at {}",
                new_binary.display()
            )
            .into());
        }

        self_replace::self_replace(&new_binary)?;
        Ok(())
    })();

    let _ = fs::remove_dir_all(&tmp_dir);
    result?;

    println!("Updated: v{CURRENT_VERSION} -> v{latest}");
    Ok(())
}

fn fetch_latest_release() -> Result<GithubRelease, Box<dyn Error>> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "nopal-cli")
        .send()
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()).into());
    }

    Ok(resp.json()?)
}

fn download_file(url: &str, dest: &Path) -> Result<(), Box<dyn Error>> {
    let client = reqwest::blocking::Client::new();
    let mut resp = client
        .get(url)
        .header("User-Agent", "nopal-cli")
        .send()
        .map_err(|e| format!("Failed to download update: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status {}", resp.status()).into());
    }

    let mut file = fs::File::create(dest)?;
    resp.copy_to(&mut file)?;
    Ok(())
}

fn current_target() -> Option<&'static str> {
    match (env::consts::ARCH, env::consts::OS) {
        ("aarch64", "macos") => Some("aarch64-apple-darwin"),
        ("x86_64", "macos") => Some("x86_64-apple-darwin"),
        ("x86_64", "linux") => Some("x86_64-unknown-linux-gnu"),
        _ => None,
    }
}
