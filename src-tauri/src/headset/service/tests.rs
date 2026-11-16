//! Headset events through the real controller, against a scripted telephony core.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use async_trait::async_trait;

use super::*;
use crate::{
    control::{
        command::{AccountBrief, AppStatus},
        controller::{Focus, Shell},
        select::fixtures::call,
    },
    error::AppResult,
    sip::types::Call,
};

struct Phone {
    calls: Mutex<Vec<Call>>,
    log: Mutex<Vec<String>>,
    running: AtomicBool,
}
#[async_trait]
impl Telephony for Phone {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn engine_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
    fn status(&self) -> AppResult<AppStatus> {
        Ok(AppStatus {
            engine_running: true,
            do_not_disturb: false,
            accounts: Vec::<AccountBrief>::new(),
            calls: self.calls(),
        })
    }
    async fn dial(&self, _: &str, _: Option<&str>) -> AppResult<Call> {
        unreachable!("a headset never dials")
    }
    async fn answer(&self, id: &str) -> AppResult<()> {
        self.log.lock().unwrap().push(format!("answer {id}"));
        Ok(())
    }
    async fn reject(&self, id: &str) -> AppResult<()> {
        self.log.lock().unwrap().push(format!("reject {id}"));
        Ok(())
    }
    async fn hangup(&self, id: &str) -> AppResult<()> {
        self.log.lock().unwrap().push(format!("hangup {id}"));
        Ok(())
    }
    async fn hold(&self, id: &str) -> AppResult<()> {
        self.log.lock().unwrap().push(format!("hold {id}"));
        Ok(())
    }
    async fn resume(&self, id: &str) -> AppResult<()> {
        self.log.lock().unwrap().push(format!("resume {id}"));
        Ok(())
    }
    async fn set_mute(&self, id: &str, muted: bool) -> AppResult<()> {
        self.log.lock().unwrap().push(format!("mute {id} {muted}"));
        if let Some(c) = self.calls.lock().unwrap().iter_mut().find(|c| c.id == id) {
            c.muted = muted;
        }
        Ok(())
    }
    fn do_not_disturb(&self) -> AppResult<bool> {
        Ok(false)
    }
    async fn set_do_not_disturb(&self, _: bool) -> AppResult<()> {
        Ok(())
    }
}
struct NoShell;
impl Shell for NoShell {
    fn show(&self, _: Option<Focus>) {}
}

fn rig(calls: Vec<Call>, in_use: &[&str]) -> (Arc<HeadsetService>, Arc<Phone>) {
    let phone = Arc::new(Phone {
        calls: Mutex::new(calls),
        log: Mutex::default(),
        running: AtomicBool::new(true),
    });
    let controller = Controller::new(phone.clone(), Arc::new(NoShell));
    let names: Vec<String> = in_use.iter().map(|s| s.to_string()).collect();
    let svc = HeadsetService::new(
        HeadsetSettings::default(),
        phone.clone(),
        controller,
        Arc::new(move || names.clone()),
        Arc::new(|_| {}),
    );
    (svc, phone)
}

fn press(usage: Usage, value: i32, at: Instant) -> HidInput {
    HidInput {
        device: "0b0e:0412:1".into(),
        product: "Jabra Evolve2 65".into(),
        usage,
        value,
        at,
    }
}

#[tokio::test]
async fn the_call_button_answers_the_call_that_rings() {
    let (svc, phone) = rig(vec![call("in", CallState::Incoming)], &["Jabra Evolve2 65"]);
    svc.on_input(press(Usage::HookSwitch, 1, Instant::now()))
        .await;
    assert_eq!(*phone.log.lock().unwrap(), ["answer in"]);
    let state = svc.state();
    assert!(
        state.log[0].acted && state.log[0].result.contains("fait"),
        "{:?}",
        state.log
    );
}

#[tokio::test]
async fn two_ringing_calls_are_not_guessed_by_a_headset() {
    let (svc, phone) = rig(
        vec![
            call("a", CallState::Incoming),
            call("b", CallState::Incoming),
        ],
        &["Jabra Evolve2 65"],
    );
    svc.on_input(press(Usage::HookSwitch, 1, Instant::now()))
        .await;
    assert!(phone.log.lock().unwrap().is_empty(), "nothing answered");
    let entry = svc.state().log.pop().unwrap();
    assert!(
        !entry.acted && entry.result.contains("several calls"),
        "{entry:?}"
    );
}

#[tokio::test]
async fn a_headset_put_on_its_stand_never_declines_or_hangs_up_a_ringing_call() {
    let (svc, phone) = rig(vec![call("in", CallState::Incoming)], &["Jabra Evolve2 65"]);
    let t = Instant::now();
    // It reports off hook once (picked from the stand with nothing to answer… then a call arrives), then on hook.
    svc.on_input(press(Usage::HookSwitch, 1, t)).await; // answers (a ringing call exists)
    phone.log.lock().unwrap().clear();
    *phone.calls.lock().unwrap() = vec![call("next", CallState::Incoming)];
    svc.on_input(press(Usage::HookSwitch, 0, t + Duration::from_secs(5)))
        .await;
    assert!(
        phone.log.lock().unwrap().is_empty(),
        "no reject, no hangup: {:?}",
        phone.log.lock().unwrap()
    );
}

#[tokio::test]
async fn mute_and_hangup_act_on_the_active_call_with_several_calls() {
    let (svc, phone) = rig(
        vec![
            call("held", CallState::OnHold),
            call("live", CallState::Connected),
        ],
        &["Jabra Evolve2 65"],
    );
    let t = Instant::now();
    svc.on_input(press(Usage::PhoneMute, 1, t)).await;
    svc.on_input(press(Usage::PhoneMute, 0, t + Duration::from_millis(100)))
        .await;
    svc.on_input(press(Usage::Drop, 1, t + Duration::from_secs(2)))
        .await;
    svc.on_input(press(Usage::Drop, 0, t + Duration::from_millis(2100)))
        .await;
    assert_eq!(
        *phone.log.lock().unwrap(),
        ["mute live true", "hangup live"]
    );
}

#[tokio::test]
async fn a_headset_zephone_does_not_use_is_ignored_and_says_so() {
    // The audio in use is the laptop's: this headset (maybe Teams' one) is not ours.
    let (svc, phone) = rig(
        vec![call("in", CallState::Incoming)],
        &["MacBook Pro Microphone"],
    );
    svc.on_input(press(Usage::HookSwitch, 1, Instant::now()))
        .await;
    assert!(phone.log.lock().unwrap().is_empty());
    assert!(
        svc.state().log[0]
            .result
            .contains("not the headset used by ZePhone")
    );
}

#[tokio::test]
async fn with_no_call_of_ours_no_button_does_anything_whatever_another_application_is_doing() {
    let (svc, phone) = rig(vec![], &["Jabra Evolve2 65"]);
    let t = Instant::now();
    for (u, v, ms) in [
        (Usage::HookSwitch, 1, 0),
        (Usage::HookSwitch, 0, 1000),
        (Usage::PhoneMute, 1, 2000),
        (Usage::PhoneMute, 0, 2100),
        (Usage::Drop, 1, 3000),
        (Usage::Drop, 0, 3100),
        (Usage::Hold, 1, 4000),
    ] {
        svc.on_input(press(u, v, t + Duration::from_millis(ms)))
            .await;
    }
    assert!(phone.log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_log_keeps_the_last_events_and_their_fate_without_the_bare_presses() {
    let (svc, _) = rig(vec![call("c", CallState::Connected)], &["Jabra Evolve2 65"]);
    let t = Instant::now();
    svc.on_input(press(Usage::PhoneMute, 1, t)).await;
    assert!(
        svc.state().log.is_empty(),
        "a press only announces the release"
    );
    svc.on_input(press(Usage::PhoneMute, 0, t + Duration::from_millis(80)))
        .await;
    assert_eq!(svc.state().log.len(), 1);
    for i in 0..40 {
        svc.on_input(press(Usage::Flash, 1, t + Duration::from_secs(10 + i)))
            .await;
        svc.on_input(press(
            Usage::Flash,
            0,
            t + Duration::from_secs(10 + i) + Duration::from_millis(50),
        ))
        .await;
    }
    assert_eq!(svc.state().log.len(), LOG_LEN, "bounded");
}

#[tokio::test]
async fn devices_come_and_go_and_say_whether_they_are_the_one_in_use() {
    let (svc, _) = rig(vec![], &["Jabra Evolve2 65"]);
    svc.attached(HidDevice {
        id: "j".into(),
        product: "Jabra Evolve2 65".into(),
        manufacturer: "GN Audio".into(),
        transport: "USB".into(),
        buttons: vec![Usage::HookSwitch, Usage::PhoneMute],
    });
    svc.attached(HidDevice {
        id: "o".into(),
        product: "Other Headset".into(),
        manufacturer: "?".into(),
        transport: "Bluetooth".into(),
        buttons: vec![],
    });
    let st = svc.state();
    assert_eq!(st.devices.len(), 2);
    assert!(
        st.devices
            .iter()
            .find(|d| d.device.id == "j")
            .unwrap()
            .in_use
    );
    assert!(
        !st.devices
            .iter()
            .find(|d| d.device.id == "o")
            .unwrap()
            .in_use
    );
    svc.detached("j");
    assert_eq!(svc.state().devices.len(), 1);
    assert!(!svc.state().vendor_available);
}
