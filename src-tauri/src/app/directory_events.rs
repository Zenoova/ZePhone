use tauri::{AppHandle, Emitter};

use super::events;
use crate::directory::service::DirectoryEvents;

/// Tells the webviews that the directory changed, so that they re-read what they show.
pub struct TauriDirectoryEvents {
    app: AppHandle,
}

impl TauriDirectoryEvents {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl DirectoryEvents for TauriDirectoryEvents {
    fn changed(&self) {
        if let Err(e) = self.app.emit(events::DIRECTORY_CHANGED, ()) {
            log::warn!("cannot emit {}: {e}", events::DIRECTORY_CHANGED);
        }
    }
}
