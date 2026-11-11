//! Test support: a minimal SIP registrar (UDP) with RFC 2617/7616 Digest
//! authentication, and helpers to spin up real Baresip engines.

#![allow(dead_code)]

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use md5::{Digest, Md5};
use tokio::{net::UdpSocket, sync::broadcast};
use zephone_lib::sip::engine::{
    EngineEvent, SipEngine,
    baresip::{BaresipEngine, BaresipPaths},
};

pub fn md5_hex(s: &str) -> String {
    let mut h = Md5::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum RegistrarMode {
    /// 401 challenge, then 200 if the digest is right, 401 again if not.
    Digest,
    /// Always 403 Forbidden.
    Forbidden,
    /// Always 503 Service Unavailable.
    Unavailable,
}

pub struct FakeRegistrar {
    pub port: u16,
    /// Every REGISTER received: (had Authorization header, status we answered).
    pub log: Arc<Mutex<Vec<(bool, u16)>>>,
    pub seen_request_uris: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FakeRegistrar {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn header<'a>(lines: &'a [&str], name: &str) -> Option<&'a str> {
    lines.iter().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
    })
}

fn all_headers<'a>(lines: &'a [&str], name: &str) -> Vec<&'a str> {
    lines
        .iter()
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.trim().eq_ignore_ascii_case(name).then(|| v.trim())
        })
        .collect()
}

fn auth_param(auth: &str, key: &str) -> Option<String> {
    let rest = auth.trim().strip_prefix("Digest")?.trim();
    for part in rest.split(',') {
        let (k, v) = part.split_once('=')?;
        if k.trim().eq_ignore_ascii_case(key) {
            return Some(v.trim().trim_matches('"').to_owned());
        }
    }
    None
}

impl FakeRegistrar {
    pub async fn start(mode: RegistrarMode, user: &str, password: &str) -> Self {
        let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = sock.local_addr().unwrap().port();
        let log: Arc<Mutex<Vec<(bool, u16)>>> = Arc::default();
        let uris: Arc<Mutex<Vec<String>>> = Arc::default();
        let (log2, uris2) = (log.clone(), uris.clone());
        let (user, password) = (user.to_owned(), password.to_owned());
        let task = tokio::spawn(async move {
            let realm = "zephone.test";
            let mut buf = vec![0u8; 8192];
            let mut counter = 0u32;
            loop {
                let Ok((n, peer)) = sock.recv_from(&mut buf).await else {
                    return;
                };
                let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                let lines: Vec<&str> = text.split("\r\n").collect();
                let first = lines[0];
                if !first.starts_with("REGISTER ") {
                    continue;
                }
                let uri = first.split_whitespace().nth(1).unwrap_or("").to_owned();
                uris2.lock().unwrap().push(uri.clone());
                let authz = header(&lines, "Authorization");

                let (status, reason, extra): (u16, &str, String) = match mode {
                    RegistrarMode::Forbidden => (403, "Forbidden", String::new()),
                    RegistrarMode::Unavailable => (503, "Service Unavailable", String::new()),
                    RegistrarMode::Digest => {
                        let valid = authz.is_some_and(|a| {
                            let nonce = auth_param(a, "nonce").unwrap_or_default();
                            let resp = auth_param(a, "response").unwrap_or_default();
                            let ha1 = md5_hex(&format!("{user}:{realm}:{password}"));
                            let ha2 = md5_hex(&format!(
                                "REGISTER:{}",
                                auth_param(a, "uri").unwrap_or_default()
                            ));
                            let expected = match auth_param(a, "qop") {
                                Some(qop) => md5_hex(&format!(
                                    "{ha1}:{nonce}:{}:{}:{qop}:{ha2}",
                                    auth_param(a, "nc").unwrap_or_default(),
                                    auth_param(a, "cnonce").unwrap_or_default()
                                )),
                                None => md5_hex(&format!("{ha1}:{nonce}:{ha2}")),
                            };
                            auth_param(a, "username").as_deref() == Some(user.as_str())
                                && resp == expected
                        });
                        if valid {
                            (200, "OK", String::new())
                        } else {
                            counter += 1;
                            let nonce = md5_hex(&format!("nonce-{counter}"));
                            (
                                401,
                                "Unauthorized",
                                format!(
                                    "WWW-Authenticate: Digest realm=\"{realm}\", nonce=\"{nonce}\", \
                                     algorithm=MD5, qop=\"auth\"\r\n"
                                ),
                            )
                        }
                    }
                };
                log2.lock().unwrap().push((authz.is_some(), status));

                let mut resp = format!("SIP/2.0 {status} {reason}\r\n");
                for v in all_headers(&lines, "Via") {
                    resp.push_str(&format!("Via: {v}\r\n"));
                }
                if let Some(f) = header(&lines, "From") {
                    resp.push_str(&format!("From: {f}\r\n"));
                }
                if let Some(t) = header(&lines, "To") {
                    if t.contains("tag=") {
                        resp.push_str(&format!("To: {t}\r\n"));
                    } else {
                        resp.push_str(&format!("To: {t};tag=fakereg{counter}\r\n"));
                    }
                }
                if let Some(c) = header(&lines, "Call-ID") {
                    resp.push_str(&format!("Call-ID: {c}\r\n"));
                }
                if let Some(c) = header(&lines, "CSeq") {
                    resp.push_str(&format!("CSeq: {c}\r\n"));
                }
                if status == 200 {
                    if let Some(c) = header(&lines, "Contact") {
                        let c = c.split(';').next().unwrap_or(c);
                        resp.push_str(&format!("Contact: {c};expires=300\r\n"));
                    }
                    resp.push_str("Expires: 300\r\n");
                }
                resp.push_str(&extra);
                resp.push_str("Server: ZePhone-Test-Registrar\r\nContent-Length: 0\r\n\r\n");
                let _ = sock.send_to(resp.as_bytes(), peer).await;
            }
        });
        FakeRegistrar {
            port,
            log,
            seen_request_uris: uris,
            task,
        }
    }
}

// --------------------------------------------------------------- engines

/// Where the real sidecar and its resources live in the source tree.
pub fn sidecar_paths(work_dir: PathBuf) -> Option<BaresipPaths> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let triple = env!("TAURI_ENV_TARGET_TRIPLE");
    let exe = root.join("binaries").join(format!("baresip-{triple}"));
    let modules = root.join("resources/baresip/modules");
    if !exe.is_file() || !modules.is_dir() {
        return None;
    }
    Some(BaresipPaths {
        exe,
        modules_dir: modules,
        sounds_dir: root.join("resources/baresip/sounds"),
        work_dir,
    })
}

/// Directory with the extra test-only modules (`ausine`, `aufile`), taken from the
/// local Baresip install (they are deliberately not part of the app bundle).
pub fn test_modules_dir() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("ZEPHONE_TEST_MODULES_DIR") {
        return Some(PathBuf::from(d));
    }
    let out = std::process::Command::new("brew")
        .args(["--prefix", "baresip"])
        .output()
        .ok()?;
    let prefix = String::from_utf8(out.stdout).ok()?;
    let dir = PathBuf::from(prefix.trim()).join("lib/baresip/modules");
    dir.join("ausine.so").is_file().then_some(dir)
}

pub async fn wait_for<F>(
    rx: &mut broadcast::Receiver<EngineEvent>,
    secs: u64,
    mut pred: F,
) -> Option<EngineEvent>
where
    F: FnMut(&EngineEvent) -> bool,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(ev)) => {
                if pred(&ev) {
                    return Some(ev);
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            _ => return None,
        }
    }
}

pub async fn started_engine(
    work: &std::path::Path,
    options: zephone_lib::sip::engine::EngineOptions,
) -> Option<BaresipEngine> {
    let paths = sidecar_paths(work.to_path_buf())?;
    let engine = BaresipEngine::new(paths);
    engine.set_options(options);
    engine.start().await.expect("engine should start");
    Some(engine)
}
