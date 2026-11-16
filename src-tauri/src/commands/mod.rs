//! Tauri commands: the only API the webview can call. They are thin: validation and
//! business rules live in the SIP manager, the database and the `sip::uri` module.

pub mod directory;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    app::{AppState, events, tray},
    audio::{self, AudioDevices, permissions::MicPermission},
    database::HistoryFilter,
    error::{AppError, AppResult},
    recording::Recording,
    shortcuts::{ShortcutAction, ShortcutsView},
    sip::{
        manager::{EngineInfo, SettingsApplied, Snapshot},
        stats::CallStatsSample,
        types::{
            AccountInput, AccountView, Call, Contact, ContactInput, HistoryEntry, MAX_GAIN_PERCENT,
            Settings,
        },
    },
};

type S<'a> = State<'a, AppState>;

// -------------------------------------------------------------------- state

/// Reading the accounts asks the system keychain whether a password exists, which can wait for the user to answer
/// a system prompt. Neither this nor `list_accounts` may run on the main thread: it also serves the keyboard
/// shortcuts and the window, which would freeze with it.
#[tauri::command]
pub async fn get_snapshot(state: S<'_>) -> AppResult<Snapshot> {
    let manager = state.manager.clone();
    off_main(move || manager.snapshot()).await
}

#[tauri::command]
pub async fn restart_engine(state: S<'_>) -> AppResult<()> {
    state.manager.restart_engine().await
}

#[tauri::command]
pub fn get_engine_log(state: S, lines: Option<usize>) -> Vec<String> {
    state.manager.log_tail(lines.unwrap_or(200).min(400))
}

// ----------------------------------------------------------------- accounts

#[tauri::command]
pub async fn list_accounts(state: S<'_>) -> AppResult<Vec<AccountView>> {
    let manager = state.manager.clone();
    off_main(move || manager.list_accounts()).await
}

/// Runs something that may block (the keychain) on a worker thread.
async fn off_main<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
pub async fn save_account(state: S<'_>, input: AccountInput) -> AppResult<AccountView> {
    state.manager.save_account(input).await
}

#[tauri::command]
pub async fn delete_account(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.delete_account(&id).await
}

#[tauri::command]
pub fn set_default_account(state: S, id: String) -> AppResult<()> {
    state.manager.set_default_account(&id)
}

#[tauri::command]
pub async fn set_account_enabled(state: S<'_>, id: String, enabled: bool) -> AppResult<()> {
    state.manager.set_account_enabled(&id, enabled).await
}

#[tauri::command]
pub async fn connect_account(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.connect_account(&id).await
}

#[tauri::command]
pub async fn disconnect_account(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.disconnect_account(&id).await
}

// -------------------------------------------------------------------- calls

#[tauri::command]
pub async fn dial(state: S<'_>, target: String, account_id: Option<String>) -> AppResult<Call> {
    state.manager.dial(&target, account_id.as_deref()).await
}

#[tauri::command]
pub async fn answer_call(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.answer(&id).await
}

#[tauri::command]
pub async fn reject_call(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.reject(&id).await
}

#[tauri::command]
pub async fn hangup_call(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.hangup(&id).await
}

#[tauri::command]
pub async fn hold_call(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.hold(&id).await
}

#[tauri::command]
pub async fn resume_call(state: S<'_>, id: String) -> AppResult<()> {
    state.manager.resume(&id).await
}

#[tauri::command]
pub async fn set_call_mute(state: S<'_>, id: String, muted: bool) -> AppResult<()> {
    state.manager.set_mute(&id, muted).await
}

#[tauri::command]
pub async fn send_dtmf(state: S<'_>, id: String, digits: String) -> AppResult<()> {
    state.manager.send_dtmf(&id, &digits).await
}

#[tauri::command]
pub async fn transfer_call(state: S<'_>, id: String, target: String) -> AppResult<()> {
    state.manager.transfer(&id, &target).await
}

// ------------------------------------------------------------- call window

#[tauri::command]
pub fn open_call_window(app: AppHandle) {
    crate::app::call_window::open(&app);
}

#[tauri::command]
pub fn close_call_window(app: AppHandle) {
    crate::app::call_window::close(&app);
}

#[tauri::command]
pub fn set_call_window_on_top(app: AppHandle, on_top: bool) {
    crate::app::call_window::set_always_on_top(&app, on_top);
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    crate::app::show_main_window(&app);
}

// --------------------------------------------------------------- recording

#[tauri::command]
pub fn list_recordings(state: S) -> AppResult<Vec<Recording>> {
    state.manager.list_recordings()
}

#[tauri::command]
pub fn delete_recording(state: S, id: String) -> AppResult<()> {
    state.manager.delete_recording(&id)
}

/// Live volume change (percent), applied at once and not saved: the sliders save on release.
#[tauri::command]
pub async fn set_audio_gains(state: S<'_>, input: u16, output: u16) -> AppResult<()> {
    state.manager.set_audio_gains(input, output).await
}

/// The statistics gathered so far about a call in progress (one sample per second, oldest first).
#[tauri::command]
pub fn get_call_stats(state: S, call_id: String) -> Vec<CallStatsSample> {
    state.manager.call_stats_history(&call_id)
}

// ----------------------------------------------------------------- contacts

#[tauri::command]
pub fn list_contacts(state: S, query: Option<String>) -> AppResult<Vec<Contact>> {
    state.db.list_contacts(query.as_deref())
}

#[tauri::command]
pub fn save_contact(state: S, input: ContactInput) -> AppResult<Contact> {
    let saved = state.db.save_contact(&input)?;
    state.directory.contacts_changed(); // the directory lists the local address book too
    Ok(saved)
}

#[tauri::command]
pub fn delete_contact(state: S, id: String) -> AppResult<()> {
    state.db.delete_contact(&id)?;
    state.directory.contacts_changed();
    Ok(())
}

// ------------------------------------------------------------------ history

#[tauri::command]
pub fn list_history(state: S, filter: Option<HistoryFilter>) -> AppResult<Vec<HistoryEntry>> {
    state.db.list_history(&filter.unwrap_or_default())
}

#[tauri::command]
pub fn delete_history_entry(state: S, id: String) -> AppResult<()> {
    state.db.delete_history(&id)
}

#[tauri::command]
pub fn clear_history(state: S) -> AppResult<()> {
    state.db.clear_history()
}

// ----------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: S) -> AppResult<Settings> {
    state.manager.settings()
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: S<'_>,
    settings: Settings,
) -> AppResult<SettingsApplied> {
    validate_settings(&settings)?;
    let applied = state.manager.update_settings(settings.clone()).await?;
    let _ = app.emit(events::SETTINGS_CHANGED, &applied.settings);
    // New audio preferences are applied at once (to the engine, and to a call in progress when it makes sense).
    state
        .audio
        .set_routing(applied.settings.audio.routing.clone())
        .await;

    // Desktop-shell settings take effect immediately.
    tray::set_visible(&app, settings.general.show_tray_icon);
    tray::set_do_not_disturb(&app, settings.general.do_not_disturb);
    crate::app::window::apply_appearance(&app, &settings.general);
    let autostart = app.autolaunch();
    let enabled = autostart.is_enabled().unwrap_or(false);
    if settings.general.launch_at_login && !enabled {
        autostart
            .enable()
            .map_err(|e| AppError::Other(format!("Cannot enable automatic start: {e}")))?;
    } else if !settings.general.launch_at_login && enabled {
        autostart
            .disable()
            .map_err(|e| AppError::Other(format!("Cannot disable automatic start: {e}")))?;
    }
    Ok(applied)
}

fn validate_settings(s: &Settings) -> AppResult<()> {
    if s.audio.input_gain > MAX_GAIN_PERCENT || s.audio.output_gain > MAX_GAIN_PERCENT {
        return Err(AppError::validation("Volume out of range (0 to 200 %)"));
    }
    let orb = &s.general.voice_orb;
    if orb.is_empty()
        || orb.len() > 32
        || !orb
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(AppError::validation("Invalid voice orb"));
    }
    if let Some(p) = s.network.local_sip_port
        && p < 1024
    {
        return Err(AppError::validation(
            "The local SIP port must be between 1024 and 65535",
        ));
    }
    if let Some(i) = &s.network.net_interface
        && !i.trim().is_empty()
        && crate::sip::engine::baresip::config::sanitize_interface(i).is_none()
    {
        return Err(AppError::validation("Invalid network interface"));
    }
    if let Some(ca) = s
        .network
        .custom_ca_file
        .as_deref()
        .filter(|c| !c.trim().is_empty())
        && !std::path::Path::new(ca).is_file()
    {
        return Err(AppError::validation(
            "The certificate file (CA) was not found",
        ));
    }
    for dev in [&s.audio.input_device, &s.audio.output_device]
        .into_iter()
        .flatten()
    {
        if !audio::is_selectable(dev) {
            return Err(AppError::validation(format!(
                "This audio device cannot be used: {dev}"
            )));
        }
    }
    Ok(())
}

// -------------------------------------------------------------------- audio

#[tauri::command]
pub async fn list_audio_devices() -> AppResult<AudioDevices> {
    tauri::async_runtime::spawn_blocking(audio::list_devices)
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

// -------------------------------------------------------------------- audio

/// The devices, what each role uses (as the engine confirmed it), and what stands in the way.
#[tauri::command]
pub fn audio_state(state: S) -> crate::audio::router::AudioState {
    state.audio.state()
}

/// Picks a device for a role: for the call in progress only, or (`remember`) for good, as an explicit choice.
#[tauri::command]
pub async fn audio_choose(
    app: AppHandle,
    state: S<'_>,
    role: crate::audio::routing::Role,
    uid: String,
    remember: bool,
) -> AppResult<()> {
    state
        .audio
        .choose(role, &uid)
        .await
        .map_err(AppError::Other)?;
    if remember && let Some(routing) = state.audio.remember(role, &uid).await {
        let mut settings = state.manager.settings()?;
        settings.audio.routing = routing;
        let applied = state.manager.update_settings(settings).await?;
        let _ = app.emit(events::SETTINGS_CHANGED, &applied.settings);
        state
            .audio
            .set_routing(applied.settings.audio.routing)
            .await;
    }
    Ok(())
}

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum AudioTest {
    /// A short tone on the device the conversation would use.
    Speaker,
    /// The incoming-call ringtone on the device the ringer would use.
    Ringtone,
}

/// A call (or a ringing call) would compete with a test for the device, and a test must never disturb it.
fn refuse_during_call(state: &AppState) -> AppResult<()> {
    if crate::audio::router::Target::call_active(state.manager.as_ref()) {
        return Err(AppError::validation(
            "A call is in progress: the test could disturb it. Run it again after the call.",
        ));
    }
    Ok(())
}

/// Plays a test sound on the chosen output. The sound goes straight to the device, never into a call, and is
/// only ever started by this command (the user pressing a button).
#[tauri::command]
pub async fn audio_test(app: AppHandle, state: S<'_>, kind: AudioTest) -> AppResult<()> {
    use crate::audio::{diagnostics, routing::Role};
    refuse_during_call(&state)?;
    let role = if matches!(kind, AudioTest::Speaker) {
        Role::Speaker
    } else {
        Role::Ringer
    };
    let device = state
        .audio
        .state()
        .roles
        .into_iter()
        .find(|r| r.role == role)
        .and_then(|r| r.resolution.used)
        .ok_or_else(|| AppError::validation("No output device is available"))?;
    let samples = match kind {
        AudioTest::Speaker => diagnostics::tone(48_000, 0.8),
        AudioTest::Ringtone => {
            let path = app
                .path()
                .resource_dir()
                .map_err(|e| AppError::Other(e.to_string()))?
                .join("engine/sounds/ring.wav");
            let bytes = std::fs::read(&path)
                .map_err(|e| AppError::Other(format!("Ringtone not found: {e}")))?;
            diagnostics::decode_wav(&bytes).map_err(AppError::Other)?
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        diagnostics::play(
            &device.name,
            samples,
            1.0,
            std::time::Duration::from_secs(8),
        )
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
    .map_err(AppError::Other)
}

/// Starts or stops the live microphone level. Needs the microphone permission; refused during a call.
#[tauri::command]
pub async fn audio_meter(app: AppHandle, state: S<'_>, on: bool) -> AppResult<()> {
    use crate::audio::{diagnostics::Meter, routing::Role};
    if !on {
        *state.meter.lock().unwrap() = None;
        return Ok(());
    }
    refuse_during_call(&state)?;
    if audio::permissions::status() != MicPermission::Authorized {
        return Err(AppError::validation(
            "Microphone access is not allowed: allow ZePhone in System Settings › Privacy › Microphone.",
        ));
    }
    let device = state
        .audio
        .state()
        .roles
        .into_iter()
        .find(|r| r.role == Role::Microphone)
        .and_then(|r| r.resolution.used)
        .ok_or_else(|| AppError::validation("No microphone is available"))?;
    // Replace any running meter first (its thread ends when dropped).
    *state.meter.lock().unwrap() = None;
    let events = app.clone();
    let name = device.name.clone();
    let meter = tauri::async_runtime::spawn_blocking(move || {
        Meter::start(
            &name,
            std::sync::Arc::new(move |db| {
                let _ = events.emit(events::AUDIO_TEST_LEVEL, db);
            }),
        )
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
    .map_err(AppError::Other)?;
    *state.meter.lock().unwrap() = Some(meter);
    Ok(())
}

/// The headsets detected, whether their buttons are read, and the last events with what became of them.
#[tauri::command]
pub fn headset_state(state: S) -> crate::headset::service::HeadsetState {
    state.headset.service.state()
}

// -------------------------------------------------------------- shortcuts

#[tauri::command]
pub fn shortcuts_get(state: S) -> ShortcutsView {
    state.shortcuts.view()
}

/// Sets the combination of one action (`None`: remove it) and whether it is on.
#[tauri::command]
pub fn shortcuts_set(
    state: S,
    action: ShortcutAction,
    accelerator: Option<String>,
    enabled: bool,
) -> AppResult<ShortcutsView> {
    state.shortcuts.set(action, accelerator.as_deref(), enabled)
}

/// The master switch: every shortcut at once.
#[tauri::command]
pub fn shortcuts_set_enabled(state: S, enabled: bool) -> AppResult<ShortcutsView> {
    state.shortcuts.set_master(enabled)
}

/// Back to the defaults: one action, or all of them.
#[tauri::command]
pub fn shortcuts_reset(state: S, action: Option<ShortcutAction>) -> AppResult<ShortcutsView> {
    state.shortcuts.reset(action)
}

/// While the settings record a combination, the shortcuts are paused so that pressing one cannot run its action.
#[tauri::command]
pub fn shortcuts_capture(state: S, active: bool) -> ShortcutsView {
    state.shortcuts.set_capture(active)
}

#[tauri::command]
pub fn get_microphone_permission() -> MicPermission {
    audio::permissions::status()
}

#[tauri::command]
pub async fn request_microphone_permission() -> MicPermission {
    audio::permissions::request().await
}

#[tauri::command]
pub fn open_microphone_settings() -> AppResult<()> {
    audio::permissions::open_settings().map_err(|e| AppError::Other(e.to_string()))
}

// ------------------------------------------------------------------- system

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub engine: EngineInfo,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, state: S) -> AppResult<AppInfo> {
    use tauri::Manager;
    let data_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.to_owned(),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        data_dir,
        engine: state.manager.engine_info(),
    })
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_validation() {
        let mut s = Settings::default();
        assert!(validate_settings(&s).is_ok());
        s.network.local_sip_port = Some(80);
        assert!(validate_settings(&s).is_err());
        s.network.local_sip_port = Some(5070);
        assert!(validate_settings(&s).is_ok());
        s.network.net_interface = Some("en0\nmodule x".into());
        assert!(validate_settings(&s).is_err());
        s.network.net_interface = Some("en0".into());
        s.network.custom_ca_file = Some("/definitely/missing.pem".into());
        assert!(validate_settings(&s).is_err());
        s.network.custom_ca_file = None;
        s.audio.input_device = Some("bad, name".into());
        assert!(validate_settings(&s).is_err());
    }

    #[test]
    fn volumes_are_bounded() {
        let mut s = Settings::default();
        assert_eq!((s.audio.input_gain, s.audio.output_gain), (100, 100));
        s.audio.input_gain = 200;
        s.audio.output_gain = 0;
        assert!(validate_settings(&s).is_ok());
        s.audio.output_gain = 201;
        assert!(validate_settings(&s).is_err());
    }

    #[test]
    fn voice_orb_validation() {
        let mut s = Settings::default();
        assert_eq!(s.general.voice_orb, "shdr-32");
        for ok in ["classic", "shdr-11", "a1-b2"] {
            s.general.voice_orb = ok.into();
            assert!(validate_settings(&s).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "SHDR-11",
            "shdr_11",
            "../x",
            "a b",
            "<script>",
            &"a".repeat(33),
        ] {
            s.general.voice_orb = bad.into();
            assert!(validate_settings(&s).is_err(), "{bad}");
        }
    }
}
