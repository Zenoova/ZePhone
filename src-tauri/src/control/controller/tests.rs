//! The controller against a scripted telephony core: what it asks the engine, and — as important — what it does
//! not ask when the request has nothing to act on.

use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

use super::*;
use crate::control::{
    command::{AccountBrief, AppStatus},
    select::fixtures::call,
};
use crate::sip::types::CallState;

pub(crate) struct FakePhone {
    calls: Mutex<Vec<Call>>,
    /// Everything the engine was asked to do, in order.
    log: Mutex<Vec<String>>,
    running: AtomicBool,
    accounts: Mutex<Vec<AccountBrief>>,
    dnd: AtomicBool,
    /// The engine refuses with this message.
    refuse: Mutex<Option<String>>,
}

impl FakePhone {
    fn new(calls: Vec<Call>) -> Arc<Self> {
        Arc::new(Self {
            calls: Mutex::new(calls),
            log: Mutex::default(),
            running: AtomicBool::new(true),
            accounts: Mutex::new(vec![AccountBrief {
                id: "acc".into(),
                label: "Bureau".into(),
                is_default: true,
                connected: true,
            }]),
            dnd: AtomicBool::new(false),
            refuse: Mutex::default(),
        })
    }

    pub(crate) fn log(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }

    fn record(&self, what: String) -> AppResult<()> {
        if let Some(why) = self.refuse.lock().unwrap().clone() {
            return Err(AppError::Engine(why));
        }
        self.log.lock().unwrap().push(what);
        Ok(())
    }

    fn edit(&self, id: &str, f: impl FnOnce(&mut Call)) {
        if let Some(c) = self.calls.lock().unwrap().iter_mut().find(|c| c.id == id) {
            f(c);
        }
    }
}

#[async_trait]
impl Telephony for FakePhone {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn engine_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
    fn status(&self) -> AppResult<AppStatus> {
        Ok(AppStatus {
            engine_running: self.engine_running(),
            do_not_disturb: self.dnd.load(Ordering::SeqCst),
            accounts: self.accounts.lock().unwrap().clone(),
            calls: self.calls(),
        })
    }
    async fn dial(&self, target: &str, account: Option<&str>) -> AppResult<Call> {
        self.record(format!("dial {target} {}", account.unwrap_or("-")))?;
        let c = call("new", CallState::Initializing);
        self.calls.lock().unwrap().push(c.clone());
        Ok(c)
    }
    async fn answer(&self, id: &str) -> AppResult<()> {
        self.record(format!("answer {id}"))
    }
    async fn reject(&self, id: &str) -> AppResult<()> {
        self.record(format!("reject {id}"))
    }
    async fn hangup(&self, id: &str) -> AppResult<()> {
        self.record(format!("hangup {id}"))
    }
    async fn hold(&self, id: &str) -> AppResult<()> {
        self.record(format!("hold {id}"))?;
        self.edit(id, |c| c.held_locally = true);
        Ok(())
    }
    async fn resume(&self, id: &str) -> AppResult<()> {
        self.record(format!("resume {id}"))?;
        self.edit(id, |c| c.held_locally = false);
        Ok(())
    }
    async fn set_mute(&self, id: &str, muted: bool) -> AppResult<()> {
        // Let a concurrent request run in the middle, as a real engine round trip would.
        tokio::task::yield_now().await;
        self.record(format!("mute {id} {muted}"))?;
        tokio::task::yield_now().await;
        self.edit(id, |c| c.muted = muted);
        Ok(())
    }
    fn do_not_disturb(&self) -> AppResult<bool> {
        Ok(self.dnd.load(Ordering::SeqCst))
    }
    async fn set_do_not_disturb(&self, on: bool) -> AppResult<()> {
        self.record(format!("dnd {on}"))?;
        self.dnd.store(on, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct FakeShell {
    shown: Mutex<Vec<Option<Focus>>>,
}
impl Shell for FakeShell {
    fn show(&self, focus: Option<Focus>) {
        self.shown.lock().unwrap().push(focus);
    }
}

pub(crate) fn rig(calls: Vec<Call>) -> (Arc<Controller>, Arc<FakePhone>, Arc<FakeShell>) {
    let phone = FakePhone::new(calls);
    let shell = Arc::new(FakeShell::default());
    (Controller::new(phone.clone(), shell.clone()), phone, shell)
}

fn hangup() -> Command {
    Command::Hangup { call_id: None }
}
fn mute(muted: Option<bool>) -> Command {
    Command::Mute {
        call_id: None,
        muted,
    }
}
fn hold(held: Option<bool>) -> Command {
    Command::Hold {
        call_id: None,
        held,
    }
}
fn dial(t: &str) -> Command {
    Command::Dial {
        target: t.into(),
        account: None,
    }
}

// ----------------------------------------------------------- nothing to act on

#[tokio::test]
async fn a_command_without_a_matching_call_does_nothing_at_all() {
    let (c, phone, _) = rig(vec![]);
    for cmd in [
        Command::Answer { call_id: None },
        Command::Reject { call_id: None },
        hangup(),
        mute(None),
        mute(Some(true)),
        hold(None),
        hold(Some(false)),
    ] {
        let o = c.execute(cmd.clone()).await;
        assert_eq!(o.status, Status::Unavailable, "{cmd:?}");
        assert!(!o.changed);
    }
    assert!(
        phone.log().is_empty(),
        "the engine must not have been asked anything: {:?}",
        phone.log()
    );
}

#[tokio::test]
async fn answering_with_only_a_call_in_progress_touches_nothing() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    assert_eq!(
        c.execute(Command::Answer { call_id: None }).await.status,
        Status::Unavailable
    );
    assert_eq!(
        c.execute(Command::Reject { call_id: None }).await.status,
        Status::Unavailable
    );
    assert!(phone.log().is_empty());
}

#[tokio::test]
async fn hanging_up_never_declines_a_ringing_call() {
    let (c, phone, _) = rig(vec![call("in", CallState::Incoming)]);
    assert_eq!(c.execute(hangup()).await.status, Status::Unavailable);
    assert!(phone.log().is_empty());
}

#[tokio::test]
async fn an_unknown_call_is_reported_as_such() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    let o = c
        .execute(Command::Hangup {
            call_id: Some("zz".into()),
        })
        .await;
    assert_eq!(o.status, Status::NotFound);
    assert!(phone.log().is_empty());
}

// --------------------------------------------------------------- answer / reject

#[tokio::test]
async fn answers_and_declines_the_only_incoming_call_and_says_it_is_not_settled_yet() {
    let (c, phone, _) = rig(vec![call("in", CallState::Incoming)]);
    let o = c.execute(Command::Answer { call_id: None }).await;
    assert_eq!(o.status, Status::Ok);
    assert!(
        o.changed && !o.settled,
        "accepted, not yet answered by the engine"
    );
    let o = c.execute(Command::Reject { call_id: None }).await;
    assert!(o.is_ok());
    assert_eq!(phone.log(), ["answer in", "reject in"]);
}

#[tokio::test]
async fn two_incoming_calls_ask_for_a_choice_and_nothing_is_answered() {
    let (c, phone, _) = rig(vec![
        call("a", CallState::Incoming),
        call("b", CallState::Incoming),
    ]);
    let o = c.execute(Command::Answer { call_id: None }).await;
    assert_eq!(o.status, Status::Ambiguous);
    assert_eq!(o.candidates.len(), 2);
    assert!(phone.log().is_empty());
    let o = c
        .execute(Command::Answer {
            call_id: Some("b".into()),
        })
        .await;
    assert!(o.is_ok());
    assert_eq!(phone.log(), ["answer b"]);
}

// ----------------------------------------------------------------------- hangup

#[tokio::test]
async fn hangup_ends_one_call_never_all_of_them() {
    let (c, phone, _) = rig(vec![
        call("held", CallState::OnHold),
        call("live", CallState::Connected),
    ]);
    assert!(c.execute(hangup()).await.is_ok());
    assert_eq!(phone.log(), ["hangup live"], "only the active call");

    let (c, phone, _) = rig(vec![
        call("a", CallState::OnHold),
        call("b", CallState::OnHold),
    ]);
    let o = c.execute(hangup()).await;
    assert_eq!(o.status, Status::Ambiguous);
    assert!(
        phone.log().is_empty(),
        "two equal candidates: neither is hung up"
    );
    assert!(
        c.execute(Command::Hangup {
            call_id: Some("a".into())
        })
        .await
        .is_ok()
    );
    assert_eq!(phone.log(), ["hangup a"]);
}

#[tokio::test]
async fn hangup_can_cancel_a_call_that_is_still_ringing() {
    let (c, phone, _) = rig(vec![call("out", CallState::Ringing)]);
    assert!(c.execute(hangup()).await.is_ok());
    assert_eq!(phone.log(), ["hangup out"]);
}

// ------------------------------------------------------------------------- mute

#[tokio::test]
async fn mute_toggles_from_the_state_the_engine_confirmed() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    let o = c.execute(mute(None)).await;
    assert!(o.is_ok() && o.settled);
    assert!(o.call.unwrap().muted);
    let o = c.execute(mute(None)).await;
    assert!(!o.call.unwrap().muted);
    assert_eq!(phone.log(), ["mute a true", "mute a false"]);
}

#[tokio::test]
async fn an_explicit_mute_repeated_changes_nothing_more() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    assert!(c.execute(mute(Some(true))).await.changed);
    let again = c.execute(mute(Some(true))).await;
    assert!(again.is_ok() && !again.changed && again.settled);
    assert!(again.call.unwrap().muted);
    let off = c.execute(mute(Some(false))).await;
    assert!(off.changed);
    assert!(!c.execute(mute(Some(false))).await.changed);
    assert_eq!(
        phone.log(),
        ["mute a true", "mute a false"],
        "one engine request per real change"
    );
}

#[tokio::test]
async fn a_refused_mute_reports_the_state_that_is_really_in_effect() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    *phone.refuse.lock().unwrap() = Some("pas de réponse".into());
    let o = c.execute(mute(Some(true))).await;
    assert_eq!(o.status, Status::Failed);
    assert!(o.message.contains("pas de réponse"));
    assert!(
        !o.call.expect("the call as it is").muted,
        "still not muted: the engine said no"
    );
}

#[tokio::test]
async fn two_toggles_at_once_do_not_cancel_each_other_by_reading_the_same_state() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    let (x, y) = tokio::join!(c.execute(mute(None)), c.execute(mute(None)));
    assert!(x.is_ok() && y.is_ok());
    // Serialised: muted, then unmuted. Without that, both would read "not muted" and ask to mute.
    assert_eq!(phone.log(), ["mute a true", "mute a false"]);
}

#[tokio::test]
async fn mute_acts_on_the_active_call_not_the_held_one() {
    let (c, phone, _) = rig(vec![
        call("held", CallState::OnHold),
        call("live", CallState::Connected),
    ]);
    assert!(c.execute(mute(None)).await.is_ok());
    assert_eq!(phone.log(), ["mute live true"]);
}

// ------------------------------------------------------------------------- hold

#[tokio::test]
async fn hold_toggles_and_resumes_the_right_call() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    assert!(c.execute(hold(None)).await.call.unwrap().held_locally);
    assert!(!c.execute(hold(None)).await.call.unwrap().held_locally);
    assert_eq!(phone.log(), ["hold a", "resume a"]);
}

#[tokio::test]
async fn resume_picks_the_held_call_among_several() {
    let (c, phone, _) = rig(vec![
        call("live", CallState::Connected),
        call("held", CallState::OnHold),
    ]);
    assert!(c.execute(hold(Some(false))).await.is_ok());
    assert_eq!(
        phone.log(),
        ["resume held"],
        "not the call that is in progress"
    );
}

#[tokio::test]
async fn explicit_hold_states_are_idempotent() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    assert!(c.execute(hold(Some(true))).await.changed);
    assert!(!c.execute(hold(Some(true))).await.changed);
    assert!(c.execute(hold(Some(false))).await.changed);
    assert!(!c.execute(hold(Some(false))).await.changed);
    assert_eq!(phone.log(), ["hold a", "resume a"]);
}

#[tokio::test]
async fn nothing_can_be_held_while_the_call_is_only_ringing() {
    let (c, phone, _) = rig(vec![call("out", CallState::Ringing)]);
    assert_eq!(c.execute(hold(None)).await.status, Status::Unavailable);
    assert_eq!(c.execute(mute(None)).await.status, Status::Unavailable);
    assert!(phone.log().is_empty());
}

// ------------------------------------------------------------------------- dial

#[tokio::test]
async fn dials_with_the_rules_of_the_dialer() {
    let (c, phone, _) = rig(vec![]);
    let o = c.execute(dial("1002")).await;
    assert!(
        o.is_ok() && !o.settled,
        "accepted, the call is still being set up"
    );
    assert!(c.execute(dial("sip:bob@example.com")).await.is_ok());
    assert!(c.execute(dial("+33 1 23 45 67 89")).await.is_ok());
    assert_eq!(phone.log().len(), 3);
}

#[tokio::test]
async fn refuses_a_bad_target_before_asking_the_engine() {
    let (c, phone, _) = rig(vec![]);
    assert_eq!(c.execute(dial("   ")).await.status, Status::Invalid);
    assert_eq!(
        c.execute(dial("a b c; rm -rf /")).await.status,
        Status::Invalid
    );
    assert!(phone.log().is_empty());
}

#[tokio::test]
async fn dial_needs_a_connected_account_and_knows_which_one() {
    let (c, phone, _) = rig(vec![]);
    let with = |id: &str| Command::Dial {
        target: "1002".into(),
        account: Some(id.into()),
    };
    assert_eq!(c.execute(with("other")).await.status, Status::NotFound);
    phone.accounts.lock().unwrap()[0].connected = false;
    assert_eq!(c.execute(with("acc")).await.status, Status::Disconnected);
    assert_eq!(c.execute(dial("1002")).await.status, Status::Disconnected);
    assert!(phone.log().is_empty());
}

// ------------------------------------------------------------------ engine down

#[tokio::test]
async fn with_the_engine_down_calls_are_disconnected_but_the_window_still_opens() {
    let (c, phone, shell) = rig(vec![]);
    phone.running.store(false, Ordering::SeqCst);
    for cmd in [
        dial("1002"),
        hangup(),
        mute(None),
        Command::Answer { call_id: None },
    ] {
        assert_eq!(c.execute(cmd).await.status, Status::Disconnected);
    }
    assert!(c.execute(Command::ShowApp).await.is_ok());
    assert_eq!(shell.shown.lock().unwrap().len(), 1);
    assert!(c.execute(Command::Status).await.is_ok());
    assert!(phone.log().is_empty());
}

// -------------------------------------------------------------------------- DND

#[tokio::test]
async fn do_not_disturb_toggles_and_is_idempotent_when_explicit() {
    let (c, phone, _) = rig(vec![]);
    assert!(c.execute(Command::Dnd { enabled: None }).await.changed);
    assert!(phone.dnd.load(Ordering::SeqCst));
    assert!(
        !c.execute(Command::Dnd {
            enabled: Some(true)
        })
        .await
        .changed
    );
    assert!(
        c.execute(Command::Dnd {
            enabled: Some(false)
        })
        .await
        .changed
    );
    assert!(!phone.dnd.load(Ordering::SeqCst));
    assert_eq!(phone.log(), ["dnd true", "dnd false"]);
}

#[tokio::test]
async fn do_not_disturb_works_with_the_engine_down() {
    let (c, phone, _) = rig(vec![]);
    phone.running.store(false, Ordering::SeqCst);
    assert!(
        c.execute(Command::Dnd {
            enabled: Some(true)
        })
        .await
        .is_ok()
    );
}

// ----------------------------------------------------------------------- window

#[tokio::test]
async fn the_window_commands_say_where_to_go() {
    let (c, _, shell) = rig(vec![]);
    c.execute(Command::ShowApp).await;
    c.execute(Command::ShowDialer).await;
    c.execute(Command::ShowSearch).await;
    assert_eq!(
        *shell.shown.lock().unwrap(),
        [None, Some(Focus::Dialer), Some(Focus::Search)]
    );
}

// ----------------------------------------------------------------------- status

#[tokio::test]
async fn status_reads_and_changes_nothing() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    let o = c.execute(Command::Status).await;
    let app = o.app.expect("the status");
    assert!(app.engine_running && !app.do_not_disturb);
    assert_eq!(app.calls.len(), 1);
    assert!(!o.changed);
    assert!(phone.log().is_empty());
}

#[tokio::test]
async fn a_malformed_request_never_reaches_the_engine() {
    let (c, phone, _) = rig(vec![call("a", CallState::Connected)]);
    let o = c
        .execute(Command::Hangup {
            call_id: Some("a; drop".into()),
        })
        .await;
    assert_eq!(o.status, Status::Invalid);
    assert!(phone.log().is_empty());
}
