//! Tauri commands: the only API the webview can call. They are thin: validation and
//! business rules live in the SIP manager, the database and the `sip::uri` module.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    app::{AppState, events, tray},
    audio::{self, AudioDevices, permissions::MicPermission},
    database::HistoryFilter,
    error::{AppError, AppResult},
    recording::Recording,
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

#[tauri::command]
pub fn get_snapshot(state: S) -> AppResult<Snapshot> {
    state.manager.snapshot()
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
pub fn list_accounts(state: S) -> AppResult<Vec<AccountView>> {
    state.manager.list_accounts()
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
    state.db.save_contact(&input)
}

#[tauri::command]
pub fn delete_contact(state: S, id: String) -> AppResult<()> {
    state.db.delete_contact(&id)
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

    // Desktop-shell settings take effect immediately.
    tray::set_visible(&app, settings.general.show_tray_icon);
    crate::app::window::apply_appearance(&app, &settings.general);
    let autostart = app.autolaunch();
    let enabled = autostart.is_enabled().unwrap_or(false);
    if settings.general.launch_at_login && !enabled {
        autostart
            .enable()
            .map_err(|e| AppError::Other(format!("Démarrage automatique impossible : {e}")))?;
    } else if !settings.general.launch_at_login && enabled {
        autostart.disable().map_err(|e| {
            AppError::Other(format!(
                "Désactivation du démarrage automatique impossible : {e}"
            ))
        })?;
    }
    Ok(applied)
}

fn validate_settings(s: &Settings) -> AppResult<()> {
    if s.audio.input_gain > MAX_GAIN_PERCENT || s.audio.output_gain > MAX_GAIN_PERCENT {
        return Err(AppError::validation("Volume hors limites (0 à 200 %)"));
    }
    let orb = &s.general.voice_orb;
    if orb.is_empty()
        || orb.len() > 32
        || !orb
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err(AppError::validation("Orbe vocal invalide"));
    }
    if let Some(p) = s.network.local_sip_port
        && p < 1024
    {
        return Err(AppError::validation(
            "Le port SIP local doit être compris entre 1024 et 65535",
        ));
    }
    if let Some(i) = &s.network.net_interface
        && !i.trim().is_empty()
        && crate::sip::engine::baresip::config::sanitize_interface(i).is_none()
    {
        return Err(AppError::validation("Interface réseau invalide"));
    }
    if let Some(ca) = s
        .network
        .custom_ca_file
        .as_deref()
        .filter(|c| !c.trim().is_empty())
        && !std::path::Path::new(ca).is_file()
    {
        return Err(AppError::validation(
            "Le fichier de certificats (CA) est introuvable",
        ));
    }
    for dev in [&s.audio.input_device, &s.audio.output_device]
        .into_iter()
        .flatten()
    {
        if !audio::is_selectable(dev) {
            return Err(AppError::validation(format!(
                "Ce périphérique audio ne peut pas être utilisé : {dev}"
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
