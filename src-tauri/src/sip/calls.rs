//! Call state machine. Pure (time is passed in), driven by engine events and by
//! the user's own intents (hangup / reject), and producing the history entry when
//! a call ends.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{
    diagnostics::{describe_engine_reason, describe_sip_code},
    engine::{CallEvent, CallRef},
    types::{Call, CallDirection, CallResult, CallState, HistoryEntry},
    uri,
};

/// Local context the tracker cannot know by itself, supplied by the manager.
#[derive(Debug, Clone, Default)]
pub struct CallContext {
    pub account_id: Option<String>,
    pub account_label: Option<String>,
    /// Name from the address book, if the number matches a contact.
    pub contact_name: Option<String>,
}

#[derive(Debug, Clone)]
struct Tracked {
    call: Call,
    contact_name: Option<String>,
    user_hangup: bool,
    user_reject: bool,
    answered_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

/// What a state change produced.
#[derive(Debug, Clone, PartialEq)]
pub struct CallUpdate {
    pub call: Call,
    /// `true` the first time this call is seen as incoming (to ring / notify).
    pub is_new_incoming: bool,
    /// Present when the call just ended: the entry to persist.
    pub history: Option<HistoryEntry>,
}

#[derive(Debug, Default)]
pub struct CallTracker {
    calls: HashMap<String, Tracked>,
}

fn rfc(t: DateTime<Utc>) -> String {
    t.to_rfc3339()
}

impl Tracked {
    /// Connected <-> OnHold according to who holds the call.
    fn recompute_hold(&mut self) {
        if matches!(self.call.state, CallState::Connected | CallState::OnHold) {
            self.call.state = if self.call.held_locally || self.call.held_remotely {
                CallState::OnHold
            } else {
                CallState::Connected
            };
        }
    }
}

impl CallTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, id: &str) -> Option<&Call> {
        self.calls.get(id).map(|t| &t.call)
    }

    pub fn active(&self) -> Vec<Call> {
        let mut v: Vec<Call> = self.calls.values().map(|t| t.call.clone()).collect();
        v.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        v
    }

    fn ensure(
        &mut self,
        r: &CallRef,
        ctx: &CallContext,
        now: DateTime<Utc>,
        initial: CallState,
    ) -> &mut Tracked {
        self.calls.entry(r.id.clone()).or_insert_with(|| {
            let number = uri::user_part(&r.peer_uri);
            let remote_name = ctx
                .contact_name
                .clone()
                .or_else(|| r.peer_name.clone().filter(|n| !n.trim().is_empty()));
            Tracked {
                call: Call {
                    id: r.id.clone(),
                    account_id: ctx.account_id.clone(),
                    account_label: ctx.account_label.clone(),
                    direction: r.direction,
                    state: initial,
                    remote_uri: r.peer_uri.clone(),
                    remote_number: number,
                    remote_name,
                    muted: false,
                    held_locally: false,
                    held_remotely: false,
                    created_at: rfc(now),
                    connected_at: None,
                    ended_at: None,
                    duration_secs: 0,
                    sip_code: None,
                    reason: None,
                },
                contact_name: ctx.contact_name.clone(),
                user_hangup: false,
                user_reject: false,
                answered_at: None,
                created_at: now,
            }
        })
    }

    /// The user asked to place a call and the engine returned its id. The
    /// engine's own `Outgoing` event may already have created it.
    pub fn register_outgoing(
        &mut self,
        r: &CallRef,
        ctx: &CallContext,
        now: DateTime<Utc>,
    ) -> Call {
        self.ensure(r, ctx, now, CallState::Initializing)
            .call
            .clone()
    }

    pub fn mark_user_hangup(&mut self, id: &str) {
        if let Some(t) = self.calls.get_mut(id) {
            t.user_hangup = true;
        }
    }

    pub fn mark_user_reject(&mut self, id: &str) {
        if let Some(t) = self.calls.get_mut(id) {
            t.user_reject = true;
            t.user_hangup = true;
        }
    }

    /// The user put the call on hold / resumed it (the engine does not report our own holds).
    pub fn set_local_hold(&mut self, id: &str, held: bool) -> Option<Call> {
        let t = self.calls.get_mut(id)?;
        if t.call.held_locally == held {
            return None;
        }
        t.call.held_locally = held;
        t.recompute_hold();
        Some(t.call.clone())
    }

    /// Baresip puts the other calls on hold when a new one becomes active
    /// (`call_hold_other_calls yes`) without telling us: mirror that.
    pub fn hold_others(&mut self, active_id: &str) -> Vec<Call> {
        let mut changed = vec![];
        for (id, t) in self.calls.iter_mut() {
            if id != active_id && t.call.state == CallState::Connected && !t.call.held_locally {
                t.call.held_locally = true;
                t.recompute_hold();
                changed.push(t.call.clone());
            }
        }
        changed
    }

    pub fn set_muted(&mut self, id: &str, muted: bool) -> Option<Call> {
        let t = self.calls.get_mut(id)?;
        t.call.muted = muted;
        Some(t.call.clone())
    }

    /// Applies an engine call event. Returns `None` for events that change nothing visible.
    pub fn apply(
        &mut self,
        r: &CallRef,
        event: &CallEvent,
        ctx: &CallContext,
        now: DateTime<Utc>,
    ) -> Option<CallUpdate> {
        match event {
            CallEvent::Incoming => {
                let is_new = !self.calls.contains_key(&r.id);
                let t = self.ensure(r, ctx, now, CallState::Incoming);
                Some(CallUpdate {
                    call: t.call.clone(),
                    is_new_incoming: is_new,
                    history: None,
                })
            }
            CallEvent::Outgoing => {
                let t = self.ensure(r, ctx, now, CallState::Dialing);
                if t.call.state == CallState::Initializing {
                    t.call.state = CallState::Dialing;
                }
                Some(plain(t))
            }
            CallEvent::Ringing => {
                let t = self.calls.get_mut(&r.id)?;
                if matches!(
                    t.call.state,
                    CallState::Initializing | CallState::Dialing | CallState::Ringing
                ) {
                    t.call.state = CallState::Ringing;
                    Some(plain(t))
                } else {
                    None
                }
            }
            CallEvent::Established => {
                let t = self.ensure(r, ctx, now, CallState::Connected);
                if t.call.connected_at.is_none() {
                    t.answered_at = Some(now);
                    t.call.connected_at = Some(rfc(now));
                }
                t.call.state = CallState::Connected;
                Some(plain(t))
            }
            // Baresip only emits these when the *remote* party holds / resumes the call.
            CallEvent::Hold => {
                let t = self.calls.get_mut(&r.id)?;
                if !matches!(t.call.state, CallState::Connected | CallState::OnHold)
                    || t.call.held_remotely
                {
                    return None;
                }
                t.call.held_remotely = true;
                t.recompute_hold();
                Some(plain(t))
            }
            CallEvent::Resume => {
                let t = self.calls.get_mut(&r.id)?;
                if !t.call.held_remotely {
                    return None;
                }
                t.call.held_remotely = false;
                t.recompute_hold();
                Some(plain(t))
            }
            CallEvent::Closed { code, reason } => self.close(r, *code, reason, now),
            CallEvent::TransferFailed { .. } | CallEvent::Dtmf { .. } => None,
        }
    }

    fn close(
        &mut self,
        r: &CallRef,
        code: Option<u16>,
        reason: &str,
        now: DateTime<Utc>,
    ) -> Option<CallUpdate> {
        let mut t = self.calls.remove(&r.id)?;
        let connected = t.answered_at.is_some();
        let duration = t
            .answered_at
            .map(|a| (now - a).num_seconds().max(0) as u64)
            .unwrap_or(0);

        let (result, state) = if connected {
            (CallResult::Answered, CallState::Ended)
        } else {
            match t.call.direction {
                CallDirection::Incoming if t.user_reject => {
                    (CallResult::Rejected, CallState::Ended)
                }
                CallDirection::Incoming => (CallResult::Missed, CallState::Ended),
                CallDirection::Outgoing if t.user_hangup => {
                    (CallResult::Cancelled, CallState::Ended)
                }
                CallDirection::Outgoing => (CallResult::Failed, CallState::Failed),
            }
        };

        // Human-friendly reason for failures; keep the raw text otherwise.
        let friendly = match (result, code) {
            (CallResult::Failed, Some(c)) => Some(describe_sip_code(c).to_owned()),
            (CallResult::Failed, None) if !reason.is_empty() => {
                Some(describe_engine_reason(reason))
            }
            (CallResult::Failed, None) => Some("Appel non abouti".to_owned()),
            _ => (!reason.is_empty()).then(|| reason.to_owned()),
        };

        t.call.state = state;
        t.call.ended_at = Some(rfc(now));
        t.call.duration_secs = duration;
        t.call.sip_code = code;
        t.call.reason = friendly.clone();

        let history = HistoryEntry {
            id: Uuid::new_v4().to_string(),
            account_id: t.call.account_id.clone(),
            account_label: t.call.account_label.clone(),
            remote_uri: t.call.remote_uri.clone(),
            remote_number: t.call.remote_number.clone(),
            contact_name: t
                .contact_name
                .clone()
                .or_else(|| t.call.remote_name.clone()),
            direction: t.call.direction,
            result,
            started_at: rfc(t.created_at),
            answered_at: t.call.connected_at.clone(),
            ended_at: rfc(now),
            duration_secs: duration,
            sip_code: code,
            reason: friendly,
        };
        Some(CallUpdate {
            call: t.call,
            is_new_incoming: false,
            history: Some(history),
        })
    }

    /// The engine died: every live call is over. Returns their final updates.
    pub fn abort_all(&mut self, reason: &str, now: DateTime<Utc>) -> Vec<CallUpdate> {
        let ids: Vec<(String, CallRef)> = self
            .calls
            .values()
            .map(|t| {
                (
                    t.call.id.clone(),
                    CallRef {
                        id: t.call.id.clone(),
                        aor: String::new(),
                        direction: t.call.direction,
                        peer_uri: t.call.remote_uri.clone(),
                        peer_name: None,
                    },
                )
            })
            .collect();
        ids.into_iter()
            .filter_map(|(_, r)| {
                // A connected call interrupted by an engine crash still counts as answered.
                self.close(&r, None, reason, now)
            })
            .collect()
    }
}

fn plain(t: &Tracked) -> CallUpdate {
    CallUpdate {
        call: t.call.clone(),
        is_new_incoming: false,
        history: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn t0() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn cref(id: &str, dir: CallDirection) -> CallRef {
        CallRef {
            id: id.into(),
            aor: "sip:1001@pbx".into(),
            direction: dir,
            peer_uri: "sip:1002@pbx".into(),
            peer_name: Some("Bob".into()),
        }
    }

    fn ctx() -> CallContext {
        CallContext {
            account_id: Some("acc1".into()),
            account_label: Some("Bureau".into()),
            contact_name: None,
        }
    }

    #[test]
    fn outgoing_answered_call_lifecycle_and_duration() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        let u = tr.register_outgoing(&r, &ctx(), t0());
        assert_eq!(u.state, CallState::Initializing);
        assert_eq!(
            tr.apply(&r, &CallEvent::Outgoing, &ctx(), t0())
                .unwrap()
                .call
                .state,
            CallState::Dialing
        );
        assert_eq!(
            tr.apply(&r, &CallEvent::Ringing, &ctx(), t0())
                .unwrap()
                .call
                .state,
            CallState::Ringing
        );
        let c = tr
            .apply(
                &r,
                &CallEvent::Established,
                &ctx(),
                t0() + Duration::seconds(3),
            )
            .unwrap()
            .call;
        assert_eq!(c.state, CallState::Connected);
        assert!(c.connected_at.is_some());
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: None,
                    reason: String::new(),
                },
                &ctx(),
                t0() + Duration::seconds(65),
            )
            .unwrap();
        assert_eq!(end.call.state, CallState::Ended);
        assert_eq!(end.call.duration_secs, 62);
        let h = end.history.unwrap();
        assert_eq!(h.result, CallResult::Answered);
        assert_eq!(h.direction, CallDirection::Outgoing);
        assert_eq!(h.duration_secs, 62);
        assert_eq!(h.remote_number, "1002");
        assert_eq!(h.account_id.as_deref(), Some("acc1"));
        assert_eq!(h.contact_name.as_deref(), Some("Bob"));
        assert!(tr.get("c1").is_none(), "ended calls leave the active set");
    }

    #[test]
    fn events_may_arrive_before_the_dial_command_returns() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        // CALL_OUTGOING is emitted while `dial` is still executing.
        let u = tr.apply(&r, &CallEvent::Outgoing, &ctx(), t0()).unwrap();
        assert_eq!(u.call.state, CallState::Dialing);
        // Then dial() returns: must not reset the state back to Initializing.
        let c = tr.register_outgoing(&r, &ctx(), t0());
        assert_eq!(c.state, CallState::Dialing);
    }

    #[test]
    fn hold_and_resume_only_from_the_right_states() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        tr.apply(&r, &CallEvent::Outgoing, &ctx(), t0());
        assert!(
            tr.apply(&r, &CallEvent::Hold, &ctx(), t0()).is_none(),
            "cannot hold before connect"
        );
        tr.apply(&r, &CallEvent::Established, &ctx(), t0());
        assert_eq!(
            tr.apply(&r, &CallEvent::Hold, &ctx(), t0())
                .unwrap()
                .call
                .state,
            CallState::OnHold
        );
        assert!(tr.apply(&r, &CallEvent::Hold, &ctx(), t0()).is_none());
        assert_eq!(
            tr.apply(&r, &CallEvent::Resume, &ctx(), t0())
                .unwrap()
                .call
                .state,
            CallState::Connected
        );
    }

    #[test]
    fn local_and_remote_holds_are_tracked_independently() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        tr.apply(&r, &CallEvent::Established, &ctx(), t0());
        // We hold: Baresip stays silent, the manager tells the tracker.
        let c = tr.set_local_hold("c1", true).unwrap();
        assert_eq!(
            (c.state, c.held_locally, c.held_remotely),
            (CallState::OnHold, true, false)
        );
        assert!(
            tr.set_local_hold("c1", true).is_none(),
            "no change, no update"
        );
        // The remote also holds: still on hold even after we resume.
        assert!(
            tr.apply(&r, &CallEvent::Hold, &ctx(), t0())
                .unwrap()
                .call
                .held_remotely
        );
        assert_eq!(
            tr.set_local_hold("c1", false).unwrap().state,
            CallState::OnHold
        );
        let c = tr.apply(&r, &CallEvent::Resume, &ctx(), t0()).unwrap().call;
        assert_eq!((c.state, c.held_remotely), (CallState::Connected, false));
        assert!(tr.apply(&r, &CallEvent::Resume, &ctx(), t0()).is_none());
    }

    #[test]
    fn a_second_active_call_holds_the_first_like_baresip_does() {
        let mut tr = CallTracker::new();
        let a = cref("a", CallDirection::Outgoing);
        let b = cref("b", CallDirection::Incoming);
        tr.apply(&a, &CallEvent::Established, &ctx(), t0());
        tr.apply(&b, &CallEvent::Established, &ctx(), t0());
        let changed = tr.hold_others("b");
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].id, "a");
        assert_eq!(tr.get("a").unwrap().state, CallState::OnHold);
        assert_eq!(tr.get("b").unwrap().state, CallState::Connected);
        assert!(tr.hold_others("b").is_empty(), "idempotent");
    }

    #[test]
    fn answered_call_ended_while_on_hold_is_still_answered() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Incoming);
        tr.apply(&r, &CallEvent::Incoming, &ctx(), t0());
        tr.apply(&r, &CallEvent::Established, &ctx(), t0());
        tr.apply(&r, &CallEvent::Hold, &ctx(), t0());
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: None,
                    reason: String::new(),
                },
                &ctx(),
                t0() + Duration::seconds(10),
            )
            .unwrap();
        assert_eq!(end.history.unwrap().result, CallResult::Answered);
    }

    #[test]
    fn incoming_flag_is_set_only_once() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Incoming);
        assert!(
            tr.apply(&r, &CallEvent::Incoming, &ctx(), t0())
                .unwrap()
                .is_new_incoming
        );
        assert!(
            !tr.apply(&r, &CallEvent::Incoming, &ctx(), t0())
                .unwrap()
                .is_new_incoming
        );
    }

    #[test]
    fn unanswered_incoming_call_is_missed() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Incoming);
        tr.apply(&r, &CallEvent::Incoming, &ctx(), t0());
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: Some(487),
                    reason: "Request Terminated".into(),
                },
                &ctx(),
                t0() + Duration::seconds(8),
            )
            .unwrap();
        let h = end.history.unwrap();
        assert_eq!(h.result, CallResult::Missed);
        assert_eq!(end.call.state, CallState::Ended);
        assert_eq!(h.duration_secs, 0);
    }

    #[test]
    fn declined_incoming_call_is_rejected_not_missed() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Incoming);
        tr.apply(&r, &CallEvent::Incoming, &ctx(), t0());
        tr.mark_user_reject("c1");
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: None,
                    reason: "Rejected by user".into(),
                },
                &ctx(),
                t0(),
            )
            .unwrap();
        assert_eq!(end.history.unwrap().result, CallResult::Rejected);
    }

    #[test]
    fn outgoing_cancelled_by_the_user() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        tr.apply(&r, &CallEvent::Outgoing, &ctx(), t0());
        tr.mark_user_hangup("c1");
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: Some(487),
                    reason: "Request Terminated".into(),
                },
                &ctx(),
                t0(),
            )
            .unwrap();
        assert_eq!(end.history.unwrap().result, CallResult::Cancelled);
        assert_eq!(end.call.state, CallState::Ended);
    }

    #[test]
    fn outgoing_refused_by_the_remote_is_a_failure_with_diagnostics() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        tr.apply(&r, &CallEvent::Outgoing, &ctx(), t0());
        tr.apply(&r, &CallEvent::Ringing, &ctx(), t0());
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: Some(486),
                    reason: "Busy Here".into(),
                },
                &ctx(),
                t0(),
            )
            .unwrap();
        assert_eq!(end.call.state, CallState::Failed);
        assert_eq!(end.call.sip_code, Some(486));
        let h = end.history.unwrap();
        assert_eq!(h.result, CallResult::Failed);
        assert!(h.reason.unwrap().contains("486"));
    }

    #[test]
    fn network_failure_without_code_is_a_failure() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        tr.apply(&r, &CallEvent::Outgoing, &ctx(), t0());
        let end = tr
            .apply(
                &r,
                &CallEvent::Closed {
                    code: None,
                    reason: "Connection timed out".into(),
                },
                &ctx(),
                t0(),
            )
            .unwrap();
        assert_eq!(end.history.unwrap().result, CallResult::Failed);
        assert!(end.call.reason.unwrap().contains("délai dépassé"));
    }

    #[test]
    fn contact_name_takes_priority_over_the_display_name_sent_by_the_peer() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Incoming);
        let c = CallContext {
            contact_name: Some("Robert Dupont".into()),
            ..ctx()
        };
        let u = tr.apply(&r, &CallEvent::Incoming, &c, t0()).unwrap();
        assert_eq!(u.call.remote_name.as_deref(), Some("Robert Dupont"));
    }

    #[test]
    fn mute_flag_is_tracked() {
        let mut tr = CallTracker::new();
        let r = cref("c1", CallDirection::Outgoing);
        tr.apply(&r, &CallEvent::Established, &ctx(), t0());
        assert!(tr.set_muted("c1", true).unwrap().muted);
        assert!(!tr.set_muted("c1", false).unwrap().muted);
        assert!(tr.set_muted("nope", true).is_none());
    }

    #[test]
    fn closing_an_unknown_call_is_ignored() {
        let mut tr = CallTracker::new();
        let r = cref("ghost", CallDirection::Outgoing);
        assert!(
            tr.apply(
                &r,
                &CallEvent::Closed {
                    code: None,
                    reason: String::new()
                },
                &ctx(),
                t0()
            )
            .is_none()
        );
    }

    #[test]
    fn engine_crash_ends_every_call() {
        let mut tr = CallTracker::new();
        let a = cref("a", CallDirection::Outgoing);
        let b = cref("b", CallDirection::Incoming);
        tr.apply(&a, &CallEvent::Established, &ctx(), t0());
        tr.apply(&b, &CallEvent::Incoming, &ctx(), t0());
        let mut ended = tr.abort_all("engine died", t0() + Duration::seconds(5));
        ended.sort_by(|x, y| x.call.id.cmp(&y.call.id));
        assert_eq!(ended.len(), 2);
        assert_eq!(
            ended[0].history.as_ref().unwrap().result,
            CallResult::Answered
        );
        assert_eq!(
            ended[1].history.as_ref().unwrap().result,
            CallResult::Missed
        );
        assert!(tr.active().is_empty());
    }
}
