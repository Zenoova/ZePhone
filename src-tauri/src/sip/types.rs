//! Domain types shared between the SIP layer, the database and the frontend.
//! Everything is serialised in camelCase to match the TypeScript definitions.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

// ---------------------------------------------------------------- accounts

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    #[default]
    Udp,
    Tcp,
    Tls,
}

impl Transport {
    pub fn as_param(self) -> &'static str {
        match self {
            Transport::Udp => "udp",
            Transport::Tcp => "tcp",
            Transport::Tls => "tls",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "udp" => Some(Transport::Udp),
            "tcp" => Some(Transport::Tcp),
            "tls" => Some(Transport::Tls),
            _ => None,
        }
    }

    pub fn default_port(self) -> u16 {
        match self {
            Transport::Tls => 5061,
            _ => 5060,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum MediaEncryption {
    #[default]
    None,
    /// SRTP offered but optional (RTP/SAVP fallback allowed by the peer).
    Srtp,
    /// SRTP mandatory: the call fails if the peer does not support it.
    SrtpMandatory,
}

impl MediaEncryption {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaEncryption::None => "none",
            MediaEncryption::Srtp => "srtp",
            MediaEncryption::SrtpMandatory => "srtp-mandatory",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "none" => Some(MediaEncryption::None),
            "srtp" => Some(MediaEncryption::Srtp),
            "srtp-mandatory" => Some(MediaEncryption::SrtpMandatory),
            _ => None,
        }
    }
}

/// A persisted SIP account (never contains the password).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub display_name: Option<String>,
    /// Registrar / PBX host (what we connect to).
    pub server: String,
    pub port: u16,
    /// SIP domain used in the AoR (`sip:user@domain`). Equals `server` if empty.
    pub domain: String,
    pub username: String,
    /// Authentication user if different from `username`.
    pub auth_username: Option<String>,
    pub transport: Transport,
    /// Optional outbound proxy, `host[:port]`. Used as next hop instead of `server`.
    pub outbound_proxy: Option<String>,
    /// Registration interval in seconds; `0` disables registration (direct calls only).
    pub register_interval: u32,
    pub media_encryption: MediaEncryption,
    pub enabled: bool,
    pub is_default: bool,
}

impl Account {
    pub fn aor(&self) -> String {
        format!("sip:{}@{}", self.username, self.domain)
    }
}

/// Account as sent to the UI: the account plus whether a password is stored.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    #[serde(flatten)]
    pub account: Account,
    pub has_password: bool,
}

/// Payload used to create or update an account. `password` is only used for
/// creation or when the user types a new one; `None` keeps the stored secret.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub id: Option<String>,
    pub label: String,
    pub display_name: Option<String>,
    pub server: String,
    pub port: Option<u16>,
    pub domain: Option<String>,
    pub username: String,
    pub auth_username: Option<String>,
    pub transport: Transport,
    pub outbound_proxy: Option<String>,
    pub register_interval: Option<u32>,
    #[serde(default)]
    pub media_encryption: MediaEncryption,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub password: Option<String>,
}

fn default_true() -> bool {
    true
}

pub const DEFAULT_REGISTER_INTERVAL: u32 = 300;

fn clean_opt(v: &Option<String>) -> Option<String> {
    v.as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

impl AccountInput {
    /// Validates and normalises the input into an [`Account`] (without id/default flags
    /// being final: the caller assigns them).
    pub fn into_account(&self, id: String, is_default: bool) -> AppResult<Account> {
        let server = self.server.trim().to_string();
        crate::sip::uri::validate_host(&server)
            .map_err(|e| AppError::validation(format!("Serveur SIP : {e}")))?;

        let domain = clean_opt(&self.domain).unwrap_or_else(|| server.clone());
        crate::sip::uri::validate_host(&domain)
            .map_err(|e| AppError::validation(format!("Domaine SIP : {e}")))?;

        let username = self.username.trim().to_string();
        crate::sip::uri::validate_user(&username)
            .map_err(|e| AppError::validation(format!("Identifiant : {e}")))?;

        let auth_username = clean_opt(&self.auth_username);
        if let Some(a) = &auth_username {
            crate::sip::uri::validate_quoted_value(a).map_err(|e| {
                AppError::validation(format!("Identifiant d'authentification : {e}"))
            })?;
        }

        let display_name = clean_opt(&self.display_name);
        if let Some(d) = &display_name {
            crate::sip::uri::validate_quoted_value(d)
                .map_err(|e| AppError::validation(format!("Nom affiché : {e}")))?;
        }

        let outbound_proxy = clean_opt(&self.outbound_proxy);
        if let Some(p) = &outbound_proxy {
            crate::sip::uri::validate_host_port(p)
                .map_err(|e| AppError::validation(format!("Proxy sortant : {e}")))?;
        }

        let port = self.port.unwrap_or_else(|| self.transport.default_port());
        if port == 0 {
            return Err(AppError::validation("Port invalide (1-65535)"));
        }

        let register_interval = self.register_interval.unwrap_or(DEFAULT_REGISTER_INTERVAL);
        if register_interval != 0 && !(30..=86_400).contains(&register_interval) {
            return Err(AppError::validation(
                "Intervalle d'enregistrement invalide (0 ou 30 à 86400 secondes)",
            ));
        }

        let label = self.label.trim();
        let label = if label.is_empty() {
            format!("{username}@{domain}")
        } else {
            label.to_string()
        };
        if label.chars().count() > 80 || label.chars().any(char::is_control) {
            return Err(AppError::validation(
                "Libellé invalide (80 caractères max.)",
            ));
        }

        if let Some(pw) = &self.password {
            crate::sip::uri::validate_password(pw)?;
        }

        Ok(Account {
            id,
            label,
            display_name,
            server,
            port,
            domain,
            username,
            auth_username,
            transport: self.transport,
            outbound_proxy,
            register_interval,
            media_encryption: self.media_encryption,
            enabled: self.enabled,
            is_default,
        })
    }
}

// ------------------------------------------------------------ registration

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RegistrationState {
    /// Account is incomplete (e.g. no password) or unknown to the engine.
    Unconfigured,
    Connecting,
    Registered,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub account_id: String,
    pub state: RegistrationState,
    /// SIP status code of the last registrar answer, when known (401, 403, 408, 503...).
    pub sip_code: Option<u16>,
    pub reason: Option<String>,
    /// Human readable diagnostic (translated by the UI from `sip_code` when possible).
    pub message: Option<String>,
    pub updated_at: String,
}

// ------------------------------------------------------------------- calls

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CallDirection {
    Incoming,
    Outgoing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CallState {
    /// Outgoing call requested, engine has not started signalling yet.
    Initializing,
    /// INVITE sent, waiting for a provisional answer.
    Dialing,
    /// Remote party is ringing (180/183).
    Ringing,
    /// Incoming call waiting to be answered.
    Incoming,
    Connected,
    OnHold,
    Ended,
    Failed,
}

impl CallState {
    pub fn is_terminal(self) -> bool {
        matches!(self, CallState::Ended | CallState::Failed)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: String,
    pub account_id: Option<String>,
    pub account_label: Option<String>,
    pub direction: CallDirection,
    pub state: CallState,
    pub remote_uri: String,
    /// User part of the remote URI (number / extension).
    pub remote_number: String,
    /// Display name announced by the peer, or the matching contact.
    pub remote_name: Option<String>,
    pub muted: bool,
    pub created_at: String,
    pub connected_at: Option<String>,
    pub ended_at: Option<String>,
    pub duration_secs: u64,
    pub sip_code: Option<u16>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CallResult {
    Answered,
    Missed,
    Rejected,
    Failed,
    /// Outgoing call hung up by the user before the peer answered.
    Cancelled,
}

impl CallResult {
    pub fn as_str(self) -> &'static str {
        match self {
            CallResult::Answered => "answered",
            CallResult::Missed => "missed",
            CallResult::Rejected => "rejected",
            CallResult::Failed => "failed",
            CallResult::Cancelled => "cancelled",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "answered" => Some(CallResult::Answered),
            "missed" => Some(CallResult::Missed),
            "rejected" => Some(CallResult::Rejected),
            "failed" => Some(CallResult::Failed),
            "cancelled" => Some(CallResult::Cancelled),
            _ => None,
        }
    }
}

impl CallDirection {
    pub fn as_str(self) -> &'static str {
        match self {
            CallDirection::Incoming => "incoming",
            CallDirection::Outgoing => "outgoing",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "incoming" => Some(CallDirection::Incoming),
            "outgoing" => Some(CallDirection::Outgoing),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub account_id: Option<String>,
    pub account_label: Option<String>,
    pub remote_uri: String,
    pub remote_number: String,
    pub contact_name: Option<String>,
    pub direction: CallDirection,
    pub result: CallResult,
    pub started_at: String,
    pub answered_at: Option<String>,
    pub ended_at: String,
    pub duration_secs: u64,
    pub sip_code: Option<u16>,
    pub reason: Option<String>,
}

// ---------------------------------------------------------------- contacts

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub company: Option<String>,
    /// Phone number or SIP URI.
    pub number: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Contact {
    pub fn display_name(&self) -> String {
        let name = format!("{} {}", self.first_name.trim(), self.last_name.trim());
        let name = name.trim();
        if !name.is_empty() {
            name.to_string()
        } else {
            self.company.clone().unwrap_or_else(|| self.number.clone())
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactInput {
    pub id: Option<String>,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub company: Option<String>,
    pub number: String,
}

impl ContactInput {
    pub fn validate(&self) -> AppResult<()> {
        if self.first_name.trim().is_empty()
            && self.last_name.trim().is_empty()
            && clean_opt(&self.company).is_none()
        {
            return Err(AppError::validation(
                "Renseignez au moins un nom, un prénom ou une société",
            ));
        }
        let number = self.number.trim();
        if number.is_empty() {
            return Err(AppError::validation(
                "Le numéro ou l'URI SIP est obligatoire",
            ));
        }
        // Must be dialable.
        crate::sip::uri::normalize_target(number, "example.invalid")
            .map_err(|e| AppError::validation(format!("Numéro ou URI SIP invalide : {e}")))?;
        for (label, v) in [("Prénom", &self.first_name), ("Nom", &self.last_name)] {
            if v.chars().count() > 80 || v.chars().any(char::is_control) {
                return Err(AppError::validation(format!("{label} invalide")));
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- settings

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
#[derive(Default)]
pub struct AudioSettings {
    /// Microphone device name as reported by the system. `None` = system default.
    pub input_device: Option<String>,
    /// Speaker device name. `None` = system default.
    pub output_device: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationSettings {
    pub incoming_call: bool,
    pub missed_call: bool,
    pub ringtone: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            incoming_call: true,
            missed_call: true,
            ringtone: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    pub theme: Theme,
    pub launch_at_login: bool,
    pub start_minimized: bool,
    /// Keep the app (and the SIP registration) alive in the menu bar when the window is closed.
    pub close_to_tray: bool,
    pub show_tray_icon: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            launch_at_login: false,
            start_minimized: false,
            close_to_tray: true,
            show_tray_icon: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NetworkSettings {
    /// Extra PEM CA bundle used to verify SIP/TLS servers (system roots otherwise).
    pub custom_ca_file: Option<String>,
    /// Log SIP messages in the engine output (debug only, kept in memory).
    pub sip_trace: bool,
    /// Fixed local SIP port; `None` lets the engine pick one.
    pub local_sip_port: Option<u16>,
    /// Restrict SIP/RTP to one network interface (`en0`) or local IP address.
    pub net_interface: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub audio: AudioSettings,
    pub notifications: NotificationSettings,
    pub general: GeneralSettings,
    pub network: NetworkSettings,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> AccountInput {
        AccountInput {
            id: None,
            label: String::new(),
            display_name: None,
            server: "sip.example.com".into(),
            port: None,
            domain: None,
            username: "1001".into(),
            auth_username: None,
            transport: Transport::Udp,
            outbound_proxy: None,
            register_interval: None,
            media_encryption: MediaEncryption::None,
            enabled: true,
            password: Some("secret".into()),
        }
    }

    #[test]
    fn defaults_are_filled_from_server_and_transport() {
        let acc = input().into_account("a1".into(), true).unwrap();
        assert_eq!(acc.domain, "sip.example.com");
        assert_eq!(acc.port, 5060);
        assert_eq!(acc.label, "1001@sip.example.com");
        assert_eq!(acc.register_interval, 300);
        assert_eq!(acc.aor(), "sip:1001@sip.example.com");
    }

    #[test]
    fn tls_defaults_to_5061() {
        let mut i = input();
        i.transport = Transport::Tls;
        assert_eq!(i.into_account("a".into(), false).unwrap().port, 5061);
    }

    #[test]
    fn rejects_injection_in_username() {
        let mut i = input();
        i.username = "1001@evil.com;x=y".into();
        assert!(i.into_account("a".into(), false).is_err());
        i.username = "10 01".into();
        assert!(i.into_account("a".into(), false).is_err());
    }

    #[test]
    fn rejects_quote_in_auth_user_and_display_name() {
        let mut i = input();
        i.auth_username = Some("bob\";auth_pass=x".into());
        assert!(i.into_account("a".into(), false).is_err());
        let mut i = input();
        i.display_name = Some("Al \"Cap\" one".into());
        assert!(i.into_account("a".into(), false).is_err());
    }

    #[test]
    fn rejects_bad_register_interval() {
        let mut i = input();
        i.register_interval = Some(5);
        assert!(i.into_account("a".into(), false).is_err());
        i.register_interval = Some(0);
        assert!(i.into_account("a".into(), false).is_ok());
    }

    #[test]
    fn account_view_flattens_camel_case() {
        let acc = input().into_account("a1".into(), false).unwrap();
        let v = serde_json::to_value(AccountView {
            account: acc,
            has_password: true,
        })
        .unwrap();
        assert_eq!(v["hasPassword"], true);
        assert_eq!(v["registerInterval"], 300);
        assert_eq!(v["mediaEncryption"], "none");
        assert!(v.get("password").is_none());
    }

    #[test]
    fn contact_requires_a_name_and_dialable_number() {
        let mut c = ContactInput {
            id: None,
            first_name: "Ada".into(),
            last_name: String::new(),
            company: None,
            number: "+33 1 23 45 67 89".into(),
        };
        assert!(c.validate().is_ok());
        c.number = "bad number;x".into();
        assert!(c.validate().is_err());
        c.number = "1002".into();
        c.first_name = String::new();
        assert!(c.validate().is_err());
    }

    #[test]
    fn settings_deserialise_with_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"general":{"theme":"dark"}}"#).unwrap();
        assert_eq!(s.general.theme, Theme::Dark);
        assert!(s.general.close_to_tray);
        assert!(s.notifications.incoming_call);
    }
}
