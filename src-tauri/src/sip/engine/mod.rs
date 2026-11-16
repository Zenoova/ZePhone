//! SIP engine abstraction. The rest of the application only talks to
//! [`SipEngine`] and consumes engine-neutral [`EngineEvent`]s, so Baresip can be
//! swapped for `libbaresip` (FFI) or another stack without touching the manager,
//! commands or UI.

pub mod baresip;
pub mod netstring;
pub mod protocol;

use async_trait::async_trait;
use secrecy::SecretString;
use serde::Serialize;
use tokio::sync::broadcast;

pub use crate::sip::stats::RawCallStats;
use crate::sip::types::{CallDirection, MediaEncryption, Transport};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum EngineState {
    Stopped,
    Starting,
    Running,
    /// The engine died or lost its control channel and is being restarted.
    Restarting {
        attempt: u32,
        reason: String,
    },
    /// Gave up (binary missing, repeated crashes...). Needs a manual restart.
    Failed {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CallRef {
    pub id: String,
    /// AoR of the local account the call belongs to (`sip:user@domain`).
    pub aor: String,
    pub direction: CallDirection,
    pub peer_uri: String,
    pub peer_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RegistrationEvent {
    /// The user agent exists in the engine (before any REGISTER is sent).
    Created,
    Registering,
    Registered {
        code: Option<u16>,
        reason: String,
    },
    Failed {
        code: Option<u16>,
        reason: String,
    },
    Unregistering,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CallEvent {
    Incoming,
    /// INVITE sent.
    Outgoing,
    /// 180 Ringing / 183 Session Progress.
    Ringing,
    Established,
    Closed {
        code: Option<u16>,
        reason: String,
    },
    Hold,
    Resume,
    TransferFailed {
        code: Option<u16>,
        reason: String,
    },
    Dtmf {
        key: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    State(EngineState),
    Registration {
        aor: String,
        event: RegistrationEvent,
    },
    Call {
        call: CallRef,
        event: CallEvent,
    },
    /// Live audio level of a call, in dBFS (-96 = silence, 0 = full scale). `tx` is our microphone,
    /// otherwise the remote voice as played to us.
    AudioLevel {
        call_id: String,
        tx: bool,
        db: f32,
    },
    AudioError {
        call_id: Option<String>,
        message: String,
    },
}

/// Everything needed to create a user agent. The password is a [`SecretString`]
/// so it can never end up in a `Debug`/log line by accident.
pub struct AccountSpec {
    pub aor: String,
    pub username: String,
    pub domain: String,
    pub auth_username: Option<String>,
    pub password: SecretString,
    pub display_name: Option<String>,
    pub transport: Transport,
    /// Where requests are sent: the outbound proxy if configured, else the server.
    pub next_hop_host: String,
    pub next_hop_port: u16,
    pub register_interval: u32,
    pub media_encryption: MediaEncryption,
}

/// Engine-wide options that require a (re)start of the engine to take effect,
/// except for the audio devices which can also be switched live.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EngineOptions {
    /// Microphone device name (`None` = system default).
    pub input_device: Option<String>,
    /// Speaker device name (`None` = system default).
    pub output_device: Option<String>,
    /// Extra CA bundle used to verify SIP/TLS servers.
    pub ca_file: Option<std::path::PathBuf>,
    pub sip_trace: bool,
    /// Fixed local SIP port (all interfaces). `None` = ephemeral port chosen by the engine.
    pub local_sip_port: Option<u16>,
    /// Restricts the engine to one network interface (e.g. `en0`) or local IP address.
    pub net_interface: Option<String>,
    /// Replaces the system audio devices with file/synthetic drivers. Used by the
    /// automated end-to-end tests (no sound card needed); never set by the app.
    pub audio_override: Option<AudioOverride>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioOverride {
    /// Modules to load instead of the platform audio driver (e.g. `ausine`, `aufile`).
    pub modules: Vec<String>,
    /// `audio_source` value, e.g. `ausine,440`.
    pub source: String,
    /// `audio_player` value, e.g. `aufile,/tmp/out.wav`.
    pub player: String,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum EngineError {
    #[error("le moteur SIP n'est pas démarré")]
    NotRunning,
    #[error("délai dépassé en attendant le moteur SIP")]
    Timeout,
    #[error("commande refusée par le moteur : {0}")]
    CommandFailed(String),
    #[error("{0}")]
    Io(String),
    #[error("protocole : {0}")]
    Protocol(String),
    #[error("{0}")]
    Invalid(String),
}

pub type EngineResult<T> = Result<T, EngineError>;

#[async_trait]
pub trait SipEngine: Send + Sync + 'static {
    /// Short identifier for logs/diagnostics ("baresip").
    fn name(&self) -> &'static str;
    /// Version string of the underlying stack, once known.
    fn version(&self) -> Option<String>;
    /// Audio/video codecs (payload names) available in this build.
    fn codecs(&self) -> Vec<String>;

    /// Starts the engine and its supervisor. Returns once the control channel is up
    /// (or an error if the first start failed).
    async fn start(&self) -> EngineResult<()>;
    /// Stops the engine and cleans up every resource. Safe to call several times.
    async fn stop(&self);
    fn state(&self) -> EngineState;
    fn subscribe(&self) -> broadcast::Receiver<EngineEvent>;

    async fn add_account(&self, spec: &AccountSpec) -> EngineResult<()>;
    async fn remove_account(&self, aor: &str) -> EngineResult<()>;

    /// Starts an outgoing call from `aor` to `target_uri`; returns the call id.
    async fn dial(&self, aor: &str, target_uri: &str) -> EngineResult<String>;
    async fn accept(&self, call_id: &str) -> EngineResult<()>;
    /// Hangs up an established call, cancels an outgoing one, or (with `reject`)
    /// declines an incoming call with the given SIP status.
    async fn hangup(&self, call_id: &str, reject: Option<u16>) -> EngineResult<()>;
    async fn hold(&self, call_id: &str) -> EngineResult<()>;
    async fn resume(&self, call_id: &str) -> EngineResult<()>;
    async fn set_mute(&self, call_id: &str, muted: bool) -> EngineResult<()>;
    async fn send_dtmf(&self, call_id: &str, digits: &str) -> EngineResult<()>;
    async fn transfer(&self, call_id: &str, target_uri: &str) -> EngineResult<()>;

    /// Selects audio devices for subsequent calls (`None` = system default).
    async fn set_audio_devices(
        &self,
        input: Option<&str>,
        output: Option<&str>,
    ) -> EngineResult<()>;

    /// Silences the incoming-call ringtone (call stays ringing).
    async fn silence_ringtone(&self) -> EngineResult<()>;

    /// Sets the volume of what we send (`input`: the microphone) and of what we hear (`output`: the other
    /// party), as factors where 1.0 leaves the audio unchanged. Applies to calls in progress and to the
    /// next ones; an engine restart resets it, so the caller re-applies it.
    async fn set_gains(&self, input: f32, output: f32) -> EngineResult<()>;

    /// Starts recording the call in progress to two mono WAV files, `<base>-tx.wav` (our microphone) and
    /// `<base>-rx.wav` (the other party), written as the call goes.
    async fn start_recording(&self, base: &std::path::Path) -> EngineResult<()>;
    /// Finishes the files started by [`start_recording`](Self::start_recording): complete when this returns.
    async fn stop_recording(&self) -> EngineResult<()>;

    /// What the engine measures about the audio of a call right now: network, jitter buffer, regularity of the
    /// audio blocks. `None` when the call has no audio stream (yet). The maxima it reports cover the time since
    /// the previous call to this method, so a single caller should poll it.
    async fn call_stats(&self, call_id: &str) -> EngineResult<Option<RawCallStats>>;

    /// Stores options used at the next (re)start.
    fn set_options(&self, options: EngineOptions);
    /// Recent engine output, secrets redacted (diagnostics).
    fn log_tail(&self, lines: usize) -> Vec<String>;
}
