//! Baresip on iOS.
//!
//! iOS lets an application run nothing but itself: there is no sidecar and no child process. The engine is
//! therefore linked into the application as a static library (`scripts/build-baresip-ios.sh`: Baresip with its
//! modules, libre, OpenSSL, Opus and ZePhone's own `zeaudio`, plus the entry point of
//! `scripts/ios-engine/zephone_engine.c`) and runs on a thread of the application. Everything else is unchanged:
//! the engine is driven through `ctrl_tcp`, on the loopback interface only, exactly like the executable on the
//! other systems.
//!
//! Baresip is built STATIC (every module is inside the library), so there is no module folder to ship. The two
//! ring tones and the CA bundle are embedded in the application and written next to the engine's configuration.

// The logic around the foreign calls is compiled everywhere so that it is tested on a computer; only iOS links the
// library and runs it.
#![cfg_attr(not(target_os = "ios"), allow(dead_code))]

use std::{
    io,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tokio::sync::oneshot;

use super::process::{BaresipPaths, LogSink};

/// The modules compiled into the engine (`scripts/build-baresip-ios.sh`).
const STATIC_MODULES: &[&str] = &[
    "g711",
    "auconv",
    "auresamp",
    "audiounit",
    "srtp",
    "menu",
    "ctrl_tcp",
    "vumeter",
    "zeaudio",
    "opus",
];

const RING: &[u8] = include_bytes!("../../../../ios/ring.wav");
const RINGBACK: &[u8] = include_bytes!("../../../../ios/ringback.wav");
/// The roots the SIP servers' certificates are verified against. iOS has no CA file Baresip could read, and the
/// engine never runs without verifying the server (`sip_verify_server yes`).
const CA_BUNDLE: &[u8] = include_bytes!("../../../../ios/cacert.pem");

/// File name of the CA bundle in the engine's folder.
pub const CA_FILE: &str = "cacert.pem";

/// Whether the module a `module <name>.so` line asks for is part of the engine.
pub fn module_exists(file: &str) -> bool {
    let name = file.rsplit_once('.').map_or(file, |(name, _)| name);
    STATIC_MODULES.contains(&name)
}

/// Where the engine's sounds and working files are. Writes the sounds and the CA bundle (cheap to rewrite
/// after an update).
pub fn paths(work_dir: PathBuf) -> io::Result<BaresipPaths> {
    let sounds_dir = work_dir.join("sounds");
    std::fs::create_dir_all(&sounds_dir)?;
    for (name, bytes) in [("ring.wav", RING), ("ringback.wav", RINGBACK)] {
        std::fs::write(sounds_dir.join(name), bytes)?;
    }
    std::fs::write(work_dir.join(CA_FILE), CA_BUNDLE)?;
    Ok(BaresipPaths {
        // There is no executable: the engine is part of this one.
        exe: std::env::current_exe().unwrap_or_else(|_| PathBuf::from("zephone")),
        modules_dir: work_dir.join("modules"),
        sounds_dir,
        work_dir,
    })
}

/// The CA bundle [`paths`] wrote.
pub fn ca_file(paths: &BaresipPaths) -> PathBuf {
    paths.work_dir.join(CA_FILE)
}

/// The engine running on its thread.
pub struct Embedded {
    done: Option<oneshot::Receiver<i32>>,
    code: Option<i32>,
}

/// Where the engine's log lines go (the engine is a process-wide singleton, like the process it replaces).
static SINK: Mutex<Option<Arc<LogSink>>> = Mutex::new(None);

#[cfg(target_os = "ios")]
mod ffi {
    use std::ffi::{c_char, c_int};

    pub type LogFn = extern "C" fn(level: u32, line: *const c_char);

    unsafe extern "C" {
        pub fn zephone_engine_run(config_dir: *const c_char, sip_trace: c_int, log: LogFn) -> c_int;
        pub fn zephone_engine_stop();
        pub fn zephone_engine_dns_servers(out: *mut c_char, size: usize) -> c_int;
    }
}

#[cfg(target_os = "ios")]
extern "C" fn log_line(_level: u32, line: *const std::ffi::c_char) {
    if line.is_null() {
        return;
    }
    // SAFETY: the engine passes a NUL-terminated string that lives for the duration of the call.
    let text = unsafe { std::ffi::CStr::from_ptr(line) }.to_string_lossy();
    if let Some(sink) = SINK.lock().unwrap().as_ref() {
        sink.push(&text);
    }
}

/// Starts the engine on a thread. `config_dir` holds the generated `config`.
#[cfg(target_os = "ios")]
pub fn spawn(
    config_dir: &std::path::Path,
    sink: Arc<LogSink>,
    sip_trace: bool,
) -> io::Result<Embedded> {
    use std::ffi::CString;

    let dir = CString::new(config_dir.as_os_str().to_string_lossy().into_owned())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid engine folder"))?;
    *SINK.lock().unwrap() = Some(sink.clone());
    // The banner Baresip's executable prints, from which the version is read.
    sink.push(&format!("baresip v{}", engine_version()));
    let (tx, rx) = oneshot::channel();
    std::thread::Builder::new()
        .name("baresip".into())
        .stack_size(4 * 1024 * 1024)
        .spawn(move || {
            // SAFETY: `dir` outlives the call; `log_line` has the signature the library expects.
            let code = unsafe {
                ffi::zephone_engine_run(dir.as_ptr(), i32::from(sip_trace), log_line)
            };
            let _ = tx.send(code);
        })?;
    Ok(Embedded {
        done: Some(rx),
        code: None,
    })
}

#[cfg(target_os = "ios")]
fn engine_version() -> String {
    unsafe extern "C" {
        fn zephone_engine_version() -> *const std::ffi::c_char;
    }
    // SAFETY: the library returns a static NUL-terminated string.
    unsafe { std::ffi::CStr::from_ptr(zephone_engine_version()) }
        .to_string_lossy()
        .into_owned()
}

/// The DNS servers of the active network, one address per entry (empty when the system gives none).
#[cfg(target_os = "ios")]
pub fn dns_servers() -> Vec<String> {
    let mut buf = [0 as std::ffi::c_char; 512];
    // SAFETY: the buffer is writable for `size` bytes and the function always terminates what it writes.
    if unsafe { ffi::zephone_engine_dns_servers(buf.as_mut_ptr(), buf.len()) } != 0 {
        return Vec::new();
    }
    // SAFETY: NUL-terminated by the call above.
    let text = unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_string_lossy();
    text.lines()
        .map(|l| l.trim().to_owned())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Other systems never start the embedded engine.
#[cfg(not(target_os = "ios"))]
pub fn spawn(
    _config_dir: &std::path::Path,
    _sink: Arc<LogSink>,
    _sip_trace: bool,
) -> io::Result<Embedded> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "the embedded engine only exists on iOS",
    ))
}

impl Embedded {
    /// Waits for the engine to return; describes how.
    pub async fn wait(&mut self) -> String {
        if let Some(rx) = self.done.take() {
            self.code = Some(rx.await.unwrap_or(-1));
        }
        match self.code {
            Some(0) => "stopped".into(),
            Some(code) => format!("stopped with error {code}"),
            None => "stopped".into(),
        }
    }

    /// Asks the engine to stop and waits for it a little. An embedded engine cannot be killed: when it does not
    /// answer, it is left to finish (a new start then reports that it is still busy).
    pub async fn stop(&mut self) {
        #[cfg(target_os = "ios")]
        // SAFETY: callable from any thread.
        unsafe {
            ffi::zephone_engine_stop();
        }
        let _ = tokio::time::timeout(std::time::Duration::from_secs(4), self.wait()).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_modules_are_found_whatever_the_extension() {
        assert!(module_exists("audiounit.so"));
        assert!(module_exists("opus.so"));
        assert!(module_exists("zeaudio.so"));
        assert!(!module_exists("coreaudio.so"));
        assert!(!module_exists("g722.so"));
    }

    #[test]
    fn the_sounds_and_the_ca_bundle_are_written_next_to_the_engine() {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths(dir.path().join("engine")).unwrap();
        assert!(paths.sounds_dir.join("ring.wav").is_file());
        assert!(paths.sounds_dir.join("ringback.wav").is_file());
        let ca = std::fs::read_to_string(ca_file(&paths)).unwrap();
        assert!(ca.contains("BEGIN CERTIFICATE"));
    }

    #[tokio::test]
    async fn a_stopped_engine_is_described_by_its_exit_code() {
        let (tx, rx) = oneshot::channel();
        let mut engine = Embedded {
            done: Some(rx),
            code: None,
        };
        tx.send(0).unwrap();
        assert_eq!(engine.wait().await, "stopped");
        let (tx, rx) = oneshot::channel();
        let mut engine = Embedded {
            done: Some(rx),
            code: None,
        };
        tx.send(98).unwrap();
        assert_eq!(engine.wait().await, "stopped with error 98");
    }
}
