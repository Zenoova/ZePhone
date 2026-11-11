pub mod app;
pub mod audio;
pub mod commands;
pub mod database;
pub mod error;
pub mod security;
pub mod sip;

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};

use crate::{
    app::{AppState, MAIN_WINDOW, show_main_window, sink::TauriSink, tray},
    database::Database,
    error::{AppError, AppResult},
    security::secrets::KeyringStore,
    sip::{
        engine::{
            SipEngine,
            baresip::{BaresipEngine, BaresipPaths},
        },
        manager::SipManager,
    },
};

/// Resolves the Baresip sidecar and its resources.
///
/// * Production bundle: `ZePhone.app/Contents/MacOS/baresip` (Tauri `externalBin`),
///   modules and sounds in `Contents/Resources/engine/`.
/// * `tauri dev`: Tauri copies the same files next to the debug executable.
///
/// Nothing here depends on Homebrew or on `$PATH`.
fn engine_paths(app: &AppHandle, work_dir: PathBuf) -> AppResult<BaresipPaths> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| AppError::Engine(e.to_string()))?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::Engine("dossier de l'exécutable introuvable".into()))?;
    let exe = exe_dir.join(if cfg!(windows) {
        "baresip.exe"
    } else {
        "baresip"
    });
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::Engine(e.to_string()))?
        .join("engine");
    Ok(BaresipPaths {
        exe,
        modules_dir: resources.join("modules"),
        sounds_dir: resources.join("sounds"),
        work_dir,
    })
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;

    let db = Arc::new(Database::open(&data_dir.join("zephone.db"))?);
    let settings = db.get_settings().unwrap_or_default();

    let paths = engine_paths(&handle, app.path().app_local_data_dir()?.join("engine"))?;
    log::info!("SIP engine executable: {}", paths.exe.display());
    let engine: Arc<dyn SipEngine> = Arc::new(BaresipEngine::new(paths));
    let manager = SipManager::new(
        engine,
        db.clone(),
        Arc::new(KeyringStore),
        Arc::new(TauriSink::new(handle.clone())),
    );
    app.manage(AppState {
        manager: manager.clone(),
        db,
        shutting_down: AtomicBool::new(false),
    });

    tray::setup(&handle, settings.general.show_tray_icon)?;

    if settings.general.start_minimized
        && let Some(w) = app.get_webview_window(MAIN_WINDOW)
    {
        if settings.general.show_tray_icon {
            let _ = w.hide();
        } else {
            let _ = w.minimize();
        }
    }

    // Start the engine in the background. A failure is reported through engine/account
    // state in the UI; the app itself keeps running.
    tauri::async_runtime::spawn(async move {
        if let Err(e) = manager.start().await {
            log::error!("SIP engine failed to start: {e}");
        }
        // Ask for the microphone now (while the user is at the keyboard) rather than
        // in the middle of the first call.
        if audio::permissions::status() == audio::permissions::MicPermission::NotDetermined {
            let status = audio::permissions::request().await;
            log::info!("microphone permission: {status:?}");
        }
    });
    Ok(())
}

fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        let keep_running = window
            .app_handle()
            .try_state::<AppState>()
            .and_then(|s| s.db.get_settings().ok())
            .map(|s| s.general.close_to_tray && s.general.show_tray_icon)
            .unwrap_or(false);
        if keep_running {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        // Quit (⌘Q, tray, last window closed): hang up, unregister, stop the engine
        // process, *then* exit — so no orphaned Baresip is left behind.
        RunEvent::ExitRequested { api, .. } => {
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            if !state.shutting_down.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let manager = state.manager.clone();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    manager.shutdown().await;
                    handle.exit(0);
                });
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows,
            ..
        } if !has_visible_windows => show_main_window(app),
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app)
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("zephone".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::restart_engine,
            commands::get_engine_log,
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::set_default_account,
            commands::set_account_enabled,
            commands::connect_account,
            commands::disconnect_account,
            commands::dial,
            commands::answer_call,
            commands::reject_call,
            commands::hangup_call,
            commands::hold_call,
            commands::resume_call,
            commands::set_call_mute,
            commands::send_dtmf,
            commands::transfer_call,
            commands::list_contacts,
            commands::save_contact,
            commands::delete_contact,
            commands::list_history,
            commands::delete_history_entry,
            commands::clear_history,
            commands::get_settings,
            commands::update_settings,
            commands::list_audio_devices,
            commands::get_microphone_permission,
            commands::request_microphone_permission,
            commands::open_microphone_settings,
            commands::get_app_info,
            commands::quit_app,
        ])
        .setup(setup)
        .on_window_event(on_window_event)
        .build(tauri::generate_context!())
        .expect("error while building the ZePhone application");

    app.run(on_run_event);
}
