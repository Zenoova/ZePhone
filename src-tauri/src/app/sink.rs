use std::{collections::HashMap, sync::Mutex};

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use super::{events, show_main_window, tray};
use crate::sip::{
    manager::{EngineInfo, UiSink},
    types::{AccountStatus, Call, RegistrationState},
};

/// Forwards manager notifications to the webview and to the OS.
pub struct TauriSink {
    app: AppHandle,
    states: Mutex<HashMap<String, RegistrationState>>,
}

impl TauriSink {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            states: Mutex::default(),
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
                "Aucun compte".to_owned()
            } else if registered > 0 {
                format!("Enregistré ({registered}/{total})")
            } else if connecting > 0 {
                "Connexion en cours…".to_owned()
            } else {
                "Non enregistré".to_owned()
            }
        };
        tray::set_status_text(&self.app, &summary);
    }

    fn call_update(&self, call: &Call) {
        self.emit(events::CALL_UPDATE, call.clone());
    }

    fn history_changed(&self) {
        self.emit(events::HISTORY_CHANGED, ());
    }

    fn incoming_call(&self, call: &Call, notify: bool) {
        // Whatever the section the user is on (or even if the window was hidden or
        // minimised), the incoming-call UI must be visible.
        show_main_window(&self.app);
        if notify {
            self.notify("Appel entrant", &caller_label(call));
        }
    }

    fn missed_call(&self, call: &Call, notify: bool) {
        if notify {
            self.notify("Appel manqué", &caller_label(call));
        }
    }

    fn audio_error(&self, message: &str) {
        self.emit(events::AUDIO_ERROR, message.to_owned());
    }
}
