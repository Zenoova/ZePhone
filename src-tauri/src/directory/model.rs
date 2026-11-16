//! The directory's data model. A contact knows which source it comes from and which identifier that source gave
//! it; nothing here depends on how a source is reached.

use serde::{Deserialize, Serialize};

/// Id of the built-in source: the application's own address book (the `contacts` table).
pub const LOCAL_SOURCE_ID: &str = "local";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PhoneKind {
    /// Business line.
    Work,
    Mobile,
    /// Internal extension (a short number inside the company's PBX).
    Extension,
    Home,
    /// A SIP address.
    Sip,
    Other,
}

/// One way to reach a person. `number` is exactly what the source gave: formatting, spaces and all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneEntry {
    pub kind: PhoneKind,
    pub number: String,
    /// What the source calls it, when it says more than the kind does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl PhoneEntry {
    pub fn new(kind: PhoneKind, number: impl Into<String>) -> Self {
        Self {
            kind,
            number: number.into(),
            label: None,
        }
    }
}

/// A person as a source describes it. This is what connectors produce and what the cache stores.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteContact {
    /// The identifier the source gave this record: stable across synchronisations.
    pub external_id: String,
    pub first_name: String,
    pub last_name: String,
    pub display_name: String,
    pub company: Option<String>,
    pub department: Option<String>,
    pub title: Option<String>,
    pub email: Option<String>,
    pub phones: Vec<PhoneEntry>,
}

impl RemoteContact {
    /// The name to show: the one the source gave, else first and last name, else the e-mail or the company.
    pub fn name(&self) -> String {
        let given = self.display_name.trim();
        if !given.is_empty() {
            return given.to_owned();
        }
        let built = format!("{} {}", self.first_name.trim(), self.last_name.trim());
        let built = built.trim();
        if !built.is_empty() {
            return built.to_owned();
        }
        self.email
            .clone()
            .or_else(|| self.company.clone())
            .or_else(|| self.phones.first().map(|p| p.number.clone()))
            .unwrap_or_default()
    }

    /// A record worth keeping: it has a name or an address, and at least one way to reach the person.
    pub fn is_useful(&self) -> bool {
        !self.external_id.is_empty() && !self.name().is_empty() && !self.phones.is_empty()
    }
}

/// A cached contact: a [`RemoteContact`] with its stable identity in the application.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    /// `"<source id>/<external id>"`: stable across synchronisations, so favourites and groups keep pointing
    /// at the same person.
    pub id: String,
    pub source_id: String,
    #[serde(flatten)]
    pub remote: RemoteContact,
}

pub fn contact_id(source_id: &str, external_id: &str) -> String {
    format!("{source_id}/{external_id}")
}

// ---------------------------------------------------------------- sources

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Local,
    Ldap,
    /// The users of the organisation's directory (Microsoft Entra ID, through Graph `/users`).
    MicrosoftOrg,
    /// The signed-in user's own Outlook contacts (Graph `/me/contacts`). Not the organisation's directory.
    MicrosoftPersonal,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Ldap => "ldap",
            Self::MicrosoftOrg => "microsoftOrg",
            Self::MicrosoftPersonal => "microsoftPersonal",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "local" => Self::Local,
            "ldap" => Self::Ldap,
            "microsoftOrg" => Self::MicrosoftOrg,
            "microsoftPersonal" => Self::MicrosoftPersonal,
            _ => return None,
        })
    }

    /// Records of an enterprise source are read-only here; the local address book is the only editable one.
    pub fn read_only(self) -> bool {
        self != Self::Local
    }

    /// Which record to show as the main one when two sources describe the same person (lowest wins).
    pub fn priority(self) -> u8 {
        match self {
            Self::Local => 0,
            Self::MicrosoftPersonal => 1,
            Self::Ldap => 2,
            Self::MicrosoftOrg => 3,
        }
    }
}

/// Why the last synchronisation of a source failed. The UI picks its action from this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncErrorKind {
    /// The source could not be reached (network, DNS, timeout): temporary, retried with a back-off.
    Network,
    /// The credentials or the token are no longer valid: the user has to reconnect. Never retried on its own.
    Auth,
    /// The administrator has to grant a permission, or the account is not allowed to read the directory.
    Forbidden,
    /// The service asked to slow down.
    Throttled,
    /// The configuration is wrong (unknown host, bad base DN, invalid filter).
    Config,
    /// The source answered something that cannot be used (or an empty directory where there were contacts).
    Invalid,
    /// The service itself failed.
    Server,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    /// Nothing is running; the last synchronisation (if any) went well.
    Idle,
    Syncing,
    /// The last synchronisation failed; the previous contacts are kept.
    Error,
    /// The user has to sign in again.
    NeedsReauth,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    pub id: String,
    pub kind: SourceKind,
    pub name: String,
    pub enabled: bool,
    pub read_only: bool,
    pub state: SourceState,
    pub contact_count: usize,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    /// Shown to the user: no credential, no personal data.
    pub last_error: Option<String>,
    pub error_kind: Option<SyncErrorKind>,
    /// Minutes between automatic synchronisations; 0 = manual only.
    pub sync_interval_min: u32,
    /// The cache has not been refreshed for longer than it is allowed to live.
    pub stale: bool,
    /// The non-secret settings of the source (the LDAP server, the Microsoft client id...).
    pub config: serde_json::Value,
}

// ---------------------------------------------------------------- search

/// What the directory shows for one person.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub record_id: String,
    pub source_id: String,
    pub source_name: String,
    pub kind: SourceKind,
    pub external_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    /// The id of the main record (also what favourites and groups are keyed by, with the other records').
    pub id: String,
    pub display_name: String,
    pub first_name: String,
    pub last_name: String,
    pub company: Option<String>,
    pub department: Option<String>,
    pub title: Option<String>,
    pub email: Option<String>,
    pub phones: Vec<PhoneEntry>,
    /// Where it comes from: one record, or several when the same e-mail address is found in two sources.
    pub sources: Vec<SourceRef>,
    pub favorite: bool,
    /// Ids of the personal groups it belongs to.
    pub groups: Vec<String>,
    pub read_only: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DirectoryQuery {
    pub text: String,
    /// Only these sources (empty = all).
    pub source_ids: Vec<String>,
    /// Only the members of this personal group.
    pub group_id: Option<String>,
    /// Only this department (a grouping the source itself provides).
    pub department: Option<String>,
    pub favorites_only: bool,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPage {
    pub items: Vec<DirectoryEntry>,
    /// How many entries match, whatever the page.
    pub total: usize,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupView {
    pub id: String,
    pub name: String,
    pub member_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepartmentCount {
    pub name: String,
    pub count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_contact_is_named_from_what_the_source_gave() {
        let mut c = RemoteContact {
            external_id: "1".into(),
            first_name: "Élodie".into(),
            last_name: "Dupont".into(),
            ..Default::default()
        };
        assert_eq!(c.name(), "Élodie Dupont");
        c.display_name = "Dupont, Élodie (Compta)".into();
        assert_eq!(c.name(), "Dupont, Élodie (Compta)");
        c.display_name.clear();
        c.first_name.clear();
        c.last_name.clear();
        c.email = Some("e@example.com".into());
        assert_eq!(c.name(), "e@example.com");
    }

    #[test]
    fn a_record_needs_an_identity_a_name_and_a_way_to_reach_it() {
        let mut c = RemoteContact {
            external_id: "1".into(),
            display_name: "A".into(),
            ..Default::default()
        };
        assert!(!c.is_useful(), "no number");
        c.phones.push(PhoneEntry::new(PhoneKind::Work, "1234"));
        assert!(c.is_useful());
        c.external_id.clear();
        assert!(!c.is_useful(), "no identifier from the source");
    }

    #[test]
    fn the_identity_is_the_source_and_the_id_it_gave() {
        assert_eq!(contact_id("src1", "uid-9"), "src1/uid-9");
    }

    #[test]
    fn source_kinds_round_trip_and_only_the_local_one_is_editable() {
        for k in [
            SourceKind::Local,
            SourceKind::Ldap,
            SourceKind::MicrosoftOrg,
            SourceKind::MicrosoftPersonal,
        ] {
            assert_eq!(SourceKind::parse(k.as_str()), Some(k));
            assert_eq!(k.read_only(), k != SourceKind::Local);
        }
        assert_eq!(SourceKind::parse("exchange"), None);
    }

    #[test]
    fn phone_entries_serialise_without_an_empty_label() {
        let json = serde_json::to_value(PhoneEntry::new(PhoneKind::Mobile, "06 12")).unwrap();
        assert_eq!(json, serde_json::json!({"kind": "mobile", "number": "06 12"}));
    }
}
