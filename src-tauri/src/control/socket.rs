//! The local control channel: a Unix socket in the application's data folder, readable and writable by the
//! user only. One request per connection, one JSON line each way.
//!
//! Why a socket and not an HTTP port: a web page cannot open a Unix socket, so no page can ever drive the
//! softphone; nothing listens on the network; and the operating system already says who may connect. The server
//! also checks the user id of whoever connects.
//!
//! The request is a [`Command`] as one line of JSON, the answer an [`Outcome`] as one line of JSON. Whatever
//! the connection sends, the only things it can ask for are the commands of [`Command`]: nothing is executed,
//! no file is read.

use std::{path::PathBuf, time::Duration};

use super::command::{Command, Outcome, Status};

/// A request is a short line. Anything longer is refused.
pub const MAX_REQUEST_BYTES: usize = 4096;
const READ_TIMEOUT: Duration = Duration::from_secs(3);
const EXECUTE_TIMEOUT: Duration = Duration::from_secs(20);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(25);
/// `sun_path` holds 104 bytes on macOS (108 on Linux), with the final NUL.
const MAX_PATH_BYTES: usize = 100;

pub const ENV_SOCKET: &str = "ZEPHONE_CONTROL_SOCKET";
const APP_ID: &str = "com.zenoova.zephone";

/// Where the socket lives. The application and `zephone ctl` compute it the same way, so they always meet.
/// `ZEPHONE_CONTROL_SOCKET` overrides it (tests, unusual setups).
pub fn socket_path() -> Result<PathBuf, String> {
    let path = match std::env::var_os(ENV_SOCKET) {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => default_path()?,
    };
    if path.as_os_str().len() > MAX_PATH_BYTES {
        return Err(format!(
            "socket path too long ({} bytes, maximum {MAX_PATH_BYTES}): set {ENV_SOCKET}",
            path.as_os_str().len()
        ));
    }
    Ok(path)
}

fn default_path() -> Result<PathBuf, String> {
    let home = || {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "home folder not found".to_string())
    };
    if cfg!(target_os = "macos") {
        Ok(home()?
            .join("Library/Application Support")
            .join(APP_ID)
            .join("control.sock"))
    } else if cfg!(unix) {
        Ok(match std::env::var_os("XDG_RUNTIME_DIR") {
            Some(d) if !d.is_empty() => PathBuf::from(d).join("zephone").join("control.sock"),
            _ => home()?
                .join(".local/share")
                .join(APP_ID)
                .join("control.sock"),
        })
    } else {
        Err("the local command interface is not available on this platform yet".into())
    }
}

fn parse_request(line: &str) -> Result<Command, Outcome> {
    serde_json::from_str::<Command>(line.trim()).map_err(|e| {
        Outcome::of(
            Status::Invalid,
            format!("unrecognized command or invalid parameters: {e}"),
        )
    })
}

#[cfg(unix)]
pub use unix::{Server, send};

#[cfg(not(unix))]
pub use other::{Server, send};

#[cfg(unix)]
mod unix {
    use std::{
        io::{BufRead, BufReader, Write},
        os::unix::{
            fs::{FileTypeExt, MetadataExt, PermissionsExt},
            net::UnixStream as StdStream,
        },
        path::{Path, PathBuf},
        sync::Arc,
    };

    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt},
        net::{UnixListener, UnixStream},
        sync::Semaphore,
    };

    use super::*;
    use crate::control::controller::Controller;

    pub struct Server {
        path: PathBuf,
        task: tauri::async_runtime::JoinHandle<()>,
    }

    impl Server {
        /// Starts listening. Fails if another ZePhone already answers on this socket.
        pub async fn start(path: PathBuf, controller: Arc<Controller>) -> std::io::Result<Server> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            clear_stale(&path)?;
            let listener = UnixListener::bind(&path)?;
            // Only the owner may connect (the file mode is honoured by the kernel on connect).
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            let owner = std::fs::metadata(&path)?.uid();
            log::info!("control socket: {}", path.display());

            let slots = Arc::new(Semaphore::new(8));
            let task = tauri::async_runtime::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    // A burst of connections is dropped, not queued.
                    let Ok(permit) = slots.clone().try_acquire_owned() else {
                        continue;
                    };
                    let controller = controller.clone();
                    tauri::async_runtime::spawn(async move {
                        serve_one(stream, controller, owner).await;
                        drop(permit);
                    });
                }
            });
            Ok(Server { path, task })
        }

        /// Stops listening and removes the socket file.
        pub fn stop(&self) {
            self.task.abort();
            remove_socket(&self.path);
        }
    }

    impl Drop for Server {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn remove_socket(path: &Path) {
        // Only ever remove a socket, never whatever else sits at that path.
        if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_socket()) {
            let _ = std::fs::remove_file(path);
        }
    }

    /// A socket file left by a crashed run is removed; one that still answers belongs to a running ZePhone.
    fn clear_stale(path: &Path) -> std::io::Result<()> {
        let Ok(meta) = std::fs::symlink_metadata(path) else {
            return Ok(());
        };
        if !meta.file_type().is_socket() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} exists and is not a socket", path.display()),
            ));
        }
        if StdStream::connect(path).is_ok() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AddrInUse,
                "another instance of ZePhone is already listening",
            ));
        }
        std::fs::remove_file(path)
    }

    async fn serve_one(stream: UnixStream, controller: Arc<Controller>, owner: u32) {
        // Defence in depth on top of the file mode: the connecting process must be ours.
        match stream.peer_cred() {
            Ok(cred) if cred.uid() == owner => {}
            _ => {
                log::warn!("control socket: connection from another user refused");
                return;
            }
        }
        let (read, mut write) = stream.into_split();
        let mut reader = tokio::io::BufReader::new(read.take(MAX_REQUEST_BYTES as u64));
        let mut line = String::new();
        let outcome = match tokio::time::timeout(READ_TIMEOUT, reader.read_line(&mut line)).await {
            Err(_) => Outcome::of(Status::Invalid, "request not received in time"),
            Ok(Err(_)) => Outcome::of(Status::Invalid, "unreadable request (UTF-8 expected)"),
            Ok(Ok(0)) => return,
            Ok(Ok(_)) if !line.ends_with('\n') => {
                Outcome::of(Status::Invalid, "request too long or incomplete")
            }
            Ok(Ok(_)) => match parse_request(&line) {
                Err(o) => o,
                Ok(cmd) => {
                    match tokio::time::timeout(EXECUTE_TIMEOUT, controller.execute(cmd)).await {
                        Ok(o) => o,
                        Err(_) => Outcome::of(Status::Failed, "the engine did not answer in time"),
                    }
                }
            },
        };
        let mut out = serde_json::to_vec(&outcome).unwrap_or_else(|_| b"{}".to_vec());
        out.push(b'\n');
        let _ = write.write_all(&out).await;
        let _ = write.shutdown().await;
    }

    /// Sends one request to the running application and waits for its answer. When nobody answers, the result is
    /// `Disconnected`: a command never starts the application.
    pub fn send(path: &Path, cmd: &Command) -> Outcome {
        let stream = match StdStream::connect(path) {
            Ok(s) => s,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
                ) =>
            {
                return Outcome::of(Status::Disconnected, "ZePhone is not running");
            }
            Err(e) => {
                return Outcome::of(Status::Disconnected, format!("ZePhone is unreachable: {e}"));
            }
        };
        let _ = stream.set_read_timeout(Some(CLIENT_TIMEOUT));
        let _ = stream.set_write_timeout(Some(CLIENT_TIMEOUT));
        let mut line = match serde_json::to_vec(cmd) {
            Ok(l) => l,
            Err(e) => return Outcome::of(Status::Invalid, e.to_string()),
        };
        line.push(b'\n');
        let mut stream = stream;
        if let Err(e) = stream.write_all(&line) {
            return Outcome::of(Status::Failed, format!("cannot send: {e}"));
        }
        let mut answer = String::new();
        if let Err(e) = BufReader::new(&stream).read_line(&mut answer) {
            return Outcome::of(Status::Failed, format!("no response from ZePhone: {e}"));
        }
        serde_json::from_str(answer.trim())
            .unwrap_or_else(|_| Outcome::of(Status::Failed, "unreadable answer from ZePhone"))
    }
}

#[cfg(not(unix))]
mod other {
    use std::{path::Path, path::PathBuf, sync::Arc};

    use super::*;
    use crate::control::controller::Controller;

    pub struct Server;

    impl Server {
        pub async fn start(_: PathBuf, _: Arc<Controller>) -> std::io::Result<Server> {
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "the local command interface is not available on this platform yet",
            ))
        }
        pub fn stop(&self) {}
    }

    pub fn send(_: &Path, _: &Command) -> Outcome {
        Outcome::of(
            Status::Disconnected,
            "the local command interface is not available on this platform yet",
        )
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        io::{Read, Write},
        os::unix::net::UnixStream,
    };

    use super::*;
    use crate::control::controller::tests::rig;
    use crate::control::select::fixtures::call;
    use crate::sip::types::CallState;

    fn sock(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("c.sock")
    }

    fn raw(path: &Path, bytes: &[u8]) -> String {
        let mut s = UnixStream::connect(path).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(bytes).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    use std::path::Path;

    #[tokio::test(flavor = "multi_thread")]
    async fn serves_commands_and_returns_structured_answers() {
        let dir = tempfile::tempdir().unwrap();
        let (controller, phone, _) = rig(vec![call("a", CallState::Connected)]);
        let server = Server::start(sock(&dir), controller).await.unwrap();
        let path = sock(&dir);

        let p = path.clone();
        let o = tokio::task::spawn_blocking(move || {
            send(
                &p,
                &Command::Mute {
                    call_id: None,
                    muted: Some(true),
                },
            )
        })
        .await
        .unwrap();
        assert_eq!(o.status, Status::Ok);
        assert!(o.call.unwrap().muted);
        assert_eq!(phone.log(), ["mute a true"]);

        let p = path.clone();
        let o = tokio::task::spawn_blocking(move || send(&p, &Command::Answer { call_id: None }))
            .await
            .unwrap();
        assert_eq!(o.status, Status::Unavailable);
        drop(server);
        assert!(
            !path.exists(),
            "the socket file is removed when the server stops"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn refuses_anything_that_is_not_a_known_command() {
        let dir = tempfile::tempdir().unwrap();
        let (controller, phone, _) = rig(vec![call("a", CallState::Connected)]);
        let _server = Server::start(sock(&dir), controller).await.unwrap();
        let path = sock(&dir);
        let p = path.clone();
        let answers = tokio::task::spawn_blocking(move || {
            vec![
                raw(&p, b"{\"cmd\":\"rm\"}\n"),
                raw(&p, b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"),
                raw(&p, b"{\"cmd\":\"hangup\",\"all\":true}\n"),
                raw(&p, b"{\"cmd\":\"hangup\",\"callId\":\"a b\"}\n"),
                raw(&p, &[b'x'; MAX_REQUEST_BYTES + 100]),
                raw(&p, &[0xff, 0xfe, b'\n']),
            ]
        })
        .await
        .unwrap();
        for a in &answers {
            let o: Outcome =
                serde_json::from_str(a.trim()).unwrap_or_else(|e| panic!("{a:?}: {e}"));
            assert_eq!(o.status, Status::Invalid, "{a}");
        }
        assert!(phone.log().is_empty(), "nothing reached the engine");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_socket_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let (controller, _, _) = rig(vec![]);
        let _server = Server::start(sock(&dir), controller).await.unwrap();
        let mode = std::fs::metadata(sock(&dir)).unwrap().permissions().mode();
        assert_eq!(mode & 0o077, 0, "no access for group or others: {mode:o}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_second_instance_does_not_steal_the_socket_but_a_stale_file_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let (c1, _, _) = rig(vec![]);
        let first = Server::start(sock(&dir), c1).await.unwrap();
        let (c2, _, _) = rig(vec![]);
        let err = Server::start(sock(&dir), c2.clone())
            .await
            .err()
            .expect("must refuse");
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);
        // The first one is still served.
        let p = sock(&dir);
        let o = tokio::task::spawn_blocking(move || send(&p, &Command::Status))
            .await
            .unwrap();
        assert_eq!(o.status, Status::Ok);

        drop(first);

        // A crash leaves the file behind (a listener that died without cleaning up); the next start takes it over.
        let dir2 = tempfile::tempdir().unwrap();
        let stale = sock(&dir2);
        drop(std::os::unix::net::UnixListener::bind(&stale).unwrap()); // file stays, nobody listens
        assert!(stale.exists());
        let (c3, _, _) = rig(vec![]);
        let _again = Server::start(stale.clone(), c3).await.unwrap();
        let o = tokio::task::spawn_blocking(move || send(&stale, &Command::Status))
            .await
            .unwrap();
        assert_eq!(o.status, Status::Ok);
    }

    #[tokio::test]
    async fn will_not_replace_a_file_that_is_not_a_socket() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(sock(&dir), "precious").unwrap();
        let (c, _, _) = rig(vec![]);
        assert!(Server::start(sock(&dir), c).await.is_err());
        assert_eq!(std::fs::read_to_string(sock(&dir)).unwrap(), "precious");
    }

    #[test]
    fn without_the_application_the_answer_is_disconnected() {
        let dir = tempfile::tempdir().unwrap();
        let o = send(&sock(&dir), &Command::Status);
        assert_eq!(o.status, Status::Disconnected);
    }

    #[test]
    fn long_paths_are_reported_instead_of_failing_obscurely() {
        let long = format!("/tmp/{}", "x".repeat(120));
        // SAFETY of the test: a distinct variable name per process is not needed; the value is restored.
        let previous = std::env::var_os(ENV_SOCKET);
        unsafe { std::env::set_var(ENV_SOCKET, &long) };
        let r = socket_path();
        match previous {
            Some(v) => unsafe { std::env::set_var(ENV_SOCKET, v) },
            None => unsafe { std::env::remove_var(ENV_SOCKET) },
        }
        assert!(r.unwrap_err().contains("too long"));
    }
}
