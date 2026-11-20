//! Optional diagnostics: crash reports (Sentry) and anonymous usage counts (Google Analytics).
//!
//! Both are **on by default and can be turned off** (`PrivacySettings`), but nothing is sent before the notice of
//! the first launch has been validated. Both are sent from here and never from the webview (whose content security policy stays closed), and everything is scrubbed first (`scrub`). Without the
//! build-time identifiers (`telemetry.env`, see `build.rs`) nothing is ever sent: development builds, tests and
//! forks are silent. `docs/PRIVACY.md` lists what is collected.

pub mod ga;
pub mod scrub;
pub mod sentry;

use crate::{database::Database, sip::types::PrivacySettings};
use async_trait::async_trait;
use regex::Regex;
use sentry::{Dsn, Frame, Origin, Report};
use std::{
    path::PathBuf,
    sync::{
        Arc, LazyLock, Mutex, OnceLock,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
};

const INSTALL_ID_KEY: &str = "telemetry.install_id";
/// Errors of the webview reported in one run: a loop must not flood Sentry.
const MAX_WEBVIEW_ERRORS: u32 = 20;

/// The identifiers baked into the build; `None` leaves the matching service off.
pub struct Config {
    pub dsn: Option<Dsn>,
    pub ga: Option<ga::Ga>,
    pub environment: String,
}

impl Config {
    pub fn from_build() -> Self {
        let set = |v: Option<&'static str>| v.map(str::trim).filter(|v| !v.is_empty());
        let ga = match (
            set(option_env!("ZEPHONE_GA_MEASUREMENT_ID")),
            set(option_env!("ZEPHONE_GA_API_SECRET")),
        ) {
            (Some(id), Some(secret)) => Some(ga::Ga {
                measurement_id: id.to_owned(),
                api_secret: secret.to_owned(),
            }),
            _ => None,
        };
        Self {
            dsn: set(option_env!("ZEPHONE_SENTRY_DSN")).and_then(Dsn::parse),
            ga,
            environment: if cfg!(debug_assertions) {
                "development"
            } else {
                "production"
            }
            .to_owned(),
        }
    }
}

#[async_trait]
pub trait Transport: Send + Sync {
    async fn post(
        &self,
        url: &str,
        content_type: &str,
        headers: &[(&str, String)],
        body: String,
    ) -> Result<(), String>;
}

pub struct HttpTransport(reqwest::Client);

impl HttpTransport {
    pub fn new() -> Self {
        Self(
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        )
    }
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn post(
        &self,
        url: &str,
        content_type: &str,
        headers: &[(&str, String)],
        body: String,
    ) -> Result<(), String> {
        let mut req = self.0.post(url).header("content-type", content_type);
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        let res = req.body(body).send().await.map_err(|e| e.to_string())?;
        if res.status().is_success() {
            Ok(())
        } else {
            Err(format!("HTTP {}", res.status()))
        }
    }
}

pub struct Telemetry {
    cfg: Config,
    transport: Arc<dyn Transport>,
    db: Arc<Database>,
    crash_dir: PathBuf,
    crash_reports: AtomicBool,
    usage_stats: AtomicBool,
    opened: AtomicBool,
    webview_errors: AtomicU32,
    /// Serializes the sending of the reports waiting on disk.
    sending: tokio::sync::Mutex<()>,
    id: Mutex<Option<String>>,
}

impl Telemetry {
    pub fn new(
        cfg: Config,
        transport: Arc<dyn Transport>,
        db: Arc<Database>,
        crash_dir: PathBuf,
    ) -> Arc<Self> {
        Arc::new(Self {
            cfg,
            transport,
            db,
            crash_dir,
            crash_reports: AtomicBool::new(false),
            usage_stats: AtomicBool::new(false),
            opened: AtomicBool::new(false),
            webview_errors: AtomicU32::new(0),
            sending: tokio::sync::Mutex::new(()),
            id: Mutex::new(None),
        })
    }

    /// The random identifier of this installation, created when first needed.
    fn install_id(&self) -> String {
        let mut cached = self.id.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(id) = cached.as_ref() {
            return id.clone();
        }
        let id = match self.db.get_setting_text(INSTALL_ID_KEY) {
            Ok(Some(id)) if !id.is_empty() => id,
            _ => {
                let id = uuid::Uuid::new_v4().to_string();
                let _ = self.db.set_setting_text(INSTALL_ID_KEY, &id);
                id
            }
        };
        *cached = Some(id.clone());
        id
    }

    /// Forgets this installation: the next reports carry a new random identifier.
    pub fn reset_install_id(&self) {
        let id = uuid::Uuid::new_v4().to_string();
        let _ = self.db.set_setting_text(INSTALL_ID_KEY, &id);
        *self.id.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
    }

    /// Applies the user's choices: at start, and every time they change.
    pub async fn apply(&self, p: &PrivacySettings) {
        // Nothing leaves before the user has seen the notice of the first launch.
        let crash = p.answered && p.crash_reports && self.cfg.dsn.is_some();
        self.crash_reports.store(crash, Ordering::SeqCst);
        CRASH_ARMED.store(crash, Ordering::SeqCst);
        self.usage_stats
            .store(p.answered && p.usage_stats && self.cfg.ga.is_some(), Ordering::SeqCst);
        if crash {
            self.send_pending().await;
        } else if p.answered {
            // Turned off: what was waiting to be sent is thrown away.
            for f in sentry::pending_files(&self.crash_dir) {
                let _ = std::fs::remove_file(f);
            }
        }
        if self.usage_stats.load(Ordering::SeqCst) && !self.opened.swap(true, Ordering::SeqCst) {
            let _ = self.track("app_open", &[]).await;
        }
    }

    /// Counts an event. Unknown events and parameters are refused (a bug), a missing consent is silent.
    pub async fn track(&self, event: &str, params: &[(String, String)]) -> Result<(), String> {
        ga::validate(event, params)?;
        let (true, Some(g)) = (self.usage_stats.load(Ordering::SeqCst), &self.cfg.ga) else {
            return Ok(());
        };
        let body = ga::body(&self.install_id(), event, params, env!("CARGO_PKG_VERSION"));
        self.transport
            .post(&g.endpoint(), "application/json", &[], body.to_string())
            .await
    }

    /// An error caught in the webview. The webview cannot decide whether to report: that is checked here.
    pub async fn report_webview_error(&self, kind: &str, message: &str, stack: &str) {
        if !self.crash_reports.load(Ordering::SeqCst)
            || self.webview_errors.fetch_add(1, Ordering::SeqCst) >= MAX_WEBVIEW_ERRORS
        {
            return;
        }
        let report = Report::new(Origin::Webview, kind, message, parse_js_stack(stack), false);
        let _ = self.send(&report).await;
    }

    async fn send(&self, report: &Report) -> Result<(), String> {
        let Some(dsn) = &self.cfg.dsn else {
            return Ok(());
        };
        let ctx = sentry::Context {
            environment: &self.cfg.environment,
            install_id: &self.install_id(),
        };
        self.transport
            .post(
                &dsn.envelope_url(),
                "application/x-sentry-envelope",
                &[("x-sentry-auth", dsn.auth_header())],
                sentry::envelope(dsn, report, &ctx),
            )
            .await
    }

    /// Crash reports written before the last exit.
    async fn send_pending(&self) {
        let _one_at_a_time = self.sending.lock().await;
        for file in sentry::pending_files(&self.crash_dir) {
            let Some(report) = sentry::read_pending(&file) else {
                let _ = std::fs::remove_file(&file);
                continue;
            };
            if self.send(&report).await.is_ok() {
                let _ = std::fs::remove_file(&file);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------- crashes

static CRASH_ARMED: AtomicBool = AtomicBool::new(false);
static CRASH_DIR: OnceLock<PathBuf> = OnceLock::new();

/// A panic ends the process (`panic = "abort"`): the scrubbed report is written to a file, and sent at the next
/// start. Nothing is written unless the user allowed crash reports.
pub fn install_panic_hook(dir: PathBuf) {
    if CRASH_DIR.set(dir).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if CRASH_ARMED.load(Ordering::SeqCst)
            && let Some(dir) = CRASH_DIR.get()
        {
            let message = info
                .payload()
                .downcast_ref::<&str>()
                .map(|s| (*s).to_owned())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic".to_owned());
            let (file, line) = info
                .location()
                .map(|l| (l.file(), l.line()))
                .unwrap_or(("unknown", 0));
            sentry::write_pending(dir, &panic_report(&message, file, line));
        }
        previous(info);
    }));
}

pub fn panic_report(message: &str, file: &str, line: u32) -> Report {
    Report::new(
        Origin::Backend,
        "panic",
        message,
        vec![Frame {
            file: file.to_owned(),
            line: Some(line),
            function: None,
        }],
        true,
    )
}

/// The frames of a JavaScript stack, Chrome (`at f (file:1:2)`) or WebKit (`f@file:1:2`) style.
pub fn parse_js_stack(stack: &str) -> Vec<Frame> {
    static LINE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^\s*(?:at\s+)?(?:(?P<f>[^@(\s]*)\s*[@(]\s*)?(?P<file>[^()\s]+?):(?P<l>\d+):\d+\)?\s*$")
            .expect("a valid stack pattern")
    });
    stack
        .lines()
        .filter_map(|l| {
            let c = LINE.captures(l)?;
            Some(Frame {
                file: c["file"].to_owned(),
                line: c["l"].parse().ok(),
                function: Some(c["f"].to_owned()).filter(|f| !f.is_empty()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
