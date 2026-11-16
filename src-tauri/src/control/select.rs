//! Which call does a request without an identifier mean? One rule, written down once.
//!
//! * A request may always name its call (`call_id`): that call, or an error if it does not exist or cannot take
//!   the action. The rule below is never applied then.
//! * Without an identifier, the candidates are the calls that can take the action.
//!   - none: nothing to do (`Unavailable`), and nothing is done;
//!   - one: that one;
//!   - several: the **active** one, if exactly one of them is not on hold (for putting a call on hold, hanging
//!     up or muting) — or the held one, if exactly one is (for resuming). Otherwise `Ambiguous`: the request is
//!     refused and the candidates are listed, so the caller can name one. Incoming calls are never guessed.
//! * "Hang up" never means "hang up everything" and never refuses an incoming call (that is "decline").

use super::command::Candidate;
use crate::sip::types::{Call, CallState};

/// What the request needs from a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    /// A call waiting to be answered (answer, decline).
    Incoming,
    /// A call being set up or in progress (hang up).
    Hangup,
    /// An established call, preferring the active one (mute, put on hold).
    Established,
    /// An established call, preferring the one on hold (resume).
    EstablishedHeld,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SelectError {
    /// The identifier given matches no call.
    NotFound,
    /// No call can take the action (or the one named cannot).
    Unavailable(String),
    /// Several calls fit and none is the obvious one.
    Ambiguous(Vec<Candidate>),
}

fn in_pool(call: &Call, need: Need) -> bool {
    match need {
        Need::Incoming => call.state == CallState::Incoming,
        Need::Hangup => matches!(
            call.state,
            CallState::Initializing
                | CallState::Dialing
                | CallState::Ringing
                | CallState::Connected
                | CallState::OnHold
        ),
        Need::Established | Need::EstablishedHeld => {
            matches!(call.state, CallState::Connected | CallState::OnHold)
        }
    }
}

/// On hold, by us or by the other side.
pub fn is_held(call: &Call) -> bool {
    call.held_locally || call.held_remotely || call.state == CallState::OnHold
}

fn none_reason(need: Need) -> &'static str {
    match need {
        Need::Incoming => "Aucun appel entrant",
        Need::Hangup => "Aucun appel à raccrocher",
        Need::Established | Need::EstablishedHeld => "Aucun appel en cours",
    }
}

fn wrong_state_reason(need: Need) -> &'static str {
    match need {
        Need::Incoming => "Cet appel n'est pas un appel entrant en attente",
        Need::Hangup => "Cet appel n'est pas en cours : pour un appel entrant, il faut le refuser",
        Need::Established | Need::EstablishedHeld => "Cet appel n'est pas établi",
    }
}

pub fn select<'a>(
    calls: &'a [Call],
    need: Need,
    id: Option<&str>,
) -> Result<&'a Call, SelectError> {
    let live = || calls.iter().filter(|c| !c.state.is_terminal());

    if let Some(id) = id {
        let call = live().find(|c| c.id == id).ok_or(SelectError::NotFound)?;
        return if in_pool(call, need) {
            Ok(call)
        } else {
            Err(SelectError::Unavailable(wrong_state_reason(need).into()))
        };
    }

    let pool: Vec<&Call> = live().filter(|c| in_pool(c, need)).collect();
    match pool.as_slice() {
        [] => Err(SelectError::Unavailable(none_reason(need).into())),
        [only] => Ok(only),
        _ if need == Need::Incoming => Err(ambiguous(&pool)),
        _ => {
            let want_held = need == Need::EstablishedHeld;
            let preferred: Vec<&Call> = pool
                .iter()
                .copied()
                .filter(|c| is_held(c) == want_held)
                .collect();
            match preferred.as_slice() {
                [one] => Ok(one),
                _ => Err(ambiguous(&pool)),
            }
        }
    }
}

fn ambiguous(pool: &[&Call]) -> SelectError {
    SelectError::Ambiguous(pool.iter().map(|c| Candidate::of(c)).collect())
}

#[cfg(test)]
pub(crate) mod fixtures {
    use crate::sip::types::{Call, CallDirection, CallState};

    pub fn call(id: &str, state: CallState) -> Call {
        Call {
            id: id.into(),
            account_id: Some("acc".into()),
            account_label: Some("Bureau".into()),
            direction: if state == CallState::Incoming {
                CallDirection::Incoming
            } else {
                CallDirection::Outgoing
            },
            state,
            remote_uri: format!("sip:{id}@example.com"),
            remote_number: id.into(),
            remote_name: None,
            muted: false,
            recording: false,
            held_locally: state == CallState::OnHold,
            held_remotely: false,
            created_at: "2026-01-01T00:00:00Z".into(),
            connected_at: None,
            ended_at: None,
            duration_secs: 0,
            sip_code: None,
            reason: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::call;
    use super::*;

    fn id_of(r: Result<&Call, SelectError>) -> String {
        r.unwrap().id.clone()
    }

    #[test]
    fn a_single_compatible_call_is_the_one() {
        let calls = vec![call("a", CallState::Incoming)];
        assert_eq!(id_of(select(&calls, Need::Incoming, None)), "a");
        let calls = vec![call("a", CallState::Connected)];
        assert_eq!(id_of(select(&calls, Need::Established, None)), "a");
        assert_eq!(id_of(select(&calls, Need::Hangup, None)), "a");
    }

    #[test]
    fn nothing_compatible_means_nothing_to_do() {
        assert!(matches!(
            select(&[], Need::Hangup, None),
            Err(SelectError::Unavailable(_))
        ));
        // An incoming call is not something to "answer" when there is none, whatever else is going on.
        let calls = vec![call("a", CallState::Connected)];
        assert!(matches!(
            select(&calls, Need::Incoming, None),
            Err(SelectError::Unavailable(_))
        ));
        // Hanging up does not decline a ringing call.
        let calls = vec![call("a", CallState::Incoming)];
        assert!(matches!(
            select(&calls, Need::Hangup, None),
            Err(SelectError::Unavailable(_))
        ));
        // Nor does it reach a call that has ended.
        let calls = vec![call("a", CallState::Ended)];
        assert!(matches!(
            select(&calls, Need::Hangup, None),
            Err(SelectError::Unavailable(_))
        ));
        assert!(matches!(
            select(&calls, Need::Hangup, Some("a")),
            Err(SelectError::NotFound)
        ));
    }

    #[test]
    fn two_incoming_calls_are_never_guessed() {
        let calls = vec![
            call("a", CallState::Incoming),
            call("b", CallState::Incoming),
        ];
        let Err(SelectError::Ambiguous(c)) = select(&calls, Need::Incoming, None) else {
            panic!("must be ambiguous")
        };
        assert_eq!(
            c.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["a", "b"]
        );
        // …but naming one settles it.
        assert_eq!(id_of(select(&calls, Need::Incoming, Some("b"))), "b");
    }

    #[test]
    fn with_several_calls_the_active_one_is_meant_for_hold_mute_and_hangup() {
        let calls = vec![
            call("held", CallState::OnHold),
            call("live", CallState::Connected),
        ];
        for need in [Need::Established, Need::Hangup] {
            assert_eq!(id_of(select(&calls, need, None)), "live", "{need:?}");
        }
    }

    #[test]
    fn with_several_calls_the_held_one_is_meant_for_resume() {
        let calls = vec![
            call("live", CallState::Connected),
            call("held", CallState::OnHold),
        ];
        assert_eq!(id_of(select(&calls, Need::EstablishedHeld, None)), "held");
    }

    #[test]
    fn two_equal_candidates_are_ambiguous_not_arbitrary() {
        let two_held = vec![call("a", CallState::OnHold), call("b", CallState::OnHold)];
        assert!(matches!(
            select(&two_held, Need::EstablishedHeld, None),
            Err(SelectError::Ambiguous(_))
        ));
        assert!(matches!(
            select(&two_held, Need::Established, None),
            Err(SelectError::Ambiguous(_))
        ));
        // A call being dialled next to the one in progress: both are active, so hanging up does not choose.
        let calls = vec![
            call("a", CallState::Connected),
            call("b", CallState::Ringing),
        ];
        assert!(matches!(
            select(&calls, Need::Hangup, None),
            Err(SelectError::Ambiguous(_))
        ));
        assert_eq!(id_of(select(&calls, Need::Hangup, Some("b"))), "b");
    }

    #[test]
    fn an_identifier_wins_over_the_rule_and_is_checked() {
        let calls = vec![
            call("held", CallState::OnHold),
            call("live", CallState::Connected),
        ];
        assert_eq!(
            id_of(select(&calls, Need::Established, Some("held"))),
            "held"
        );
        assert!(matches!(
            select(&calls, Need::Established, Some("nope")),
            Err(SelectError::NotFound)
        ));
        // The call exists but cannot take that action.
        assert!(matches!(
            select(&calls, Need::Incoming, Some("live")),
            Err(SelectError::Unavailable(_))
        ));
        let ringing = vec![call("r", CallState::Ringing)];
        assert!(matches!(
            select(&ringing, Need::Established, Some("r")),
            Err(SelectError::Unavailable(_))
        ));
    }

    #[test]
    fn a_call_held_by_the_other_side_counts_as_held() {
        let mut remote = call("r", CallState::Connected);
        remote.held_remotely = true;
        let calls = vec![remote, call("live", CallState::Connected)];
        assert_eq!(id_of(select(&calls, Need::Established, None)), "live");
    }
}
