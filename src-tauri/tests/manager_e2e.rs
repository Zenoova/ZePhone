//! Full-stack tests WITHOUT the webview: the real `SipManager` + real Baresip sidecar +
//! SQLite, talking to a second real Baresip instance (the "remote party") and to a
//! fake registrar. Verifies account status, calls, history and notifications end to end.
//!
//! Needs `scripts/prepare-baresip.sh` (skipped otherwise) and the `ausine`/`aufile`
//! test modules from a local Baresip install for the audio part.

mod support;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use secrecy::SecretString;
use support::*;
use zephone_lib::{
    database::{Database, HistoryFilter},
    security::secrets::{MemoryStore, SecretStore},
    sip::{
        engine::{
            AccountSpec, AudioOverride, CallEvent, EngineEvent, SipEngine, baresip::BaresipEngine,
        },
        manager::{EngineInfo, SipManager, UiSink},
        types::{
            AccountInput, AccountStatus, Call, CallDirection, CallResult, CallState,
            MediaEncryption, RegistrationState, Transport,
        },
    },
};

#[derive(Default)]
struct Sink {
    statuses: Mutex<Vec<AccountStatus>>,
    calls: Mutex<Vec<Call>>,
    incoming: Mutex<Vec<(Call, bool)>>,
    missed: Mutex<u32>,
    history_changes: Mutex<u32>,
}
impl UiSink for Sink {
    fn engine_state(&self, _: &EngineInfo) {}
    fn account_status(&self, s: &AccountStatus) {
        self.statuses.lock().unwrap().push(s.clone());
    }
    fn call_update(&self, c: &Call) {
        self.calls.lock().unwrap().push(c.clone());
    }
    fn history_changed(&self) {
        *self.history_changes.lock().unwrap() += 1;
    }
    fn incoming_call(&self, c: &Call, n: bool) {
        self.incoming.lock().unwrap().push((c.clone(), n));
    }
    fn missed_call(&self, _: &Call, _: bool) {
        *self.missed.lock().unwrap() += 1;
    }
    fn audio_error(&self, _: &str) {}
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

fn input(user: &str, pw: &str, port: u16, regint: u32, proxy: Option<String>) -> AccountInput {
    AccountInput {
        id: None,
        label: format!("{user} test"),
        display_name: None,
        server: "127.0.0.1".into(),
        port: Some(port),
        domain: Some("127.0.0.1".into()),
        username: user.into(),
        auth_username: None,
        transport: Transport::Udp,
        outbound_proxy: proxy,
        register_interval: Some(regint),
        media_encryption: MediaEncryption::None,
        enabled: true,
        password: Some(pw.into()),
    }
}

struct Rig {
    mgr: Arc<SipManager>,
    sink: Arc<Sink>,
    db: Arc<Database>,
    _tmp: tempfile::TempDir,
}

/// Builds a manager around a real sidecar. `audio` swaps the sound card for synthetic audio.
async fn rig(local_port: Option<u16>, audio: Option<(&str, std::path::PathBuf)>) -> Option<Rig> {
    let tmp = tempfile::tempdir().unwrap();
    let mut paths = sidecar_paths(tmp.path().join("engine"))?;
    if let Some((_, _)) = &audio {
        let extra = test_modules_dir()?;
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
    }
    let engine: Arc<dyn SipEngine> = Arc::new(BaresipEngine::new(paths));
    let db = Arc::new(Database::open_in_memory().unwrap());
    let sink = Arc::new(Sink::default());
    let secrets: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
    let mgr = SipManager::new(engine, db.clone(), secrets, sink.clone());
    let audio = audio.map(|(freq, rx)| AudioOverride {
        modules: vec!["ausine".into(), "aufile".into()],
        source: format!("ausine,{freq}"),
        player: format!("aufile,{}", rx.display()),
    });
    mgr.set_options_hook(Arc::new(move |mut o| {
        o.net_interface = Some("127.0.0.1".into()); // Baresip ignores loopback otherwise
        o.local_sip_port = local_port;
        o.audio_override = audio.clone();
        o
    }));
    mgr.start().await.expect("manager starts the real engine");
    Some(Rig {
        mgr,
        sink,
        db,
        _tmp: tmp,
    })
}

macro_rules! rig_or_skip {
    ($($arg:expr),*) => {
        match rig($($arg),*).await {
            Some(r) => r,
            None => {
                eprintln!("SKIPPED: run scripts/prepare-baresip.sh (and install baresip for the test modules)");
                return;
            }
        }
    };
}

fn last_status(sink: &Sink) -> Option<AccountStatus> {
    sink.statuses.lock().unwrap().last().cloned()
}

#[tokio::test]
async fn account_registers_via_digest_and_reports_real_errors() {
    let reg = FakeRegistrar::start(RegistrarMode::Digest, "1001", "p;ss w0rd?").await;
    let r = rig_or_skip!(None, None);

    // Wrong password first: the final outcome must be a 401 error, with a diagnostic.
    let bad = r
        .mgr
        .save_account(input("1001", "nope", reg.port, 300, None))
        .await
        .unwrap();
    until("401 error", 15, || {
        last_status(&r.sink)
            .is_some_and(|s| s.state == RegistrationState::Error && s.sip_code == Some(401))
    })
    .await;
    let s = last_status(&r.sink).unwrap();
    assert!(s.message.as_deref().unwrap_or("").contains("401"), "{s:?}");

    // The user fixes the password in the form: same account, now it registers.
    let mut fix = input("1001", "p;ss w0rd?", reg.port, 300, None);
    fix.id = Some(bad.account.id.clone());
    r.mgr.save_account(fix).await.unwrap();
    until("registered", 15, || {
        last_status(&r.sink).is_some_and(|s| s.state == RegistrationState::Registered)
    })
    .await;
    let s = last_status(&r.sink).unwrap();
    assert_eq!(s.sip_code, Some(200));
    assert_eq!(s.account_id, bad.account.id);

    // Between the failure and the success there was a "connecting" phase, never a stale error.
    let seq: Vec<_> = r
        .sink
        .statuses
        .lock()
        .unwrap()
        .iter()
        .map(|s| s.state)
        .collect();
    let first_err = seq
        .iter()
        .position(|s| *s == RegistrationState::Error)
        .unwrap();
    assert!(
        seq[first_err..].contains(&RegistrationState::Connecting),
        "{seq:?}"
    );

    // Disconnect really unregisters (status), reconnect registers again.
    r.mgr.disconnect_account(&bad.account.id).await.unwrap();
    assert_eq!(
        last_status(&r.sink).unwrap().state,
        RegistrationState::Disconnected
    );
    r.mgr.connect_account(&bad.account.id).await.unwrap();
    until("re-registered", 15, || {
        last_status(&r.sink).is_some_and(|s| s.state == RegistrationState::Registered)
    })
    .await;

    // Passwords never reach the engine log.
    let logs = r.mgr.log_tail(400).join("\n");
    assert!(
        !logs.contains("p;ss w0rd") && !logs.contains("nope"),
        "password leaked:\n{logs}"
    );
    r.mgr.shutdown().await;
}

#[tokio::test]
async fn unreachable_pbx_does_not_crash_anything() {
    let r = rig_or_skip!(None, None);
    let closed = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let mut i = input("1001", "pw", closed, 300, None);
    i.transport = Transport::Tcp;
    let view = r.mgr.save_account(i).await.unwrap();
    until("error status", 20, || {
        last_status(&r.sink).is_some_and(|s| s.state == RegistrationState::Error)
    })
    .await;
    let s = last_status(&r.sink).unwrap();
    assert!(s.message.unwrap().starts_with("Connexion refusée"));
    assert!(
        r.mgr.engine_info().codecs.contains(&"PCMU".to_string()),
        "engine still alive"
    );
    // Still usable: the user can remove the bad account.
    r.mgr.delete_account(&view.account.id).await.unwrap();
    r.mgr.shutdown().await;
}

#[tokio::test]
async fn full_call_cycle_through_the_manager_with_audio_and_history() {
    let tmp = tempfile::tempdir().unwrap();
    let (a_rx, b_rx) = (tmp.path().join("a_rx.wav"), tmp.path().join("b_rx.wav"));
    let port_a = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let port_b = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();

    // A = the application under test (manager). B = a plain Baresip acting as the remote phone.
    let a = rig_or_skip!(Some(port_a), Some(("440", a_rx.clone())));
    let Some(modules) = test_modules_dir() else {
        return;
    };
    let mut b_paths = sidecar_paths(tmp.path().join("b")).unwrap();
    let bm = tmp.path().join("bmods");
    std::fs::create_dir_all(&bm).unwrap();
    for e in std::fs::read_dir(&b_paths.modules_dir).unwrap() {
        let p = e.unwrap().path();
        std::os::unix::fs::symlink(&p, bm.join(p.file_name().unwrap())).unwrap();
    }
    for m in ["ausine.so", "aufile.so"] {
        std::os::unix::fs::symlink(modules.join(m), bm.join(m)).unwrap();
    }
    b_paths.modules_dir = bm;
    let b = BaresipEngine::new(b_paths);
    b.set_options(zephone_lib::sip::engine::EngineOptions {
        local_sip_port: Some(port_b),
        net_interface: Some("127.0.0.1".into()),
        audio_override: Some(AudioOverride {
            modules: vec!["ausine".into(), "aufile".into()],
            source: "ausine,880".into(),
            player: format!("aufile,{}", b_rx.display()),
        }),
        ..Default::default()
    });
    b.start().await.unwrap();
    let mut eb = b.subscribe();
    b.add_account(&AccountSpec {
        aor: "sip:bob@127.0.0.1".into(),
        username: "bob".into(),
        domain: "127.0.0.1".into(),
        auth_username: None,
        password: SecretString::from("x".to_string()),
        display_name: Some("Bob Remote".into()),
        transport: Transport::Udp,
        next_hop_host: "127.0.0.1".into(),
        next_hop_port: port_a, // everything B sends goes to A
        register_interval: 0,
        media_encryption: MediaEncryption::None,
    })
    .await
    .unwrap();

    // A's account: direct calls (no registration), outbound proxy = B.
    let acc = a
        .mgr
        .save_account(input(
            "alice",
            "pw",
            port_b,
            0,
            Some(format!("127.0.0.1:{port_b}")),
        ))
        .await
        .unwrap();
    until("account hosted", 10, || {
        last_status(&a.sink).is_some_and(|s| s.account_id == acc.account.id)
    })
    .await;

    // A contact in the address book: the call must be labelled with it.
    a.db.save_contact(&zephone_lib::sip::types::ContactInput {
        id: None,
        first_name: "Bob".into(),
        last_name: "Remote".into(),
        company: None,
        number: "bob".into(),
    })
    .unwrap();

    // ---- 1. Outgoing call A -> B
    let call = a
        .mgr
        .dial(&format!("bob@127.0.0.1:{port_b}"), None)
        .await
        .expect("dial through the manager");
    assert_eq!(call.remote_name.as_deref(), Some("Bob Remote"));
    let incoming = wait_for(&mut eb, 10, |e| {
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
    until("A sees ringing", 10, || {
        a.sink
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|c| c.state == CallState::Ringing)
    })
    .await;
    b.accept(&b_call).await.unwrap();
    until("A connected", 10, || {
        a.sink
            .calls
            .lock()
            .unwrap()
            .last()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;

    a.mgr.set_mute(&call.id, true).await.unwrap();
    assert!(a.mgr.calls()[0].muted);
    a.mgr.set_mute(&call.id, false).await.unwrap();
    a.mgr.send_dtmf(&call.id, "42#").await.unwrap();
    // (Hold/resume are exercised on the second call: re-INVITEs make Baresip re-create its
    // file player, which would truncate the WAV used to measure the audio of this call.)
    tokio::time::sleep(Duration::from_millis(2500)).await; // audio flows
    a.mgr.hangup(&call.id).await.unwrap();
    until("A history", 10, || {
        !a.db
            .list_history(&HistoryFilter::default())
            .unwrap()
            .is_empty()
    })
    .await;
    let h = a.db.list_history(&HistoryFilter::default()).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].direction, CallDirection::Outgoing);
    assert_eq!(h[0].result, CallResult::Answered);
    assert!(
        h[0].duration_secs >= 2,
        "real duration measured: {}",
        h[0].duration_secs
    );
    assert_eq!(h[0].contact_name.as_deref(), Some("Bob Remote"));
    assert_eq!(h[0].account_id.as_deref(), Some(acc.account.id.as_str()));
    assert!(a.mgr.calls().is_empty());

    // Audio really crossed the wire both ways during this managed call. Baresip's file
    // player truncates its WAV when the next call starts, so measure it right now.
    wait_for(&mut eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        )
    })
    .await
    .expect("B sees the hangup");
    let sz = |p: &std::path::Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    // The WAV writer buffers and flushes when the stream is closed, which can lag behind the
    // SIP hangup: wait (bounded) until both files hold audio, then measure.
    let mut last = (0, 0);
    for _ in 0..40 {
        last = (sz(&a_rx), sz(&b_rx));
        if last.0 > 16_000 && last.1 > 16_000 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let (heard_by_a, heard_by_b) = last;
    println!("audio received during call 1: A={heard_by_a} bytes, B={heard_by_b} bytes");
    assert!(
        heard_by_a > 16_000,
        "A heard nothing from B ({heard_by_a} bytes)\n--- A engine log ---\n{}",
        a.mgr.log_tail(80).join("\n")
    );
    assert!(
        heard_by_b > 16_000,
        "B heard nothing from A ({heard_by_b} bytes)"
    );

    // ---- 2. Incoming call B -> A, answered by the user
    let aor_a = "sip:alice@127.0.0.1";
    let b_out = b
        .dial(
            "sip:bob@127.0.0.1",
            &format!("sip:alice@127.0.0.1:{port_a}"),
        )
        .await
        .expect("B calls A");
    until("A announces the incoming call", 10, || {
        !a.sink.incoming.lock().unwrap().is_empty()
    })
    .await;
    let (inc, notify) = a.sink.incoming.lock().unwrap()[0].clone();
    assert!(notify, "native notification requested by default settings");
    assert_eq!(inc.direction, CallDirection::Incoming);
    assert_eq!(inc.state, CallState::Incoming);
    assert_eq!(inc.remote_name.as_deref(), Some("Bob Remote"));
    assert_eq!(inc.remote_number, "bob");
    assert_eq!(inc.account_id.as_deref(), Some(acc.account.id.as_str()));
    a.mgr.answer(&inc.id).await.unwrap();
    until("incoming answered", 10, || {
        a.mgr
            .calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    a.mgr.hold(&inc.id).await.unwrap();
    until("incoming call on hold", 10, || {
        a.mgr
            .calls()
            .first()
            .is_some_and(|c| c.state == CallState::OnHold && c.held_locally)
    })
    .await;
    a.mgr.resume(&inc.id).await.unwrap();
    until("incoming call resumed", 10, || {
        a.mgr
            .calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected && !c.held_locally)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    b.hangup(&b_out, None).await.unwrap(); // remote hangs up
    until("incoming history", 10, || {
        a.db.list_history(&HistoryFilter::default()).unwrap().len() == 2
    })
    .await;
    let h = a.db.list_history(&HistoryFilter::default()).unwrap();
    assert_eq!(h[0].direction, CallDirection::Incoming);
    assert_eq!(h[0].result, CallResult::Answered);
    let _ = aor_a;

    // ---- 3. Missed call: B calls, then gives up before A answers
    let b_out = b
        .dial(
            "sip:bob@127.0.0.1",
            &format!("sip:alice@127.0.0.1:{port_a}"),
        )
        .await
        .unwrap();
    until("second incoming", 10, || {
        a.sink.incoming.lock().unwrap().len() == 2
    })
    .await;
    b.hangup(&b_out, None).await.unwrap();
    until("missed recorded", 10, || {
        *a.sink.missed.lock().unwrap() == 1
    })
    .await;
    let h = a.db.list_history(&HistoryFilter::default()).unwrap();
    assert_eq!(h[0].result, CallResult::Missed);
    assert_eq!(h[0].direction, CallDirection::Incoming);

    // ---- 4. Rejected incoming call
    let b_out = b
        .dial(
            "sip:bob@127.0.0.1",
            &format!("sip:alice@127.0.0.1:{port_a}"),
        )
        .await
        .unwrap();
    until("third incoming", 10, || {
        a.sink.incoming.lock().unwrap().len() == 3
    })
    .await;
    let id = a.sink.incoming.lock().unwrap()[2].0.id.clone();
    a.mgr.reject(&id).await.unwrap();
    until("rejected recorded", 10, || {
        a.db.list_history(&HistoryFilter::default()).unwrap().len() == 4
    })
    .await;
    assert_eq!(
        a.db.list_history(&HistoryFilter::default()).unwrap()[0].result,
        CallResult::Rejected
    );
    assert_eq!(
        *a.sink.missed.lock().unwrap(),
        1,
        "a declined call is not 'missed'"
    );
    let _ = b_out;

    a.mgr.shutdown().await;
    b.stop().await;
}
