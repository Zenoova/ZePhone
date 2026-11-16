//! Starts and stops the reading of the headset hardware according to the settings, and feeds what it reports to
//! the service, in order.

use std::sync::{Arc, Mutex};

use super::{HeadsetSettings, service::HeadsetService};
#[cfg(target_os = "macos")]
use super::{
    hid_macos::{HidMessage, HidMonitor},
    service::Reading,
};

pub struct HeadsetRuntime {
    pub service: Arc<HeadsetService>,
    #[cfg(target_os = "macos")]
    monitor: Mutex<Option<HidMonitor>>,
    #[cfg(not(target_os = "macos"))]
    _monitor: Mutex<()>,
}

impl HeadsetRuntime {
    pub fn new(service: Arc<HeadsetService>) -> Arc<Self> {
        Arc::new(Self {
            service,
            #[cfg(target_os = "macos")]
            monitor: Mutex::new(None),
            #[cfg(not(target_os = "macos"))]
            _monitor: Mutex::new(()),
        })
    }

    /// The settings changed (or the application started): listen, or stop listening.
    pub fn apply(&self, settings: HeadsetSettings) {
        let listens = settings.listens();
        self.service.set_settings(settings);
        self.set_listening(listens);
    }

    #[cfg(target_os = "macos")]
    fn set_listening(&self, listens: bool) {
        let mut monitor = self.monitor.lock().unwrap();
        match (listens, monitor.is_some()) {
            (true, false) => {
                // The HID thread sends into a channel; one task reads it, so events keep their order.
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<HidMessage>();
                let service = self.service.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(m) = rx.recv().await {
                        match m {
                            HidMessage::Reading(r) => service.set_reading(r),
                            HidMessage::Attached(d) => service.attached(d),
                            HidMessage::Detached(id) => service.detached(&id),
                            HidMessage::Input(i) => service.on_input(i).await,
                        }
                    }
                });
                *monitor = Some(HidMonitor::start(Arc::new(move |m| {
                    let _ = tx.send(m);
                })));
            }
            (false, true) => {
                *monitor = None; // stops the thread
                self.service.clear_devices();
                self.service.set_reading(Reading::Idle);
            }
            _ => {}
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn set_listening(&self, _: bool) {
        self.service
            .set_reading(super::service::Reading::Unavailable {
                message: "Reading the headset buttons is not available on this system yet".into(),
            });
    }
}
