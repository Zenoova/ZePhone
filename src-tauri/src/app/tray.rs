//! Menu-bar / system-tray icon: quick access to the window and a live
//! registration summary. The app (and its SIP registrations) keep running when the
//! window is closed to the tray.

use std::sync::OnceLock;

use tauri::{
    AppHandle, Wry,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use super::show_main_window;
use crate::control::command::Command;

const TRAY_ID: &str = "main";

static STATUS_ITEM: OnceLock<MenuItem<Wry>> = OnceLock::new();
static DND_ITEM: OnceLock<CheckMenuItem<Wry>> = OnceLock::new();

pub fn setup(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open ZePhone", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", "No account", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit ZePhone", true, Some("CmdOrCtrl+Q"))?;
    let dnd = CheckMenuItem::with_id(app, "dnd", "Do not disturb", true, false, None::<&str>)?;
    let _ = STATUS_ITEM.set(status.clone());
    let _ = DND_ITEM.set(dnd.clone());
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &dnd,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ZePhone")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            // The same action as the shortcut and the command line.
            "dnd" => super::control::run(app, Command::Dnd { enabled: None }),
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

/// Updates the tooltip and the status line of the tray menu.
///
/// The menu/tray calls need the main thread and *wait* for it: from an async worker that can
/// deadlock the application while it is quitting. Dispatch to the main thread without waiting.
pub fn set_status_text(app: &AppHandle, text: &str) {
    let handle = app.clone();
    let text = text.to_owned();
    let _ = app.run_on_main_thread(move || {
        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(format!("ZePhone — {text}")));
        }
        if let Some(item) = STATUS_ITEM.get() {
            let _ = item.set_text(&text);
        }
    });
}

/// Shows whether "do not disturb" is on. Like the other menu calls, it is dispatched to the main thread
/// without waiting.
pub fn set_do_not_disturb(app: &AppHandle, on: bool) {
    let _ = app.run_on_main_thread(move || {
        if let Some(item) = DND_ITEM.get() {
            let _ = item.set_checked(on);
        }
    });
}
