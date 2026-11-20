//! A small Sentry client: it builds an error event by hand and posts it in an envelope. The whole content of a
//! report is therefore visible in this file (message, a few stack frames, the version, the system), and nothing
//! reaches Sentry that was not scrubbed first. See `docs/PRIVACY.md`.

use super::scrub::scrub;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Where an error came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Backend,
    Webview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    pub file: String,
    pub line: Option<u32>,
    pub function: Option<String>,
}

/// An error, already scrubbed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    pub origin: Origin,
    pub kind: String,
    pub message: String,
    pub frames: Vec<Frame>,
    pub fatal: bool,
    /// The version that failed: a report written by a crash is sent at the next start, maybe after an update.
    pub version: String,
}

impl Report {
    /// Builds a report from raw text; the scrubbing happens here, so no caller can forget it.
    pub fn new(origin: Origin, kind: &str, message: &str, frames: Vec<Frame>, fatal: bool) -> Self {
        Self {
            origin,
            kind: scrub(kind),
            message: scrub(message),
            frames: frames
                .into_iter()
                .take(30)
                .map(|f| Frame {
                    file: scrub(&f.file),
                    line: f.line,
                    function: f.function.map(|x| scrub(&x)),
                })
                .collect(),
            fatal,
            version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}

/// `https://<key>@<host>/<project>`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dsn {
    raw: String,
    key: String,
    host: String,
    project: String,
}

impl Dsn {
    pub fn parse(raw: &str) -> Option<Self> {
        let rest = raw.trim().strip_prefix("https://")?;
        let (key, rest) = rest.split_once('@')?;
        let (host, project) = rest.split_once('/')?;
        let project = project.trim_end_matches('/');
        if key.is_empty()
            || host.is_empty()
            || project.is_empty()
            || !project.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        Some(Self {
            raw: raw.trim().to_owned(),
            key: key.to_owned(),
            host: host.to_owned(),
            project: project.to_owned(),
        })
    }

    pub fn envelope_url(&self) -> String {
        format!("https://{}/api/{}/envelope/", self.host, self.project)
    }

    pub fn auth_header(&self) -> String {
        format!(
            "Sentry sentry_version=7, sentry_client=zephone/{}, sentry_key={}",
            env!("CARGO_PKG_VERSION"),
            self.key
        )
    }
}

/// What is the same for every report of this run.
pub struct Context<'a> {
    pub environment: &'a str,
    /// The random identifier of this installation (it can be reset in the settings).
    pub install_id: &'a str,
}

/// The envelope: a header line, an item header line and the event, one JSON document per line.
pub fn envelope(dsn: &Dsn, report: &Report, ctx: &Context<'_>) -> String {
    let event_id = uuid::Uuid::new_v4().simple().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    // Sentry wants the oldest frame first.
    let frames: Vec<Value> = report
        .frames
        .iter()
        .rev()
        .map(|f| {
            json!({ "filename": f.file, "lineno": f.line, "function": f.function, "in_app": true })
        })
        .collect();
    let event = json!({
        "event_id": event_id,
        "timestamp": now,
        "platform": match report.origin { Origin::Backend => "native", Origin::Webview => "javascript" },
        "level": if report.fatal { "fatal" } else { "error" },
        "release": format!("zephone@{}", report.version),
        "environment": ctx.environment,
        "user": { "id": ctx.install_id },
        "tags": { "origin": report.origin, "os": std::env::consts::OS, "arch": std::env::consts::ARCH },
        "contexts": { "os": { "name": std::env::consts::OS }, "app": { "app_version": env!("CARGO_PKG_VERSION") } },
        "sdk": { "name": "zephone.telemetry", "version": env!("CARGO_PKG_VERSION") },
        "exception": { "values": [{
            "type": report.kind,
            "value": report.message,
            "stacktrace": { "frames": frames },
        }]},
    });
    format!(
        "{}\n{}\n{}\n",
        json!({ "event_id": event_id, "sent_at": now, "dsn": dsn.raw }),
        json!({ "type": "event" }),
        event
    )
}

// ------------------------------------------------------------ reports waiting for the next start

/// A crash ends the process: the report is written to a file and sent at the next start.
const MAX_PENDING: usize = 5;

pub fn write_pending(dir: &Path, report: &Report) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let mut files = pending_files(dir);
    while files.len() >= MAX_PENDING {
        let _ = std::fs::remove_file(files.remove(0));
    }
    if let Ok(json) = serde_json::to_string(report) {
        let _ = std::fs::write(dir.join(format!("{}.json", uuid::Uuid::new_v4())), json);
    }
}

pub fn pending_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "json"))
                .collect()
        })
        .unwrap_or_default();
    files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    files
}

pub fn read_pending(path: &Path) -> Option<Report> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DSN: &str = "https://abc123@o1.ingest.de.sentry.io/42";

    fn report() -> Report {
        Report::new(
            Origin::Backend,
            "panic",
            r#"failed to parse <sip:alice@pbx.example.com> for "Alice Martin" <sip:alice@pbx>"#,
            vec![Frame {
                file: "/Users/someone/src/sip/uri.rs".into(),
                line: Some(12),
                function: Some("parse".into()),
            }],
            true,
        )
    }

    #[test]
    fn a_dsn_is_parsed_and_a_bad_one_refused() {
        let d = Dsn::parse(DSN).unwrap();
        assert_eq!(
            d.envelope_url(),
            "https://o1.ingest.de.sentry.io/api/42/envelope/"
        );
        assert!(d.auth_header().contains("sentry_key=abc123"));
        for bad in [
            "",
            "http://k@h/1",
            "https://h/1",
            "https://k@h/",
            "https://k@h/x",
        ] {
            assert!(Dsn::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn a_report_is_scrubbed_when_it_is_built() {
        let r = report();
        let all = format!("{} {:?}", r.message, r.frames);
        for leak in ["alice", "Alice", "pbx", "someone"] {
            assert!(!all.contains(leak), "{leak} leaked: {all}");
        }
    }

    #[test]
    fn the_envelope_has_three_json_lines_with_the_release_and_the_error() {
        let ctx = Context {
            environment: "production",
            install_id: "id-1",
        };
        let env = envelope(&Dsn::parse(DSN).unwrap(), &report(), &ctx);
        let lines: Vec<Value> = env
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0]["dsn"], DSN);
        assert_eq!(lines[1]["type"], "event");
        assert_eq!(
            lines[2]["release"],
            format!("zephone@{}", env!("CARGO_PKG_VERSION"))
        );
        assert_eq!(lines[2]["level"], "fatal");
        assert_eq!(lines[2]["user"]["id"], "id-1");
        assert_eq!(lines[2]["exception"]["values"][0]["type"], "panic");
        assert!(lines[2].get("server_name").is_none());
    }

    #[test]
    fn pending_reports_survive_a_restart_and_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        for _ in 0..8 {
            write_pending(dir.path(), &report());
        }
        let files = pending_files(dir.path());
        assert_eq!(files.len(), MAX_PENDING);
        assert_eq!(read_pending(&files[0]).unwrap(), report());
    }
}
