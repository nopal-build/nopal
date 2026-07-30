use eframe::egui;
use nopal_core::auth;
use nopal_core::vault::Client;

use crate::login::{LoginOutcome, LoginScreen};
use crate::vault_view::{VaultOutcome, VaultScreen};

enum Screen {
    LoggedOut(LoginScreen),
    Vault(VaultScreen),
}

pub struct NopalApp {
    screen: Screen,
}

impl NopalApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        // A stored login (same Keychain/credentials file the CLI uses) —
        // if present, skip straight to the Vault view.
        let screen = match auth::load_credentials() {
            Some(creds) => {
                let client = Client::from_credentials(creds.host.clone(), creds.token.clone());
                Screen::Vault(VaultScreen::new(
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
                    self.screen = Screen::Vault(VaultScreen::new(
                        client,
                        creds.email,
                        creds.host,
                        ctx.clone(),
                    ));
                }
            }
            Screen::Vault(vault) => vault.poll(),
        }

        egui::CentralPanel::default().show(ctx, |ui| match &mut self.screen {
            Screen::LoggedOut(login) => login.ui(ui, ctx),
            Screen::Vault(vault) => {
                if let VaultOutcome::LoggedOut = vault.ui(ui, ctx) {
                    let _ = auth::logout();
                    self.screen = Screen::LoggedOut(LoginScreen::default());
                }
            }
        });
    }
}
