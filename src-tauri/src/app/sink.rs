use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use super::{call_audio, call_window, events, tray};
use crate::sip::{
    manager::{EngineInfo, UiSink},
    stats::CallStatsSample,
    types::{AccountStatus, Call, CallState, RegistrationState, Settings},
};

/// Forwards manager notifications to the webview and to the OS.
pub struct TauriSink {
    app: AppHandle,
    states: Mutex<HashMap<String, RegistrationState>>,
    /// Calls whose window was already opened: a user who closes the call window during a call is not
    /// pulled back into it by every later update of that call.
    opened: Mutex<HashSet<String>>,
    /// Calls in progress: a phone is put in "communication" mode while there is at least one.
    live: Mutex<HashSet<String>>,
}

impl TauriSink {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            states: Mutex::default(),
            opened: Mutex::default(),
            live: Mutex::default(),
        }
    }

    fn emit<S: serde::Serialize + Clone>(&self, name: &str, payload: S) {
        if let Err(e) = self.app.emit(name, payload) {
            log::warn!("cannot emit {name}: {e}");
        }
    }

    fn notify(&self, title: &str, body: &str) {
        if let Err(e) = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
        {
            log::warn!("cannot show notification: {e}");
        }
    }
}

fn caller_label(call: &Call) -> String {
    match call.remote_name.as_deref().filter(|n| !n.is_empty()) {
        Some(name) if name != call.remote_number => format!("{name} ({})", call.remote_number),
        _ => call.remote_number.clone(),
    }
}

impl UiSink for TauriSink {
    fn engine_state(&self, info: &EngineInfo) {
        self.emit(events::ENGINE_STATE, info.clone());
    }

    fn account_status(&self, status: &AccountStatus) {
        self.emit(events::ACCOUNT_STATUS, status.clone());
        let summary = {
            let mut states = self.states.lock().unwrap();
            states.insert(status.account_id.clone(), status.state);
            let registered = states
                .values()
                .filter(|s| **s == RegistrationState::Registered)
                .count();
            let connecting = states
                .values()
                .filter(|s| **s == RegistrationState::Connecting)
                .count();
            let total = states.len();
            if total == 0 {
                "No account".to_owned()
            } else if registered > 0 {
                format!("Registered ({registered}/{total})")
            } else if connecting > 0 {
                "Connecting…".to_owned()
            } else {
                "Not registered".to_owned()
            }
        };
        tray::set_status_text(&self.app, &summary);
    }

    fn call_update(&self, call: &Call) {
        self.emit(events::CALL_UPDATE, call.clone());
        let live = !matches!(call.state, CallState::Ended | CallState::Failed);
        if live && self.opened.lock().unwrap().insert(call.id.clone()) {
            call_window::open(&self.app);
        }
        let (was_idle, is_idle) = {
            let mut calls = self.live.lock().unwrap();
            let was_idle = calls.is_empty();
            if live {
                calls.insert(call.id.clone());
            } else {
                calls.remove(&call.id);
            }
            (was_idle, calls.is_empty())
        };
        if was_idle != is_idle {
            call_audio::set_in_call(!is_idle);
        }
    }

    fn history_changed(&self) {
        self.emit(events::HISTORY_CHANGED, ());
    }

    fn recordings_changed(&self) {
        self.emit(events::RECORDINGS_CHANGED, ());
    }

    fn incoming_call(&self, call: &Call, notify: bool) {
        // Whatever the section the user is on (or even if the windows were hidden or
        // minimised), the incoming-call UI must be visible.
        call_window::open(&self.app);
        if notify {
            self.notify("Incoming call", &caller_label(call));
        }
    }

    fn missed_call(&self, call: &Call, notify: bool) {
        if notify {
            self.notify("Missed call", &caller_label(call));
        }
    }

    fn audio_level(&self, call_id: &str, tx: bool, db: f32) {
        #[derive(Clone, serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Level<'a> {
            call_id: &'a str,
            tx: bool,
            db: f32,
        }
        self.emit(events::AUDIO_LEVEL, Level { call_id, tx, db });
    }

    fn call_stats(&self, sample: &CallStatsSample) {
        self.emit(events::CALL_STATS, sample.clone());
    }

    fn audio_error(&self, message: &str) {
        self.emit(events::AUDIO_ERROR, message.to_owned());
    }

    fn audio_state(&self, state: &crate::audio::router::AudioState) {
        self.emit(events::AUDIO_STATE, state.clone());
    }

    fn settings_changed(&self, settings: &Settings) {
        self.emit(events::SETTINGS_CHANGED, settings.clone());
        tray::set_do_not_disturb(&self.app, settings.general.do_not_disturb);
    }
}
