//! The "Record" tab: screen recording via `nopal_core::record`, which
//! captures and compresses in a single ffmpeg pass — a finished recording
//! is already a small, shareable file, no separate optimize step needed.
//!
//! Starting/stopping ffmpeg itself is near-instant (spawning a process, or
//! writing one byte to its stdin), so only the two genuinely slow things
//! run in the background: waiting for ffmpeg to finalize the file on
//! `stop()`, and uploading the result to the Vault.

use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use eframe::egui;
use nopal_core::record::{self, CaptureTarget, RecordOptions, Recording};
use nopal_core::sync;
use nopal_core::vault::{self, Client, Folder};

/// A simple quality/size tradeoff picker, standing in for exposing raw
/// crf/max-height controls in a first pass. The ffmpeg speed preset is
/// deliberately NOT part of this choice — "veryfast" is kept fixed
/// regardless of quality level, since a slower preset risks dropping
/// frames during a LIVE capture (unlike `nopal video prep`, which runs
/// against an already-finished file and can afford to take its time).
#[derive(PartialEq, Clone, Copy)]
enum Quality {
    Small,
    Balanced,
    High,
}

impl Quality {
    const ALL: [Quality; 3] = [Quality::Small, Quality::Balanced, Quality::High];

    fn label(self) -> &'static str {
        match self {
            Quality::Small => "Small file (720p)",
            Quality::Balanced => "Balanced (1080p)",
            Quality::High => "High quality (1440p)",
        }
    }

    fn crf_and_height(self) -> (u8, u32) {
        match self {
            Quality::Small => (28, 720),
            Quality::Balanced => (23, 1080),
            Quality::High => (18, 1440),
        }
    }
}

enum Job {
    Stopped(Result<PathBuf, String>),
    Projects(Result<Vec<Folder>, String>),
    Uploaded(Result<String, String>),
}

pub struct RecordScreen {
    client: Arc<Client>,

    screens: Vec<CaptureTarget>,
    selected_screen: Option<u32>,
    screens_error: Option<String>,

    quality: Quality,
    fps: u32,

    /// `Some` while a recording is actively in progress.
    active: Option<Recording>,
    /// `true` between clicking Stop and the background `stop()` finishing.
    stopping: bool,

    last_output: Option<PathBuf>,
    last_output_size: Option<u64>,

    projects: Vec<Folder>,
    upload_project: Option<String>, // None == Personal
    uploading: bool,

    error: Option<String>,
    status: Option<String>,

    tx: Sender<Job>,
    rx: Receiver<Job>,
}

impl RecordScreen {
    pub fn new(client: Arc<Client>, ctx: egui::Context) -> Self {
        let (screens, screens_error) = match record::list_screens() {
            Ok(s) => (s, None),
            Err(e) => (Vec::new(), Some(e.to_string())),
        };
        let selected_screen = screens.first().map(|s| s.index);

        let (tx, rx) = channel();
        let mut screen = RecordScreen {
            client,
            screens,
            selected_screen,
            screens_error,
            quality: Quality::Balanced,
            fps: 30,
            active: None,
            stopping: false,
            last_output: None,
            last_output_size: None,
            projects: Vec::new(),
            upload_project: None,
            uploading: false,
            error: None,
            status: None,
            tx,
            rx,
        };
        screen.load_projects(ctx);
        screen
    }

    fn load_projects(&mut self, ctx: egui::Context) {
        let client = self.client.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = vault::list_projects(&client).map_err(|e| e.to_string());
            let _ = tx.send(Job::Projects(result));
            ctx.request_repaint();
        });
    }

    pub fn poll(&mut self) {
        while let Ok(job) = self.rx.try_recv() {
            match job {
                Job::Stopped(result) => {
                    self.stopping = false;
                    match result {
                        Ok(path) => {
                            self.last_output_size = std::fs::metadata(&path).map(|m| m.len()).ok();
                            self.last_output = Some(path);
                            self.status = Some("Recording saved.".to_string());
                        }
                        Err(e) => self.error = Some(format!("Recording may be incomplete: {e}")),
                    }
                }
                Job::Projects(result) => {
                    if let Ok(projects) = result {
                        self.projects = projects;
                    }
                }
                Job::Uploaded(result) => {
                    self.uploading = false;
                    match result {
                        Ok(name) => self.status = Some(format!("Uploaded {name} to the Vault.")),
                        Err(e) => self.error = Some(format!("Upload failed: {e}")),
                    }
                }
            }
        }
    }

    fn start_recording(&mut self) {
        let Some(screen_index) = self.selected_screen else {
            self.error = Some("No screen selected.".to_string());
            return;
        };
        self.error = None;
        self.status = None;
        self.last_output = None;

        let output = default_output_path();
        let (crf, max_height) = self.quality.crf_and_height();
        let opts = RecordOptions {
            screen_index,
            output,
            fps: self.fps,
            crf,
            max_height,
            overwrite: true,
            ..Default::default()
        };
        // Spawning ffmpeg is effectively instant, so this runs directly on
        // the UI thread rather than through the job/channel machinery.
        match record::start(opts) {
            Ok(recording) => self.active = Some(recording),
            Err(e) => self.error = Some(format!("Couldn't start recording: {e}")),
        }
    }

    fn stop_recording(&mut self, ctx: egui::Context) {
        let Some(recording) = self.active.take() else {
            return;
        };
        self.stopping = true;
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = recording.stop().map_err(|e| e.to_string());
            let _ = tx.send(Job::Stopped(result));
            ctx.request_repaint();
        });
    }

    fn upload_last_output(&mut self, ctx: egui::Context) {
        let Some(path) = self.last_output.clone() else {
            return;
        };
        self.error = None;
        self.uploading = true;
        let client = self.client.clone();
        let project = self.upload_project.clone();
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<String, String> {
                // Reuses the sync engine's own "Personal or named project"
                // resolution — same scope picker, same underlying folder.
                let space =
                    sync::resolve_space(&client, project.as_deref()).map_err(|e| e.to_string())?;
                let uploaded = vault::upload_file(&client, &path, &space, |_| {})
                    .map_err(|e| e.to_string())?;
                Ok(uploaded.name)
            })();
            let _ = tx.send(Job::Uploaded(result));
            ctx.request_repaint();
        });
    }

    pub fn ui(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.heading("Record");
        ui.label(
            "Captures and compresses in one pass \u{2014} no separate optimize step afterward.",
        );
        ui.add_space(6.0);

        if let Some(err) = &self.error {
            ui.colored_label(egui::Color32::from_rgb(200, 60, 60), err);
        }
        if let Some(status) = &self.status {
            ui.colored_label(egui::Color32::from_rgb(60, 140, 60), status);
        }
        if let Some(err) = &self.screens_error {
            ui.colored_label(
                egui::Color32::from_rgb(200, 60, 60),
                format!("Couldn't list screens: {err}"),
            );
        }

        ui.add_space(6.0);
        let recording_or_stopping = self.active.is_some() || self.stopping;

        ui.add_enabled_ui(!recording_or_stopping, |ui| {
            ui.horizontal(|ui| {
                ui.label("Screen:");
                egui::ComboBox::from_id_salt("record-screen")
                    .selected_text(
                        self.screens
                            .iter()
                            .find(|s| Some(s.index) == self.selected_screen)
                            .map(|s| s.name.clone())
                            .unwrap_or_else(|| "No screen found".to_string()),
                    )
                    .show_ui(ui, |ui| {
                        for screen in &self.screens {
                            ui.selectable_value(
                                &mut self.selected_screen,
                                Some(screen.index),
                                &screen.name,
                            );
                        }
                    });
            });

            ui.horizontal(|ui| {
                ui.label("Quality:");
                egui::ComboBox::from_id_salt("record-quality")
                    .selected_text(self.quality.label())
                    .show_ui(ui, |ui| {
                        for q in Quality::ALL {
                            ui.selectable_value(&mut self.quality, q, q.label());
                        }
                    });
            });

            ui.horizontal(|ui| {
                ui.label("Frame rate:");
                egui::ComboBox::from_id_salt("record-fps")
                    .selected_text(format!("{} fps", self.fps))
                    .show_ui(ui, |ui| {
                        for fps in [15, 30, 60] {
                            ui.selectable_value(&mut self.fps, fps, format!("{fps} fps"));
                        }
                    });
            });
        });

        ui.add_space(10.0);

        if let Some(recording) = &self.active {
            ui.horizontal(|ui| {
                ui.colored_label(egui::Color32::from_rgb(200, 60, 60), "\u{25cf} Recording");
                let secs = recording.elapsed().as_secs();
                ui.label(format!("{:02}:{:02}", secs / 60, secs % 60));
            });
            if ui.button("Stop Recording").clicked() {
                self.stop_recording(ctx.clone());
            }
        } else if self.stopping {
            ui.horizontal(|ui| {
                ui.spinner();
                ui.label("Finishing up...");
            });
        } else if ui
            .add_enabled(
                self.selected_screen.is_some(),
                egui::Button::new("\u{25cf} Start Recording"),
            )
            .clicked()
        {
            self.start_recording();
        }

        if let Some(path) = self.last_output.clone() {
            ui.add_space(12.0);
            ui.separator();
            ui.label(format!(
                "Saved: {} ({})",
                path.display(),
                self.last_output_size.map(human_size).unwrap_or_default()
            ));
            ui.horizontal(|ui| {
                if ui.button("Reveal in Finder").clicked() {
                    let _ = std::process::Command::new("open")
                        .arg("-R")
                        .arg(&path)
                        .spawn();
                }
                ui.label("Upload to:");
                egui::ComboBox::from_id_salt("record-upload-scope")
                    .selected_text(self.upload_project.as_deref().unwrap_or("Personal"))
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut self.upload_project, None, "Personal");
                        for project in &self.projects {
                            ui.selectable_value(
                                &mut self.upload_project,
                                Some(project.name.clone()),
                                &project.name,
                            );
                        }
                    });
                if ui
                    .add_enabled(!self.uploading, egui::Button::new("Upload to Vault"))
                    .clicked()
                {
                    self.upload_last_output(ctx.clone());
                }
                if self.uploading {
                    ui.spinner();
                }
            });
        }
    }
}

fn default_output_path() -> PathBuf {
    let dir = dirs::video_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("Nopal");
    let name = format!(
        "Recording {}.mp4",
        jiff::Zoned::now().strftime("%Y-%m-%d at %H.%M.%S")
    );
    dir.join(name)
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
