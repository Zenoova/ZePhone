//! End-to-end tests against the REAL Baresip sidecar (no mocks).
//!
//! Requirements: `scripts/prepare-baresip.sh` has been run (the tests are skipped
//! with a message otherwise), and for the call test a local Baresip install that
//! provides the `ausine`/`aufile` modules (Homebrew, or `ZEPHONE_TEST_MODULES_DIR`).
//!
//! Run: `cargo test --test engine_integration -- --nocapture --test-threads=1`

mod support;

use std::{path::Path, process::Command, time::Duration};

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
        "B was not told about the resume"
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
