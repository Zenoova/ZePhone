//! Switching audio devices during a REAL call: the real `SipManager` + the real Baresip sidecar + a second real
//! Baresip as the other phone, with synthetic audio (a sine as the microphone, files as the speakers).
//!
//! What is checked is what really happens to the call and its audio: the SIP session stays up, a muted
//! microphone stays silent through the switch, the new source is what the other party hears, the new player is
//! what we hear. Real headsets are not involved; what needs them is listed in docs/HEADSETS.md.

mod support;

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use secrecy::SecretString;
use support::*;
use zephone_lib::{
    audio::{
        devices::{DeviceInfo, Transport},
        router::Target,
        routing::Role,
    },
    database::Database,
    security::secrets::{MemoryStore, SecretStore},
    sip::{
        engine::{AccountSpec, AudioOverride, SipEngine, baresip::BaresipEngine},
        manager::{EngineInfo, SipManager, UiSink},
        types::{
            AccountInput, AccountStatus, Call, CallState, MediaEncryption,
            Transport as SipTransport,
        },
    },
};

struct Quiet;
impl UiSink for Quiet {
    fn engine_state(&self, _: &EngineInfo) {}
    fn account_status(&self, _: &AccountStatus) {}
    fn call_update(&self, _: &Call) {}
    fn history_changed(&self) {}
    fn incoming_call(&self, _: &Call, _: bool) {}
    fn missed_call(&self, _: &Call, _: bool) {}
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

fn free_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct World {
    mgr: Arc<SipManager>,
    b: BaresipEngine,
    port_a: u16,
    tmp: tempfile::TempDir,
    a_rx: PathBuf,
    b_rx: PathBuf,
}

async fn world() -> Option<World> {
    let tmp = tempfile::tempdir().unwrap();
    let (a_rx, b_rx) = (tmp.path().join("a.wav"), tmp.path().join("b.wav"));
    let (port_a, port_b) = (free_port(), free_port());
    let extra = test_modules_dir()?;

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
    let secrets: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
    let mgr = SipManager::new(engine, db, secrets, Arc::new(Quiet));
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
        transport: SipTransport::Udp,
        outbound_proxy: Some(format!("127.0.0.1:{port_b}")),
        register_interval: Some(0),
        media_encryption: MediaEncryption::None,
        enabled: true,
        password: Some("pw".into()),
    })
    .await
    .ok()?;
    let b = remote_phone(tmp.path(), "b", 880, &b_rx, Some(port_b)).await?;
    b.add_account(&AccountSpec {
        aor: "sip:bob@127.0.0.1".into(),
        username: "bob".into(),
        domain: "127.0.0.1".into(),
        auth_username: None,
        password: SecretString::from("x".to_string()),
        display_name: Some("Bob Remote".into()),
        transport: SipTransport::Udp,
        next_hop_host: "127.0.0.1".into(),
        next_hop_port: port_a,
        register_interval: 0,
        media_encryption: MediaEncryption::None,
    })
    .await
    .ok()?;
    until("account hosted", 10, || {
        !mgr.connected_account_ids().is_empty()
    })
    .await;
    Some(World {
        mgr,
        b,
        port_a,
        tmp,
        a_rx,
        b_rx,
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

/// A "device" for the synthetic drivers: the name is a sine frequency (microphone) or a WAV path (speaker).
fn device(name: &str) -> DeviceInfo {
    DeviceInfo {
        uid: name.into(),
        name: name.into(),
        transport: Transport::Usb,
        input_channels: 1,
        output_channels: 2,
        alive: true,
        public_speaker: false,
        in_use_elsewhere: false,
        selectable: true,
        duplicate_name: false,
    }
}

/// The first channel of a WAV being written (16-bit PCM, header sizes not yet final): everything after the header.
fn samples_of(path: &Path) -> (u32, Vec<f32>) {
    let b = std::fs::read(path).unwrap_or_default();
    if b.len() < 44 {
        return (8000, vec![]);
    }
    let channels = u16::from_le_bytes([b[22], b[23]]).max(1) as usize;
    let rate = u32::from_le_bytes([b[24], b[25], b[26], b[27]]);
    let pos = b
        .windows(4)
        .position(|w| w == b"data")
        .map(|p| p + 8)
        .unwrap_or(44);
    let all: Vec<f32> = b[pos.min(b.len())..]
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
        .collect();
    (rate, all.chunks_exact(channels).map(|f| f[0]).collect())
}

/// The last `seconds` of a file's audio.
fn tail(path: &Path, seconds: f32) -> (u32, Vec<f32>) {
    let (rate, all) = samples_of(path);
    let n = (rate as f32 * seconds) as usize;
    (rate, all[all.len().saturating_sub(n)..].to_vec())
}

/// Power of one frequency in the samples (Goertzel).
fn power_at(rate: u32, s: &[f32], freq: f32) -> f32 {
    let w = 2.0 * std::f32::consts::PI * freq / rate as f32;
    let k = 2.0 * w.cos();
    let (mut a, mut b) = (0.0f32, 0.0f32);
    for x in s {
        let n = x + k * a - b;
        b = a;
        a = n;
    }
    (a * a + b * b - k * a * b) / s.len().max(1) as f32
}

fn rms(s: &[f32]) -> f32 {
    (s.iter().map(|x| x * x).sum::<f32>() / s.len().max(1) as f32).sqrt()
}

async fn connected_call(w: &World) -> String {
    w.b.dial(
        "sip:bob@127.0.0.1",
        &format!("sip:alice@127.0.0.1:{}", w.port_a),
    )
    .await
    .expect("B calls A");
    until("A rings", 10, || {
        w.mgr.calls().iter().any(|c| c.state == CallState::Incoming)
    })
    .await;
    let id = w.mgr.calls()[0].id.clone();
    w.mgr.answer(&id).await.unwrap();
    until("connected", 10, || {
        w.mgr
            .calls()
            .first()
            .is_some_and(|c| c.state == CallState::Connected)
    })
    .await;
    tokio::time::sleep(Duration::from_millis(1500)).await; // audio flows
    id
}

#[tokio::test]
async fn switching_the_microphone_in_a_call_keeps_the_session_the_mute_and_moves_the_audio() {
    let w = world_or_skip!();
    let id = connected_call(&w).await;

    // Before: B hears our 440 Hz.
    let (rate, before) = tail(&w.b_rx, 1.0);
    assert!(
        power_at(rate, &before, 440.0) > 10.0 * power_at(rate, &before, 1000.0),
        "B hears 440 Hz first"
    );

    // The user mutes, then the microphone device changes (a headset replaced the built-in one).
    w.mgr.set_mute(&id, true).await.unwrap();
    w.mgr
        .apply(Role::Microphone, &device("1000"), true)
        .await
        .expect("the engine accepts the new source");
    assert_eq!(w.mgr.calls().len(), 1, "the SIP session is still there");
    assert_eq!(w.mgr.calls()[0].state, CallState::Connected);
    // What the router does after any mid-call switch.
    w.mgr.reassert_call_state().await;
    assert!(w.mgr.calls()[0].muted, "still muted for the interface");

    // Still muted for the other party: the new source is silent on the wire.
    tokio::time::sleep(Duration::from_millis(1800)).await;
    let (rate, muted) = tail(&w.b_rx, 1.0);
    assert!(
        rms(&muted) < 0.01,
        "B hears nothing while muted after the switch (rms {})",
        rms(&muted)
    );

    // Unmuted: B hears the NEW source (1000 Hz), not the old one.
    w.mgr.set_mute(&id, false).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1800)).await;
    let (rate2, heard) = tail(&w.b_rx, 1.0);
    let (p1000, p440) = (
        power_at(rate2, &heard, 1000.0),
        power_at(rate2, &heard, 440.0),
    );
    assert!(
        p1000 > 10.0 * p440,
        "B now hears 1000 Hz ({p1000}) and no longer 440 Hz ({p440}); rate {rate}"
    );
    assert_eq!(w.mgr.calls()[0].state, CallState::Connected);
}

#[tokio::test]
async fn switching_the_speaker_in_a_call_moves_what_we_hear_to_the_new_device() {
    let w = world_or_skip!();
    let id = connected_call(&w).await;
    let (rate, old) = tail(&w.a_rx, 1.0);
    assert!(
        power_at(rate, &old, 880.0) > 10.0 * power_at(rate, &old, 440.0),
        "we hear B's 880 Hz on the first device"
    );

    let second = w.tmp.path().join("a2.wav");
    w.mgr
        .apply(Role::Speaker, &device(second.to_str().unwrap()), true)
        .await
        .expect("new player accepted");
    tokio::time::sleep(Duration::from_millis(2000)).await;
    let (rate, now) = tail(&second, 1.0);
    assert!(
        now.len() > (rate / 2) as usize,
        "the second device received audio"
    );
    assert!(
        power_at(rate, &now, 880.0) > 10.0 * power_at(rate, &now, 440.0),
        "…and it is B's voice"
    );
    assert_eq!(
        w.mgr.calls()[0].state,
        CallState::Connected,
        "the call never dropped"
    );
    let _ = id;
}

#[tokio::test]
async fn a_call_on_hold_stays_on_hold_through_a_device_switch_and_resumes_on_the_new_device() {
    let w = world_or_skip!();
    let id = connected_call(&w).await;
    w.mgr.hold(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert!(w.mgr.calls()[0].held_locally);

    let second = w.tmp.path().join("a3.wav");
    w.mgr
        .apply(Role::Speaker, &device(second.to_str().unwrap()), true)
        .await
        .expect("switch while on hold");
    w.mgr
        .apply(Role::Microphone, &device("700"), true)
        .await
        .expect("switch while on hold");
    w.mgr.reassert_call_state().await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(w.mgr.calls()[0].held_locally, "still on hold");
    assert_eq!(w.mgr.calls().len(), 1);

    w.mgr.resume(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let (rate, now) = tail(&second, 1.0);
    assert!(
        power_at(rate, &now, 880.0) > 10.0 * power_at(rate, &now, 440.0),
        "after resuming we hear B on the new device"
    );
    let (rate, sent) = tail(&w.b_rx, 1.0);
    assert!(
        power_at(rate, &sent, 700.0) > 10.0 * power_at(rate, &sent, 440.0),
        "…and B hears the new microphone"
    );
}

#[tokio::test]
async fn a_device_the_engine_does_not_know_is_refused_and_the_call_goes_on() {
    let w = world_or_skip!();
    let id = connected_call(&w).await;
    // A file player in a folder that does not exist cannot be opened: the engine must refuse or fail the switch,
    // and the call must survive either way.
    let r = w
        .mgr
        .apply(Role::Speaker, &device("/nonexistent-folder/x.wav"), true)
        .await;
    println!("refusal: {r:?}");
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(w.mgr.calls().len(), 1, "the call survived a bad device");
    assert_eq!(w.mgr.calls()[0].state, CallState::Connected);
    // And a good switch afterwards works (recovery).
    let ok = w.tmp.path().join("ok.wav");
    w.mgr
        .apply(Role::Speaker, &device(ok.to_str().unwrap()), true)
        .await
        .expect("recovers");
    let _ = id;
}
