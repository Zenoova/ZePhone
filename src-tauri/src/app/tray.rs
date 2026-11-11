//! Menu-bar / system-tray icon: quick access to the window and a live
//! registration summary. The app (and its SIP registrations) keep running when the
//! window is closed to the tray.

use std::sync::OnceLock;

use tauri::{
    AppHandle, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use super::show_main_window;

const TRAY_ID: &str = "main";

static STATUS_ITEM: OnceLock<MenuItem<Wry>> = OnceLock::new();

pub fn setup(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ouvrir ZePhone", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", "Aucun compte", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter ZePhone", true, Some("CmdOrCtrl+Q"))?;
    let _ = STATUS_ITEM.set(status.clone());
    let menu = Menu::with_items(
        app,
        &[&status, &PredefinedMenuItem::separator(app)?, &open, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ZePhone")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // macOS opens the menu on click; elsewhere a left click raises the window.
            if cfg!(not(target_os = "macos"))
                && let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    tray.set_visible(visible)?;
    Ok(())
}

pub fn set_visible(app: &AppHandle, visible: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(visible);
    }
}

pub fn set_status_text(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(format!("ZePhone — {text}")));
    }
    if let Some(item) = STATUS_ITEM.get() {
        let _ = item.set_text(text);
    }
}
