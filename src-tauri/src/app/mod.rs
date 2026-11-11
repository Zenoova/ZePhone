//! Glue between the telephony core and the desktop shell (Tauri): UI events, native
//! notifications, tray icon, window behaviour.

pub mod sink;
pub mod tray;

use std::sync::{Arc, atomic::AtomicBool};

use tauri::{AppHandle, Manager};

use crate::{database::Database, sip::manager::SipManager};

pub const MAIN_WINDOW: &str = "main";

/// Event names emitted to the webview.
pub mod events {
    pub const ENGINE_STATE: &str = "engine:state";
    pub const ACCOUNT_STATUS: &str = "account:status";
    pub const CALL_UPDATE: &str = "call:update";
    pub const HISTORY_CHANGED: &str = "history:changed";
    pub const AUDIO_ERROR: &str = "audio:error";
    pub const AUDIO_LEVEL: &str = "audio:level";
}

pub struct AppState {
    pub manager: Arc<SipManager>,
    pub db: Arc<Database>,
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
