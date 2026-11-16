//! Global keyboard shortcuts: which actions have one, what the user chose, and keeping the operating system's
//! registrations in step with it.
//!
//! The shortcuts only *ask* for an action ([`crate::control::command::Command`]); what the action means and when
//! it is possible is decided by the controller, the same one the command line and the tray menu use.
//!
//! macOS needs no permission to register a global shortcut (it is a Carbon hot key, not a keyboard tap): the
//! application is not allowed to read what is typed, only to be told when its own combinations are pressed.

pub mod accelerator;
pub mod tauri_backend;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::{
    control::command::Command,
    database::Database,
    error::{AppError, AppResult},
};
use accelerator::Accelerator;

const STORE_KEY: &str = "shortcuts";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShortcutAction {
    Answer,
    Reject,
    Hangup,
    ToggleMute,
    ToggleHold,
    ShowDialer,
    ShowSearch,
    ToggleDnd,
}

impl ShortcutAction {
    pub const ALL: [ShortcutAction; 8] = [
        ShortcutAction::Answer,
        ShortcutAction::Reject,
        ShortcutAction::Hangup,
        ShortcutAction::ToggleMute,
        ShortcutAction::ToggleHold,
        ShortcutAction::ShowDialer,
        ShortcutAction::ShowSearch,
        ShortcutAction::ToggleDnd,
    ];

    pub fn label(self) -> &'static str {
        match self {
            ShortcutAction::Answer => "Answer",
            ShortcutAction::Reject => "Decline the incoming call",
            ShortcutAction::Hangup => "Hang up",
            ShortcutAction::ToggleMute => "Mute / unmute the microphone",
            ShortcutAction::ToggleHold => "Put on hold / resume",
            ShortcutAction::ShowDialer => "Show the keypad",
            ShortcutAction::ShowSearch => "Search for a contact",
            ShortcutAction::ToggleDnd => "Do not disturb",
        }
    }

    /// What the shortcut asks for. A toggle asks to toggle: the controller reads the confirmed state.
    pub fn command(self) -> Command {
        match self {
            ShortcutAction::Answer => Command::Answer { call_id: None },
            ShortcutAction::Reject => Command::Reject { call_id: None },
            ShortcutAction::Hangup => Command::Hangup { call_id: None },
            ShortcutAction::ToggleMute => Command::Mute {
                call_id: None,
                muted: None,
            },
            ShortcutAction::ToggleHold => Command::Hold {
                call_id: None,
                held: None,
            },
            ShortcutAction::ShowDialer => Command::ShowDialer,
            ShortcutAction::ShowSearch => Command::ShowSearch,
            ShortcutAction::ToggleDnd => Command::Dnd { enabled: None },
        }
    }

    /// Three modifiers and a letter: hard to hit by accident, rarely used by another application.
    pub fn default_accelerator(self) -> &'static str {
        match self {
            ShortcutAction::Answer => "CommandOrControl+Alt+Shift+A",
            ShortcutAction::Reject => "CommandOrControl+Alt+Shift+D",
            ShortcutAction::Hangup => "CommandOrControl+Alt+Shift+H",
            ShortcutAction::ToggleMute => "CommandOrControl+Alt+Shift+M",
            ShortcutAction::ToggleHold => "CommandOrControl+Alt+Shift+P",
            ShortcutAction::ShowDialer => "CommandOrControl+Alt+Shift+N",
            ShortcutAction::ShowSearch => "CommandOrControl+Alt+Shift+F",
            ShortcutAction::ToggleDnd => "CommandOrControl+Alt+Shift+Z",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Binding {
    pub action: ShortcutAction,
    /// Canonical text; `None` when the user removed the combination.
    pub accelerator: Option<String>,
    pub enabled: bool,
}

impl Default for Binding {
    fn default() -> Self {
        Self {
            action: ShortcutAction::Answer,
            accelerator: None,
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Master switch: off, nothing is registered with the system.
    pub enabled: bool,
    pub bindings: Vec<Binding>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            enabled: true,
            bindings: ShortcutAction::ALL
                .iter()
                .map(|a| Binding {
                    action: *a,
                    accelerator: Some(a.default_accelerator().into()),
                    enabled: true,
                })
                .collect(),
        }
    }
}

impl Prefs {
    /// One binding per known action, in the same order: older or hand-edited files are put right.
    fn normalized(mut self) -> Self {
        let mut out = Vec::new();
        for action in ShortcutAction::ALL {
            let stored = self.bindings.iter().position(|b| b.action == action);
            out.push(match stored {
                Some(i) => self.bindings.swap_remove(i),
                None => Binding {
                    action,
                    accelerator: Some(action.default_accelerator().into()),
                    enabled: true,
                },
            });
        }
        self.bindings = out;
        self
    }

    fn binding(&self, action: ShortcutAction) -> &Binding {
        self.bindings
            .iter()
            .find(|b| b.action == action)
            .expect("normalized: every action has a binding")
    }

    fn binding_mut(&mut self, action: ShortcutAction) -> &mut Binding {
        self.bindings
            .iter_mut()
            .find(|b| b.action == action)
            .expect("normalized: every action has a binding")
    }
}

impl Database {
    pub fn get_shortcut_prefs(&self) -> AppResult<Prefs> {
        let raw = self.get_setting_text(STORE_KEY)?;
        Ok(raw
            .and_then(|s| serde_json::from_str::<Prefs>(&s).ok())
            .unwrap_or_default()
            .normalized())
    }

    pub fn save_shortcut_prefs(&self, prefs: &Prefs) -> AppResult<()> {
        let json = serde_json::to_string(prefs).map_err(|e| AppError::Database(e.to_string()))?;
        self.set_setting_text(STORE_KEY, &json)
    }
}

/// Where a combination stands. A saved combination that the system refused is `Failed`, not `Active`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BindingStatus {
    /// Registered with the system: pressing it anywhere runs the action.
    Active,
    /// Turned off by the user (the combination is kept).
    Disabled,
    /// No combination chosen.
    Unassigned,
    /// Paused while a combination is being recorded.
    Suspended,
    /// Saved, but the system could not register it.
    Failed { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutView {
    pub action: ShortcutAction,
    pub label: &'static str,
    pub accelerator: Option<String>,
    /// How to show it to the user (`⌥⇧⌘A`).
    pub display: Option<String>,
    pub default_accelerator: &'static str,
    pub is_default: bool,
    pub enabled: bool,
    pub status: BindingStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsView {
    pub enabled: bool,
    pub capturing: bool,
    pub mac: bool,
    pub items: Vec<ShortcutView>,
}

/// The operating-system side: registering a combination and being told its identifier (the one the press
/// events carry). The Tauri plugin is the real one.
pub trait HotkeyBackend: Send + Sync + 'static {
    fn register(&self, canonical: &str) -> Result<u32, String>;
    fn unregister(&self, canonical: &str);
}

/// Turns the system's refusal into something to act on.
fn explain_refusal(raw: &str) -> String {
    let low = raw.to_lowercase();
    if low.contains("already") || low.contains("registered") || low.contains("in use") {
        "Already used by another application or by the system: choose another combination".into()
    } else {
        format!("The system refused this combination ({raw})")
    }
}

// ----------------------------------------------------------------- repeat guard

const MIN_GAP: Duration = Duration::from_millis(250);
const STALE: Duration = Duration::from_secs(2);

#[derive(Clone, Copy)]
struct Hold {
    held: bool,
    last_event: Instant,
    last_fire: Instant,
}

/// One press, one action. A key that stays down repeats its press (systems differ); a second press is only
/// accepted after the key was released — or when no event came for two seconds, in case a release was lost —
/// and never within a quarter of a second of the last one.
#[derive(Default)]
pub struct RepeatGuard {
    state: HashMap<ShortcutAction, Hold>,
}

impl RepeatGuard {
    pub fn press(&mut self, action: ShortcutAction, now: Instant) -> bool {
        match self.state.get_mut(&action) {
            None => {
                self.state.insert(
                    action,
                    Hold {
                        held: true,
                        last_event: now,
                        last_fire: now,
                    },
                );
                true
            }
            Some(h) => {
                let stale = now.duration_since(h.last_event) > STALE;
                let fire = (!h.held || stale) && now.duration_since(h.last_fire) >= MIN_GAP;
                h.last_event = now;
                if fire {
                    h.held = true;
                    h.last_fire = now;
                }
                fire
            }
        }
    }

    pub fn release(&mut self, action: ShortcutAction) {
        if let Some(h) = self.state.get_mut(&action) {
            h.held = false;
        }
    }
}

// ---------------------------------------------------------------------- service

struct State {
    prefs: Prefs,
    status: HashMap<ShortcutAction, BindingStatus>,
    /// Identifier the system reports for a press → action.
    ids: HashMap<u32, ShortcutAction>,
    /// What is registered with the system right now, to free it before registering again.
    registered: Vec<String>,
    capturing: bool,
    guard: RepeatGuard,
}

pub struct ShortcutService {
    db: Arc<Database>,
    backend: Arc<dyn HotkeyBackend>,
    mac: bool,
    state: Mutex<State>,
}

impl ShortcutService {
    pub fn new(db: Arc<Database>, backend: Arc<dyn HotkeyBackend>) -> Arc<Self> {
        Self::with_platform(db, backend, cfg!(target_os = "macos"))
    }

    pub fn with_platform(
        db: Arc<Database>,
        backend: Arc<dyn HotkeyBackend>,
        mac: bool,
    ) -> Arc<Self> {
        let prefs = db.get_shortcut_prefs().unwrap_or_default();
        Arc::new(Self {
            db,
            backend,
            mac,
            state: Mutex::new(State {
                prefs,
                status: HashMap::new(),
                ids: HashMap::new(),
                registered: Vec::new(),
                capturing: false,
                guard: RepeatGuard::default(),
            }),
        })
    }

    /// Registers what the saved preferences say.
    pub fn start(&self) {
        let mut st = self.state.lock().unwrap();
        self.apply(&mut st);
    }

    /// Frees every combination (quitting): they must not stay reserved by a process that is gone.
    pub fn stop(&self) {
        let mut st = self.state.lock().unwrap();
        for c in st.registered.drain(..) {
            self.backend.unregister(&c);
        }
        st.ids.clear();
    }

    /// Brings the system's registrations in line with the preferences. Everything held is freed first, so a
    /// changed or disabled combination never stays reserved.
    fn apply(&self, st: &mut State) {
        for c in st.registered.drain(..) {
            self.backend.unregister(&c);
        }
        st.ids.clear();
        st.status.clear();

        let mut taken: Vec<(Accelerator, ShortcutAction)> = Vec::new();
        let prefs = st.prefs.clone();
        for b in &prefs.bindings {
            let status = match (&b.accelerator, b.enabled && prefs.enabled) {
                (None, _) => BindingStatus::Unassigned,
                (Some(_), false) => BindingStatus::Disabled,
                (Some(_), true) if st.capturing => BindingStatus::Suspended,
                (Some(text), true) => match Accelerator::parse_for(text, self.mac) {
                    Err(e) => BindingStatus::Failed {
                        message: e.to_string(),
                    },
                    Ok(acc) => match taken.iter().find(|(t, _)| t.same_keys_as(&acc, self.mac)) {
                        Some((_, other)) => BindingStatus::Failed {
                            message: format!("Already used for “{}”", other.label()),
                        },
                        None => match self.backend.register(&acc.canonical()) {
                            Ok(id) => {
                                st.ids.insert(id, b.action);
                                st.registered.push(acc.canonical());
                                taken.push((acc, b.action));
                                BindingStatus::Active
                            }
                            Err(raw) => {
                                log::warn!("shortcut {:?} not registered: {raw}", b.action);
                                BindingStatus::Failed {
                                    message: explain_refusal(&raw),
                                }
                            }
                        },
                    },
                },
            };
            st.status.insert(b.action, status);
        }
        let active = st.ids.len();
        let refused = st
            .status
            .values()
            .filter(|s| matches!(s, BindingStatus::Failed { .. }))
            .count();
        log::info!("shortcuts: {active} active, {refused} not activated");
    }

    pub fn view(&self) -> ShortcutsView {
        let st = self.state.lock().unwrap();
        self.view_of(&st)
    }

    fn view_of(&self, st: &State) -> ShortcutsView {
        let items = st
            .prefs
            .bindings
            .iter()
            .map(|b| {
                let display = b
                    .accelerator
                    .as_deref()
                    .and_then(|t| Accelerator::parse_for(t, self.mac).ok())
                    .map(|a| a.display(self.mac));
                ShortcutView {
                    action: b.action,
                    label: b.action.label(),
                    accelerator: b.accelerator.clone(),
                    display,
                    default_accelerator: b.action.default_accelerator(),
                    is_default: b.accelerator.as_deref() == Some(b.action.default_accelerator())
                        && b.enabled,
                    enabled: b.enabled,
                    status: st
                        .status
                        .get(&b.action)
                        .cloned()
                        .unwrap_or(BindingStatus::Unassigned),
                }
            })
            .collect();
        ShortcutsView {
            enabled: st.prefs.enabled,
            capturing: st.capturing,
            mac: self.mac,
            items,
        }
    }

    fn save_and_apply(&self, st: &mut State) -> AppResult<ShortcutsView> {
        self.db.save_shortcut_prefs(&st.prefs)?;
        self.apply(st);
        Ok(self.view_of(st))
    }

    /// Checks a combination for one action: valid, and not already given to another action.
    fn check(&self, st: &State, action: ShortcutAction, text: &str) -> AppResult<Accelerator> {
        let acc = Accelerator::parse_for(text, self.mac)
            .map_err(|e| AppError::validation(e.to_string()))?;
        for other in &st.prefs.bindings {
            if other.action == action {
                continue;
            }
            let same = other
                .accelerator
                .as_deref()
                .and_then(|t| Accelerator::parse_for(t, self.mac).ok())
                .is_some_and(|o| o.same_keys_as(&acc, self.mac));
            if same {
                return Err(AppError::validation(format!(
                    "Already used for “{}”",
                    other.action.label()
                )));
            }
        }
        Ok(acc)
    }

    /// Changes one action: its combination (`None` removes it) and whether it is on. The answer says, per
    /// action, whether the system accepted the combination.
    pub fn set(
        &self,
        action: ShortcutAction,
        accelerator: Option<&str>,
        enabled: bool,
    ) -> AppResult<ShortcutsView> {
        let mut st = self.state.lock().unwrap();
        let canonical = match accelerator {
            Some(text) => Some(self.check(&st, action, text)?.canonical()),
            None => None,
        };
        let b = st.prefs.binding_mut(action);
        b.accelerator = canonical;
        b.enabled = enabled;
        self.save_and_apply(&mut st)
    }

    pub fn set_master(&self, enabled: bool) -> AppResult<ShortcutsView> {
        let mut st = self.state.lock().unwrap();
        st.prefs.enabled = enabled;
        self.save_and_apply(&mut st)
    }

    /// Back to the defaults: one action, or all of them (also turning the master switch on).
    pub fn reset(&self, action: Option<ShortcutAction>) -> AppResult<ShortcutsView> {
        let mut st = self.state.lock().unwrap();
        match action {
            None => st.prefs = Prefs::default(),
            Some(a) => {
                let default = a.default_accelerator();
                self.check(&st, a, default)?;
                let b = st.prefs.binding_mut(a);
                b.accelerator = Some(default.into());
                b.enabled = true;
            }
        }
        self.save_and_apply(&mut st)
    }

    /// While a combination is being recorded in the settings, nothing is registered: pressing a combination that
    /// already exists must not run its action.
    pub fn set_capture(&self, active: bool) -> ShortcutsView {
        let mut st = self.state.lock().unwrap();
        if st.capturing != active {
            st.capturing = active;
            self.apply(&mut st);
        }
        self.view_of(&st)
    }

    /// A press or a release reported by the system. Returns the action to run, if any.
    pub fn on_event(&self, id: u32, pressed: bool, now: Instant) -> Option<ShortcutAction> {
        let mut st = self.state.lock().unwrap();
        let action = *st.ids.get(&id)?;
        if st.capturing || !st.prefs.enabled || !st.prefs.binding(action).enabled {
            return None;
        }
        if pressed {
            st.guard.press(action, now).then_some(action)
        } else {
            st.guard.release(action);
            None
        }
    }
}

#[cfg(test)]
mod tests;
