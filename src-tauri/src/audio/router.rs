//! Keeps the engine's audio devices in step with the system's, and decides what happens when a device appears,
//! disappears or becomes the default.
//!
//! [`RouterCore`] is the state machine (no clock of its own, no hardware): it is given a snapshot of the system
//! and the time, and answers with actions. [`AudioRouter`] runs it: it listens to the system, waits for the
//! burst of notifications a plug usually causes to end, asks the engine to switch, and reports what the engine
//! confirmed.
//!
//! * "Used" is what the engine **confirmed**, never what was asked. A refused switch leaves the previous device
//!   as the one in use, with the error.
//! * A device that vanishes during a call gets a short grace period (Bluetooth blips) before anything is decided.
//! * Nothing is switched back and forth: a change the engine refused is not retried until the system or the
//!   preferences change again.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use serde::Serialize;

use super::{
    devices::{AudioSystem, DeviceInfo, Snapshot, Watch},
    routing::{
        AskWhy, DeviceRef, InCall, Problem, Resolution, Role, Routing, Selection, Source, Why,
        candidates, decide_in_call, resolve,
    },
};

/// How long a device may stay away during a call before it counts as lost.
pub const GRACE: Duration = Duration::from_millis(2500);
/// How long the system must be quiet before a burst of notifications is acted on.
pub const SETTLE: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Switch the role to this device.
    Apply {
        role: Role,
        device: DeviceInfo,
        mid_call: bool,
        why: Option<Why>,
    },
    /// Tell the user.
    Notice(Notice),
    /// An earlier notice no longer applies.
    Clear(Role),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoticeKind {
    /// The device of the call is gone and nothing was chosen for the user.
    Lost {
        name: String,
        why: AskWhy,
        blocked: Option<String>,
    },
    /// The call was moved on its own.
    Switched { from: String, to: String, why: Why },
    /// The engine could not use the device.
    Failed { name: String, message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub role: Role,
    #[serde(flatten)]
    pub kind: NoticeKind,
}

pub struct RouterCore {
    routing: Routing,
    supports_communication: bool,
    /// The device the engine confirmed it uses.
    applied: HashMap<Role, DeviceInfo>,
    /// When a call's device was first seen missing.
    lost_since: HashMap<Role, Instant>,
    /// The notice currently standing for a role.
    standing: HashMap<Role, Notice>,
    /// A device the engine refused: not tried again until the situation changes.
    refused: HashMap<Role, (String, String)>,
    /// What the user picked during the current call (until it ends).
    pinned: HashMap<Role, String>,
    was_in_call: bool,
}

impl RouterCore {
    pub fn new(routing: Routing, supports_communication: bool) -> Self {
        Self {
            routing,
            supports_communication,
            applied: HashMap::new(),
            lost_since: HashMap::new(),
            standing: HashMap::new(),
            refused: HashMap::new(),
            pinned: HashMap::new(),
            was_in_call: false,
        }
    }

    pub fn routing(&self) -> &Routing {
        &self.routing
    }

    pub fn set_routing(&mut self, routing: Routing) {
        if routing != self.routing {
            self.routing = routing;
            // A new preference deserves a new try.
            self.refused.clear();
        }
    }

    pub fn applied(&self, role: Role) -> Option<&DeviceInfo> {
        self.applied.get(&role)
    }

    pub fn standing(&self, role: Role) -> Option<&Notice> {
        self.standing.get(&role)
    }

    pub fn refused(&self, role: Role) -> Option<&(String, String)> {
        self.refused.get(&role)
    }

    /// The engine accepted the switch.
    pub fn confirmed(&mut self, role: Role, device: DeviceInfo) {
        self.refused.remove(&role);
        self.lost_since.remove(&role);
        self.applied.insert(role, device);
    }

    /// The engine refused the switch: the previous device stays the one in use.
    pub fn failed(&mut self, role: Role, device: &DeviceInfo, message: String) -> Notice {
        self.refused
            .insert(role, (device.uid.clone(), message.clone()));
        let n = Notice {
            role,
            kind: NoticeKind::Failed {
                name: device.name.clone(),
                message,
            },
        };
        self.standing.insert(role, n.clone());
        n
    }

    /// The user picked a device for the current call.
    pub fn pin(&mut self, role: Role, uid: String) {
        self.pinned.insert(role, uid);
        self.standing.remove(&role);
        self.lost_since.remove(&role);
    }

    /// The earliest time something must be re-examined without a new system notification.
    pub fn next_deadline(&self) -> Option<Instant> {
        self.lost_since.values().map(|t| *t + GRACE).min()
    }

    pub fn resolution(&self, role: Role, snap: &Snapshot) -> Resolution {
        resolve(
            role,
            self.routing.choice(role),
            snap,
            self.supports_communication,
        )
    }

    pub fn evaluate(&mut self, snap: &Snapshot, now: Instant, in_call: bool) -> Vec<Action> {
        let mut out = Vec::new();
        if self.was_in_call && !in_call {
            // The call is over: what was decided for it is over too.
            self.pinned.clear();
            self.lost_since.clear();
            for role in Role::ALL {
                if self.standing.remove(&role).is_some() {
                    out.push(Action::Clear(role));
                }
            }
        }
        self.was_in_call = in_call;

        for role in Role::ALL {
            // The ringtone device is changed by restarting the engine: never while a call is going on. The change
            // is made as soon as the call ends (the next evaluation).
            if in_call && role == Role::Ringer {
                continue;
            }
            let mid_call = in_call;
            let res = self.resolution(role, snap);
            let current = self.applied.get(&role).cloned();

            // Nothing applied yet, or no call: the engine simply follows the resolution.
            let Some(current) = current.filter(|_| mid_call) else {
                self.lost_since.remove(&role);
                if let Some(d) = res.used.as_ref().filter(|d| d.selectable) {
                    let same = self.applied.get(&role).is_some_and(|a| a.uid == d.uid);
                    let refused = self
                        .refused
                        .get(&role)
                        .is_some_and(|(uid, _)| *uid == d.uid);
                    if !same && !refused {
                        out.push(Action::Apply {
                            role,
                            device: d.clone(),
                            mid_call: false,
                            why: None,
                        });
                    }
                }
                if self
                    .standing
                    .get(&role)
                    .is_some_and(|n| matches!(n.kind, NoticeKind::Lost { .. }))
                    && !in_call
                    && self.standing.remove(&role).is_some()
                {
                    out.push(Action::Clear(role));
                }
                continue;
            };

            // The user chose a device for this call: it stays, as long as it is there.
            if let Some(uid) = self.pinned.get(&role)
                && snap.find(uid).is_some()
            {
                continue;
            }

            let present = snap.find(&current.uid).is_some_and(|d| d.alive);
            if !present {
                let since = *self.lost_since.entry(role).or_insert(now);
                if now.duration_since(since) < GRACE {
                    continue; // may be a blip: wait
                }
            } else {
                self.lost_since.remove(&role);
                // The device came back: the standing notice about it is moot.
                if self
                    .standing
                    .get(&role)
                    .is_some_and(|n| matches!(n.kind, NoticeKind::Lost { .. }))
                    && self.standing.remove(&role).is_some()
                {
                    out.push(Action::Clear(role));
                }
            }

            match decide_in_call(
                role,
                &self.routing,
                &current,
                snap,
                self.supports_communication,
            ) {
                InCall::Keep => {}
                InCall::Switch { to, why } => {
                    let refused = self
                        .refused
                        .get(&role)
                        .is_some_and(|(uid, _)| *uid == to.uid);
                    if to.selectable && !refused {
                        out.push(Action::Apply {
                            role,
                            device: to,
                            mid_call: true,
                            why: Some(why),
                        });
                    }
                }
                InCall::Ask { lost, blocked, why } => {
                    let notice = Notice {
                        role,
                        kind: NoticeKind::Lost {
                            name: lost
                                .as_ref()
                                .map(|d| d.name.clone())
                                .unwrap_or(current.name.clone()),
                            why,
                            blocked: blocked.map(|d| d.name),
                        },
                    };
                    if self.standing.get(&role) != Some(&notice) {
                        self.standing.insert(role, notice.clone());
                        out.push(Action::Notice(notice));
                    }
                }
            }
        }
        out
    }

    /// The call's audio was moved without the user: remember and say so.
    pub fn switched(&mut self, role: Role, from: &DeviceInfo, to: DeviceInfo, why: Why) -> Notice {
        self.standing.remove(&role);
        let n = Notice {
            role,
            kind: NoticeKind::Switched {
                from: from.name.clone(),
                to: to.name.clone(),
                why,
            },
        };
        self.standing.insert(role, n.clone());
        self.confirmed(role, to);
        n
    }
}

// ------------------------------------------------------------------- the view

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleState {
    pub role: Role,
    pub label: &'static str,
    /// What the user asked for.
    pub choice: super::routing::RoleChoice,
    /// What the system would give for this choice now.
    pub resolution: Resolution,
    /// What the engine actually uses, as it confirmed. Differs from `resolution.used` while a switch is pending,
    /// was refused, or was blocked.
    pub in_use: Option<DeviceInfo>,
    pub notice: Option<Notice>,
    /// The engine refused to use the device in the resolution.
    pub refused: Option<String>,
    pub choices: Vec<DeviceInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    pub snapshot: Snapshot,
    pub roles: Vec<RoleState>,
    pub routing: Routing,
    pub in_call: bool,
    pub supports_communication_default: bool,
}

// -------------------------------------------------------------- the service

#[async_trait]
pub trait Target: Send + Sync + 'static {
    /// Some call is in progress or ringing.
    fn call_active(&self) -> bool;
    /// Moves a role to a device. For the conversation roles, `mid_call` switches the call in progress; for the
    /// ringer, the engine must restart to use it, which is only done when no call is active.
    async fn apply(&self, role: Role, device: &DeviceInfo, mid_call: bool) -> Result<(), String>;
    /// Calls were touched by a device change: re-send the state that must survive it (muted, on hold).
    async fn reassert_call_state(&self);
    fn publish(&self, state: &AudioState);
    /// Saves what the router learned: a saved-by-name choice that is now known by identifier.
    fn learned_uid(&self, role: Role, uid: String);
}

pub struct AudioRouter {
    system: Arc<dyn AudioSystem>,
    target: Arc<dyn Target>,
    core: Mutex<RouterCore>,
    /// Serialises evaluation + application, so two bursts never switch at once.
    gate: tokio::sync::Mutex<()>,
    watch: Mutex<Option<Box<dyn Watch>>>,
}

impl AudioRouter {
    pub fn new(
        system: Arc<dyn AudioSystem>,
        target: Arc<dyn Target>,
        routing: Routing,
    ) -> Arc<Self> {
        let supports = system.supports_communication_default();
        Arc::new(Self {
            system,
            target,
            core: Mutex::new(RouterCore::new(routing, supports)),
            gate: tokio::sync::Mutex::new(()),
            watch: Mutex::new(None),
        })
    }

    pub fn snapshot(&self) -> Snapshot {
        self.system.snapshot()
    }

    pub fn routing(&self) -> Routing {
        self.core.lock().unwrap().routing().clone()
    }

    /// The names the engine must start with: what each role resolves to now.
    pub fn engine_names(&self) -> [Option<String>; 3] {
        let snap = self.system.snapshot();
        let core = self.core.lock().unwrap();
        Role::ALL.map(|r| {
            core.resolution(r, &snap)
                .used
                .filter(|d| d.selectable)
                .map(|d| d.name)
        })
    }

    pub fn state(&self) -> AudioState {
        let snap = self.system.snapshot();
        let core = self.core.lock().unwrap();
        let roles = Role::ALL
            .iter()
            .map(|&role| RoleState {
                role,
                label: role.label(),
                choice: core.routing().choice(role).clone(),
                resolution: core.resolution(role, &snap),
                in_use: core.applied(role).cloned(),
                notice: core.standing(role).cloned(),
                refused: core.refused(role).map(|(_, m)| m.clone()),
                choices: candidates(role, &snap),
            })
            .collect();
        AudioState {
            roles,
            routing: core.routing().clone(),
            in_call: self.target.call_active(),
            supports_communication_default: self.system.supports_communication_default(),
            snapshot: snap,
        }
    }

    /// Starts listening to the system. Every notification is followed by a quiet period, then one evaluation.
    pub fn start(self: &Arc<Self>) {
        let me = Arc::downgrade(self);
        let generation = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let notify: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            use std::sync::atomic::Ordering;
            // Every notification restarts the wait; only the last one of a burst acts.
            let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let (me, generation) = (me.clone(), generation.clone());
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(SETTLE).await;
                if generation.load(Ordering::SeqCst) == mine
                    && let Some(me) = me.upgrade()
                {
                    me.refresh().await;
                }
            });
        });
        *self.watch.lock().unwrap() = self.system.watch(notify);
        let me = self.clone();
        tauri::async_runtime::spawn(async move { me.refresh().await });
    }

    pub fn is_watching(&self) -> bool {
        self.watch.lock().unwrap().is_some()
    }

    /// Looks at the system now and brings the engine in line. Also re-arms itself for pending grace periods.
    pub fn refresh(
        self: &Arc<Self>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        // Boxed: a re-arming timer calls this again, and the compiler cannot prove `Send` for a recursive future.
        Box::pin(self.refresh_now())
    }

    async fn refresh_now(self: &Arc<Self>) {
        let _turn = self.gate.lock().await;
        let in_call = self.target.call_active();
        let snap = self.system.snapshot();
        let (actions, deadline) = {
            let mut core = self.core.lock().unwrap();
            // Learn identifiers of choices saved by name.
            for role in Role::ALL {
                if let Some(uid) = core.resolution(role, &snap).learned_uid {
                    self.target.learned_uid(role, uid);
                }
            }
            let a = core.evaluate(&snap, Instant::now(), in_call);
            (a, core.next_deadline())
        };
        self.perform(actions, &snap).await;
        self.target.publish(&self.state());
        if let Some(at) = deadline {
            let me = Arc::downgrade(self);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep_until(
                    tokio::time::Instant::from_std(at) + Duration::from_millis(50),
                )
                .await;
                if let Some(me) = me.upgrade() {
                    me.refresh().await;
                }
            });
        }
    }

    async fn perform(&self, actions: Vec<Action>, _snap: &Snapshot) {
        let mut touched_call = false;
        for action in actions {
            match action {
                Action::Apply {
                    role,
                    device,
                    mid_call,
                    why,
                } => {
                    let from = self.core.lock().unwrap().applied(role).cloned();
                    match self.target.apply(role, &device, mid_call).await {
                        Ok(()) => {
                            touched_call |= mid_call;
                            let mut core = self.core.lock().unwrap();
                            match (why, from) {
                                (Some(why), Some(from)) if mid_call => {
                                    core.switched(role, &from, device, why);
                                }
                                _ => core.confirmed(role, device),
                            }
                        }
                        Err(message) => {
                            log::warn!(
                                "audio: cannot use {:?} for {role:?}: {message}",
                                device.name
                            );
                            self.core.lock().unwrap().failed(role, &device, message);
                        }
                    }
                }
                Action::Notice(n) => log::info!("audio notice: {n:?}"),
                Action::Clear(_) => {}
            }
        }
        if touched_call {
            // A switch restarts the call's audio: the microphone stays muted, the hold stays.
            self.target.reassert_call_state().await;
        }
    }

    /// Replaces the preferences (the user changed them) and applies them.
    pub async fn set_routing(self: &Arc<Self>, routing: Routing) {
        self.core.lock().unwrap().set_routing(routing);
        self.refresh().await;
    }

    /// The user picks a device, for this call only or for good.
    pub async fn choose(self: &Arc<Self>, role: Role, uid: &str) -> Result<(), String> {
        let _turn = self.gate.lock().await;
        let snap = self.system.snapshot();
        let device = snap
            .find(uid)
            .filter(|d| d.alive)
            .cloned()
            .ok_or_else(|| "Ce périphérique n'est plus disponible".to_string())?;
        if !device.selectable {
            return Err("Le moteur audio ne peut pas utiliser un périphérique à ce nom".into());
        }
        let mid_call = self.target.call_active() && role != Role::Ringer;
        self.target.apply(role, &device, mid_call).await?;
        {
            let mut core = self.core.lock().unwrap();
            core.confirmed(role, device);
            if mid_call {
                core.pin(role, uid.to_owned());
            }
        }
        if mid_call {
            self.target.reassert_call_state().await;
        }
        self.target.publish(&self.state());
        Ok(())
    }

    /// Saves the choice the user made for a role as an explicit one.
    pub async fn remember(self: &Arc<Self>, role: Role, uid: &str) -> Option<Routing> {
        let snap = self.system.snapshot();
        let device = snap.find(uid)?.clone();
        let mut routing = self.routing();
        routing.choice_mut(role).selection = Selection::Explicit {
            device: DeviceRef::of(&device),
        };
        Some(routing)
    }

    /// For the diagnostics: what each role resolves to, with its problems, as text for people.
    pub fn problems(&self) -> Vec<(Role, Problem)> {
        let snap = self.system.snapshot();
        let core = self.core.lock().unwrap();
        Role::ALL
            .iter()
            .flat_map(|&r| {
                core.resolution(r, &snap)
                    .problems
                    .into_iter()
                    .map(move |p| (r, p))
            })
            .collect()
    }

    pub fn source_of(&self, role: Role) -> Source {
        let snap = self.system.snapshot();
        self.core.lock().unwrap().resolution(role, &snap).source
    }
}

#[cfg(test)]
mod tests;
