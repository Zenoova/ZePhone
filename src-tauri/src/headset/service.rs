//! Runs the headset events: reads the real state of the calls, interprets the event, hands the action to the
//! controller, and keeps what the diagnostics show (devices, capabilities, the last events and what became of
//! them).

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::Instant,
};

use serde::Serialize;

use super::{
    Context, HeadsetSettings, HidInput, Ignored, Interpreted, Interpreter, Usage, names_match,
};
use crate::{
    control::{
        command::Status,
        controller::{Controller, Telephony},
    },
    sip::types::CallState,
};

/// A headset the system lists, with what it can do.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDevice {
    pub id: String,
    pub product: String,
    pub manufacturer: String,
    pub transport: String,
    /// The telephony buttons the device declares.
    pub buttons: Vec<Usage>,
}

/// Where the reading of the hardware stands.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Reading {
    /// Not started (buttons off, or not yet).
    Idle,
    /// Listening to the system's HID reports.
    Listening,
    /// The system refuses access to HID devices until the user allows it (macOS "Input Monitoring").
    PermissionNeeded,
    /// Reading is not available on this system.
    Unavailable { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: String,
    pub device: String,
    pub button: &'static str,
    pub value: i32,
    /// What became of it, in words.
    pub result: String,
    /// It ran an action.
    pub acted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    #[serde(flatten)]
    pub device: HidDevice,
    /// This is the headset whose audio ZePhone uses.
    pub in_use: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadsetState {
    pub settings: HeadsetSettings,
    pub reading: Reading,
    pub devices: Vec<DeviceView>,
    pub log: Vec<LogEntry>,
    /// The mechanisms this build has: the standard HID telephony reports; no manufacturer integration.
    pub vendor_available: bool,
}

const LOG_LEN: usize = 25;

pub struct HeadsetService {
    settings: Mutex<HeadsetSettings>,
    interpreter: Mutex<Interpreter>,
    phone: Arc<dyn Telephony>,
    controller: Arc<Controller>,
    /// Names of the audio devices ZePhone uses (microphone and conversation output).
    audio_in_use: Arc<dyn Fn() -> Vec<String> + Send + Sync>,
    devices: Mutex<HashMap<String, HidDevice>>,
    reading: Mutex<Reading>,
    log: Mutex<VecDeque<LogEntry>>,
    publish: Arc<dyn Fn(&HeadsetState) + Send + Sync>,
}

impl HeadsetService {
    pub fn new(
        settings: HeadsetSettings,
        phone: Arc<dyn Telephony>,
        controller: Arc<Controller>,
        audio_in_use: Arc<dyn Fn() -> Vec<String> + Send + Sync>,
        publish: Arc<dyn Fn(&HeadsetState) + Send + Sync>,
    ) -> Arc<Self> {
        Arc::new(Self {
            settings: Mutex::new(settings),
            interpreter: Mutex::default(),
            phone,
            controller,
            audio_in_use,
            devices: Mutex::default(),
            reading: Mutex::new(Reading::Idle),
            log: Mutex::default(),
            publish,
        })
    }

    pub fn settings(&self) -> HeadsetSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn set_settings(&self, s: HeadsetSettings) {
        *self.settings.lock().unwrap() = s;
        self.publish_state();
    }

    pub fn set_reading(&self, r: Reading) {
        *self.reading.lock().unwrap() = r;
        self.publish_state();
    }

    pub fn attached(&self, d: HidDevice) {
        self.devices.lock().unwrap().insert(d.id.clone(), d);
        self.publish_state();
    }

    /// The reading stopped: nothing it listed is known any more.
    pub fn clear_devices(&self) {
        self.devices.lock().unwrap().clear();
        *self.interpreter.lock().unwrap() = Interpreter::new();
    }

    pub fn detached(&self, id: &str) {
        self.devices.lock().unwrap().remove(id);
        self.interpreter.lock().unwrap().forget(id);
        self.publish_state();
    }

    fn context(&self, product: &str) -> Context {
        let calls = self.phone.calls();
        let any = |f: fn(CallState) -> bool| calls.iter().any(|c| f(c.state));
        let in_use = (self.audio_in_use)();
        Context {
            incoming: any(|s| s == CallState::Incoming),
            live: any(|s| {
                matches!(
                    s,
                    CallState::Initializing
                        | CallState::Dialing
                        | CallState::Ringing
                        | CallState::Connected
                        | CallState::OnHold
                )
            }),
            established: any(|s| matches!(s, CallState::Connected | CallState::OnHold)),
            device_selected: in_use.iter().any(|n| names_match(product, n)),
        }
    }

    /// One report from the hardware: interpret it, run what it means, remember what happened.
    pub async fn on_input(&self, ev: HidInput) {
        let settings = self.settings();
        let ctx = self.context(&ev.product);
        let interpreted = self
            .interpreter
            .lock()
            .unwrap()
            .handle(&ev, &settings, &ctx);
        let (result, acted) = match interpreted {
            Interpreted::Ignore(why) => (why.explain().to_owned(), false),
            Interpreted::Do(cmd) => {
                // The same executor as the shortcuts and the command line: it checks the situation again, picks
                // the call by the documented rule, and refuses what is ambiguous.
                let outcome = self.controller.execute(cmd).await;
                (
                    format!("{} ({})", outcome.message, status_word(outcome.status)),
                    outcome.status == Status::Ok,
                )
            }
        };
        // A press of a momentary button only announces itself: it is not worth a line of its own.
        if result != Ignored::Pressed.explain() {
            let mut log = self.log.lock().unwrap();
            if log.len() == LOG_LEN {
                log.pop_front();
            }
            log.push_back(LogEntry {
                at: chrono::Utc::now().to_rfc3339(),
                device: ev.product.clone(),
                button: ev.usage.label(),
                value: ev.value,
                result,
                acted,
            });
        }
        self.publish_state();
    }

    pub fn state(&self) -> HeadsetState {
        let in_use = (self.audio_in_use)();
        let mut devices: Vec<DeviceView> = self
            .devices
            .lock()
            .unwrap()
            .values()
            .cloned()
            .map(|d| DeviceView {
                in_use: in_use.iter().any(|n| names_match(&d.product, n)),
                device: d,
            })
            .collect();
        devices.sort_by(|a, b| a.device.product.cmp(&b.device.product));
        HeadsetState {
            settings: self.settings(),
            reading: self.reading.lock().unwrap().clone(),
            devices,
            log: self.log.lock().unwrap().iter().cloned().collect(),
            vendor_available: false,
        }
    }

    fn publish_state(&self) {
        (self.publish)(&self.state());
    }
}

fn status_word(s: Status) -> &'static str {
    match s {
        Status::Ok => "fait",
        Status::Unavailable => "rien à faire",
        Status::NotFound => "appel introuvable",
        Status::Ambiguous => "plusieurs appels : non appliqué",
        Status::Disconnected => "moteur non disponible",
        Status::Invalid => "invalide",
        Status::Failed => "échec",
    }
}

/// The time of an event, for sources that have none of their own.
pub fn now() -> Instant {
    Instant::now()
}

#[cfg(test)]
mod tests;
