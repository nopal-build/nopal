//! The "Sync" tab: real sync-target management (list/add/remove/run now),
//! backed by `nopal_core::sync` — the exact same engine `nopal sync ...`
//! uses. A target's local directory always lives inside a project's (or
//! Personal's) `syncs`-typed vault folder — see the `vault` skill.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use eframe::egui;
use nopal_core::sync::{self, RunSummary, SyncTarget};
use nopal_core::vault::{Client, Folder};

enum Job {
    Targets(Result<Vec<SyncTarget>, String>),
    Projects(Result<Vec<Folder>, String>),
    Created(Result<SyncTarget, String>),
    Removed {
        name: String,
        result: Result<(), String>,
    },
    RunLine {
        target: String,
        line: String,
    },
    RunDone {
        target: String,
        result: Result<RunSummary, String>,
    },
}

/// The "Add a sync target" form's own state, separate from the target list
/// itself so it can be reset independently after a successful add.
struct AddForm {
    local_dir: Option<PathBuf>,
    name: String,
    project: Option<String>, // None == Personal
    two_way: bool,
    preprocess: bool,
    open: bool,
}

impl Default for AddForm {
    fn default() -> Self {
        AddForm {
            local_dir: None,
            name: String::new(),
            project: None,
            two_way: false,
            preprocess: false,
            open: false,
        }
    }
}

pub struct SyncScreen {
    client: Arc<Client>,
    targets: Option<Vec<SyncTarget>>,
    projects: Vec<Folder>,
    loading: bool,
    error: Option<String>,
    status: Option<String>,

    add_form: AddForm,

    /// The target currently confirming a "remove" action, plus whether the
    /// vault copy should be kept — cleared on confirm/cancel.
    pending_remove: Option<(String, bool)>,

    running_target: Option<String>,
    run_log: Vec<String>,
    /// Set after a run completes successfully so the next `ui()` call (the
    /// next place a `Context` is actually available) can re-fetch the
    /// authoritative target list — picking up the server-stamped
    /// `lastSyncedAt` rather than guessing it locally.
    needs_refresh: bool,

    /// One persistent channel for the screen's whole lifetime — every
    /// background job clones `tx` to send into it, rather than each job
    /// creating its own channel and overwriting a single `Option<Receiver>`
    /// field (which silently drops any job still in flight when a second
    /// one starts — the bug behind both the stuck "Loading targets..."
    /// spinner and the permanently-disabled "Add & sync" button, since
    /// `new()` kicks off two jobs — `refresh` and `load_projects` — back to
    /// back).
    tx: Sender<Job>,
    rx: Receiver<Job>,
    pending: u32,
}

impl SyncScreen {
    pub fn new(client: Arc<Client>, ctx: egui::Context) -> Self {
        let (tx, rx) = channel();
        let mut screen = SyncScreen {
            client,
            targets: None,
            projects: Vec::new(),
            loading: false,
            error: None,
            status: None,
            add_form: AddForm::default(),
            pending_remove: None,
            running_target: None,
            run_log: Vec::new(),
            needs_refresh: false,
            tx,
            rx,
            pending: 0,
        };
        screen.refresh(ctx.clone());
        screen.load_projects(ctx);
        screen
    }

    fn refresh(&mut self, ctx: egui::Context) {
        self.loading = true;
        self.error = None;
        let client = self.client.clone();
        let tx = self.tx.clone();
        self.pending += 1;
        std::thread::spawn(move || {
            let result = sync::fetch_targets(&client).map_err(|e| e.to_string());
            let _ = tx.send(Job::Targets(result));
            ctx.request_repaint();
        });
    }

    fn load_projects(&mut self, ctx: egui::Context) {
        let client = self.client.clone();
        let tx = self.tx.clone();
        self.pending += 1;
        std::thread::spawn(move || {
            let result = (|| -> Result<Vec<Folder>, String> {
                let projects_root = nopal_core::vault::resolve_folder(&client, "projects")
                    .map_err(|e| e.to_string())?;
                let Some(projects_root) = projects_root else {
                    return Ok(Vec::new());
                };
                let children = client
                    .children(&projects_root._id)
                    .map_err(|e| e.to_string())?;
                Ok(children.folders)
            })();
            let _ = tx.send(Job::Projects(result));
            ctx.request_repaint();
        });
    }

    /// Drains any finished background jobs. Called once per frame.
    pub fn poll(&mut self) {
        while let Ok(job) = self.rx.try_recv() {
            match job {
                Job::Targets(result) => {
                    self.pending = self.pending.saturating_sub(1);
                    self.loading = false;
                    match result {
                        Ok(targets) => self.targets = Some(targets),
                        Err(e) => self.error = Some(e),
                    }
                }
                Job::Projects(result) => {
                    self.pending = self.pending.saturating_sub(1);
                    if let Ok(projects) = result {
                        self.projects = projects;
                    }
                    // A failure here just leaves "Personal" as the only
                    // option — non-fatal, so no error surfaced.
                }
                Job::Created(result) => {
                    self.pending = self.pending.saturating_sub(1);
                    match result {
                        Ok(target) => {
                            self.status = Some(format!("Added '{}'", target.name));
                            self.add_form = AddForm::default();
                            match &mut self.targets {
                                Some(targets) => targets.push(target),
                                None => self.targets = Some(vec![target]),
                            }
                        }
                        Err(e) => self.error = Some(format!("Couldn't add sync target: {e}")),
                    }
                }
                Job::Removed { name, result } => {
                    self.pending = self.pending.saturating_sub(1);
                    match result {
                        Ok(()) => {
                            self.status = Some(format!("Removed '{name}'"));
                            if let Some(targets) = &mut self.targets {
                                targets.retain(|t| t.name != name);
                            }
                        }
                        Err(e) => self.error = Some(format!("Couldn't remove '{name}': {e}")),
                    }
                }
                Job::RunLine { target, line } => {
                    if self.running_target.as_deref() == Some(target.as_str()) {
                        self.run_log.push(line);
                    }
                }
                Job::RunDone { target, result } => {
                    self.pending = self.pending.saturating_sub(1);
                    if self.running_target.as_deref() == Some(target.as_str()) {
                        self.running_target = None;
                    }
                    match result {
                        Ok(summary) => {
                            self.status = Some(format!("'{target}': {}", summary.summary_line()));
                            self.needs_refresh = true;
                        }
                        Err(e) => self.error = Some(format!("Sync of '{target}' failed: {e}")),
                    }
                }
            }
        }
    }

    fn run_now(&mut self, target: SyncTarget, ctx: egui::Context) {
        self.error = None;
        self.status = None;
        self.run_log.clear();
        self.running_target = Some(target.name.clone());
        let client = self.client.clone();
        let tx = self.tx.clone();
        self.pending += 1;
        let target_name = target.name.clone();
        std::thread::spawn(move || {
            let tx_line = tx.clone();
            let ctx_line = ctx.clone();
            let result = sync::run_target(&client, &target, &mut |line| {
                let _ = tx_line.send(Job::RunLine {
                    target: target_name.clone(),
                    line: line.to_string(),
                });
                ctx_line.request_repaint();
            })
            .map_err(|e| e.to_string());
            let _ = tx.send(Job::RunDone {
                target: target_name.clone(),
                result,
            });
            ctx.request_repaint();
        });
    }

    fn remove_target(&mut self, name: String, keep_remote: bool, ctx: egui::Context) {
        let Some(target) = self
            .targets
            .as_ref()
            .and_then(|ts| ts.iter().find(|t| t.name == name).cloned())
        else {
            return;
        };
        self.error = None;
        let client = self.client.clone();
        let tx = self.tx.clone();
        self.pending += 1;
        std::thread::spawn(move || {
            let result =
                sync::remove_target(&client, &target, keep_remote).map_err(|e| e.to_string());
            let _ = tx.send(Job::Removed {
                name: target.name.clone(),
                result,
            });
            ctx.request_repaint();
        });
    }

    fn submit_add_form(&mut self, ctx: egui::Context) {
        let Some(local_dir) = self.add_form.local_dir.clone() else {
            self.error = Some("Choose a local folder first.".to_string());
            return;
        };
        let name = if self.add_form.name.trim().is_empty() {
            None
        } else {
            Some(self.add_form.name.trim().to_string())
        };
        let project = self.add_form.project.clone();
        let two_way = self.add_form.two_way;
        let preprocess = self.add_form.preprocess;

        self.error = None;
        self.status = Some("Adding sync target...".to_string());
        let client = self.client.clone();
        let tx = self.tx.clone();
        self.pending += 1;
        std::thread::spawn(move || {
            let created = sync::create_target(
                &client,
                &local_dir,
                name,
                preprocess,
                two_way,
                project.as_deref(),
            );
            match created {
                Ok((target, _space)) => {
                    let tx_line = tx.clone();
                    let ctx_line = ctx.clone();
                    let target_name = target.name.clone();
                    let run_result = sync::run_target(&client, &target, &mut |line| {
                        let _ = tx_line.send(Job::RunLine {
                            target: target_name.clone(),
                            line: line.to_string(),
                        });
                        ctx_line.request_repaint();
                    });
                    let _ = tx.send(Job::Created(Ok(target.clone())));
                    let _ = tx.send(Job::RunDone {
                        target: target.name.clone(),
                        result: run_result.map_err(|e| e.to_string()),
                    });
                }
                Err(e) => {
                    let _ = tx.send(Job::Created(Err(e.to_string())));
                }
            }
            ctx.request_repaint();
        });
        // Refresh the list once the add completes rather than guessing its
        // shape locally — `run_target` also stamps `lastSyncedAt` server-side.
        self.running_target = self.add_form.name_or_placeholder();
        self.run_log.clear();
    }

    pub fn ui(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        if self.needs_refresh {
            self.needs_refresh = false;
            self.refresh(ctx.clone());
        }

        ui.horizontal(|ui| {
            ui.heading("Sync");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Refresh").clicked() {
                    self.refresh(ctx.clone());
                }
            });
        });
        ui.label(
            "Mirrors a local folder into a project's (or your Personal space's) Syncs folder.",
        );
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
                ui.label("Loading targets...");
            });
        }

        ui.separator();

        egui::CollapsingHeader::new("Add a sync target")
            .default_open(self.add_form.open)
            .show(ui, |ui| {
                self.add_form.open = true;
                ui.horizontal(|ui| {
                    if ui.button("Choose folder...").clicked() {
                        if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                            self.add_form.local_dir = Some(dir);
                        }
                    }
                    match &self.add_form.local_dir {
                        Some(dir) => ui.label(dir.display().to_string()),
                        None => ui.weak("No folder chosen"),
                    };
                });

                ui.horizontal(|ui| {
                    ui.label("Name:");
                    ui.text_edit_singleline(&mut self.add_form.name);
                    ui.weak("(defaults to the folder name)");
                });

                ui.horizontal(|ui| {
                    ui.label("Scope:");
                    egui::ComboBox::from_id_salt("sync-scope")
                        .selected_text(self.add_form.project.as_deref().unwrap_or("Personal"))
                        .show_ui(ui, |ui| {
                            ui.selectable_value(&mut self.add_form.project, None, "Personal");
                            for project in &self.projects {
                                ui.selectable_value(
                                    &mut self.add_form.project,
                                    Some(project.name.clone()),
                                    &project.name,
                                );
                            }
                        });
                });

                ui.checkbox(
                    &mut self.add_form.two_way,
                    "Two-way (also pull vault changes down)",
                );
                ui.checkbox(
                    &mut self.add_form.preprocess,
                    "Optimize videos before uploading",
                );

                ui.add_space(6.0);
                if ui
                    .add_enabled(self.pending == 0, egui::Button::new("Add & sync"))
                    .clicked()
                {
                    self.submit_add_form(ctx.clone());
                }
            });

        ui.separator();

        egui::ScrollArea::vertical()
            .id_salt("sync-targets-scroll")
            .max_height(ui.available_height() * 0.55)
            .show(ui, |ui| {
                let Some(targets) = self.targets.clone() else {
                    return;
                };
                if targets.is_empty() && !self.loading {
                    ui.label("No sync targets yet — add one above.");
                    return;
                }
                for target in &targets {
                    ui.group(|ui| {
                        ui.horizontal(|ui| {
                            ui.vertical(|ui| {
                                ui.strong(&target.name);
                                ui.weak(&target.local_path);
                                let mode = if target.two_way { "two-way" } else { "one-way" };
                                let last = target
                                    .last_synced_at
                                    .as_deref()
                                    .map(|s| s.split('T').next().unwrap_or(s).to_string())
                                    .unwrap_or_else(|| "never".to_string());
                                ui.weak(format!("{mode} \u{2022} last synced: {last}"));
                            });
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    let running = self.running_target.as_deref()
                                        == Some(target.name.as_str());
                                    if ui
                                        .add_enabled(
                                            self.pending == 0 || running,
                                            egui::Button::new("Remove"),
                                        )
                                        .clicked()
                                    {
                                        self.pending_remove = Some((target.name.clone(), false));
                                    }
                                    if running {
                                        ui.spinner();
                                        ui.label("Syncing...");
                                    } else if ui
                                        .add_enabled(
                                            self.pending == 0,
                                            egui::Button::new("Run now"),
                                        )
                                        .clicked()
                                    {
                                        self.run_now(target.clone(), ctx.clone());
                                    }
                                },
                            );
                        });
                    });
                }
            });

        if let Some((name, mut keep_remote)) = self.pending_remove.clone() {
            let mut do_remove = false;
            let mut do_cancel = false;
            egui::Window::new(format!("Remove '{name}'?"))
                .collapsible(false)
                .resizable(false)
                .show(ctx, |ui| {
                    ui.checkbox(&mut keep_remote, "Keep the vault copy");
                    ui.horizontal(|ui| {
                        if ui.button("Remove").clicked() {
                            do_remove = true;
                        }
                        if ui.button("Cancel").clicked() {
                            do_cancel = true;
                        }
                    });
                });
            if do_remove {
                self.remove_target(name, keep_remote, ctx.clone());
                self.pending_remove = None;
            } else if do_cancel {
                self.pending_remove = None;
            } else {
                self.pending_remove = Some((name, keep_remote));
            }
        }

        if !self.run_log.is_empty() {
            ui.separator();
            ui.label(match &self.running_target {
                Some(name) => format!("Syncing '{name}'..."),
                None => "Last run log".to_string(),
            });
            egui::ScrollArea::vertical()
                .id_salt("sync-log-scroll")
                .max_height(160.0)
                .stick_to_bottom(true)
                .show(ui, |ui| {
                    for line in &self.run_log {
                        ui.monospace(line);
                    }
                });
        }
    }
}

impl AddForm {
    fn name_or_placeholder(&self) -> Option<String> {
        if self.name.trim().is_empty() {
            self.local_dir
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string())
        } else {
            Some(self.name.trim().to_string())
        }
    }
}
