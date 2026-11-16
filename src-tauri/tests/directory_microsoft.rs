//! The Microsoft 365 connector's HTTP, OAuth and Graph code, against a STAND-IN Microsoft service that runs on the
//! loopback and plays the part of the token endpoint and of Graph.
//!
//! READ THIS BEFORE TRUSTING IT: these tests run the real connector code (real HTTP requests, real PKCE, real
//! pagination, delta and error handling) against a stand-in. They prove the code follows Microsoft's documented
//! protocol. They do NOT prove that it works against a real tenant: that needs a real app registration, a real
//! account and, for the organisation's directory, administrator consent. See `docs/DIRECTORY.md`.
//!
//! Run: `cargo test --test directory_microsoft -- --nocapture`

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use secrecy::{ExposeSecret, SecretString};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
};
use zephone_lib::{
    database::Database,
    directory::{
        connectors::RealConnectorFactory,
        microsoft::{
            Authorization, Endpoints, Level, MicrosoftConfig, MicrosoftConnector, code_challenge,
            http_client,
        },
        model::{DirectoryQuery, PhoneKind, SourceKind, SourceState, SyncErrorKind},
        service::{DirectoryEvents, DirectoryService},
        sync::{Connector, secret_key},
    },
    security::secrets::{MemoryStore, SecretStore},
};

const CLIENT_ID: &str = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------- the stand-in service

#[derive(Clone, Debug)]
struct Req {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: String,
}

impl Req {
    fn form(&self) -> HashMap<String, String> {
        reqwest::Url::parse(&format!("http://x/?{}", self.body))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }
}

struct Resp {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: Value,
}

fn ok(body: Value) -> Resp {
    Resp {
        status: 200,
        headers: vec![],
        body,
    }
}

fn status(code: u16, body: Value) -> Resp {
    Resp {
        status: code,
        headers: vec![],
        body,
    }
}

type Handler = Arc<dyn Fn(&Req) -> Resp + Send + Sync>;

struct Fake {
    base: String,
    log: Arc<Mutex<Vec<Req>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Fake {
    async fn start(handler: Handler) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let log: Arc<Mutex<Vec<Req>>> = Arc::default();
        let l = log.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let (handler, log) = (handler.clone(), l.clone());
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let head_end = loop {
                        let n = sock.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break p + 4;
                        }
                    };
                    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                    let mut lines = head.lines();
                    let mut first = lines.next().unwrap_or("").split(' ');
                    let (method, target) = (
                        first.next().unwrap_or("").to_owned(),
                        first.next().unwrap_or("").to_owned(),
                    );
                    let headers: HashMap<String, String> = lines
                        .filter_map(|l| l.split_once(':'))
                        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_owned()))
                        .collect();
                    let len: usize = headers
                        .get("content-length")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);
                    while buf.len() < head_end + len {
                        let n = sock.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    let body = String::from_utf8_lossy(&buf[head_end..]).to_string();
                    let req = Req {
                        method,
                        target,
                        headers,
                        body,
                    };
                    log.lock().unwrap().push(req.clone());
                    let resp = handler(&req);
                    let payload = resp.body.to_string();
                    let mut out = format!(
                        "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                        resp.status,
                        payload.len()
                    );
                    for (k, v) in &resp.headers {
                        out.push_str(&format!("{k}: {v}\r\n"));
                    }
                    out.push_str("\r\n");
                    out.push_str(&payload);
                    let _ = sock.write_all(out.as_bytes()).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        Self { base, log, task }
    }

    fn endpoints(&self) -> Endpoints {
        Endpoints {
            authority: self.base.clone(),
            graph: format!("{}/v1.0", self.base),
        }
    }

    fn requests(&self) -> Vec<Req> {
        self.log.lock().unwrap().clone()
    }

    fn graph_requests(&self) -> Vec<Req> {
        self.requests()
            .into_iter()
            .filter(|r| r.target.starts_with("/v1.0/"))
            .collect()
    }
}

/// What the stand-in token endpoint and Graph do, switched by the tests.
#[derive(Default)]
struct Behaviour {
    /// The refresh token currently valid; each refresh rotates it.
    refresh: Mutex<String>,
    /// Which access token Graph accepts (a new one is issued at every refresh).
    access_serial: Mutex<u32>,
    /// Make Graph answer 401 once, whatever the token (an access token that expired).
    expire_once: Mutex<bool>,
    throttle: Mutex<Option<u64>>,
    evil_next_link: Mutex<bool>,
    token_error: Mutex<Option<(u16, Value)>>,
    /// PKCE: what the sign-in address announced.
    expected_challenge: Mutex<Option<String>>,
    expected_redirect: Mutex<String>,
    users_seen_scopes: Mutex<Vec<String>>,
}

fn user(n: u32, name: &str, phone: &str) -> Value {
    json!({
        "id": format!("00000000-0000-0000-0000-{n:012}"),
        "displayName": name, "givenName": name.split(' ').next().unwrap(), "surname": name.rsplit(' ').next().unwrap(),
        "mail": format!("user{n}@contoso.example"), "jobTitle": "Project officer", "department": "Finance",
        "companyName": "Contoso", "businessPhones": [phone], "mobilePhone": null
    })
}

fn microsoft(b: Arc<Behaviour>) -> Handler {
    Arc::new(move |r: &Req| {
        // ---- the token endpoint
        if r.method == "POST" && r.target.ends_with("/oauth2/v2.0/token") {
            if let Some((code, body)) = b.token_error.lock().unwrap().clone() {
                return status(code, body);
            }
            let f = r.form();
            b.users_seen_scopes
                .lock()
                .unwrap()
                .push(f.get("scope").cloned().unwrap_or_default());
            if f["client_id"] != CLIENT_ID {
                return status(400, json!({"error": "invalid_client"}));
            }
            match f["grant_type"].as_str() {
                "authorization_code" => {
                    let verifier_ok =
                        b.expected_challenge
                            .lock()
                            .unwrap()
                            .as_deref()
                            .is_some_and(|c| {
                                c == code_challenge(
                                    f.get("code_verifier").map_or("", String::as_str),
                                )
                            });
                    if f["code"] != "the-code"
                        || !verifier_ok
                        || f["redirect_uri"] != *b.expected_redirect.lock().unwrap()
                    {
                        return status(
                            400,
                            json!({"error": "invalid_grant", "error_description": "AADSTS70000: bad code or verifier"}),
                        );
                    }
                    *b.refresh.lock().unwrap() = "rt-1".into();
                }
                "refresh_token" => {
                    let mut current = b.refresh.lock().unwrap();
                    if f["refresh_token"] != *current {
                        return status(
                            400,
                            json!({"error": "invalid_grant", "error_description": "AADSTS70008: expired"}),
                        );
                    }
                    let n: u32 = current.trim_start_matches("rt-").parse().unwrap_or(1) + 1;
                    *current = format!("rt-{n}");
                }
                _ => return status(400, json!({"error": "unsupported_grant_type"})),
            }
            let mut serial = b.access_serial.lock().unwrap();
            *serial += 1;
            return ok(json!({
                "access_token": format!("at-{}", *serial),
                "refresh_token": b.refresh.lock().unwrap().clone(),
                "expires_in": 3600
            }));
        }

        // ---- Graph
        let serial = *b.access_serial.lock().unwrap();
        if r.headers.get("authorization").map(String::as_str)
            != Some(&format!("Bearer at-{serial}"))
        {
            return status(
                401,
                json!({"error": {"code": "InvalidAuthenticationToken"}}),
            );
        }
        {
            let mut once = b.expire_once.lock().unwrap();
            if *once {
                *once = false;
                return status(
                    401,
                    json!({"error": {"code": "InvalidAuthenticationToken"}}),
                );
            }
        }
        if let Some(wait) = *b.throttle.lock().unwrap() {
            return Resp {
                status: 429,
                headers: vec![("Retry-After", wait.to_string())],
                body: json!({"error": {"code": "TooManyRequests"}}),
            };
        }
        let base = "http://127.0.0.1"; // replaced below by the Host header
        let host = r.headers.get("host").cloned().unwrap_or_default();
        let origin = format!("http://{host}");
        let _ = base;
        let t = r.target.as_str();

        if t.starts_with("/v1.0/users/delta") {
            if t.contains("$deltatoken=expired") {
                return status(410, json!({"error": {"code": "syncStateNotFound"}}));
            }
            if t.contains("$deltatoken=d1") {
                return ok(json!({
                    "value": [
                        user(2, "Bob Martin-Durand", "+33 1 99 99 99 99"),
                        {"id": "00000000-0000-0000-0000-000000000003", "@removed": {"reason": "deleted"}}
                    ],
                    "@odata.deltaLink": format!("{origin}/v1.0/users/delta?$deltatoken=d2")
                }));
            }
            if t.contains("$skiptoken=p2") {
                return ok(json!({
                    "value": [user(3, "Chloé Bernard", "+33 1 33 33 33 33")],
                    "@odata.deltaLink": format!("{origin}/v1.0/users/delta?$deltatoken=d1")
                }));
            }
            let next = if *b.evil_next_link.lock().unwrap() {
                "http://127.0.0.2:9/steal?$skiptoken=p2".to_owned()
            } else {
                format!("{origin}/v1.0/users/delta?$skiptoken=p2")
            };
            return ok(json!({
                "value": [user(1, "Élodie Dupont", "+33 1 23 45 67 89"), user(2, "Bob Martin", "+33 1 22 22 22 22")],
                "@odata.nextLink": next
            }));
        }
        if t.starts_with("/v1.0/users?") {
            // the basic level: no telephone numbers in the answer
            let strip = |mut v: Value| {
                v.as_object_mut().unwrap().remove("businessPhones");
                v
            };
            if t.contains("$skiptoken=b2") {
                return ok(json!({"value": [strip(user(2, "Bob Martin", "x"))]}));
            }
            return ok(json!({
                "value": [strip(user(1, "Élodie Dupont", "x"))],
                "@odata.nextLink": format!("{origin}/v1.0/users?$skiptoken=b2")
            }));
        }
        if t.starts_with("/v1.0/me/contacts") {
            if r.headers.get("prefer").map(String::as_str) != Some("IdType=\"ImmutableId\"") {
                return status(400, json!({"error": {"code": "NoImmutableIds"}}));
            }
            if t.contains("$skiptoken=c2") {
                return ok(
                    json!({"value": [{"id": "AAMk-2", "displayName": "Dr Petit", "mobilePhone": "06 00 00 00 02"}]}),
                );
            }
            return ok(json!({
                "value": [{
                    "id": "AAMk-1", "displayName": "Cabinet Martin", "companyName": "Martin & Fils",
                    "emailAddresses": [{"address": "contact@martin.example"}],
                    "businessPhones": ["01 11 11 11 11"], "homePhones": ["01 22 22 22 22"]
                }],
                "@odata.nextLink": format!("{origin}/v1.0/me/contacts?$skiptoken=c2")
            }));
        }
        status(404, json!({"error": {"code": "NotFound"}}))
    })
}

struct Rig {
    fake: Fake,
    behaviour: Arc<Behaviour>,
    secrets: Arc<MemoryStore>,
}

async fn rig() -> Rig {
    let behaviour = Arc::new(Behaviour::default());
    *behaviour.refresh.lock().unwrap() = "rt-1".into();
    *behaviour.access_serial.lock().unwrap() = 0;
    let fake = Fake::start(microsoft(behaviour.clone())).await;
    let secrets = Arc::new(MemoryStore::default());
    secrets
        .set(
            &secret_key("src1", "refresh_token"),
            &SecretString::from("rt-1".to_owned()),
        )
        .unwrap();
    Rig {
        fake,
        behaviour,
        secrets,
    }
}

fn config(level: Level) -> MicrosoftConfig {
    MicrosoftConfig {
        client_id: CLIENT_ID.into(),
        tenant: "contoso.example".into(),
        level,
    }
}

impl Rig {
    fn connector(&self, kind: SourceKind, level: Level) -> MicrosoftConnector {
        MicrosoftConnector::new(
            kind,
            config(level),
            self.fake.endpoints(),
            self.secrets.clone(),
            "src1".into(),
            None,
        )
        .unwrap()
    }

    fn stored_refresh(&self) -> String {
        self.secrets
            .get(&secret_key("src1", "refresh_token"))
            .unwrap()
            .unwrap()
            .expose_secret()
            .to_owned()
    }
}

// ---------------------------------------------------------------- the sign-in

/// Plays the browser: comes back to the loopback address with what Microsoft would have sent.
async fn browser_returns(redirect_uri: &str, query: &str) {
    let url = format!("{redirect_uri}?{query}");
    let client = reqwest::Client::new();
    for _ in 0..50 {
        if client.get(&url).send().await.is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the loopback door is not open");
}

#[tokio::test]
async fn the_browser_sign_in_proves_the_exchange_with_pkce_and_keeps_only_the_refresh_token() {
    let r = rig().await;
    let auth = Authorization::begin(
        r.fake.endpoints(),
        SourceKind::MicrosoftOrg,
        config(Level::Full),
    )
    .await
    .unwrap();
    let url = reqwest::Url::parse(&auth.url).unwrap();
    let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
    *r.behaviour.expected_challenge.lock().unwrap() = Some(q["code_challenge"].clone());
    *r.behaviour.expected_redirect.lock().unwrap() = q["redirect_uri"].clone();
    let (redirect, state) = (q["redirect_uri"].clone(), q["state"].clone());

    let http = http_client(None).unwrap();
    let (_cancel_tx, cancel_rx) = oneshot::channel();
    let finish =
        tokio::spawn(async move { auth.finish(Duration::from_secs(10), cancel_rx, &http).await });

    // noise first: a favicon, a request that is not ours (wrong state), a forged answer
    browser_returns(&format!("{}favicon.ico", redirect), "").await;
    browser_returns(&redirect, "code=forged&state=not-our-state").await;
    // then the real answer
    browser_returns(&redirect, &format!("code=the-code&state={state}")).await;

    let token = finish.await.unwrap().expect("sign-in completes");
    assert_eq!(token.expose_secret(), "rt-1");
    // the exchange carried the code AND the verifier whose hash the sign-in address announced
    let exchange = r
        .fake
        .requests()
        .into_iter()
        .find(|q| q.method == "POST")
        .unwrap();
    let f = exchange.form();
    assert_eq!(f["grant_type"], "authorization_code");
    assert_eq!(f["scope"], "User.Read.All offline_access");
    assert!(
        !f.contains_key("client_secret"),
        "a public client sends no secret"
    );
}

#[tokio::test]
async fn a_code_without_the_matching_verifier_is_refused() {
    let r = rig().await;
    let auth = Authorization::begin(
        r.fake.endpoints(),
        SourceKind::MicrosoftOrg,
        config(Level::Full),
    )
    .await
    .unwrap();
    let q: HashMap<String, String> = reqwest::Url::parse(&auth.url)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect();
    // the service expects another challenge: whoever stole the code could not redeem it
    *r.behaviour.expected_challenge.lock().unwrap() = Some("someone-elses-challenge".into());
    *r.behaviour.expected_redirect.lock().unwrap() = q["redirect_uri"].clone();
    let (redirect, state) = (q["redirect_uri"].clone(), q["state"].clone());
    let http = http_client(None).unwrap();
    let (_tx, rx) = oneshot::channel();
    let finish = tokio::spawn(async move { auth.finish(Duration::from_secs(10), rx, &http).await });
    browser_returns(&redirect, &format!("code=the-code&state={state}")).await;
    let err = finish.await.unwrap().unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Auth, "{err}");
}

#[tokio::test]
async fn an_administrator_restriction_is_explained_and_a_refusal_is_not_an_error_to_retry() {
    let r = rig().await;
    for (query, kind, needle) in [
        (
            "error=access_denied&error_description=AADSTS65001%3A+admin+consent+required",
            SyncErrorKind::Forbidden,
            "administrator",
        ),
        (
            "error=access_denied&error_description=user+cancelled",
            SyncErrorKind::Auth,
            "refused access",
        ),
    ] {
        let auth = Authorization::begin(
            r.fake.endpoints(),
            SourceKind::MicrosoftOrg,
            config(Level::Full),
        )
        .await
        .unwrap();
        let q: HashMap<String, String> = reqwest::Url::parse(&auth.url)
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect();
        let (redirect, state) = (q["redirect_uri"].clone(), q["state"].clone());
        let http = http_client(None).unwrap();
        let (_tx, rx) = oneshot::channel();
        let finish =
            tokio::spawn(async move { auth.finish(Duration::from_secs(10), rx, &http).await });
        browser_returns(&redirect, &format!("{query}&state={state}")).await;
        let err = finish.await.unwrap().unwrap_err();
        assert_eq!(err.kind, kind, "{err}");
        assert!(err.message.contains(needle), "{err}");
    }
}

#[tokio::test]
async fn the_sign_in_can_be_cancelled_and_does_not_wait_forever() {
    let r = rig().await;
    let begin = || async {
        Authorization::begin(
            r.fake.endpoints(),
            SourceKind::MicrosoftOrg,
            config(Level::Full),
        )
        .await
        .unwrap()
    };
    let http = http_client(None).unwrap();

    let (tx, rx) = oneshot::channel();
    let a = begin().await;
    let h = http.clone();
    let cancelled = tokio::spawn(async move { a.finish(Duration::from_secs(30), rx, &h).await });
    tx.send(()).unwrap();
    assert!(
        cancelled
            .await
            .unwrap()
            .unwrap_err()
            .message
            .contains("cancelled")
    );

    let (_tx, rx) = oneshot::channel();
    let started = std::time::Instant::now();
    let err = begin()
        .await
        .finish(Duration::from_millis(200), rx, &http)
        .await
        .unwrap_err();
    assert!(err.message.contains("in time"), "{err}");
    assert!(started.elapsed() < Duration::from_secs(5));
}

// ---------------------------------------------------------------- Graph

#[tokio::test]
async fn the_organisation_directory_is_read_page_by_page_then_by_delta() {
    let r = rig().await;
    let c = r.connector(SourceKind::MicrosoftOrg, Level::Full);

    let first = c.fetch(None, &|_| {}).await.expect("first read");
    assert!(first.complete);
    assert_eq!(first.contacts.len(), 3, "two pages followed");
    assert!(first.cursor.as_deref().unwrap().ends_with("$deltatoken=d1"));
    let elodie = first
        .contacts
        .iter()
        .find(|c| c.display_name == "Élodie Dupont")
        .unwrap();
    assert_eq!(elodie.phones[0].number, "+33 1 23 45 67 89");
    assert_eq!(elodie.phones[0].kind, PhoneKind::Work);
    assert_eq!(elodie.email.as_deref(), Some("user1@contoso.example"));

    // every Graph request carried the bearer token and nothing went anywhere else
    assert!(
        r.fake
            .graph_requests()
            .iter()
            .all(|g| g.headers["authorization"].starts_with("Bearer at-"))
    );
    // the refresh asked for the permission of this source only
    assert!(
        r.behaviour
            .users_seen_scopes
            .lock()
            .unwrap()
            .iter()
            .all(|s| s == "User.Read.All offline_access")
    );
    // Microsoft rotated the refresh token: the new one replaced the old one in the credential store
    assert_eq!(r.stored_refresh(), "rt-2");

    // the next synchronisation asks only for what changed
    let delta = c
        .fetch(first.cursor.as_deref(), &|_| {})
        .await
        .expect("delta");
    assert!(!delta.complete);
    assert_eq!(delta.contacts.len(), 1);
    assert_eq!(delta.contacts[0].display_name, "Bob Martin-Durand");
    assert_eq!(
        delta.removed,
        vec!["00000000-0000-0000-0000-000000000003".to_owned()]
    );
    assert!(delta.cursor.as_deref().unwrap().ends_with("$deltatoken=d2"));
    assert_eq!(r.stored_refresh(), "rt-3");
}

#[tokio::test]
async fn an_expired_delta_link_starts_again_from_a_complete_read() {
    let r = rig().await;
    let c = r.connector(SourceKind::MicrosoftOrg, Level::Full);
    let stale = format!("{}/v1.0/users/delta?$deltatoken=expired", r.fake.base);
    let f = c.fetch(Some(&stale), &|_| {}).await.expect("falls back");
    assert!(f.complete, "a full read, so that what is gone is detected");
    assert_eq!(f.contacts.len(), 3);
    assert!(f.cursor.is_some());
}

#[tokio::test]
async fn the_basic_level_asks_for_less_and_reads_the_whole_directory_every_time() {
    let r = rig().await;
    let f = r
        .connector(SourceKind::MicrosoftOrg, Level::Basic)
        .fetch(None, &|_| {})
        .await
        .unwrap();
    assert!(f.complete && f.cursor.is_none());
    assert_eq!(f.contacts.len(), 2);
    assert!(
        f.contacts.iter().all(|c| c.phones.is_empty()),
        "no numbers at this level"
    );
    assert!(
        r.behaviour
            .users_seen_scopes
            .lock()
            .unwrap()
            .iter()
            .all(|s| s == "User.ReadBasic.All offline_access")
    );
    let q = &r.fake.graph_requests()[0].target;
    assert!(!q.contains("businessPhones"), "it does not even ask: {q}");
}

#[tokio::test]
async fn personal_outlook_contacts_are_a_separate_source_with_stable_ids() {
    let r = rig().await;
    let f = r
        .connector(SourceKind::MicrosoftPersonal, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap();
    assert!(f.complete && f.cursor.is_none());
    assert_eq!(f.contacts.len(), 2);
    let cabinet = &f.contacts[0];
    assert_eq!(cabinet.email.as_deref(), Some("contact@martin.example"));
    assert_eq!(cabinet.phones.len(), 2);
    // never the organisation's directory
    assert!(
        r.fake
            .graph_requests()
            .iter()
            .all(|g| g.target.starts_with("/v1.0/me/contacts"))
    );
    assert!(
        r.behaviour
            .users_seen_scopes
            .lock()
            .unwrap()
            .iter()
            .all(|s| s == "Contacts.Read offline_access")
    );
}

#[tokio::test]
async fn an_access_token_that_expires_during_a_read_is_renewed_once() {
    let r = rig().await;
    *r.behaviour.expire_once.lock().unwrap() = true;
    let f = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .expect("renewed");
    assert_eq!(f.contacts.len(), 3);
    assert_eq!(
        r.stored_refresh(),
        "rt-3",
        "two refreshes: the start, then the renewal"
    );
}

#[tokio::test]
async fn throttling_reports_how_long_to_wait() {
    let r = rig().await;
    *r.behaviour.throttle.lock().unwrap() = Some(120);
    let err = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Throttled);
    assert_eq!(err.retry_after, Some(Duration::from_secs(120)));

    // an absurd wait is capped at an hour
    *r.behaviour.throttle.lock().unwrap() = Some(999_999);
    let err = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.retry_after, Some(Duration::from_secs(3600)));
}

#[tokio::test]
async fn a_revoked_connection_asks_to_reconnect_and_a_missing_one_too() {
    let r = rig().await;
    r.secrets
        .set(
            &secret_key("src1", "refresh_token"),
            &SecretString::from("revoked".to_owned()),
        )
        .unwrap();
    let err = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Auth, "{err}");
    assert!(err.message.contains("reconnect"));

    r.secrets
        .delete(&secret_key("src1", "refresh_token"))
        .unwrap();
    let err = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Auth);
}

#[tokio::test]
async fn an_administrator_restriction_at_refresh_time_is_explained() {
    let r = rig().await;
    *r.behaviour.token_error.lock().unwrap() = Some((
        400,
        json!({"error": "invalid_grant", "error_description": "AADSTS90094: admin consent required"}),
    ));
    let err = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Forbidden);
    assert!(err.message.contains("administrator"));
}

#[tokio::test]
async fn the_access_token_is_never_sent_to_an_address_graph_did_not_give_for_itself() {
    let r = rig().await;
    *r.behaviour.evil_next_link.lock().unwrap() = true;
    let err = r
        .connector(SourceKind::MicrosoftOrg, Level::Full)
        .fetch(None, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(err.kind, SyncErrorKind::Invalid, "{err}");
    assert_eq!(
        r.fake.graph_requests().len(),
        1,
        "the second page was never requested"
    );
}

// ---------------------------------------------------------------- through the service

struct NoEvents;
impl DirectoryEvents for NoEvents {}

#[tokio::test]
async fn through_the_service_a_delta_removes_people_and_an_outage_keeps_everyone() {
    let r = rig().await;
    let db = Arc::new(Database::open_in_memory().unwrap());
    let svc = DirectoryService::new(
        db.clone(),
        r.secrets.clone(),
        Arc::new(NoEvents),
        Arc::new(RealConnectorFactory::with_microsoft_endpoints(
            db,
            r.fake.endpoints(),
        )),
    );
    let id = svc
        .add_source(
            SourceKind::MicrosoftOrg,
            "Contoso directory",
            &serde_json::to_value(config(Level::Full)).unwrap(),
            60,
            None,
        )
        .unwrap();
    // the sign-in stored the refresh token under the source's real id
    r.secrets
        .set(
            &secret_key(&id, "refresh_token"),
            &SecretString::from("rt-1".to_owned()),
        )
        .unwrap();

    let names = |text: &str| -> Vec<String> {
        svc.search(&DirectoryQuery {
            text: text.into(),
            ..Default::default()
        })
        .unwrap()
        .items
        .into_iter()
        .map(|e| e.display_name)
        .collect()
    };

    let report = svc.sync_now(&id, true).await.unwrap();
    assert_eq!((report.added, report.total), (3, 3));
    assert_eq!(names("elodie"), vec!["Élodie Dupont"]);
    assert_eq!(names("chloe"), vec!["Chloé Bernard"]);
    let cursor = svc
        .store()
        .get_source(&id)
        .unwrap()
        .unwrap()
        .cursor
        .unwrap();
    assert!(cursor.ends_with("$deltatoken=d1"));

    // the stand-in goes quiet: an outage. Nobody disappears.
    *r.behaviour.throttle.lock().unwrap() = Some(60);
    assert!(svc.sync_now(&id, true).await.is_err());
    assert_eq!(names("").len(), 3);
    assert_eq!(svc.source(&id).unwrap().state, SourceState::Error);
    *r.behaviour.throttle.lock().unwrap() = None;

    // the delta: one person renamed, one left
    let report = svc.sync_now(&id, true).await.unwrap();
    assert_eq!((report.updated, report.removed, report.total), (1, 1, 2));
    assert_eq!(names("martin-durand"), vec!["Bob Martin-Durand"]);
    assert!(
        names("chloe").is_empty(),
        "who left the directory is gone after a successful synchronisation"
    );
    assert_eq!(svc.source(&id).unwrap().state, SourceState::Idle);
    assert!(
        svc.store()
            .get_source(&id)
            .unwrap()
            .unwrap()
            .cursor
            .unwrap()
            .ends_with("$deltatoken=d2")
    );

    // a revoked connection asks the user to sign in again, and is not retried by the schedule
    r.secrets
        .set(
            &secret_key(&id, "refresh_token"),
            &SecretString::from("revoked".to_owned()),
        )
        .unwrap();
    assert!(svc.sync_now(&id, true).await.is_err());
    assert_eq!(svc.source(&id).unwrap().state, SourceState::NeedsReauth);
    assert_eq!(names("").len(), 2, "still there");
    assert!(
        svc.tick(chrono::Utc::now() + chrono::Duration::days(2))
            .is_empty()
    );
}

#[test]
fn the_stand_in_only_exists_in_tests() {
    // the production endpoints are Microsoft's, over HTTPS
    let e = Endpoints::default();
    assert!(e.authority.starts_with("https://login.microsoftonline.com"));
    assert!(e.graph.starts_with("https://graph.microsoft.com"));
    // and a sign-in address cannot be made against an unencrypted remote host
    let bad = Endpoints {
        authority: "http://login.evil.example".into(),
        graph: e.graph,
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    assert!(
        rt.block_on(Authorization::begin(
            bad,
            SourceKind::MicrosoftOrg,
            config(Level::Full)
        ))
        .is_err()
    );
    let _ = Sha256::digest(b"");
}
