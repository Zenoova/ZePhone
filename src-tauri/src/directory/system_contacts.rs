//! The device's own address book as a read-only source: Contacts on the Mac, later the ones of iOS and Android.
//!
//! It stays on the device — no network, no password, no account. The user is asked for permission by the system the
//! first time; the permission is the user's to give and to take back (System Settings → Privacy → Contacts). What
//! is read is what the directory needs: names, company, job title, e-mail address, telephone numbers and SIP
//! addresses. Photos, notes, birthdays and postal addresses are never read.
//!
//! The reading itself is behind [`ContactsProvider`], so everything above it — what a card becomes, how permission
//! problems are reported, how a synchronisation behaves — is the same on every platform and is tested without
//! touching anybody's real contacts.

use std::sync::Arc;

use async_trait::async_trait;

use super::{
    model::{PhoneEntry, PhoneKind, RemoteContact, SyncErrorKind},
    normalize::fold,
    sync::{Connector, Fetched, SyncError},
};

/// Is the application allowed to read the device's contacts?
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    /// The user was never asked.
    NotDetermined,
    Denied,
    /// A rule of the device (parental controls, a management profile) forbids it; the user cannot change that.
    Restricted,
    Authorized,
    /// This platform has no address book ZePhone can read.
    Unsupported,
}

/// One contact as the system gives it, before ZePhone's own rules turn it into a directory card.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawContact {
    pub identifier: String,
    pub given_name: String,
    pub family_name: String,
    pub nickname: String,
    pub organization: String,
    pub department: String,
    pub job_title: String,
    /// Telephone numbers with the label the user gave them (the system's own constants, or free text).
    pub phones: Vec<(Option<String>, String)>,
    pub emails: Vec<String>,
    /// SIP addresses found among the instant-messaging addresses.
    pub sip_addresses: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ProviderError(pub String);

/// The platform's way to read the address book.
#[async_trait]
pub trait ContactsProvider: Send + Sync {
    fn access(&self) -> Access;
    /// Asks the user for permission if that has not been done, and says what the answer is. Only ever called
    /// because the user asked to connect the source: a background synchronisation never pops a question up.
    async fn request_access(&self) -> Access;
    /// Reads every contact. Blocking: the caller runs it off the interface's threads.
    fn read_all(&self) -> Result<Vec<RawContact>, ProviderError>;
}

/// What this platform can read: the Mac's Contacts today.
pub fn platform_provider() -> Arc<dyn ContactsProvider> {
    #[cfg(target_os = "macos")]
    {
        Arc::new(super::system_contacts_macos::MacContacts)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(Unsupported)
    }
}

/// Whether the application can read the device's contacts on this platform.
pub const AVAILABLE: bool = cfg!(target_os = "macos");

/// The name the source gets: what the user calls that address book on this platform.
pub const SOURCE_NAME: &str = "Mac contacts";

#[cfg_attr(target_os = "macos", allow(dead_code))]
struct Unsupported;

#[async_trait]
impl ContactsProvider for Unsupported {
    fn access(&self) -> Access {
        Access::Unsupported
    }
    async fn request_access(&self) -> Access {
        Access::Unsupported
    }
    fn read_all(&self) -> Result<Vec<RawContact>, ProviderError> {
        Err(ProviderError("no readable address book".into()))
    }
}

// ---------------------------------------------------------------- what a system card becomes

/// What kind of number a label says it is. Apple's constants look like `_$!<Mobile>!$_`; anything else is text the
/// user typed (in French or English). `None` for numbers that are not for calling (fax, pager).
pub fn phone_kind(label: Option<&str>) -> Option<(PhoneKind, Option<String>)> {
    let Some(raw) = label.map(str::trim).filter(|l| !l.is_empty()) else {
        return Some((PhoneKind::Other, None));
    };
    // Apple's built-in labels: "_$!<Home>!$_" → "home"
    let builtin = raw
        .strip_prefix("_$!<")
        .and_then(|r| r.strip_suffix(">!$_"))
        .map(str::to_lowercase);
    let key = builtin.clone().unwrap_or_else(|| fold(raw));
    let has = |words: &[&str]| words.iter().any(|w| key.contains(w));

    if has(&["fax", "pager", "telecopie", "bipeur"]) {
        return None;
    }
    let kind = if has(&["mobile", "iphone", "portable", "cell", "gsm"]) {
        PhoneKind::Mobile
    } else if has(&["poste", "extension", "ext"]) {
        PhoneKind::Extension
    } else if has(&[
        "work",
        "main",
        "travail",
        "bureau",
        "pro",
        "societe",
        "entreprise",
        "office",
    ]) {
        PhoneKind::Work
    } else if has(&["home", "domicile", "maison", "perso", "personnel"]) {
        PhoneKind::Home
    } else {
        PhoneKind::Other
    };
    // A label the user wrote is kept, to be shown as such; the system's own labels are just the kind.
    let shown = (builtin.is_none() && kind == PhoneKind::Other).then(|| raw.to_owned());
    Some((kind, shown))
}

/// Turns what the system gave into a directory card. `None` for a card that says nothing about who it is.
pub fn map_contact(raw: &RawContact) -> Option<RemoteContact> {
    let given = raw.given_name.trim();
    let family = raw.family_name.trim();
    let org = raw.organization.trim();
    let nick = raw.nickname.trim();
    let person = format!("{given} {family}").trim().to_owned();
    let display_name = [person.as_str(), nick, org]
        .into_iter()
        .find(|s| !s.is_empty())?
        .to_owned();

    let mut phones: Vec<PhoneEntry> = Vec::new();
    for (label, number) in &raw.phones {
        let number = number.trim();
        let Some((kind, shown)) = phone_kind(label.as_deref()) else {
            continue;
        };
        if number.is_empty() || phones.iter().any(|p| p.number == number) {
            continue;
        }
        phones.push(PhoneEntry {
            kind,
            number: number.to_owned(),
            label: shown,
        });
    }
    for sip in &raw.sip_addresses {
        let sip = sip.trim();
        if !sip.is_empty() && !phones.iter().any(|p| p.number.eq_ignore_ascii_case(sip)) {
            phones.push(PhoneEntry::new(PhoneKind::Sip, sip));
        }
    }

    let non_empty = |s: &str| (!s.trim().is_empty()).then(|| s.trim().to_owned());
    // A card that is only an organisation does not repeat it as the company.
    let company = non_empty(org).filter(|o| *o != display_name);
    Some(RemoteContact {
        external_id: raw.identifier.trim().to_owned(),
        first_name: given.to_owned(),
        last_name: family.to_owned(),
        display_name,
        company,
        department: non_empty(&raw.department),
        title: non_empty(&raw.job_title),
        email: raw.emails.iter().find_map(|e| non_empty(e)),
        phones,
    })
}

// ---------------------------------------------------------------- the connector

pub struct SystemContactsConnector {
    provider: Arc<dyn ContactsProvider>,
}

impl SystemContactsConnector {
    pub fn new(provider: Arc<dyn ContactsProvider>) -> Self {
        Self { provider }
    }
}

/// Words for a permission problem, with the way out. The synchronisation reports them as a failure the user can
/// act on (the same "Allow access" button as at connection).
pub fn access_error(access: Access) -> Option<SyncError> {
    let e = |kind, msg: &str| Some(SyncError::new(kind, msg));
    match access {
        Access::Authorized => None,
        Access::NotDetermined => e(
            SyncErrorKind::Forbidden,
            "ZePhone does not have permission to read your contacts yet: allow access.",
        ),
        Access::Denied => e(
            SyncErrorKind::Forbidden,
            "Access to your contacts is denied. Allow ZePhone in System Settings → Privacy & Security → Contacts, then reconnect the source.",
        ),
        Access::Restricted => e(
            SyncErrorKind::Forbidden,
            "Access to contacts is restricted by a policy of this device: ZePhone cannot read them.",
        ),
        Access::Unsupported => e(
            SyncErrorKind::Config,
            "This device has no contacts that ZePhone can read.",
        ),
    }
}

#[async_trait]
impl Connector for SystemContactsConnector {
    async fn fetch(
        &self,
        _cursor: Option<&str>,
        progress: &(dyn Fn(usize) + Send + Sync),
    ) -> Result<Fetched, SyncError> {
        if let Some(e) = access_error(self.provider.access()) {
            return Err(e);
        }
        let provider = self.provider.clone();
        let raw = tokio::task::spawn_blocking(move || provider.read_all())
            .await
            .map_err(|_| {
                SyncError::new(
                    SyncErrorKind::Server,
                    "Reading the contacts was interrupted.",
                )
            })?
            .map_err(|_| {
                SyncError::new(SyncErrorKind::Server, "The contacts could not be read.")
            })?;

        // The system has no "what changed" that is both simple and reliable across platforms: every
        // synchronisation reads the whole address book (it is local, so it is quick).
        let mut seen = std::collections::HashSet::new();
        let contacts: Vec<RemoteContact> = raw
            .iter()
            .filter_map(map_contact)
            .filter(|c| !c.external_id.is_empty() && seen.insert(c.external_id.clone()))
            .collect();
        progress(contacts.len());
        Ok(Fetched {
            contacts,
            removed: Vec::new(),
            complete: true,
            cursor: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    fn raw(id: &str) -> RawContact {
        RawContact {
            identifier: id.into(),
            given_name: "Élodie".into(),
            family_name: "Dupont".into(),
            phones: vec![(Some("_$!<Mobile>!$_".into()), "06 12-34-56-78".into())],
            ..Default::default()
        }
    }

    #[test]
    fn the_systems_own_labels_say_what_kind_of_number_it_is() {
        let kind = |l: &str| phone_kind(Some(l)).map(|k| k.0);
        assert_eq!(kind("_$!<Mobile>!$_"), Some(PhoneKind::Mobile));
        assert_eq!(kind("iPhone"), Some(PhoneKind::Mobile));
        assert_eq!(kind("_$!<Work>!$_"), Some(PhoneKind::Work));
        assert_eq!(kind("_$!<Main>!$_"), Some(PhoneKind::Work));
        assert_eq!(kind("_$!<Home>!$_"), Some(PhoneKind::Home));
        assert_eq!(kind("_$!<Other>!$_"), Some(PhoneKind::Other));
        // the system's labels are not shown as text: the kind says it
        assert_eq!(
            phone_kind(Some("_$!<Home>!$_")),
            Some((PhoneKind::Home, None))
        );
    }

    #[test]
    fn labels_the_user_typed_are_understood_in_french_and_english() {
        let kind = |l: &str| phone_kind(Some(l)).map(|k| k.0);
        assert_eq!(kind("Portable"), Some(PhoneKind::Mobile));
        assert_eq!(kind("Bureau"), Some(PhoneKind::Work));
        assert_eq!(kind("Extension"), Some(PhoneKind::Extension));
        assert_eq!(kind("Domicile"), Some(PhoneKind::Home));
        assert_eq!(kind("Maison"), Some(PhoneKind::Home));
        assert_eq!(kind("Cell"), Some(PhoneKind::Mobile));
    }

    #[test]
    fn a_label_that_means_nothing_is_kept_as_the_user_wrote_it() {
        assert_eq!(
            phone_kind(Some("Chez la voisine")),
            Some((PhoneKind::Other, Some("Chez la voisine".into())))
        );
        assert_eq!(phone_kind(None), Some((PhoneKind::Other, None)));
        assert_eq!(phone_kind(Some("  ")), Some((PhoneKind::Other, None)));
    }

    #[test]
    fn numbers_that_are_not_for_calling_are_left_out() {
        assert_eq!(phone_kind(Some("_$!<HomeFAX>!$_")), None);
        assert_eq!(phone_kind(Some("_$!<WorkFAX>!$_")), None);
        assert_eq!(phone_kind(Some("Fax")), None);
        assert_eq!(phone_kind(Some("_$!<Pager>!$_")), None);
        let mut c = raw("1");
        c.phones
            .push((Some("_$!<WorkFAX>!$_".into()), "01 99 99 99 99".into()));
        assert_eq!(map_contact(&c).unwrap().phones.len(), 1);
    }

    #[test]
    fn a_card_becomes_a_directory_contact_with_its_numbers_as_written() {
        let mut c = raw("ABC:ABPerson");
        c.organization = "Company".into();
        c.department = "Accounting".into();
        c.job_title = "Director".into();
        c.emails = vec![
            "".into(),
            "elodie@example.org".into(),
            "autre@example.org".into(),
        ];
        c.phones
            .push((Some("Bureau".into()), "+33 1 23 45 67 89".into()));
        c.sip_addresses = vec!["sip:elodie@pbx.example.org".into()];
        let r = map_contact(&c).unwrap();
        assert_eq!(r.external_id, "ABC:ABPerson");
        assert_eq!(r.display_name, "Élodie Dupont");
        assert_eq!(
            (r.first_name.as_str(), r.last_name.as_str()),
            ("Élodie", "Dupont")
        );
        assert_eq!(r.company.as_deref(), Some("Company"));
        assert_eq!(r.department.as_deref(), Some("Accounting"));
        assert_eq!(r.title.as_deref(), Some("Director"));
        assert_eq!(r.email.as_deref(), Some("elodie@example.org"));
        let phones: Vec<(PhoneKind, &str)> = r
            .phones
            .iter()
            .map(|p| (p.kind, p.number.as_str()))
            .collect();
        assert_eq!(
            phones,
            vec![
                (PhoneKind::Mobile, "06 12-34-56-78"),
                (PhoneKind::Work, "+33 1 23 45 67 89"),
                (PhoneKind::Sip, "sip:elodie@pbx.example.org"),
            ]
        );
    }

    #[test]
    fn a_card_is_named_from_what_it_has() {
        let only_org = RawContact {
            identifier: "1".into(),
            organization: "Plomberie Durand".into(),
            phones: vec![(None, "01 11 11 11 11".into())],
            ..Default::default()
        };
        let r = map_contact(&only_org).unwrap();
        assert_eq!(r.display_name, "Plomberie Durand");
        assert_eq!(r.company, None, "not repeated");
        let nick = RawContact {
            identifier: "2".into(),
            nickname: "Mamie".into(),
            phones: vec![(None, "01 22 22 22 22".into())],
            ..Default::default()
        };
        assert_eq!(map_contact(&nick).unwrap().display_name, "Mamie");
        // nothing to name it by: not a card for a directory
        assert!(
            map_contact(&RawContact {
                identifier: "3".into(),
                ..Default::default()
            })
            .is_none()
        );
    }

    #[test]
    fn the_same_number_is_listed_once() {
        let mut c = raw("1");
        c.phones
            .push((Some("iPhone".into()), "06 12-34-56-78".into()));
        c.phones.push((None, "   ".into()));
        assert_eq!(map_contact(&c).unwrap().phones.len(), 1);
    }

    // ----------------------------------------------------------- the connector

    struct Fake {
        access: Mutex<Access>,
        contacts: Vec<RawContact>,
        reads: Mutex<u32>,
        fail: bool,
    }

    impl Fake {
        fn with(access: Access, contacts: Vec<RawContact>) -> Arc<Self> {
            Arc::new(Self {
                access: Mutex::new(access),
                contacts,
                reads: Mutex::default(),
                fail: false,
            })
        }
    }

    #[async_trait]
    impl ContactsProvider for Fake {
        fn access(&self) -> Access {
            *self.access.lock().unwrap()
        }
        async fn request_access(&self) -> Access {
            self.access()
        }
        fn read_all(&self) -> Result<Vec<RawContact>, ProviderError> {
            *self.reads.lock().unwrap() += 1;
            if self.fail {
                return Err(ProviderError("boom".into()));
            }
            Ok(self.contacts.clone())
        }
    }

    async fn read(p: Arc<Fake>) -> Result<Fetched, SyncError> {
        SystemContactsConnector::new(p).fetch(None, &|_| {}).await
    }

    #[tokio::test]
    async fn the_whole_address_book_is_read_when_the_user_allowed_it() {
        let mut dup = raw("a");
        dup.given_name = "Doublon".into(); // the same identifier twice: kept once
        let p = Fake::with(
            Access::Authorized,
            vec![raw("a"), raw("b"), dup, RawContact::default()],
        );
        let f = read(p).await.unwrap();
        assert!(f.complete && f.removed.is_empty() && f.cursor.is_none());
        let ids: Vec<&str> = f.contacts.iter().map(|c| c.external_id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[tokio::test]
    async fn nothing_is_read_without_permission_and_the_user_is_told_what_to_do() {
        for (access, kind, needle) in [
            (
                Access::Denied,
                SyncErrorKind::Forbidden,
                "Privacy & Security → Contacts",
            ),
            (
                Access::NotDetermined,
                SyncErrorKind::Forbidden,
                "allow access",
            ),
            (
                Access::Restricted,
                SyncErrorKind::Forbidden,
                "policy of this device",
            ),
            (Access::Unsupported, SyncErrorKind::Config, "no contacts"),
        ] {
            let p = Fake::with(access, vec![raw("a")]);
            let err = read(p.clone()).await.unwrap_err();
            assert_eq!(err.kind, kind, "{access:?}");
            assert!(err.message.contains(needle), "{access:?}: {err}");
            assert_eq!(
                *p.reads.lock().unwrap(),
                0,
                "{access:?}: the address book was not even opened"
            );
        }
    }

    #[tokio::test]
    async fn a_failure_of_the_system_is_reported_without_its_details() {
        let p = Arc::new(Fake {
            access: Mutex::new(Access::Authorized),
            contacts: vec![],
            reads: Mutex::default(),
            fail: true,
        });
        let err = read(p).await.unwrap_err();
        assert_eq!(err.kind, SyncErrorKind::Server);
        assert!(!err.message.contains("boom"));
    }

    #[test]
    fn permission_is_the_only_thing_that_unlocks_the_source() {
        assert!(access_error(Access::Authorized).is_none());
        for a in [
            Access::NotDetermined,
            Access::Denied,
            Access::Restricted,
            Access::Unsupported,
        ] {
            assert!(access_error(a).is_some(), "{a:?}");
        }
    }
}
