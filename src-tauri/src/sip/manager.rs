//! Orchestration: owns the engine, persists accounts/history, applies engine
//! events to the registration and call state machines, and tells the UI.
//!
//! All telephony logic lives here, in Rust: calls keep working (and incoming calls
//! are still announced) when the webview is hidden or reloading.

use std::{collections::HashMap, sync::Arc, time::Duration};

use chrono::Utc;
use secrecy::SecretString;
use serde::Serialize;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use super::{
    calls::{CallContext, CallTracker, CallUpdate},
    engine::{AccountSpec, EngineEvent, EngineOptions, EngineState, SipEngine},
    registration,
    types::{
        Account, AccountInput, AccountStatus, AccountView, Call, CallResult, CallState,
        RegistrationState, Settings,
    },
    uri,
};
use crate::{
    database::Database,
    error::{AppError, AppResult},
    security::secrets::SecretStore,
};

/// Everything the manager needs to tell the outside world (UI events, OS notifications).
pub trait UiSink: Send + Sync + 'static {
    fn engine_state(&self, info: &EngineInfo);
    fn account_status(&self, status: &AccountStatus);
    fn call_update(&self, call: &Call);
    fn history_changed(&self);
    /// A new incoming call: bring the window up and (if `notify`) raise an OS notification.
    fn incoming_call(&self, call: &Call, notify: bool);
    fn missed_call(&self, call: &Call, notify: bool);
    fn audio_error(&self, message: &str);
    /// Live level of a call's audio in dBFS (`tx` = our microphone). Frequent: keep it cheap.
    fn audio_level(&self, _call_id: &str, _tx: bool, _db: f32) {}
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub name: String,
    pub version: Option<String>,
    pub codecs: Vec<String>,
    #[serde(flatten)]
    pub state: EngineState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub engine: EngineInfo,
    pub accounts: Vec<AccountView>,
    pub statuses: Vec<AccountStatus>,
    pub calls: Vec<Call>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsApplied {
    pub settings: Settings,
    /// Some changes (network, TLS, SIP port) only take effect after an engine restart.
    pub restart_required: bool,
}

/// Account as hosted by the engine right now.
#[derive(Debug, Clone)]
struct Hosted {
    account_id: String,
    label: String,
    register_interval: u32,
}

#[derive(Default)]
struct State {
    statuses: HashMap<String, AccountStatus>,
    /// normalized AoR -> hosted account
    hosted: HashMap<String, Hosted>,
    tracker: CallTracker,
}

pub type OptionsHook = Arc<dyn Fn(EngineOptions) -> EngineOptions + Send + Sync>;

pub struct SipManager {
    /// Set when the application is quitting: engine events are no longer turned into UI work.
    closing: std::sync::atomic::AtomicBool,
    options_hook: std::sync::Mutex<Option<OptionsHook>>,
    engine: Arc<dyn SipEngine>,
    db: Arc<Database>,
    secrets: Arc<dyn SecretStore>,
    sink: Arc<dyn UiSink>,
    state: std::sync::Mutex<State>,
}

fn engine_options(s: &Settings) -> EngineOptions {
    EngineOptions {
        input_device: s.audio.input_device.clone(),
        output_device: s.audio.output_device.clone(),
        ca_file: s.network.custom_ca_file.clone().map(Into::into),
        sip_trace: s.network.sip_trace,
        local_sip_port: s.network.local_sip_port,
        net_interface: s.network.net_interface.clone(),
        audio_override: None,
    }
}

fn restart_needed(old: &Settings, new: &Settings) -> bool {
    old.network != new.network
}

fn engine_err(e: impl std::fmt::Display) -> AppError {
    AppError::Engine(e.to_string())
}

impl SipManager {
    pub fn new(
        engine: Arc<dyn SipEngine>,
        db: Arc<Database>,
        secrets: Arc<dyn SecretStore>,
        sink: Arc<dyn UiSink>,
    ) -> Arc<Self> {
        Arc::new(Self {
            closing: Default::default(),
            options_hook: Default::default(),
            engine,
            db,
            secrets,
            sink,
            state: Default::default(),
        })
    }

    /// Adjusts the engine options derived from the settings. Used by the end-to-end tests
    /// to swap the sound card for synthetic audio; the application never sets it.
    pub fn set_options_hook(&self, hook: OptionsHook) {
        *self.options_hook.lock().unwrap() = Some(hook);
    }

    fn options(&self, settings: &Settings) -> EngineOptions {
        let base = engine_options(settings);
        match self.options_hook.lock().unwrap().as_ref() {
            Some(hook) => hook(base),
            None => base,
        }
    }

    // ------------------------------------------------------------ lifecycle

    /// Loads accounts, subscribes to engine events and starts the engine. Accounts are
    /// connected when the engine reports `Running` (also after every automatic restart).
    pub async fn start(self: &Arc<Self>) -> AppResult<()> {
        let now = Utc::now();
        for acc in self.db.list_accounts()? {
            let st = if acc.enabled {
                registration::disconnected(&acc.id, None, now)
            } else {
                registration::disconnected(&acc.id, Some("Compte désactivé"), now)
            };
            self.state
                .lock()
                .unwrap()
                .statuses
                .insert(acc.id.clone(), st);
        }

        let settings = self.db.get_settings()?;
        self.engine.set_options(self.options(&settings));

        let mut rx = self.engine.subscribe();
        let me = self.clone();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(ev) => me.handle_event(ev).await,
                    Err(RecvError::Lagged(n)) => {
                        log::warn!("manager lagged behind the engine by {n} events")
                    }
                    Err(RecvError::Closed) => break,
                }
            }
        });

        self.engine.start().await.map_err(engine_err)
    }

    pub async fn restart_engine(self: &Arc<Self>) -> AppResult<()> {
        let settings = self.db.get_settings()?;
        self.engine.stop().await;
        self.engine.set_options(self.options(&settings));
        self.engine.start().await.map_err(engine_err)
    }

    /// Clean shutdown: end calls, unregister, stop the engine process.
    pub async fn shutdown(&self) {
        // From now on the engine's last events (unregistering, stopped...) must not touch the UI:
        // at exit the main thread may be busy waiting for us.
        self.closing
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let (call_ids, hosted): (Vec<String>, Vec<String>) = {
            let st = self.state.lock().unwrap();
            (
                st.tracker.active().into_iter().map(|c| c.id).collect(),
                st.hosted.keys().cloned().collect(),
            )
        };
        for id in call_ids {
            let _ = self.engine.hangup(&id, None).await;
        }
        for aor in hosted {
            let _ = self.engine.remove_account(&aor).await;
        }
        tokio::time::sleep(Duration::from_millis(300)).await; // let BYE/unREGISTER leave the socket
        self.engine.stop().await;
    }

    pub fn engine_info(&self) -> EngineInfo {
        EngineInfo {
            name: self.engine.name().to_owned(),
            version: self.engine.version(),
            codecs: self.engine.codecs(),
            state: self.engine.state(),
        }
    }

    pub fn log_tail(&self, lines: usize) -> Vec<String> {
        self.engine.log_tail(lines)
    }

    pub fn snapshot(&self) -> AppResult<Snapshot> {
        let st = self.state.lock().unwrap();
        let mut statuses: Vec<AccountStatus> = st.statuses.values().cloned().collect();
        statuses.sort_by(|a, b| a.account_id.cmp(&b.account_id));
        let calls = st.tracker.active();
        drop(st);
        Ok(Snapshot {
            engine: self.engine_info(),
            accounts: self.list_accounts()?,
            statuses,
            calls,
        })
    }

    // ------------------------------------------------------------- accounts

    pub fn list_accounts(&self) -> AppResult<Vec<AccountView>> {
        self.db
            .list_accounts()?
            .into_iter()
            .map(|account| {
                let has_password = self.secrets.get(&account.id)?.is_some();
                Ok(AccountView {
                    account,
                    has_password,
                })
            })
            .collect()
    }

    pub async fn save_account(self: &Arc<Self>, input: AccountInput) -> AppResult<AccountView> {
        let existing = match &input.id {
            Some(id) => Some(
                self.db
                    .get_account(id)?
                    .ok_or_else(|| AppError::NotFound("compte".into()))?,
            ),
            None => None,
        };
        let id = existing
            .as_ref()
            .map(|a| a.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let account =
            input.into_account(id.clone(), existing.as_ref().is_some_and(|a| a.is_default))?;
        let old_aor = existing.as_ref().map(|a| a.aor());

        if let Some(pw) = input.password.as_deref().filter(|p| !p.is_empty()) {
            self.secrets.set(&id, &SecretString::from(pw.to_owned()))?;
        }
        let stored = self.db.upsert_account(&account)?;

        // The AoR may have changed: drop the old user agent before reconnecting.
        if let Some(old) = old_aor {
            self.drop_hosted(&old).await;
        }
        let now = Utc::now();
        if stored.enabled {
            // Errors are reflected in the account status; saving itself succeeded.
            if let Err(e) = self.connect_account(&id).await {
                log::warn!("account {id} saved but not connected: {e}");
            }
        } else {
            self.set_status(registration::disconnected(
                &id,
                Some("Compte désactivé"),
                now,
            ));
        }
        let has_password = self.secrets.get(&id)?.is_some();
        Ok(AccountView {
            account: stored,
            has_password,
        })
    }

    pub async fn delete_account(&self, id: &str) -> AppResult<()> {
        if let Some(acc) = self.db.get_account(id)? {
            self.drop_hosted(&acc.aor()).await;
        }
        self.secrets.delete(id)?;
        self.db.delete_account(id)?;
        self.state.lock().unwrap().statuses.remove(id);
        Ok(())
    }

    pub fn set_default_account(&self, id: &str) -> AppResult<()> {
        self.db.set_default_account(id)
    }

    pub async fn set_account_enabled(self: &Arc<Self>, id: &str, enabled: bool) -> AppResult<()> {
        self.db.set_account_enabled(id, enabled)?;
        if enabled {
            self.connect_account(id).await
        } else {
            self.disconnect_account(id).await?;
            self.set_status(registration::disconnected(
                id,
                Some("Compte désactivé"),
                Utc::now(),
            ));
            Ok(())
        }
    }

    async fn drop_hosted(&self, aor: &str) {
        let key = uri::normalize_aor(aor);
        let was_hosted = self.state.lock().unwrap().hosted.remove(&key).is_some();
        if was_hosted {
            let _ = self.engine.remove_account(aor).await;
        }
    }

    pub async fn connect_account(&self, id: &str) -> AppResult<()> {
        let acc = self
            .db
            .get_account(id)?
            .ok_or_else(|| AppError::NotFound("compte".into()))?;
        if !acc.enabled {
            return Err(AppError::validation(
                "Le compte est désactivé : activez-le d'abord",
            ));
        }
        let now = Utc::now();
        self.drop_hosted(&acc.aor()).await;

        let password = self.secrets.get(id)?;
        if password.is_none() && acc.register_interval > 0 {
            self.set_status(registration::unconfigured(
                id,
                "Mot de passe manquant : renseignez-le dans les paramètres du compte",
                now,
            ));
            return Ok(());
        }
        let spec = build_spec(
            &acc,
            password.unwrap_or_else(|| SecretString::from(String::new())),
        );

        // Register the account as hosted *before* talking to the engine: its first
        // events can arrive before `add_account` returns.
        {
            let mut st = self.state.lock().unwrap();
            st.hosted.insert(
                uri::normalize_aor(&acc.aor()),
                Hosted {
                    account_id: acc.id.clone(),
                    label: acc.label.clone(),
                    register_interval: acc.register_interval,
                },
            );
        }
        self.set_status(registration::connecting(id, now));

        if let Err(e) = self.engine.add_account(&spec).await {
            self.state
                .lock()
                .unwrap()
                .hosted
                .remove(&uri::normalize_aor(&acc.aor()));
            let msg = e.to_string();
            self.set_status(AccountStatus {
                message: Some(msg.clone()),
                ..registration::status(id, RegistrationState::Error, Utc::now())
            });
            return Err(AppError::Engine(msg));
        }
        Ok(())
    }

    pub async fn disconnect_account(&self, id: &str) -> AppResult<()> {
        let acc = self
            .db
            .get_account(id)?
            .ok_or_else(|| AppError::NotFound("compte".into()))?;
        self.drop_hosted(&acc.aor()).await;
        self.set_status(registration::disconnected(id, None, Utc::now()));
        Ok(())
    }

    async fn connect_all_enabled(&self) {
        let accounts = match self.db.list_accounts() {
            Ok(a) => a,
            Err(e) => {
                log::error!("cannot load accounts: {e}");
                return;
            }
        };
        for acc in accounts.into_iter().filter(|a| a.enabled) {
            if let Err(e) = self.connect_account(&acc.id).await {
                log::warn!("cannot connect account {}: {e}", acc.id);
            }
        }
    }

    // ---------------------------------------------------------------- calls

    pub fn calls(&self) -> Vec<Call> {
        self.state.lock().unwrap().tracker.active()
    }

    fn pick_account(&self, account_id: Option<&str>) -> AppResult<Account> {
        let acc = match account_id {
            Some(id) => self
                .db
                .get_account(id)?
                .ok_or_else(|| AppError::NotFound("compte".into()))?,
            None => {
                let hosted: Vec<String> = self
                    .state
                    .lock()
                    .unwrap()
                    .hosted
                    .values()
                    .map(|h| h.account_id.clone())
                    .collect();
                let default = self.db.default_account()?;
                match default {
                    Some(d) if hosted.contains(&d.id) => d,
                    _ => {
                        let first = self
                            .db
                            .list_accounts()?
                            .into_iter()
                            .find(|a| hosted.contains(&a.id));
                        first.ok_or_else(|| {
                            AppError::validation("Aucun compte SIP n'est connecté")
                        })?
                    }
                }
            }
        };
        if !self
            .state
            .lock()
            .unwrap()
            .hosted
            .contains_key(&uri::normalize_aor(&acc.aor()))
        {
            return Err(AppError::validation(format!(
                "Le compte « {} » n'est pas connecté : connectez-le dans les paramètres",
                acc.label
            )));
        }
        Ok(acc)
    }

    pub async fn dial(&self, target: &str, account_id: Option<&str>) -> AppResult<Call> {
        let acc = self.pick_account(account_id)?;
        let target_uri = uri::normalize_target(target, &acc.domain)
            .map_err(|e| AppError::validation(format!("Destinataire invalide : {e}")))?;
        if self.calls().iter().any(|c| {
            matches!(
                c.state,
                CallState::Initializing | CallState::Dialing | CallState::Ringing
            ) && c.direction == super::types::CallDirection::Outgoing
        }) {
            return Err(AppError::validation(
                "Un appel sortant est déjà en cours d'établissement",
            ));
        }
        let id = self
            .engine
            .dial(&acc.aor(), &target_uri)
            .await
            .map_err(engine_err)?;

        let ctx = self.context_for(&acc.id, Some(&acc.label), &target_uri);
        let r = super::engine::CallRef {
            id: id.clone(),
            aor: acc.aor(),
            direction: super::types::CallDirection::Outgoing,
            peer_uri: target_uri,
            peer_name: None,
        };
        let call = self
            .state
            .lock()
            .unwrap()
            .tracker
            .register_outgoing(&r, &ctx, Utc::now());
        self.sink.call_update(&call);
        Ok(call)
    }

    fn known(&self, id: &str) -> AppResult<Call> {
        self.state
            .lock()
            .unwrap()
            .tracker
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound("appel".into()))
    }

    pub async fn answer(&self, id: &str) -> AppResult<()> {
        let call = self.known(id)?;
        if call.state != CallState::Incoming {
            return Err(AppError::validation(
                "Cet appel n'est pas un appel entrant en attente",
            ));
        }
        self.engine.accept(id).await.map_err(engine_err)
    }

    /// Declines an incoming call (603 Decline).
    pub async fn reject(&self, id: &str) -> AppResult<()> {
        let call = self.known(id)?;
        if call.state != CallState::Incoming {
            return Err(AppError::validation(
                "Cet appel n'est pas un appel entrant en attente",
            ));
        }
        self.state.lock().unwrap().tracker.mark_user_reject(id);
        self.engine.hangup(id, Some(603)).await.map_err(engine_err)
    }

    pub async fn hangup(&self, id: &str) -> AppResult<()> {
        self.known(id)?;
        self.state.lock().unwrap().tracker.mark_user_hangup(id);
        self.engine.hangup(id, None).await.map_err(engine_err)
    }

    pub async fn hold(&self, id: &str) -> AppResult<()> {
        let c = self.known(id)?;
        if !matches!(c.state, CallState::Connected | CallState::OnHold) || c.held_locally {
            return Err(AppError::validation(
                "Seul un appel connecté peut être mis en attente",
            ));
        }
        self.engine.hold(id).await.map_err(engine_err)?;
        self.emit_local_hold(id, true);
        Ok(())
    }

    pub async fn resume(&self, id: &str) -> AppResult<()> {
        let c = self.known(id)?;
        if !c.held_locally {
            return Err(AppError::validation("Cet appel n'est pas en attente"));
        }
        self.engine.resume(id).await.map_err(engine_err)?;
        self.emit_local_hold(id, false);
        Ok(())
    }

    fn emit_local_hold(&self, id: &str, held: bool) {
        let updated = self.state.lock().unwrap().tracker.set_local_hold(id, held);
        if let Some(call) = updated {
            self.sink.call_update(&call);
        }
    }

    pub async fn set_mute(&self, id: &str, muted: bool) -> AppResult<()> {
        self.known(id)?;
        self.engine.set_mute(id, muted).await.map_err(engine_err)?;
        let updated = self.state.lock().unwrap().tracker.set_muted(id, muted);
        if let Some(call) = updated {
            self.sink.call_update(&call);
        }
        Ok(())
    }

    pub async fn send_dtmf(&self, id: &str, digits: &str) -> AppResult<()> {
        let c = self.known(id)?;
        if !matches!(c.state, CallState::Connected | CallState::OnHold) {
            return Err(AppError::validation(
                "Les tonalités ne peuvent être envoyées que pendant un appel établi",
            ));
        }
        self.engine.send_dtmf(id, digits).await.map_err(engine_err)
    }

    pub async fn transfer(&self, id: &str, target: &str) -> AppResult<()> {
        let c = self.known(id)?;
        if !matches!(c.state, CallState::Connected | CallState::OnHold) {
            return Err(AppError::validation(
                "Seul un appel établi peut être transféré",
            ));
        }
        let domain = c
            .account_id
            .as_deref()
            .and_then(|a| self.db.get_account(a).ok().flatten())
            .map(|a| a.domain)
            .unwrap_or_else(|| "invalid".into());
        let uri = uri::normalize_target(target, &domain).map_err(|e| {
            AppError::validation(format!("Destinataire du transfert invalide : {e}"))
        })?;
        self.engine.transfer(id, &uri).await.map_err(engine_err)
    }

    // ------------------------------------------------------------- settings

    pub fn settings(&self) -> AppResult<Settings> {
        self.db.get_settings()
    }

    pub async fn update_settings(&self, new: Settings) -> AppResult<SettingsApplied> {
        let old = self.db.get_settings()?;
        self.db.save_settings(&new)?;
        let mut restart_required = false;
        self.engine.set_options(self.options(&new));
        if old.audio != new.audio
            && let Err(e) = self
                .engine
                .set_audio_devices(
                    new.audio.input_device.as_deref(),
                    new.audio.output_device.as_deref(),
                )
                .await
        {
            // Unknown device: keep the choice stored (it may be unplugged now) but tell the UI.
            self.sink.audio_error(&e.to_string());
        }
        if restart_needed(&old, &new) {
            restart_required = true;
        }
        Ok(SettingsApplied {
            settings: new,
            restart_required,
        })
    }

    // --------------------------------------------------------------- events

    fn set_status(&self, status: AccountStatus) {
        self.state
            .lock()
            .unwrap()
            .statuses
            .insert(status.account_id.clone(), status.clone());
        self.sink.account_status(&status);
    }

    fn context_for(&self, account_id: &str, label: Option<&str>, remote: &str) -> CallContext {
        let contact_name = self
            .db
            .find_contact_by_number(remote)
            .ok()
            .flatten()
            .map(|c| c.display_name());
        CallContext {
            account_id: Some(account_id.to_owned()),
            account_label: label.map(str::to_owned),
            contact_name,
        }
    }

    fn finish(&self, update: CallUpdate) {
        let CallUpdate { call, history, .. } = update;
        self.sink.call_update(&call);
        if let Some(h) = history {
            if let Err(e) = self.db.insert_history(&h) {
                log::error!("cannot save call history: {e}");
            } else {
                self.sink.history_changed();
            }
            if h.result == CallResult::Missed {
                let notify = self
                    .db
                    .get_settings()
                    .map(|s| s.notifications.missed_call)
                    .unwrap_or(true);
                self.sink.missed_call(&call, notify);
            }
        }
    }

    pub(crate) async fn handle_event(self: &Arc<Self>, ev: EngineEvent) {
        if self.closing.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let now = Utc::now();
        match ev {
            EngineEvent::State(st) => {
                self.sink.engine_state(&self.engine_info());
                match st {
                    EngineState::Running => self.connect_all_enabled().await,
                    EngineState::Starting => {}
                    ref other => {
                        let (ids, ended) = {
                            let mut s = self.state.lock().unwrap();
                            s.hosted.clear();
                            let ids: Vec<String> = s.statuses.keys().cloned().collect();
                            (ids, s.tracker.abort_all("Moteur SIP interrompu", now))
                        };
                        for u in ended {
                            self.finish(u);
                        }
                        for id in ids {
                            let enabled = self
                                .db
                                .get_account(&id)
                                .ok()
                                .flatten()
                                .map(|a| a.enabled)
                                .unwrap_or(false);
                            if !enabled {
                                continue;
                            }
                            if let Some(s) = registration::status_for_engine_state(&id, other, now)
                            {
                                self.set_status(s);
                            }
                        }
                    }
                }
            }
            EngineEvent::Registration { aor, event } => {
                let key = uri::normalize_aor(&aor);
                let Some(h) = self.state.lock().unwrap().hosted.get(&key).cloned() else {
                    return;
                };
                let prev = self
                    .state
                    .lock()
                    .unwrap()
                    .statuses
                    .get(&h.account_id)
                    .cloned()
                    .unwrap_or_else(|| registration::connecting(&h.account_id, now));
                let next =
                    registration::apply_registration_event(&prev, &event, h.register_interval, now);
                if next.state != prev.state
                    || next.sip_code != prev.sip_code
                    || next.message != prev.message
                    || next.reason != prev.reason
                {
                    self.set_status(next);
                }
            }
            EngineEvent::Call { call: r, event } => {
                let hosted = self
                    .state
                    .lock()
                    .unwrap()
                    .hosted
                    .get(&uri::normalize_aor(&r.aor))
                    .cloned();
                let ctx = match &hosted {
                    Some(h) => self.context_for(&h.account_id, Some(&h.label), &r.peer_uri),
                    None => CallContext::default(),
                };
                let update = self
                    .state
                    .lock()
                    .unwrap()
                    .tracker
                    .apply(&r, &event, &ctx, now);
                let Some(update) = update else { return };
                if update.history.is_some() {
                    self.finish(update);
                    return;
                }
                self.sink.call_update(&update.call);
                if event == super::engine::CallEvent::Established {
                    // Baresip holds the other calls when this one becomes active.
                    let held = self.state.lock().unwrap().tracker.hold_others(&r.id);
                    for c in held {
                        self.sink.call_update(&c);
                    }
                }
                if update.is_new_incoming {
                    let s = self.db.get_settings().unwrap_or_default();
                    self.sink
                        .incoming_call(&update.call, s.notifications.incoming_call);
                    if !s.notifications.ringtone {
                        let _ = self.engine.silence_ringtone().await;
                    }
                }
            }
            EngineEvent::AudioLevel { call_id, tx, db } => {
                // Only for calls we know about (late reports of a finished call are dropped).
                let known = self.state.lock().unwrap().tracker.get(&call_id).is_some();
                if known {
                    self.sink.audio_level(&call_id, tx, db);
                }
            }
            EngineEvent::AudioError { message, .. } => self.sink.audio_error(&message),
        }
    }
}

fn build_spec(acc: &Account, password: SecretString) -> AccountSpec {
    let (host, port) = match acc.outbound_proxy.as_deref() {
        Some(p) => {
            let (h, port) = uri::split_host_port(p).unwrap_or_else(|_| (p.to_owned(), None));
            (h, port.unwrap_or_else(|| acc.transport.default_port()))
        }
        None => (acc.server.clone(), acc.port),
    };
    AccountSpec {
        aor: acc.aor(),
        username: acc.username.clone(),
        domain: acc.domain.clone(),
        auth_username: acc.auth_username.clone(),
        password,
        display_name: acc.display_name.clone(),
        transport: acc.transport,
        next_hop_host: host,
        next_hop_port: port,
        register_interval: acc.register_interval,
        media_encryption: acc.media_encryption,
    }
}

#[cfg(test)]
mod tests;
