//! Glue between the telephony core and the desktop shell (Tauri): UI events, native
//! notifications, tray icon, window behaviour.

pub mod call_window;
pub mod control;
pub mod directory_events;
pub mod shell;
pub mod sink;
pub mod tray;
pub mod window;

use std::sync::{Arc, atomic::AtomicBool};

use tauri::{AppHandle, Manager};

use crate::{
    control::{controller::Controller, socket},
    database::Database,
    directory::service::DirectoryService,
    shortcuts::ShortcutService,
    sip::manager::SipManager,
};

pub const MAIN_WINDOW: &str = "main";

/// Event names emitted to the webview.
pub mod events {
    pub const ENGINE_STATE: &str = "engine:state";
    pub const ACCOUNT_STATUS: &str = "account:status";
    pub const CALL_UPDATE: &str = "call:update";
    pub const HISTORY_CHANGED: &str = "history:changed";
    pub const AUDIO_ERROR: &str = "audio:error";
    pub const AUDIO_LEVEL: &str = "audio:level";
    /// One more second of statistics about a call in progress.
    pub const CALL_STATS: &str = "call:stats";
    pub const RECORDINGS_CHANGED: &str = "recordings:changed";
    /// The settings were saved: every window refreshes its copy.
    pub const SETTINGS_CHANGED: &str = "settings:changed";
    /// The company directory changed (a synchronisation, a favourite, a group, a source): re-read what is shown.
    pub const DIRECTORY_CHANGED: &str = "directory:changed";
    /// The window was brought forward on a page: `"dialer"` (number field) or `"search"` (contacts search).
    pub const SHELL_FOCUS: &str = "shell:focus";
}

pub struct AppState {
    pub manager: Arc<SipManager>,
    pub directory: Arc<DirectoryService>,
    pub db: Arc<Database>,
    /// Runs the requests of the shortcuts, the tray menu and the command line.
    pub controller: Arc<Controller>,
    pub shortcuts: Arc<ShortcutService>,
    /// The local control socket (`zephone ctl`), when it could be opened.
    pub control_server: std::sync::Mutex<Option<socket::Server>>,
    pub shutting_down: AtomicBool,
}

/// Shows and focuses the main window (un-minimising / un-hiding it).
pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
