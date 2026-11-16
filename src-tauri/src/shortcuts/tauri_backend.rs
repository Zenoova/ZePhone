//! The real operating-system side of the shortcuts: the Tauri global-shortcut plugin.

use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use super::HotkeyBackend;

pub struct TauriHotkeys {
    app: AppHandle,
}

impl TauriHotkeys {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl HotkeyBackend for TauriHotkeys {
    fn register(&self, canonical: &str) -> Result<u32, String> {
        let shortcut = Shortcut::from_str(canonical).map_err(|e| e.to_string())?;
        let id = shortcut.id();
        self.app
            .global_shortcut()
            .register(shortcut)
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    fn unregister(&self, canonical: &str) {
        if let Ok(shortcut) = Shortcut::from_str(canonical)
            && let Err(e) = self.app.global_shortcut().unregister(shortcut)
        {
            log::warn!("cannot free the shortcut {canonical}: {e}");
        }
    }
}
