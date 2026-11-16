//! How headset events are interpreted. Simulated reports: no headset is needed (and none is claimed by these
//! tests; the hardware checks are listed in docs/HEADSETS.md).

use super::*;

const HEADSET: &str = "0b0e:0412:1";

struct Rig {
    interpreter: Interpreter,
    settings: HeadsetSettings,
    t0: Instant,
}

impl Rig {
    fn new() -> Self {
        Self {
            interpreter: Interpreter::new(),
            settings: HeadsetSettings::default(),
            t0: Instant::now(),
        }
    }
    fn send(&mut self, usage: Usage, value: i32, ms: u64, ctx: Context) -> Interpreted {
        self.send_from(HEADSET, usage, value, ms, ctx)
    }
    fn send_from(
        &mut self,
        device: &str,
        usage: Usage,
        value: i32,
        ms: u64,
        ctx: Context,
    ) -> Interpreted {
        let ev = HidInput {
            device: device.into(),
            product: "Jabra Evolve2 65".into(),
            usage,
            value,
            at: self.t0 + Duration::from_millis(ms),
        };
        self.interpreter.handle(&ev, &self.settings, &ctx)
    }
}

const RINGING: Context = Context {
    incoming: true,
    live: false,
    established: false,
    device_selected: true,
};
const IN_CALL: Context = Context {
    incoming: false,
    live: true,
    established: true,
    device_selected: true,
};
const SETTING_UP: Context = Context {
    incoming: false,
    live: true,
    established: false,
    device_selected: true,
};
const IDLE: Context = Context {
    incoming: false,
    live: false,
    established: false,
    device_selected: true,
};
const RINGING_DURING_CALL: Context = Context {
    incoming: true,
    live: true,
    established: true,
    device_selected: true,
};

fn ignored(i: Interpreted) -> Ignored {
    match i {
        Interpreted::Ignore(w) => w,
        Interpreted::Do(c) => panic!("expected nothing, got {c:?}"),
    }
}
fn does(i: Interpreted) -> Command {
    match i {
        Interpreted::Do(c) => c,
        Interpreted::Ignore(w) => panic!("expected an action, ignored: {w:?}"),
    }
}

// ----------------------------------------------------------------- the hook

#[test]
fn the_call_button_answers_a_ringing_call_and_the_next_press_ends_it() {
    let mut r = Rig::new();
    assert_eq!(
        does(r.send(Usage::HookSwitch, 1, 0, RINGING)),
        Command::Answer { call_id: None }
    );
    // Pressed again once connected: back on hook.
    assert_eq!(
        does(r.send(Usage::HookSwitch, 0, 5000, IN_CALL)),
        Command::Hangup { call_id: None }
    );
}

#[test]
fn a_headset_resting_on_its_stand_or_reporting_its_initial_state_does_nothing() {
    let mut r = Rig::new();
    // First report: on hook, which is what it already was.
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 0, 0, RINGING)),
        Ignored::NoChange
    );
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 0, 1000, IN_CALL)),
        Ignored::NoChange
    );
}

#[test]
fn going_on_hook_never_declines_a_ringing_call() {
    let mut r = Rig::new();
    // The hook was off (a previous call), the headset is put back while a new call rings.
    r.send(Usage::HookSwitch, 1, 0, IDLE);
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 0, 1000, RINGING)),
        Ignored::NeverDeclines
    );
}

#[test]
fn going_on_hook_with_nothing_going_on_does_nothing() {
    let mut r = Rig::new();
    r.send(Usage::HookSwitch, 1, 0, IDLE);
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 0, 1000, IDLE)),
        Ignored::NoCallToEnd
    );
}

#[test]
fn going_off_hook_without_a_ringing_call_touches_nothing_not_even_a_call_in_progress() {
    let mut r = Rig::new();
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 0, IDLE)),
        Ignored::NothingToAnswer
    );
    let mut r = Rig::new();
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 0, IN_CALL)),
        Ignored::NothingToAnswer,
        "no hang-up, no mute"
    );
    let mut r = Rig::new();
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 0, SETTING_UP)),
        Ignored::NothingToAnswer
    );
}

#[test]
fn a_call_waiting_while_in_a_call_is_answered_by_the_button() {
    let mut r = Rig::new();
    assert_eq!(
        does(r.send(Usage::HookSwitch, 1, 0, RINGING_DURING_CALL)),
        Command::Answer { call_id: None }
    );
}

#[test]
fn on_hook_ends_a_call_being_set_up_too() {
    let mut r = Rig::new();
    r.send(Usage::HookSwitch, 1, 0, IDLE);
    assert_eq!(
        does(r.send(Usage::HookSwitch, 0, 1000, SETTING_UP)),
        Command::Hangup { call_id: None }
    );
}

#[test]
fn the_same_report_twice_is_one_event() {
    let mut r = Rig::new();
    assert!(matches!(
        r.send(Usage::HookSwitch, 1, 0, RINGING),
        Interpreted::Do(_)
    ));
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 20, RINGING)),
        Ignored::Duplicate
    );
    // And a repeat later is no change at all.
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 3000, RINGING)),
        Ignored::NoChange
    );
}

#[test]
fn each_headset_has_its_own_hook() {
    let mut r = Rig::new();
    assert!(matches!(
        r.send_from("a", Usage::HookSwitch, 1, 0, RINGING),
        Interpreted::Do(_)
    ));
    // Another headset going off hook is its own edge.
    assert!(matches!(
        r.send_from("b", Usage::HookSwitch, 1, 500, RINGING),
        Interpreted::Do(_)
    ));
    r.interpreter.forget("a");
    // A headset that left and came back starts on hook again.
    assert!(matches!(
        r.send_from("a", Usage::HookSwitch, 1, 2000, RINGING),
        Interpreted::Do(_)
    ));
}

// ------------------------------------------------------------ mute, drop, hold

#[test]
fn a_short_press_of_mute_toggles_the_microphone_at_the_release() {
    let mut r = Rig::new();
    assert_eq!(
        ignored(r.send(Usage::PhoneMute, 1, 0, IN_CALL)),
        Ignored::Pressed
    );
    assert_eq!(
        does(r.send(Usage::PhoneMute, 0, 120, IN_CALL)),
        Command::Mute {
            call_id: None,
            muted: None
        }
    );
}

#[test]
fn a_long_press_is_never_taken_for_a_short_one() {
    let mut r = Rig::new();
    r.send(Usage::PhoneMute, 1, 0, IN_CALL);
    assert_eq!(
        ignored(r.send(Usage::PhoneMute, 0, 1500, IN_CALL)),
        Ignored::LongPress
    );
    // The next short press works.
    r.send(Usage::PhoneMute, 1, 3000, IN_CALL);
    assert!(matches!(
        r.send(Usage::PhoneMute, 0, 3100, IN_CALL),
        Interpreted::Do(_)
    ));
}

#[test]
fn a_release_without_its_press_does_nothing() {
    let mut r = Rig::new();
    assert_eq!(
        ignored(r.send(Usage::PhoneMute, 0, 0, IN_CALL)),
        Ignored::NoPress
    );
}

#[test]
fn mute_without_an_established_call_does_nothing() {
    let mut r = Rig::new();
    for ctx in [IDLE, RINGING, SETTING_UP] {
        r.send(Usage::PhoneMute, 1, 0, ctx);
        assert_eq!(
            ignored(r.send(Usage::PhoneMute, 0, 100, ctx)),
            Ignored::NoCallToControl
        );
        r.t0 += Duration::from_secs(10);
    }
}

#[test]
fn the_drop_button_ends_the_call_in_progress_only() {
    let mut r = Rig::new();
    r.send(Usage::Drop, 1, 0, IN_CALL);
    assert_eq!(
        does(r.send(Usage::Drop, 0, 100, IN_CALL)),
        Command::Hangup { call_id: None }
    );
    r.t0 += Duration::from_secs(10);
    r.send(Usage::Drop, 1, 0, RINGING);
    assert_eq!(
        ignored(r.send(Usage::Drop, 0, 100, RINGING)),
        Ignored::NoCallToEnd,
        "it never declines"
    );
}

#[test]
fn hold_toggles_only_on_an_established_call() {
    let mut r = Rig::new();
    assert_eq!(
        does(r.send(Usage::Hold, 1, 0, IN_CALL)),
        Command::Hold {
            call_id: None,
            held: None
        }
    );
    assert_eq!(
        ignored(r.send(Usage::Hold, 0, 3000, RINGING)),
        Ignored::NoCallToControl
    );
}

#[test]
fn flash_and_unknown_buttons_do_nothing() {
    let mut r = Rig::new();
    r.send(Usage::Flash, 1, 0, IN_CALL);
    assert_eq!(
        ignored(r.send(Usage::Flash, 0, 50, IN_CALL)),
        Ignored::Unsupported
    );
    assert_eq!(
        ignored(r.send(
            Usage::Other {
                page: 12,
                usage: 0xCD
            },
            1,
            100,
            IN_CALL
        )),
        Ignored::Unsupported
    );
}

// --------------------------------------------------------------- the settings

#[test]
fn the_buttons_can_be_turned_off_without_touching_anything_else() {
    let mut r = Rig::new();
    r.settings.mode = Mode::Off;
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 0, RINGING)),
        Ignored::ButtonsOff
    );
    r.settings.mode = Mode::Vendor;
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 500, RINGING)),
        Ignored::VendorNotAvailable
    );
    assert!(
        !r.settings.listens()
            && !HeadsetSettings {
                mode: Mode::Off,
                ..Default::default()
            }
            .listens()
    );
    assert!(HeadsetSettings::default().listens());
}

#[test]
fn each_action_can_be_turned_off_alone() {
    let mut r = Rig::new();
    r.settings.answer = false;
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 0, RINGING)),
        Ignored::ThisActionIsOff
    );
    r.settings = HeadsetSettings {
        mute: false,
        ..Default::default()
    };
    r.send(Usage::PhoneMute, 1, 0, IN_CALL);
    assert_eq!(
        ignored(r.send(Usage::PhoneMute, 0, 100, IN_CALL)),
        Ignored::ThisActionIsOff
    );
    r.settings = HeadsetSettings {
        hang_up: false,
        ..Default::default()
    };
    r.send(Usage::Drop, 1, 0, IN_CALL);
    assert_eq!(
        ignored(r.send(Usage::Drop, 0, 100, IN_CALL)),
        Ignored::ThisActionIsOff
    );
    r.settings = HeadsetSettings {
        hold: false,
        ..Default::default()
    };
    assert_eq!(
        ignored(r.send(Usage::Hold, 1, 0, IN_CALL)),
        Ignored::ThisActionIsOff
    );
}

#[test]
fn a_headset_zephone_is_not_using_is_ignored_unless_that_is_turned_off() {
    let mut r = Rig::new();
    let elsewhere = Context {
        device_selected: false,
        ..RINGING
    };
    assert_eq!(
        ignored(r.send(Usage::HookSwitch, 1, 0, elsewhere)),
        Ignored::NotTheSelectedHeadset
    );
    r.settings.only_selected_device = false;
    assert!(matches!(
        r.send(Usage::HookSwitch, 1, 500, elsewhere),
        Interpreted::Do(_)
    ));
}

#[test]
fn the_long_press_threshold_is_the_setting() {
    let mut r = Rig::new();
    r.settings.long_press_ms = 300;
    r.send(Usage::PhoneMute, 1, 0, IN_CALL);
    assert_eq!(
        ignored(r.send(Usage::PhoneMute, 0, 400, IN_CALL)),
        Ignored::LongPress
    );
}

#[test]
fn every_ignored_reason_has_an_explanation() {
    use Ignored::*;
    for w in [
        ButtonsOff,
        VendorNotAvailable,
        ThisActionIsOff,
        NotTheSelectedHeadset,
        Duplicate,
        NoChange,
        NothingToAnswer,
        NoCallToEnd,
        NeverDeclines,
        NoCallToControl,
        LongPress,
        NoPress,
        Pressed,
        Unsupported,
    ] {
        assert!(!w.explain().is_empty());
    }
}

// ----------------------------------------------------- the telephony usages

#[test]
fn only_the_standard_telephony_page_is_read() {
    assert_eq!(Usage::from_hid(0x0B, 0x20), Usage::HookSwitch);
    assert_eq!(Usage::from_hid(0x0B, 0x2F), Usage::PhoneMute);
    assert_eq!(Usage::from_hid(0x0B, 0x26), Usage::Drop);
    assert_eq!(Usage::from_hid(0x0B, 0x23), Usage::Hold);
    // The consumer page's play/pause (a call button on some Bluetooth headsets, a music key on others) is not
    // a telephony command and is left alone.
    assert!(matches!(Usage::from_hid(0x0C, 0xCD), Usage::Other { .. }));
    // A vendor page is never interpreted.
    assert!(matches!(Usage::from_hid(0xFF00, 0x20), Usage::Other { .. }));
}

#[test]
fn a_hid_product_is_matched_to_an_audio_device_by_name() {
    assert!(names_match("Jabra Evolve2 65", "Jabra Evolve2 65"));
    assert!(names_match("Jabra Evolve2 65", "jabra  evolve2 65 ms"));
    assert!(names_match(
        "Plantronics Blackwire 3220 Series",
        "Blackwire 3220 Series"
    ));
    assert!(!names_match("Jabra Evolve2 65", "MacBook Pro Microphone"));
    assert!(!names_match("", "Jabra"));
    assert!(
        !names_match("USB", "USB Audio"),
        "too short to mean anything"
    );
}
