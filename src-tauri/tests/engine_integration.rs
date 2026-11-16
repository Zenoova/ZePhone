//! End-to-end tests against the REAL Baresip sidecar (no mocks).
//!
//! Requirements: `scripts/prepare-baresip.sh` has been run (the tests are skipped
//! with a message otherwise), and for the call test a local Baresip install that
//! provides the `ausine`/`aufile` modules (Homebrew, or `ZEPHONE_TEST_MODULES_DIR`).
//!
//! Run: `cargo test --test engine_integration -- --nocapture --test-threads=1`

mod support;

use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use secrecy::SecretString;
use support::*;
use zephone_lib::sip::{
    engine::{
        AccountSpec, AudioOverride, CallEvent, EngineEvent, EngineOptions, EngineState,
        RegistrationEvent, SipEngine,
    },
    types::{CallDirection, MediaEncryption, Transport},
};

fn spec(user: &str, pw: &str, hop_port: u16, regint: u32) -> AccountSpec {
    spec_at(user, pw, "127.0.0.1", hop_port, regint)
}

/// Baresip normally refuses loopback addresses ("no laddr for 127.0.0.1"), unless
/// `net_interface` names that very address: the call tests do exactly that.
const LOOPBACK: &str = "127.0.0.1";

fn spec_at(user: &str, pw: &str, host: &str, hop_port: u16, regint: u32) -> AccountSpec {
    AccountSpec {
        aor: format!("sip:{user}@{host}"),
        username: user.into(),
        domain: host.into(),
        auth_username: None,
        password: SecretString::from(pw.to_string()),
        display_name: Some(user.to_uppercase()),
        transport: Transport::Udp,
        next_hop_host: host.into(),
        next_hop_port: hop_port,
        register_interval: regint,
        media_encryption: MediaEncryption::None,
    }
}

macro_rules! engine_or_skip {
    ($dir:expr, $opts:expr) => {
        match started_engine($dir, $opts).await {
            Some(e) => e,
            None => {
                eprintln!("SKIPPED: run scripts/prepare-baresip.sh first");
                return;
            }
        }
    };
}

fn pid_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn read_pid(work: &Path) -> u32 {
    std::fs::read_to_string(work.join("baresip.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

#[tokio::test]
async fn engine_starts_reports_version_codecs_and_listens_on_loopback_only() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_or_skip!(&dir.path().join("w"), EngineOptions::default());
    assert_eq!(engine.state(), EngineState::Running);
    assert_eq!(engine.version().as_deref(), Some("4.13.0"));
    let codecs = engine.codecs();
    assert!(
        codecs.iter().any(|c| c == "PCMU") && codecs.iter().any(|c| c == "PCMA"),
        "{codecs:?}"
    );

    // The control port must be bound to 127.0.0.1 only (never 0.0.0.0 / *).
    let pid = read_pid(&dir.path().join("w"));
    let lsof = Command::new("lsof")
        .args(["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", &pid.to_string()])
        .output();
    if let Ok(out) = lsof {
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            text.contains("127.0.0.1:"),
            "control port not on loopback:\n{text}"
        );
        assert!(
            !text.contains("*:") && !text.contains("0.0.0.0:"),
            "control port exposed:\n{text}"
        );
    }

    // No credentials file is ever written.
    assert!(!dir.path().join("w/accounts").exists());
    engine.stop().await;
    assert_eq!(engine.state(), EngineState::Stopped);
}

#[tokio::test]
async fn stop_leaves_no_orphan_process() {
    let dir = tempfile::tempdir().unwrap();
    let work = dir.path().join("w");
    let engine = engine_or_skip!(&work, EngineOptions::default());
    let pid = read_pid(&work);
    assert!(pid_alive(pid));
    engine.stop().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!pid_alive(pid), "baresip pid {pid} survived stop()");
    assert!(!work.join("baresip.pid").exists());
}

#[tokio::test]
async fn engine_is_restarted_after_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let work = dir.path().join("w");
    let engine = engine_or_skip!(&work, EngineOptions::default());
    let mut rx = engine.subscribe();
    let old = read_pid(&work);
    Command::new("kill")
        .args(["-9", &old.to_string()])
        .status()
        .unwrap();

    let restarting = wait_for(&mut rx, 10, |e| {
        matches!(e, EngineEvent::State(EngineState::Restarting { .. }))
    })
    .await;
    assert!(restarting.is_some(), "no Restarting state after SIGKILL");
    let running = wait_for(&mut rx, 20, |e| {
        matches!(e, EngineEvent::State(EngineState::Running))
    })
    .await;
    assert!(running.is_some(), "engine did not come back");
    assert_ne!(read_pid(&work), old);
    // The new process answers commands.
    engine.add_account(&spec("zed", "pw", 9, 0)).await.unwrap();
    engine.stop().await;
}

#[tokio::test]
async fn registration_with_a_valid_password_survives_the_401_challenge() {
    // Use a password with `;`, spaces and `?` (everything the account syntax allows
    // except a double quote).
    let reg = FakeRegistrar::start(RegistrarMode::Digest, "1001", "p;ss w0rd?>x").await;
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_or_skip!(&dir.path().join("w"), EngineOptions::default());
    let mut rx = engine.subscribe();
    engine
        .add_account(&spec("1001", "p;ss w0rd?>x", reg.port, 300))
        .await
        .unwrap();

    let mut seen = vec![];
    let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
    while let Ok(Ok(ev)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        if let EngineEvent::Registration { event, .. } = ev {
            let done = matches!(
                event,
                RegistrationEvent::Registered { .. } | RegistrationEvent::Failed { .. }
            );
            seen.push(event);
            if done {
                break;
            }
        }
    }
    println!("events: {seen:?}");
    println!("registrar saw: {:?}", reg.log.lock().unwrap());
    assert!(
        matches!(
            seen.last(),
            Some(RegistrationEvent::Registered {
                code: Some(200),
                ..
            })
        ),
        "expected final 200 OK, got {seen:?}"
    );
    assert!(
        !seen
            .iter()
            .any(|e| matches!(e, RegistrationEvent::Failed { .. })),
        "a 401 challenge followed by a successful authentication must not surface as a failure: {seen:?}"
    );
    let log = reg.log.lock().unwrap().clone();
    assert_eq!(
        log,
        vec![(false, 401), (true, 200)],
        "expected challenge then authenticated REGISTER"
    );
    // The request URI is the domain, routed through the outbound proxy (our registrar).
    assert_eq!(reg.seen_request_uris.lock().unwrap()[0], "sip:127.0.0.1");

    let logs = engine.log_tail(500).join("\n");
    assert!(
        !logs.contains("p;ss w0rd"),
        "password leaked into engine logs:\n{logs}"
    );
    engine.stop().await;
}

#[tokio::test]
async fn wrong_password_ends_in_a_401_failure() {
    let reg = FakeRegistrar::start(RegistrarMode::Digest, "1001", "correct").await;
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_or_skip!(&dir.path().join("w"), EngineOptions::default());
    let mut rx = engine.subscribe();
    engine
        .add_account(&spec("1001", "WRONG", reg.port, 300))
        .await
        .unwrap();
    let ev = wait_for(&mut rx, 15, |e| {
        matches!(
            e,
            EngineEvent::Registration {
                event: RegistrationEvent::Failed { .. } | RegistrationEvent::Registered { .. },
                ..
            }
        )
    })
    .await
    .expect("no terminal registration event");
    match ev {
        EngineEvent::Registration {
            event: RegistrationEvent::Failed { code, reason },
            ..
        } => {
            assert_eq!(code, Some(401), "reason: {reason}");
        }
        other => panic!("expected failure, got {other:?}"),
    }
    engine.stop().await;
}

#[tokio::test]
async fn forbidden_and_unavailable_registrars_report_their_sip_codes() {
    for (mode, expected) in [
        (RegistrarMode::Forbidden, 403u16),
        (RegistrarMode::Unavailable, 503),
    ] {
        let reg = FakeRegistrar::start(mode, "1001", "x").await;
        let dir = tempfile::tempdir().unwrap();
        let engine = engine_or_skip!(&dir.path().join("w"), EngineOptions::default());
        let mut rx = engine.subscribe();
        engine
            .add_account(&spec("1001", "x", reg.port, 300))
            .await
            .unwrap();
        let ev = wait_for(&mut rx, 15, |e| {
            matches!(
                e,
                EngineEvent::Registration {
                    event: RegistrationEvent::Failed { .. },
                    ..
                }
            )
        })
        .await
        .unwrap_or_else(|| panic!("no failure for {mode:?}"));
        match ev {
            EngineEvent::Registration {
                event: RegistrationEvent::Failed { code, .. },
                ..
            } => {
                assert_eq!(code, Some(expected), "{mode:?}")
            }
            _ => unreachable!(),
        }
        engine.stop().await;
    }
}

#[tokio::test]
async fn unreachable_server_over_tcp_fails_fast_without_crashing_the_engine() {
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_or_skip!(&dir.path().join("w"), EngineOptions::default());
    let free = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let mut rx = engine.subscribe();
    let mut s = spec("1001", "x", free, 300);
    s.transport = Transport::Tcp;
    engine.add_account(&s).await.unwrap();
    let ev = wait_for(&mut rx, 20, |e| {
        matches!(
            e,
            EngineEvent::Registration {
                event: RegistrationEvent::Failed { .. },
                ..
            }
        )
    })
    .await
    .expect("expected a registration failure for a closed port");
    println!("unreachable: {ev:?}");
    // The engine is still healthy afterwards.
    assert_eq!(engine.state(), EngineState::Running);
    engine.remove_account("sip:1001@127.0.0.1").await.unwrap();
    engine.stop().await;
}

// ------------------------------------------------------------ real call

fn wav_peak(path: &Path) -> (usize, i16) {
    let bytes = std::fs::read(path).unwrap_or_default();
    if bytes.len() <= 44 {
        return (0, 0);
    }
    let samples: Vec<i16> = bytes[44..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    (
        samples.len(),
        samples
            .iter()
            .map(|s| s.saturating_abs())
            .max()
            .unwrap_or(0),
    )
}

fn combined_modules(tmp: &Path) -> Option<std::path::PathBuf> {
    let extra = test_modules_dir()?;
    let bundle =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/baresip/modules");
    let dir = tmp.join("modules");
    std::fs::create_dir_all(&dir).ok()?;
    for entry in std::fs::read_dir(&bundle).ok()? {
        let p = entry.ok()?.path();
        std::os::unix::fs::symlink(&p, dir.join(p.file_name()?)).ok()?;
    }
    for m in ["ausine.so", "aufile.so"] {
        std::os::unix::fs::symlink(extra.join(m), dir.join(m)).ok()?;
    }
    Some(dir)
}

#[tokio::test]
async fn call_between_two_engines_carries_audio_both_ways_and_supports_dtmf_hold_mute_hangup() {
    let tmp = tempfile::tempdir().unwrap();
    let Some(modules) = combined_modules(tmp.path()) else {
        eprintln!(
            "SKIPPED: need ausine/aufile modules (brew install baresip or ZEPHONE_TEST_MODULES_DIR)"
        );
        return;
    };
    let ip = LOOPBACK.to_string();
    let a_rx = tmp.path().join("a_rx.wav");
    let b_rx = tmp.path().join("b_rx.wav");
    let port_b = {
        std::net::UdpSocket::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    };

    let mk = |name: &str, freq: u32, rx: &Path, local_port: Option<u16>| {
        let work = tmp.path().join(name);
        let mut paths = sidecar_paths(work)?;
        paths.modules_dir = modules.clone();
        let e = zephone_lib::sip::engine::baresip::BaresipEngine::new(paths);
        e.set_options(EngineOptions {
            local_sip_port: local_port,
            net_interface: Some(LOOPBACK.into()),
            sip_trace: std::env::var("ZEPHONE_SIP_TRACE").is_ok(),
            audio_override: Some(AudioOverride {
                modules: vec!["ausine".into(), "aufile".into()],
                source: format!("ausine,{freq}"),
                player: format!("aufile,{}", rx.display()),
            }),
            ..Default::default()
        });
        Some(e)
    };
    let (Some(a), Some(b)) = (mk("A", 440, &a_rx, None), mk("B", 880, &b_rx, Some(port_b))) else {
        eprintln!("SKIPPED: run scripts/prepare-baresip.sh first");
        return;
    };
    a.start().await.unwrap();
    b.start().await.unwrap();
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());

    // A routes everything to B (outbound proxy = B), no registration (direct call).
    a.add_account(&spec_at("alice", "pw", &ip, port_b, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("bob", "pw", &ip, 9, 0))
        .await
        .unwrap();

    let call_a = a
        .dial(
            &format!("sip:alice@{ip}"),
            &format!("sip:bob@{ip}:{port_b}"),
        )
        .await
        .unwrap_or_else(|e| panic!("dial: {e}\n{}", a.log_tail(30).join("\n")));
    println!("A dialled, call id {call_a}");

    // B sees the incoming call.
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
    .unwrap_or_else(|| {
        let pid = read_pid(&tmp.path().join("B"));
        let lsof = Command::new("lsof")
            .args(["-nP", "-a", "-iUDP", "-p", &pid.to_string()])
            .output();
        panic!(
            "B never saw CALL_INCOMING\n--- B config ---\n{}\n--- B sockets ---\n{}\n--- B ---\n{}",
            std::fs::read_to_string(tmp.path().join("B/config")).unwrap_or_default(),
            lsof.map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default(),
            b.log_tail(80).join("\n")
        )
    });
    let call_b = match incoming {
        EngineEvent::Call { call, .. } => {
            assert_eq!(call.direction, CallDirection::Incoming);
            assert!(
                call.peer_uri.contains(&format!("alice@{ip}")),
                "peer uri: {}",
                call.peer_uri
            );
            assert_eq!(call.aor, format!("sip:bob@{ip}"));
            call.id
        }
        _ => unreachable!(),
    };
    // A sees remote ringing.
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Ringing,
                ..
            }
        ))
        .await
        .is_some(),
        "A never saw ringing"
    );

    b.accept(&call_b).await.expect("accept");
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Established,
                ..
            }
        ))
        .await
        .is_some()
    );
    assert!(
        wait_for(&mut eb, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Established,
                ..
            }
        ))
        .await
        .is_some()
    );

    // Let RTP flow in both directions.
    tokio::time::sleep(Duration::from_millis(2500)).await;

    // DTMF from A reaches B (RFC 4733 telephone-event).
    a.send_dtmf(&call_a, "5").await.expect("dtmf");
    let dtmf = wait_for(&mut eb, 5, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Dtmf { .. },
                ..
            }
        )
    })
    .await;
    match dtmf {
        Some(EngineEvent::Call {
            event: CallEvent::Dtmf { key },
            ..
        }) => assert_eq!(key, "5"),
        other => panic!("B did not receive the DTMF digit: {other:?}"),
    }

    // Mute / unmute are accepted by the engine. (Hold/resume have their own test: the re-INVITE
    // makes Baresip re-create its file player, which would truncate the WAV measured below.)
    a.set_mute(&call_a, true).await.expect("mute");
    a.set_mute(&call_a, false).await.expect("unmute");
    tokio::time::sleep(Duration::from_millis(1500)).await;

    // A hangs up; both sides close.
    a.hangup(&call_a, None).await.expect("hangup");
    assert!(
        wait_for(&mut ea, 8, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        ))
        .await
        .is_some()
    );
    assert!(
        wait_for(&mut eb, 8, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        ))
        .await
        .is_some()
    );

    a.stop().await;
    b.stop().await;

    // Audio really crossed the wire in BOTH directions: each side wrote the other's tone.
    let (na, pa) = wav_peak(&a_rx);
    let (nb, pb) = wav_peak(&b_rx);
    println!("A received {na} samples (peak {pa}); B received {nb} samples (peak {pb})");
    assert!(
        na > 8000 && pa > 1000,
        "A heard nothing from B (samples={na}, peak={pa})"
    );
    assert!(
        nb > 8000 && pb > 1000,
        "B heard nothing from A (samples={nb}, peak={pb})"
    );
}

#[tokio::test]
async fn rejecting_an_incoming_call_closes_it_on_both_sides_with_the_sip_status() {
    let tmp = tempfile::tempdir().unwrap();
    let Some(modules) = combined_modules(tmp.path()) else {
        eprintln!("SKIPPED: need ausine/aufile modules");
        return;
    };
    let ip = LOOPBACK.to_string();
    let port_b = {
        std::net::UdpSocket::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    };
    let mk = |name: &str, local_port: Option<u16>| {
        let mut paths = sidecar_paths(tmp.path().join(name))?;
        paths.modules_dir = modules.clone();
        let e = zephone_lib::sip::engine::baresip::BaresipEngine::new(paths);
        e.set_options(EngineOptions {
            local_sip_port: local_port,
            net_interface: Some(LOOPBACK.into()),
            audio_override: Some(AudioOverride {
                modules: vec!["ausine".into(), "aufile".into()],
                source: "ausine,440".into(),
                player: format!(
                    "aufile,{}",
                    tmp.path().join(format!("{name}.wav")).display()
                ),
            }),
            ..Default::default()
        });
        Some(e)
    };
    let (Some(a), Some(b)) = (mk("A", None), mk("B", Some(port_b))) else {
        return;
    };
    a.start().await.unwrap();
    b.start().await.unwrap();
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());
    a.add_account(&spec_at("alice", "pw", &ip, port_b, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("bob", "pw", &ip, 9, 0))
        .await
        .unwrap();

    if let Err(e) = a
        .dial(
            &format!("sip:alice@{ip}"),
            &format!("sip:bob@{ip}:{port_b}"),
        )
        .await
    {
        panic!(
            "dial failed: {e}\n--- engine A log ---\n{}",
            a.log_tail(60).join("\n")
        );
    }
    let call_b = match wait_for(&mut eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    {
        Some(EngineEvent::Call { call, .. }) => call.id,
        _ => panic!("no incoming call"),
    };
    b.hangup(&call_b, Some(603)).await.expect("reject");

    match wait_for(&mut ea, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        )
    })
    .await
    {
        Some(EngineEvent::Call {
            event: CallEvent::Closed { code, reason },
            ..
        }) => {
            println!("caller saw: {code:?} {reason}");
            assert_eq!(code, Some(603), "{reason}");
        }
        other => panic!("caller was not told: {other:?}"),
    }
    assert!(
        wait_for(&mut eb, 5, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        ))
        .await
        .is_some()
    );
    a.stop().await;
    b.stop().await;
}

#[tokio::test]
async fn every_audio_device_listed_to_the_user_is_accepted_by_baresip() {
    // The UI lists devices through cpal; Baresip matches CoreAudio names. They must agree,
    // otherwise a device picked in Settings would silently not be used.
    let devices = zephone_lib::audio::list_devices();
    println!(
        "inputs: {:?}\noutputs: {:?}",
        devices.inputs, devices.outputs
    );
    let dir = tempfile::tempdir().unwrap();
    let engine = engine_or_skip!(&dir.path().join("w"), EngineOptions::default());
    let mut checked = 0;
    for d in devices.inputs.iter().filter(|d| d.selectable) {
        engine
            .set_audio_devices(Some(&d.name), None)
            .await
            .unwrap_or_else(|e| panic!("Baresip rejected input device {:?}: {e}", d.name));
        checked += 1;
    }
    for d in devices.outputs.iter().filter(|d| d.selectable) {
        engine
            .set_audio_devices(None, Some(&d.name))
            .await
            .unwrap_or_else(|e| panic!("Baresip rejected output device {:?}: {e}", d.name));
        checked += 1;
    }
    println!("{checked} devices accepted");
    // A device that does not exist is reported, not silently ignored.
    assert!(
        engine
            .set_audio_devices(Some("No Such Microphone 9000"), None)
            .await
            .is_err()
    );
    engine.stop().await;
}

#[tokio::test]
async fn hold_and_resume_are_signalled_to_the_remote_party() {
    let tmp = tempfile::tempdir().unwrap();
    let port_b = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (Some(a), Some(b)) = (
        remote_phone(tmp.path(), "a", 440, &tmp.path().join("a.wav"), None).await,
        remote_phone(
            tmp.path(),
            "b",
            880,
            &tmp.path().join("b.wav"),
            Some(port_b),
        )
        .await,
    ) else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return;
    };
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());
    a.add_account(&spec_at("alice", "pw", LOOPBACK, port_b, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("bob", "pw", LOOPBACK, 9, 0))
        .await
        .unwrap();

    let call_a = a
        .dial(
            "sip:alice@127.0.0.1",
            &format!("sip:bob@127.0.0.1:{port_b}"),
        )
        .await
        .unwrap();
    let call_b = match wait_for(&mut eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    {
        Some(EngineEvent::Call { call, .. }) => call.id,
        other => panic!("B was not called: {other:?}"),
    };
    b.accept(&call_b).await.unwrap();
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Established,
                ..
            }
        ))
        .await
        .is_some()
    );
    tokio::time::sleep(Duration::from_millis(800)).await;

    a.hold(&call_a).await.expect("hold");
    assert!(
        wait_for(&mut eb, 8, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Hold,
                ..
            }
        ))
        .await
        .is_some(),
        "B was not told about the hold"
    );
    // B reports the hold as soon as the re-INVITE reaches it: let that exchange finish (200 OK, ACK) before the next
    // re-INVITE, which Baresip refuses while one is still pending.
    tokio::time::sleep(Duration::from_millis(500)).await;
    a.resume(&call_a).await.expect("resume");
    assert!(
        wait_for(&mut eb, 8, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Resume,
                ..
            }
        ))
        .await
        .is_some(),
        "B was not told about the resume; A's engine said: {:#?}",
        a.log_tail(25)
    );
    a.hangup(&call_a, None).await.unwrap();
    assert!(
        wait_for(&mut eb, 8, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Closed { .. },
                ..
            }
        ))
        .await
        .is_some()
    );
    a.stop().await;
    b.stop().await;
}

fn drain_levels(rx: &mut tokio::sync::broadcast::Receiver<EngineEvent>) -> Vec<(bool, f32)> {
    let mut out = vec![];
    while let Ok(ev) = rx.try_recv() {
        if let EngineEvent::AudioLevel { tx, db, .. } = ev {
            out.push((tx, db));
        }
    }
    out
}

#[tokio::test]
async fn live_audio_levels_follow_the_remote_voice_the_microphone_and_the_mute() {
    let tmp = tempfile::tempdir().unwrap();
    let port_b = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (Some(a), Some(b)) = (
        remote_phone(tmp.path(), "a", 440, &tmp.path().join("a.wav"), None).await,
        remote_phone(
            tmp.path(),
            "b",
            880,
            &tmp.path().join("b.wav"),
            Some(port_b),
        )
        .await,
    ) else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return;
    };
    let vumeter_present = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources/baresip/modules/vumeter.so")
        .is_file();
    if !vumeter_present {
        eprintln!("SKIPPED: vumeter module not bundled");
        return;
    }
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());
    let mut levels = a.subscribe();
    a.add_account(&spec_at("alice", "pw", LOOPBACK, port_b, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("bob", "pw", LOOPBACK, 9, 0))
        .await
        .unwrap();

    let call_a = a
        .dial(
            "sip:alice@127.0.0.1",
            &format!("sip:bob@127.0.0.1:{port_b}"),
        )
        .await
        .unwrap();
    let call_b = match wait_for(&mut eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    {
        Some(EngineEvent::Call { call, .. }) => call.id,
        other => panic!("B was not called: {other:?}"),
    };
    b.accept(&call_b).await.unwrap();
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Established,
                ..
            }
        ))
        .await
        .is_some()
    );

    // Speaking: both our microphone (440 Hz sine) and the remote voice (880 Hz) show up, often.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let _ = drain_levels(&mut levels);
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let live = drain_levels(&mut levels);
    let (tx, rx): (Vec<f32>, Vec<f32>) = {
        let tx = live.iter().filter(|(t, _)| *t).map(|(_, d)| *d).collect();
        let rx = live.iter().filter(|(t, _)| !*t).map(|(_, d)| *d).collect();
        (tx, rx)
    };
    println!(
        "1.5 s of levels: {} tx, {} rx reports; tx max {:?}, rx max {:?}",
        tx.len(),
        rx.len(),
        tx.iter().cloned().fold(f32::MIN, f32::max),
        rx.iter().cloned().fold(f32::MIN, f32::max)
    );
    assert!(
        tx.len() >= 8 && rx.len() >= 8,
        "levels must arrive several times per second (60 ms timer): {} / {}",
        tx.len(),
        rx.len()
    );
    assert!(
        tx.iter().cloned().fold(f32::MIN, f32::max) > -30.0,
        "microphone level too low: {tx:?}"
    );
    assert!(
        rx.iter().cloned().fold(f32::MIN, f32::max) > -30.0,
        "remote voice level too low: {rx:?}"
    );
    assert!(live.iter().all(|(_, d)| (-96.0..=0.0).contains(d)));

    // Muting must silence the microphone level (the UI also dims the orb by itself).
    a.set_mute(&call_a, true).await.unwrap();
    tokio::time::sleep(Duration::from_millis(600)).await;
    let _ = drain_levels(&mut levels);
    tokio::time::sleep(Duration::from_millis(800)).await;
    let muted = drain_levels(&mut levels);
    let tx_muted: Vec<f32> = muted.iter().filter(|(t, _)| *t).map(|(_, d)| *d).collect();
    println!("while muted: tx reports {tx_muted:?}");
    assert!(!tx_muted.is_empty());
    assert!(
        tx_muted.iter().all(|d| *d < -60.0),
        "muted microphone still reports a signal: {tx_muted:?}"
    );

    a.hangup(&call_a, None).await.unwrap();
    a.stop().await;
    b.stop().await;
}

/// The samples of a finished 16-bit WAV, with the number of samples per second of audio (the sample rate
/// times the channels: the file may be stereo, its samples are interleaved).
fn wav_samples(path: &Path) -> (u32, Vec<i16>) {
    let bytes = std::fs::read(path).unwrap_or_default();
    assert!(bytes.len() > 44, "{} is empty", path.display());
    let channels = u32::from(u16::from_le_bytes([bytes[22], bytes[23]]));
    let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]) * channels.max(1);
    let samples = bytes[44..]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| i16::from_le_bytes(*c))
        .collect();
    (rate, samples)
}

fn peak_between(rate: u32, samples: &[i16], from_s: f32, to_s: f32) -> i16 {
    let (a, b) = (
        (from_s * rate as f32) as usize,
        (to_s * rate as f32) as usize,
    );
    samples[a.min(samples.len())..b.min(samples.len())]
        .iter()
        .map(|s| s.saturating_abs())
        .max()
        .unwrap_or(0)
}

/// Two real engines call each other with synthetic voices (440 Hz and 880 Hz). Proves, with the real
/// `zeaudio` module: both sides of a call are recorded into complete WAV files; the incoming and the
/// outgoing volumes change what is played / sent while the call runs.
#[tokio::test]
async fn zeaudio_records_both_voices_and_changes_the_volumes_during_a_call() {
    if !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources/baresip/modules/zeaudio.so")
        .is_file()
    {
        eprintln!("SKIPPED: zeaudio module not bundled (run scripts/build-baresip.sh)");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let port_b = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (a_wav, b_wav) = (tmp.path().join("a.wav"), tmp.path().join("b.wav"));
    let (Some(a), Some(b)) = (
        remote_phone(tmp.path(), "a", 440, &a_wav, None).await,
        remote_phone(tmp.path(), "b", 880, &b_wav, Some(port_b)).await,
    ) else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return;
    };
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());
    a.add_account(&spec_at("alice", "pw", LOOPBACK, port_b, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("bob", "pw", LOOPBACK, 9, 0))
        .await
        .unwrap();

    let call_a = a
        .dial(
            "sip:alice@127.0.0.1",
            &format!("sip:bob@127.0.0.1:{port_b}"),
        )
        .await
        .unwrap();
    let call_b = match wait_for(&mut eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    {
        Some(EngineEvent::Call { call, .. }) => call.id,
        other => panic!("B was not called: {other:?}"),
    };
    b.accept(&call_b).await.unwrap();
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Established,
                ..
            }
        ))
        .await
        .is_some()
    );
    let established = tokio::time::Instant::now();

    // --- recording on A: both voices end up in two complete files ------------------------------
    let base = tmp.path().join("rec with spaces").join("call1");
    std::fs::create_dir_all(base.parent().unwrap()).unwrap();
    a.start_recording(&base).await.unwrap();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    a.stop_recording().await.unwrap();
    let (tx, rx) = (
        PathBuf::from(format!("{}-tx.wav", base.display())),
        PathBuf::from(format!("{}-rx.wav", base.display())),
    );
    let (tx_rate, tx_s) = wav_samples(&tx);
    let (rx_rate, rx_s) = wav_samples(&rx);
    println!(
        "recorded: tx {} samples @ {tx_rate} Hz (peak {}), rx {} samples @ {rx_rate} Hz (peak {})",
        tx_s.len(),
        tx_s.iter().map(|s| s.saturating_abs()).max().unwrap(),
        rx_s.len(),
        rx_s.iter().map(|s| s.saturating_abs()).max().unwrap()
    );
    for (name, rate, s) in [("tx", tx_rate, &tx_s), ("rx", rx_rate, &rx_s)] {
        let secs = s.len() as f32 / rate as f32;
        assert!((1.8..=3.2).contains(&secs), "{name}: {secs} s recorded");
        assert!(
            s.iter().map(|v| v.saturating_abs()).max().unwrap() > 1_000,
            "{name} has no audio"
        );
    }
    // The header was finalised by the engine: the declared size matches the file.
    let head = std::fs::read(&tx).unwrap();
    let declared = u32::from_le_bytes([head[40], head[41], head[42], head[43]]) as usize;
    assert_eq!(declared, head.len() - 44, "tx header was not finalised");

    // The two sides mix into one playable file.
    let mixed = tmp.path().join("mixed.wav");
    let m = zephone_lib::recording::wav::mix(&tx, &rx, &mixed)
        .unwrap()
        .expect("something recorded");
    assert!((2..=3).contains(&m.duration_secs), "{}", m.duration_secs);
    assert!(m.peaks.contains(&255));

    // --- volumes -------------------------------------------------------------------------------
    // What A hears (a.wav, 880 Hz from B) follows the incoming volume; what B hears (b.wav, 440 Hz
    // from A) follows the outgoing volume of A.
    let phase = Duration::from_millis(1600);
    let t_full = established.elapsed();
    tokio::time::sleep(phase.saturating_sub(t_full.min(phase))).await;
    a.set_gains(0.5, 0.5).await.unwrap();
    let t_half = established.elapsed().as_secs_f32();
    tokio::time::sleep(phase).await;
    a.set_gains(0.0, 0.0).await.unwrap();
    let t_zero = established.elapsed().as_secs_f32();
    tokio::time::sleep(phase).await;
    a.set_gains(1.0, 1.0).await.unwrap();
    let t_back = established.elapsed().as_secs_f32();
    tokio::time::sleep(phase).await;

    a.hangup(&call_a, None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    a.stop().await;
    b.stop().await;

    for (who, path) in [("A hears", &a_wav), ("B hears", &b_wav)] {
        let (rate, s) = wav_samples(path);
        // The player file starts a little after the call is established: look at the middle of each phase.
        let full = peak_between(rate, &s, 0.2, t_half - 0.4) as f32;
        let half = peak_between(rate, &s, t_half + 0.3, t_zero - 0.3) as f32;
        let zero = peak_between(rate, &s, t_zero + 0.3, t_back - 0.3) as f32;
        let back = peak_between(rate, &s, t_back + 0.3, t_back + 1.0) as f32;
        println!("{who}: full {full}, half {half}, zero {zero}, back {back}");
        assert!(full > 1_000.0, "{who}: no audio at full volume");
        assert!(
            (0.35..=0.65).contains(&(half / full)),
            "{who}: half volume should halve the amplitude ({half} vs {full})"
        );
        assert!(
            zero < full * 0.02,
            "{who}: zero volume is not silent ({zero})"
        );
        assert!(
            back > full * 0.8,
            "{who}: volume did not come back ({back} vs {full})"
        );
    }
}

/// One engine hosting two accounts, both live at once: a call to each rings at the same time, and answering
/// the second one puts the first on hold (the other side sees it) instead of dropping it.
#[tokio::test]
async fn two_accounts_on_one_engine_receive_calls_at_the_same_time() {
    let tmp = tempfile::tempdir().unwrap();
    let port_b = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (Some(a), Some(b)) = (
        remote_phone(tmp.path(), "a", 440, &tmp.path().join("a.wav"), None).await,
        remote_phone(
            tmp.path(),
            "b",
            880,
            &tmp.path().join("b.wav"),
            Some(port_b),
        )
        .await,
    ) else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return;
    };
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());
    a.add_account(&spec_at("alice", "pw", LOOPBACK, port_b, 0))
        .await
        .unwrap();
    // B hosts two accounts at once.
    b.add_account(&spec_at("bob", "pw", LOOPBACK, 9, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("carol", "pw", LOOPBACK, 9, 0))
        .await
        .unwrap();

    let to_bob = a
        .dial(
            "sip:alice@127.0.0.1",
            &format!("sip:bob@127.0.0.1:{port_b}"),
        )
        .await
        .unwrap();
    let to_carol = a
        .dial(
            "sip:alice@127.0.0.1",
            &format!("sip:carol@127.0.0.1:{port_b}"),
        )
        .await
        .unwrap();
    println!("A dialled bob ({to_bob}) and carol ({to_carol})");

    // Both calls arrive, each on its own account, while neither has been answered.
    let mut incoming = std::collections::HashMap::new();
    while incoming.len() < 2 {
        match wait_for(&mut eb, 10, |e| {
            matches!(
                e,
                EngineEvent::Call {
                    event: CallEvent::Incoming,
                    ..
                }
            )
        })
        .await
        {
            Some(EngineEvent::Call { call, .. }) => {
                incoming.insert(call.aor.clone(), call.id.clone());
            }
            other => panic!("only {incoming:?} rang: {other:?}"),
        }
    }
    println!("B is ringing on: {incoming:?}");
    let bob_call = incoming.get("sip:bob@127.0.0.1").expect("a call for bob");
    let carol_call = incoming
        .get("sip:carol@127.0.0.1")
        .expect("a call for carol");

    // Answer the first account's call, then the second one's.
    b.accept(bob_call).await.unwrap();
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call { event: CallEvent::Established, call } if call.id == to_bob
        ))
        .await
        .is_some(),
        "bob's call was not established"
    );
    b.accept(carol_call).await.unwrap();
    // The two things arrive in either order: carol's call is established, and bob's is put on hold (kept,
    // not hung up) because the second one became the active call.
    let (mut carol_up, mut bob_held) = (false, false);
    wait_for(&mut ea, 10, |e| {
        if let EngineEvent::Call { event, call } = e {
            carol_up |= *event == CallEvent::Established && call.id == to_carol;
            bob_held |= *event == CallEvent::Hold && call.id == to_bob;
            assert!(
                !matches!(event, CallEvent::Closed { .. }),
                "a call was closed: {event:?}"
            );
        }
        carol_up && bob_held
    })
    .await;
    assert!(carol_up, "carol's call was not established");
    assert!(
        bob_held,
        "the first call should have been put on hold when the second was answered"
    );

    a.hangup(&to_bob, None).await.unwrap();
    a.hangup(&to_carol, None).await.unwrap();
    a.stop().await;
    b.stop().await;
}

/// The dropouts of a recording of a steady tone: where (in seconds) and how long (in milliseconds) each run of
/// near silence longer than 8 ms is.
fn holes(rate: u32, samples: &[i16]) -> Vec<(f32, f32)> {
    let min = (rate as usize * 8) / 1000;
    let (mut start, mut found) = (None::<usize>, Vec::new());
    for (i, s) in samples.iter().enumerate() {
        if s.unsigned_abs() < 60 {
            start.get_or_insert(i);
        } else if let Some(st) = start.take()
            && i - st >= min
        {
            found.push((
                st as f32 / rate as f32,
                (i - st) as f32 * 1000.0 / rate as f32,
            ));
        }
    }
    found
}

/// Two engines call each other and talk for a while: returns both engines, the call ids and the files each side's
/// player writes (what it heard). Shared by the audio-quality tests.
struct Talk {
    a: zephone_lib::sip::engine::baresip::BaresipEngine,
    b: zephone_lib::sip::engine::baresip::BaresipEngine,
    call_a: String,
    call_b: String,
    a_wav: PathBuf,
    b_wav: PathBuf,
    _tmp: tempfile::TempDir,
}

async fn talk() -> Option<Talk> {
    let tmp = tempfile::tempdir().unwrap();
    let port_b = std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (a_wav, b_wav) = (tmp.path().join("a.wav"), tmp.path().join("b.wav"));
    let (Some(a), Some(b)) = (
        remote_phone(tmp.path(), "a", 440, &a_wav, None).await,
        remote_phone(tmp.path(), "b", 880, &b_wav, Some(port_b)).await,
    ) else {
        eprintln!("SKIPPED: sidecar/test modules missing");
        return None;
    };
    let (mut ea, mut eb) = (a.subscribe(), b.subscribe());
    a.add_account(&spec_at("alice", "pw", LOOPBACK, port_b, 0))
        .await
        .unwrap();
    b.add_account(&spec_at("bob", "pw", LOOPBACK, 9, 0))
        .await
        .unwrap();
    let call_a = a
        .dial(
            "sip:alice@127.0.0.1",
            &format!("sip:bob@127.0.0.1:{port_b}"),
        )
        .await
        .unwrap();
    let call_b = match wait_for(&mut eb, 10, |e| {
        matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Incoming,
                ..
            }
        )
    })
    .await
    {
        Some(EngineEvent::Call { call, .. }) => call.id,
        other => panic!("B was not called: {other:?}"),
    };
    b.accept(&call_b).await.unwrap();
    assert!(
        wait_for(&mut ea, 10, |e| matches!(
            e,
            EngineEvent::Call {
                event: CallEvent::Established,
                ..
            }
        ))
        .await
        .is_some()
    );
    Some(Talk {
        a,
        b,
        call_a,
        call_b,
        a_wav,
        b_wav,
        _tmp: tmp,
    })
}

/// Recording used to write files from the audio threads, which made them wait (the filter took up to 12 ms on a
/// 20 ms block). Now they only copy samples into a ring and a separate thread writes the files. Measured with the
/// module's own statistics on a 15 s call, both ends recording: the filter stays fast, nothing is dropped, and
/// the recordings are complete. (Holes in the heard tone are printed, not asserted: on a busy machine the OS can
/// delay a thread for reasons that have nothing to do with ZePhone.)
#[tokio::test]
async fn recording_does_not_hold_the_audio_threads_up() {
    let Some(t) = talk().await else { return };
    let tmp = tempfile::tempdir().unwrap();
    t.a.start_recording(&tmp.path().join("ra")).await.unwrap();
    t.b.start_recording(&tmp.path().join("rb")).await.unwrap();

    let mut busy = Vec::new(); // per second and direction: the longest time the filter took on one block
    let mut late = 0u64;
    let mut dropped = 0u32;
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        for (e, id) in [(&t.a, &t.call_a), (&t.b, &t.call_b)] {
            let s = e.call_stats(id).await.unwrap().expect("stats of the call");
            busy.push(s.filters.rx.busy_max_us);
            busy.push(s.filters.tx.busy_max_us);
            late = late.max(s.filters.rx.late).max(s.filters.tx.late);
            dropped += s.filters.recording.dropped_samples;
        }
    }
    t.a.stop_recording().await.unwrap();
    t.b.stop_recording().await.unwrap();
    t.a.hangup(&t.call_a, None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    t.a.stop().await;
    t.b.stop().await;

    busy.sort_unstable();
    let (median, max) = (busy[busy.len() / 2], *busy.last().unwrap());
    println!(
        "filter time per block: median {median} us, worst {max} us; late blocks {late}; dropped samples {dropped}"
    );
    assert!(
        median < 2_000,
        "the audio filter is slow: median {median} us"
    );
    assert_eq!(dropped, 0, "recorded samples were dropped");

    for (who, path) in [("A hears", &t.a_wav), ("B hears", &t.b_wav)] {
        let (rate, s) = wav_samples(path);
        // Skip the first second (call set-up) and the last one (hang-up).
        let body = &s[rate as usize..s.len().saturating_sub(rate as usize)];
        let h = holes(rate, body);
        println!(
            "{who}: {} holes over {:.1} s: {:?}",
            h.len(),
            body.len() as f32 / rate as f32,
            h.iter()
                .take(12)
                .map(|(t, ms)| format!("{t:.2}s/{ms:.0}ms"))
                .collect::<Vec<_>>()
        );
    }
    for base in ["ra", "rb"] {
        let (_, s) = wav_samples(&tmp.path().join(format!("{base}-rx.wav")));
        assert!(s.len() > 48_000 * 12, "{base}: the recording is incomplete");
    }
}

/// `call_stats` tells what the audio of a call is doing: codec, packets both ways, jitter buffer, and how
/// regularly the audio blocks go through (20 ms apart on a healthy call).
#[tokio::test]
async fn call_stats_describe_the_audio_of_a_call_in_progress() {
    let Some(t) = talk().await else { return };
    tokio::time::sleep(Duration::from_secs(4)).await;

    for (who, e, id) in [("A", &t.a, &t.call_a), ("B", &t.b, &t.call_b)] {
        let s = e.call_stats(id).await.unwrap().expect("stats of the call");
        println!("{who}: {s:?}");
        assert!(!s.codec.is_empty() && s.clock_rate >= 8000, "{who}: codec");
        // ~50 packets a second for ~4 s, less the set-up.
        assert!(
            (100..=260).contains(&s.rtp.rx_packets),
            "{who}: rx {}",
            s.rtp.rx_packets
        );
        assert!(
            (100..=260).contains(&s.rtp.tx_packets),
            "{who}: tx {}",
            s.rtp.tx_packets
        );
        assert!(s.rtp.rx_bytes > 10_000 && s.rtp.tx_bytes > 10_000);
        assert_eq!((s.rtp.rx_errors, s.rtp.tx_errors), (0, 0));
        assert!(
            s.jbuf.put >= 100 && s.jbuf.get >= 100,
            "{who}: jitter buffer"
        );
        assert!(s.jbuf.delay_ms <= 300);
        // The audio blocks of the filter: one per 20 ms, so 4 s hold 150 or more, 20 ms apart.
        for (dir, f) in [("rx", &s.filters.rx), ("tx", &s.filters.tx)] {
            assert!(f.frames >= 120, "{who} {dir}: {} blocks", f.frames);
            assert!(f.srate >= 8000 && f.channels >= 1, "{who} {dir}: format");
            assert!(f.gap_max_us >= 15_000, "{who} {dir}: gap {}", f.gap_max_us);
            assert!(
                f.busy_max_us < 20_000,
                "{who} {dir}: busy {}",
                f.busy_max_us
            );
        }
        assert!(!s.filters.recording.on);
    }

    // The maxima cover the time since the previous read: a second read right away starts a new window.
    let again = t.a.call_stats(&t.call_a).await.unwrap().unwrap();
    assert!(again.filters.rx.gap_max_us < 100_000);

    // An unknown call has no audio.
    assert_eq!(t.a.call_stats("nonexistent").await.unwrap(), None);
    // A call id that is not one is refused before it reaches the engine.
    assert!(t.a.call_stats("a b").await.is_err());

    t.a.hangup(&t.call_a, None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(t.a.call_stats(&t.call_a).await.unwrap(), None);
    t.a.stop().await;
    t.b.stop().await;
}
