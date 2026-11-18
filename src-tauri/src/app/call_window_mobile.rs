//! A phone has one window only: the call screen is drawn inside the main window (see `src/layouts/AppShell.tsx`),
//! so there is nothing to open, close or keep on top. The same functions as the desktop `call_window` module.

use tauri::AppHandle;

pub const CALL_WINDOW: &str = "call";

pub fn open(_app: &AppHandle) {}

pub fn close(_app: &AppHandle) {}

pub fn set_always_on_top(_app: &AppHandle, _on_top: bool) {}
