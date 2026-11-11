//! Manager tests with a scripted engine: no process, no network, deterministic.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use secrecy::ExposeSecret;
use tokio::sync::broadcast;

use super::*;
use crate::{
    security::secrets::MemoryStore,
    sip::{
        engine::{CallEvent, CallRef, EngineError, EngineResult, RegistrationEvent},
        types::{CallDirection, MediaEncryption, Transport},
    },
};

// ------------------------------------------------------------------ fakes

struct FakeEngine {
    tx: broadcast::Sender<EngineEvent>,
    state: Mutex<EngineState>,
    added: Mutex<Vec<(String, String, u32, String)>>, // aor, password, regint, next hop
    commands: Mutex<Vec<String>>,
    next_call: AtomicU32,
    fail_add: AtomicBool,
}

impl FakeEngine {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            tx: broadcast::channel(256).0,
            state: Mutex::new(EngineState::Stopped),
            added: Default::default(),
            commands: Default::default(),
            next_call: AtomicU32::new(1),
            fail_add: AtomicBool::new(false),
        })
    }
    fn emit(&self, ev: EngineEvent) {
        let _ = self.tx.send(ev);
    }
    fn set_state(&self, st: EngineState) {
        *self.state.lock().unwrap() = st.clone();
        self.emit(EngineEvent::State(st));
    }
    fn cmds(&self) -> Vec<String> {
        self.commands.lock().unwrap().clone()
    }
    fn log(&self, s: impl Into<String>) {
        self.commands.lock().unwrap().push(s.into());
    }
}

#[async_trait]
impl SipEngine for FakeEngine {
    fn name(&self) -> &'static str {
        "fake"
    }
    fn version(&self) -> Option<String> {
        Some("0.0".into())
    }
    fn codecs(&self) -> Vec<String> {
        vec!["PCMU".into(), "PCMA".into()]
    }
    async fn start(&self) -> EngineResult<()> {
        self.set_state(EngineState::Running);
        Ok(())
    }
    async fn stop(&self) {
        self.log("stop");
        self.set_state(EngineState::Stopped);
    }
    fn state(&self) -> EngineState {
        self.state.lock().unwrap().clone()
    }
    fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.tx.subscribe()
    }
    async fn add_account(&self, spec: &AccountSpec) -> EngineResult<()> {
        if self.fail_add.load(Ordering::SeqCst) {
            return Err(EngineError::CommandFailed("boom".into()));
        }
        self.added.lock().unwrap().push((
            spec.aor.clone(),
            spec.password.expose_secret().to_owned(),
            spec.register_interval,
            format!("{}:{}", spec.next_hop_host, spec.next_hop_port),
        ));
        Ok(())
    }
    async fn remove_account(&self, aor: &str) -> EngineResult<()> {
        self.log(format!("remove {aor}"));
        Ok(())
    }
    async fn dial(&self, aor: &str, target: &str) -> EngineResult<String> {
        self.log(format!("dial {aor} {target}"));
        Ok(format!(
            "call{}",
            self.next_call.fetch_add(1, Ordering::SeqCst)
        ))
    }
    async fn accept(&self, id: &str) -> EngineResult<()> {
        self.log(format!("accept {id}"));
        Ok(())
    }
    async fn hangup(&self, id: &str, reject: Option<u16>) -> EngineResult<()> {
        self.log(
            format!(
                "hangup {id} {}",
                reject.map(|c| c.to_string()).unwrap_or_default()
            )
            .trim()
            .to_owned(),
        );
        Ok(())
    }
    async fn hold(&self, id: &str) -> EngineResult<()> {
        self.log(format!("hold {id}"));
        Ok(())
    }
    async fn resume(&self, id: &str) -> EngineResult<()> {
        self.log(format!("resume {id}"));
        Ok(())
    }
    async fn set_mute(&self, id: &str, muted: bool) -> EngineResult<()> {
        self.log(format!("mute {id} {muted}"));
        Ok(())
    }
    async fn send_dtmf(&self, id: &str, digits: &str) -> EngineResult<()> {
        self.log(format!("dtmf {id} {digits}"));
        Ok(())
    }
    async fn transfer(&self, id: &str, target: &str) -> EngineResult<()> {
        self.log(format!("transfer {id} {target}"));
        Ok(())
    }
    async fn silence_ringtone(&self) -> EngineResult<()> {
        self.log("silence");
        Ok(())
    }
    async fn set_audio_devices(
        &self,
        input: Option<&str>,
        output: Option<&str>,
    ) -> EngineResult<()> {
        self.log(format!("audio {input:?} {output:?}"));
        Ok(())
    }
    fn set_options(&self, _o: EngineOptions) {}
    fn log_tail(&self, _n: usize) -> Vec<String> {
        vec![]
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Seen {
    Engine,
    Status(AccountStatus),
    Call(Call),
    History,
    Incoming { call: Call, notify: bool },
    Missed { notify: bool },
    AudioError(String),
    Level { call_id: String, tx: bool },
}

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<Seen>>,
}
impl RecordingSink {
    fn all(&self) -> Vec<Seen> {
        self.events.lock().unwrap().clone()
    }
    fn statuses(&self) -> Vec<AccountStatus> {
        self.all()
            .into_iter()
            .filter_map(|e| {
                if let Seen::Status(s) = e {
                    Some(s)
                } else {
                    None
                }
            })
            .collect()
    }
    fn calls(&self) -> Vec<Call> {
        self.all()
            .into_iter()
            .filter_map(|e| if let Seen::Call(c) = e { Some(c) } else { None })
            .collect()
    }
}
impl UiSink for RecordingSink {
    fn engine_state(&self, _i: &EngineInfo) {
        self.events.lock().unwrap().push(Seen::Engine);
    }
    fn account_status(&self, s: &AccountStatus) {
        self.events.lock().unwrap().push(Seen::Status(s.clone()));
    }
    fn call_update(&self, c: &Call) {
        self.events.lock().unwrap().push(Seen::Call(c.clone()));
    }
    fn history_changed(&self) {
        self.events.lock().unwrap().push(Seen::History);
    }
    fn incoming_call(&self, c: &Call, notify: bool) {
        self.events.lock().unwrap().push(Seen::Incoming {
            call: c.clone(),
            notify,
        });
    }
    fn missed_call(&self, _c: &Call, notify: bool) {
        self.events.lock().unwrap().push(Seen::Missed { notify });
    }
    fn audio_error(&self, m: &str) {
        self.events
            .lock()
            .unwrap()
            .push(Seen::AudioError(m.to_owned()));
    }
}

struct Rig {
    engine: Arc<FakeEngine>,
    sink: Arc<RecordingSink>,
    db: Arc<Database>,
    secrets: Arc<MemoryStore>,
    mgr: Arc<SipManager>,
}

fn input(user: &str, password: Option<&str>) -> AccountInput {
    AccountInput {
        id: None,
        label: "Bureau".into(),
        display_name: Some("Ada".into()),
        server: "sip.example.com".into(),
        port: Some(5060),
        domain: Some("example.com".into()),
        username: user.into(),
        auth_username: None,
        transport: Transport::Udp,
        outbound_proxy: None,
        register_interval: Some(300),
        media_encryption: MediaEncryption::None,
        enabled: true,
        password: password.map(str::to_owned),
    }
}

async fn rig() -> Rig {
    let engine = FakeEngine::new();
    let sink = Arc::new(RecordingSink::default());
    let db = Arc::new(Database::open_in_memory().unwrap());
    let secrets = Arc::new(MemoryStore::default());
    let mgr = SipManager::new(engine.clone(), db.clone(), secrets.clone(), sink.clone());
    Rig {
        engine,
        sink,
        db,
        secrets,
        mgr,
    }
}

async fn until(what: &str, mut f: impl FnMut() -> bool) {
    for _ in 0..200 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for: {what}");
}

/// Starts the manager and waits until it has processed the engine's `Running` event
/// (which connects the stored accounts), so tests are not racing the event loop.
async fn start(r: &Rig) {
    r.mgr.start().await.unwrap();
    let sink = r.sink.clone();
    until("engine running event", move || {
        sink.all().contains(&Seen::Engine)
    })
    .await;
}

fn aor() -> &'static str {
    "sip:1001@example.com"
}

fn cref(id: &str, dir: CallDirection, peer: &str) -> CallRef {
    CallRef {
        id: id.into(),
        aor: aor().into(),
        direction: dir,
        peer_uri: peer.into(),
        peer_name: None,
    }
}

async fn registered_rig() -> (Rig, String) {
    let r = rig().await;
    start(&r).await;
    let view = r.mgr.save_account(input("1001", Some("pw"))).await.unwrap();
    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Registered {
            code: Some(200),
            reason: "OK".into(),
        },
    });
    let sink = r.sink.clone();
    until("registered", move || {
        sink.statuses()
            .last()
            .is_some_and(|s| s.state == RegistrationState::Registered)
    })
    .await;
    (r, view.account.id)
}

// ------------------------------------------------------------------ tests

#[tokio::test]
async fn password_goes_to_the_secret_store_never_to_the_database() {
    let r = rig().await;
    start(&r).await;
    let view = r
        .mgr
        .save_account(input("1001", Some("s3cret-pw")))
        .await
        .unwrap();
    assert!(view.has_password);
    assert!(view.account.is_default, "first account becomes the default");

    // In the keychain...
    assert_eq!(
        r.secrets
            .get(&view.account.id)
            .unwrap()
            .unwrap()
            .expose_secret(),
        "s3cret-pw"
    );
    // ...handed to the engine...
    let added = r.engine.added.lock().unwrap().clone();
    assert_eq!(added.len(), 1);
    assert_eq!(added[0].0, aor());
    assert_eq!(added[0].1, "s3cret-pw");
    assert_eq!(
        added[0].3, "sip.example.com:5060",
        "next hop is the server, not the domain"
    );
    // ...and nowhere else: not in the DB dump, not in anything serialised to the UI.
    let dump =
        r.db.with(|c| {
            let mut out = String::new();
            for t in ["accounts", "contacts", "call_history", "settings"] {
                let mut s = c.prepare(&format!("SELECT * FROM {t}"))?;
                let n = s.column_count();
                let mut rows = s.query([])?;
                while let Some(row) = rows.next()? {
                    for i in 0..n {
                        out.push_str(&format!("{:?};", row.get_ref(i)?));
                    }
                }
            }
            Ok(out)
        })
        .unwrap();
    assert!(!dump.contains("s3cret-pw"));
    let ui = serde_json::to_string(&r.mgr.snapshot().unwrap()).unwrap();
    assert!(!ui.contains("s3cret-pw"));
}

#[tokio::test]
async fn editing_without_a_password_keeps_the_stored_one() {
    let r = rig().await;
    start(&r).await;
    let view = r
        .mgr
        .save_account(input("1001", Some("keep-me")))
        .await
        .unwrap();
    let mut edit = input("1001", None);
    edit.id = Some(view.account.id.clone());
    edit.label = "Renamed".into();
    let v2 = r.mgr.save_account(edit).await.unwrap();
    assert_eq!(v2.account.label, "Renamed");
    assert!(v2.has_password);
    let added = r.engine.added.lock().unwrap().clone();
    assert_eq!(
        added.last().unwrap().1,
        "keep-me",
        "reconnected with the existing secret"
    );
    assert!(
        r.engine.cmds().contains(&format!("remove {}", aor())),
        "old user agent dropped before reconnecting"
    );
}

#[tokio::test]
async fn registration_events_drive_the_status_including_failures_and_recovery() {
    let r = rig().await;
    start(&r).await;
    let view = r.mgr.save_account(input("1001", Some("pw"))).await.unwrap();
    let id = view.account.id.clone();
    let last = |sink: &RecordingSink| sink.statuses().last().cloned().unwrap();

    assert_eq!(last(&r.sink).state, RegistrationState::Connecting);
    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Created,
    });
    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Registering,
    });
    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Failed {
            code: Some(403),
            reason: "Forbidden".into(),
        },
    });
    let sink = r.sink.clone();
    until("error status", move || {
        sink.statuses()
            .last()
            .is_some_and(|s| s.state == RegistrationState::Error)
    })
    .await;
    let s = last(&r.sink);
    assert_eq!(s.account_id, id);
    assert_eq!(s.sip_code, Some(403));
    assert!(s.message.unwrap().contains("403"));

    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Registering,
    });
    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Registered {
            code: Some(200),
            reason: "OK".into(),
        },
    });
    let sink = r.sink.clone();
    until("recovered", move || {
        sink.statuses()
            .last()
            .is_some_and(|s| s.state == RegistrationState::Registered)
    })
    .await;
}

#[tokio::test]
async fn events_for_unknown_accounts_are_ignored() {
    let (r, _) = registered_rig().await;
    let before = r.sink.all().len();
    r.engine.emit(EngineEvent::Registration {
        aor: "sip:stranger@elsewhere".into(),
        event: RegistrationEvent::Failed {
            code: Some(500),
            reason: "x".into(),
        },
    });
    r.engine.emit(EngineEvent::Call {
        call: CallRef {
            aor: "sip:stranger@elsewhere".into(),
            ..cref("zz", CallDirection::Incoming, "sip:9@x")
        },
        event: CallEvent::Closed {
            code: None,
            reason: String::new(),
        },
    });
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(r.sink.all().len(), before);
}

#[tokio::test]
async fn account_without_password_is_unconfigured_not_an_error() {
    let r = rig().await;
    start(&r).await;
    let view = r.mgr.save_account(input("1001", None)).await.unwrap();
    assert!(!view.has_password);
    let s = r.sink.statuses().last().cloned().unwrap();
    assert_eq!(s.state, RegistrationState::Unconfigured);
    assert!(
        r.engine.added.lock().unwrap().is_empty(),
        "nothing is sent to the engine without credentials"
    );
}

#[tokio::test]
async fn engine_add_failure_surfaces_as_an_error_status() {
    let r = rig().await;
    start(&r).await;
    r.engine.fail_add.store(true, Ordering::SeqCst);
    let view = r.mgr.save_account(input("1001", Some("pw"))).await.unwrap(); // saving still works
    let s = r.sink.statuses().last().cloned().unwrap();
    assert_eq!(s.account_id, view.account.id);
    assert_eq!(s.state, RegistrationState::Error);
    assert!(s.message.unwrap().contains("boom"));
}

#[tokio::test]
async fn disabled_accounts_are_not_connected() {
    let r = rig().await;
    let mut i = input("1001", Some("pw"));
    i.enabled = false;
    start(&r).await;
    let view = r.mgr.save_account(i).await.unwrap();
    assert!(r.engine.added.lock().unwrap().is_empty());
    let s = r.sink.statuses().last().cloned().unwrap();
    assert_eq!(s.state, RegistrationState::Disconnected);
    assert_eq!(s.message.as_deref(), Some("Compte désactivé"));
    assert!(r.mgr.connect_account(&view.account.id).await.is_err());
    r.mgr
        .set_account_enabled(&view.account.id, true)
        .await
        .unwrap();
    assert_eq!(r.engine.added.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn outgoing_call_lifecycle_ends_in_history() {
    let (r, acc_id) = registered_rig().await;
    r.db.save_contact(&crate::sip::types::ContactInput {
        id: None,
        first_name: "Bob".into(),
        last_name: "Martin".into(),
        company: None,
        number: "1002".into(),
    })
    .unwrap();

    let call = r.mgr.dial("1002", None).await.unwrap();
    assert!(
        r.engine
            .cmds()
            .contains(&format!("dial {} sip:1002@example.com", aor()))
    );
    assert_eq!(call.direction, CallDirection::Outgoing);
    assert_eq!(
        call.remote_name.as_deref(),
        Some("Bob Martin"),
        "contact name resolved"
    );
    assert_eq!(call.account_id.as_deref(), Some(acc_id.as_str()));

    // Only one outgoing call may be in progress at once.
    assert!(r.mgr.dial("1003", None).await.is_err());

    let rf = cref(&call.id, CallDirection::Outgoing, "sip:1002@example.com");
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Outgoing,
    });
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Ringing,
    });
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Established,
    });
    let sink = r.sink.clone();
    until("connected", move || {
        sink.calls()
            .last()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    let states: Vec<_> = r.sink.calls().iter().map(|c| c.state).collect();
    assert!(
        states.contains(&CallState::Dialing) && states.contains(&CallState::Ringing),
        "{states:?}"
    );

    r.mgr.set_mute(&call.id, true).await.unwrap();
    assert!(r.mgr.calls()[0].muted);
    r.mgr.send_dtmf(&call.id, "12#").await.unwrap();
    r.mgr.hold(&call.id).await.unwrap();
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Hold,
    });
    let m = r.mgr.clone();
    until("on hold", move || {
        m.calls()
            .first()
            .is_some_and(|c| c.state == CallState::OnHold)
    })
    .await;
    assert!(r.mgr.hold(&call.id).await.is_err(), "cannot hold twice");
    r.mgr.resume(&call.id).await.unwrap();
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Resume,
    });
    r.mgr.transfer(&call.id, "1005").await.unwrap();
    r.mgr.hangup(&call.id).await.unwrap();
    r.engine.emit(EngineEvent::Call {
        call: rf,
        event: CallEvent::Closed {
            code: None,
            reason: String::new(),
        },
    });

    let sink = r.sink.clone();
    until("history", move || sink.all().contains(&Seen::History)).await;
    let cmds = r.engine.cmds();
    for expected in [
        format!("mute {} true", call.id),
        format!("dtmf {} 12#", call.id),
        format!("hold {}", call.id),
        format!("resume {}", call.id),
        format!("transfer {} sip:1005@example.com", call.id),
        format!("hangup {}", call.id),
    ] {
        assert!(cmds.contains(&expected), "missing {expected}: {cmds:?}");
    }
    let h = r.db.list_history(&Default::default()).unwrap();
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].result, CallResult::Answered);
    assert_eq!(h[0].direction, CallDirection::Outgoing);
    assert_eq!(h[0].remote_number, "1002");
    assert_eq!(h[0].contact_name.as_deref(), Some("Bob Martin"));
    assert_eq!(h[0].account_id.as_deref(), Some(acc_id.as_str()));
    assert!(r.mgr.calls().is_empty());
}

#[tokio::test]
async fn incoming_call_is_announced_once_and_a_missed_one_is_recorded() {
    let (r, _) = registered_rig().await;
    let rf = CallRef {
        peer_name: Some("Alice".into()),
        ..cref("in1", CallDirection::Incoming, "sip:2000@example.com")
    };
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Incoming,
    });
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Incoming,
    }); // duplicate
    let sink = r.sink.clone();
    until("incoming", move || {
        sink.all()
            .iter()
            .any(|e| matches!(e, Seen::Incoming { .. }))
    })
    .await;
    tokio::time::sleep(Duration::from_millis(40)).await;
    let incoming: Vec<_> = r
        .sink
        .all()
        .into_iter()
        .filter(|e| matches!(e, Seen::Incoming { .. }))
        .collect();
    assert_eq!(incoming.len(), 1, "announced exactly once");
    match &incoming[0] {
        Seen::Incoming { call, notify } => {
            assert!(*notify);
            assert_eq!(call.remote_name.as_deref(), Some("Alice"));
            assert_eq!(call.state, CallState::Incoming);
        }
        _ => unreachable!(),
    }

    // The caller gives up.
    r.engine.emit(EngineEvent::Call {
        call: rf,
        event: CallEvent::Closed {
            code: Some(487),
            reason: "Request Terminated".into(),
        },
    });
    let sink = r.sink.clone();
    until("missed", move || {
        sink.all().iter().any(|e| matches!(e, Seen::Missed { .. }))
    })
    .await;
    let h = r.db.list_history(&Default::default()).unwrap();
    assert_eq!(h[0].result, CallResult::Missed);
    assert_eq!(h[0].direction, CallDirection::Incoming);
    assert_eq!(h[0].duration_secs, 0);
}

#[tokio::test]
async fn answering_and_rejecting_incoming_calls() {
    let (r, _) = registered_rig().await;
    let a = cref("a", CallDirection::Incoming, "sip:2000@example.com");
    let b = cref("b", CallDirection::Incoming, "sip:3000@example.com");
    r.engine.emit(EngineEvent::Call {
        call: a.clone(),
        event: CallEvent::Incoming,
    });
    r.engine.emit(EngineEvent::Call {
        call: b.clone(),
        event: CallEvent::Incoming,
    });
    let m = r.mgr.clone();
    until("two incoming", move || m.calls().len() == 2).await;

    r.mgr.answer("a").await.unwrap();
    r.engine.emit(EngineEvent::Call {
        call: a.clone(),
        event: CallEvent::Established,
    });
    let m = r.mgr.clone();
    until("a connected", move || {
        m.calls()
            .iter()
            .any(|c| c.id == "a" && c.state == CallState::Connected)
    })
    .await;
    r.mgr.reject("b").await.unwrap();
    r.engine.emit(EngineEvent::Call {
        call: b,
        event: CallEvent::Closed {
            code: None,
            reason: "Rejected by user".into(),
        },
    });
    assert!(r.mgr.answer("a").await.is_err(), "already connected");
    assert!(r.mgr.answer("ghost").await.is_err());
    let cmds = r.engine.cmds();
    assert!(cmds.contains(&"accept a".to_string()));
    assert!(cmds.contains(&"hangup b 603".to_string()));

    let db = r.db.clone();
    until("rejected entry", move || {
        !db.list_history(&Default::default()).unwrap().is_empty()
    })
    .await;
    assert_eq!(
        r.db.list_history(&Default::default()).unwrap()[0].result,
        CallResult::Rejected
    );
    assert!(
        !r.sink
            .all()
            .iter()
            .any(|e| matches!(e, Seen::Missed { .. })),
        "a declined call is not a missed call"
    );
}

#[tokio::test]
async fn notification_settings_are_respected() {
    let (r, _) = registered_rig().await;
    let mut s = r.mgr.settings().unwrap();
    s.notifications.incoming_call = false;
    s.notifications.ringtone = false;
    r.mgr.update_settings(s).await.unwrap();
    r.engine.emit(EngineEvent::Call {
        call: cref("x", CallDirection::Incoming, "sip:2000@example.com"),
        event: CallEvent::Incoming,
    });
    let sink = r.sink.clone();
    until("incoming", move || {
        sink.all()
            .iter()
            .any(|e| matches!(e, Seen::Incoming { .. }))
    })
    .await;
    assert!(
        r.sink
            .all()
            .iter()
            .any(|e| matches!(e, Seen::Incoming { notify: false, .. }))
    );
    let e = r.engine.clone();
    until("ringtone silenced", move || {
        e.cmds().contains(&"silence".to_string())
    })
    .await;
}

#[tokio::test]
async fn dial_validation() {
    let r = rig().await;
    start(&r).await;
    assert!(r.mgr.dial("1002", None).await.is_err(), "no account at all");
    let view = r.mgr.save_account(input("1001", Some("pw"))).await.unwrap();
    assert!(
        r.mgr
            .dial("1002;x=y", Some(&view.account.id))
            .await
            .is_err(),
        "bad target rejected before the engine sees it"
    );
    assert!(r.mgr.dial("", None).await.is_err());
    r.mgr.disconnect_account(&view.account.id).await.unwrap();
    assert!(
        r.mgr.dial("1002", Some(&view.account.id)).await.is_err(),
        "disconnected account cannot place calls"
    );
    assert!(!r.engine.cmds().iter().any(|c| c.starts_with("dial")));
}

#[tokio::test]
async fn engine_crash_ends_calls_and_restart_reconnects_accounts() {
    let (r, acc_id) = registered_rig().await;
    let rf = cref("c1", CallDirection::Incoming, "sip:2000@example.com");
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Incoming,
    });
    r.engine.emit(EngineEvent::Call {
        call: rf,
        event: CallEvent::Established,
    });
    let m = r.mgr.clone();
    until("connected", move || {
        m.calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;

    r.engine.set_state(EngineState::Restarting {
        attempt: 1,
        reason: "crash".into(),
    });
    let m = r.mgr.clone();
    until("calls aborted", move || m.calls().is_empty()).await;
    let s = r
        .sink
        .statuses()
        .into_iter()
        .rev()
        .find(|s| s.account_id == acc_id)
        .unwrap();
    assert_eq!(s.state, RegistrationState::Connecting);
    assert!(s.message.unwrap().contains("redémarrage"));
    assert_eq!(
        r.db.list_history(&Default::default()).unwrap()[0].result,
        CallResult::Answered
    );

    let before = r.engine.added.lock().unwrap().len();
    r.engine.set_state(EngineState::Running);
    let e = r.engine.clone();
    until("reconnected", move || {
        e.added.lock().unwrap().len() == before + 1
    })
    .await;

    // A permanent failure shows up on the account instead of hiding behind a spinner.
    r.engine.set_state(EngineState::Failed {
        reason: "binaire manquant".into(),
    });
    let sink = r.sink.clone();
    until("failed", move || {
        sink.statuses().last().is_some_and(|s| {
            s.state == RegistrationState::Error
                && s.message
                    .as_deref()
                    .is_some_and(|m| m.contains("binaire manquant"))
        })
    })
    .await;
}

#[tokio::test]
async fn deleting_an_account_removes_secret_row_and_user_agent() {
    let (r, id) = registered_rig().await;
    r.mgr.delete_account(&id).await.unwrap();
    assert!(r.secrets.get(&id).unwrap().is_none());
    assert!(r.db.get_account(&id).unwrap().is_none());
    assert!(r.engine.cmds().contains(&format!("remove {}", aor())));
    assert!(r.mgr.snapshot().unwrap().statuses.is_empty());
}

#[tokio::test]
async fn audio_settings_are_applied_live_and_network_changes_flag_a_restart() {
    let r = rig().await;
    start(&r).await;
    let mut s = r.mgr.settings().unwrap();
    s.audio.input_device = Some("USB Mic".into());
    s.audio.output_device = Some("AirPods".into());
    let applied = r.mgr.update_settings(s.clone()).await.unwrap();
    assert!(!applied.restart_required);
    assert!(
        r.engine
            .cmds()
            .contains(&"audio Some(\"USB Mic\") Some(\"AirPods\")".to_string())
    );
    assert_eq!(
        r.mgr.settings().unwrap().audio.input_device.as_deref(),
        Some("USB Mic")
    );

    s.network.local_sip_port = Some(5070);
    assert!(r.mgr.update_settings(s).await.unwrap().restart_required);
}

#[tokio::test]
async fn shutdown_hangs_up_unregisters_then_stops_the_engine() {
    let (r, _) = registered_rig().await;
    let rf = cref("c1", CallDirection::Incoming, "sip:2000@example.com");
    r.engine.emit(EngineEvent::Call {
        call: rf,
        event: CallEvent::Incoming,
    });
    let m = r.mgr.clone();
    until("call", move || !m.calls().is_empty()).await;
    r.mgr.shutdown().await;
    let cmds = r.engine.cmds();
    let pos = |needle: &str| {
        cmds.iter()
            .position(|c| c.starts_with(needle))
            .unwrap_or_else(|| panic!("{needle} missing in {cmds:?}"))
    };
    assert!(pos("hangup c1") < pos("remove"), "{cmds:?}");
    assert!(pos("remove") < pos("stop"), "{cmds:?}");
}

#[tokio::test]
async fn engine_events_after_shutdown_do_not_reach_the_ui() {
    let (r, _) = registered_rig().await;
    r.mgr.shutdown().await;
    let before = r.sink.all().len();
    // What Baresip emits while it is being stopped.
    r.engine.emit(EngineEvent::Registration {
        aor: aor().into(),
        event: RegistrationEvent::Unregistering,
    });
    r.engine.set_state(EngineState::Stopped);
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(
        r.sink.all().len(),
        before,
        "no UI work may be triggered while quitting"
    );
}

#[tokio::test]
async fn audio_levels_reach_the_ui_only_for_calls_in_progress() {
    let (r, _) = registered_rig().await;
    let rf = cref("lv1", CallDirection::Incoming, "sip:2000@example.com");
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Incoming,
    });
    r.engine.emit(EngineEvent::Call {
        call: rf.clone(),
        event: CallEvent::Established,
    });
    let m = r.mgr.clone();
    until("connected", move || {
        m.calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;

    r.engine.emit(EngineEvent::AudioLevel {
        call_id: "lv1".into(),
        tx: false,
        db: -20.0,
    });
    r.engine.emit(EngineEvent::AudioLevel {
        call_id: "lv1".into(),
        tx: true,
        db: -30.0,
    });
    r.engine.emit(EngineEvent::AudioLevel {
        call_id: "ghost".into(),
        tx: false,
        db: -10.0,
    });
    r.engine.emit(EngineEvent::Call {
        call: rf,
        event: CallEvent::Closed {
            code: None,
            reason: String::new(),
        },
    });
    r.engine.emit(EngineEvent::AudioLevel {
        call_id: "lv1".into(),
        tx: false,
        db: -25.0,
    }); // late report
    tokio::time::sleep(Duration::from_millis(100)).await;
    let levels: Vec<_> = r
        .sink
        .all()
        .into_iter()
        .filter_map(|e| {
            if let Seen::Level { call_id, tx } = e {
                Some((call_id, tx))
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        levels,
        vec![("lv1".to_string(), false), ("lv1".to_string(), true)]
    );
}
