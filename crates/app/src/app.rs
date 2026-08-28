use std::sync::Arc;

use eframe::egui;
use nopal_core::auth;
use nopal_core::vault::Client;

use crate::login::{LoginOutcome, LoginScreen};
use crate::record_view::RecordScreen;
use crate::sync_view::SyncScreen;
use crate::vault_view::VaultScreen;

enum Screen {
    LoggedOut(LoginScreen),
    Workspace(Workspace),
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum Tab {
    Vault,
    Record,
    Sync,
}

/// The signed-in shell: a shared top bar (identity + log out) and tab
/// switcher over the Vault and Sync screens, which share the same
/// underlying `Client`.
struct Workspace {
    email: String,
    host: String,
    tab: Tab,
    vault: VaultScreen,
    record: RecordScreen,
    sync: SyncScreen,
}

impl Workspace {
    fn new(client: Client, email: String, host: String, ctx: egui::Context) -> Self {
        let client = Arc::new(client);
        Workspace {
            email,
            host,
            tab: Tab::Vault,
            vault: VaultScreen::new(client.clone(), ctx.clone()),
            record: RecordScreen::new(client.clone(), ctx.clone()),
            sync: SyncScreen::new(client, ctx),
        }
    }

    fn poll(&mut self) {
        self.vault.poll();
        self.record.poll();
        self.sync.poll();
    }

    /// Returns `true` if the user asked to log out.
    fn ui(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) -> bool {
        let mut logged_out = false;

        ui.horizontal(|ui| {
            ui.label(format!("{} ({})", self.email, self.host));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Log out").clicked() {
                    logged_out = true;
                }
            });
        });
        ui.separator();

        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.tab, Tab::Vault, "Vault");
            ui.selectable_value(&mut self.tab, Tab::Record, "Record");
            ui.selectable_value(&mut self.tab, Tab::Sync, "Sync");
        });
        ui.separator();

        match self.tab {
            Tab::Vault => self.vault.ui(ui, ctx),
            Tab::Record => self.record.ui(ui, ctx),
            Tab::Sync => self.sync.ui(ui, ctx),
        }

        logged_out
    }
}

pub struct NopalApp {
    screen: Screen,
}

impl NopalApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        // A stored login (same Keychain/credentials file the CLI uses) —
        // if present, skip straight to the workspace.
        let screen = match auth::load_credentials() {
            Some(creds) => {
                let client = Client::from_credentials(creds.host.clone(), creds.token.clone());
                Screen::Workspace(Workspace::new(
                    client,
                    creds.email,
                    creds.host,
                    cc.egui_ctx.clone(),
                ))
            }
            None => Screen::LoggedOut(LoginScreen::default()),
        };
        NopalApp { screen }
    }
}

impl eframe::App for NopalApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        match &mut self.screen {
            Screen::LoggedOut(login) => {
                if let LoginOutcome::LoggedIn(creds) = login.poll() {
                    let client = Client::from_credentials(creds.host.clone(), creds.token.clone());
                    self.screen = Screen::Workspace(Workspace::new(
                        client,
                        creds.email,
                        creds.host,
                        ctx.clone(),
                    ));
                }
            }
            Screen::Workspace(workspace) => workspace.poll(),
        }

        egui::CentralPanel::default().show(ctx, |ui| match &mut self.screen {
            Screen::LoggedOut(login) => login.ui(ui, ctx),
            Screen::Workspace(workspace) => {
                if workspace.ui(ui, ctx) {
                    let _ = auth::logout();
                    self.screen = Screen::LoggedOut(LoginScreen::default());
                }
            }
        });
    }
}
