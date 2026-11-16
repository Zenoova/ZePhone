//! The physical buttons of a headset: from what the hardware reports to what the telephone does.
//!
//! Three separate steps, so each can be tested alone:
//!
//! 1. a **source** reports what the hardware said ([`HidInput`]: this usage changed to this value);
//! 2. the **interpreter** ([`Interpreter`]) decides what it means *given the calls ZePhone really has*: it
//!    removes duplicates, reads press and release, refuses a long press, and never turns an event into an action
//!    the situation does not allow;
//! 3. the **controller** (`crate::control`) — the same one the keyboard shortcuts and the command line use — runs
//!    the action and picks the call by the documented rule.
//!
//! What is read: the standard USB/Bluetooth **HID Telephony page** (0x0B) — hook switch, phone mute, hold, drop.
//! What is not: the headset's vendor-specific events (docking, charging, proximity "answer on lift"), which are
//! neither standard nor documented here, and so can never be mistaken for an order to answer or hang up.

pub mod runtime;
pub mod service;

#[cfg(target_os = "macos")]
pub mod hid_macos;

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::control::command::Command;

/// How the buttons are handled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// The best mechanism this system offers (today: the standard HID telephony reports).
    #[default]
    Auto,
    /// The system's standard mechanism: HID telephony reports.
    System,
    /// A manufacturer's integration. None is implemented: choosing it handles nothing, and the page says so.
    Vendor,
    /// The buttons do nothing in ZePhone. The audio is unaffected.
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HeadsetSettings {
    pub mode: Mode,
    /// The call button answers a ringing call.
    pub answer: bool,
    /// Putting the headset "on hook" (or the drop button) ends the call in progress.
    pub hang_up: bool,
    /// The mute button mutes and unmutes the microphone of the call.
    pub mute: bool,
    /// The hold button puts the call on hold and resumes it.
    pub hold: bool,
    /// Only listen to the headset whose audio ZePhone is using. Other headsets and docks, or a headset that
    /// another application is using, are ignored.
    pub only_selected_device: bool,
    /// A button held this long is a long press: ignored, never taken for a short one.
    pub long_press_ms: u32,
}

impl Default for HeadsetSettings {
    fn default() -> Self {
        Self {
            mode: Mode::Auto,
            answer: true,
            hang_up: true,
            mute: true,
            hold: true,
            only_selected_device: true,
            long_press_ms: 800,
        }
    }
}

impl HeadsetSettings {
    /// Whether ZePhone reads the hardware at all.
    pub fn listens(&self) -> bool {
        matches!(self.mode, Mode::Auto | Mode::System)
    }
}

/// What a button is, from the HID Telephony page (and nothing else).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Usage {
    /// 0x20, on/off control: off hook = the call button was pressed (or the handset lifted).
    HookSwitch,
    /// 0x21, momentary: a "flash" (switch between calls). Not used.
    Flash,
    /// 0x23, on/off control: hold.
    Hold,
    /// 0x26, momentary: drop (end the call).
    Drop,
    /// 0x2F, momentary: the mute button.
    PhoneMute,
    /// Anything else the device reports.
    Other { page: u16, usage: u16 },
}

impl Usage {
    pub const TELEPHONY_PAGE: u16 = 0x0B;

    pub fn from_hid(page: u16, usage: u16) -> Usage {
        match (page, usage) {
            (0x0B, 0x20) => Usage::HookSwitch,
            (0x0B, 0x21) => Usage::Flash,
            (0x0B, 0x23) => Usage::Hold,
            (0x0B, 0x26) => Usage::Drop,
            (0x0B, 0x2F) => Usage::PhoneMute,
            _ => Usage::Other { page, usage },
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Usage::HookSwitch => "Answer / hang up",
            Usage::Flash => "Flash",
            Usage::Hold => "Hold",
            Usage::Drop => "Hang up",
            Usage::PhoneMute => "Mute the microphone",
            Usage::Other { .. } => "Other",
        }
    }

    /// Momentary controls report a press (1) then a release (0); on/off controls report each change of state.
    fn momentary(self) -> bool {
        matches!(self, Usage::PhoneMute | Usage::Drop | Usage::Flash)
    }
}

/// One thing the hardware reported.
#[derive(Debug, Clone, PartialEq)]
pub struct HidInput {
    /// The headset's identity (vendor, product, location): stable while it stays plugged in.
    pub device: String,
    /// The headset's name as it announces itself.
    pub product: String,
    pub usage: Usage,
    pub value: i32,
    pub at: Instant,
}

/// What the interpreter needs to know about the world.
#[derive(Debug, Clone, Copy, Default)]
pub struct Context {
    /// A call is ringing.
    pub incoming: bool,
    /// A call is being set up or in progress.
    pub live: bool,
    /// A call is established (so a microphone or a hold exists).
    pub established: bool,
    /// The headset is the one whose audio ZePhone uses.
    pub device_selected: bool,
}

/// Why an event did nothing. Shown in the diagnostics: a button that "does nothing" must say why.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Ignored {
    ButtonsOff,
    VendorNotAvailable,
    ThisActionIsOff,
    NotTheSelectedHeadset,
    Duplicate,
    NoChange,
    /// The hook went off while nothing rings: it never starts or ends anything.
    NothingToAnswer,
    /// The hook went on while a call rings or nothing is going on.
    NoCallToEnd,
    /// The call is ringing: a headset never declines a call.
    NeverDeclines,
    NoCallToControl,
    LongPress,
    /// A release without its press.
    NoPress,
    /// The press of a momentary button: the action happens at its release.
    Pressed,
    Unsupported,
}

impl Ignored {
    pub fn explain(self) -> &'static str {
        match self {
            Ignored::ButtonsOff => "The headset buttons are disabled",
            Ignored::VendorNotAvailable => "No manufacturer integration is available",
            Ignored::ThisActionIsOff => "This action is disabled in the settings",
            Ignored::NotTheSelectedHeadset => "This is not the headset used by ZePhone",
            Ignored::Duplicate => "Duplicate event",
            Ignored::NoChange => "The state did not change",
            Ignored::NothingToAnswer => "No incoming call to answer",
            Ignored::NoCallToEnd => "No call in progress to hang up",
            Ignored::NeverDeclines => "A headset never declines a ringing call",
            Ignored::NoCallToControl => "No established call to control",
            Ignored::LongPress => "Long press ignored",
            Ignored::NoPress => "Release without a press",
            Ignored::Pressed => "Press: the action happens at the release",
            Ignored::Unsupported => "Unsupported command",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Interpreted {
    Do(Command),
    Ignore(Ignored),
}

const DUPLICATE_WINDOW: Duration = Duration::from_millis(150);

#[derive(Default)]
pub struct Interpreter {
    /// Whether each headset's hook is off, as it last said.
    off_hook: HashMap<String, bool>,
    /// The last report of each (headset, button): value and time.
    last: HashMap<(String, Usage), (i32, Instant)>,
    /// When each momentary button went down.
    pressed: HashMap<(String, Usage), Instant>,
}

impl Interpreter {
    pub fn new() -> Self {
        Self::default()
    }

    /// A headset went away: what is remembered about it goes too.
    pub fn forget(&mut self, device: &str) {
        self.off_hook.remove(device);
        self.last.retain(|(d, _), _| d != device);
        self.pressed.retain(|(d, _), _| d != device);
    }

    pub fn handle(
        &mut self,
        ev: &HidInput,
        settings: &HeadsetSettings,
        ctx: &Context,
    ) -> Interpreted {
        use Ignored::*;
        let no = Interpreted::Ignore;
        match settings.mode {
            Mode::Off => return no(ButtonsOff),
            Mode::Vendor => return no(VendorNotAvailable),
            Mode::Auto | Mode::System => {}
        }
        if settings.only_selected_device && !ctx.device_selected {
            return no(NotTheSelectedHeadset);
        }

        // The same report twice in a moment (some devices send each report on two interfaces).
        let key = (ev.device.clone(), ev.usage);
        let duplicate = self.last.get(&key).is_some_and(|(v, at)| {
            *v == ev.value && ev.at.saturating_duration_since(*at) < DUPLICATE_WINDOW
        });
        self.last.insert(key.clone(), (ev.value, ev.at));
        if duplicate {
            return no(Duplicate);
        }

        match ev.usage {
            Usage::HookSwitch => {
                let off = ev.value != 0;
                // A headset is on hook until it says otherwise.
                let was = self
                    .off_hook
                    .insert(ev.device.clone(), off)
                    .unwrap_or(false);
                if off == was {
                    return no(NoChange);
                }
                if off {
                    // The call button, or the handset lifted: answers a call that rings, and does nothing else.
                    if !settings.answer {
                        return no(ThisActionIsOff);
                    }
                    if ctx.incoming {
                        Interpreted::Do(Command::Answer { call_id: None })
                    } else {
                        no(NothingToAnswer)
                    }
                } else {
                    // Back on hook: ends the call in progress. A call that rings is never declined by it, and
                    // neither is a headset put back on its stand while nothing is going on.
                    if !settings.hang_up {
                        return no(ThisActionIsOff);
                    }
                    if ctx.incoming && !ctx.live {
                        no(NeverDeclines)
                    } else if ctx.live {
                        Interpreted::Do(Command::Hangup { call_id: None })
                    } else {
                        no(NoCallToEnd)
                    }
                }
            }
            Usage::Hold => {
                // On/off control: each change is one press.
                if !settings.hold {
                    return no(ThisActionIsOff);
                }
                if ctx.established {
                    Interpreted::Do(Command::Hold {
                        call_id: None,
                        held: None,
                    })
                } else {
                    no(NoCallToControl)
                }
            }
            u if u.momentary() => {
                if ev.value != 0 {
                    self.pressed.insert(key, ev.at);
                    return no(Pressed);
                }
                let Some(since) = self.pressed.remove(&key) else {
                    return no(NoPress);
                };
                if ev.at.saturating_duration_since(since)
                    >= Duration::from_millis(settings.long_press_ms.into())
                {
                    return no(LongPress);
                }
                match u {
                    Usage::PhoneMute => {
                        if !settings.mute {
                            no(ThisActionIsOff)
                        } else if ctx.established {
                            Interpreted::Do(Command::Mute {
                                call_id: None,
                                muted: None,
                            })
                        } else {
                            no(NoCallToControl)
                        }
                    }
                    Usage::Drop => {
                        if !settings.hang_up {
                            no(ThisActionIsOff)
                        } else if ctx.live {
                            Interpreted::Do(Command::Hangup { call_id: None })
                        } else {
                            no(NoCallToEnd)
                        }
                    }
                    _ => no(Unsupported),
                }
            }
            _ => no(Unsupported),
        }
    }
}

/// Whether an HID product name is the audio device ZePhone uses: the same words, ignoring case, spaces and the
/// vendor's suffixes. Both names come from the same hardware, but not always spelt identically.
pub fn names_match(hid_product: &str, audio_name: &str) -> bool {
    fn norm(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    }
    let (a, b) = (norm(hid_product), norm(audio_name));
    a.len() >= 4 && b.len() >= 4 && (a.contains(&b) || b.contains(&a))
}

#[cfg(test)]
mod tests;
