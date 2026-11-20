//! Glue between the telephony core and the desktop shell (Tauri): UI events, native
//! notifications, tray icon, window behaviour.

pub mod call_audio;
#[cfg(desktop)]
pub mod call_window;
#[cfg(mobile)]
#[path = "call_window_mobile.rs"]
pub mod call_window;
pub mod control;
pub mod directory_events;
pub mod shell;
pub mod sink;
#[cfg(desktop)]
pub mod tray;
#[cfg(mobile)]
#[path = "tray_mobile.rs"]
pub mod tray;
pub mod native_tabbar;
#[cfg(target_os = "ios")]
pub mod native_tabbar_ios;
#[cfg(target_os = "ios")]
pub mod viewport_ios;
pub mod window;

use std::sync::{Arc, atomic::AtomicBool};

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;

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
    /// The audio devices, what each role uses, or a notice about them changed.
    pub const AUDIO_STATE: &str = "audio:state";
    /// The headsets detected, whether their buttons are being read, and what the last events became.
    pub const HEADSET_STATE: &str = "headset:state";
    /// One reading of the microphone level test, in dBFS.
    pub const AUDIO_TEST_LEVEL: &str = "audio:test-level";
}

pub struct AppState {
    pub manager: Arc<SipManager>,
    pub directory: Arc<DirectoryService>,
    pub db: Arc<Database>,
    /// Runs the requests of the shortcuts, the tray menu and the command line.
    pub controller: Arc<Controller>,
    pub shortcuts: Arc<ShortcutService>,
    /// Keeps the engine's audio devices in step with the system's.
    pub audio: Arc<crate::audio::router::AudioRouter>,
    /// The headset's buttons: read from the hardware, interpreted, handed to the controller.
    pub headset: Arc<crate::headset::runtime::HeadsetRuntime>,
    /// The microphone level test, while it runs.
    pub meter: std::sync::Mutex<Option<crate::audio::diagnostics::Meter>>,
    /// The local control socket (`zephone ctl`), when it could be opened.
    pub control_server: std::sync::Mutex<Option<socket::Server>>,
    pub shutting_down: AtomicBool,
}

/// Shows and focuses the main window (un-minimising / un-hiding it).
pub fn show_main_window(app: &AppHandle) {
    // A phone has one window, always in front when the user is looking at the application.
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    #[cfg(mobile)]
    let _ = app;
}
