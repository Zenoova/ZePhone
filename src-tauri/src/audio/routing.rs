//! Which device does each audio role use? Pure rules, no hardware.
//!
//! Three roles are chosen separately: the **microphone**, the **speaker** (what the conversation plays on) and the
//! **ringer** (the incoming-call ringtone). Each is either *following* the system's choice, or an *explicit*
//! device, optionally with a **fallback** device. What is actually used is computed from what is plugged in, never
//! assumed from the preference, and the preference is never rewritten because a device is absent.

use serde::{Deserialize, Serialize};

use super::devices::{DeviceInfo, Snapshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Microphone,
    Speaker,
    Ringer,
}

impl Role {
    pub const ALL: [Role; 3] = [Role::Microphone, Role::Speaker, Role::Ringer];

    pub fn is_input(self) -> bool {
        self == Role::Microphone
    }

    pub fn label(self) -> &'static str {
        match self {
            Role::Microphone => "Microphone",
            Role::Speaker => "Sortie des conversations",
            Role::Ringer => "Sonnerie",
        }
    }

    fn fits(self, d: &DeviceInfo) -> bool {
        d.alive
            && if self.is_input() {
                d.is_input()
            } else {
                d.is_output()
            }
    }
}

/// What a role follows when it is not an explicit device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Follow {
    /// The system's default input / output.
    SystemDefault,
    /// The output the system plays alerts on (macOS "play sound effects through").
    SystemAlerts,
    /// The system's separate "communication" device. Only where the platform has one (not macOS).
    Communication,
}

/// A device as the user chose it. `uid` is absent only for choices saved before identifiers were kept.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRef {
    #[serde(default)]
    pub uid: Option<String>,
    pub name: String,
}

impl DeviceRef {
    pub fn of(d: &DeviceInfo) -> Self {
        Self {
            uid: Some(d.uid.clone()),
            name: d.name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Selection {
    Follow { source: Follow },
    Explicit { device: DeviceRef },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RoleChoice {
    pub selection: Selection,
    /// Used, in this order of preference, when the chosen device is not there.
    pub fallback: Option<DeviceRef>,
}

impl Default for RoleChoice {
    fn default() -> Self {
        Self {
            selection: Selection::Follow {
                source: Follow::SystemDefault,
            },
            fallback: None,
        }
    }
}

/// What to do when the device a call is using disappears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LostPolicy {
    /// Keep the call, say what happened, let the user choose.
    Ask,
    /// Switch to the role's fallback device if there is one; otherwise ask.
    #[default]
    UseFallback,
    /// Switch to the system's current default; ask if there is none.
    UseSystemDefault,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Routing {
    pub microphone: RoleChoice,
    pub speaker: RoleChoice,
    pub ringer: RoleChoice,
    pub lost_policy: LostPolicy,
    /// Allow a conversation to move by itself to loudspeakers (laptop speakers, a screen) when the device it
    /// used disappears. Off: the user is asked first.
    pub allow_public_speaker: bool,
}

impl Routing {
    pub fn choice(&self, role: Role) -> &RoleChoice {
        match role {
            Role::Microphone => &self.microphone,
            Role::Speaker => &self.speaker,
            Role::Ringer => &self.ringer,
        }
    }

    pub fn choice_mut(&mut self, role: Role) -> &mut RoleChoice {
        match role {
            Role::Microphone => &mut self.microphone,
            Role::Speaker => &mut self.speaker,
            Role::Ringer => &mut self.ringer,
        }
    }
}

/// How the device in use was obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Following the system's choice, as asked.
    Following,
    /// The device the user chose.
    Chosen,
    /// The chosen device is absent: the fallback device is used.
    Fallback,
    /// The chosen device is absent and there is no fallback: the system's default is used meanwhile.
    SystemInstead,
    /// Nothing usable.
    Nothing,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Problem {
    /// The saved device is not available right now.
    ChosenUnavailable { name: String },
    /// The saved fallback device is not available either.
    FallbackUnavailable { name: String },
    /// Choice saved by name only, and several devices have that name.
    AmbiguousName { name: String },
    /// The engine cannot select a device with this name.
    NameNotSelectable { name: String },
    /// Two devices have this name: the engine may pick the other one.
    DuplicateName { name: String },
    /// "Follow the communication device" is not something this system has.
    CommunicationUnsupported,
    /// The system has no device for this role.
    NoDevice,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub role: Role,
    pub used: Option<DeviceInfo>,
    pub source: Source,
    pub problems: Vec<Problem>,
    /// A choice saved by name was matched to exactly one device: its identifier, to be saved.
    pub learned_uid: Option<String>,
}

enum Found<'a> {
    Device(&'a DeviceInfo, bool),
    Ambiguous,
    Missing,
}

/// A saved device, found again. By identifier when there is one: a device with the same name but another
/// identifier is **not** the same device (two identical headsets). By name only for an old, identifier-less
/// choice, and then only if exactly one device has that name.
fn find_ref<'a>(pool: &[&'a DeviceInfo], r: &DeviceRef) -> Found<'a> {
    match &r.uid {
        Some(uid) => pool
            .iter()
            .find(|d| &d.uid == uid)
            .map_or(Found::Missing, |d| Found::Device(d, false)),
        None => {
            let named: Vec<_> = pool.iter().filter(|d| d.name == r.name).collect();
            match named.as_slice() {
                [] => Found::Missing,
                [one] => Found::Device(one, true),
                _ => Found::Ambiguous,
            }
        }
    }
}

pub fn resolve(
    role: Role,
    choice: &RoleChoice,
    snap: &Snapshot,
    supports_communication: bool,
) -> Resolution {
    let pool: Vec<&DeviceInfo> = snap.devices.iter().filter(|d| role.fits(d)).collect();
    let mut problems = Vec::new();
    let mut learned = None;

    let system_pick = |follow: Follow, problems: &mut Vec<Problem>| -> Option<&DeviceInfo> {
        let uid = match (follow, role) {
            (Follow::Communication, _) if !supports_communication => {
                problems.push(Problem::CommunicationUnsupported);
                default_for(role, snap)
            }
            (Follow::SystemAlerts, Role::Speaker | Role::Ringer) => snap.alert_output.as_ref(),
            _ => default_for(role, snap),
        };
        uid.and_then(|u| pool.iter().find(|d| &d.uid == u).copied())
    };

    let (used, source) = match &choice.selection {
        Selection::Follow { source } => (system_pick(*source, &mut problems), Source::Following),
        Selection::Explicit { device } => match find_ref(&pool, device) {
            Found::Device(d, by_name) => {
                if by_name {
                    learned = Some(d.uid.clone());
                }
                (Some(d), Source::Chosen)
            }
            missing => {
                problems.push(match missing {
                    Found::Ambiguous => Problem::AmbiguousName {
                        name: device.name.clone(),
                    },
                    _ => Problem::ChosenUnavailable {
                        name: device.name.clone(),
                    },
                });
                let fallback = choice
                    .fallback
                    .as_ref()
                    .and_then(|f| match find_ref(&pool, f) {
                        Found::Device(d, _) => Some(d),
                        _ => {
                            problems.push(Problem::FallbackUnavailable {
                                name: f.name.clone(),
                            });
                            None
                        }
                    });
                match fallback {
                    Some(d) => (Some(d), Source::Fallback),
                    None => (
                        system_pick(Follow::SystemDefault, &mut problems),
                        Source::SystemInstead,
                    ),
                }
            }
        },
    };

    let source = if used.is_none() {
        Source::Nothing
    } else {
        source
    };
    if let Some(d) = used {
        if !d.selectable {
            problems.push(Problem::NameNotSelectable {
                name: d.name.clone(),
            });
        } else if d.duplicate_name {
            problems.push(Problem::DuplicateName {
                name: d.name.clone(),
            });
        }
    } else {
        problems.push(Problem::NoDevice);
    }
    Resolution {
        role,
        used: used.cloned(),
        source,
        problems,
        learned_uid: learned,
    }
}

fn default_for(role: Role, snap: &Snapshot) -> Option<&String> {
    if role.is_input() {
        snap.default_input.as_ref()
    } else {
        snap.default_output.as_ref()
    }
}

/// The devices a role could use, for a picker.
pub fn candidates(role: Role, snap: &Snapshot) -> Vec<DeviceInfo> {
    snap.devices
        .iter()
        .filter(|d| role.fits(d))
        .cloned()
        .collect()
}

// ------------------------------------------------------------- during a call

/// What to do about a role while a call is in progress, once the system's devices changed.
#[derive(Debug, Clone, PartialEq)]
pub enum InCall {
    /// Nothing changed for this role.
    Keep,
    /// Move the call's audio to this device.
    Switch { to: DeviceInfo, why: Why },
    /// The device is gone or the new one is not acceptable without the user: say so, keep the session, and let
    /// the user choose.
    Ask {
        lost: Option<DeviceInfo>,
        blocked: Option<DeviceInfo>,
        why: AskWhy,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Why {
    /// The system's choice changed and the role follows it.
    SystemChanged,
    /// The device disappeared: the configured fallback takes over.
    Fallback,
    /// The device disappeared: the system's default takes over (the user allowed it).
    SystemDefault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AskWhy {
    /// The device disappeared and the policy does not pick a replacement.
    DeviceLost,
    /// The replacement would be a loudspeaker the user did not allow.
    PublicSpeaker,
    /// Nothing is available.
    NothingLeft,
}

/// Decides, for one role, between keeping the device a call is on, switching it, and asking the user.
///
/// `current` is the device the call's audio is on now (as the engine confirmed it).
pub fn decide_in_call(
    role: Role,
    routing: &Routing,
    current: &DeviceInfo,
    snap: &Snapshot,
    supports_communication: bool,
) -> InCall {
    let still_there = snap.find(&current.uid).is_some_and(|d| role.fits(d));
    let wanted = resolve(role, routing.choice(role), snap, supports_communication);

    if still_there {
        // The device is fine. The role moves only if it follows the system and the system moved.
        let follows = matches!(routing.choice(role).selection, Selection::Follow { .. });
        return match wanted.used {
            Some(to) if follows && to.uid != current.uid => {
                guard(role, routing, current, to, Why::SystemChanged)
            }
            _ => InCall::Keep,
        };
    }

    // The device the call is on is gone.
    let lost = Some(current.clone());
    let follows = matches!(routing.choice(role).selection, Selection::Follow { .. });
    let replacement = match (routing.lost_policy, wanted.source) {
        // Following the system is the user's own choice to go where the system goes (guarded below).
        _ if follows => wanted.used.clone().map(|d| (d, Why::SystemChanged)),
        (LostPolicy::Ask, _) => None,
        (LostPolicy::UseFallback, Source::Fallback | Source::Chosen) => {
            wanted.used.clone().map(|d| (d, Why::Fallback))
        }
        (LostPolicy::UseFallback, _) => None,
        (LostPolicy::UseSystemDefault, _) => {
            let d = default_for(role, snap)
                .and_then(|u| snap.find(u))
                .filter(|d| role.fits(d));
            d.cloned().map(|d| (d, Why::SystemDefault))
        }
    };
    match replacement {
        Some((to, why)) if to.uid != current.uid => match guard(role, routing, current, to, why) {
            InCall::Ask { blocked, why, .. } => InCall::Ask { lost, blocked, why },
            other => other,
        },
        Some(_) | None if wanted.used.is_none() && snap.devices.iter().all(|d| !role.fits(d)) => {
            InCall::Ask {
                lost,
                blocked: None,
                why: AskWhy::NothingLeft,
            }
        }
        _ => InCall::Ask {
            lost,
            blocked: None,
            why: AskWhy::DeviceLost,
        },
    }
}

/// A conversation does not move to loudspeakers by itself unless the user allowed it.
fn guard(role: Role, routing: &Routing, from: &DeviceInfo, to: DeviceInfo, why: Why) -> InCall {
    let public = role == Role::Speaker && to.public_speaker && !from.public_speaker;
    if public && !routing.allow_public_speaker {
        InCall::Ask {
            lost: None,
            blocked: Some(to),
            why: AskWhy::PublicSpeaker,
        }
    } else {
        InCall::Switch { to, why }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::devices::{Transport, tests::dev};

    pub(crate) fn headset(uid: &str) -> DeviceInfo {
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
    fn used(r: &Resolution) -> Option<&str> {
        r.used.as_ref().map(|d| d.uid.as_str())
    }

    #[test]
    fn following_the_system_uses_its_default_and_changes_with_it() {
        let s = snap(vec![speakers(), mic(), headset("h1")], "mic", "spk");
        let r = resolve(Role::Speaker, &RoleChoice::default(), &s, false);
        assert_eq!((used(&r), r.source), (Some("spk"), Source::Following));
        let s = snap(vec![speakers(), mic(), headset("h1")], "h1", "h1");
        assert_eq!(
            used(&resolve(Role::Speaker, &RoleChoice::default(), &s, false)),
            Some("h1")
        );
        assert_eq!(
            used(&resolve(
                Role::Microphone,
                &RoleChoice::default(),
                &s,
                false
            )),
            Some("h1")
        );
    }

    #[test]
    fn the_ringer_can_follow_the_alert_output_while_the_conversation_follows_the_headset() {
        let s = snap(vec![speakers(), mic(), headset("h1")], "h1", "h1");
        let alerts = RoleChoice {
            selection: Selection::Follow {
                source: Follow::SystemAlerts,
            },
            fallback: None,
        };
        assert_eq!(
            used(&resolve(Role::Ringer, &alerts, &s, false)),
            Some("spk")
        );
        assert_eq!(
            used(&resolve(Role::Speaker, &RoleChoice::default(), &s, false)),
            Some("h1")
        );
    }

    #[test]
    fn communication_device_is_not_pretended_on_a_system_without_one() {
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        let c = RoleChoice {
            selection: Selection::Follow {
                source: Follow::Communication,
            },
            fallback: None,
        };
        let r = resolve(Role::Speaker, &c, &s, false);
        assert!(r.problems.contains(&Problem::CommunicationUnsupported));
        assert_eq!(
            used(&r),
            Some("spk"),
            "falls back to the system default, and says so"
        );
        assert!(
            !resolve(Role::Speaker, &c, &s, true)
                .problems
                .contains(&Problem::CommunicationUnsupported)
        );
    }

    #[test]
    fn an_explicit_choice_comes_back_when_the_same_device_returns() {
        let h = headset("h1");
        let choice = explicit(&h);
        let away = snap(vec![speakers(), mic()], "mic", "spk");
        let r = resolve(Role::Speaker, &choice, &away, false);
        assert_eq!(r.source, Source::SystemInstead);
        assert!(r.problems.iter().any(
            |p| matches!(p, Problem::ChosenUnavailable { name } if name == "Jabra Evolve2 65")
        ));
        let back = snap(vec![speakers(), mic(), h.clone()], "mic", "spk");
        let r = resolve(Role::Speaker, &choice, &back, false);
        assert_eq!((used(&r), r.source), (Some("h1"), Source::Chosen));
        assert!(r.problems.is_empty());
    }

    #[test]
    fn an_identical_second_headset_is_never_taken_for_the_chosen_one() {
        let choice = explicit(&headset("h1"));
        let s = snap(vec![speakers(), mic(), headset("h2")], "mic", "spk");
        let r = resolve(Role::Speaker, &choice, &s, false);
        assert_eq!(
            used(&r),
            Some("spk"),
            "h2 has the same name but is another device"
        );
        assert_eq!(r.source, Source::SystemInstead);
    }

    #[test]
    fn a_choice_saved_by_name_only_is_matched_only_when_one_device_has_that_name() {
        let old = RoleChoice {
            selection: Selection::Explicit {
                device: DeviceRef {
                    uid: None,
                    name: "Jabra Evolve2 65".into(),
                },
            },
            fallback: None,
        };
        let one = snap(vec![speakers(), mic(), headset("h1")], "mic", "spk");
        let r = resolve(Role::Speaker, &old, &one, false);
        assert_eq!(
            (used(&r), r.learned_uid.as_deref()),
            (Some("h1"), Some("h1"))
        );
        let mut two = vec![speakers(), mic(), headset("h1"), headset("h2")];
        crate::audio::devices::mark_duplicates(&mut two);
        let r = resolve(Role::Speaker, &old, &snap(two, "mic", "spk"), false);
        assert!(
            r.problems
                .iter()
                .any(|p| matches!(p, Problem::AmbiguousName { .. }))
        );
        assert_ne!(r.source, Source::Chosen);
        assert!(r.learned_uid.is_none());
    }

    #[test]
    fn the_fallback_takes_over_before_the_system_default() {
        let h = headset("h1");
        let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
        let mut choice = explicit(&h);
        choice.fallback = Some(DeviceRef::of(&usb));
        let s = snap(vec![speakers(), mic(), usb.clone()], "mic", "spk");
        let r = resolve(Role::Speaker, &choice, &s, false);
        assert_eq!((used(&r), r.source), (Some("u2"), Source::Fallback));
        // A fallback that is missing too is reported, and the system default is used meanwhile.
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        let r = resolve(Role::Speaker, &choice, &s, false);
        assert_eq!(r.source, Source::SystemInstead);
        assert!(
            r.problems
                .iter()
                .any(|p| matches!(p, Problem::FallbackUnavailable { .. }))
        );
    }

    #[test]
    fn a_device_is_only_offered_for_the_direction_it_has() {
        let s = snap(vec![speakers(), mic(), headset("h1")], "mic", "spk");
        assert!(
            candidates(Role::Microphone, &s)
                .iter()
                .all(|d| d.is_input())
        );
        assert!(candidates(Role::Speaker, &s).iter().all(|d| d.is_output()));
        // Choosing a microphone-only device for the speaker finds nothing.
        let r = resolve(Role::Speaker, &explicit(&mic()), &s, false);
        assert_eq!(r.source, Source::SystemInstead);
    }

    #[test]
    fn devices_the_engine_cannot_select_or_could_confuse_are_reported() {
        let odd = dev("x", "Weird, Name", Transport::Usb, 1, 2);
        let s = snap(vec![odd.clone(), mic(), speakers()], "x", "x");
        let r = resolve(Role::Speaker, &RoleChoice::default(), &s, false);
        assert!(
            r.problems
                .iter()
                .any(|p| matches!(p, Problem::NameNotSelectable { .. }))
        );
        let mut two = vec![headset("a"), headset("b"), mic(), speakers()];
        crate::audio::devices::mark_duplicates(&mut two);
        let r = resolve(
            Role::Speaker,
            &explicit(&two[0]),
            &snap(two.clone(), "mic", "spk"),
            false,
        );
        assert!(
            r.problems
                .iter()
                .any(|p| matches!(p, Problem::DuplicateName { .. }))
        );
    }

    #[test]
    fn no_device_at_all_is_a_problem_not_a_panic() {
        let s = Snapshot::default();
        let r = resolve(Role::Speaker, &RoleChoice::default(), &s, false);
        assert_eq!(r.source, Source::Nothing);
        assert!(r.problems.contains(&Problem::NoDevice));
    }

    // ----------------------------------------------------------- during a call

    fn routing(policy: LostPolicy) -> Routing {
        Routing {
            lost_policy: policy,
            ..Default::default()
        }
    }

    #[test]
    fn a_call_stays_where_it_is_while_its_device_is_present() {
        let h = headset("h1");
        let r = routing(LostPolicy::UseSystemDefault);
        let s = snap(vec![speakers(), mic(), h.clone()], "mic", "spk");
        // Explicit headset: the system default moving elsewhere does not concern the call.
        let mut r2 = r.clone();
        r2.speaker = explicit(&h);
        assert_eq!(
            decide_in_call(Role::Speaker, &r2, &h, &s, false),
            InCall::Keep
        );
    }

    #[test]
    fn a_role_following_the_system_follows_it_during_the_call() {
        let h = headset("h1");
        let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
        let s = snap(vec![speakers(), mic(), h.clone(), usb.clone()], "mic", "u2");
        let d = decide_in_call(Role::Speaker, &Routing::default(), &h, &s, false);
        assert!(matches!(d, InCall::Switch { ref to, why: Why::SystemChanged } if to.uid == "u2"));
    }

    #[test]
    fn when_the_headset_vanishes_the_default_policy_asks_instead_of_using_the_loudspeakers() {
        let h = headset("h1");
        let mut r = Routing::default();
        r.speaker = explicit(&h);
        // The system falls back to the laptop speakers, as macOS does when a Bluetooth headset drops.
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        let d = decide_in_call(Role::Speaker, &r, &h, &s, false);
        assert!(
            matches!(d, InCall::Ask { why: AskWhy::DeviceLost, ref lost, .. } if lost.is_some())
        );
    }

    #[test]
    fn a_configured_fallback_takes_the_call_unless_it_is_a_public_loudspeaker() {
        let h = headset("h1");
        let usb = dev("u2", "Desk Speaker", Transport::Usb, 0, 2);
        let mut r = routing(LostPolicy::UseFallback);
        r.speaker = explicit(&h);
        r.speaker.fallback = Some(DeviceRef::of(&usb));
        let s = snap(vec![speakers(), mic(), usb], "mic", "spk");
        assert!(matches!(
            decide_in_call(Role::Speaker, &r, &h, &s, false),
            InCall::Switch { ref to, why: Why::Fallback } if to.uid == "u2"
        ));
        // The fallback is the laptop's own loudspeakers: only with the user's explicit permission.
        r.speaker.fallback = Some(DeviceRef::of(&speakers()));
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        let d = decide_in_call(Role::Speaker, &r, &h, &s, false);
        assert!(
            matches!(d, InCall::Ask { why: AskWhy::PublicSpeaker, blocked: Some(ref b), .. } if b.uid == "spk"),
            "{d:?}"
        );
        r.allow_public_speaker = true;
        assert!(matches!(
            decide_in_call(Role::Speaker, &r, &h, &s, false),
            InCall::Switch { .. }
        ));
    }

    #[test]
    fn using_the_system_default_is_a_choice_the_user_made_and_still_cannot_reach_the_loudspeakers_unasked()
     {
        let h = headset("h1");
        let mut r = routing(LostPolicy::UseSystemDefault);
        r.speaker = explicit(&h);
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        let d = decide_in_call(Role::Speaker, &r, &h, &s, false);
        assert!(matches!(
            d,
            InCall::Ask {
                why: AskWhy::PublicSpeaker,
                ..
            }
        ));
        let bt = dev("bt", "AirPods", Transport::Bluetooth, 1, 2);
        let s = snap(vec![speakers(), mic(), bt], "bt", "bt");
        assert!(matches!(
            decide_in_call(Role::Speaker, &r, &h, &s, false),
            InCall::Switch { ref to, why: Why::SystemDefault } if to.uid == "bt"
        ));
    }

    #[test]
    fn a_role_following_the_system_goes_where_the_system_went_but_not_to_the_loudspeakers() {
        let h = headset("h1");
        let bt = dev("bt", "AirPods", Transport::Bluetooth, 1, 2);
        let s = snap(vec![speakers(), mic(), bt], "bt", "bt");
        assert!(matches!(
            decide_in_call(Role::Speaker, &Routing::default(), &h, &s, false),
            InCall::Switch { .. }
        ));
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        assert!(matches!(
            decide_in_call(Role::Speaker, &Routing::default(), &h, &s, false),
            InCall::Ask {
                why: AskWhy::PublicSpeaker,
                ..
            }
        ));
    }

    #[test]
    fn a_microphone_is_not_held_to_the_loudspeaker_rule() {
        let h = headset("h1");
        let r = routing(LostPolicy::UseSystemDefault);
        let s = snap(vec![speakers(), mic()], "mic", "spk");
        assert!(matches!(
            decide_in_call(Role::Microphone, &r, &h, &s, false),
            InCall::Switch { .. }
        ));
    }

    #[test]
    fn with_nothing_left_the_user_is_told() {
        let h = headset("h1");
        let s = snap(vec![], "x", "x");
        let d = decide_in_call(
            Role::Speaker,
            &routing(LostPolicy::UseSystemDefault),
            &h,
            &s,
            false,
        );
        assert!(
            matches!(
                d,
                InCall::Ask {
                    why: AskWhy::NothingLeft,
                    ..
                }
            ),
            "{d:?}"
        );
    }

    #[test]
    fn a_headset_whose_loudspeaker_replacement_was_already_public_is_not_blocked() {
        // From laptop speakers to a screen's speakers: both public, nothing new is exposed.
        let spk = speakers();
        let tv = dev("tv", "DELL U2720Q", Transport::Display, 0, 2);
        let mut tv_public = tv.clone();
        tv_public.public_speaker = true;
        let s = snap(vec![spk.clone(), mic(), tv_public], "mic", "tv");
        assert!(matches!(
            decide_in_call(Role::Speaker, &Routing::default(), &spk, &s, false),
            InCall::Switch { .. }
        ));
    }
}
