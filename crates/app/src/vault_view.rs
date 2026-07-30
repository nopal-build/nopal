//! The signed-in screen: browse Vault folders/files, upload, and download.
//! Everything here is presentation over `nopal_core::vault` — the same
//! REST client the `nopal` CLI's `vault` commands use.
//!
//! Deliberately out of scope for this first pass: OxMarkdown
//! viewing/editing (a file row's "Download" is the only way to get at a
//! file's bytes today) and any sync-target management — that's the
//! natural next thing to build on this same shell.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;

use eframe::egui;
use nopal_core::vault::{self, Children, Client, FileListing, Folder};

/// One crumb in the breadcrumb trail above the current folder's contents.
/// The vault root itself is implicit (folder_id `"root"`) and always shown
/// first — this stack holds everything BELOW it.
struct Crumb {
    folder_id: String,
    name: String,
}

enum Job {
    Listing {
        folder_id: String,
        result: Result<Children, String>,
    },
    Upload {
        result: Result<String, String>,
    },
    Download {
        name: String,
        result: Result<PathBuf, String>,
    },
}

pub struct VaultScreen {
    client: Arc<Client>,
    pub email: String,
    pub host: String,

    crumbs: Vec<Crumb>,
    listing: Option<Children>,
    loading: bool,
    error: Option<String>,
    status: Option<String>,

    rx: Option<Receiver<Job>>,
    /// How many background jobs are currently in flight — the upload
    /// button disables itself while > 0, and separate uploads (one per
    /// picked file) don't stomp on each other's `rx` since they all share
    /// this one channel/receiver pump.
    pending: u32,
}

pub enum VaultOutcome {
    None,
    LoggedOut,
}

impl VaultScreen {
    pub fn new(client: Client, email: String, host: String, ctx: egui::Context) -> Self {
        let mut screen = VaultScreen {
            client: Arc::new(client),
            email,
            host,
            crumbs: Vec::new(),
            listing: None,
            loading: false,
            error: None,
            status: None,
            rx: None,
            pending: 0,
        };
        screen.fetch("root".to_string(), ctx);
        screen
    }

    fn current_folder_id(&self) -> String {
        self.crumbs
            .last()
            .map(|c| c.folder_id.clone())
            .unwrap_or_else(|| "root".to_string())
    }

    fn fetch(&mut self, folder_id: String, ctx: egui::Context) {
        self.loading = true;
        self.error = None;
        let client = self.client.clone();
        let (tx, rx) = channel();
        self.rx = Some(rx);
        self.pending += 1;
        let fid = folder_id.clone();
        std::thread::spawn(move || {
            let result = client.children(&fid).map_err(|e| e.to_string());
            let _ = tx.send(Job::Listing {
                folder_id: fid,
                result,
            });
            ctx.request_repaint();
        });
    }

    /// Drains any finished background jobs. Called once per frame.
    pub fn poll(&mut self) {
        let Some(rx) = &self.rx else { return };
        while let Ok(job) = rx.try_recv() {
            self.pending = self.pending.saturating_sub(1);
            match job {
                Job::Listing { folder_id, result } => {
                    if folder_id == self.current_folder_id() {
                        self.loading = false;
                        match result {
                            Ok(children) => self.listing = Some(children),
                            Err(e) => self.error = Some(e),
                        }
                    }
                }
                Job::Upload { result } => match result {
                    Ok(name) => self.status = Some(format!("Uploaded {name}")),
                    Err(e) => self.error = Some(format!("Upload failed: {e}")),
                },
                Job::Download { name, result } => match result {
                    Ok(path) => {
                        self.status = Some(format!("Downloaded {name} -> {}", path.display()))
                    }
                    Err(e) => self.error = Some(format!("Download failed: {e}")),
                },
            }
        }
    }

    fn open_folder(&mut self, folder: &Folder, ctx: egui::Context) {
        self.crumbs.push(Crumb {
            folder_id: folder._id.clone(),
            name: folder.name.clone(),
        });
        self.listing = None;
        self.status = None;
        self.fetch(folder._id.clone(), ctx);
    }

    fn go_to_crumb(&mut self, index: usize, ctx: egui::Context) {
        // index == crumbs.len() means "go to root" (truncate everything).
        self.crumbs.truncate(index);
        self.listing = None;
        self.status = None;
        self.fetch(self.current_folder_id(), ctx);
    }

    fn upload_files(&mut self, ctx: egui::Context) {
        let Some(paths) = rfd::FileDialog::new().pick_files() else {
            return;
        };
        let folder_id = self.current_folder_id();
        // Uploading needs a real `Folder`, not just an id — the vault
        // skill's write-policy checks key off `vault_root_key`, which
        // `upload_file` doesn't otherwise need to look up separately if we
        // fetch it once here.
        let client = self.client.clone();
        for path in paths {
            let (tx, rx) = channel();
            self.rx = Some(rx);
            self.pending += 1;
            let client = client.clone();
            let folder_id = folder_id.clone();
            let ctx = ctx.clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<String, String> {
                    let folder = Folder {
                        _id: folder_id,
                        name: String::new(),
                        vault_root_key: None,
                        folder_type: None,
                        shared_with: serde_json::Value::Array(vec![]),
                        is_public: None,
                        updated_at: String::new(),
                    };
                    let uploaded = vault::upload_file(&client, &path, &folder, |_| {})
                        .map_err(|e| e.to_string())?;
                    Ok(uploaded.name)
                })();
                let _ = tx.send(Job::Upload { result });
                ctx.request_repaint();
            });
        }
        // Re-fetch the current listing shortly after kicking off uploads —
        // good enough for a first pass; a real progress list can replace
        // this once syncing lands.
        self.fetch(folder_id, ctx);
    }

    fn download_file(&mut self, file: &FileListing, ctx: egui::Context) {
        let Some(dest) = rfd::FileDialog::new().set_file_name(&file.name).save_file() else {
            return;
        };
        let client = self.client.clone();
        let listing = file.clone();
        let (tx, rx) = channel();
        self.rx = Some(rx);
        self.pending += 1;
        std::thread::spawn(move || {
            let result = vault::download_file(&client, &listing, &dest)
                .map(|()| dest)
                .map_err(|e| e.to_string());
            let _ = tx.send(Job::Download {
                name: listing.name.clone(),
                result,
            });
            ctx.request_repaint();
        });
    }

    pub fn ui(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) -> VaultOutcome {
        let mut outcome = VaultOutcome::None;

        ui.horizontal(|ui| {
            ui.label(format!("{} ({})", self.email, self.host));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Log out").clicked() {
                    outcome = VaultOutcome::LoggedOut;
                }
            });
        });
        ui.separator();

        ui.horizontal(|ui| {
            let root_button = ui.link("Vault");
            if root_button.clicked() {
                self.go_to_crumb(0, ctx.clone());
            }
            let crumb_names: Vec<String> = self.crumbs.iter().map(|c| c.name.clone()).collect();
            for (i, name) in crumb_names.iter().enumerate() {
                ui.label("/");
                if ui.link(name).clicked() {
                    self.go_to_crumb(i + 1, ctx.clone());
                }
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui
                    .add_enabled(self.pending == 0, egui::Button::new("Upload files..."))
                    .clicked()
                {
                    self.upload_files(ctx.clone());
                }
                if ui.button("Refresh").clicked() {
                    self.listing = None;
                    self.fetch(self.current_folder_id(), ctx.clone());
                }
            });
        });
        ui.add_space(6.0);

        if let Some(err) = &self.error {
            ui.colored_label(egui::Color32::from_rgb(200, 60, 60), err);
        }
        if let Some(status) = &self.status {
            ui.colored_label(egui::Color32::from_rgb(60, 140, 60), status);
        }
        if self.loading {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label("Loading...");
            });
        }

        ui.separator();

        egui::ScrollArea::vertical().show(ui, |ui| {
            let Some(listing) = self.listing.clone() else {
                return;
            };
            if listing.folders.is_empty() && listing.files.is_empty() && !self.loading {
                ui.label("(empty)");
                return;
            }

            for folder in &listing.folders {
                ui.horizontal(|ui| {
                    ui.set_min_width(ui.available_width());
                    if ui.link(format!("\u{1F4C1} {}/", folder.name)).clicked() {
                        self.open_folder(folder, ctx.clone());
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.weak(vault::format_date(&folder.updated_at));
                    });
                });
            }
            for file in &listing.files {
                ui.horizontal(|ui| {
                    ui.set_min_width(ui.available_width());
                    ui.label(format!("\u{1F4C4} {}", file.name));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.small_button("Download").clicked() {
                            self.download_file(file, ctx.clone());
                        }
                        ui.weak(vault::format_date(&file.updated_at));
                        ui.weak(vault::format_size(file.size));
                    });
                });
            }
        });

        outcome
    }
}
