//! Pure state transitions for account registration status. Driven by the
//! real SIP events coming from the engine; no I/O here.

use chrono::{DateTime, Utc};

use super::{
    diagnostics::describe_registration_failure,
    engine::{EngineState, RegistrationEvent},
    types::{AccountStatus, RegistrationState},
};

pub fn status(account_id: &str, state: RegistrationState, now: DateTime<Utc>) -> AccountStatus {
    AccountStatus {
        account_id: account_id.to_owned(),
        state,
        sip_code: None,
        reason: None,
        message: None,
        updated_at: now.to_rfc3339(),
    }
}

pub fn unconfigured(account_id: &str, message: &str, now: DateTime<Utc>) -> AccountStatus {
    AccountStatus { message: Some(message.to_owned()), ..status(account_id, RegistrationState::Unconfigured, now) }
}

pub fn disconnected(account_id: &str, message: Option<&str>, now: DateTime<Utc>) -> AccountStatus {
    AccountStatus { message: message.map(str::to_owned), ..status(account_id, RegistrationState::Disconnected, now) }
}

pub fn connecting(account_id: &str, now: DateTime<Utc>) -> AccountStatus {
    status(account_id, RegistrationState::Connecting, now)
}

/// Applies a registration event to the previous status.
///
/// A 401/407 challenge that Baresip answers with credentials never reaches
/// this function as a failure: Baresip only reports the *final* outcome of
/// the REGISTER transaction (`REGISTER_OK` or `REGISTER_FAIL`).
pub fn apply_registration_event(
    prev: &AccountStatus,
    event: &RegistrationEvent,
    register_interval: u32,
    now: DateTime<Utc>,
) -> AccountStatus {
    let id = prev.account_id.as_str();
    match event {
        RegistrationEvent::Created => {
            if register_interval == 0 {
                disconnected(id, Some("Enregistrement désactivé : appels directs uniquement"), now)
            } else {
                connecting(id, now)
            }
        }
        RegistrationEvent::Registering => {
            // Periodic refresh of a healthy registration must not flicker the UI.
            if prev.state == RegistrationState::Registered {
                prev.clone()
            } else {
                connecting(id, now)
            }
        }
        RegistrationEvent::Registered { code, reason } => AccountStatus {
            sip_code: code.or(Some(200)),
            reason: (!reason.is_empty()).then(|| reason.clone()),
            ..status(id, RegistrationState::Registered, now)
        },
        RegistrationEvent::Failed { code, reason } => AccountStatus {
            sip_code: *code,
            reason: (!reason.is_empty()).then(|| reason.clone()),
            message: Some(describe_registration_failure(*code, reason)),
            ..status(id, RegistrationState::Error, now)
        },
        RegistrationEvent::Unregistering => disconnected(id, None, now),
    }
}

/// Status of an account that the engine is not hosting right now, derived from
/// the engine state.
pub fn status_for_engine_state(account_id: &str, engine: &EngineState, now: DateTime<Utc>) -> Option<AccountStatus> {
    match engine {
        EngineState::Running => None,
        EngineState::Starting => Some(connecting(account_id, now)),
        EngineState::Restarting { reason, .. } => Some(AccountStatus {
            message: Some(format!("Moteur SIP en cours de redémarrage ({reason})")),
            ..status(account_id, RegistrationState::Connecting, now)
        }),
        EngineState::Stopped => Some(disconnected(account_id, Some("Moteur SIP arrêté"), now)),
        EngineState::Failed { reason } => Some(AccountStatus {
            message: Some(format!("Moteur SIP indisponible : {reason}")),
            ..status(account_id, RegistrationState::Error, now)
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T10:00:00Z").unwrap().with_timezone(&Utc)
    }

    fn apply(prev: &AccountStatus, ev: RegistrationEvent) -> AccountStatus {
        apply_registration_event(prev, &ev, 300, now())
    }

    #[test]
    fn normal_registration_sequence() {
        let s = disconnected("a", None, now());
        let s = apply(&s, RegistrationEvent::Created);
        assert_eq!(s.state, RegistrationState::Connecting);
        let s = apply(&s, RegistrationEvent::Registering);
        assert_eq!(s.state, RegistrationState::Connecting);
        let s = apply(&s, RegistrationEvent::Registered { code: Some(200), reason: "OK".into() });
        assert_eq!(s.state, RegistrationState::Registered);
        assert_eq!(s.sip_code, Some(200));
        assert_eq!(s.message, None);
    }

    #[test]
    fn refresh_does_not_flicker_a_registered_account() {
        let s = apply(&connecting("a", now()), RegistrationEvent::Registered { code: Some(200), reason: "OK".into() });
        let again = apply(&s, RegistrationEvent::Registering);
        assert_eq!(again.state, RegistrationState::Registered);
    }

    #[test]
    fn failure_carries_code_reason_and_message() {
        let s = apply(
            &connecting("a", now()),
            RegistrationEvent::Failed { code: Some(403), reason: "Forbidden".into() },
        );
        assert_eq!(s.state, RegistrationState::Error);
        assert_eq!(s.sip_code, Some(403));
        assert_eq!(s.reason.as_deref(), Some("Forbidden"));
        assert!(s.message.unwrap().contains("403"));
    }

    #[test]
    fn network_failure_has_no_sip_code_but_a_message() {
        let s = apply(
            &connecting("a", now()),
            RegistrationEvent::Failed { code: None, reason: "Connection refused [61]".into() },
        );
        assert_eq!(s.state, RegistrationState::Error);
        assert_eq!(s.sip_code, None);
        assert!(s.message.unwrap().starts_with("Connexion refusée"));
    }

    #[test]
    fn recovery_after_error() {
        let failed = apply(&connecting("a", now()), RegistrationEvent::Failed { code: Some(503), reason: "x".into() });
        let s = apply(&failed, RegistrationEvent::Registering);
        assert_eq!(s.state, RegistrationState::Connecting);
        assert_eq!(s.message, None);
        let s = apply(&s, RegistrationEvent::Registered { code: Some(200), reason: String::new() });
        assert_eq!(s.state, RegistrationState::Registered);
    }

    #[test]
    fn registration_disabled_account_is_not_stuck_connecting() {
        let s = apply_registration_event(&disconnected("a", None, now()), &RegistrationEvent::Created, 0, now());
        assert_eq!(s.state, RegistrationState::Disconnected);
        assert!(s.message.is_some());
    }

    #[test]
    fn unregistering_disconnects() {
        let s = apply(&connecting("a", now()), RegistrationEvent::Registered { code: Some(200), reason: "OK".into() });
        assert_eq!(apply(&s, RegistrationEvent::Unregistering).state, RegistrationState::Disconnected);
    }

    #[test]
    fn engine_state_mapping() {
        assert!(status_for_engine_state("a", &EngineState::Running, now()).is_none());
        let s = status_for_engine_state("a", &EngineState::Failed { reason: "boom".into() }, now()).unwrap();
        assert_eq!(s.state, RegistrationState::Error);
        assert!(s.message.unwrap().contains("boom"));
        let s = status_for_engine_state("a", &EngineState::Restarting { attempt: 1, reason: "crash".into() }, now()).unwrap();
        assert_eq!(s.state, RegistrationState::Connecting);
        assert_eq!(status_for_engine_state("a", &EngineState::Stopped, now()).unwrap().state, RegistrationState::Disconnected);
    }
}
