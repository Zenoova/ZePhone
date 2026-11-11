//! Lifecycle of the Baresip child process: spawn, log capture (with secret
//! redaction), pid file and stale-process cleanup.

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
};

use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::{Child, Command},
};

use crate::security::redact::redact;

/// Locations the engine needs. All are resolved at runtime from the app bundle
/// (or the dev build output): nothing is hard-coded to Homebrew.
#[derive(Debug, Clone)]
pub struct BaresipPaths {
    /// The `baresip` executable (Tauri sidecar).
    pub exe: PathBuf,
    pub modules_dir: PathBuf,
    pub sounds_dir: PathBuf,
    /// Private, per-user directory holding the generated config and the pid file.
    pub work_dir: PathBuf,
}

impl BaresipPaths {
    pub fn pid_file(&self) -> PathBuf {
        self.work_dir.join("baresip.pid")
    }
}

/// Information scraped from Baresip's start-up output plus a bounded, redacted log.
#[derive(Debug, Default)]
pub struct LogSink {
    lines: Mutex<VecDeque<String>>,
    version: Mutex<Option<String>>,
    codecs: Mutex<Vec<String>>,
}

const LOG_CAPACITY: usize = 400;

impl LogSink {
    pub fn push(&self, raw: &str) {
        let line = redact(raw.trim_end());
        if line.is_empty() {
            return;
        }
        if let Some(rest) = line.strip_prefix("baresip v") {
            let v = rest.split_whitespace().next().unwrap_or("").to_owned();
            if !v.is_empty() {
                *self.version.lock().unwrap() = Some(v);
            }
        } else if let Some(rest) = line.strip_prefix("aucodec: ") {
            let name = rest.split('/').next().unwrap_or("").trim().to_owned();
            if !name.is_empty() {
                let mut codecs = self.codecs.lock().unwrap();
                if !codecs.contains(&name) {
                    codecs.push(name);
                }
            }
        }
        log::debug!(target: "baresip", "{line}");
        let mut lines = self.lines.lock().unwrap();
        if lines.len() == LOG_CAPACITY {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    pub fn version(&self) -> Option<String> {
        self.version.lock().unwrap().clone()
    }

    pub fn codecs(&self) -> Vec<String> {
        self.codecs.lock().unwrap().clone()
    }

    pub fn tail(&self, n: usize) -> Vec<String> {
        let lines = self.lines.lock().unwrap();
        lines.iter().rev().take(n).rev().cloned().collect()
    }

    pub fn clear_startup_info(&self) {
        self.codecs.lock().unwrap().clear();
    }
}

fn pipe_lines<R: AsyncRead + Unpin + Send + 'static>(reader: R, sink: Arc<LogSink>) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            sink.push(&line);
        }
    });
}

/// Finds a free TCP port on the loopback interface.
pub fn pick_free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

/// Creates `dir` readable by the current user only.
pub fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Writes `content` to `path` with mode 0600 (owner read/write only).
pub fn write_private_file(path: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(content.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

pub struct Spawned {
    pub child: Child,
    pub pid: Option<u32>,
}

/// Starts Baresip with `-f <config dir>`. The child is killed if the handle is
/// dropped (`kill_on_drop`), so a panic in the app cannot leave it behind.
pub fn spawn(paths: &BaresipPaths, sink: Arc<LogSink>, sip_trace: bool) -> std::io::Result<Spawned> {
    let mut cmd = Command::new(&paths.exe);
    cmd.arg("-f").arg(&paths.work_dir).arg("-c"); // -c: no ANSI colours in logs
    if sip_trace {
        cmd.arg("-s");
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut child = cmd.spawn()?;
    if let Some(out) = child.stdout.take() {
        pipe_lines(out, sink.clone());
    }
    if let Some(err) = child.stderr.take() {
        pipe_lines(err, sink);
    }
    let pid = child.id();
    if let Some(pid) = pid {
        let _ = std::fs::write(paths.pid_file(), pid.to_string());
    }
    Ok(Spawned { child, pid })
}

pub fn remove_pid_file(paths: &BaresipPaths) {
    let _ = std::fs::remove_file(paths.pid_file());
}

/// If a previous run of the app crashed hard, its Baresip may still be running
/// (and holding the microphone). Kill it, but only if the pid really belongs to
/// *our* Baresip executable.
pub fn kill_stale_instance(paths: &BaresipPaths) -> bool {
    let Ok(text) = std::fs::read_to_string(paths.pid_file()) else { return false };
    let Ok(pid) = text.trim().parse::<u32>() else {
        remove_pid_file(paths);
        return false;
    };
    let Ok(mut sys) = sysinfo::System::new() else { return false };
    let pid = sysinfo::Pid::from_u32(pid);
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    let mut killed = false;
    if let Some(proc_) = sys.process(pid) {
        let same_exe = proc_.exe().map(|p| p == paths.exe).unwrap_or(false);
        if same_exe {
            log::warn!("killing stale baresip process {pid} left by a previous run");
            killed = proc_.kill();
        }
    }
    remove_pid_file(paths);
    killed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_sink_scrapes_version_and_codecs_and_redacts() {
        let sink = LogSink::default();
        sink.push("baresip v4.13.0 Copyright (C) 2010 - 2025 Alfred E. Heggestad et al.");
        sink.push("aucodec: PCMU/8000/1");
        sink.push("aucodec: PCMA/8000/1");
        sink.push("aucodec: PCMA/8000/1");
        sink.push("Creating UA for <sip:1@x>;auth_pass=\"topsecret\";regint=1");
        assert_eq!(sink.version().as_deref(), Some("4.13.0"));
        assert_eq!(sink.codecs(), vec!["PCMU", "PCMA"]);
        let tail = sink.tail(10).join("\n");
        assert!(!tail.contains("topsecret"), "{tail}");
        assert!(tail.contains("auth_pass=***"));
    }

    #[test]
    fn log_sink_is_bounded() {
        let sink = LogSink::default();
        for i in 0..(LOG_CAPACITY + 50) {
            sink.push(&format!("line {i}"));
        }
        let all = sink.tail(10_000);
        assert_eq!(all.len(), LOG_CAPACITY);
        assert_eq!(all.last().unwrap(), &format!("line {}", LOG_CAPACITY + 49));
    }

    #[test]
    fn free_port_is_usable() {
        let p = pick_free_port().unwrap();
        assert!(p > 0);
        std::net::TcpListener::bind(("127.0.0.1", p)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn private_files_have_restrictive_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("w");
        ensure_private_dir(&sub).unwrap();
        assert_eq!(std::fs::metadata(&sub).unwrap().permissions().mode() & 0o777, 0o700);
        let f = sub.join("config");
        write_private_file(&f, "x").unwrap();
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        // Overwriting keeps the mode.
        write_private_file(&f, "y").unwrap();
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn stale_pid_with_foreign_executable_is_not_killed() {
        let dir = tempfile::tempdir().unwrap();
        let paths = BaresipPaths {
            exe: PathBuf::from("/definitely/not/this/baresip"),
            modules_dir: dir.path().into(),
            sounds_dir: dir.path().into(),
            work_dir: dir.path().into(),
        };
        // Our own pid: a live process whose exe is not paths.exe.
        std::fs::write(paths.pid_file(), std::process::id().to_string()).unwrap();
        assert!(!kill_stale_instance(&paths));
        assert!(!paths.pid_file().exists());
    }
}
