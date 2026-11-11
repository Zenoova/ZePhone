//! Parsing of Baresip `ctrl_tcp` JSON messages (verified against baresip 4.13.0:
//! `modules/ctrl_tcp/ctrl_tcp.c` and `src/bevent.c`) and mapping to engine-neutral events.

use serde_json::Value;

use super::{CallEvent, CallRef, EngineEvent, RegistrationEvent};
use crate::sip::types::CallDirection;

#[derive(Debug, Clone, PartialEq)]
pub struct Response {
    pub ok: bool,
    pub data: String,
    pub token: Option<String>,
}

/// An unsolicited event as emitted by `bevent_odict_encode`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RawEvent {
    pub class: String,
    pub kind: String,
    pub account_aor: Option<String>,
    pub call_id: Option<String>,
    pub direction: Option<CallDirection>,
    pub peer_uri: Option<String>,
    pub peer_name: Option<String>,
    pub param: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    Response(Response),
    Event(RawEvent),
    /// Anything else (e.g. incoming SIP MESSAGE notifications).
    Other,
}

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("invalid JSON: {0}")]
    Json(String),
    #[error("unexpected message shape")]
    Shape,
}

/// `true` or the string `"true"` (baresip's own doc comment shows the latter).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned).filter(|s| !s.is_empty())
}

pub fn parse_message(json: &[u8]) -> Result<Message, ProtocolError> {
    let v: Value = serde_json::from_slice(json).map_err(|e| ProtocolError::Json(e.to_string()))?;
    if !v.is_object() {
        return Err(ProtocolError::Shape);
    }
    if truthy(v.get("response")) {
        return Ok(Message::Response(Response {
            ok: truthy(v.get("ok")),
            data: v.get("data").and_then(Value::as_str).unwrap_or_default().to_owned(),
            token: str_field(&v, "token"),
        }));
    }
    if truthy(v.get("event")) {
        let direction = match v.get("direction").and_then(Value::as_str) {
            Some("incoming") => Some(CallDirection::Incoming),
            Some("outgoing") => Some(CallDirection::Outgoing),
            _ => None,
        };
        return Ok(Message::Event(RawEvent {
            class: str_field(&v, "class").unwrap_or_default(),
            kind: str_field(&v, "type").unwrap_or_default(),
            account_aor: str_field(&v, "accountaor"),
            call_id: str_field(&v, "id"),
            direction,
            peer_uri: str_field(&v, "peeruri"),
            peer_name: str_field(&v, "peerdisplayname"),
            param: str_field(&v, "param"),
        }));
    }
    Ok(Message::Other)
}

/// Splits baresip's `"<scode> <reason>"` / error-text params.
///
/// * `"403 Forbidden"` -> `(Some(403), "Forbidden")`
/// * `"0 "` (BYE received, no status) -> `(None, "")`
/// * `"Connection timed out"` -> `(Some(408), "Connection timed out")` (a transaction
///   timeout is a 408 in RFC 3261 terms, we expose it as such for diagnostics)
/// * anything else -> `(None, text)`
pub fn parse_status_param(param: &str) -> (Option<u16>, String) {
    let p = param.trim();
    if p.is_empty() {
        return (None, String::new());
    }
    let (first, rest) = match p.split_once(char::is_whitespace) {
        Some((a, b)) => (a, b.trim()),
        None => (p, ""),
    };
    if let Ok(code) = first.parse::<u16>() {
        let reason = rest.split(',').next().unwrap_or("").trim().to_owned();
        return if (100..=699).contains(&code) { (Some(code), reason) } else { (None, reason) };
    }
    let lower = p.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return (Some(408), p.to_owned());
    }
    (None, p.to_owned())
}

fn call_ref(raw: &RawEvent) -> Option<CallRef> {
    Some(CallRef {
        id: raw.call_id.clone()?,
        aor: raw.account_aor.clone().unwrap_or_default(),
        direction: raw.direction.unwrap_or(CallDirection::Outgoing),
        peer_uri: raw.peer_uri.clone().unwrap_or_default(),
        peer_name: raw.peer_name.clone(),
    })
}

/// Maps a raw baresip event to an engine-neutral one. Unknown or irrelevant
/// events return `None`.
pub fn to_engine_event(raw: &RawEvent) -> Option<EngineEvent> {
    let param = raw.param.as_deref().unwrap_or("");
    let reg = |event| -> Option<EngineEvent> {
        Some(EngineEvent::Registration { aor: raw.account_aor.clone()?, event })
    };
    let call = |event| -> Option<EngineEvent> { Some(EngineEvent::Call { call: call_ref(raw)?, event }) };

    match raw.kind.as_str() {
        "CREATE" => reg(RegistrationEvent::Created),
        "REGISTERING" => reg(RegistrationEvent::Registering),
        "UNREGISTERING" => reg(RegistrationEvent::Unregistering),
        "REGISTER_OK" => {
            let (code, reason) = parse_status_param(param);
            reg(RegistrationEvent::Registered { code, reason })
        }
        "REGISTER_FAIL" => {
            let (code, reason) = parse_status_param(param);
            reg(RegistrationEvent::Failed { code, reason })
        }
        "CALL_INCOMING" => call(CallEvent::Incoming),
        "CALL_OUTGOING" => call(CallEvent::Outgoing),
        "CALL_RINGING" | "CALL_PROGRESS" => call(CallEvent::Ringing),
        "CALL_ESTABLISHED" => call(CallEvent::Established),
        "CALL_CLOSED" => {
            let (code, reason) = parse_status_param(param);
            call(CallEvent::Closed { code, reason })
        }
        "CALL_HOLD" => call(CallEvent::Hold),
        "CALL_RESUME" => call(CallEvent::Resume),
        "TRANSFER_FAILED" => {
            let (code, reason) = parse_status_param(param);
            call(CallEvent::TransferFailed { code, reason })
        }
        "CALL_DTMF_START" => call(CallEvent::Dtmf { key: param.to_owned() }),
        "AUDIO_ERROR" => Some(EngineEvent::AudioError { call_id: raw.call_id.clone(), message: param.to_owned() }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(json: &str) -> RawEvent {
        match parse_message(json.as_bytes()).unwrap() {
            Message::Event(e) => e,
            other => panic!("not an event: {other:?}"),
        }
    }

    #[test]
    fn parses_response_with_token() {
        let m = parse_message(br#"{"response":true,"ok":true,"data":"hi\nthere","token":"t1"}"#).unwrap();
        assert_eq!(m, Message::Response(Response { ok: true, data: "hi\nthere".into(), token: Some("t1".into()) }));
    }

    #[test]
    fn parses_failed_response() {
        let m = parse_message(br#"{"response":true,"ok":false,"data":"nope","token":"7"}"#).unwrap();
        match m {
            Message::Response(r) => assert!(!r.ok),
            _ => panic!(),
        }
    }

    #[test]
    fn parses_real_create_event_captured_from_baresip_4_13() {
        // Captured from a real baresip 4.13.0 process during development.
        let e = event(
            r#"{"event":true,"class":"ua","type":"CREATE","accountaor":"sip:1001@127.0.0.1","cuser":"1001","param":"sip:1001@127.0.0.1"}"#,
        );
        assert_eq!(e.kind, "CREATE");
        assert_eq!(e.class, "ua");
        assert_eq!(
            to_engine_event(&e),
            Some(EngineEvent::Registration { aor: "sip:1001@127.0.0.1".into(), event: RegistrationEvent::Created })
        );
    }

    #[test]
    fn accepts_event_flag_as_string() {
        let e = event(r#"{"event":"true","class":"call","type":"CALL_CLOSED","param":"Connection reset by peer","accountaor":"sip:alice@atlanta.com","direction":"incoming","peeruri":"sip:bob@biloxy.com","id":"73a12546589651f8"}"#);
        assert_eq!(e.direction, Some(CallDirection::Incoming));
        match to_engine_event(&e).unwrap() {
            EngineEvent::Call { call, event: CallEvent::Closed { code, reason } } => {
                assert_eq!(call.id, "73a12546589651f8");
                assert_eq!(call.peer_uri, "sip:bob@biloxy.com");
                assert_eq!(code, None);
                assert_eq!(reason, "Connection reset by peer");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_registration_outcomes_with_sip_codes() {
        let ok = event(r#"{"event":true,"class":"ua","type":"REGISTER_OK","accountaor":"sip:1001@pbx","param":"200 OK"}"#);
        assert_eq!(
            to_engine_event(&ok),
            Some(EngineEvent::Registration {
                aor: "sip:1001@pbx".into(),
                event: RegistrationEvent::Registered { code: Some(200), reason: "OK".into() }
            })
        );
        let fail = event(
            r#"{"event":true,"class":"ua","type":"REGISTER_FAIL","accountaor":"sip:1001@pbx","param":"403 Forbidden"}"#,
        );
        assert_eq!(
            to_engine_event(&fail),
            Some(EngineEvent::Registration {
                aor: "sip:1001@pbx".into(),
                event: RegistrationEvent::Failed { code: Some(403), reason: "Forbidden".into() }
            })
        );
    }

    #[test]
    fn maps_incoming_call_with_display_name() {
        let e = event(
            r#"{"event":true,"class":"call","type":"CALL_INCOMING","accountaor":"sip:1001@pbx","direction":"incoming","peeruri":"sip:1002@pbx","peerdisplayname":"Bob","id":"abc","param":"sip:1002@pbx"}"#,
        );
        match to_engine_event(&e).unwrap() {
            EngineEvent::Call { call, event: CallEvent::Incoming } => {
                assert_eq!(call.peer_name.as_deref(), Some("Bob"));
                assert_eq!(call.direction, CallDirection::Incoming);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn call_events_without_id_are_dropped() {
        let e = event(r#"{"event":true,"class":"call","type":"CALL_RINGING","accountaor":"sip:a@b"}"#);
        assert_eq!(to_engine_event(&e), None);
    }

    #[test]
    fn irrelevant_events_are_ignored() {
        let e = event(r#"{"event":true,"class":"call","type":"CALL_RTCP","id":"x","param":"audio"}"#);
        assert_eq!(to_engine_event(&e), None);
    }

    #[test]
    fn status_param_parsing() {
        assert_eq!(parse_status_param("401 Unauthorized"), (Some(401), "Unauthorized".into()));
        assert_eq!(parse_status_param("486 Busy Here"), (Some(486), "Busy Here".into()));
        assert_eq!(parse_status_param("503 Service Unavailable,SIP;cause=503"), (Some(503), "Service Unavailable".into()));
        assert_eq!(parse_status_param("0 "), (None, String::new()));
        assert_eq!(parse_status_param(""), (None, String::new()));
        assert_eq!(parse_status_param("Connection timed out"), (Some(408), "Connection timed out".into()));
        assert_eq!(parse_status_param("Connection refused"), (None, "Connection refused".into()));
        assert_eq!(parse_status_param("999 weird"), (None, "weird".into()));
    }

    #[test]
    fn non_object_json_is_rejected_and_garbage_errors() {
        assert!(parse_message(b"[1,2]").is_err());
        assert!(parse_message(b"not json").is_err());
        assert_eq!(parse_message(br#"{"message":true,"from":"x"}"#).unwrap(), Message::Other);
    }
}
