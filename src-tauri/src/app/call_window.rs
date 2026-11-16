//! The call window: calls are shown in a window of their own, apart from the main window, so the keypad,
//! contacts and history stay reachable while talking. The backend opens it as soon as a call starts or rings.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{AppState, window};

pub const CALL_WINDOW: &str = "call";

/// Opens the call window, or brings it up when it exists. Safe to call from any thread.
pub fn open(app: &AppHandle) {
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        if let Some(w) = handle.get_webview_window(CALL_WINDOW) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        // Same page, other view: `main.tsx` picks the call screen from the window's label.
        let built =
            WebviewWindowBuilder::new(&handle, CALL_WINDOW, WebviewUrl::App("index.html".into()))
                .title("Call")
                .inner_size(440.0, 760.0)
                .min_inner_size(380.0, 600.0)
                .center()
                .transparent(true)
                .focused(true)
                .build();
        match built {
            Ok(_) => {
                if let Some(state) = handle.try_state::<AppState>()
                    && let Ok(settings) = state.db.get_settings()
                {
                    window::apply_appearance(&handle, &settings.general);
                }
            }
            Err(e) => log::error!("cannot open the call window: {e}"),
        }
    });
    if let Err(e) = queued {
        log::error!("cannot schedule the call window: {e}");
    }
}

/// Closes the call window (the call itself is not touched).
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(CALL_WINDOW) {
        let _ = w.close();
    }
}

/// Keeps the call window above the other windows (or not).
pub fn set_always_on_top(app: &AppHandle, on_top: bool) {
    if let Some(w) = app.get_webview_window(CALL_WINDOW)
        && let Err(e) = w.set_always_on_top(on_top)
    {
        log::warn!("cannot change the call window level: {e}");
    }
}
