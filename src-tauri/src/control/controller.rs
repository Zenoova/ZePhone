//! The one place where a request becomes an action on the telephony core.
//!
//! Keyboard shortcuts, the tray menu and `zephone ctl` all call [`Controller::execute`]. It checks that the action
//! makes sense *now* (a call to answer, a call to put on hold…), picks the call by the rule in [`super::select`],
//! runs the same manager function the buttons of the interface run, and reports what the engine confirmed.
//!
//! Requests that act on calls run one at a time: a toggle always reads the state the previous request left.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;

use super::{
    command::{Candidate, Command, Outcome, Status},
    select::{Need, SelectError, select},
};
use crate::{
    error::{AppError, AppResult},
    sip::{types::Call, uri},
};

/// What the controller needs from the telephony core. The SIP manager is the real implementation.
#[async_trait]
pub trait Telephony: Send + Sync + 'static {
    fn calls(&self) -> Vec<Call>;
    fn engine_running(&self) -> bool;
    fn status(&self) -> AppResult<super::command::AppStatus>;
    async fn dial(&self, target: &str, account_id: Option<&str>) -> AppResult<Call>;
    async fn answer(&self, id: &str) -> AppResult<()>;
    async fn reject(&self, id: &str) -> AppResult<()>;
    async fn hangup(&self, id: &str) -> AppResult<()>;
    async fn hold(&self, id: &str) -> AppResult<()>;
    async fn resume(&self, id: &str) -> AppResult<()>;
    async fn set_mute(&self, id: &str, muted: bool) -> AppResult<()>;
    fn do_not_disturb(&self) -> AppResult<bool>;
    async fn set_do_not_disturb(&self, on: bool) -> AppResult<()>;
}

/// Where the window should go when it is brought forward.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    /// The dialer, number field focused.
    Dialer,
    /// The contacts, search field focused.
    Search,
}

/// What the controller needs from the desktop shell.
pub trait Shell: Send + Sync + 'static {
    /// Brings the main window to the front, optionally on a given page.
    fn show(&self, focus: Option<Focus>);
}

pub struct Controller {
    phone: Arc<dyn Telephony>,
    shell: Arc<dyn Shell>,
    /// Requests that act on calls go through one at a time.
    gate: Mutex<()>,
}

impl Controller {
    pub fn new(phone: Arc<dyn Telephony>, shell: Arc<dyn Shell>) -> Arc<Self> {
        Arc::new(Self {
            phone,
            shell,
            gate: Mutex::new(()),
        })
    }

    pub async fn execute(&self, cmd: Command) -> Outcome {
        if let Err(msg) = cmd.validate() {
            return Outcome::of(Status::Invalid, msg);
        }
        let outcome = match &cmd {
            // These do not touch a call: no need to queue behind one.
            Command::ShowApp => self.show(None, "Fenêtre affichée"),
            Command::ShowDialer => self.show(Some(Focus::Dialer), "Clavier affiché"),
            Command::ShowSearch => self.show(Some(Focus::Search), "Recherche de contacts affichée"),
            Command::Status => self.status(),
            _ => {
                let _turn = self.gate.lock().await;
                self.act(&cmd).await
            }
        };
        log::info!(
            "control: {} -> {:?}{}",
            cmd.name(),
            outcome.status,
            if outcome.changed { " (changed)" } else { "" }
        );
        outcome
    }

    fn show(&self, focus: Option<Focus>, message: &str) -> Outcome {
        self.shell.show(focus);
        Outcome::ok(message, None, true)
    }

    fn status(&self) -> Outcome {
        match self.phone.status() {
            Ok(app) => Outcome::with_app(app),
            Err(e) => Outcome::of(Status::Failed, e.to_string()),
        }
    }

    async fn act(&self, cmd: &Command) -> Outcome {
        if let Command::Dnd { enabled } = cmd {
            return self.dnd(*enabled).await;
        }
        if !self.phone.engine_running() {
            return Outcome::of(Status::Disconnected, "Le moteur SIP n'est pas démarré");
        }
        match cmd {
            Command::Dial { target, account } => self.dial(target, account.as_deref()).await,
            Command::Answer { call_id } => {
                let call = match self.pick(Need::Incoming, call_id.as_deref()) {
                    Ok(c) => c,
                    Err(o) => return o,
                };
                let r = self.phone.answer(&call.id).await;
                self.accepted(r, &call, "Appel décroché")
            }
            Command::Reject { call_id } => {
                let call = match self.pick(Need::Incoming, call_id.as_deref()) {
                    Ok(c) => c,
                    Err(o) => return o,
                };
                let r = self.phone.reject(&call.id).await;
                self.accepted(r, &call, "Appel refusé")
            }
            Command::Hangup { call_id } => {
                let call = match self.pick(Need::Hangup, call_id.as_deref()) {
                    Ok(c) => c,
                    Err(o) => return o,
                };
                let r = self.phone.hangup(&call.id).await;
                self.accepted(r, &call, "Appel raccroché")
            }
            Command::Mute { call_id, muted } => self.mute(call_id.as_deref(), *muted).await,
            Command::Hold { call_id, held } => self.hold(call_id.as_deref(), *held).await,
            Command::Dnd { .. }
            | Command::ShowApp
            | Command::ShowDialer
            | Command::ShowSearch
            | Command::Status => unreachable!("handled before"),
        }
    }

    /// The call a request means, or the answer to give instead.
    fn pick(&self, need: Need, id: Option<&str>) -> Result<Call, Outcome> {
        let calls = self.phone.calls();
        select(&calls, need, id).cloned().map_err(|e| match e {
            SelectError::NotFound => Outcome::of(Status::NotFound, "Appel introuvable"),
            SelectError::Unavailable(why) => Outcome::of(Status::Unavailable, why),
            SelectError::Ambiguous(candidates) => ambiguous(candidates),
        })
    }

    /// The call as the engine reports it now.
    fn current(&self, id: &str) -> Option<Call> {
        self.phone.calls().into_iter().find(|c| c.id == id)
    }

    /// An action the engine accepted: the call changes state when the other side follows, so it is not settled.
    fn accepted(&self, result: AppResult<()>, call: &Call, message: &str) -> Outcome {
        match result {
            Ok(()) => Outcome::ok(
                message,
                self.current(&call.id).or(Some(call.clone())),
                false,
            ),
            Err(e) => self.failed(e, Some(&call.id)),
        }
    }

    fn failed(&self, e: AppError, call_id: Option<&str>) -> Outcome {
        let mut o = match e {
            AppError::NotFound(_) => Outcome::of(Status::NotFound, "Appel introuvable"),
            AppError::Validation(m) => Outcome::of(Status::Unavailable, m),
            other => Outcome::of(Status::Failed, other.to_string()),
        };
        // Whatever failed, report the state the engine confirmed.
        o.call = call_id.and_then(|id| self.current(id));
        o
    }

    async fn dial(&self, target: &str, account: Option<&str>) -> Outcome {
        // The same rules as the dialer: extensions, numbers and SIP addresses are accepted as they are there.
        if let Err(e) = uri::normalize_target(target, "invalid") {
            return Outcome::of(Status::Invalid, format!("Destinataire invalide : {e}"));
        }
        let app = match self.phone.status() {
            Ok(a) => a,
            Err(e) => return Outcome::of(Status::Failed, e.to_string()),
        };
        match account {
            Some(id) => match app.accounts.iter().find(|a| a.id == id) {
                None => return Outcome::of(Status::NotFound, "Compte introuvable"),
                Some(a) if !a.connected => {
                    return Outcome::of(
                        Status::Disconnected,
                        format!("Le compte « {} » n'est pas connecté", a.label),
                    );
                }
                Some(_) => {}
            },
            None if !app.accounts.iter().any(|a| a.connected) => {
                return Outcome::of(Status::Disconnected, "Aucun compte SIP n'est connecté");
            }
            None => {}
        }
        match self.phone.dial(target.trim(), account).await {
            Ok(call) => Outcome::ok("Appel lancé", Some(call), false),
            Err(e) => self.failed(e, None),
        }
    }

    async fn mute(&self, id: Option<&str>, muted: Option<bool>) -> Outcome {
        let call = match self.pick(Need::Established, id) {
            Ok(c) => c,
            Err(o) => return o,
        };
        let wanted = muted.unwrap_or(!call.muted);
        if call.muted == wanted {
            return Outcome::unchanged(
                if wanted {
                    "Le micro est déjà coupé"
                } else {
                    "Le micro est déjà actif"
                },
                Some(call),
            );
        }
        if let Err(e) = self.phone.set_mute(&call.id, wanted).await {
            return self.failed(e, Some(&call.id));
        }
        // What the interface shows is what the engine confirmed, not what was asked.
        let after = self.current(&call.id);
        let settled = after.as_ref().is_some_and(|c| c.muted == wanted);
        Outcome {
            settled,
            ..Outcome::ok(
                if wanted {
                    "Micro coupé"
                } else {
                    "Micro réactivé"
                },
                after,
                settled,
            )
        }
    }

    async fn hold(&self, id: Option<&str>, held: Option<bool>) -> Outcome {
        let need = if held == Some(false) {
            Need::EstablishedHeld
        } else {
            Need::Established
        };
        let call = match self.pick(need, id) {
            Ok(c) => c,
            Err(o) => return o,
        };
        let wanted = held.unwrap_or(!call.held_locally);
        if call.held_locally == wanted {
            return Outcome::unchanged(
                if wanted {
                    "L'appel est déjà en attente"
                } else {
                    "L'appel n'est pas en attente"
                },
                Some(call),
            );
        }
        let r = if wanted {
            self.phone.hold(&call.id).await
        } else {
            self.phone.resume(&call.id).await
        };
        if let Err(e) = r {
            return self.failed(e, Some(&call.id));
        }
        let after = self.current(&call.id);
        let settled = after.as_ref().is_some_and(|c| c.held_locally == wanted);
        Outcome::ok(
            if wanted {
                "Appel mis en attente"
            } else {
                "Appel repris"
            },
            after,
            settled,
        )
    }

    async fn dnd(&self, enabled: Option<bool>) -> Outcome {
        let current = match self.phone.do_not_disturb() {
            Ok(v) => v,
            Err(e) => return Outcome::of(Status::Failed, e.to_string()),
        };
        let wanted = enabled.unwrap_or(!current);
        if wanted == current {
            return Outcome::unchanged(
                if wanted {
                    "« Ne pas déranger » est déjà activé"
                } else {
                    "« Ne pas déranger » est déjà désactivé"
                },
                None,
            );
        }
        match self.phone.set_do_not_disturb(wanted).await {
            Ok(()) => Outcome::ok(
                if wanted {
                    "« Ne pas déranger » activé"
                } else {
                    "« Ne pas déranger » désactivé"
                },
                None,
                true,
            ),
            Err(e) => Outcome::of(Status::Failed, e.to_string()),
        }
    }
}

fn ambiguous(candidates: Vec<Candidate>) -> Outcome {
    let list = candidates
        .iter()
        .map(|c| format!("{} ({})", c.remote, c.id))
        .collect::<Vec<_>>()
        .join(", ");
    Outcome::ambiguous(
        format!("Plusieurs appels correspondent : {list}. Précisez l'appel."),
        candidates,
    )
}

#[cfg(test)]
pub(crate) mod tests;
