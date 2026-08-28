//! The signed-out screen: "Sign in to Nopal" over the CLI's exact loopback
//! login flow (`nopal_core::auth::LoginFlow`) — a local callback server,
//! the user's browser approving in the real Nopal web app, then a
//! background thread blocking on the redirect while the UI stays
//! responsive.

use std::sync::mpsc::{Receiver, channel};
use std::time::Duration;

use eframe::egui;
use nopal_core::auth::{Credentials, LoginFlow};

use crate::DEFAULT_HOST;

/// How long the background thread waits for the browser to redirect back
/// before giving up — matches the CLI's own `nopal login` timeout.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

enum Status {
    Idle,
    WaitingForBrowser { url: String },
    Error(String),
}

pub struct LoginScreen {
    status: Status,
    host: String,
    rx: Option<Receiver<Result<Credentials, String>>>,
}

impl Default for LoginScreen {
    fn default() -> Self {
        LoginScreen {
            status: Status::Idle,
            host: DEFAULT_HOST.to_string(),
            rx: None,
        }
    }
}

/// What the login screen wants the caller (the top-level `NopalApp`) to do
/// next — kept separate from `LoginScreen`'s own state so the transition
/// into the logged-in Vault view happens in one obvious place.
pub enum LoginOutcome {
    None,
    LoggedIn(Credentials),
}

impl LoginScreen {
    /// Polls for a completed background login attempt, if one is running.
    /// Called once per frame before drawing.
    pub fn poll(&mut self) -> LoginOutcome {
        let Some(rx) = &self.rx else {
            return LoginOutcome::None;
        };
        match rx.try_recv() {
            Ok(Ok(creds)) => {
                self.rx = None;
                self.status = Status::Idle;
                LoginOutcome::LoggedIn(creds)
            }
            Ok(Err(e)) => {
                self.rx = None;
                self.status = Status::Error(e);
                LoginOutcome::None
            }
            Err(_) => LoginOutcome::None,
        }
    }

    pub fn ui(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.vertical_centered(|ui| {
            ui.add_space(80.0);
            ui.heading("Nopal");
            ui.add_space(8.0);
            ui.label("Sign in to browse and sync your Vault.");
            ui.add_space(24.0);

            ui.horizontal(|ui| {
                ui.label("Host:");
                let waiting = self.rx.is_some();
                ui.add_enabled(
                    !waiting,
                    egui::TextEdit::singleline(&mut self.host).desired_width(280.0),
                );
            });
            ui.add_space(12.0);

            match &self.status {
                Status::Idle => {
                    if ui.button("Sign in to Nopal").clicked() {
                        self.start_login(ctx.clone());
                    }
                }
                Status::WaitingForBrowser { url } => {
                    ui.spinner();
                    ui.add_space(8.0);
                    ui.label("Waiting for approval in your browser...");
                    ui.add_space(8.0);
                    if ui.link(url).clicked() {
                        let _ = open::that(url);
                    }
                    ui.add_space(8.0);
                    if ui.button("Cancel").clicked() {
                        self.rx = None;
                        self.status = Status::Idle;
                    }
                }
                Status::Error(e) => {
                    ui.colored_label(egui::Color32::from_rgb(200, 60, 60), e);
                    ui.add_space(8.0);
                    if ui.button("Try again").clicked() {
                        self.status = Status::Idle;
                    }
                }
            }
        });
    }

    fn start_login(&mut self, ctx: egui::Context) {
        let host = self.host.trim().to_string();
        let flow = match LoginFlow::start(&host) {
            Ok(f) => f,
            Err(e) => {
                self.status = Status::Error(format!("Couldn't start login: {e}"));
                return;
            }
        };
        let url = flow.login_url();
        if open::that(&url).is_err() {
            // Non-fatal — the clickable link in the UI still works.
        }

        let (tx, rx) = channel();
        self.rx = Some(rx);
        self.status = Status::WaitingForBrowser { url };

        std::thread::spawn(move || {
            let result = flow.wait(LOGIN_TIMEOUT).map_err(|e| e.to_string());
            let _ = tx.send(result);
            ctx.request_repaint();
        });
    }
}
