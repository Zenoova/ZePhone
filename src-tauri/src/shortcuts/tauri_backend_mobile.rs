//! A phone has no global keyboard shortcuts: registering one is refused, with a reason the settings page can show.

use tauri::AppHandle;

use super::HotkeyBackend;

pub struct TauriHotkeys;

impl TauriHotkeys {
    pub fn new(_app: AppHandle) -> Self {
        Self
    }
}

impl HotkeyBackend for TauriHotkeys {
    fn register(&self, _canonical: &str) -> Result<u32, String> {
        Err("Keyboard shortcuts are not available on this device".into())
    }

    fn unregister(&self, _canonical: &str) {}
}
