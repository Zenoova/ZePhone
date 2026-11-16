//! The vocabulary of the remote control: what can be asked (`Command`) and what comes back (`Outcome`).
//!
//! Keyboard shortcuts, the tray menu and the command line (`zephone ctl`) all speak this one language, so they
//! cannot disagree about what an action means.

use serde::{Deserialize, Serialize};

use crate::sip::types::Call;

pub const MAX_TARGET_LEN: usize = 200;
pub const MAX_ID_LEN: usize = 64;

/// One request. On the wire it is a JSON object with a `cmd` field and nothing else than the fields below:
/// an unknown field is refused, not ignored.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "cmd",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    /// Starts an outgoing call to a number, an extension or a SIP address.
    Dial {
        target: String,
        /// Account to call with; the default account when absent.
        #[serde(default)]
        account: Option<String>,
    },
    /// Answers an incoming call.
    Answer {
        #[serde(default)]
        call_id: Option<String>,
    },
    /// Declines an incoming call.
    Reject {
        #[serde(default)]
        call_id: Option<String>,
    },
    /// Ends a call that is being set up or in progress. Never an incoming call that is still ringing (that is
    /// `Reject`), and never more than one call.
    Hangup {
        #[serde(default)]
        call_id: Option<String>,
    },
    /// Mutes or unmutes the microphone of a call. `muted` absent: toggles. Present: the call ends up in that
    /// state, and asking twice changes nothing more.
    Mute {
        #[serde(default)]
        call_id: Option<String>,
        #[serde(default)]
        muted: Option<bool>,
    },
    /// Puts a call on hold or resumes it. `held` absent: toggles.
    Hold {
        #[serde(default)]
        call_id: Option<String>,
        #[serde(default)]
        held: Option<bool>,
    },
    /// "Do not disturb": incoming calls are declined (486 Busy Here) without ringing. `enabled` absent: toggles.
    Dnd {
        #[serde(default)]
        enabled: Option<bool>,
    },
    /// Brings the window to the front.
    ShowApp,
    /// Brings the window to the front, on the dialer with the number field focused.
    ShowDialer,
    /// Brings the window to the front, on the contacts with the search field focused.
    ShowSearch,
    /// Reads the state of the application and of its calls. Changes nothing.
    Status,
}

impl Command {
    /// Checks what can be checked without looking at the application. Returns a message for the user.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Command::Dial { target, account } => {
                let t = target.trim();
                if t.is_empty() {
                    return Err("empty recipient".into());
                }
                if t.len() > MAX_TARGET_LEN {
                    return Err("recipient too long".into());
                }
                if t.chars().any(char::is_control) {
                    return Err("invalid recipient (control characters)".into());
                }
                if let Some(a) = account {
                    check_id(a, "account")?;
                }
                Ok(())
            }
            Command::Answer { call_id }
            | Command::Reject { call_id }
            | Command::Hangup { call_id }
            | Command::Mute { call_id, .. }
            | Command::Hold { call_id, .. } => match call_id {
                Some(id) => check_id(id, "call"),
                None => Ok(()),
            },
            Command::Dnd { .. }
            | Command::ShowApp
            | Command::ShowDialer
            | Command::ShowSearch
            | Command::Status => Ok(()),
        }
    }

    /// A short name for the logs. Never the number dialled.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Dial { .. } => "dial",
            Command::Answer { .. } => "answer",
            Command::Reject { .. } => "reject",
            Command::Hangup { .. } => "hangup",
            Command::Mute { .. } => "mute",
            Command::Hold { .. } => "hold",
            Command::Dnd { .. } => "dnd",
            Command::ShowApp => "show",
            Command::ShowDialer => "dialer",
            Command::ShowSearch => "search",
            Command::Status => "status",
        }
    }
}

fn check_id(id: &str, what: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
    if ok {
        Ok(())
    } else {
        Err(format!("invalid {what} identifier"))
    }
}

/// How a request ended. The exit code of `zephone ctl` follows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Accepted. `settled` says whether the final state is already known.
    Ok,
    /// Understood, but nothing to act on in the current state (no incoming call, nothing on hold...).
    Unavailable,
    /// The call (or account) named in the request does not exist.
    NotFound,
    /// Several calls fit and the request does not say which: nothing was done.
    Ambiguous,
    /// The SIP engine is not running, no account is connected, or ZePhone is not running.
    Disconnected,
    /// The request itself is wrong (unknown command, bad parameter).
    Invalid,
    /// The engine refused or failed.
    Failed,
}

impl Status {
    pub fn exit_code(self) -> i32 {
        match self {
            Status::Ok => 0,
            Status::Failed => 1,
            Status::Invalid => 2,
            Status::NotFound => 3,
            Status::Ambiguous => 4,
            Status::Unavailable => 5,
            Status::Disconnected => 6,
        }
    }
}

/// A call that fits an ambiguous request, to let the caller name one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub state: String,
    pub remote: String,
    pub held: bool,
}

impl Candidate {
    pub fn of(call: &Call) -> Self {
        Self {
            id: call.id.clone(),
            state: format!("{:?}", call.state).to_lowercase(),
            remote: call
                .remote_name
                .clone()
                .unwrap_or_else(|| call.remote_number.clone()),
            held: call.held_locally || call.held_remotely,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountBrief {
    pub id: String,
    pub label: String,
    pub is_default: bool,
    /// Registered with its server and usable to call.
    pub connected: bool,
}

/// What `Status` answers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub engine_running: bool,
    pub do_not_disturb: bool,
    pub accounts: Vec<AccountBrief>,
    pub calls: Vec<Call>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: Status,
    pub message: String,
    /// The request changed something. `false` for a repeated explicit command (already muted, asked to mute).
    pub changed: bool,
    /// The final state is confirmed. `false` for what takes time: an answer, a hang-up and a dial are accepted
    /// by the engine at once, but the call only changes state when the other side follows.
    pub settled: bool,
    /// The call concerned, as the engine confirmed it after the request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call: Option<Call>,
    /// The calls that fit an ambiguous request.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<Candidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<AppStatus>,
}

impl Outcome {
    fn new(status: Status, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            changed: false,
            settled: false,
            call: None,
            candidates: Vec::new(),
            app: None,
        }
    }

    pub fn ok(message: impl Into<String>, call: Option<Call>, settled: bool) -> Self {
        Self {
            changed: true,
            settled,
            call,
            ..Self::new(Status::Ok, message)
        }
    }

    /// Already in the state asked for: success, nothing done.
    pub fn unchanged(message: impl Into<String>, call: Option<Call>) -> Self {
        Self {
            settled: true,
            call,
            ..Self::new(Status::Ok, message)
        }
    }

    pub fn of(status: Status, message: impl Into<String>) -> Self {
        Self::new(status, message)
    }

    pub fn ambiguous(message: impl Into<String>, candidates: Vec<Candidate>) -> Self {
        Self {
            candidates,
            ..Self::new(Status::Ambiguous, message)
        }
    }

    pub fn with_app(app: AppStatus) -> Self {
        Self {
            settled: true,
            app: Some(app),
            ..Self::new(Status::Ok, "Application state")
        }
    }

    pub fn is_ok(&self) -> bool {
        self.status == Status::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<Command, serde_json::Error> {
        serde_json::from_str(json)
    }

    #[test]
    fn reads_every_command_from_json() {
        assert_eq!(
            parse(r#"{"cmd":"dial","target":"1002"}"#).unwrap(),
            Command::Dial {
                target: "1002".into(),
                account: None
            }
        );
        assert_eq!(
            parse(r#"{"cmd":"mute","callId":"c1","muted":true}"#).unwrap(),
            Command::Mute {
                call_id: Some("c1".into()),
                muted: Some(true)
            }
        );
        assert_eq!(
            parse(r#"{"cmd":"hold"}"#).unwrap(),
            Command::Hold {
                call_id: None,
                held: None
            }
        );
        assert_eq!(
            parse(r#"{"cmd":"showDialer"}"#).unwrap(),
            Command::ShowDialer
        );
        assert_eq!(parse(r#"{"cmd":"status"}"#).unwrap(), Command::Status);
    }

    #[test]
    fn refuses_what_it_does_not_know() {
        assert!(parse(r#"{"cmd":"format-disk"}"#).is_err());
        assert!(
            parse(r#"{"cmd":"hangup","all":true}"#).is_err(),
            "no hidden 'hang up everything'"
        );
        assert!(parse(r#"{"cmd":"mute","muted":"yes"}"#).is_err());
        assert!(parse(r#"{"target":"1002"}"#).is_err());
        assert!(parse("not json").is_err());
    }

    #[test]
    fn validates_the_parameters() {
        let dial = |t: &str| Command::Dial {
            target: t.into(),
            account: None,
        };
        assert!(dial("+33 1 23 45 67 89").validate().is_ok());
        assert!(dial("sip:bob@example.com").validate().is_ok());
        assert!(dial("  ").validate().is_err());
        assert!(dial(&"9".repeat(MAX_TARGET_LEN + 1)).validate().is_err());
        assert!(dial("12\n34").validate().is_err());
        let hang = |id: &str| Command::Hangup {
            call_id: Some(id.into()),
        };
        assert!(hang("a1b2-c3").validate().is_ok());
        assert!(hang("").validate().is_err());
        assert!(hang("a b").validate().is_err());
        assert!(hang("x;rm -rf").validate().is_err());
        assert!(hang(&"a".repeat(MAX_ID_LEN + 1)).validate().is_err());
    }

    #[test]
    fn the_outcome_is_plain_json_without_empty_fields() {
        let json = serde_json::to_value(Outcome::unchanged("already muted", None)).unwrap();
        assert_eq!(json["status"], "ok");
        assert_eq!(json["changed"], false);
        assert_eq!(json["settled"], true);
        assert!(json.get("call").is_none() && json.get("candidates").is_none());
    }

    #[test]
    fn exit_codes_are_distinct() {
        use Status::*;
        let codes: Vec<i32> = [
            Ok,
            Failed,
            Invalid,
            NotFound,
            Ambiguous,
            Unavailable,
            Disconnected,
        ]
        .map(Status::exit_code)
        .to_vec();
        let mut sorted = codes.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes.len());
        assert_eq!(Ok.exit_code(), 0);
    }
}
