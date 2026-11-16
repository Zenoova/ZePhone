//! Interoperability tests against a REAL third-party PBX (FreeSWITCH), with real
//! Digest authentication, SIP routing, RTP relaying, hold, DTMF and REFER.
//!
//! Opt-in: set `ZEPHONE_TEST_PBX=127.0.0.1:15060` and `ZEPHONE_TEST_PBX_PASSWORD=...` and have
//! FreeSWITCH running with directory users 1000..1002 (see README "Test with FreeSWITCH").
//! Skipped otherwise.
//!
//! Run: `cargo test --test pbx_freeswitch -- --nocapture --test-threads=1`

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
            AccountSpec, AudioOverride, CallEvent, EngineEvent, RegistrationEvent, SipEngine,
            baresip::BaresipEngine,
        },
        manager::{EngineInfo, SipManager, UiSink},
        types::{
            AccountInput, AccountStatus, Call, CallDirection, CallResult, CallState,
            MediaEncryption, RegistrationState, Transport,
        },
    },
};

fn pbx() -> Option<(String, u16, String)> {
    let addr = std::env::var("ZEPHONE_TEST_PBX").ok()?;
    let pw = std::env::var("ZEPHONE_TEST_PBX_PASSWORD").ok()?;
    let (host, port) = addr.split_once(':')?;
    Some((host.to_owned(), port.parse().ok()?, pw))
}

#[derive(Default)]
struct Sink {
    statuses: Mutex<Vec<AccountStatus>>,
    calls: Mutex<Vec<Call>>,
    incoming: Mutex<Vec<Call>>,
    missed: Mutex<u32>,
}
impl UiSink for Sink {
    fn engine_state(&self, _: &EngineInfo) {}
    fn account_status(&self, s: &AccountStatus) {
        self.statuses.lock().unwrap().push(s.clone());
    }
    fn call_update(&self, c: &Call) {
        self.calls.lock().unwrap().push(c.clone());
    }
    fn history_changed(&self) {}
    fn incoming_call(&self, c: &Call, _: bool) {
        self.incoming.lock().unwrap().push(c.clone());
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

fn spec(user: &str, pw: &str, host: &str, port: u16) -> AccountSpec {
    AccountSpec {
        aor: format!("sip:{user}@{host}"),
        username: user.into(),
        domain: host.into(),
        auth_username: None,
        password: SecretString::from(pw.to_string()),
        display_name: None,
        transport: Transport::Udp,
        next_hop_host: host.into(),
        next_hop_port: port,
        register_interval: 120,
        media_encryption: MediaEncryption::None,
    }
}

async fn registered(rx: &mut tokio::sync::broadcast::Receiver<EngineEvent>) {
    let ev = wait_for(rx, 15, |e| {
        matches!(
            e,
            EngineEvent::Registration {
                event: RegistrationEvent::Registered { .. } | RegistrationEvent::Failed { .. },
                ..
            }
        )
    })
    .await
    .expect("registration outcome");
    assert!(
        matches!(
            ev,
            EngineEvent::Registration {
                event: RegistrationEvent::Registered { .. },
                ..
            }
        ),
        "registration failed: {ev:?}"
    );
}

#[tokio::test]
async fn freeswitch_wrong_password_is_reported_with_its_real_sip_code() {
    let Some((host, port, _)) = pbx() else {
        eprintln!("SKIPPED: ZEPHONE_TEST_PBX not set");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let Some(r) = remote_phone(tmp.path(), "r", 440, &tmp.path().join("r.wav"), None).await else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return;
    };
    let mut rx = r.subscribe();
    r.add_account(&spec("1002", "definitely-wrong", &host, port))
        .await
        .unwrap();
    let ev = wait_for(&mut rx, 20, |e| {
        matches!(
            e,
            EngineEvent::Registration {
                event: RegistrationEvent::Failed { .. } | RegistrationEvent::Registered { .. },
                ..
            }
        )
    })
    .await
    .expect("outcome");
    println!("FreeSWITCH answer to a wrong password: {ev:?}");
    match ev {
        EngineEvent::Registration {
            event: RegistrationEvent::Failed { code, .. },
            ..
        } => {
            assert!(matches!(code, Some(401) | Some(403)), "{code:?}");
        }
        other => panic!("a wrong password must not register: {other:?}"),
    }
    r.stop().await;
}

#[tokio::test]
async fn zephone_registers_and_makes_and_receives_calls_through_freeswitch() {
    let Some((host, port, pw)) = pbx() else {
        eprintln!("SKIPPED: ZEPHONE_TEST_PBX not set");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    let (m_rx, r_rx, t_rx) = (
        tmp.path().join("m.wav"),
        tmp.path().join("r.wav"),
        tmp.path().join("t.wav"),
    );

    // The remote phones: 1001 (callee) and 1002 (transfer target).
    let (Some(r), Some(t)) = (
        remote_phone(tmp.path(), "r", 880, &r_rx, None).await,
        remote_phone(tmp.path(), "t", 660, &t_rx, None).await,
    ) else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return;
    };
    let (mut er, mut et) = (r.subscribe(), t.subscribe());
    r.add_account(&spec("1001", &pw, &host, port))
        .await
        .unwrap();
    t.add_account(&spec("1002", &pw, &host, port))
        .await
        .unwrap();
    registered(&mut er).await;
    registered(&mut et).await;

    // ZePhone itself (real manager + real sidecar + SQLite) as extension 1000.
    let mut paths = sidecar_paths(tmp.path().join("m")).unwrap();
    let mods = tmp.path().join("m-modules");
    std::fs::create_dir_all(&mods).unwrap();
    for e in std::fs::read_dir(&paths.modules_dir).unwrap() {
        let p = e.unwrap().path();
        std::os::unix::fs::symlink(&p, mods.join(p.file_name().unwrap())).unwrap();
    }
    for m in ["ausine.so", "aufile.so"] {
        std::os::unix::fs::symlink(test_modules_dir().unwrap().join(m), mods.join(m)).unwrap();
    }
    paths.modules_dir = mods;
    let engine: Arc<dyn SipEngine> = Arc::new(BaresipEngine::new(paths));
    let db = Arc::new(Database::open_in_memory().unwrap());
    let sink = Arc::new(Sink::default());
    let secrets: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
    let mgr = SipManager::new(engine, db.clone(), secrets, sink.clone());
    let ov = AudioOverride {
        modules: vec!["ausine".into(), "aufile".into()],
        source: "ausine,440".into(),
        player: format!("aufile,{}", m_rx.display()),
    };
    mgr.set_options_hook(Arc::new(move |mut o| {
        o.net_interface = Some("127.0.0.1".into());
        o.audio_override = Some(ov.clone());
        o
    }));
    mgr.start().await.unwrap();

    let view = mgr
        .save_account(AccountInput {
            id: None,
            label: "FreeSWITCH test".into(),
            display_name: Some("ZePhone".into()),
            server: host.clone(),
            port: Some(port),
            domain: None,
            username: "1000".into(),
            auth_username: None,
            transport: Transport::Udp,
            outbound_proxy: None,
            register_interval: Some(120),
            media_encryption: MediaEncryption::None,
            enabled: true,
            password: Some(pw.clone()),
        })
        .await
        .unwrap();
    until("ZePhone registered on FreeSWITCH", 15, || {
        sink.statuses
            .lock()
            .unwrap()
            .last()
            .is_some_and(|s| s.state == RegistrationState::Registered)
    })
    .await;
    let seq: Vec<_> = sink
        .statuses
        .lock()
        .unwrap()
        .iter()
        .map(|s| (s.state, s.sip_code))
        .collect();
    println!("registration status sequence: {seq:?}");
    assert!(
        !seq.iter().any(|(s, _)| *s == RegistrationState::Error),
        "401 challenge must not surface as an error: {seq:?}"
    );

    db.save_contact(&zephone_lib::sip::types::ContactInput {
        id: None,
        first_name: "Extension".into(),
        last_name: "Mille-un".into(),
        company: None,
        number: "1001".into(),
    })
    .unwrap();

    // ---- ZePhone calls 1001 through the PBX (bare extension number)
    let call = mgr.dial("1001", None).await.expect("dial 1001");
    println!("dialled: {call:?}");
    let inc = wait_for(&mut er, 15, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    .expect("1001 rings");
    let r_call = match inc {
        EngineEvent::Call { call, .. } => {
            println!(
                "1001 sees caller {:?} / {:?}",
                call.peer_uri, call.peer_name
            );
            call.id
        }
        _ => unreachable!(),
    };
    until("ZePhone sees ringing", 15, || {
        sink.calls
            .lock()
            .unwrap()
            .iter()
            .any(|c| c.state == CallState::Ringing)
    })
    .await;
    r.accept(&r_call).await.unwrap();
    until("connected", 15, || {
        mgr.calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(2500)).await;

    // DTMF through the PBX.
    mgr.send_dtmf(&call.id, "7").await.unwrap();
    let d = wait_for(&mut er, 8, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Dtmf { .. },
                ..
            }
        )
    })
    .await;
    assert!(
        matches!(d, Some(EngineEvent::Call { event: CallEvent::Dtmf { ref key }, .. }) if key == "7"),
        "DTMF not relayed: {d:?}"
    );

    // Hold / resume through the PBX (re-INVITE). FreeSWITCH handles a hold itself (it plays
    // music-on-hold to the held leg) instead of relaying `sendonly` to the other leg, so the
    // remote phone is *not* notified: what matters is that the PBX accepts both re-INVITEs and
    // that the call survives and audio flows again after the resume.
    mgr.hold(&call.id).await.unwrap();
    until("ZePhone shows the call on hold", 10, || {
        mgr.calls()
            .first()
            .is_some_and(|c| c.state == CallState::OnHold && c.held_locally)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(1200)).await;
    mgr.resume(&call.id).await.unwrap();
    until("ZePhone shows the call resumed", 10, || {
        mgr.calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(2000)).await;
    assert!(
        mgr.calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected),
        "call died during hold/resume"
    );

    // Both directions carried audio through FreeSWITCH.
    r.hangup(&r_call, None).await.unwrap(); // remote hangs up
    until("history after remote hangup", 10, || {
        !db.list_history(&HistoryFilter::default())
            .unwrap()
            .is_empty()
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let sz = |p: &std::path::Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    println!(
        "audio bytes via PBX: ZePhone heard {} / 1001 heard {}",
        sz(&m_rx),
        sz(&r_rx)
    );
    assert!(sz(&m_rx) > 16_000, "ZePhone heard nothing through the PBX");
    assert!(sz(&r_rx) > 16_000, "1001 heard nothing through the PBX");
    let h = db.list_history(&HistoryFilter::default()).unwrap();
    assert_eq!(h[0].result, CallResult::Answered);
    assert_eq!(h[0].direction, CallDirection::Outgoing);
    assert_eq!(
        h[0].contact_name.as_deref(),
        Some("Extension Thousand-and-one")
    );
    assert_eq!(h[0].account_id.as_deref(), Some(view.account.id.as_str()));

    // ---- 1001 calls ZePhone: incoming, answered, then transferred to 1002
    let r_out = r
        .dial("sip:1001@127.0.0.1", "sip:1000@127.0.0.1")
        .await
        .expect("1001 calls 1000");
    until("ZePhone announces the incoming call", 15, || {
        !sink.incoming.lock().unwrap().is_empty()
    })
    .await;
    let inc = sink.incoming.lock().unwrap()[0].clone();
    println!("incoming as seen by ZePhone: {inc:?}");
    assert_eq!(inc.direction, CallDirection::Incoming);
    assert_eq!(inc.remote_number, "1001");
    assert_eq!(
        inc.remote_name.as_deref(),
        Some("Extension Thousand-and-one"),
        "contact name wins over the PBX display name"
    );
    mgr.answer(&inc.id).await.unwrap();
    until("incoming connected", 15, || {
        mgr.calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(1000)).await;

    mgr.transfer(&inc.id, "1002")
        .await
        .expect("blind transfer to 1002");
    let t_in = wait_for(&mut et, 20, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await;
    println!("transfer target 1002 got: {t_in:?}");
    assert!(
        t_in.is_some(),
        "the transfer target never rang: REFER was not honoured through the PBX"
    );
    if let Some(EngineEvent::Call { call, .. }) = t_in {
        t.accept(&call.id).await.unwrap();
    }
    until("ZePhone leg ends after transfer", 20, || {
        mgr.calls().is_empty()
    })
    .await;
    let _ = r_out;

    // ---- Missed call
    let before = *sink.missed.lock().unwrap();
    let r_out2 = r
        .dial("sip:1001@127.0.0.1", "sip:1000@127.0.0.1")
        .await
        .expect("second call");
    until("second incoming", 15, || {
        sink.incoming.lock().unwrap().len() >= 2
    })
    .await;
    r.hangup(&r_out2, None).await.unwrap();
    until("missed call", 15, || {
        *sink.missed.lock().unwrap() == before + 1
    })
    .await;
    assert!(
        db.list_history(&HistoryFilter::default())
            .unwrap()
            .iter()
            .any(|h| h.result == CallResult::Missed)
    );

    // Clean shutdown unregisters.
    mgr.shutdown().await;
    r.stop().await;
    t.stop().await;
}
