//! The remote control against REAL calls: the real `SipManager` + real Baresip sidecar, and a second real
//! Baresip acting as the other phone. Every action goes through the controller — the one the shortcuts, the tray
//! menu and `zephone ctl` use — and through the real control socket, and what is checked is what the engine
//! confirmed, never what was asked.
//!
//! Needs `scripts/prepare-baresip.sh` and the `ausine`/`aufile` test modules (skipped otherwise).

mod support;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use secrecy::SecretString;
use support::*;
use zephone_lib::{
    control::{
        command::{Command, Outcome, Status},
        controller::{Controller, Focus, Shell},
        socket,
    },
    database::Database,
    security::secrets::{MemoryStore, SecretStore},
    sip::{
        engine::{
            AccountSpec, AudioOverride, CallEvent, EngineEvent, SipEngine, baresip::BaresipEngine,
        },
        manager::{EngineInfo, SipManager, UiSink},
        types::{
            AccountInput, AccountStatus, Call, CallResult, CallState, MediaEncryption, Settings,
            Transport,
        },
    },
};

#[derive(Default)]
struct Sink {
    incoming: Mutex<u32>,
    settings_changes: Mutex<Vec<bool>>,
}
impl UiSink for Sink {
    fn engine_state(&self, _: &EngineInfo) {}
    fn account_status(&self, _: &AccountStatus) {}
    fn call_update(&self, _: &Call) {}
    fn history_changed(&self) {}
    fn incoming_call(&self, _: &Call, _: bool) {
        *self.incoming.lock().unwrap() += 1;
    }
    fn missed_call(&self, _: &Call, _: bool) {}
    fn audio_error(&self, _: &str) {}
    fn settings_changed(&self, s: &Settings) {
        self.settings_changes
            .lock()
            .unwrap()
            .push(s.general.do_not_disturb);
    }
}

#[derive(Default)]
struct ShellLog(Mutex<Vec<Option<Focus>>>);
impl Shell for ShellLog {
    fn show(&self, focus: Option<Focus>) {
        self.0.lock().unwrap().push(focus);
    }
}

async fn until(what: &str, secs: u64, mut f: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
    while tokio::time::Instant::now() < deadline {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("timed out waiting for: {what}");
}

fn free_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct World {
    mgr: Arc<SipManager>,
    db: Arc<Database>,
    ctl: Arc<Controller>,
    sink: Arc<Sink>,
    shell: Arc<ShellLog>,
    /// "The other phone".
    b: BaresipEngine,
    eb: tokio::sync::broadcast::Receiver<EngineEvent>,
    port_a: u16,
    _tmp: tempfile::TempDir,
}

async fn world() -> Option<World> {
    let tmp = tempfile::tempdir().unwrap();
    let (a_rx, b_rx) = (tmp.path().join("a.wav"), tmp.path().join("b.wav"));
    let (port_a, port_b) = (free_port(), free_port());
    let extra = test_modules_dir()?;

    // A = the application under test.
    let mut paths = sidecar_paths(tmp.path().join("engine"))?;
    let dir = tmp.path().join("modules");
    std::fs::create_dir_all(&dir).unwrap();
    for e in std::fs::read_dir(&paths.modules_dir).unwrap() {
        let p = e.unwrap().path();
        std::os::unix::fs::symlink(&p, dir.join(p.file_name().unwrap())).unwrap();
    }
    for m in ["ausine.so", "aufile.so"] {
        std::os::unix::fs::symlink(extra.join(m), dir.join(m)).unwrap();
    }
    paths.modules_dir = dir;
    let engine: Arc<dyn SipEngine> = Arc::new(BaresipEngine::new(paths));
    let db = Arc::new(Database::open_in_memory().unwrap());
    let sink = Arc::new(Sink::default());
    let secrets: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
    let mgr = SipManager::new(engine, db.clone(), secrets, sink.clone());
    let audio = AudioOverride {
        modules: vec!["ausine".into(), "aufile".into()],
        source: "ausine,440".into(),
        player: format!("aufile,{}", a_rx.display()),
    };
    mgr.set_options_hook(Arc::new(move |mut o| {
        o.net_interface = Some("127.0.0.1".into());
        o.local_sip_port = Some(port_a);
        o.audio_override = Some(audio.clone());
        o
    }));
    mgr.start().await.ok()?;
    mgr.save_account(AccountInput {
        id: None,
        label: "alice test".into(),
        display_name: None,
        server: "127.0.0.1".into(),
        port: Some(port_b),
        domain: Some("127.0.0.1".into()),
        username: "alice".into(),
        auth_username: None,
        transport: Transport::Udp,
        outbound_proxy: Some(format!("127.0.0.1:{port_b}")),
        register_interval: Some(0),
        media_encryption: MediaEncryption::None,
        enabled: true,
        password: Some("pw".into()),
    })
    .await
    .ok()?;

    // B = a plain Baresip, whose every SIP message goes to A.
    let b = remote_phone(tmp.path(), "b", 880, &b_rx, Some(port_b)).await?;
    let eb = b.subscribe();
    b.add_account(&AccountSpec {
        aor: "sip:bob@127.0.0.1".into(),
        username: "bob".into(),
        domain: "127.0.0.1".into(),
        auth_username: None,
        password: SecretString::from("x".to_string()),
        display_name: Some("Bob Remote".into()),
        transport: Transport::Udp,
        next_hop_host: "127.0.0.1".into(),
        next_hop_port: port_a,
        register_interval: 0,
        media_encryption: MediaEncryption::None,
    })
    .await
    .ok()?;

    let shell = Arc::new(ShellLog::default());
    let ctl = Controller::new(mgr.clone(), shell.clone());
    until("account hosted", 10, || {
        !mgr.connected_account_ids().is_empty()
    })
    .await;
    Some(World {
        mgr,
        db,
        ctl,
        sink,
        shell,
        b,
        eb,
        port_a,
        _tmp: tmp,
    })
}

macro_rules! world_or_skip {
    () => {
        match world().await {
            Some(w) => w,
            None => {
                eprintln!("SKIPPED: run scripts/prepare-baresip.sh (and install baresip for the test modules)");
                return;
            }
        }
    };
}

fn calls_of(w: &World) -> Vec<Call> {
    w.mgr.calls()
}

#[tokio::test]
async fn real_calls_driven_only_through_the_controller() {
    let mut w = world_or_skip!();
    let port_a = w.port_a;

    // Nothing to act on: nothing happens, and nothing breaks.
    for cmd in [
        Command::Answer { call_id: None },
        Command::Hangup { call_id: None },
        Command::Mute {
            call_id: None,
            muted: None,
        },
    ] {
        assert_eq!(w.ctl.execute(cmd).await.status, Status::Unavailable);
    }

    // ---- an incoming call is answered by the "answer" command, without naming it
    let b_out =
        w.b.dial(
            "sip:bob@127.0.0.1",
            &format!("sip:alice@127.0.0.1:{port_a}"),
        )
        .await
        .expect("B calls A");
    until("A rings", 10, || {
        calls_of(&w).iter().any(|c| c.state == CallState::Incoming)
    })
    .await;
    let ringing = calls_of(&w)[0].clone();

    // While it rings, "hang up" must not decline it, and "mute" has nothing to act on yet.
    assert_eq!(
        w.ctl
            .execute(Command::Hangup { call_id: None })
            .await
            .status,
        Status::Unavailable
    );
    assert_eq!(calls_of(&w)[0].state, CallState::Incoming, "still ringing");

    let o = w.ctl.execute(Command::Answer { call_id: None }).await;
    assert_eq!(o.status, Status::Ok);
    assert!(!o.settled, "accepted by the engine, not yet connected");
    until("connected", 10, || {
        calls_of(&w)
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    assert_eq!(calls_of(&w)[0].id, ringing.id);

    // ---- microphone: toggle, then explicit and repeated
    let o = w
        .ctl
        .execute(Command::Mute {
            call_id: None,
            muted: None,
        })
        .await;
    assert!(
        o.is_ok() && o.settled && o.call.as_ref().unwrap().muted,
        "{o:?}"
    );
    assert!(calls_of(&w)[0].muted, "the manager's own state agrees");
    let again = w
        .ctl
        .execute(Command::Mute {
            call_id: None,
            muted: Some(true),
        })
        .await;
    assert!(
        again.is_ok() && !again.changed,
        "already muted: nothing more is asked"
    );
    assert!(calls_of(&w)[0].muted);
    let o = w
        .ctl
        .execute(Command::Mute {
            call_id: None,
            muted: Some(false),
        })
        .await;
    assert!(o.changed && !o.call.unwrap().muted);
    assert!(!calls_of(&w)[0].muted);

    // ---- hold and resume
    let o = w
        .ctl
        .execute(Command::Hold {
            call_id: None,
            held: Some(true),
        })
        .await;
    assert!(o.is_ok() && o.call.as_ref().unwrap().held_locally, "{o:?}");
    let o = w
        .ctl
        .execute(Command::Hold {
            call_id: None,
            held: Some(true),
        })
        .await;
    assert!(!o.changed, "already on hold");
    tokio::time::sleep(Duration::from_millis(600)).await; // let the re-INVITE settle
    let o = w
        .ctl
        .execute(Command::Hold {
            call_id: None,
            held: None,
        })
        .await;
    assert!(o.is_ok() && !o.call.unwrap().held_locally, "toggle resumes");
    tokio::time::sleep(Duration::from_millis(600)).await;

    // ---- hang up, with the call named by its identifier, and only that call
    let id = calls_of(&w)[0].id.clone();
    let o = w
        .ctl
        .execute(Command::Hangup {
            call_id: Some("nonexistent".into()),
        })
        .await;
    assert_eq!(o.status, Status::NotFound);
    assert_eq!(
        calls_of(&w).len(),
        1,
        "the unknown identifier hung nothing up"
    );
    let o = w.ctl.execute(Command::Hangup { call_id: Some(id) }).await;
    assert!(o.is_ok() && !o.settled);
    until("call ended", 10, || calls_of(&w).is_empty()).await;
    let _ = b_out;
}

#[tokio::test]
async fn real_outgoing_call_declined_and_do_not_disturb() {
    let mut w = world_or_skip!();
    let port_a = w.port_a;

    // ---- an outgoing call started by the controller
    let o = w
        .ctl
        .execute(Command::Dial {
            target: "bob@127.0.0.1".into(),
            account: None,
        })
        .await;
    assert_eq!(o.status, Status::Ok, "{o:?}");
    assert!(!o.settled);
    let incoming = wait_for(&mut w.eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    .expect("B rings");
    let b_call = match incoming {
        EngineEvent::Call { call, .. } => call.id,
        _ => unreachable!(),
    };
    // A second dial while the first is being set up must not start a second call.
    let second = w
        .ctl
        .execute(Command::Dial {
            target: "bob@127.0.0.1".into(),
            account: None,
        })
        .await;
    assert_eq!(second.status, Status::Unavailable, "{second:?}");
    assert_eq!(calls_of(&w).len(), 1);

    // While it rings, hanging up cancels it (it is an outgoing call, not an incoming one).
    let o = w.ctl.execute(Command::Hangup { call_id: None }).await;
    assert_eq!(o.status, Status::Ok);
    until("cancelled", 10, || calls_of(&w).is_empty()).await;
    let _ = b_call;
    tokio::time::sleep(Duration::from_millis(300)).await;

    // ---- do not disturb: B calls A, A declines before anything rings
    let o = w.ctl.execute(Command::Dnd { enabled: None }).await;
    assert!(o.is_ok() && o.changed, "{o:?}");
    assert!(w.mgr.do_not_disturb().unwrap());
    assert_eq!(
        *w.sink.settings_changes.lock().unwrap(),
        [true],
        "the interface was told"
    );
    let announced = *w.sink.incoming.lock().unwrap();
    let mut eb2 = w.b.subscribe();
    w.b.dial(
        "sip:bob@127.0.0.1",
        &format!("sip:alice@127.0.0.1:{port_a}"),
    )
    .await
    .expect("B calls A");
    let closed = wait_for(&mut eb2, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        )
    })
    .await
    .expect("B's call ends");
    match closed {
        EngineEvent::Call {
            event: CallEvent::Closed { code, .. },
            ..
        } => assert_eq!(code, Some(486), "the caller hears Busy Here"),
        _ => unreachable!(),
    }
    assert_eq!(
        *w.sink.incoming.lock().unwrap(),
        announced,
        "nothing rang on A"
    );
    assert!(calls_of(&w).is_empty());
    until("recorded as missed", 10, || {
        w.db.list_history(&Default::default())
            .is_ok_and(|h| h.iter().any(|e| e.result == CallResult::Missed))
    })
    .await;

    // Off again.
    let o = w
        .ctl
        .execute(Command::Dnd {
            enabled: Some(false),
        })
        .await;
    assert!(o.changed);
    assert!(!w.mgr.do_not_disturb().unwrap());

    // ---- window commands reach the shell
    w.ctl.execute(Command::ShowDialer).await;
    assert_eq!(*w.shell.0.lock().unwrap(), [Some(Focus::Dialer)]);
}

#[tokio::test]
async fn the_command_line_socket_drives_the_real_application_core() {
    let w = world_or_skip!();
    let port_a = w.port_a;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("c.sock");
    let server = socket::Server::start(path.clone(), w.ctl.clone())
        .await
        .unwrap();
    let ask = |cmd: Command| {
        let p = path.clone();
        async move {
            tokio::task::spawn_blocking(move || socket::send(&p, &cmd))
                .await
                .unwrap()
        }
    };

    let status: Outcome = ask(Command::Status).await;
    let app = status.app.expect("status");
    assert!(app.engine_running && app.calls.is_empty());
    assert_eq!(app.accounts.len(), 1);
    assert!(app.accounts[0].connected);

    w.b.dial(
        "sip:bob@127.0.0.1",
        &format!("sip:alice@127.0.0.1:{port_a}"),
    )
    .await
    .unwrap();
    until("rings", 10, || {
        calls_of(&w).iter().any(|c| c.state == CallState::Incoming)
    })
    .await;
    assert_eq!(
        ask(Command::Answer { call_id: None }).await.status,
        Status::Ok
    );
    until("connected", 10, || {
        calls_of(&w)
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    let o = ask(Command::Mute {
        call_id: None,
        muted: Some(true),
    })
    .await;
    assert!(o.is_ok() && o.call.unwrap().muted);
    let status = ask(Command::Status).await.app.unwrap();
    assert!(
        status.calls[0].muted,
        "the status reports what the engine confirmed"
    );
    assert_eq!(
        ask(Command::Hangup { call_id: None }).await.status,
        Status::Ok
    );
    until("ended", 10, || calls_of(&w).is_empty()).await;
    drop(server);
    assert_eq!(ask(Command::Status).await.status, Status::Disconnected);
}
