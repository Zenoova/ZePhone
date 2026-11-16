//! Tauri commands of the company directory. Thin, like the others: the rules live in `crate::directory`.
//!
//! Secrets (the LDAP password, the Microsoft tokens) enter the backend through these commands and go straight to
//! the system credential store; no command ever returns one.

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    app::AppState,
    directory::{
        ldap::{LdapConfig, LdapConnector, LdapTestReport},
        microsoft::{
            Authorization, Endpoints, MicrosoftConfig, SIGN_IN_TIMEOUT, http_client,
            open_in_browser,
        },
        model::{
            DepartmentCount, DirectoryPage, DirectoryQuery, GroupView, SourceKind, SourceView,
            SyncErrorKind,
        },
        normalize,
        sync::SyncError,
        system_contacts::{self, Access},
    },
    error::{AppError, AppResult},
};

type S<'a> = State<'a, AppState>;

/// Shortest automatic interval, in minutes (0 = manual only), and the longest (a week).
const MIN_INTERVAL: u32 = 5;
const MAX_INTERVAL: u32 = 7 * 24 * 60;

fn check_interval(n: u32) -> AppResult<()> {
    if n == 0 || (MIN_INTERVAL..=MAX_INTERVAL).contains(&n) {
        Ok(())
    } else {
        Err(AppError::validation(
            "The frequency must be “manual” or between 5 minutes and 7 days",
        ))
    }
}

fn default_interval() -> u32 {
    360
}

/// The company CA of the network settings, if one is configured.
fn ca_pem(state: &AppState) -> AppResult<Option<Vec<u8>>> {
    let Some(path) = state.db.get_settings()?.network.custom_ca_file else {
        return Ok(None);
    };
    std::fs::read(&path).map(Some).map_err(|_| {
        AppError::validation("The certificate authority file (Settings → Network) is unreadable")
    })
}

// ---------------------------------------------------------------- reading

#[tauri::command]
pub fn directory_search(state: S, query: DirectoryQuery) -> AppResult<DirectoryPage> {
    state.directory.search(&query)
}

#[tauri::command]
pub fn directory_departments(state: S) -> Vec<DepartmentCount> {
    state.directory.departments()
}

#[tauri::command]
pub fn directory_sources(state: S) -> AppResult<Vec<SourceView>> {
    state.directory.sources()
}

/// What to dial for a number as the directory shows it (`"+33 (0)1 23 45 67 89 poste 4567"` becomes
/// `"+33123456789"`; a SIP address or an internal extension is kept as it is). The call itself then goes through
/// the usual `dial` and `transfer_call`.
#[tauri::command]
pub fn directory_dialable(number: String) -> Option<String> {
    normalize::dialable(&number)
}

// ---------------------------------------------------------------- LDAP

/// An LDAP source as the settings form sends it. The password is only present when the user typed one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapSourceInput {
    pub id: Option<String>,
    pub name: String,
    pub config: LdapConfig,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default = "default_interval")]
    pub sync_interval_min: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub kind: SyncErrorKind,
    pub message: String,
}

impl From<SyncError> for Failure {
    fn from(e: SyncError) -> Self {
        Self {
            kind: e.kind,
            message: e.message,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapTestResult {
    pub ok: bool,
    pub report: Option<LdapTestReport>,
    pub error: Option<Failure>,
}

/// The password to use: the one just typed, else the one already in the credential store for this source.
fn ldap_password(state: &AppState, input: &LdapSourceInput) -> AppResult<Option<SecretString>> {
    if let Some(p) = input.password.as_deref().filter(|p| !p.is_empty()) {
        return Ok(Some(SecretString::from(p.to_owned())));
    }
    match input.id.as_deref() {
        Some(id) => state.directory.secret(id, "password"),
        None => Ok(None),
    }
}

/// "Test the connection": connects, signs in, and returns the first contacts the configuration would produce, so
/// that the source can be seen before it is turned on. Nothing is saved.
#[tauri::command]
pub async fn directory_test_ldap(
    state: S<'_>,
    input: LdapSourceInput,
) -> AppResult<LdapTestResult> {
    let password = ldap_password(&state, &input)?;
    let ca = ca_pem(&state)?;
    if let Err(message) = input.config.validate(password.is_some()) {
        return Ok(LdapTestResult {
            ok: false,
            report: None,
            error: Some(Failure {
                kind: SyncErrorKind::Config,
                message,
            }),
        });
    }
    Ok(
        match LdapConnector::new(input.config, password, ca).test().await {
            Ok(report) => LdapTestResult {
                ok: true,
                report: Some(report),
                error: None,
            },
            Err(e) => LdapTestResult {
                ok: false,
                report: None,
                error: Some(e.into()),
            },
        },
    )
}

/// Creates or changes an LDAP source and starts reading it.
#[tauri::command]
pub async fn directory_save_ldap(state: S<'_>, input: LdapSourceInput) -> AppResult<SourceView> {
    check_interval(input.sync_interval_min)?;
    let password = ldap_password(&state, &input)?;
    input
        .config
        .validate(password.is_some())
        .map_err(AppError::validation)?;
    let config = serde_json::to_value(&input.config).map_err(|e| AppError::Other(e.to_string()))?;

    let id = match input.id.as_deref() {
        None => state.directory.add_source(
            SourceKind::Ldap,
            &input.name,
            &config,
            input.sync_interval_min,
            password.as_ref().map(|p| ("password", p)),
        )?,
        Some(id) => {
            if let Some(p) = input.password.as_deref().filter(|p| !p.is_empty()) {
                state
                    .directory
                    .set_secret(id, "password", &SecretString::from(p.to_owned()))?;
            }
            state.directory.update_source(
                id,
                &input.name,
                true,
                input.sync_interval_min,
                Some(&config),
            )?;
            id.to_owned()
        }
    };
    state.directory.spawn_sync(id.clone(), true);
    state.directory.source(&id)
}

// ---------------------------------------------------------------- Microsoft 365

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftSourceInput {
    /// Set to sign an existing source in again.
    pub source_id: Option<String>,
    /// `microsoftOrg` (the organisation's directory) or `microsoftPersonal` (the user's own Outlook contacts).
    pub kind: SourceKind,
    pub name: String,
    pub config: MicrosoftConfig,
    #[serde(default = "default_interval")]
    pub sync_interval_min: u32,
}

/// Signs in with Microsoft in the user's browser, then creates (or reconnects) the source and starts reading it.
/// Returns when the sign-in is over: it waits for the user, for up to three minutes, unless it is cancelled.
#[tauri::command]
pub async fn directory_connect_microsoft(
    state: S<'_>,
    input: MicrosoftSourceInput,
) -> AppResult<SourceView> {
    check_interval(input.sync_interval_min)?;
    if !matches!(
        input.kind,
        SourceKind::MicrosoftOrg | SourceKind::MicrosoftPersonal
    ) {
        return Err(AppError::validation("Microsoft source expected"));
    }
    input
        .config
        .validate(input.kind)
        .map_err(AppError::validation)?;
    let ca = ca_pem(&state)?;
    let cancel = state.directory.begin_connect()?;

    let outcome = async {
        let auth =
            Authorization::begin(Endpoints::default(), input.kind, input.config.clone()).await?;
        open_in_browser(&auth.url).map_err(|_| {
            SyncError::new(
                SyncErrorKind::Config,
                "Cannot open your browser for the Microsoft sign-in.",
            )
        })?;
        let http = http_client(ca.as_deref())?;
        auth.finish(SIGN_IN_TIMEOUT, cancel, &http).await
    }
    .await;
    state.directory.end_connect();
    let token = outcome.map_err(|e| AppError::Other(e.message))?;

    let config = serde_json::to_value(&input.config).map_err(|e| AppError::Other(e.to_string()))?;
    let id = match input.source_id.as_deref() {
        Some(id) => {
            state.directory.set_secret(id, "refresh_token", &token)?;
            state.directory.update_source(
                id,
                &input.name,
                true,
                input.sync_interval_min,
                Some(&config),
            )?;
            state.directory.reconnected(id)?;
            id.to_owned()
        }
        None => state.directory.add_source(
            input.kind,
            &input.name,
            &config,
            input.sync_interval_min,
            Some(("refresh_token", &token)),
        )?,
    };
    state.directory.spawn_sync(id.clone(), true);
    state.directory.source(&id)
}

/// Gives up the browser sign-in that is waiting.
#[tauri::command]
pub fn directory_cancel_connect(state: S) {
    state.directory.cancel_connect();
}

// ---------------------------------------------------------------- the device's own address book

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemContactsInfo {
    /// This platform has an address book ZePhone can read.
    pub available: bool,
    /// What it is called here ("Mac contacts").
    pub name: &'static str,
    pub access: Access,
}

/// Whether the device's contacts can be connected here, and whether the user has already allowed it. Reading the
/// permission shows nothing and asks nothing.
#[tauri::command]
pub fn directory_system_contacts_info() -> SystemContactsInfo {
    SystemContactsInfo {
        available: system_contacts::AVAILABLE,
        name: system_contacts::SOURCE_NAME,
        access: system_contacts::platform_provider().access(),
    }
}

/// Connects the device's address book. The system asks the user for permission the first time; if it is refused,
/// nothing is created and the error says where to change it. Called again on a source that lost its permission, it
/// turns the source back on.
#[tauri::command]
pub async fn directory_connect_system_contacts(state: S<'_>) -> AppResult<SourceView> {
    if !system_contacts::AVAILABLE {
        return Err(AppError::validation(
            "This device has no contacts that ZePhone can read",
        ));
    }
    let provider = system_contacts::platform_provider();
    let id = state
        .directory
        .connect_system_contacts(provider.as_ref())
        .await?;
    state.directory.source(&id)
}

/// Opens the system's privacy settings on the Contacts page, where the user can allow or take back the access.
#[tauri::command]
pub fn directory_open_contacts_privacy_settings() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts")
            .spawn()
            .map(|_| ())
            .map_err(|e| AppError::Other(e.to_string()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::validation(
            "The privacy settings cannot be opened from ZePhone on this system",
        ))
    }
}

// ---------------------------------------------------------------- sources

/// Reads a source again now. Returns at once: the progress and the result come through `directory:changed`.
#[tauri::command]
pub fn directory_sync(state: S, id: String) -> AppResult<()> {
    state.directory.source(&id)?; // known, and not the local address book
    state.directory.spawn_sync(id, true);
    Ok(())
}

#[tauri::command]
pub fn directory_set_source(
    state: S,
    id: String,
    name: String,
    enabled: bool,
    sync_interval_min: u32,
) -> AppResult<SourceView> {
    check_interval(sync_interval_min)?;
    state
        .directory
        .update_source(&id, &name, enabled, sync_interval_min, None)?;
    if enabled {
        state.directory.spawn_sync(id.clone(), false);
    }
    state.directory.source(&id)
}

/// Signs a source out: its password or token and its cached contacts are erased, and it is switched off.
/// Favourites and groups stay.
#[tauri::command]
pub fn directory_disconnect(state: S, id: String) -> AppResult<()> {
    state.directory.disconnect(&id)
}

#[tauri::command]
pub fn directory_remove_source(state: S, id: String) -> AppResult<()> {
    state.directory.remove_source(&id)
}

/// Erases the contacts cached from a source; the next synchronisation reads everything again.
#[tauri::command]
pub fn directory_clear_cache(state: S, id: String) -> AppResult<()> {
    state.directory.clear_cache(&id)
}

// ---------------------------------------------------------------- favourites and groups

#[tauri::command]
pub fn directory_set_favorite(state: S, ids: Vec<String>, favorite: bool) -> AppResult<()> {
    state.directory.set_favorite(&ids, favorite)
}

#[tauri::command]
pub fn directory_groups(state: S) -> AppResult<Vec<GroupView>> {
    state.directory.groups()
}

#[tauri::command]
pub fn directory_create_group(state: S, name: String) -> AppResult<GroupView> {
    state.directory.create_group(&name)
}

#[tauri::command]
pub fn directory_rename_group(state: S, id: String, name: String) -> AppResult<()> {
    state.directory.rename_group(&id, &name)
}

#[tauri::command]
pub fn directory_delete_group(state: S, id: String) -> AppResult<()> {
    state.directory.delete_group(&id)
}

#[tauri::command]
pub fn directory_group_add(state: S, group_id: String, ids: Vec<String>) -> AppResult<()> {
    state.directory.add_to_group(&group_id, &ids)
}

#[tauri::command]
pub fn directory_group_remove(state: S, group_id: String, ids: Vec<String>) -> AppResult<()> {
    state.directory.remove_from_group(&group_id, &ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_intervals_are_bounded() {
        assert!(check_interval(0).is_ok(), "manual only");
        assert!(check_interval(5).is_ok());
        assert!(check_interval(7 * 24 * 60).is_ok());
        assert!(check_interval(1).is_err(), "no hammering a server");
        assert!(check_interval(7 * 24 * 60 + 1).is_err());
    }

    #[test]
    fn a_form_with_a_password_is_read_but_never_printed() {
        let input: LdapSourceInput = serde_json::from_value(serde_json::json!({
            "name": "Directory",
            "config": {"url": "ldaps://ldap.example.com", "baseDn": "dc=example,dc=com"},
            "password": "hunter2"
        }))
        .unwrap();
        assert_eq!(input.sync_interval_min, 360, "a default schedule");
        assert_eq!(input.password.as_deref(), Some("hunter2"));
        // the result of a test carries a report or a failure, never the password
        let failure = serde_json::to_string(&Failure {
            kind: SyncErrorKind::Auth,
            message: "declined".into(),
        })
        .unwrap();
        assert!(!failure.contains("hunter2"));
    }
}
