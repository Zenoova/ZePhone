pub mod app;
pub mod audio;
pub mod commands;
pub mod control;
pub mod database;
pub mod directory;
pub mod error;
pub mod recording;
pub mod security;
pub mod shortcuts;
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
    app::{
        AppState, MAIN_WINDOW, directory_events::TauriDirectoryEvents, shell::TauriShell,
        show_main_window, sink::TauriSink, tray,
    },
    control::{controller::Controller, socket},
    database::Database,
    directory::{connectors::RealConnectorFactory, service::DirectoryService},
    error::{AppError, AppResult},
    security::secrets::KeyringStore,
    shortcuts::{ShortcutService, tauri_backend::TauriHotkeys},
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
    manager.set_recordings_dir(data_dir.join("recordings"));
    // The audio devices: what each role (microphone, conversation, ringer) resolves to is decided before the
    // engine starts (it is told through its options), and followed afterwards.
    let audio_router = audio::router::AudioRouter::new(
        Arc::new(audio::devices::SystemAudio),
        manager.clone(),
        settings.audio.routing.clone(),
    );
    {
        let router = Arc::downgrade(&audio_router);
        manager.set_audio_names(Arc::new(move || {
            router
                .upgrade()
                .map(|r| r.engine_names())
                .unwrap_or_default()
        }));
    }
    audio_router.prime();
    let directory = DirectoryService::new(
        db.clone(),
        Arc::new(KeyringStore),
        Arc::new(TauriDirectoryEvents::new(handle.clone())),
        Arc::new(RealConnectorFactory::new(db.clone())),
    );
    directory.start();
    // A call from somebody the address book does not know is named by the company directory, when it is sure.
    manager.set_caller_lookup(directory.clone());
    // One executor for everything that drives calls from outside the window: shortcuts, tray menu, command line.
    let controller = Controller::new(manager.clone(), Arc::new(TauriShell::new(handle.clone())));
    let shortcuts = ShortcutService::new(db.clone(), Arc::new(TauriHotkeys::new(handle.clone())));
    shortcuts.start();
    app.manage(AppState {
        manager: manager.clone(),
        directory,
        db,
        controller: controller.clone(),
        shortcuts,
        audio: audio_router.clone(),
        control_server: std::sync::Mutex::new(None),
        shutting_down: AtomicBool::new(false),
    });
    start_control_socket(handle.clone(), controller);
    audio_router.start();

    tray::setup(&handle, settings.general.show_tray_icon)?;
    app::window::apply_appearance(&handle, &settings.general);

    if settings.general.start_minimized
        && let Some(w) = app.get_webview_window(MAIN_WINDOW)
    {
        if settings.general.show_tray_icon {
            let _ = w.hide();
        } else {
            let _ = w.minimize();
        }
    }

    watch_termination_signals(handle.clone());

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

/// Opens the private socket `zephone ctl` talks to. Without it the application works the same: only the command
/// line is unavailable.
fn start_control_socket(app: AppHandle, controller: Arc<Controller>) {
    tauri::async_runtime::spawn(async move {
        let path = match socket::socket_path() {
            Ok(p) => p,
            Err(e) => return log::warn!("control socket not started: {e}"),
        };
        match socket::Server::start(path, controller).await {
            Ok(server) => {
                if let Some(state) = app.try_state::<AppState>() {
                    *state.control_server.lock().unwrap() = Some(server);
                }
            }
            Err(e) => log::warn!("control socket not started: {e}"),
        }
    });
}

/// Frees what other programs must be able to use again: the keyboard combinations and the control socket.
fn release_system_resources(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.shortcuts.stop();
        if let Some(server) = state.control_server.lock().unwrap().take() {
            server.stop();
        }
    }
}

/// SIGTERM / SIGINT / SIGHUP (kill, Ctrl-C in dev, terminal closed) go through the normal
/// quit path so the SIP engine is stopped and nothing is left behind.
fn watch_termination_signals(app: AppHandle) {
    #[cfg(unix)]
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{SignalKind, signal};
        let (Ok(mut term), Ok(mut int), Ok(mut hup)) = (
            signal(SignalKind::terminate()),
            signal(SignalKind::interrupt()),
            signal(SignalKind::hangup()),
        ) else {
            return;
        };
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
            _ = hup.recv() => {}
        }
        log::info!("termination signal received, shutting down");
        app.exit(0);
    });
    #[cfg(not(unix))]
    tauri::async_runtime::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            app.exit(0);
        }
    });
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
                release_system_resources(app);
                let manager = state.manager.clone();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    manager.shutdown().await;
                    handle.exit(0);
                });
            }
        }
        // ⌘Q / Dock "Quit" on macOS terminate the process without going through
        // `ExitRequested`: do the same cleanup synchronously here. `shutdown()` is idempotent.
        RunEvent::Exit => {
            release_system_resources(app);
            if let Some(state) = app.try_state::<AppState>() {
                let manager = state.manager.clone();
                // Never park the main thread on the async runtime without a hard bound: a task that
                // needs the main thread (menu/tray calls do) would deadlock it and the app could
                // never quit. Run the shutdown on the runtime and wait for it with a timeout.
                let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
                tauri::async_runtime::spawn(async move {
                    manager.shutdown().await;
                    let _ = done_tx.send(());
                });
                let _ = done_rx.recv_timeout(std::time::Duration::from_secs(4));
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
        .plugin(
            // Keyboard shortcuts that work in any application. What a press means is decided by the controller.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let Some(state) = app.try_state::<AppState>() else {
                        return;
                    };
                    let pressed =
                        event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed;
                    if let Some(action) =
                        state
                            .shortcuts
                            .on_event(shortcut.id(), pressed, std::time::Instant::now())
                    {
                        app::control::run_shortcut(app, action);
                    }
                })
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
            commands::open_call_window,
            commands::close_call_window,
            commands::set_call_window_on_top,
            commands::show_main,
            commands::list_recordings,
            commands::delete_recording,
            commands::set_audio_gains,
            commands::get_call_stats,
            commands::directory::directory_search,
            commands::directory::directory_departments,
            commands::directory::directory_sources,
            commands::directory::directory_dialable,
            commands::directory::directory_system_contacts_info,
            commands::directory::directory_connect_system_contacts,
            commands::directory::directory_open_contacts_privacy_settings,
            commands::directory::directory_test_ldap,
            commands::directory::directory_save_ldap,
            commands::directory::directory_connect_microsoft,
            commands::directory::directory_cancel_connect,
            commands::directory::directory_sync,
            commands::directory::directory_set_source,
            commands::directory::directory_disconnect,
            commands::directory::directory_remove_source,
            commands::directory::directory_clear_cache,
            commands::directory::directory_set_favorite,
            commands::directory::directory_groups,
            commands::directory::directory_create_group,
            commands::directory::directory_rename_group,
            commands::directory::directory_delete_group,
            commands::directory::directory_group_add,
            commands::directory::directory_group_remove,
            commands::audio_state,
            commands::audio_choose,
            commands::shortcuts_get,
            commands::shortcuts_set,
            commands::shortcuts_set_enabled,
            commands::shortcuts_reset,
            commands::shortcuts_capture,
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
