//! Phones have no system tray: the same functions as the desktop `tray` module, doing nothing, so the rest of the
//! application does not have to know.

use tauri::AppHandle;

pub fn setup(_app: &AppHandle, _visible: bool) -> tauri::Result<()> {
    Ok(())
}

pub fn set_visible(_app: &AppHandle, _visible: bool) {}

pub fn set_status_text(_app: &AppHandle, _text: &str) {}

pub fn set_do_not_disturb(_app: &AppHandle, _on: bool) {}
