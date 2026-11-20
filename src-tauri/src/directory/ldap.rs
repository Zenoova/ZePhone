//! The LDAP connector: reads people from an LDAP or Active Directory server, page by page.
//!
//! The application is native, so it speaks LDAP itself — no intermediary service is needed (a web page could not
//! open an LDAP connection; this can). What it enforces:
//!  * the server's certificate is always verified, against the system's trust store plus the optional CA file of
//!    the network settings — there is no way to turn verification off;
//!  * a bind password is never sent in the clear: it needs `ldaps://` or StartTLS;
//!  * the password lives in the credential store, never in the configuration or in a log.

use std::{collections::HashSet, time::Duration};

use async_trait::async_trait;
use ldap3::{
    Ldap, LdapConnAsync, LdapConnSettings, LdapError, Scope, SearchEntry, SearchOptions,
    adapters::{Adapter, EntriesOnly, PagedResults},
};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

use super::{
    model::{PhoneEntry, PhoneKind, RemoteContact, SyncErrorKind},
    sync::{Connector, Fetched, SyncError},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// A whole synchronisation may take this long, however many pages the server needs.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PREVIEW_SIZE: i32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LdapScope {
    /// The base and everything below it.
    Subtree,
    /// Only the entries directly under the base.
    OneLevel,
}

/// One LDAP attribute that holds a telephone number, and what kind of number it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneAttribute {
    pub attribute: String,
    pub kind: PhoneKind,
}

/// Which attribute of the server fills which field of a contact. Each field lists attributes in order of
/// preference: the first one the entry has wins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LdapMapping {
    /// The stable identifier of an entry. `dn` (as a last resort) changes when an entry is renamed.
    pub id: Vec<String>,
    pub first_name: Vec<String>,
    pub last_name: Vec<String>,
    pub display_name: Vec<String>,
    pub email: Vec<String>,
    pub company: Vec<String>,
    pub department: Vec<String>,
    pub title: Vec<String>,
    pub phones: Vec<PhoneAttribute>,
}

fn list(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| (*s).to_owned()).collect()
}

fn phone(attribute: &str, kind: PhoneKind) -> PhoneAttribute {
    PhoneAttribute {
        attribute: attribute.into(),
        kind,
    }
}

impl LdapMapping {
    /// OpenLDAP and most servers: `inetOrgPerson`.
    pub fn open_ldap() -> Self {
        Self {
            id: list(&["entryUUID", "nsUniqueId", "dn"]),
            first_name: list(&["givenName"]),
            last_name: list(&["sn"]),
            display_name: list(&["displayName", "cn"]),
            email: list(&["mail"]),
            company: list(&["o"]),
            department: list(&["departmentNumber", "ou"]),
            title: list(&["title"]),
            phones: vec![
                phone("telephoneNumber", PhoneKind::Work),
                phone("mobile", PhoneKind::Mobile),
                phone("homePhone", PhoneKind::Home),
                phone("ipPhone", PhoneKind::Extension),
            ],
        }
    }

    /// Microsoft Active Directory.
    pub fn active_directory() -> Self {
        Self {
            id: list(&["objectGUID", "dn"]),
            first_name: list(&["givenName"]),
            last_name: list(&["sn"]),
            display_name: list(&["displayName", "cn"]),
            email: list(&["mail"]),
            company: list(&["company"]),
            department: list(&["department"]),
            title: list(&["title"]),
            phones: vec![
                phone("telephoneNumber", PhoneKind::Work),
                phone("mobile", PhoneKind::Mobile),
                phone("homePhone", PhoneKind::Home),
                phone("ipPhone", PhoneKind::Extension),
            ],
        }
    }

    /// Every attribute the search has to ask for.
    pub fn attributes(&self) -> Vec<String> {
        let mut out: Vec<String> = [
            &self.id,
            &self.first_name,
            &self.last_name,
            &self.display_name,
            &self.email,
            &self.company,
            &self.department,
            &self.title,
        ]
        .into_iter()
        .flatten()
        .filter(|a| !a.eq_ignore_ascii_case("dn"))
        .cloned()
        .collect();
        out.extend(self.phones.iter().map(|p| p.attribute.clone()));
        let mut seen = HashSet::new();
        out.retain(|a| seen.insert(a.to_lowercase()));
        out
    }
}

impl Default for LdapMapping {
    fn default() -> Self {
        Self::open_ldap()
    }
}

pub const FILTER_OPEN_LDAP: &str = "(objectClass=inetOrgPerson)";
/// People who are enabled accounts (not computers, not disabled users).
pub const FILTER_ACTIVE_DIRECTORY: &str =
    "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LdapConfig {
    /// `ldaps://host[:636]`, or `ldap://host[:389]` together with `starttls`.
    pub url: String,
    pub starttls: bool,
    /// Empty = anonymous bind. The password is in the credential store.
    pub bind_dn: String,
    pub base_dn: String,
    pub scope: LdapScope,
    pub filter: String,
    pub page_size: u32,
    pub mapping: LdapMapping,
}

impl Default for LdapConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            starttls: false,
            bind_dn: String::new(),
            base_dn: String::new(),
            scope: LdapScope::Subtree,
            filter: FILTER_OPEN_LDAP.into(),
            page_size: 500,
            mapping: LdapMapping::default(),
        }
    }
}

fn valid_attribute(a: &str) -> bool {
    let mut chars = a.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && a.len() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ';' | '.'))
}

/// Parentheses must close, and nothing may follow the filter.
fn balanced_filter(f: &str) -> bool {
    let f = f.trim();
    if !f.starts_with('(') || !f.ends_with(')') {
        return false;
    }
    let mut depth = 0i32;
    let mut escaped = false;
    for (i, c) in f.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 || (depth == 0 && i != f.len() - 1) {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}

impl LdapConfig {
    /// Checks the settings before anything is sent to the server. `has_password`: a bind password is set.
    pub fn validate(&self, has_password: bool) -> Result<(), String> {
        let url = self.url.trim();
        let (secure, rest) = if let Some(r) = url.strip_prefix("ldaps://") {
            (true, r)
        } else if let Some(r) = url.strip_prefix("ldap://") {
            (false, r)
        } else {
            return Err("The address must start with ldaps:// (recommended) or ldap://".into());
        };
        let host = rest.split(['/', '?']).next().unwrap_or("");
        if host.is_empty() || host.contains(char::is_whitespace) || url.len() > 300 {
            return Err("The server address is invalid".into());
        }
        if self.starttls && secure {
            return Err("StartTLS is used with ldap://, not with ldaps://".into());
        }
        if !secure && !self.starttls && (has_password || !self.bind_dn.trim().is_empty()) {
            return Err(
                "A password must not travel in clear text: use ldaps:// or enable StartTLS".into(),
            );
        }
        if self.base_dn.trim().is_empty() {
            return Err("The search base (Base DN) is required".into());
        }
        if !balanced_filter(&self.filter) {
            return Err("The filter must be an LDAP expression in parentheses, for example (objectClass=person)".into());
        }
        if !(10..=5000).contains(&self.page_size) {
            return Err("The page size must be between 10 and 5,000".into());
        }
        if !self.bind_dn.trim().is_empty() && !has_password {
            return Err("A password is required with this sign-in account".into());
        }
        let m = &self.mapping;
        let attrs = m
            .attributes()
            .into_iter()
            .chain(std::iter::once("dn".to_owned()));
        for a in attrs {
            if !a.eq_ignore_ascii_case("dn") && !valid_attribute(&a) {
                return Err(format!("Invalid attribute name: {a}"));
            }
        }
        if m.phones.is_empty() {
            return Err("Give at least one attribute containing a phone number".into());
        }
        if m.id.is_empty() {
            return Err("Give the attribute that identifies an entry in a stable way".into());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- entries to contacts

fn first_value(e: &SearchEntry, names: &[String]) -> Option<String> {
    names.iter().find_map(|n| {
        e.attrs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(n))
            .and_then(|(_, v)| v.iter().map(|s| s.trim()).find(|s| !s.is_empty()))
            .map(str::to_owned)
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The identifier the server gave the entry: a text value (`entryUUID`), a binary one (`objectGUID`, kept as
/// hexadecimal), or — only if nothing else exists — its DN.
fn entry_id(e: &SearchEntry, names: &[String]) -> Option<String> {
    for n in names {
        if n.eq_ignore_ascii_case("dn") {
            return Some(format!("dn:{}", e.dn.to_lowercase()));
        }
        if let Some(v) = first_value(e, std::slice::from_ref(n)) {
            return Some(v.to_lowercase());
        }
        if let Some((_, vals)) = e.bin_attrs.iter().find(|(k, _)| k.eq_ignore_ascii_case(n))
            && let Some(first) = vals.iter().find(|v| !v.is_empty())
        {
            return Some(hex(first));
        }
    }
    None
}

/// Turns an entry into a contact, or `None` when it has no stable identifier. Numbers are kept exactly as the
/// server has them.
pub fn map_entry(e: &SearchEntry, m: &LdapMapping) -> Option<RemoteContact> {
    let external_id = entry_id(e, &m.id)?;
    let mut phones: Vec<PhoneEntry> = Vec::new();
    for p in &m.phones {
        let Some((_, values)) = e
            .attrs
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(&p.attribute))
        else {
            continue;
        };
        for v in values {
            let v = v.trim();
            if !v.is_empty() && !phones.iter().any(|x| x.number == v) {
                phones.push(PhoneEntry {
                    kind: if super::normalize::is_sip_address(v) {
                        PhoneKind::Sip
                    } else {
                        p.kind
                    },
                    number: v.to_owned(),
                    label: None,
                });
            }
        }
    }
    Some(RemoteContact {
        external_id,
        first_name: first_value(e, &m.first_name).unwrap_or_default(),
        last_name: first_value(e, &m.last_name).unwrap_or_default(),
        display_name: first_value(e, &m.display_name).unwrap_or_default(),
        company: first_value(e, &m.company),
        department: first_value(e, &m.department),
        title: first_value(e, &m.title),
        email: first_value(e, &m.email),
        phones,
    })
}

// ---------------------------------------------------------------- errors

/// Turns a failure of the library or of the server into what the user can act on. The messages never carry the
/// bind password, a DN or a filter.
pub fn translate_error(e: &LdapError) -> SyncError {
    let err = |kind, msg: &str| SyncError::new(kind, msg);
    match e {
        LdapError::LdapResult { result } => match result.rc {
            49 => err(
                SyncErrorKind::Auth,
                "The server refused the credentials: check the account and the password, then reconnect the source.",
            ),
            50 | 53 | 8 => err(
                SyncErrorKind::Forbidden,
                "This account is not allowed to read the directory. Ask your administrator for access.",
            ),
            // A server also answers "no such object" to an account that may not see the base at all.
            32 => err(
                SyncErrorKind::Config,
                "The search base (Base DN) was not found, or this account is not allowed to access it: \
                 check the base and the account's rights.",
            ),
            87 | 12 | 18 => err(
                SyncErrorKind::Config,
                "The server does not accept the filter or the requested attributes: check the filter and the field mapping.",
            ),
            4 | 11 => err(
                SyncErrorKind::Invalid,
                "The server limits the number of results: narrow the search base or the filter.",
            ),
            51 | 52 | 80 => err(
                SyncErrorKind::Server,
                "The LDAP server is unavailable or busy.",
            ),
            _ => err(SyncErrorKind::Server, "The LDAP server returned an error."),
        },
        #[cfg(not(target_os = "android"))]
        LdapError::NativeTLS { .. } => err(
            SyncErrorKind::Config,
            "The secure connection failed: the server's certificate is not trusted, or does not match its address. \
             Add your company's certificate authority in Settings → Network.",
        ),
        #[cfg(target_os = "android")]
        LdapError::Rustls { .. } | LdapError::DNSName { .. } => err(
            SyncErrorKind::Config,
            "The secure connection failed: the server's certificate is not trusted, or does not match its address.",
        ),
        LdapError::Io { source } => match source.kind() {
            std::io::ErrorKind::ConnectionRefused => err(
                SyncErrorKind::Network,
                "The server refuses the connection: check the address and the port.",
            ),
            std::io::ErrorKind::TimedOut => err(
                SyncErrorKind::Network,
                "The server is not answering (timed out).",
            ),
            _ => err(
                SyncErrorKind::Network,
                "Server not found or unreachable: check the address and your connection.",
            ),
        },
        LdapError::Timeout { .. } => err(
            SyncErrorKind::Network,
            "The server is not answering (timed out).",
        ),
        LdapError::EndOfStream | LdapError::ResultRecv { .. } | LdapError::OpSend { .. } => err(
            SyncErrorKind::Network,
            "The connection with the server was interrupted.",
        ),
        LdapError::UrlParsing { .. } | LdapError::UnknownScheme(_) | LdapError::FilterParsing => {
            err(
                SyncErrorKind::Config,
                "The server address or the filter is invalid.",
            )
        }
        _ => err(
            SyncErrorKind::Server,
            "Unexpected error on the LDAP connection.",
        ),
    }
}

// ---------------------------------------------------------------- the connector

pub struct LdapConnector {
    config: LdapConfig,
    password: Option<SecretString>,
    /// PEM of an additional certificate authority (the network settings' CA file).
    ca_pem: Option<Vec<u8>>,
}

impl LdapConnector {
    pub fn new(
        config: LdapConfig,
        password: Option<SecretString>,
        ca_pem: Option<Vec<u8>>,
    ) -> Self {
        Self {
            config,
            password,
            ca_pem,
        }
    }

    async fn connect(&self) -> Result<Ldap, SyncError> {
        self.config
            .validate(self.password.is_some())
            .map_err(|m| SyncError::new(SyncErrorKind::Config, m))?;
        #[cfg_attr(any(target_os = "android", target_os = "ios"), allow(unused_mut))]
        let mut settings = LdapConnSettings::new()
            .set_conn_timeout(CONNECT_TIMEOUT)
            .set_starttls(self.config.starttls);
        // Verification stays on. The system's trust store is used; a company CA can be added to it.
        // (A phone's TLS library cannot take an extra root certificate here: Android uses rustls, and the
        // `native-tls` of iOS does not read a PEM certificate.)
        #[cfg(any(target_os = "android", target_os = "ios"))]
        if self.ca_pem.is_some() {
            return Err(SyncError::new(
                SyncErrorKind::Config,
                "A company certificate authority for LDAP is not supported on a phone yet.",
            ));
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        if let Some(pem) = &self.ca_pem {
            let cert = native_tls::Certificate::from_pem(pem).map_err(|_| {
                SyncError::new(
                    SyncErrorKind::Config,
                    "The certificate authority file (Settings → Network) is not a valid PEM certificate.",
                )
            })?;
            let connector = native_tls::TlsConnector::builder()
                .add_root_certificate(cert)
                .build()
                .map_err(|_| {
                    SyncError::new(
                        SyncErrorKind::Config,
                        "Cannot prepare the secure connection.",
                    )
                })?;
            settings = settings.set_connector(connector);
        }
        let (conn, mut ldap) = LdapConnAsync::with_settings(settings, self.config.url.trim())
            .await
            .map_err(|e| translate_error(&e))?;
        ldap3::drive!(conn);
        if !self.config.bind_dn.trim().is_empty() {
            let pw = self
                .password
                .as_ref()
                .map(|p| p.expose_secret().to_owned())
                .unwrap_or_default();
            ldap.simple_bind(self.config.bind_dn.trim(), &pw)
                .await
                .map_err(|e| translate_error(&e))?
                .success()
                .map_err(|e| translate_error(&e))?;
        }
        Ok(ldap)
    }

    fn scope(&self) -> Scope {
        match self.config.scope {
            LdapScope::Subtree => Scope::Subtree,
            LdapScope::OneLevel => Scope::OneLevel,
        }
    }

    async fn read_all(&self) -> Result<Fetched, SyncError> {
        let mut ldap = self.connect().await?;
        let attrs = self.config.mapping.attributes();
        let adapters: Vec<Box<dyn Adapter<'_, _, _>>> = vec![
            Box::new(EntriesOnly::new()),
            Box::new(PagedResults::new(self.config.page_size as i32)),
        ];
        let mut stream = ldap
            .streaming_search_with(
                adapters,
                self.config.base_dn.trim(),
                self.scope(),
                self.config.filter.trim(),
                attrs,
            )
            .await
            .map_err(|e| translate_error(&e))?;
        let mut contacts = Vec::new();
        let mut seen = HashSet::new();
        while let Some(entry) = stream.next().await.map_err(|e| translate_error(&e))? {
            let entry = SearchEntry::construct(entry);
            if let Some(c) = map_entry(&entry, &self.config.mapping)
                && seen.insert(c.external_id.clone())
            {
                contacts.push(c);
            }
        }
        stream
            .finish()
            .await
            .success()
            .map_err(|e| translate_error(&e))?;
        let _ = ldap.unbind().await;
        Ok(Fetched {
            contacts,
            removed: Vec::new(),
            complete: true,
            cursor: None,
        })
    }
}

#[async_trait]
impl Connector for LdapConnector {
    async fn fetch(
        &self,
        _cursor: Option<&str>,
        progress: &(dyn Fn(usize) + Send + Sync),
    ) -> Result<Fetched, SyncError> {
        // LDAP has no standard way to learn what was deleted, so every synchronisation is a complete,
        // paged read: what is gone from the server is gone from the cache.
        let fetched = tokio::time::timeout(FETCH_TIMEOUT, self.read_all())
            .await
            .map_err(|_| {
                SyncError::new(
                    SyncErrorKind::Network,
                    "The server takes too long to answer.",
                )
            })??;
        progress(fetched.contacts.len());
        Ok(fetched)
    }
}

// ---------------------------------------------------------------- test and preview

/// The result of “Test the connection”: whether it works, and what the first entries would look like.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LdapTestReport {
    pub authenticated: bool,
    /// The first contacts the configuration would produce.
    pub preview: Vec<RemoteContact>,
    /// How many of the entries read for the preview could not become contacts (no identifier).
    pub skipped: usize,
    /// What looks wrong in the configuration, in plain words.
    pub warnings: Vec<String>,
}

impl LdapConnector {
    /// Connects, signs in and reads the first entries, so that the user sees the directory before turning it on.
    pub async fn test(&self) -> Result<LdapTestReport, SyncError> {
        let mut ldap = self.connect().await?;
        let ldap3::SearchResult(rows, res) = ldap
            .with_search_options(SearchOptions::new().sizelimit(PREVIEW_SIZE))
            .search(
                self.config.base_dn.trim(),
                self.scope(),
                self.config.filter.trim(),
                self.config.mapping.attributes(),
            )
            .await
            .map_err(|e| translate_error(&e))?;
        // 4 = the size limit we asked for was reached: expected.
        if res.rc != 0 && res.rc != 4 {
            return Err(translate_error(&LdapError::LdapResult { result: res }));
        }
        let _ = ldap.unbind().await;

        let entries: Vec<SearchEntry> = rows.into_iter().map(SearchEntry::construct).collect();
        let mut preview = Vec::new();
        let mut skipped = 0;
        for e in &entries {
            match map_entry(e, &self.config.mapping) {
                Some(c) => preview.push(c),
                None => skipped += 1,
            }
        }
        let mut warnings = Vec::new();
        if entries.is_empty() {
            warnings.push(
                "No entries found: check the search base and the filter (or the account's rights)."
                    .into(),
            );
        } else {
            let without_number = preview.iter().filter(|c| c.phones.is_empty()).count();
            if without_number == preview.len() && !preview.is_empty() {
                warnings
                    .push("None of these entries has a number: check the phone attributes.".into());
            } else if without_number > 0 {
                warnings.push(format!(
                    "{without_number} of {} entries have no number: they will be ignored.",
                    preview.len()
                ));
            }
            if skipped > 0 {
                warnings.push(format!(
                    "{skipped} entries have no stable identifier: check the identifier attribute."
                ));
            }
            if preview.iter().all(|c| c.name().is_empty()) {
                warnings.push("None of these entries has a name: check the field mapping.".into());
            }
        }
        Ok(LdapTestReport {
            authenticated: !self.config.bind_dn.trim().is_empty(),
            preview,
            skipped,
            warnings,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn entry(dn: &str, attrs: &[(&str, &[&str])]) -> SearchEntry {
        SearchEntry {
            dn: dn.into(),
            attrs: attrs
                .iter()
                .map(|(k, v)| ((*k).to_owned(), v.iter().map(|s| (*s).to_owned()).collect()))
                .collect(),
            bin_attrs: HashMap::new(),
        }
    }

    fn good() -> LdapConfig {
        LdapConfig {
            url: "ldaps://ldap.example.com".into(),
            base_dn: "dc=example,dc=com".into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_secure_configuration_is_accepted() {
        assert!(good().validate(false).is_ok());
        let mut c = good();
        c.bind_dn = "cn=reader,dc=example,dc=com".into();
        assert!(c.validate(true).is_ok());
        let mut c = good();
        c.url = "ldap://ldap.example.com:389".into();
        c.starttls = true;
        assert!(c.validate(true).is_ok());
    }

    #[test]
    fn a_password_never_travels_in_the_clear() {
        let mut c = good();
        c.url = "ldap://ldap.example.com".into();
        c.bind_dn = "cn=reader,dc=example,dc=com".into();
        assert!(c.validate(true).unwrap_err().contains("clear text"));
        c.starttls = true;
        assert!(c.validate(true).is_ok());
        // an anonymous read over plain LDAP carries no secret
        let mut anon = good();
        anon.url = "ldap://ldap.example.com".into();
        assert!(anon.validate(false).is_ok());
    }

    #[test]
    fn bad_settings_are_refused_before_anything_is_sent() {
        let mut c = good();
        c.url = "http://ldap.example.com".into();
        assert!(c.validate(false).is_err());
        let mut c = good();
        c.url = "ldaps://".into();
        assert!(c.validate(false).is_err());
        let mut c = good();
        c.url = "ldaps://a b".into();
        assert!(c.validate(false).is_err());
        let mut c = good();
        c.base_dn = "  ".into();
        assert!(c.validate(false).is_err());
        let mut c = good();
        c.starttls = true; // with ldaps://
        assert!(c.validate(false).is_err());
        let mut c = good();
        c.bind_dn = "cn=x".into();
        assert!(c.validate(false).unwrap_err().contains("password"));
        let mut c = good();
        c.page_size = 3;
        assert!(c.validate(false).is_err());
    }

    #[test]
    fn filters_must_be_balanced_and_single() {
        for ok in [
            "(objectClass=person)",
            "(&(a=1)(|(b=2)(c=3)))",
            FILTER_ACTIVE_DIRECTORY,
            "(cn=a\\)b)",
        ] {
            assert!(balanced_filter(ok), "{ok}");
        }
        for bad in [
            "objectClass=person",
            "(a=1",
            "(a=1))",
            "(a=1)(b=2)",
            "",
            "(a=1)x",
        ] {
            assert!(!balanced_filter(bad), "{bad}");
        }
        let mut c = good();
        c.filter = "(a=1)(b=2)".into();
        assert!(c.validate(false).is_err());
    }

    #[test]
    fn attribute_names_cannot_smuggle_anything() {
        let mut c = good();
        c.mapping.email = vec!["mail)(objectClass=*".into()];
        assert!(c.validate(false).unwrap_err().contains("attribut"));
        let mut c = good();
        c.mapping.phones = vec![];
        assert!(c.validate(false).is_err());
        let mut c = good();
        c.mapping.id = vec![];
        assert!(c.validate(false).is_err());
        assert!(
            good()
                .mapping
                .attributes()
                .contains(&"telephoneNumber".to_owned())
        );
        assert!(!good().mapping.attributes().iter().any(|a| a == "dn"));
    }

    #[test]
    fn the_configuration_never_holds_a_secret() {
        let json = serde_json::to_string(&good()).unwrap();
        assert!(!json.to_lowercase().contains("password"));
    }

    #[test]
    fn an_entry_becomes_a_contact_with_every_number_as_written() {
        let e = entry(
            "uid=elodie,ou=people,dc=example,dc=com",
            &[
                ("entryUUID", &["ABC-123"]),
                ("givenName", &["Élodie"]),
                ("sn", &["Dupont"]),
                ("cn", &["Élodie Dupont"]),
                ("mail", &["elodie@example.com"]),
                ("o", &["Company"]),
                ("title", &["  Director  "]),
                ("ou", &["Accounting"]),
                (
                    "telephoneNumber",
                    &["+33 1 23 45 67 89", "+33 1 23 45 67 89", "  "],
                ),
                ("mobile", &["06 12-34-56-78"]),
                ("ipPhone", &["sip:elodie@pbx.example.com"]),
            ],
        );
        let c = map_entry(&e, &LdapMapping::open_ldap()).unwrap();
        assert_eq!(c.external_id, "abc-123");
        assert_eq!(c.display_name, "Élodie Dupont");
        assert_eq!(c.title.as_deref(), Some("Director"));
        assert_eq!(c.department.as_deref(), Some("Accounting"));
        let numbers: Vec<(PhoneKind, &str)> = c
            .phones
            .iter()
            .map(|p| (p.kind, p.number.as_str()))
            .collect();
        assert_eq!(
            numbers,
            vec![
                (PhoneKind::Work, "+33 1 23 45 67 89"),
                (PhoneKind::Mobile, "06 12-34-56-78"),
                (PhoneKind::Sip, "sip:elodie@pbx.example.com"),
            ]
        );
    }

    #[test]
    fn attribute_names_are_matched_whatever_their_case() {
        let e = entry(
            "uid=a",
            &[
                ("ENTRYUUID", &["1"]),
                ("TelephoneNumber", &["123"]),
                ("CN", &["A"]),
            ],
        );
        let c = map_entry(&e, &LdapMapping::open_ldap()).unwrap();
        assert_eq!(
            (
                c.external_id.as_str(),
                c.display_name.as_str(),
                c.phones.len()
            ),
            ("1", "A", 1)
        );
    }

    #[test]
    fn the_first_attribute_of_the_list_that_the_entry_has_wins() {
        let m = LdapMapping::open_ldap();
        let e = entry(
            "uid=a",
            &[
                ("entryUUID", &["1"]),
                ("cn", &["Common"]),
                ("displayName", &["Display"]),
            ],
        );
        assert_eq!(map_entry(&e, &m).unwrap().display_name, "Display");
        let e = entry("uid=a", &[("entryUUID", &["1"]), ("cn", &["Common"])]);
        assert_eq!(map_entry(&e, &m).unwrap().display_name, "Common");
    }

    #[test]
    fn a_binary_identifier_is_kept_as_hexadecimal() {
        let mut e = entry("cn=a", &[("cn", &["A"])]);
        e.bin_attrs
            .insert("objectGUID".into(), vec![vec![0xde, 0xad, 0xbe, 0xef]]);
        let c = map_entry(&e, &LdapMapping::active_directory()).unwrap();
        assert_eq!(c.external_id, "deadbeef");
    }

    #[test]
    fn the_dn_is_only_the_last_resort_for_an_identifier() {
        let e = entry("CN=A,DC=Example", &[("cn", &["A"])]);
        assert_eq!(
            map_entry(&e, &LdapMapping::open_ldap())
                .unwrap()
                .external_id,
            "dn:cn=a,dc=example"
        );
        let mut m = LdapMapping::open_ldap();
        m.id = vec!["entryUUID".into()];
        assert!(map_entry(&e, &m).is_none(), "no identifier, no contact");
    }

    #[test]
    fn ldap_failures_become_something_the_user_can_act_on() {
        let rc = |rc| {
            translate_error(&LdapError::LdapResult {
                result: ldap3::LdapResult {
                    rc,
                    matched: "ou=secret,dc=corp".into(),
                    text: "uid=jean.durand failed".into(),
                    refs: vec![],
                    ctrls: vec![],
                },
            })
        };
        assert_eq!(rc(49).kind, SyncErrorKind::Auth);
        assert!(rc(49).message.contains("reconnect"));
        assert_eq!(rc(50).kind, SyncErrorKind::Forbidden);
        assert_eq!(rc(32).kind, SyncErrorKind::Config);
        assert_eq!(rc(87).kind, SyncErrorKind::Config);
        assert_eq!(rc(4).kind, SyncErrorKind::Invalid);
        assert_eq!(rc(52).kind, SyncErrorKind::Server);
        // what the server said (a DN, a user) is never repeated to the user or to the log
        for code in [49, 50, 32, 87, 4, 52, 1] {
            let m = rc(code).message;
            assert!(!m.contains("jean.durand") && !m.contains("secret"), "{m}");
        }
        let refused = translate_error(&LdapError::Io {
            source: std::io::Error::from(std::io::ErrorKind::ConnectionRefused),
        });
        assert_eq!(refused.kind, SyncErrorKind::Network);
        let unknown = translate_error(&LdapError::UnknownScheme("x".into()));
        assert_eq!(unknown.kind, SyncErrorKind::Config);
    }

    #[test]
    fn presets_differ_where_active_directory_differs() {
        let ad = LdapMapping::active_directory();
        assert_eq!(ad.id[0], "objectGUID");
        assert_eq!(ad.company, vec!["company"]);
        assert_eq!(LdapMapping::open_ldap().id[0], "entryUUID");
        assert!(FILTER_ACTIVE_DIRECTORY.contains("userAccountControl"));
    }
}
