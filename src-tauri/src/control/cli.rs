//! `zephone ctl …`: the command line of the running application.
//!
//! The same executable as the application, started with `ctl` as its first argument, talks to the instance that
//! is already open through the private socket and exits. It never opens the application or a second window.
//!
//! The answer is one line of JSON on the standard output (`--pretty` to indent it); the exit code follows
//! the `status` of the answer, see [`Status::exit_code`].

use super::{
    command::{Command, Outcome, Status},
    socket,
};

pub const USAGE: &str = "\
Usage: zephone ctl <command> [options]

Commands
  dial <number|extension|sip:address> [--account <id>]   start a call
  answer  [--call <id>]                                   answer an incoming call
  reject  [--call <id>]                                   decline an incoming call
  hangup  [--call <id>]                                   hang up one call
  mute    [on|off|toggle] [--call <id>]                   microphone (toggle by default)
  hold    [on|off|toggle] [--call <id>]                   hold or resume (toggle by default)
  dnd     [on|off|toggle]                                 do not disturb (toggle by default)
  show                                                    bring the window forward
  dialer                                                  ... on the dialer, number field focused
  search                                                  ... on the contacts, search field focused
  status                                                  state of the application and of its calls

Without --call, the call is chosen by the documented rule; if several calls fit, nothing is done and the
answer lists them (status \"ambiguous\").

Options
  --pretty   indent the JSON answer
  -h, --help

Exit code: 0 ok, 1 failed, 2 invalid, 3 not found, 4 ambiguous, 5 unavailable, 6 ZePhone/engine not reachable.";

/// Turns the arguments after `ctl` into a command.
pub fn parse(args: &[String]) -> Result<Command, String> {
    let mut positional: Vec<&str> = Vec::new();
    let mut call: Option<String> = None;
    let mut account: Option<String> = None;
    let mut it = args.iter().map(String::as_str);
    while let Some(a) = it.next() {
        match a {
            "--pretty" => {}
            "--call" => call = Some(it.next().ok_or("--call expects an identifier")?.to_owned()),
            "--account" => {
                account = Some(
                    it.next()
                        .ok_or("--account expects an identifier")?
                        .to_owned(),
                )
            }
            f if f.starts_with("--") => return Err(format!("unknown option: {f}")),
            p => positional.push(p),
        }
    }
    let (name, rest) = positional.split_first().ok_or("missing command")?;

    let only = |n: usize, what: &str| -> Result<(), String> {
        if rest.len() > n {
            Err(format!("too many arguments for “{what}”"))
        } else {
            Ok(())
        }
    };
    let no_flags = |what: &str| -> Result<(), String> {
        if call.is_some() || account.is_some() {
            Err(format!("“{what}” does not accept this option"))
        } else {
            Ok(())
        }
    };
    let state = |what: &str| -> Result<Option<bool>, String> {
        match rest.first().copied() {
            None | Some("toggle") => Ok(None),
            Some("on" | "yes" | "true") => Ok(Some(true)),
            Some("off" | "no" | "false") => Ok(Some(false)),
            Some(other) => Err(format!(
                "“{what}” expects on, off or toggle (received: {other})"
            )),
        }
    };

    match *name {
        "dial" => {
            only(1, "dial")?;
            if call.is_some() {
                return Err("“dial” does not accept --call".into());
            }
            let target = rest
                .first()
                .ok_or("“dial” expects a number or a SIP address")?;
            Ok(Command::Dial {
                target: (*target).to_owned(),
                account,
            })
        }
        "answer" | "reject" | "hangup" => {
            only(0, name)?;
            if account.is_some() {
                return Err(format!("“{name}” does not accept --account"));
            }
            Ok(match *name {
                "answer" => Command::Answer { call_id: call },
                "reject" => Command::Reject { call_id: call },
                _ => Command::Hangup { call_id: call },
            })
        }
        "mute" | "hold" => {
            only(1, name)?;
            if account.is_some() {
                return Err(format!("“{name}” does not accept --account"));
            }
            let wanted = state(name)?;
            Ok(if *name == "mute" {
                Command::Mute {
                    call_id: call,
                    muted: wanted,
                }
            } else {
                Command::Hold {
                    call_id: call,
                    held: wanted,
                }
            })
        }
        "dnd" => {
            only(1, "dnd")?;
            no_flags("dnd")?;
            Ok(Command::Dnd {
                enabled: state("dnd")?,
            })
        }
        "show" | "dialer" | "search" | "status" => {
            only(0, name)?;
            no_flags(name)?;
            Ok(match *name {
                "show" => Command::ShowApp,
                "dialer" => Command::ShowDialer,
                "search" => Command::ShowSearch,
                _ => Command::Status,
            })
        }
        other => Err(format!("unknown command: {other}")),
    }
}

/// Runs the command line and returns the exit code. Prints the answer.
pub fn run(args: &[String]) -> i32 {
    if args
        .iter()
        .any(|a| a == "-h" || a == "--help" || a == "help")
    {
        println!("{USAGE}");
        return 0;
    }
    let pretty = args.iter().any(|a| a == "--pretty");
    let outcome = match parse(args) {
        Err(msg) => {
            eprintln!("zephone ctl: {msg}\n\n{USAGE}");
            Outcome::of(Status::Invalid, msg)
        }
        Ok(cmd) => match socket::socket_path() {
            Err(msg) => Outcome::of(Status::Disconnected, msg),
            Ok(path) => socket::send(&path, &cmd),
        },
    };
    let json = if pretty {
        serde_json::to_string_pretty(&outcome)
    } else {
        serde_json::to_string(&outcome)
    };
    println!("{}", json.unwrap_or_else(|_| "{}".into()));
    outcome.status.exit_code()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> Result<Command, String> {
        parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_every_command() {
        assert_eq!(
            p(&["dial", "+33123456789", "--account", "acc1"]).unwrap(),
            Command::Dial {
                target: "+33123456789".into(),
                account: Some("acc1".into())
            }
        );
        assert_eq!(p(&["answer"]).unwrap(), Command::Answer { call_id: None });
        assert_eq!(
            p(&["reject", "--call", "c1"]).unwrap(),
            Command::Reject {
                call_id: Some("c1".into())
            }
        );
        assert_eq!(p(&["hangup"]).unwrap(), Command::Hangup { call_id: None });
        assert_eq!(p(&["show"]).unwrap(), Command::ShowApp);
        assert_eq!(p(&["status", "--pretty"]).unwrap(), Command::Status);
    }

    #[test]
    fn mute_and_hold_distinguish_toggle_from_explicit() {
        assert_eq!(
            p(&["mute"]).unwrap(),
            Command::Mute {
                call_id: None,
                muted: None
            }
        );
        assert_eq!(
            p(&["mute", "toggle"]).unwrap(),
            Command::Mute {
                call_id: None,
                muted: None
            }
        );
        assert_eq!(
            p(&["mute", "on"]).unwrap(),
            Command::Mute {
                call_id: None,
                muted: Some(true)
            }
        );
        assert_eq!(
            p(&["mute", "off"]).unwrap(),
            Command::Mute {
                call_id: None,
                muted: Some(false)
            }
        );
        assert_eq!(
            p(&["hold", "on", "--call", "x"]).unwrap(),
            Command::Hold {
                call_id: Some("x".into()),
                held: Some(true)
            }
        );
        assert_eq!(
            p(&["dnd", "off"]).unwrap(),
            Command::Dnd {
                enabled: Some(false)
            }
        );
    }

    #[test]
    fn a_number_that_looks_like_an_option_stays_a_target() {
        // Extensions, `*43`, `#` codes and international numbers are numbers, not options.
        assert!(matches!(p(&["dial", "*43"]), Ok(Command::Dial { .. })));
        assert!(matches!(p(&["dial", "+33 1 23"]), Ok(Command::Dial { .. })));
    }

    #[test]
    fn rejects_what_is_wrong() {
        assert!(p(&[]).is_err());
        assert!(p(&["bogus"]).is_err());
        assert!(p(&["dial"]).is_err());
        assert!(p(&["dial", "1", "2"]).is_err());
        assert!(p(&["dial", "1", "--call", "x"]).is_err());
        assert!(p(&["mute", "maybe"]).is_err());
        assert!(
            p(&["hangup", "--all"]).is_err(),
            "there is no 'hang up everything'"
        );
        assert!(p(&["hangup", "now"]).is_err());
        assert!(p(&["hangup", "--call"]).is_err());
        assert!(p(&["status", "--call", "x"]).is_err());
        assert!(p(&["dnd", "--account", "x"]).is_err());
    }
}
