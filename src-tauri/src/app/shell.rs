//! What the remote control asks of the desktop shell: bring the window forward, on a given page.

use tauri::{AppHandle, Emitter};

use super::{events, show_main_window};
use crate::control::controller::{Focus, Shell};

pub struct TauriShell {
    app: AppHandle,
}

impl TauriShell {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Shell for TauriShell {
    fn show(&self, focus: Option<Focus>) {
        show_main_window(&self.app);
        if let Some(focus) = focus {
            let target = match focus {
                Focus::Dialer => "dialer",
                Focus::Search => "search",
            };
            let _ = self.app.emit(events::SHELL_FOCUS, target);
        }
    }
}
