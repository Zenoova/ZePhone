//! The shortcut preferences and registrations against a scripted operating system.

use std::{collections::HashSet, sync::Mutex};

use super::*;

/// A system with a set of combinations other applications already hold.
#[derive(Default)]
struct FakeSystem {
    held_by_others: Mutex<HashSet<String>>,
    ours: Mutex<HashSet<String>>,
    next_id: Mutex<u32>,
    ids: Mutex<HashMap<String, u32>>,
}

impl FakeSystem {
    fn others_hold(&self, canonical: &str) {
        self.held_by_others.lock().unwrap().insert(canonical.into());
    }
    fn ours(&self) -> Vec<String> {
        let mut v: Vec<_> = self.ours.lock().unwrap().iter().cloned().collect();
        v.sort();
        v
    }
}

impl HotkeyBackend for FakeSystem {
    fn register(&self, canonical: &str) -> Result<u32, String> {
        if self.held_by_others.lock().unwrap().contains(canonical)
            || !self.ours.lock().unwrap().insert(canonical.to_owned())
        {
            return Err(format!("HotKey already registered: {canonical}"));
        }
        let mut ids = self.ids.lock().unwrap();
        let next = {
            let mut n = self.next_id.lock().unwrap();
            *n += 1;
            *n
        };
        Ok(*ids.entry(canonical.to_owned()).or_insert(next))
    }
    fn unregister(&self, canonical: &str) {
        self.ours.lock().unwrap().remove(canonical);
    }
}

fn rig() -> (Arc<ShortcutService>, Arc<FakeSystem>, Arc<Database>) {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let sys = Arc::new(FakeSystem::default());
    let svc = ShortcutService::with_platform(db.clone(), sys.clone(), true);
    svc.start();
    (svc, sys, db)
}

fn item(v: &ShortcutsView, a: ShortcutAction) -> &ShortcutView {
    v.items.iter().find(|i| i.action == a).unwrap()
}

fn id_of(sys: &FakeSystem, canonical: &str) -> u32 {
    *sys.ids.lock().unwrap().get(canonical).unwrap()
}

#[test]
fn the_defaults_are_all_registered_and_all_different() {
    let (svc, sys, _) = rig();
    let v = svc.view();
    assert_eq!(v.items.len(), ShortcutAction::ALL.len());
    assert!(
        v.items
            .iter()
            .all(|i| i.status == BindingStatus::Active && i.is_default)
    );
    assert_eq!(
        sys.ours().len(),
        ShortcutAction::ALL.len(),
        "one registration each"
    );
    // No default is a bare key, and none is reserved: they all pass the same checks as a user's choice.
    for a in ShortcutAction::ALL {
        Accelerator::parse_for(a.default_accelerator(), true).unwrap();
        Accelerator::parse_for(a.default_accelerator(), false).unwrap();
    }
}

#[test]
fn a_combination_the_system_refuses_is_saved_but_shown_as_not_active() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    let sys = Arc::new(FakeSystem::default());
    sys.others_hold("CommandOrControl+Alt+Shift+M");
    let svc = ShortcutService::with_platform(db, sys.clone(), true);
    svc.start();
    let v = svc.view();
    let mute = item(&v, ShortcutAction::ToggleMute);
    assert_eq!(
        mute.accelerator.as_deref(),
        Some("CommandOrControl+Alt+Shift+M"),
        "kept"
    );
    let BindingStatus::Failed { message } = &mute.status else {
        panic!("must be failed: {:?}", mute.status)
    };
    assert!(
        message.contains("Déjà utilisée par une autre application"),
        "{message}"
    );
    // The others are not affected.
    assert_eq!(
        item(&v, ShortcutAction::Hangup).status,
        BindingStatus::Active
    );
}

#[test]
fn changing_a_combination_frees_the_old_one_and_takes_the_new_one() {
    let (svc, sys, _) = rig();
    let old = "CommandOrControl+Alt+Shift+H";
    assert!(sys.ours().contains(&old.to_owned()));
    let v = svc
        .set(ShortcutAction::Hangup, Some("Control+Alt+Super+J"), true)
        .unwrap();
    assert_eq!(
        item(&v, ShortcutAction::Hangup).status,
        BindingStatus::Active
    );
    assert!(
        !sys.ours().contains(&old.to_owned()),
        "the old combination is free again"
    );
    assert!(sys.ours().contains(&"Control+Alt+Super+J".to_owned()));
    // Another application can now take the old one, and a third change still works.
    assert!(sys.register(old).is_ok());
}

#[test]
fn disabling_or_removing_frees_the_combination_but_keeps_what_the_user_set() {
    let (svc, sys, _) = rig();
    let acc = "CommandOrControl+Alt+Shift+M";
    let v = svc
        .set(ShortcutAction::ToggleMute, Some(acc), false)
        .unwrap();
    let i = item(&v, ShortcutAction::ToggleMute);
    assert_eq!(i.status, BindingStatus::Disabled);
    assert_eq!(
        i.accelerator.as_deref(),
        Some(acc),
        "the combination is kept for later"
    );
    assert!(!sys.ours().contains(&acc.to_owned()));
    let v = svc
        .set(ShortcutAction::ToggleMute, Some(acc), true)
        .unwrap();
    assert_eq!(
        item(&v, ShortcutAction::ToggleMute).status,
        BindingStatus::Active
    );
    let v = svc.set(ShortcutAction::ToggleMute, None, true).unwrap();
    assert_eq!(
        item(&v, ShortcutAction::ToggleMute).status,
        BindingStatus::Unassigned
    );
    assert!(!sys.ours().contains(&acc.to_owned()));
}

#[test]
fn two_actions_cannot_share_a_combination_whatever_the_spelling() {
    let (svc, _, _) = rig();
    let e = svc
        .set(ShortcutAction::Hangup, Some("cmd+option+shift+a"), true)
        .unwrap_err()
        .to_string();
    assert!(e.contains("Décrocher"), "names the action that has it: {e}");
    // Nothing changed.
    assert_eq!(
        item(&svc.view(), ShortcutAction::Hangup)
            .accelerator
            .as_deref(),
        Some("CommandOrControl+Alt+Shift+H")
    );
    // The action's own combination is not a duplicate of itself.
    assert!(
        svc.set(
            ShortcutAction::Answer,
            Some("CommandOrControl+Alt+Shift+A"),
            true
        )
        .is_ok()
    );
}

#[test]
fn unusable_combinations_are_refused_with_a_reason_and_change_nothing() {
    let (svc, _, db) = rig();
    for bad in [
        "A",
        "Shift+A",
        "Alt+E",
        "Cmd+Q",
        "Cmd+Tab",
        "Ctrl+Banana",
        "",
    ] {
        let e = svc
            .set(ShortcutAction::Hangup, Some(bad), true)
            .unwrap_err();
        assert_eq!(e.kind(), "validation", "{bad:?}");
        assert!(!e.to_string().is_empty());
    }
    assert_eq!(db.get_shortcut_prefs().unwrap(), Prefs::default());
}

#[test]
fn preferences_survive_a_restart() {
    let db = Arc::new(Database::open_in_memory().unwrap());
    {
        let svc = ShortcutService::with_platform(db.clone(), Arc::new(FakeSystem::default()), true);
        svc.start();
        svc.set(ShortcutAction::Hangup, Some("Control+Alt+Super+J"), true)
            .unwrap();
        svc.set(
            ShortcutAction::ToggleDnd,
            Some("CommandOrControl+Alt+Shift+Z"),
            false,
        )
        .unwrap();
        svc.set_master(true).unwrap();
    }
    // A new process: new service, same database, a fresh system.
    let sys = Arc::new(FakeSystem::default());
    let svc = ShortcutService::with_platform(db, sys.clone(), true);
    svc.start();
    let v = svc.view();
    assert_eq!(
        item(&v, ShortcutAction::Hangup).accelerator.as_deref(),
        Some("Control+Alt+Super+J")
    );
    assert_eq!(
        item(&v, ShortcutAction::Hangup).status,
        BindingStatus::Active
    );
    assert_eq!(
        item(&v, ShortcutAction::ToggleDnd).status,
        BindingStatus::Disabled
    );
    assert!(
        sys.ours().contains(&"Control+Alt+Super+J".to_owned()),
        "registered again at launch"
    );
}

#[test]
fn the_master_switch_frees_everything_and_back() {
    let (svc, sys, _) = rig();
    let v = svc.set_master(false).unwrap();
    assert!(!v.enabled && sys.ours().is_empty());
    assert!(v.items.iter().all(|i| i.status == BindingStatus::Disabled));
    let v = svc.set_master(true).unwrap();
    assert!(v.items.iter().all(|i| i.status == BindingStatus::Active));
    assert_eq!(sys.ours().len(), ShortcutAction::ALL.len());
}

#[test]
fn reset_restores_the_defaults_for_one_action_or_all() {
    let (svc, _, _) = rig();
    svc.set(ShortcutAction::Hangup, Some("Control+Alt+Super+J"), false)
        .unwrap();
    svc.set(ShortcutAction::Answer, None, true).unwrap();
    let v = svc.reset(Some(ShortcutAction::Hangup)).unwrap();
    let h = item(&v, ShortcutAction::Hangup);
    assert!(h.is_default && h.status == BindingStatus::Active);
    assert_eq!(
        item(&v, ShortcutAction::Answer).status,
        BindingStatus::Unassigned,
        "only that one"
    );
    let v = svc.reset(None).unwrap();
    assert!(
        v.items
            .iter()
            .all(|i| i.is_default && i.status == BindingStatus::Active)
    );
}

#[test]
fn resetting_one_action_cannot_steal_a_combination_now_used_elsewhere() {
    let (svc, _, _) = rig();
    svc.set(ShortcutAction::Hangup, Some("Control+Alt+Super+J"), true)
        .unwrap();
    // "Answer" takes Hangup's default combination…
    svc.set(
        ShortcutAction::Answer,
        Some("CommandOrControl+Alt+Shift+H"),
        true,
    )
    .unwrap();
    // …so resetting Hangup to it would make two actions share it.
    assert!(svc.reset(Some(ShortcutAction::Hangup)).is_err());
}

#[test]
fn while_recording_a_combination_nothing_is_registered_and_nothing_runs() {
    let (svc, sys, _) = rig();
    let id = id_of(&sys, "CommandOrControl+Alt+Shift+H");
    let t0 = Instant::now();
    assert_eq!(svc.on_event(id, true, t0), Some(ShortcutAction::Hangup));
    svc.on_event(id, false, t0);

    let v = svc.set_capture(true);
    assert!(v.capturing && sys.ours().is_empty());
    assert!(v.items.iter().all(|i| i.status == BindingStatus::Suspended));
    let later = t0 + Duration::from_secs(5);
    assert_eq!(
        svc.on_event(id, true, later),
        None,
        "the press is ignored while recording"
    );

    let v = svc.set_capture(false);
    assert!(!v.capturing && sys.ours().len() == ShortcutAction::ALL.len());
    assert!(v.items.iter().all(|i| i.status == BindingStatus::Active));
}

#[test]
fn a_held_key_fires_once_and_the_next_press_waits_for_the_release() {
    let (svc, sys, _) = rig();
    let id = id_of(&sys, "CommandOrControl+Alt+Shift+M");
    let t = Instant::now();
    let ms = Duration::from_millis;
    assert_eq!(svc.on_event(id, true, t), Some(ShortcutAction::ToggleMute));
    // The key stays down: the system repeats the press every ~30 ms for two seconds.
    for n in 1..=60 {
        assert_eq!(svc.on_event(id, true, t + ms(30 * n)), None, "repeat {n}");
    }
    // Released, then pressed again a moment later: one more action.
    svc.on_event(id, false, t + ms(2000));
    assert_eq!(
        svc.on_event(id, true, t + ms(2400)),
        Some(ShortcutAction::ToggleMute)
    );
}

#[test]
fn two_quick_presses_do_not_make_two_actions() {
    let (svc, sys, _) = rig();
    let id = id_of(&sys, "CommandOrControl+Alt+Shift+M");
    let t = Instant::now();
    assert!(svc.on_event(id, true, t).is_some());
    svc.on_event(id, false, t + Duration::from_millis(40));
    assert_eq!(
        svc.on_event(id, true, t + Duration::from_millis(80)),
        None,
        "too soon: a bounce"
    );
    svc.on_event(id, false, t + Duration::from_millis(120));
    assert!(
        svc.on_event(id, true, t + Duration::from_millis(400))
            .is_some()
    );
}

#[test]
fn a_lost_release_does_not_lock_the_shortcut_forever() {
    let (svc, sys, _) = rig();
    let id = id_of(&sys, "CommandOrControl+Alt+Shift+M");
    let t = Instant::now();
    assert!(svc.on_event(id, true, t).is_some());
    // No release is ever reported (some systems do not). Quiet for three seconds, then pressed again.
    assert!(svc.on_event(id, true, t + Duration::from_secs(3)).is_some());
}

#[test]
fn each_action_has_its_own_repeat_state_and_unknown_ids_do_nothing() {
    let (svc, sys, _) = rig();
    let mute = id_of(&sys, "CommandOrControl+Alt+Shift+M");
    let hold = id_of(&sys, "CommandOrControl+Alt+Shift+P");
    let t = Instant::now();
    assert!(svc.on_event(mute, true, t).is_some());
    assert!(
        svc.on_event(hold, true, t + Duration::from_millis(10))
            .is_some()
    );
    assert_eq!(svc.on_event(9999, true, t), None);
}

#[test]
fn a_disabled_shortcut_does_nothing_even_if_the_system_still_reports_it() {
    let (svc, sys, _) = rig();
    let acc = "CommandOrControl+Alt+Shift+M";
    let id = id_of(&sys, acc);
    svc.set(ShortcutAction::ToggleMute, Some(acc), false)
        .unwrap();
    assert_eq!(svc.on_event(id, true, Instant::now()), None);
}

#[test]
fn every_action_asks_for_the_matching_command_and_never_for_everything() {
    use crate::control::command::Command as C;
    assert_eq!(
        ShortcutAction::Hangup.command(),
        C::Hangup { call_id: None }
    );
    assert_eq!(
        ShortcutAction::ToggleMute.command(),
        C::Mute {
            call_id: None,
            muted: None
        }
    );
    assert_eq!(
        ShortcutAction::ToggleDnd.command(),
        C::Dnd { enabled: None }
    );
    for a in ShortcutAction::ALL {
        a.command().validate().unwrap();
    }
}

#[test]
fn old_or_odd_stored_preferences_are_put_right() {
    let db = Database::open_in_memory().unwrap();
    db.set_setting_text(
        STORE_KEY,
        r#"{"bindings":[{"action":"hangup","accelerator":"Control+Alt+Super+J"},{"action":"hangup","accelerator":"X"}]}"#,
    )
    .unwrap();
    let p = db.get_shortcut_prefs().unwrap();
    assert_eq!(
        p.bindings.len(),
        ShortcutAction::ALL.len(),
        "missing actions come back with their defaults"
    );
    assert!(p.enabled);
    assert_eq!(
        p.binding(ShortcutAction::Hangup).accelerator.as_deref(),
        Some("Control+Alt+Super+J")
    );
    db.set_setting_text(STORE_KEY, "{broken").unwrap();
    assert_eq!(db.get_shortcut_prefs().unwrap(), Prefs::default());
}
