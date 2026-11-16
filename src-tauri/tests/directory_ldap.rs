//! The LDAP connector and the directory service against a REAL OpenLDAP server (`slapd`), started on loopback
//! with a throw-away database and a self-signed certificate. Nothing is simulated: the TLS handshake, the
//! paged search, the access rules and the outages are the real ones.
//!
//! Requirements (the tests are skipped with a message otherwise): Homebrew's `openldap` (`slapd` and its schemas)
//! and an `openssl` to make the certificate. Override the locations with `ZEPHONE_TEST_SLAPD`,
//! `ZEPHONE_TEST_SLAPD_SCHEMA` and `ZEPHONE_TEST_OPENSSL`.
//!
//! Run: `cargo test --test directory_ldap -- --nocapture --test-threads=1`

use std::{
    collections::HashSet,
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

use ldap3::{LdapConnAsync, Mod};
use secrecy::SecretString;
use zephone_lib::{
    database::Database,
    directory::{
        connectors::RealConnectorFactory,
        ldap::{LdapConfig, LdapConnector},
        model::{DirectoryQuery, PhoneKind, SourceKind, SourceState, SyncErrorKind},
        service::{DirectoryEvents, DirectoryService},
        sync::Connector,
    },
    security::secrets::{MemoryStore, SecretStore},
};

const BASE: &str = "dc=example,dc=org";
const ADMIN_DN: &str = "cn=admin,dc=example,dc=org";
const ADMIN_PW: &str = "admin-pw-for-tests";
const READER_DN: &str = "cn=reader,dc=example,dc=org";
const READER_PW: &str = "reader-pw-for-tests";

fn env_or(var: &str, default: &str) -> PathBuf {
    std::env::var_os(var).map_or_else(|| PathBuf::from(default), PathBuf::from)
}

struct Slapd {
    child: Option<Child>,
    dir: tempfile::TempDir,
    ldap_port: u16,
    ldaps_port: u16,
    slapd: PathBuf,
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

impl Slapd {
    /// Starts a server with the people of [`populate`]. `None` when the tools are not installed.
    async fn start() -> Option<Self> {
        let slapd = env_or(
            "ZEPHONE_TEST_SLAPD",
            "/opt/homebrew/opt/openldap/libexec/slapd",
        );
        let schema = env_or(
            "ZEPHONE_TEST_SLAPD_SCHEMA",
            "/opt/homebrew/etc/openldap/schema",
        );
        let openssl = env_or(
            "ZEPHONE_TEST_OPENSSL",
            "/opt/homebrew/opt/openssl@3/bin/openssl",
        );
        if !slapd.is_file() || !schema.join("inetorgperson.schema").is_file() || !openssl.is_file()
        {
            eprintln!(
                "SKIPPED: slapd / schemas / openssl not found (brew install openldap openssl@3)"
            );
            return None;
        }
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        std::fs::create_dir_all(d.join("data")).unwrap();

        // A certificate for localhost and 127.0.0.1, valid for a day.
        let status = Command::new(&openssl)
            .args([
                "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            ])
            .args(["-keyout", d.join("key.pem").to_str().unwrap()])
            .args(["-out", d.join("cert.pem").to_str().unwrap()])
            .args(["-subj", "/CN=localhost"])
            .args(["-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"])
            // macOS refuses a server certificate that does not say it is one
            .args(["-addext", "extendedKeyUsage=serverAuth"])
            .args(["-addext", "keyUsage=digitalSignature,keyEncipherment"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .ok()?;
        assert!(status.success(), "openssl could not make a certificate");

        std::fs::write(
            d.join("slapd.conf"),
            format!(
                "include {schema}/core.schema\n\
                 include {schema}/cosine.schema\n\
                 include {schema}/inetorgperson.schema\n\
                 pidfile {d}/slapd.pid\n\
                 argsfile {d}/slapd.args\n\
                 TLSCertificateFile {d}/cert.pem\n\
                 TLSCertificateKeyFile {d}/key.pem\n\
                 database mdb\n\
                 maxsize 33554432\n\
                 suffix \"{BASE}\"\n\
                 rootdn \"{ADMIN_DN}\"\n\
                 rootpw {ADMIN_PW}\n\
                 directory {d}/data\n\
                 index objectClass eq\n\
                 access to attrs=userPassword by anonymous auth by * none\n\
                 access to * by dn.exact=\"{READER_DN}\" read by * none\n",
                schema = schema.display(),
                d = d.display(),
            ),
        )
        .unwrap();

        let mut s = Self {
            child: None,
            dir,
            ldap_port: free_port(),
            ldaps_port: free_port(),
            slapd,
        };
        s.run().await;
        populate(s.ldap_port).await;
        Some(s)
    }

    async fn run(&mut self) {
        let d = self.dir.path();
        let child = Command::new(&self.slapd)
            .args(["-f", d.join("slapd.conf").to_str().unwrap()])
            .args([
                "-h",
                &format!(
                    "ldap://127.0.0.1:{} ldaps://127.0.0.1:{}",
                    self.ldap_port, self.ldaps_port
                ),
            ])
            .args(["-d", "0"]) // stay in the foreground, say nothing
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("slapd starts");
        self.child = Some(child);
        let deadline = Instant::now() + Duration::from_secs(15);
        while TcpStream::connect(("127.0.0.1", self.ldaps_port)).is_err() {
            assert!(Instant::now() < deadline, "slapd did not come up");
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// Takes the server down (an outage). Its data stay.
    fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    async fn restart(&mut self) {
        self.stop();
        self.run().await;
    }

    fn cert(&self) -> Vec<u8> {
        std::fs::read(self.dir.path().join("cert.pem")).unwrap()
    }

    fn cert_path(&self) -> PathBuf {
        self.dir.path().join("cert.pem")
    }

    fn ldaps_url(&self) -> String {
        format!("ldaps://localhost:{}", self.ldaps_port)
    }

    fn config(&self) -> LdapConfig {
        LdapConfig {
            url: self.ldaps_url(),
            bind_dn: READER_DN.into(),
            base_dn: format!("ou=people,{BASE}"),
            page_size: 10,
            ..Default::default()
        }
    }

    fn connector(&self, config: LdapConfig, password: Option<&str>, ca: bool) -> LdapConnector {
        LdapConnector::new(
            config,
            password.map(|p| SecretString::from(p.to_owned())),
            ca.then(|| self.cert()),
        )
    }

    async fn admin(&self) -> ldap3::Ldap {
        let (conn, mut ldap) = LdapConnAsync::new(&format!("ldap://127.0.0.1:{}", self.ldap_port))
            .await
            .unwrap();
        ldap3::drive!(conn);
        ldap.simple_bind(ADMIN_DN, ADMIN_PW)
            .await
            .unwrap()
            .success()
            .unwrap();
        ldap
    }
}

impl Drop for Slapd {
    fn drop(&mut self) {
        self.stop();
    }
}

type Attrs<'a> = Vec<(&'a str, HashSet<&'a str>)>;

fn one<'a>(k: &'a str, v: &'a str) -> (&'a str, HashSet<&'a str>) {
    (k, HashSet::from([v]))
}

async fn add(ldap: &mut ldap3::Ldap, dn: &str, attrs: Attrs<'_>) {
    ldap.add(dn, attrs).await.unwrap().success().unwrap();
}

/// The directory: a base, `ou=people`, a reader account, and 26 people (Élodie, two Jean Martin, one entry
/// without any number, and 22 others — more than a page of 10).
async fn populate(port: u16) {
    let (conn, mut ldap) = LdapConnAsync::new(&format!("ldap://127.0.0.1:{port}"))
        .await
        .unwrap();
    ldap3::drive!(conn);
    ldap.simple_bind(ADMIN_DN, ADMIN_PW)
        .await
        .unwrap()
        .success()
        .unwrap();

    add(
        &mut ldap,
        BASE,
        vec![
            (
                "objectClass",
                HashSet::from(["top", "dcObject", "organization"]),
            ),
            one("dc", "example"),
            one("o", "Example"),
        ],
    )
    .await;
    add(
        &mut ldap,
        &format!("ou=people,{BASE}"),
        vec![
            ("objectClass", HashSet::from(["top", "organizationalUnit"])),
            one("ou", "people"),
        ],
    )
    .await;
    add(
        &mut ldap,
        READER_DN,
        vec![
            ("objectClass", HashSet::from(["top", "person"])),
            one("cn", "reader"),
            one("sn", "reader"),
            one("userPassword", READER_PW),
        ],
    )
    .await;

    #[allow(clippy::too_many_arguments)]
    async fn person(
        ldap: &mut ldap3::Ldap,
        uid: &str,
        given: &str,
        sn: &str,
        mail: &str,
        phone: Option<&str>,
        mobile: Option<&str>,
        dept: &str,
    ) {
        let cn = format!("{given} {sn}");
        let mut attrs: Attrs<'_> = vec![
            (
                "objectClass",
                HashSet::from(["top", "person", "inetOrgPerson"]),
            ),
            one("uid", uid),
            one("cn", &cn),
            one("givenName", given),
            one("sn", sn),
            one("displayName", &cn),
            one("mail", mail),
            one("o", "Société Exemple"),
            one("departmentNumber", dept),
            one("title", "Chargé de mission"),
        ];
        if let Some(p) = phone {
            attrs.push(one("telephoneNumber", p));
        }
        if let Some(m) = mobile {
            attrs.push(one("mobile", m));
        }
        add(ldap, &format!("uid={uid},ou=people,{BASE}"), attrs).await;
    }

    person(
        &mut ldap,
        "elodie",
        "Élodie",
        "Dupont",
        "elodie.dupont@example.org",
        Some("+33 1 23 45 67 89"),
        Some("06 12-34-56-78"),
        "Comptabilité",
    )
    .await;
    person(
        &mut ldap,
        "jmartin1",
        "Jean",
        "Martin",
        "jean.martin@example.org",
        Some("01.11.11.11.11"),
        None,
        "Ventes",
    )
    .await;
    person(
        &mut ldap,
        "jmartin2",
        "Jean",
        "Martin",
        "jean.martin2@example.org",
        Some("01.22.22.22.22 poste 4242"),
        None,
        "Support",
    )
    .await;
    person(
        &mut ldap,
        "sansnumero",
        "Sans",
        "Numéro",
        "sans.numero@example.org",
        None,
        None,
        "Ventes",
    )
    .await;
    for i in 0..22 {
        person(
            &mut ldap,
            &format!("user{i:02}"),
            &format!("Prénom{i:02}"),
            &format!("Nom{i:02}"),
            &format!("user{i:02}@example.org"),
            Some(&format!("+33 1 40 00 00 {i:02}")),
            None,
            if i % 2 == 0 { "Ventes" } else { "Support" },
        )
        .await;
    }
    let _ = ldap.unbind().await;
}

/// Everyone with a way to be reached: all but "Sans Numéro".
const REACHABLE: usize = 25;

#[tokio::test]
async fn every_page_is_read_over_verified_tls_with_fields_mapped_and_numbers_kept_as_written() {
    let Some(s) = Slapd::start().await else {
        return;
    };

    // LDAPS, verified against the company CA
    let fetched = s
        .connector(s.config(), Some(READER_PW), true)
        .fetch(None, &|_| {})
        .await
        .expect("read over ldaps");
    assert!(fetched.complete && fetched.removed.is_empty());
    assert_eq!(
        fetched.contacts.len(),
        26,
        "three pages of 10, all followed"
    );

    let elodie = fetched
        .contacts
        .iter()
        .find(|c| c.display_name == "Élodie Dupont")
        .expect("Élodie");
    assert_eq!(elodie.email.as_deref(), Some("elodie.dupont@example.org"));
    assert_eq!(elodie.company.as_deref(), Some("Société Exemple"));
    assert_eq!(elodie.department.as_deref(), Some("Comptabilité"));
    let numbers: Vec<(PhoneKind, &str)> = elodie
        .phones
        .iter()
        .map(|p| (p.kind, p.number.as_str()))
        .collect();
    assert_eq!(
        numbers,
        vec![
            (PhoneKind::Work, "+33 1 23 45 67 89"),
            (PhoneKind::Mobile, "06 12-34-56-78")
        ]
    );
    assert_eq!(
        elodie.external_id.len(),
        36,
        "the server's entryUUID: {}",
        elodie.external_id
    );

    // two people with the same name are two records with two identifiers
    let martins: Vec<_> = fetched
        .contacts
        .iter()
        .filter(|c| c.display_name == "Jean Martin")
        .collect();
    assert_eq!(martins.len(), 2);
    assert_ne!(martins[0].external_id, martins[1].external_id);
    assert!(
        martins
            .iter()
            .any(|c| c.phones[0].number == "01.22.22.22.22 poste 4242")
    );

    // identifiers are stable from one read to the next
    let again = s
        .connector(s.config(), Some(READER_PW), true)
        .fetch(None, &|_| {})
        .await
        .unwrap();
    let ids = |f: &zephone_lib::directory::sync::Fetched| -> HashSet<String> {
        f.contacts.iter().map(|c| c.external_id.clone()).collect()
    };
    assert_eq!(ids(&fetched), ids(&again));

    // StartTLS on the plain port, same verification
    let mut starttls = s.config();
    starttls.url = format!("ldap://localhost:{}", s.ldap_port);
    starttls.starttls = true;
    let fetched = s
        .connector(starttls, Some(READER_PW), true)
        .fetch(None, &|_| {})
        .await
        .expect("starttls");
    assert_eq!(fetched.contacts.len(), 26);
}

#[tokio::test]
async fn the_certificate_is_verified_and_there_is_no_way_around_it() {
    let Some(s) = Slapd::start().await else {
        return;
    };
    // the server's certificate is self-signed: without the company CA it must be refused
    let err = s
        .connector(s.config(), Some(READER_PW), false)
        .fetch(None, &|_| {})
        .await
        .expect_err("an untrusted certificate is refused");
    assert_eq!(err.kind, SyncErrorKind::Config, "{err}");
    assert!(err.message.contains("certificat"), "{err}");
    assert!(
        err.message.contains("Paramètres → Réseau"),
        "it says what to do: {err}"
    );

    // the same with StartTLS
    let mut starttls = s.config();
    starttls.url = format!("ldap://localhost:{}", s.ldap_port);
    starttls.starttls = true;
    let err = s
        .connector(starttls, Some(READER_PW), false)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Config, "{err}");

    // a CA file that is not a certificate is reported, not ignored
    let bad = LdapConnector::new(
        s.config(),
        Some(SecretString::from(READER_PW.to_owned())),
        Some(b"not pem".to_vec()),
    );
    assert!(
        bad.fetch(None, &|_| {})
            .await
            .unwrap_err()
            .message
            .contains("autorité")
    );
}

#[tokio::test]
async fn failures_come_back_as_actions_the_user_can_take() {
    let Some(s) = Slapd::start().await else {
        return;
    };

    // a wrong password: reconnect the source
    let err = s
        .connector(s.config(), Some("wrong"), true)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Auth, "{err}");
    assert!(err.message.contains("reconnectez"), "{err}");
    assert!(!err.message.contains(READER_PW) && !err.message.contains("wrong"));

    // a base that does not exist: fix the configuration
    let mut config = s.config();
    config.base_dn = "ou=nobody,dc=example,dc=org".into();
    let err = s
        .connector(config, Some(READER_PW), true)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Config, "{err}");

    // nothing listens there: a network problem, to be retried later
    let mut config = s.config();
    config.url = format!("ldaps://localhost:{}", free_port());
    let err = s
        .connector(config, Some(READER_PW), true)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Network, "{err}");

    // the rights of the account are the rights of the user: anonymously, the access rules hide even the base
    let mut anonymous = s.config();
    anonymous.bind_dn = String::new();
    let err = s
        .connector(anonymous, None, true)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Config, "{err}");
    assert!(err.message.contains("droit"), "{err}");
}

#[tokio::test]
async fn the_test_shows_the_first_contacts_before_the_source_is_turned_on() {
    let Some(s) = Slapd::start().await else {
        return;
    };
    let report = s
        .connector(s.config(), Some(READER_PW), true)
        .test()
        .await
        .expect("test");
    assert!(report.authenticated);
    assert_eq!(report.preview.len(), 10, "a preview of the first ten");
    assert!(
        report
            .preview
            .iter()
            .all(|c| !c.external_id.is_empty() && !c.name().is_empty())
    );

    // a filter that matches nobody is said plainly
    let mut empty = s.config();
    empty.filter = "(uid=nobody-at-all)".into();
    let report = s
        .connector(empty, Some(READER_PW), true)
        .test()
        .await
        .unwrap();
    assert!(report.preview.is_empty());
    assert!(
        report.warnings[0].contains("Aucune entrée"),
        "{:?}",
        report.warnings
    );

    // a mapping that finds no number is said too
    let mut wrong = s.config();
    wrong.mapping.phones = vec![zephone_lib::directory::ldap::PhoneAttribute {
        attribute: "facsimileTelephoneNumber".into(),
        kind: PhoneKind::Other,
    }];
    let report = s
        .connector(wrong, Some(READER_PW), true)
        .test()
        .await
        .unwrap();
    assert!(
        report.warnings.iter().any(|w| w.contains("numéro")),
        "{:?}",
        report.warnings
    );

    // and a bad password fails the test with the reconnect advice
    let err = s
        .connector(s.config(), Some("nope"), true)
        .test()
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Auth);
}

struct NoEvents;
impl DirectoryEvents for NoEvents {}

fn search(svc: &DirectoryService, text: &str) -> Vec<String> {
    svc.search(&DirectoryQuery {
        text: text.into(),
        ..Default::default()
    })
    .unwrap()
    .items
    .into_iter()
    .map(|e| e.display_name)
    .collect()
}

#[tokio::test]
async fn an_outage_never_empties_the_directory_and_what_changed_at_the_server_follows() {
    let Some(mut s) = Slapd::start().await else {
        return;
    };

    // the whole chain, as the application runs it: a stored source, the keychain, the company CA from the
    // network settings, the real connector
    let db = Arc::new(Database::open_in_memory().unwrap());
    let mut settings = db.get_settings().unwrap();
    settings.network.custom_ca_file = Some(s.cert_path().display().to_string());
    db.save_settings(&settings).unwrap();
    let secrets = Arc::new(MemoryStore::default());
    let svc = DirectoryService::new(
        db.clone(),
        secrets.clone(),
        Arc::new(NoEvents),
        Arc::new(RealConnectorFactory::new(db)),
    );
    let id = svc
        .add_source(
            SourceKind::Ldap,
            "Annuaire de l'entreprise",
            &serde_json::to_value(s.config()).unwrap(),
            60,
            Some(("password", &SecretString::from(READER_PW.to_owned()))),
        )
        .unwrap();

    // first synchronisation
    let report = svc
        .sync_now(&id, true)
        .await
        .expect("first synchronisation");
    assert_eq!(
        (report.added, report.total),
        (REACHABLE, REACHABLE),
        "the entry without a number is left out"
    );
    assert_eq!(
        search(&svc, "elodie"),
        vec!["Élodie Dupont"],
        "'elodie' finds 'Élodie'"
    );
    assert_eq!(
        search(&svc, "06 12 34 56 78"),
        vec!["Élodie Dupont"],
        "a number, whatever its separators"
    );
    assert_eq!(
        search(&svc, "poste 4242"),
        vec!["Jean Martin"],
        "an extension"
    );
    assert_eq!(
        search(&svc, "jean martin").len(),
        2,
        "two people of the same name stay two people"
    );

    // a favourite and a group
    let eid: Vec<String> = svc
        .search(&DirectoryQuery {
            text: "elodie".into(),
            ..Default::default()
        })
        .unwrap()
        .items[0]
        .sources
        .iter()
        .map(|r| r.record_id.clone())
        .collect();
    svc.set_favorite(&eid, true).unwrap();
    let group = svc.create_group("Direction").unwrap();
    svc.add_to_group(&group.id, &eid).unwrap();

    // THE OUTAGE: the server goes away
    s.stop();
    let err = svc
        .sync_now(&id, true)
        .await
        .expect_err("the server is down");
    println!("outage reported as: {err}");
    assert_eq!(
        search(&svc, "").len(),
        REACHABLE,
        "every contact is still there"
    );
    let view = svc.source(&id).unwrap();
    assert_eq!(
        (view.state, view.error_kind),
        (SourceState::Error, Some(SyncErrorKind::Network))
    );
    assert_eq!(view.contact_count, REACHABLE);
    assert!(view.last_success_at.is_some());

    // the server is back; meanwhile somebody left and somebody moved
    s.restart().await;
    let mut admin = s.admin().await;
    admin
        .delete(&format!("uid=user05,ou=people,{BASE}"))
        .await
        .unwrap()
        .success()
        .unwrap();
    admin
        .modify(
            &format!("uid=elodie,ou=people,{BASE}"),
            vec![Mod::Replace(
                "telephoneNumber",
                HashSet::from(["+33 9 99 99 99 99"]),
            )],
        )
        .await
        .unwrap()
        .success()
        .unwrap();
    let _ = admin.unbind().await;

    let report = svc
        .sync_now(&id, true)
        .await
        .expect("synchronisation after the outage");
    assert_eq!(
        (report.removed, report.updated, report.total),
        (1, 1, REACHABLE - 1)
    );
    assert_eq!(svc.source(&id).unwrap().state, SourceState::Idle);
    assert!(
        search(&svc, "prenom05").is_empty(),
        "who left the directory is gone after a successful synchronisation"
    );
    assert_eq!(
        search(&svc, "09 99 99 99 99").len(),
        1,
        "who moved has the new number, found from its national form"
    );

    // the favourite and the group survived the outage, the update and the new number
    let e = &svc
        .search(&DirectoryQuery {
            text: "elodie".into(),
            ..Default::default()
        })
        .unwrap()
        .items[0];
    assert!(e.favorite);
    assert_eq!(e.groups, vec![group.id.clone()]);
    assert_eq!(e.phones[0].number, "+33 9 99 99 99 99");

    // disconnecting erases the password and the cache; the personal data stay for a reconnection
    svc.disconnect(&id).unwrap();
    assert!(search(&svc, "").is_empty());
    let (fav, _) = (svc.store().favorites().unwrap(), ());
    assert!(fav.contains(&eid[0]));
    assert!(
        secrets
            .get(&zephone_lib::directory::sync::secret_key(&id, "password"))
            .unwrap()
            .is_none()
    );
}
