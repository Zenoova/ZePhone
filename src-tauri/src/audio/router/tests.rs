//! The router against scripted systems: plugging, unplugging, blips, refusals — no hardware.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use super::*;
use crate::audio::{
    devices::{Transport, tests::dev},
    routing::{LostPolicy, RoleChoice},
};

fn headset(uid: &str) -> DeviceInfo {
    dev(uid, "Jabra Evolve2 65", Transport::Usb, 1, 2)
}
fn speakers() -> DeviceInfo {
    dev("spk", "MacBook Pro Speakers", Transport::BuiltIn, 0, 2)
}
fn mic() -> DeviceInfo {
    dev("mic", "MacBook Pro Microphone", Transport::BuiltIn, 1, 0)
}
fn snap(devices: Vec<DeviceInfo>, input: &str, output: &str) -> Snapshot {
    Snapshot {
        devices,
        default_input: Some(input.into()),
        default_output: Some(output.into()),
        alert_output: Some("spk".into()),
    }
}
fn explicit(d: &DeviceInfo) -> RoleChoice {
    RoleChoice {
        selection: Selection::Explicit {
            device: DeviceRef::of(d),
        },
        fallback: None,
    }
}
fn applies(actions: &[Action]) -> Vec<(Role, String, bool)> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Apply {
                role,
                device,
                mid_call,
                ..
            } => Some((*role, device.uid.clone(), *mid_call)),
            _ => None,
        })
        .collect()
}
fn confirm_all(core: &mut RouterCore, actions: &[Action]) {
    for a in actions {
        if let Action::Apply { role, device, .. } = a {
            core.confirmed(*role, device.clone());
        }
    }
}
const S: Duration = Duration::from_secs(1);

// ----------------------------------------------------------------- idle

#[test]
fn at_the_start_every_role_is_applied_once_then_left_alone() {
    let mut core = RouterCore::new(Routing::default(), false);
    let s = snap(vec![speakers(), mic()], "mic", "spk");
    let t = Instant::now();
    let a = core.evaluate(&s, t, false);
    assert_eq!(a.len(), 3);
    confirm_all(&mut core, &a);
    assert!(
        core.evaluate(&s, t + S, false).is_empty(),
        "nothing changed: nothing to do"
    );
}

#[test]
fn plugging_a_headset_that_becomes_the_default_moves_the_idle_roles_to_it() {
    let mut core = RouterCore::new(Routing::default(), false);
    let t = Instant::now();
    let a = core.evaluate(&snap(vec![speakers(), mic()], "mic", "spk"), t, false);
    confirm_all(&mut core, &a);
    let with = snap(vec![speakers(), mic(), headset("h1")], "h1", "h1");
    let a = core.evaluate(&with, t + S, false);
    assert_eq!(
        applies(&a),
        [
            (Role::Microphone, "h1".to_string(), false),
            (Role::Speaker, "h1".to_string(), false),
            (Role::Ringer, "h1".to_string(), false)
        ],
        "all three follow the system default"
    );
}

#[test]
fn an_explicit_headset_is_used_again_as_soon_as_it_returns_and_never_forgotten_meanwhile() {
    let h = headset("h1");
    let mut routing = Routing::default();
    routing.speaker = explicit(&h);
    let mut core = RouterCore::new(routing.clone(), false);
    let t = Instant::now();
    let a = core.evaluate(&snap(vec![speakers(), mic()], "mic", "spk"), t, false);
    assert!(
        applies(&a).contains(&(Role::Speaker, "spk".into(), false)),
        "meanwhile, the system default"
    );
    confirm_all(&mut core, &a);
    let a = core.evaluate(
        &snap(vec![speakers(), mic(), h.clone()], "mic", "spk"),
        t + S,
        false,
    );
    assert_eq!(applies(&a), [(Role::Speaker, "h1".to_string(), false)]);
    assert_eq!(
        core.routing(),
        &routing,
        "the preference itself was never touched"
    );
}

// -------------------------------------------------------------- in a call

fn in_call_on_headset(routing: Routing) -> (RouterCore, Instant) {
    let mut core = RouterCore::new(routing, false);
    let t = Instant::now();
    let a = core.evaluate(
        &snap(vec![speakers(), mic(), headset("h1")], "h1", "h1"),
        t,
        false,
    );
    confirm_all(&mut core, &a);
    (core, t)
}
fn without_headset() -> Snapshot {
    snap(vec![speakers(), mic()], "mic", "spk")
}

#[test]
fn a_headset_blip_during_a_call_changes_nothing() {
    let (mut core, t) = in_call_on_headset(Routing::default());
    assert!(
        core.evaluate(&without_headset(), t + S, true).is_empty(),
        "within the grace period"
    );
    let back = snap(vec![speakers(), mic(), headset("h1")], "h1", "h1");
    assert!(core.evaluate(&back, t + 2 * S, true).is_empty());
    assert!(
        core.next_deadline().is_none(),
        "no pending decision is left"
    );
    assert!(core.standing(Role::Speaker).is_none());
}

#[test]
fn a_headset_that_stays_away_is_reported_once_and_the_call_is_not_moved_to_the_loudspeakers() {
    let h = headset("h1");
    let mut routing = Routing::default();
    routing.speaker = explicit(&h);
    routing.microphone = explicit(&h);
    let (mut core, t) = in_call_on_headset(routing);
    assert!(core.evaluate(&without_headset(), t + S, true).is_empty());
    assert!(
        core.next_deadline().is_some(),
        "something is waiting to be decided"
    );
    let a = core.evaluate(&without_headset(), t + 4 * S, true);
    assert!(applies(&a).is_empty(), "nothing is applied by itself");
    let notices: Vec<_> = a
        .iter()
        .filter_map(|a| {
            if let Action::Notice(n) = a {
                Some(n)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(
        notices.len(),
        2,
        "the speaker and the microphone are both reported"
    );
    assert!(
        notices.iter().all(
            |n| matches!(&n.kind, NoticeKind::Lost { name, .. } if name == "Jabra Evolve2 65")
        )
    );
    // Asked again later: no new notice for the same situation.
    assert!(
        core.evaluate(&without_headset(), t + 6 * S, true)
            .is_empty()
    );
    assert!(core.standing(Role::Speaker).is_some());
    // The device is in use as far as the engine knows: it was not touched.
    assert_eq!(core.applied(Role::Speaker).unwrap().uid, "h1");
}

#[test]
fn the_notice_goes_when_the_headset_comes_back_or_the_call_ends() {
    let h = headset("h1");
    let mut routing = Routing::default();
    routing.speaker = explicit(&h);
    let (mut core, t) = in_call_on_headset(routing);
    core.evaluate(&without_headset(), t + S, true);
    core.evaluate(&without_headset(), t + 4 * S, true);
    assert!(core.standing(Role::Speaker).is_some());
    let back = snap(vec![speakers(), mic(), headset("h1")], "h1", "h1");
    let a = core.evaluate(&back, t + 5 * S, true);
    assert!(a.contains(&Action::Clear(Role::Speaker)));
    assert!(core.standing(Role::Speaker).is_none());

    // And when the call ends with the headset still away.
    core.evaluate(&without_headset(), t + 6 * S, true);
    core.evaluate(&without_headset(), t + 9 * S, true);
    assert!(core.standing(Role::Speaker).is_some());
    let a = core.evaluate(&without_headset(), t + 10 * S, false);
    assert!(a.contains(&Action::Clear(Role::Speaker)));
}

#[test]
fn a_configured_fallback_takes_the_call_over_after_the_grace_period() {
    let h = headset("h1");
    let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
    let mut routing = Routing::default();
    routing.speaker = explicit(&h);
    routing.speaker.fallback = Some(DeviceRef::of(&usb));
    let (mut core, t) = in_call_on_headset(routing);
    let gone = snap(vec![speakers(), mic(), usb.clone()], "mic", "spk");
    assert!(core.evaluate(&gone, t + S, true).is_empty());
    let a = core.evaluate(&gone, t + 4 * S, true);
    // The microphone follows the system (which went back to the built-in one); the speaker takes the fallback.
    assert!(
        applies(&a).contains(&(Role::Speaker, "u2".to_string(), true)),
        "{a:?}"
    );
    let a: Vec<Action> = a
        .into_iter()
        .filter(|x| {
            matches!(
                x,
                Action::Apply {
                    role: Role::Speaker,
                    ..
                }
            )
        })
        .collect();
    // Applied and confirmed: said once, and not repeated.
    let Action::Apply { device, why, .. } = a[0].clone() else {
        panic!()
    };
    let from = core.applied(Role::Speaker).unwrap().clone();
    let n = core.switched(Role::Speaker, &from, device, why.unwrap());
    assert!(matches!(n.kind, NoticeKind::Switched { ref to, .. } if to == "Desk Speaker"));
    core.confirmed(Role::Microphone, mic());
    assert!(core.evaluate(&gone, t + 6 * S, true).is_empty());
}

#[test]
fn a_switch_the_engine_refuses_is_not_retried_in_a_loop() {
    let mut core = RouterCore::new(Routing::default(), false);
    let t = Instant::now();
    let s = snap(vec![speakers(), mic(), headset("h1")], "h1", "h1");
    let a = core.evaluate(&s, t, false);
    let Action::Apply { device, role, .. } = a
        .iter()
        .find(|a| {
            matches!(
                a,
                Action::Apply {
                    role: Role::Speaker,
                    ..
                }
            )
        })
        .unwrap()
        .clone()
    else {
        panic!()
    };
    let n = core.failed(role, &device, "no such device".into());
    assert!(matches!(n.kind, NoticeKind::Failed { .. }));
    let again = core.evaluate(&s, t + S, false);
    assert!(
        !applies(&again).iter().any(|(r, ..)| *r == Role::Speaker),
        "no retry of the same refused device"
    );
    // The user changes the preference: a fresh try.
    let mut r = core.routing().clone();
    r.lost_policy = LostPolicy::Ask;
    core.set_routing(r);
    let again = core.evaluate(&s, t + 2 * S, false);
    assert!(applies(&again).iter().any(|(r, ..)| *r == Role::Speaker));
}

#[test]
fn what_the_user_picked_for_this_call_is_kept_until_the_call_ends() {
    let (mut core, t) = in_call_on_headset(Routing::default());
    let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
    let s = snap(
        vec![speakers(), mic(), headset("h1"), usb.clone()],
        "h1",
        "h1",
    );
    core.confirmed(Role::Speaker, usb.clone());
    core.pin(Role::Speaker, "u2".into());
    // The role follows the system (h1), but the user picked u2 for this call: it stays.
    assert!(
        !applies(&core.evaluate(&s, t + S, true))
            .iter()
            .any(|(r, ..)| *r == Role::Speaker)
    );
    // After the call, the role goes back to following the system.
    core.evaluate(&s, t + 2 * S, false);
    let a = core.evaluate(&s, t + 3 * S, false);
    assert!(
        applies(&a).contains(&(Role::Speaker, "h1".to_string(), false)),
        "{a:?}"
    );
}

#[test]
fn the_ringer_device_is_never_changed_during_a_call_but_right_after_it() {
    use crate::audio::routing::Follow;
    let mut routing = Routing::default();
    routing.ringer.selection = Selection::Follow {
        source: Follow::SystemAlerts,
    };
    let mut core = RouterCore::new(routing, false);
    let t = Instant::now();
    let a = core.evaluate(&snap(vec![speakers(), mic()], "mic", "spk"), t, false);
    confirm_all(&mut core, &a);
    let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
    let moved = Snapshot {
        alert_output: Some("u2".into()),
        ..snap(vec![speakers(), mic(), usb], "mic", "spk")
    };
    // The ringtone device needs an engine restart: nothing is done during a call…
    assert!(core.evaluate(&moved, t + S, true).is_empty());
    // …and it is done once the call is over.
    let a = core.evaluate(&moved, t + 2 * S, false);
    assert_eq!(applies(&a), [(Role::Ringer, "u2".to_string(), false)]);
}

// ------------------------------------------------------------- the service

#[derive(Default)]
struct FakeSystem {
    snap: Mutex<Snapshot>,
    notify: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}
impl FakeSystem {
    fn set(&self, s: Snapshot) {
        *self.snap.lock().unwrap() = s;
    }
    fn ping(&self) {
        let n = self.notify.lock().unwrap().clone();
        if let Some(n) = n {
            n();
        }
    }
}
struct Guard;
impl Watch for Guard {}
impl AudioSystem for FakeSystem {
    fn snapshot(&self) -> Snapshot {
        self.snap.lock().unwrap().clone()
    }
    fn watch(&self, notify: Arc<dyn Fn() + Send + Sync>) -> Option<Box<dyn Watch>> {
        *self.notify.lock().unwrap() = Some(notify);
        Some(Box::new(Guard))
    }
}

#[derive(Default)]
struct FakeTarget {
    in_call: AtomicBool,
    refuse: Mutex<Option<String>>,
    log: Mutex<Vec<String>>,
    reasserted: AtomicUsize,
    published: AtomicUsize,
}
#[async_trait]
impl Target for FakeTarget {
    fn call_active(&self) -> bool {
        self.in_call.load(Ordering::SeqCst)
    }
    async fn apply(&self, role: Role, device: &DeviceInfo, mid_call: bool) -> Result<(), String> {
        if let Some(m) = self.refuse.lock().unwrap().clone() {
            return Err(m);
        }
        self.log.lock().unwrap().push(format!(
            "{role:?} {} {}",
            device.uid,
            if mid_call { "mid-call" } else { "idle" }
        ));
        Ok(())
    }
    async fn reassert_call_state(&self) {
        self.reasserted.fetch_add(1, Ordering::SeqCst);
    }
    fn publish(&self, _: &AudioState) {
        self.published.fetch_add(1, Ordering::SeqCst);
    }
    fn learned_uid(&self, _: Role, _: String) {}
}

fn service(routing: Routing, s: Snapshot) -> (Arc<AudioRouter>, Arc<FakeSystem>, Arc<FakeTarget>) {
    let sys = Arc::new(FakeSystem::default());
    sys.set(s);
    let target = Arc::new(FakeTarget::default());
    (
        AudioRouter::new(sys.clone(), target.clone(), routing),
        sys,
        target,
    )
}

#[tokio::test]
async fn the_state_shows_what_the_engine_confirmed_not_what_was_asked() {
    let (r, _, target) = service(
        Routing::default(),
        snap(vec![speakers(), mic(), headset("h1")], "h1", "h1"),
    );
    r.refresh().await;
    let st = r.state();
    let spk = st.roles.iter().find(|x| x.role == Role::Speaker).unwrap();
    assert_eq!(spk.in_use.as_ref().unwrap().uid, "h1");
    assert_eq!(target.log.lock().unwrap().len(), 3);

    // The engine refuses a new device: the old one remains the one in use, and the refusal is shown.
    *target.refuse.lock().unwrap() = Some("périphérique inconnu".into());
    let (r2, _, t2) = service(
        Routing::default(),
        snap(vec![speakers(), mic()], "mic", "spk"),
    );
    r2.refresh().await;
    *t2.refuse.lock().unwrap() = Some("périphérique inconnu".into());
    let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
    let (r3, sys3, t3) = service(
        Routing::default(),
        snap(vec![speakers(), mic()], "mic", "spk"),
    );
    r3.refresh().await;
    sys3.set(snap(vec![speakers(), mic(), usb], "mic", "u2"));
    *t3.refuse.lock().unwrap() = Some("périphérique inconnu".into());
    r3.refresh().await;
    let st = r3.state();
    let spk = st.roles.iter().find(|x| x.role == Role::Speaker).unwrap();
    assert_eq!(
        spk.in_use.as_ref().unwrap().uid,
        "spk",
        "still on the previous device"
    );
    assert_eq!(spk.resolution.used.as_ref().unwrap().uid, "u2");
    assert_eq!(spk.refused.as_deref(), Some("périphérique inconnu"));
}

#[tokio::test]
async fn a_mid_call_switch_reasserts_the_muted_and_held_state() {
    let h = headset("h1");
    let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
    let mut routing = Routing::default();
    routing.speaker = explicit(&h);
    routing.speaker.fallback = Some(DeviceRef::of(&usb));
    let (r, sys, target) = service(
        routing,
        snap(
            vec![speakers(), mic(), h.clone(), usb.clone()],
            "mic",
            "spk",
        ),
    );
    r.refresh().await;
    target.in_call.store(true, Ordering::SeqCst);
    // The headset leaves; after the grace period the fallback takes the call.
    sys.set(snap(vec![speakers(), mic(), usb], "mic", "spk"));
    r.refresh().await;
    assert_eq!(
        target.reasserted.load(Ordering::SeqCst),
        0,
        "within the grace period"
    );
    tokio::time::sleep(GRACE + Duration::from_millis(400)).await;
    assert!(
        target
            .log
            .lock()
            .unwrap()
            .iter()
            .any(|l| l == "Speaker u2 mid-call"),
        "{:?}",
        target.log.lock().unwrap()
    );
    assert_eq!(
        target.reasserted.load(Ordering::SeqCst),
        1,
        "mute and hold were re-sent once"
    );
}

#[tokio::test]
async fn the_user_picking_a_device_mid_call_switches_and_reasserts() {
    let (r, _, target) = service(
        Routing::default(),
        snap(vec![speakers(), mic(), headset("h1")], "h1", "h1"),
    );
    r.refresh().await;
    target.in_call.store(true, Ordering::SeqCst);
    r.choose(Role::Speaker, "spk").await.unwrap();
    assert!(
        target
            .log
            .lock()
            .unwrap()
            .iter()
            .any(|l| l == "Speaker spk mid-call")
    );
    assert_eq!(target.reasserted.load(Ordering::SeqCst), 1);
    // The choice holds: the next look at the system does not undo it.
    r.refresh().await;
    assert_eq!(r.state().roles[1].in_use.as_ref().unwrap().uid, "spk");
    // A device that is not there, or that the engine refuses, is an explained error.
    assert!(r.choose(Role::Speaker, "ghost").await.is_err());
    *target.refuse.lock().unwrap() = Some("non".into());
    assert_eq!(r.choose(Role::Speaker, "h1").await.unwrap_err(), "non");
    assert_eq!(
        r.state().roles[1].in_use.as_ref().unwrap().uid,
        "spk",
        "unchanged after a refusal"
    );
}

#[tokio::test]
async fn a_burst_of_system_notifications_makes_one_look() {
    let (r, sys, target) = service(
        Routing::default(),
        snap(vec![speakers(), mic()], "mic", "spk"),
    );
    r.start();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let before = target.published.load(Ordering::SeqCst);
    for _ in 0..20 {
        sys.ping();
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    tokio::time::sleep(SETTLE + Duration::from_millis(400)).await;
    assert_eq!(
        target.published.load(Ordering::SeqCst) - before,
        1,
        "twenty notifications, one evaluation"
    );
    assert!(r.is_watching());
}
