//! The Microsoft 365 connector: reads people through Microsoft Graph, after the user signed in with the official
//! OAuth 2.0 authorization-code flow with PKCE (RFC 7636) in their own browser.
//!
//! Two different sources, never interchangeable:
//!  * [`SourceKind::MicrosoftOrg`] — the users of the ORGANISATION's directory (Microsoft Entra ID, `/users`),
//!    shared by everybody in the company;
//!  * [`SourceKind::MicrosoftPersonal`] — the signed-in user's OWN Outlook contacts (`/me/contacts`), private.
//!
//! What it never does: it holds no client secret (the app is a public client, PKCE proves the exchange), it never
//! sends the access token anywhere but Microsoft Graph, and it keeps only the refresh token, in the system
//! credential store.

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, StatusCode, Url};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
};

use super::{
    model::{PhoneEntry, PhoneKind, RemoteContact, SourceKind, SyncErrorKind},
    sync::{Connector, Fetched, SyncError, secret_key},
};
use crate::security::secrets::SecretStore;

pub const AUTHORITY: &str = "https://login.microsoftonline.com";
pub const GRAPH: &str = "https://graph.microsoft.com/v1.0";

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
/// How long the browser sign-in may take.
pub const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(180);
/// A source that keeps linking to more pages than this is broken, not big.
const MAX_PAGES: usize = 5_000;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(3600);

/// Where Microsoft's services are. Only tests point elsewhere, and then only to the loopback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub authority: String,
    pub graph: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            authority: AUTHORITY.into(),
            graph: GRAPH.into(),
        }
    }
}

/// What the directory of an organisation tells about its people.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// `User.ReadBasic.All`: name and e-mail only — no telephone numbers. No administrator consent needed.
    Basic,
    /// `User.Read.All`: telephone numbers, job title, department, company; with a delta query. An administrator
    /// has to consent for the whole organisation.
    #[default]
    Full,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MicrosoftConfig {
    /// Application (client) ID of the app registration the organisation (or the user) created. Not a secret.
    pub client_id: String,
    /// `organizations`, `common`, a tenant id or a tenant domain.
    pub tenant: String,
    /// Only for the organisation's directory.
    pub level: Level,
}

impl Default for MicrosoftConfig {
    fn default() -> Self {
        Self {
            client_id: String::new(),
            tenant: "organizations".into(),
            level: Level::Full,
        }
    }
}

impl MicrosoftConfig {
    pub fn validate(&self, kind: SourceKind) -> Result<(), String> {
        if !matches!(
            kind,
            SourceKind::MicrosoftOrg | SourceKind::MicrosoftPersonal
        ) {
            return Err("Ce n'est pas une source Microsoft".into());
        }
        if uuid::Uuid::parse_str(self.client_id.trim()).is_err() {
            return Err(
                "L'identifiant d'application (client ID) doit être un GUID, par exemple 00000000-0000-0000-0000-000000000000".into(),
            );
        }
        let t = self.tenant.trim();
        let named = matches!(t, "common" | "organizations" | "consumers");
        let id_or_domain = !t.is_empty()
            && t.len() <= 100
            && t.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
        if !named && !id_or_domain {
            return Err("Le tenant doit être « organizations », « common », un identifiant de tenant ou un domaine".into());
        }
        if kind == SourceKind::MicrosoftOrg && t == "consumers" {
            return Err("Les comptes personnels n'ont pas d'annuaire d'organisation".into());
        }
        Ok(())
    }

    /// The permissions asked for, and nothing more.
    pub fn scopes(&self, kind: SourceKind) -> &'static str {
        match (kind, self.level) {
            (SourceKind::MicrosoftPersonal, _) => "Contacts.Read offline_access",
            (_, Level::Basic) => "User.ReadBasic.All offline_access",
            (_, Level::Full) => "User.Read.All offline_access",
        }
    }
}

// ---------------------------------------------------------------- helpers

fn err(kind: SyncErrorKind, msg: &str) -> SyncError {
    SyncError::new(kind, msg)
}

/// Only HTTPS, except to the loopback (tests): tokens never travel in the clear.
fn require_secure(url: &str) -> Result<Url, SyncError> {
    let u =
        Url::parse(url).map_err(|_| err(SyncErrorKind::Config, "Adresse de service invalide."))?;
    let local = matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if u.scheme() == "https" || (u.scheme() == "http" && local) {
        Ok(u)
    } else {
        Err(err(
            SyncErrorKind::Config,
            "Les échanges avec Microsoft doivent être chiffrés (HTTPS).",
        ))
    }
}

/// `application/x-www-form-urlencoded`, built by hand (reqwest's form support is an optional feature).
fn form_body(pairs: &[(&str, &str)]) -> String {
    let mut u = Url::parse("http://x/").expect("a constant URL");
    u.query_pairs_mut().extend_pairs(pairs.iter().copied());
    u.query().unwrap_or_default().to_owned()
}

/// `base64url(sha256(verifier))`, the S256 code challenge of RFC 7636.
pub fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// `n` bytes from the operating system's random source, as URL-safe text.
pub fn random_token(n: usize) -> String {
    let mut bytes = Vec::with_capacity(n + 16);
    while bytes.len() < n {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes()); // v4: 122 random bits from the OS
    }
    bytes.truncate(n);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn http_client(ca_pem: Option<&[u8]>) -> Result<Client, SyncError> {
    let mut b = Client::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("ZePhone/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none()); // a redirect could carry the token elsewhere
    if let Some(pem) = ca_pem {
        let cert = reqwest::Certificate::from_pem(pem).map_err(|_| {
            err(
                SyncErrorKind::Config,
                "Le fichier de l'autorité de certification (Paramètres → Réseau) n'est pas un certificat PEM valide.",
            )
        })?;
        b = b.add_root_certificate(cert);
    }
    b.build().map_err(|_| {
        err(
            SyncErrorKind::Config,
            "Connexion sécurisée impossible à préparer.",
        )
    })
}

fn network_error(e: &reqwest::Error) -> SyncError {
    if e.is_timeout() {
        err(
            SyncErrorKind::Network,
            "Microsoft ne répond pas (délai dépassé).",
        )
    } else if e.is_connect() {
        err(
            SyncErrorKind::Network,
            "Impossible de joindre Microsoft : vérifiez votre connexion, ou le certificat de votre proxy d'entreprise (Paramètres → Réseau).",
        )
    } else {
        err(
            SyncErrorKind::Network,
            "La connexion avec Microsoft a échoué.",
        )
    }
}

// ---------------------------------------------------------------- tokens

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

/// Turns what the token endpoint said into something the user can act on. The messages carry nothing but our own
/// words: no token, no account, no tenant.
pub fn token_error(status: StatusCode, body: &Value) -> SyncError {
    let code = body.get("error").and_then(Value::as_str).unwrap_or("");
    let description = body
        .get("error_description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let aadsts = |n: &str| description.contains(&format!("AADSTS{n}"));
    if aadsts("65001")
        || aadsts("90094")
        || aadsts("90008")
        || aadsts("650057")
        || code == "consent_required"
    {
        return err(
            SyncErrorKind::Forbidden,
            "L'administrateur de votre organisation doit autoriser l'application à lire l'annuaire (consentement administrateur). \
             Transmettez-lui la liste des autorisations demandées, puis reconnectez la source.",
        );
    }
    if aadsts("700016")
        || aadsts("7000218")
        || aadsts("700025")
        || code == "invalid_client"
        || code == "unauthorized_client"
    {
        return err(
            SyncErrorKind::Config,
            "L'application n'est pas reconnue : vérifiez l'identifiant d'application (client ID) et le tenant, et que l'inscription autorise les clients publics.",
        );
    }
    if aadsts("53003") || aadsts("53000") || aadsts("53001") {
        return err(
            SyncErrorKind::Forbidden,
            "Une règle d'accès conditionnel de votre organisation bloque cette connexion.",
        );
    }
    if code == "invalid_grant"
        || code == "interaction_required"
        || aadsts("50076")
        || aadsts("50079")
        || aadsts("70008")
    {
        return err(
            SyncErrorKind::Auth,
            "La connexion Microsoft a expiré ou a été révoquée : reconnectez la source.",
        );
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return err(
            SyncErrorKind::Throttled,
            "Microsoft demande de patienter avant la prochaine tentative.",
        );
    }
    if status.is_server_error() {
        return err(
            SyncErrorKind::Server,
            "Le service d'authentification Microsoft est indisponible.",
        );
    }
    err(
        SyncErrorKind::Auth,
        "Microsoft a refusé la connexion : reconnectez la source.",
    )
}

fn retry_after(resp: &reqwest::Response) -> Option<Duration> {
    resp.headers()
        .get("retry-after")?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(|s| Duration::from_secs(s.max(1)).min(MAX_RETRY_AFTER))
}

async fn post_token(
    http: &Client,
    endpoints: &Endpoints,
    tenant: &str,
    pairs: &[(&str, &str)],
) -> Result<TokenResponse, SyncError> {
    let url = require_secure(&format!(
        "{}/{}/oauth2/v2.0/token",
        endpoints.authority,
        tenant.trim()
    ))?;
    let resp = http
        .post(url)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form_body(pairs))
        .send()
        .await
        .map_err(|e| network_error(&e))?;
    let status = resp.status();
    let wait = retry_after(&resp);
    let json: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let mut e = token_error(status, &json);
        e.retry_after = wait;
        return Err(e);
    }
    serde_json::from_value(json).map_err(|_| {
        err(
            SyncErrorKind::Invalid,
            "Réponse d'authentification Microsoft illisible.",
        )
    })
}

// ---------------------------------------------------------------- the sign-in (browser, loopback)

/// A sign-in in progress: the address to open in the browser, and the local door Microsoft sends the user back to.
pub struct Authorization {
    /// Open this in the user's browser.
    pub url: String,
    listener: TcpListener,
    state: String,
    verifier: String,
    redirect_uri: String,
    config: MicrosoftConfig,
    kind: SourceKind,
    endpoints: Endpoints,
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>ZePhone</title>\
<body style=\"font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem\">\
<h2>Connexion terminée</h2><p>Vous pouvez fermer cet onglet et revenir à ZePhone.</p></body>";
const FAILED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>ZePhone</title>\
<body style=\"font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem\">\
<h2>Connexion non aboutie</h2><p>Revenez à ZePhone pour voir ce qu'il faut faire.</p></body>";

async fn respond(sock: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let msg = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(msg.as_bytes()).await;
    let _ = sock.shutdown().await;
}

/// The result of the browser step: the code Microsoft gave, or what went wrong.
enum Redirect {
    Code(String),
    Failed(SyncError),
}

impl Authorization {
    /// Prepares a sign-in: a loopback listener on a free port, and the address that starts it.
    pub async fn begin(
        endpoints: Endpoints,
        kind: SourceKind,
        config: MicrosoftConfig,
    ) -> Result<Self, SyncError> {
        config
            .validate(kind)
            .map_err(|m| err(SyncErrorKind::Config, &m))?;
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| {
            err(
                SyncErrorKind::Config,
                "Impossible d'ouvrir le port local nécessaire à la connexion.",
            )
        })?;
        let port = listener
            .local_addr()
            .map_err(|_| err(SyncErrorKind::Config, "Port local indisponible."))?
            .port();
        let redirect_uri = format!("http://localhost:{port}/");
        let verifier = random_token(48);
        let state = random_token(24);
        let mut url = require_secure(&format!(
            "{}/{}/oauth2/v2.0/authorize",
            endpoints.authority,
            config.tenant.trim()
        ))?;
        url.query_pairs_mut()
            .append_pair("client_id", config.client_id.trim())
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_mode", "query")
            .append_pair("scope", config.scopes(kind))
            .append_pair("state", &state)
            .append_pair("code_challenge", &code_challenge(&verifier))
            .append_pair("code_challenge_method", "S256")
            .append_pair("prompt", "select_account");
        Ok(Self {
            url: url.into(),
            listener,
            state,
            verifier,
            redirect_uri,
            config,
            kind,
            endpoints,
        })
    }

    /// Waits for the browser to come back, checks it is the sign-in we started, and trades the code for tokens.
    /// Returns the refresh token: the only thing kept.
    pub async fn finish(
        self,
        wait: Duration,
        cancel: oneshot::Receiver<()>,
        http: &Client,
    ) -> Result<SecretString, SyncError> {
        let redirect = tokio::select! {
            r = self.wait_for_redirect() => r,
            _ = cancel => return Err(err(SyncErrorKind::Auth, "Connexion annulée.")),
            () = tokio::time::sleep(wait) => {
                return Err(err(SyncErrorKind::Auth, "La connexion n'a pas abouti à temps. Réessayez."));
            }
        };
        let code = match redirect {
            Redirect::Code(c) => c,
            Redirect::Failed(e) => return Err(e),
        };
        let token = post_token(
            http,
            &self.endpoints,
            &self.config.tenant,
            &[
                ("client_id", self.config.client_id.trim()),
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("redirect_uri", &self.redirect_uri),
                ("code_verifier", &self.verifier),
                ("scope", self.config.scopes(self.kind)),
            ],
        )
        .await?;
        match token.refresh_token.filter(|t| !t.is_empty()) {
            Some(t) => Ok(SecretString::from(t)),
            None => Err(err(
                SyncErrorKind::Forbidden,
                "Microsoft n'a pas accordé l'accès permanent (offline_access) : vérifiez les autorisations de l'application.",
            )),
        }
    }

    async fn wait_for_redirect(&self) -> Redirect {
        loop {
            let Ok((mut sock, _)) = self.listener.accept().await else {
                return Redirect::Failed(err(
                    SyncErrorKind::Network,
                    "Le port local de connexion a été fermé.",
                ));
            };
            let mut buf = vec![0u8; 8192];
            let n = match tokio::time::timeout(Duration::from_secs(5), sock.read(&mut buf)).await {
                Ok(Ok(n)) => n,
                _ => continue,
            };
            let request = String::from_utf8_lossy(&buf[..n]);
            let target = request
                .lines()
                .next()
                .and_then(|l| l.strip_prefix("GET "))
                .and_then(|l| l.split(' ').next())
                .unwrap_or("");
            let Ok(url) = Url::parse(&format!("http://localhost{target}")) else {
                respond(&mut sock, "400 Bad Request", FAILED_PAGE).await;
                continue;
            };
            if url.path() != "/" {
                respond(&mut sock, "404 Not Found", "").await; // a favicon, a probe
                continue;
            }
            let param = |k: &str| {
                url.query_pairs()
                    .find(|(n, _)| n == k)
                    .map(|(_, v)| v.into_owned())
            };
            // Anything that does not carry OUR state is not the answer to our sign-in: ignored.
            if param("state").as_deref() != Some(self.state.as_str()) {
                respond(&mut sock, "400 Bad Request", FAILED_PAGE).await;
                continue;
            }
            if let Some(code) = param("code").filter(|c| !c.is_empty()) {
                respond(&mut sock, "200 OK", DONE_PAGE).await;
                return Redirect::Code(code);
            }
            respond(&mut sock, "200 OK", FAILED_PAGE).await;
            let body = serde_json::json!({
                "error": param("error").unwrap_or_default(),
                "error_description": param("error_description").unwrap_or_default(),
            });
            return Redirect::Failed(
                if param("error").as_deref() == Some("access_denied")
                    && !body["error_description"]
                        .as_str()
                        .unwrap_or("")
                        .contains("AADSTS")
                {
                    err(
                        SyncErrorKind::Auth,
                        "Vous avez refusé l'accès, ou la connexion a été annulée.",
                    )
                } else {
                    token_error(StatusCode::BAD_REQUEST, &body)
                },
            );
        }
    }
}

/// Opens an address in the user's default browser. Only HTTPS addresses (the sign-in page of Microsoft), or the
/// loopback in tests.
pub fn open_in_browser(url: &str) -> std::io::Result<()> {
    require_secure(url).map_err(|e| std::io::Error::other(e.message))?;
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

// ---------------------------------------------------------------- Graph

enum Fail {
    /// 410: the delta link is no longer valid.
    Gone,
    Error(SyncError),
}

impl From<SyncError> for Fail {
    fn from(e: SyncError) -> Self {
        Self::Error(e)
    }
}

pub struct MicrosoftConnector {
    kind: SourceKind,
    config: MicrosoftConfig,
    endpoints: Endpoints,
    secrets: Arc<dyn SecretStore>,
    source_id: String,
    http: Client,
}

impl MicrosoftConnector {
    pub fn new(
        kind: SourceKind,
        config: MicrosoftConfig,
        endpoints: Endpoints,
        secrets: Arc<dyn SecretStore>,
        source_id: String,
        ca_pem: Option<&[u8]>,
    ) -> Result<Self, SyncError> {
        config
            .validate(kind)
            .map_err(|m| err(SyncErrorKind::Config, &m))?;
        Ok(Self {
            kind,
            config,
            endpoints,
            secrets,
            source_id,
            http: http_client(ca_pem)?,
        })
    }

    /// Trades the refresh token for an access token. Microsoft may send a new refresh token: it replaces the old
    /// one in the credential store.
    async fn access_token(&self) -> Result<String, SyncError> {
        let key = secret_key(&self.source_id, "refresh_token");
        let refresh = self
            .secrets
            .get(&key)
            .map_err(|_| err(SyncErrorKind::Config, "Le trousseau est inaccessible."))?
            .ok_or_else(|| {
                err(
                    SyncErrorKind::Auth,
                    "Cette source n'est plus connectée : reconnectez-la.",
                )
            })?;
        let token = post_token(
            &self.http,
            &self.endpoints,
            &self.config.tenant,
            &[
                ("client_id", self.config.client_id.trim()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh.expose_secret()),
                ("scope", self.config.scopes(self.kind)),
            ],
        )
        .await?;
        if let Some(new) = token
            .refresh_token
            .filter(|t| !t.is_empty() && t != refresh.expose_secret())
        {
            let _ = self.secrets.set(&key, &SecretString::from(new));
        }
        token.access_token.filter(|t| !t.is_empty()).ok_or_else(|| {
            err(
                SyncErrorKind::Invalid,
                "Microsoft n'a pas renvoyé de jeton d'accès.",
            )
        })
    }

    /// One GET on Graph. The token only goes to the Graph address: a `nextLink` pointing anywhere else is refused.
    async fn get(&self, url: &str, token: &str) -> Result<Value, Fail> {
        let allowed = require_secure(&self.endpoints.graph)?;
        let target = Url::parse(url).map_err(|_| {
            err(
                SyncErrorKind::Invalid,
                "Microsoft a renvoyé une adresse illisible.",
            )
        })?;
        // The origin first: a link to another host is a security problem whatever its scheme.
        if target.origin() != allowed.origin() {
            return Err(err(
                SyncErrorKind::Invalid,
                "Microsoft a renvoyé une adresse inattendue : synchronisation interrompue par sécurité.",
            )
            .into());
        }
        require_secure(target.as_str())?;
        let mut req = self
            .http
            .get(target)
            .bearer_auth(token)
            .header("accept", "application/json");
        // Outlook contact ids that do not change when a contact is moved between folders.
        req = req.header("prefer", "IdType=\"ImmutableId\"");
        let resp = req.send().await.map_err(|e| network_error(&e))?;
        let status = resp.status();
        let wait = retry_after(&resp);
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        let graph_code = body["error"]["code"].as_str().unwrap_or("");
        match status {
            s if s.is_success() => Ok(body),
            StatusCode::GONE => Err(Fail::Gone),
            StatusCode::UNAUTHORIZED => Err(err(
                SyncErrorKind::Auth,
                "Microsoft a refusé l'accès : reconnectez la source.",
            )
            .into()),
            StatusCode::FORBIDDEN => Err(err(
                SyncErrorKind::Forbidden,
                "Ce compte n'a pas l'autorisation de lire ces contacts. Votre administrateur doit accorder l'autorisation demandée à l'application, puis reconnectez la source.",
            )
            .into()),
            StatusCode::NOT_FOUND if graph_code.contains("MailboxNotEnabled") || graph_code == "ErrorItemNotFound" || self.kind == SourceKind::MicrosoftPersonal => {
                Err(err(
                    SyncErrorKind::Forbidden,
                    "Ce compte n'a pas de boîte aux lettres Outlook : il n'a pas de contacts personnels à lire.",
                )
                .into())
            }
            StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE => {
                let mut e = err(SyncErrorKind::Throttled, "Microsoft demande de patienter : nouvelle tentative plus tard.");
                e.retry_after = wait.or(Some(Duration::from_secs(60)));
                Err(e.into())
            }
            s if s.is_server_error() => Err(err(SyncErrorKind::Server, "Le service Microsoft est indisponible.").into()),
            _ => Err(err(SyncErrorKind::Invalid, "Microsoft a refusé la requête.").into()),
        }
    }

    /// Follows `@odata.nextLink` to the end. Calls `each` with every page. Returns the delta link, if there is one.
    async fn read_pages(
        &self,
        first: String,
        token: &mut String,
        mut each: impl FnMut(&[Value]),
    ) -> Result<Option<String>, Fail> {
        let mut url = first;
        for _ in 0..MAX_PAGES {
            let page = match self.get(&url, token).await {
                // The access token may have expired during a long read: renew it once.
                Err(Fail::Error(e)) if e.kind == SyncErrorKind::Auth => {
                    *token = self.access_token().await?;
                    self.get(&url, token).await?
                }
                other => other?,
            };
            if let Some(items) = page["value"].as_array() {
                each(items);
            }
            if let Some(next) = page["@odata.nextLink"].as_str() {
                url = next.to_owned();
                continue;
            }
            return Ok(page["@odata.deltaLink"].as_str().map(str::to_owned));
        }
        Err(err(
            SyncErrorKind::Invalid,
            "Microsoft renvoie trop de pages : synchronisation interrompue.",
        )
        .into())
    }

    fn users_url(&self) -> String {
        let select = match self.config.level {
            Level::Basic => "id,displayName,givenName,surname,mail",
            Level::Full => {
                "id,displayName,givenName,surname,mail,jobTitle,department,companyName,businessPhones,mobilePhone"
            }
        };
        format!("{}/users?$select={select}&$top=999", self.endpoints.graph)
    }

    fn users_delta_url(&self) -> String {
        format!(
            "{}/users/delta?$select=id,displayName,givenName,surname,mail,jobTitle,department,companyName,businessPhones,mobilePhone",
            self.endpoints.graph
        )
    }

    fn contacts_url(&self) -> String {
        format!(
            "{}/me/contacts?$select=id,displayName,givenName,surname,companyName,department,jobTitle,emailAddresses,businessPhones,mobilePhone,homePhones&$top=100",
            self.endpoints.graph
        )
    }

    async fn fetch_inner(&self, cursor: Option<&str>) -> Result<Fetched, SyncError> {
        let mut token = self.access_token().await?;
        let is_org = self.kind == SourceKind::MicrosoftOrg;
        let delta = is_org && self.config.level == Level::Full;

        let first = if delta {
            cursor.map_or_else(|| self.users_delta_url(), str::to_owned)
        } else if is_org {
            self.users_url()
        } else {
            self.contacts_url()
        };

        let mut upserts = Vec::new();
        let mut removed = Vec::new();
        let kind = self.kind;
        let collect = |items: &[Value]| {
            for item in items {
                if item.get("@removed").is_some() {
                    if let Some(id) = item["id"].as_str() {
                        removed.push(id.to_owned());
                    }
                } else if let Some(c) = map_item(item, kind) {
                    upserts.push(c);
                }
            }
        };

        let continuing = delta && cursor.is_some();
        let result = self.read_pages(first, &mut token, collect).await;
        match result {
            Ok(link) => Ok(Fetched {
                contacts: upserts,
                removed,
                complete: !continuing,
                cursor: if delta { link } else { None },
            }),
            // The delta link expired: start again from a complete read.
            Err(Fail::Gone) if continuing => Box::pin(self.fetch_inner(None)).await,
            Err(Fail::Gone) => Err(err(
                SyncErrorKind::Server,
                "Microsoft a invalidé la synchronisation : réessayez.",
            )),
            Err(Fail::Error(e)) => Err(e),
        }
    }
}

#[async_trait]
impl Connector for MicrosoftConnector {
    async fn fetch(
        &self,
        cursor: Option<&str>,
        progress: &(dyn Fn(usize) + Send + Sync),
    ) -> Result<Fetched, SyncError> {
        let fetched = self.fetch_inner(cursor).await?;
        progress(fetched.contacts.len());
        Ok(fetched)
    }
}

// ---------------------------------------------------------------- mapping

fn text(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn push_phone(phones: &mut Vec<PhoneEntry>, kind: PhoneKind, number: Option<&str>) {
    let Some(n) = number.map(str::trim).filter(|n| !n.is_empty()) else {
        return;
    };
    if !phones.iter().any(|p| p.number == n) {
        phones.push(PhoneEntry::new(kind, n));
    }
}

/// A Graph user or contact as a contact. Numbers are kept exactly as Microsoft has them.
pub fn map_item(v: &Value, kind: SourceKind) -> Option<RemoteContact> {
    let external_id = text(v, "id")?;
    let mut phones = Vec::new();
    for n in v["businessPhones"].as_array().into_iter().flatten() {
        push_phone(&mut phones, PhoneKind::Work, n.as_str());
    }
    push_phone(&mut phones, PhoneKind::Mobile, v["mobilePhone"].as_str());
    for n in v["homePhones"].as_array().into_iter().flatten() {
        push_phone(&mut phones, PhoneKind::Home, n.as_str());
    }
    let email = match kind {
        SourceKind::MicrosoftPersonal => v["emailAddresses"]
            .as_array()
            .into_iter()
            .flatten()
            .find_map(|e| text(e, "address")),
        _ => text(v, "mail"),
    };
    Some(RemoteContact {
        external_id,
        first_name: text(v, "givenName").unwrap_or_default(),
        last_name: text(v, "surname").unwrap_or_default(),
        display_name: text(v, "displayName").unwrap_or_default(),
        company: text(v, "companyName"),
        department: text(v, "department"),
        title: text(v, "jobTitle"),
        email,
        phones,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config() -> MicrosoftConfig {
        MicrosoftConfig {
            client_id: "11111111-2222-3333-4444-555555555555".into(),
            tenant: "organizations".into(),
            level: Level::Full,
        }
    }

    #[test]
    fn the_s256_challenge_matches_the_rfc_7636_example() {
        // RFC 7636, appendix B
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn random_tokens_are_long_unique_and_url_safe() {
        let a = random_token(48);
        let b = random_token(48);
        assert_ne!(a, b);
        assert!(a.len() >= 64, "{}", a.len());
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
    }

    #[test]
    fn the_configuration_is_checked_and_holds_no_secret() {
        assert!(config().validate(SourceKind::MicrosoftOrg).is_ok());
        assert!(config().validate(SourceKind::MicrosoftPersonal).is_ok());
        assert!(config().validate(SourceKind::Ldap).is_err());
        let mut c = config();
        c.client_id = "not-a-guid".into();
        assert!(c.validate(SourceKind::MicrosoftOrg).is_err());
        let mut c = config();
        c.tenant = "evil.com/../x".into();
        assert!(c.validate(SourceKind::MicrosoftOrg).is_err());
        c.tenant = "contoso.onmicrosoft.com".into();
        assert!(c.validate(SourceKind::MicrosoftOrg).is_ok());
        c.tenant = "consumers".into();
        assert!(
            c.validate(SourceKind::MicrosoftOrg).is_err(),
            "no organisation directory for personal accounts"
        );
        assert!(c.validate(SourceKind::MicrosoftPersonal).is_ok());
        let json = serde_json::to_string(&config()).unwrap().to_lowercase();
        assert!(!json.contains("secret") && !json.contains("token"));
    }

    #[test]
    fn each_source_asks_for_the_least_permission_that_does_the_job() {
        let mut c = config();
        assert_eq!(
            c.scopes(SourceKind::MicrosoftOrg),
            "User.Read.All offline_access"
        );
        c.level = Level::Basic;
        assert_eq!(
            c.scopes(SourceKind::MicrosoftOrg),
            "User.ReadBasic.All offline_access"
        );
        assert_eq!(
            c.scopes(SourceKind::MicrosoftPersonal),
            "Contacts.Read offline_access"
        );
    }

    #[test]
    fn nothing_travels_unencrypted_except_to_the_loopback() {
        assert!(require_secure("https://graph.microsoft.com/v1.0/users").is_ok());
        assert!(require_secure("http://127.0.0.1:8080/x").is_ok());
        assert!(require_secure("http://graph.microsoft.com/v1.0/users").is_err());
        assert!(require_secure("ftp://x").is_err());
        assert!(open_in_browser("http://evil.example.com/").is_err());
        assert!(open_in_browser("file:///etc/passwd").is_err());
    }

    #[test]
    fn form_bodies_are_encoded() {
        assert_eq!(
            form_body(&[("a", "b c"), ("d", "e&f=g")]),
            "a=b+c&d=e%26f%3Dg"
        );
    }

    #[test]
    fn token_errors_say_what_to_do_without_repeating_anything_private() {
        let e = |code: &str, desc: &str| {
            token_error(
                StatusCode::BAD_REQUEST,
                &json!({"error": code, "error_description": format!("{desc} Trace ID: abc, user alice@contoso.com")}),
            )
        };
        let admin = e(
            "invalid_grant",
            "AADSTS65001: The user or administrator has not consented",
        );
        assert_eq!(admin.kind, SyncErrorKind::Forbidden);
        assert!(admin.message.contains("administrateur"));
        assert_eq!(
            e(
                "invalid_grant",
                "AADSTS70008: The refresh token has expired"
            )
            .kind,
            SyncErrorKind::Auth
        );
        assert!(e("invalid_grant", "x").message.contains("reconnectez"));
        assert_eq!(
            e("invalid_client", "AADSTS700016: Application not found").kind,
            SyncErrorKind::Config
        );
        assert_eq!(
            e(
                "interaction_required",
                "AADSTS53003: Blocked by Conditional Access"
            )
            .kind,
            SyncErrorKind::Forbidden
        );
        assert_eq!(
            token_error(StatusCode::TOO_MANY_REQUESTS, &Value::Null).kind,
            SyncErrorKind::Throttled
        );
        assert_eq!(
            token_error(StatusCode::BAD_GATEWAY, &Value::Null).kind,
            SyncErrorKind::Server
        );
        for m in [&admin.message, &e("invalid_grant", "x").message] {
            assert!(!m.contains("alice") && !m.contains("Trace"), "{m}");
        }
    }

    #[test]
    fn an_organisation_user_becomes_a_contact_with_its_numbers_as_written() {
        let user = json!({
            "id": "00000000-aaaa-bbbb-cccc-000000000001",
            "displayName": "Élodie Dupont", "givenName": "Élodie", "surname": "Dupont",
            "mail": "elodie.dupont@contoso.com", "jobTitle": "Directrice", "department": "Finance",
            "companyName": "Contoso", "businessPhones": ["+33 1 23 45 67 89", " "], "mobilePhone": "+33 6 12 34 56 78"
        });
        let c = map_item(&user, SourceKind::MicrosoftOrg).unwrap();
        assert_eq!(c.external_id, "00000000-aaaa-bbbb-cccc-000000000001");
        assert_eq!(c.email.as_deref(), Some("elodie.dupont@contoso.com"));
        assert_eq!(c.department.as_deref(), Some("Finance"));
        let numbers: Vec<(PhoneKind, &str)> = c
            .phones
            .iter()
            .map(|p| (p.kind, p.number.as_str()))
            .collect();
        assert_eq!(
            numbers,
            vec![
                (PhoneKind::Work, "+33 1 23 45 67 89"),
                (PhoneKind::Mobile, "+33 6 12 34 56 78")
            ]
        );
    }

    #[test]
    fn an_outlook_contact_takes_its_address_from_the_list_of_addresses() {
        let contact = json!({
            "id": "AAMk-1", "displayName": "Cabinet Martin", "companyName": "Martin & Fils",
            "emailAddresses": [{"name": "x", "address": "contact@martin.example"}],
            "businessPhones": ["01 11 11 11 11"], "homePhones": ["01 22 22 22 22"]
        });
        let c = map_item(&contact, SourceKind::MicrosoftPersonal).unwrap();
        assert_eq!(c.email.as_deref(), Some("contact@martin.example"));
        assert_eq!(c.phones.len(), 2);
        assert_eq!(c.phones[1].kind, PhoneKind::Home);
        assert!(map_item(&json!({"displayName": "No id"}), SourceKind::MicrosoftOrg).is_none());
    }

    #[tokio::test]
    async fn the_sign_in_address_carries_pkce_and_no_secret() {
        let auth = Authorization::begin(Endpoints::default(), SourceKind::MicrosoftOrg, config())
            .await
            .unwrap();
        let url = Url::parse(&auth.url).unwrap();
        assert_eq!(url.host_str(), Some("login.microsoftonline.com"));
        assert_eq!(url.path(), "/organizations/oauth2/v2.0/authorize");
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], code_challenge(&auth.verifier));
        assert_eq!(q["scope"], "User.Read.All offline_access");
        assert_eq!(q["client_id"], "11111111-2222-3333-4444-555555555555");
        assert!(q["redirect_uri"].starts_with("http://localhost:"));
        assert!(q["state"].len() >= 24);
        assert!(!auth.url.contains("client_secret") && !auth.url.contains(&auth.verifier));
    }
}
