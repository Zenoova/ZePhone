//! [`SipEngine`] implementation driving a Baresip child process through its
//! `ctrl_tcp` module. One process for the whole app lifetime, supervised and
//! restarted with a back-off if it dies.

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use secrecy::ExposeSecret as _;
use tokio::{
    sync::{RwLock, broadcast, mpsc, oneshot},
    task::JoinHandle,
};

use super::{
    client::ControlClient,
    config::{self, ConfigInput, EngineSettings},
    process::{self, BaresipPaths, LogSink},
};
use crate::{
    security::redact::redact,
    sip::engine::{
        AccountSpec, EngineError, EngineEvent, EngineOptions, EngineResult, EngineState, SipEngine,
        protocol,
    },
};

const MAX_CONSECUTIVE_FAILURES: u32 = 6;
const HEALTHY_AFTER: Duration = Duration::from_secs(30);
const BACKOFF: [Duration; 6] = [
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(15),
];

struct Supervisor {
    stop: Option<oneshot::Sender<()>>,
    handle: JoinHandle<()>,
}

struct Inner {
    paths: BaresipPaths,
    settings: Mutex<EngineSettings>,
    events: broadcast::Sender<EngineEvent>,
    state: Mutex<EngineState>,
    client: RwLock<Option<Arc<ControlClient>>>,
    sink: Arc<LogSink>,
    /// Serialises multi-step command sequences (`uafind`+`dial`, `callfind`+`mute`, ...)
    /// so that concurrent callers cannot interleave and act on the wrong call.
    seq_lock: tokio::sync::Mutex<()>,
    supervisor: tokio::sync::Mutex<Option<Supervisor>>,
}

impl Inner {
    fn set_state(&self, st: EngineState) {
        *self.state.lock().unwrap() = st.clone();
        let _ = self.events.send(EngineEvent::State(st));
    }
}

pub struct BaresipEngine {
    inner: Arc<Inner>,
}

impl BaresipEngine {
    pub fn new(paths: BaresipPaths) -> Self {
        let (events, _) = broadcast::channel(1024);
        Self {
            inner: Arc::new(Inner {
                paths,
                settings: Mutex::new(EngineSettings::default()),
                events,
                state: Mutex::new(EngineState::Stopped),
                client: RwLock::new(None),
                sink: Arc::new(LogSink::default()),
                seq_lock: tokio::sync::Mutex::new(()),
                supervisor: tokio::sync::Mutex::new(None),
            }),
        }
    }

    async fn client(&self) -> EngineResult<Arc<ControlClient>> {
        match self.inner.client.read().await.as_ref() {
            Some(c) if !c.is_closed() => Ok(c.clone()),
            _ => Err(EngineError::NotRunning),
        }
    }

    /// Runs a command, mapping a negative answer to an error. Output is redacted:
    /// `uanew` echoes the whole account line, password included.
    async fn run(&self, command: &str, params: &str) -> EngineResult<protocol::Response> {
        let client = self.client().await?;
        let resp = client.request(command, params).await?;
        if !resp.ok {
            // Baresip prints context first and the actual error last
            // ("call uri: ..." then "ua_connect failed: ..."): keep every non-empty line.
            let text = redact(resp.data.trim())
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(EngineError::CommandFailed(if text.is_empty() {
                command.to_owned()
            } else {
                text
            }));
        }
        Ok(resp)
    }
}

fn is_call_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn check_call_id(id: &str) -> EngineResult<()> {
    if is_call_id(id) {
        Ok(())
    } else {
        Err(EngineError::Invalid("identifiant d'appel invalide".into()))
    }
}

fn check_no_space(label: &str, v: &str) -> EngineResult<()> {
    if v.is_empty() || v.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(EngineError::Invalid(format!("{label} invalide")));
    }
    Ok(())
}

#[async_trait]
impl SipEngine for BaresipEngine {
    fn name(&self) -> &'static str {
        "baresip"
    }

    fn version(&self) -> Option<String> {
        self.inner.sink.version()
    }

    fn codecs(&self) -> Vec<String> {
        self.inner.sink.codecs()
    }

    fn state(&self) -> EngineState {
        self.inner.state.lock().unwrap().clone()
    }

    fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.inner.events.subscribe()
    }

    fn set_options(&self, options: EngineOptions) {
        *self.inner.settings.lock().unwrap() = options;
    }

    fn log_tail(&self, lines: usize) -> Vec<String> {
        self.inner.sink.tail(lines)
    }

    async fn start(&self) -> EngineResult<()> {
        let mut slot = self.inner.supervisor.lock().await;
        if let Some(s) = slot.as_ref()
            && !s.handle.is_finished()
        {
            return Ok(());
        }
        *slot = None;

        let (stop_tx, stop_rx) = oneshot::channel();
        let (ready_tx, ready_rx) = oneshot::channel();
        let inner = self.inner.clone();
        let handle = tokio::spawn(supervise(inner, stop_rx, ready_tx));
        *slot = Some(Supervisor {
            stop: Some(stop_tx),
            handle,
        });
        drop(slot);

        match tokio::time::timeout(Duration::from_secs(20), ready_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(EngineError::Io(
                "le superviseur du moteur s'est arrêté".into(),
            )),
            Err(_) => Err(EngineError::Timeout),
        }
    }

    async fn stop(&self) {
        let sup = self.inner.supervisor.lock().await.take();
        if let Some(mut sup) = sup {
            if let Some(tx) = sup.stop.take() {
                let _ = tx.send(());
            }
            if tokio::time::timeout(Duration::from_secs(8), &mut sup.handle)
                .await
                .is_err()
            {
                sup.handle.abort();
            }
        }
        *self.inner.client.write().await = None;
        process::remove_pid_file(&self.inner.paths);
        self.inner.set_state(EngineState::Stopped);
    }

    async fn add_account(&self, spec: &AccountSpec) -> EngineResult<()> {
        let line = config::account_line(spec);
        // `spec.password` is exposed only inside `line`, which is sent over loopback.
        let _ = spec.password.expose_secret().len();
        self.run("uanew", &line).await.map(|_| ())
    }

    async fn remove_account(&self, aor: &str) -> EngineResult<()> {
        check_no_space("adresse du compte", aor)?;
        self.run("uadel", aor).await.map(|_| ())
    }

    async fn dial(&self, aor: &str, target_uri: &str) -> EngineResult<String> {
        check_no_space("adresse du compte", aor)?;
        check_no_space("destinataire", target_uri)?;
        let _seq = self.inner.seq_lock.lock().await;
        self.run("uafind", aor).await.map_err(|e| match e {
            EngineError::CommandFailed(_) => {
                EngineError::CommandFailed("ce compte n'est pas connecté au moteur SIP".into())
            }
            other => other,
        })?;
        let resp = self.run("dial", target_uri).await?;
        resp.data
            .lines()
            .find_map(|l| l.trim().strip_prefix("call id: "))
            .map(|id| id.trim().to_owned())
            .filter(|id| is_call_id(id))
            .ok_or_else(|| EngineError::Protocol("identifiant d'appel absent de la réponse".into()))
    }

    async fn accept(&self, call_id: &str) -> EngineResult<()> {
        check_call_id(call_id)?;
        self.run("accept", call_id).await.map(|_| ())
    }

    async fn hangup(&self, call_id: &str, reject: Option<u16>) -> EngineResult<()> {
        check_call_id(call_id)?;
        let params = match reject {
            Some(code) if (400..=699).contains(&code) => {
                let reason = match code {
                    486 => "Busy",
                    603 => "Decline",
                    _ => "Rejected",
                };
                format!("{call_id} scode={code} reason={reason}")
            }
            Some(_) => return Err(EngineError::Invalid("code SIP de refus invalide".into())),
            None => call_id.to_owned(),
        };
        self.run("hangup", &params).await.map(|_| ())
    }

    async fn hold(&self, call_id: &str) -> EngineResult<()> {
        check_call_id(call_id)?;
        self.run("hold", call_id).await.map(|_| ())
    }

    async fn resume(&self, call_id: &str) -> EngineResult<()> {
        check_call_id(call_id)?;
        self.run("resume", call_id).await.map(|_| ())
    }

    async fn set_mute(&self, call_id: &str, muted: bool) -> EngineResult<()> {
        check_call_id(call_id)?;
        let _seq = self.inner.seq_lock.lock().await;
        self.run("callfind", call_id).await?;
        self.run("mute", if muted { "yes" } else { "no" })
            .await
            .map(|_| ())
    }

    async fn send_dtmf(&self, call_id: &str, digits: &str) -> EngineResult<()> {
        check_call_id(call_id)?;
        if digits.is_empty()
            || digits.len() > 32
            || !digits
                .chars()
                .all(|c| matches!(c, '0'..='9' | '*' | '#' | 'A'..='D' | 'a'..='d'))
        {
            return Err(EngineError::Invalid(
                "tonalités DTMF invalides (0-9, *, #, A-D)".into(),
            ));
        }
        let _seq = self.inner.seq_lock.lock().await;
        self.run("callfind", call_id).await?;
        self.run("sndcode", digits).await.map(|_| ())
    }

    async fn transfer(&self, call_id: &str, target_uri: &str) -> EngineResult<()> {
        check_call_id(call_id)?;
        check_no_space("destinataire du transfert", target_uri)?;
        let _seq = self.inner.seq_lock.lock().await;
        self.run("callfind", call_id).await?;
        self.run("transfer", target_uri).await.map(|_| ())
    }

    async fn silence_ringtone(&self) -> EngineResult<()> {
        self.run("stopringing", "").await.map(|_| ())
    }

    async fn set_gains(&self, input: f32, output: f32) -> EngineResult<()> {
        for (direction, factor) in [("tx", input), ("rx", output)] {
            if !factor.is_finite() {
                return Err(EngineError::Invalid("volume invalide".into()));
            }
            let factor = factor.clamp(0.0, 4.0);
            self.run("zegain", &format!("{direction} {factor:.2}"))
                .await?;
        }
        Ok(())
    }

    async fn start_recording(&self, base: &std::path::Path) -> EngineResult<()> {
        let base = base.to_string_lossy();
        if base.is_empty() || base.len() > 900 || base.chars().any(char::is_control) {
            return Err(EngineError::Invalid(
                "chemin d'enregistrement invalide".into(),
            ));
        }
        self.run("zerec_start", &base).await.map(|_| ())
    }

    async fn stop_recording(&self) -> EngineResult<()> {
        self.run("zerec_stop", "").await.map(|_| ())
    }

    async fn set_audio_devices(
        &self,
        input: Option<&str>,
        output: Option<&str>,
    ) -> EngineResult<()> {
        {
            let mut s = self.inner.settings.lock().unwrap();
            s.input_device = input.map(str::to_owned);
            s.output_device = output.map(str::to_owned);
        }
        if self.client().await.is_err() {
            return Ok(()); // picked up at next start
        }
        let driver = config::audio_driver();
        // The `auplay`/`ausrc` commands only accept real device names (the literal "default"
        // is valid in the config file but not in these commands): resolve "system default"
        // to the name of the current default device.
        let (default_in, default_out) = crate::audio::default_names();
        let player = output.map(str::to_owned).or(default_out);
        let source = input.map(str::to_owned).or(default_in);
        for (cmd, dev) in [("auplay", player), ("ausrc", source)] {
            let Some(dev) = dev else { continue };
            let dev = config::sanitize_device(Some(&dev));
            let resp = self.run(cmd, &format!("{driver},{dev}")).await?;
            // Baresip answers "ok" even when the device is unknown, with a message.
            if resp.data.contains("no such") || resp.data.contains("Format should be") {
                let msg = resp
                    .data
                    .lines()
                    .next()
                    .unwrap_or("périphérique audio inconnu")
                    .to_owned();
                return Err(EngineError::CommandFailed(msg));
            }
        }
        Ok(())
    }
}

enum Outcome {
    Stopped,
    Died(String),
    StartFailed(String),
}

async fn supervise(
    inner: Arc<Inner>,
    mut stop_rx: oneshot::Receiver<()>,
    ready: oneshot::Sender<EngineResult<()>>,
) {
    let mut ready = Some(ready);
    let mut failures: u32 = 0;
    inner.set_state(EngineState::Starting);

    loop {
        let started = Instant::now();
        let outcome = run_once(&inner, &mut stop_rx, &mut ready).await;
        *inner.client.write().await = None;
        process::remove_pid_file(&inner.paths);

        let reason = match outcome {
            Outcome::Stopped => {
                inner.set_state(EngineState::Stopped);
                return;
            }
            Outcome::StartFailed(r) | Outcome::Died(r) => r,
        };
        log::error!("baresip engine stopped unexpectedly: {reason}");
        for l in inner.sink.tail(12) {
            log::debug!(target: "baresip", "[last output] {l}");
        }

        if started.elapsed() >= HEALTHY_AFTER {
            failures = 0;
        }
        failures += 1;

        if let Some(tx) = ready.take() {
            // The very first start failed: report it to `start()` and give up
            // (retrying a missing binary or a bad config cannot help).
            let _ = tx.send(Err(EngineError::Io(reason.clone())));
            inner.set_state(EngineState::Failed { reason });
            return;
        }
        if failures >= MAX_CONSECUTIVE_FAILURES {
            inner.set_state(EngineState::Failed { reason });
            return;
        }
        inner.set_state(EngineState::Restarting {
            attempt: failures,
            reason,
        });
        let delay = BACKOFF[(failures as usize - 1).min(BACKOFF.len() - 1)];
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = &mut stop_rx => {
                inner.set_state(EngineState::Stopped);
                return;
            }
        }
    }
}

async fn run_once(
    inner: &Arc<Inner>,
    stop_rx: &mut oneshot::Receiver<()>,
    ready: &mut Option<oneshot::Sender<EngineResult<()>>>,
) -> Outcome {
    let paths = &inner.paths;
    let settings = inner.settings.lock().unwrap().clone();

    if !paths.exe.is_file() {
        return Outcome::StartFailed(format!(
            "exécutable Baresip introuvable : {}",
            paths.exe.display()
        ));
    }
    if let Err(e) = process::ensure_private_dir(&paths.work_dir) {
        return Outcome::StartFailed(format!("impossible de préparer le dossier du moteur : {e}"));
    }
    if process::kill_stale_instance(paths) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let port = match process::pick_free_port() {
        Ok(p) => p,
        Err(e) => return Outcome::StartFailed(format!("aucun port local disponible : {e}")),
    };
    let modules_dir = paths.modules_dir.clone();
    let exists = move |m: &str| modules_dir.join(m).is_file();
    let cfg = config::render_config(&ConfigInput {
        modules_dir: &paths.modules_dir,
        sounds_dir: &paths.sounds_dir,
        ctrl_port: port,
        settings: &settings,
        module_exists: &exists,
    });
    if let Err(e) = process::write_private_file(&paths.work_dir.join("config"), &cfg) {
        return Outcome::StartFailed(format!("écriture de la configuration impossible : {e}"));
    }
    // Make sure no stale accounts file can ever be picked up.
    let _ = std::fs::remove_file(paths.work_dir.join("accounts"));

    inner.sink.clear_startup_info();
    let mut spawned = match process::spawn(paths, inner.sink.clone(), settings.sip_trace) {
        Ok(s) => s,
        Err(e) => return Outcome::StartFailed(format!("démarrage de Baresip impossible : {e}")),
    };
    log::info!(
        "baresip started (pid {:?}, control on 127.0.0.1:{port})",
        spawned.pid
    );

    // Connect to the control socket, watching for an early exit.
    let (ev_tx, mut ev_rx) = mpsc::unbounded_channel();
    let mut connected: Option<(Arc<ControlClient>, oneshot::Receiver<String>)> = None;
    for _ in 0..60 {
        let (close_tx, close_rx) = oneshot::channel();
        tokio::select! {
            status = spawned.child.wait() => {
                let tail = inner.sink.tail(6).join(" | ");
                return Outcome::Died(format!("Baresip s'est arrêté au démarrage ({:?}) {tail}", status.ok()));
            }
            _ = &mut *stop_rx => {
                shutdown_child(&mut spawned.child, None).await;
                return Outcome::Stopped;
            }
            res = ControlClient::connect(port, ev_tx.clone(), close_tx) => {
                if let Ok(c) = res {
                    connected = Some((c, close_rx));
                }
            }
        }
        if connected.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let Some((client, mut close_rx)) = connected else {
        shutdown_child(&mut spawned.child, None).await;
        return Outcome::StartFailed("le canal de contrôle de Baresip ne répond pas".into());
    };

    // Handshake: a harmless command proves the module is up and talking JSON.
    match client
        .request_with_timeout("reginfo", "", Duration::from_secs(4))
        .await
    {
        Ok(r) if r.ok => {}
        Ok(_) | Err(_) => {
            shutdown_child(&mut spawned.child, Some(&client)).await;
            return Outcome::StartFailed(
                "handshake avec Baresip impossible (réponse invalide)".into(),
            );
        }
    }

    *inner.client.write().await = Some(client.clone());
    inner.set_state(EngineState::Running);
    if let Some(tx) = ready.take() {
        let _ = tx.send(Ok(()));
    }

    loop {
        tokio::select! {
            _ = &mut *stop_rx => {
                shutdown_child(&mut spawned.child, Some(&client)).await;
                return Outcome::Stopped;
            }
            status = spawned.child.wait() => {
                return Outcome::Died(format!("Baresip s'est arrêté ({:?})", status.ok()));
            }
            reason = &mut close_rx => {
                let reason = reason.unwrap_or_else(|_| "canal de contrôle fermé".into());
                shutdown_child(&mut spawned.child, None).await;
                return Outcome::Died(reason);
            }
            Some(raw) = ev_rx.recv() => {
                if let Some(ev) = protocol::to_engine_event(&raw) {
                    let _ = inner.events.send(ev);
                }
            }
        }
    }
}

/// Graceful stop: ask Baresip to quit, wait a little, then kill.
async fn shutdown_child(child: &mut tokio::process::Child, client: Option<&Arc<ControlClient>>) {
    if let Some(c) = client {
        let _ = c
            .request_with_timeout("quit", "", Duration::from_millis(800))
            .await;
    }
    match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
        Ok(_) => {}
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_id_validation() {
        assert!(is_call_id("73a12546589651f8"));
        assert!(is_call_id("a-b_c.d"));
        assert!(!is_call_id(""));
        assert!(!is_call_id("abc def"));
        assert!(!is_call_id("abc\nquit"));
        assert!(!is_call_id(&"a".repeat(65)));
    }

    #[tokio::test]
    async fn commands_fail_cleanly_when_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let engine = BaresipEngine::new(BaresipPaths {
            exe: dir.path().join("nope"),
            modules_dir: dir.path().into(),
            sounds_dir: dir.path().into(),
            work_dir: dir.path().join("w"),
        });
        assert!(matches!(
            engine.hold("abc").await,
            Err(EngineError::NotRunning)
        ));
        assert!(matches!(
            engine.hold("a b").await,
            Err(EngineError::Invalid(_))
        ));
        assert!(matches!(
            engine.send_dtmf("abc", "12x").await,
            Err(EngineError::Invalid(_))
        ));
        assert!(matches!(
            engine.hangup("abc", Some(200)).await,
            Err(EngineError::Invalid(_))
        ));
        assert_eq!(engine.state(), EngineState::Stopped);
    }

    #[tokio::test]
    async fn start_fails_with_a_clear_error_when_the_binary_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let engine = BaresipEngine::new(BaresipPaths {
            exe: dir.path().join("missing-baresip"),
            modules_dir: dir.path().into(),
            sounds_dir: dir.path().into(),
            work_dir: dir.path().join("w"),
        });
        let err = engine.start().await.unwrap_err();
        assert!(err.to_string().contains("introuvable"), "{err}");
        assert!(matches!(engine.state(), EngineState::Failed { .. }));
        // stop() after a failed start is harmless.
        engine.stop().await;
        assert_eq!(engine.state(), EngineState::Stopped);
    }
}
