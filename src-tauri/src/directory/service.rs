//! The directory as the rest of the application uses it: one object that owns the cache, the in-memory index
//! and the schedule of synchronisations, and tells the UI when something changed.
//!
//! Synchronisations run in their own tasks: a slow or failing source never blocks the interface or the search.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use chrono::{DateTime, Utc};
use secrecy::SecretString;

use super::{
    index::{Index, SearchContext, SourceMeta},
    model::{
        Contact, DepartmentCount, DirectoryPage, DirectoryQuery, GroupView, LOCAL_SOURCE_ID,
        PhoneEntry, PhoneKind, RemoteContact, SourceKind, SourceState, SourceView, SyncErrorKind,
        contact_id,
    },
    normalize::is_sip_address,
    store::{ApplyReport, DirectoryStore, SourceRow},
    sync::{
        ConnectorFactory, SyncError, backoff_delay, is_due, is_expired, needs_the_user, secret_key,
    },
};
use crate::{
    database::Database,
    error::{AppError, AppResult},
    security::secrets::SecretStore,
};

/// How the directory tells the outside world something changed (the UI re-reads what it shows).
pub trait DirectoryEvents: Send + Sync + 'static {
    fn changed(&self) {}
}

/// The secrets a source can have in the credential store.
const SECRET_NAMES: [&str; 2] = ["password", "refresh_token"];

/// The scheduler looks at the sources this often.
const TICK: Duration = Duration::from_secs(30);

struct Backoff {
    failures: u32,
    until: Option<DateTime<Utc>>,
}

pub struct DirectoryService {
    db: Arc<Database>,
    store: DirectoryStore,
    secrets: Arc<dyn SecretStore>,
    events: Arc<dyn DirectoryEvents>,
    factory: Arc<dyn ConnectorFactory>,
    index: RwLock<Index>,
    /// Sources being synchronised right now.
    running: Mutex<HashSet<String>>,
    backoff: Mutex<HashMap<String, Backoff>>,
}

/// A local address-book entry, as the directory sees it.
fn local_remote(c: &crate::sip::types::Contact) -> RemoteContact {
    RemoteContact {
        external_id: c.id.clone(),
        first_name: c.first_name.clone(),
        last_name: c.last_name.clone(),
        display_name: c.display_name(),
        company: c.company.clone(),
        phones: vec![PhoneEntry::new(
            if is_sip_address(&c.number) {
                PhoneKind::Sip
            } else {
                PhoneKind::Other
            },
            c.number.clone(),
        )],
        ..Default::default()
    }
}

impl DirectoryService {
    pub fn new(
        db: Arc<Database>,
        secrets: Arc<dyn SecretStore>,
        events: Arc<dyn DirectoryEvents>,
        factory: Arc<dyn ConnectorFactory>,
    ) -> Arc<Self> {
        let svc = Arc::new(Self {
            store: DirectoryStore::new(db.clone()),
            db,
            secrets,
            events,
            factory,
            index: RwLock::new(Index::build(Vec::new(), &HashMap::new())),
            running: Mutex::default(),
            backoff: Mutex::default(),
        });
        if let Err(e) = svc.rebuild_index() {
            log::warn!("directory index not built: {e}");
        }
        svc
    }

    pub fn store(&self) -> &DirectoryStore {
        &self.store
    }

    // ------------------------------------------------------------- index

    /// Rebuilds the searchable view from the cache and the local address book.
    pub fn rebuild_index(&self) -> AppResult<()> {
        let mut metas: HashMap<String, SourceMeta> = self
            .store
            .list_sources()?
            .into_iter()
            .map(|s| {
                (
                    s.id,
                    SourceMeta {
                        name: s.name,
                        kind: s.kind,
                    },
                )
            })
            .collect();
        metas.insert(
            LOCAL_SOURCE_ID.to_owned(),
            SourceMeta {
                name: "Contacts locaux".into(),
                kind: SourceKind::Local,
            },
        );
        let mut contacts = self.store.all_contacts()?;
        for c in self.db.list_contacts(None)? {
            contacts.push(Contact {
                id: contact_id(LOCAL_SOURCE_ID, &c.id),
                source_id: LOCAL_SOURCE_ID.into(),
                remote: local_remote(&c),
            });
        }
        *self.index.write().unwrap() = Index::build(contacts, &metas);
        Ok(())
    }

    /// The local address book was edited.
    pub fn contacts_changed(&self) {
        if let Err(e) = self.rebuild_index() {
            log::warn!("directory index not rebuilt: {e}");
        }
        self.events.changed();
    }

    pub fn search(&self, q: &DirectoryQuery) -> AppResult<DirectoryPage> {
        let favorites = self.store.favorites()?;
        let memberships = self.store.memberships()?;
        let members = q
            .group_id
            .as_deref()
            .map(|g| self.store.members(g))
            .transpose()?;
        let index = self.index.read().unwrap();
        Ok(index.search(
            q,
            &SearchContext {
                favorites: &favorites,
                memberships: &memberships,
                group_members: members.as_ref(),
            },
        ))
    }

    pub fn departments(&self) -> Vec<DepartmentCount> {
        self.index.read().unwrap().departments()
    }

    // ------------------------------------------------------------- sources

    fn view(&self, s: &SourceRow, now: DateTime<Utc>) -> SourceView {
        let syncing = self.running.lock().unwrap().contains(&s.id);
        let count = self.store.contact_count(&s.id).unwrap_or(0);
        let state = if !s.enabled {
            SourceState::Disabled
        } else if syncing {
            SourceState::Syncing
        } else if s.error_kind == Some(SyncErrorKind::Auth) {
            SourceState::NeedsReauth
        } else if s.error_kind.is_some() {
            SourceState::Error
        } else {
            SourceState::Idle
        };
        SourceView {
            id: s.id.clone(),
            kind: s.kind,
            name: s.name.clone(),
            enabled: s.enabled,
            read_only: s.kind.read_only(),
            state,
            contact_count: count,
            last_success_at: s.last_success_at.clone(),
            last_attempt_at: s.last_attempt_at.clone(),
            last_error: s.last_error.clone(),
            error_kind: s.error_kind,
            sync_interval_min: s.sync_interval_min,
            stale: s.enabled && count > 0 && is_expired(s, now),
            config: s.config.clone(),
        }
    }

    /// The local address book first, then the connected sources.
    pub fn sources(&self) -> AppResult<Vec<SourceView>> {
        let now = Utc::now();
        let local = SourceView {
            id: LOCAL_SOURCE_ID.into(),
            kind: SourceKind::Local,
            name: "Contacts locaux".into(),
            enabled: true,
            read_only: false,
            state: SourceState::Idle,
            contact_count: self.db.list_contacts(None)?.len(),
            last_success_at: None,
            last_attempt_at: None,
            last_error: None,
            error_kind: None,
            sync_interval_min: 0,
            stale: false,
            config: serde_json::json!({}),
        };
        let mut out = vec![local];
        for s in self.store.list_sources()? {
            out.push(self.view(&s, now));
        }
        Ok(out)
    }

    pub fn source(&self, id: &str) -> AppResult<SourceView> {
        let row = self
            .store
            .get_source(id)?
            .ok_or_else(|| AppError::NotFound("source".into()))?;
        Ok(self.view(&row, Utc::now()))
    }

    /// Creates a source. Its secret (password, token), if any, goes to the credential store, never to the
    /// database.
    pub fn add_source(
        &self,
        kind: SourceKind,
        name: &str,
        config: &serde_json::Value,
        sync_interval_min: u32,
        secret: Option<(&str, &SecretString)>,
    ) -> AppResult<String> {
        if kind == SourceKind::Local {
            return Err(AppError::validation("La source locale existe déjà"));
        }
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(AppError::validation(
                "Le nom de la source doit faire de 1 à 80 caractères",
            ));
        }
        let id = self
            .store
            .insert_source(kind, name, config, sync_interval_min, true)?;
        if let Some((what, value)) = secret
            && let Err(e) = self.set_secret(&id, what, value)
        {
            let _ = self.store.delete_source(&id);
            return Err(e);
        }
        self.events.changed();
        Ok(id)
    }

    pub fn set_secret(&self, source_id: &str, what: &str, value: &SecretString) -> AppResult<()> {
        self.secrets.set(&secret_key(source_id, what), value)
    }

    /// Changes the name, the schedule or the configuration of a source. A new configuration starts the
    /// synchronisation over, so it is also what forgets an old failure.
    pub fn update_source(
        &self,
        id: &str,
        name: &str,
        enabled: bool,
        sync_interval_min: u32,
        config: Option<&serde_json::Value>,
    ) -> AppResult<()> {
        self.store
            .update_source(id, name.trim(), enabled, sync_interval_min, config)?;
        if config.is_some() {
            self.store.clear_failure(id)?;
            self.backoff.lock().unwrap().remove(id);
        }
        self.rebuild_index()?;
        self.events.changed();
        Ok(())
    }

    /// The user signed in again: the failure no longer applies, and the source is on again.
    pub fn reconnected(&self, id: &str) -> AppResult<()> {
        let row = self
            .store
            .get_source(id)?
            .ok_or_else(|| AppError::NotFound("source".into()))?;
        self.store.clear_failure(id)?;
        self.store
            .update_source(id, &row.name, true, row.sync_interval_min, None)?;
        self.backoff.lock().unwrap().remove(id);
        self.events.changed();
        Ok(())
    }

    fn forget_secrets(&self, id: &str) {
        for what in SECRET_NAMES {
            if let Err(e) = self.secrets.delete(&secret_key(id, what)) {
                log::warn!("a directory secret could not be deleted: {e}");
            }
        }
    }

    /// Disconnects a source: its secrets and its cached contacts are erased and it is switched off. The
    /// personal favourites and groups stay, and come back if the source is connected again.
    pub fn disconnect(&self, id: &str) -> AppResult<()> {
        let row = self
            .store
            .get_source(id)?
            .ok_or_else(|| AppError::NotFound("source".into()))?;
        self.forget_secrets(id);
        self.store.clear_cache(id)?;
        self.store.clear_failure(id)?;
        self.store
            .update_source(id, &row.name, false, row.sync_interval_min, None)?;
        self.backoff.lock().unwrap().remove(id);
        self.rebuild_index()?;
        self.events.changed();
        Ok(())
    }

    /// Deletes a source for good, with its secrets, its cache and the personal data about its contacts.
    pub fn remove_source(&self, id: &str) -> AppResult<()> {
        self.forget_secrets(id);
        self.store.delete_source(id)?;
        self.backoff.lock().unwrap().remove(id);
        self.rebuild_index()?;
        self.events.changed();
        Ok(())
    }

    /// Erases the cache of a source but keeps it connected: the next synchronisation reads everything again.
    pub fn clear_cache(&self, id: &str) -> AppResult<()> {
        self.store.clear_cache(id)?;
        self.rebuild_index()?;
        self.events.changed();
        Ok(())
    }

    // ------------------------------------------------------------- synchronisation

    /// Synchronises one source now. `manual` is a request of the user: it does not wait for a back-off.
    pub async fn sync_now(self: &Arc<Self>, id: &str, manual: bool) -> AppResult<ApplyReport> {
        let row = self
            .store
            .get_source(id)?
            .ok_or_else(|| AppError::NotFound("source".into()))?;
        if !row.enabled && !manual {
            return Err(AppError::validation("La source est désactivée"));
        }
        if !self.running.lock().unwrap().insert(id.to_owned()) {
            return Err(AppError::validation(
                "Une synchronisation de cette source est déjà en cours",
            ));
        }
        let _ = self.store.record_attempt(id);
        self.events.changed();

        let outcome = self.read_and_apply(&row).await;

        let result = match outcome {
            Ok(report) => {
                self.backoff.lock().unwrap().remove(id);
                if let Err(e) = self.rebuild_index() {
                    log::warn!("directory index not rebuilt: {e}");
                }
                log::info!(
                    "directory sync ({}): {} added, {} updated, {} removed, {} in cache",
                    row.kind.as_str(),
                    report.added,
                    report.updated,
                    report.removed,
                    report.total
                );
                Ok(report)
            }
            Err(e) => {
                // A failure is a note on the source. The cache is exactly as it was.
                let _ = self.store.record_failure(id, e.kind, &e.message);
                self.note_failure(id, &e);
                log::warn!(
                    "directory sync ({}) failed: {:?}",
                    row.kind.as_str(),
                    e.kind
                );
                Err(AppError::Other(e.message))
            }
        };
        self.running.lock().unwrap().remove(id);
        self.events.changed();
        result
    }

    fn note_failure(&self, id: &str, e: &SyncError) {
        let mut map = self.backoff.lock().unwrap();
        let b = map.entry(id.to_owned()).or_insert(Backoff {
            failures: 0,
            until: None,
        });
        b.failures = b.failures.saturating_add(1);
        b.until = (!needs_the_user(e.kind)).then(|| {
            let wait = e.retry_after.unwrap_or_else(|| backoff_delay(b.failures));
            Utc::now() + chrono::Duration::from_std(wait).unwrap_or(chrono::Duration::hours(1))
        });
    }

    async fn read_and_apply(&self, row: &SourceRow) -> Result<ApplyReport, SyncError> {
        let connector = self.factory.build(row, self.secrets.clone())?;
        let mut fetched = connector.fetch(row.cursor.as_deref(), &|_| {}).await?;
        // Records without a name or without any way to reach the person are of no use in a phone directory.
        fetched.contacts.retain(RemoteContact::is_useful);

        let storage = |e: AppError| SyncError::new(SyncErrorKind::Invalid, e.to_string());
        if fetched.complete {
            let cached = self.store.contact_count(&row.id).map_err(storage)?;
            if fetched.contacts.is_empty() && cached > 0 {
                // A source that suddenly answers "nobody" is far more likely to be misconfigured, restricted or
                // failing than to have lost everyone: keep what we have, and say so.
                return Err(SyncError::new(
                    SyncErrorKind::Invalid,
                    format!(
                        "La source n'a renvoyé aucun contact alors que {cached} sont en mémoire : rien n'a été supprimé. \
                         Vérifiez la configuration, ou effacez la mémoire locale de cette source."
                    ),
                ));
            }
            self.store
                .apply_snapshot(&row.id, &fetched.contacts, fetched.cursor.as_deref())
                .map_err(storage)
        } else {
            self.store
                .apply_delta(
                    &row.id,
                    &fetched.contacts,
                    &fetched.removed,
                    fetched.cursor.as_deref(),
                )
                .map_err(storage)
        }
    }

    /// Starts a synchronisation in its own task and returns at once.
    pub fn spawn_sync(self: &Arc<Self>, id: String, manual: bool) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let _ = me.sync_now(&id, manual).await;
        });
    }

    // ------------------------------------------------------------- schedule

    /// Erases the cache of every source that has gone [`CACHE_MAX_AGE_DAYS`](super::sync::CACHE_MAX_AGE_DAYS)
    /// without a successful synchronisation.
    pub fn expire_caches(&self, now: DateTime<Utc>) -> AppResult<Vec<String>> {
        let mut erased = Vec::new();
        for s in self.store.list_sources()? {
            if is_expired(&s, now) && self.store.contact_count(&s.id)? > 0 {
                self.store.clear_cache(&s.id)?;
                let _ = self.store.record_failure(
                    &s.id,
                    SyncErrorKind::Network,
                    "La mémoire locale a été effacée : la source n'a pas pu être synchronisée depuis plus de 30 jours.",
                );
                erased.push(s.id);
            }
        }
        if !erased.is_empty() {
            self.rebuild_index()?;
            self.events.changed();
        }
        Ok(erased)
    }

    /// One look at the schedule: erases expired caches, then starts the synchronisations that are due. Returns
    /// the sources it started.
    pub fn tick(self: &Arc<Self>, now: DateTime<Utc>) -> Vec<String> {
        if let Err(e) = self.expire_caches(now) {
            log::warn!("directory cache expiry failed: {e}");
        }
        let Ok(sources) = self.store.list_sources() else {
            return Vec::new();
        };
        let mut started = Vec::new();
        for s in sources {
            let until = self
                .backoff
                .lock()
                .unwrap()
                .get(&s.id)
                .and_then(|b| b.until);
            let busy = self.running.lock().unwrap().contains(&s.id);
            if !busy && is_due(&s, now, until) {
                self.spawn_sync(s.id.clone(), false);
                started.push(s.id);
            }
        }
        started
    }

    /// Runs the schedule for the lifetime of the application.
    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(TICK);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                me.tick(Utc::now());
            }
        });
    }

    // ------------------------------------------------------------- favourites and groups

    pub fn set_favorite(&self, ids: &[String], favorite: bool) -> AppResult<()> {
        self.store.set_favorite(ids, favorite)?;
        self.events.changed();
        Ok(())
    }

    pub fn groups(&self) -> AppResult<Vec<GroupView>> {
        self.store.groups()
    }

    pub fn create_group(&self, name: &str) -> AppResult<GroupView> {
        let g = self.store.create_group(name)?;
        self.events.changed();
        Ok(g)
    }

    pub fn rename_group(&self, id: &str, name: &str) -> AppResult<()> {
        self.store.rename_group(id, name)?;
        self.events.changed();
        Ok(())
    }

    pub fn delete_group(&self, id: &str) -> AppResult<()> {
        self.store.delete_group(id)?;
        self.events.changed();
        Ok(())
    }

    pub fn add_to_group(&self, group_id: &str, ids: &[String]) -> AppResult<()> {
        self.store.add_to_group(group_id, ids)?;
        self.events.changed();
        Ok(())
    }

    pub fn remove_from_group(&self, group_id: &str, ids: &[String]) -> AppResult<()> {
        self.store.remove_from_group(group_id, ids)?;
        self.events.changed();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use async_trait::async_trait;

    use super::*;
    use crate::{
        directory::sync::{Connector, Fetched},
        security::secrets::MemoryStore,
        sip::types::ContactInput,
    };

    /// A connector that answers what the test scripted, and notes the cursors it was given.
    #[derive(Default)]
    struct Script {
        answers: Mutex<VecDeque<Result<Fetched, SyncError>>>,
        cursors: Mutex<Vec<Option<String>>>,
        delay: Mutex<Duration>,
    }

    impl Script {
        fn push(&self, a: Result<Fetched, SyncError>) {
            self.answers.lock().unwrap().push_back(a);
        }
    }

    struct FakeConnector(Arc<Script>);

    #[async_trait]
    impl Connector for FakeConnector {
        async fn fetch(
            &self,
            cursor: Option<&str>,
            _progress: &(dyn Fn(usize) + Send + Sync),
        ) -> Result<Fetched, SyncError> {
            self.0
                .cursors
                .lock()
                .unwrap()
                .push(cursor.map(str::to_owned));
            let delay = *self.0.delay.lock().unwrap();
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            self.0
                .answers
                .lock()
                .unwrap()
                .pop_front()
                .expect("a scripted answer")
        }
    }

    struct FakeFactory {
        script: Arc<Script>,
        refuse: Mutex<Option<SyncError>>,
    }

    impl ConnectorFactory for FakeFactory {
        fn build(
            &self,
            _source: &SourceRow,
            _secrets: Arc<dyn SecretStore>,
        ) -> Result<Box<dyn Connector>, SyncError> {
            if let Some(e) = self.refuse.lock().unwrap().clone() {
                return Err(e);
            }
            Ok(Box::new(FakeConnector(self.script.clone())))
        }
    }

    #[derive(Default)]
    struct Counter(AtomicUsize);
    impl DirectoryEvents for Counter {
        fn changed(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct Rig {
        svc: Arc<DirectoryService>,
        script: Arc<Script>,
        factory: Arc<FakeFactory>,
        secrets: Arc<MemoryStore>,
        events: Arc<Counter>,
        db: Arc<Database>,
    }

    fn rig() -> Rig {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let script = Arc::new(Script::default());
        let factory = Arc::new(FakeFactory {
            script: script.clone(),
            refuse: Mutex::new(None),
        });
        let secrets = Arc::new(MemoryStore::default());
        let events = Arc::new(Counter::default());
        let svc =
            DirectoryService::new(db.clone(), secrets.clone(), events.clone(), factory.clone());
        Rig {
            svc,
            script,
            factory,
            secrets,
            events,
            db,
        }
    }

    fn person(id: &str, name: &str, number: &str) -> RemoteContact {
        RemoteContact {
            external_id: id.into(),
            display_name: name.into(),
            phones: vec![PhoneEntry::new(PhoneKind::Work, number)],
            ..Default::default()
        }
    }

    fn snapshot(people: Vec<RemoteContact>) -> Result<Fetched, SyncError> {
        Ok(Fetched {
            contacts: people,
            complete: true,
            ..Default::default()
        })
    }

    fn add_ldap(r: &Rig) -> String {
        r.svc
            .add_source(
                SourceKind::Ldap,
                "Annuaire",
                &serde_json::json!({"url": "ldaps://ldap.example.com"}),
                60,
                Some(("password", &SecretString::from("s3cret".to_string()))),
            )
            .unwrap()
    }

    fn names(r: &Rig, text: &str) -> Vec<String> {
        r.svc
            .search(&DirectoryQuery {
                text: text.into(),
                ..Default::default()
            })
            .unwrap()
            .items
            .into_iter()
            .map(|e| e.display_name)
            .collect()
    }

    fn state_of(r: &Rig, id: &str) -> SourceState {
        r.svc.source(id).unwrap().state
    }

    #[tokio::test]
    async fn a_synchronisation_fills_the_directory() {
        let r = rig();
        let id = add_ldap(&r);
        r.script.push(snapshot(vec![
            person("1", "Élodie Dupont", "01 23 45 67 89"),
            person("2", "Bob Martin", "4567"),
        ]));
        let report = r.svc.sync_now(&id, true).await.unwrap();
        assert_eq!((report.added, report.total), (2, 2));
        assert_eq!(names(&r, "elodie"), vec!["Élodie Dupont"]);
        let v = r.svc.source(&id).unwrap();
        assert_eq!((v.state, v.contact_count), (SourceState::Idle, 2));
        assert!(v.last_success_at.is_some());
        assert!(r.events.0.load(Ordering::SeqCst) > 0, "the UI is told");
    }

    #[tokio::test]
    async fn a_source_outage_never_empties_the_directory() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();

        r.script.push(Err(SyncError::new(
            SyncErrorKind::Network,
            "Serveur injoignable",
        )));
        assert!(r.svc.sync_now(&id, true).await.is_err());

        assert_eq!(
            names(&r, "elodie"),
            vec!["Élodie Dupont"],
            "the contacts are still there"
        );
        let v = r.svc.source(&id).unwrap();
        assert_eq!(v.state, SourceState::Error);
        assert_eq!(v.error_kind, Some(SyncErrorKind::Network));
        assert_eq!(v.last_error.as_deref(), Some("Serveur injoignable"));
        assert!(
            v.last_success_at.is_some(),
            "the last good synchronisation is remembered"
        );
        assert_eq!(v.contact_count, 1);
    }

    #[tokio::test]
    async fn an_authentication_error_asks_to_reconnect_and_is_never_retried_on_its_own() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        r.script.push(Err(SyncError::new(
            SyncErrorKind::Auth,
            "Connexion refusée : reconnectez la source.",
        )));
        assert!(r.svc.sync_now(&id, true).await.is_err());
        assert_eq!(state_of(&r, &id), SourceState::NeedsReauth);
        assert_eq!(names(&r, "elodie").len(), 1, "still searchable");

        // a month later the scheduler still leaves it alone
        let later = Utc::now() + chrono::Duration::days(3);
        assert!(r.svc.tick(later).is_empty());

        // the user reconnects: the failure is forgotten and the source is on
        r.svc.reconnected(&id).unwrap();
        assert_eq!(state_of(&r, &id), SourceState::Idle);
        assert_eq!(r.svc.tick(later), vec![id]);
    }

    #[tokio::test]
    async fn a_contact_deleted_at_the_source_goes_only_after_a_successful_synchronisation() {
        let r = rig();
        let id = add_ldap(&r);
        r.script.push(snapshot(vec![
            person("1", "Élodie Dupont", "1"),
            person("2", "Bob Martin", "2"),
        ]));
        r.svc.sync_now(&id, true).await.unwrap();

        r.script.push(Err(SyncError::new(
            SyncErrorKind::Server,
            "Erreur du serveur",
        )));
        let _ = r.svc.sync_now(&id, true).await;
        assert_eq!(names(&r, "").len(), 2, "a failure deletes nothing");

        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        let report = r.svc.sync_now(&id, true).await.unwrap();
        assert_eq!(report.removed, 1);
        assert_eq!(names(&r, ""), vec!["Élodie Dupont"]);
    }

    #[tokio::test]
    async fn an_empty_answer_where_there_were_contacts_is_refused() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        r.script.push(snapshot(vec![]));
        let err = r.svc.sync_now(&id, true).await.unwrap_err();
        assert!(err.to_string().contains("rien n'a été supprimé"), "{err}");
        assert_eq!(names(&r, "").len(), 1);
        assert_eq!(
            r.svc.source(&id).unwrap().error_kind,
            Some(SyncErrorKind::Invalid)
        );
        // after erasing the memory on purpose, an empty directory is accepted
        r.svc.clear_cache(&id).unwrap();
        r.script.push(snapshot(vec![]));
        assert!(r.svc.sync_now(&id, true).await.is_ok());
    }

    #[tokio::test]
    async fn records_that_cannot_be_used_in_a_phone_directory_are_dropped() {
        let r = rig();
        let id = add_ldap(&r);
        let mut nameless = person("2", "", "123");
        nameless.display_name.clear();
        let mut no_number = person("3", "Sans Numéro", "1");
        no_number.phones.clear();
        r.script.push(snapshot(vec![
            person("1", "Élodie Dupont", "1"),
            nameless,
            no_number,
        ]));
        let report = r.svc.sync_now(&id, true).await.unwrap();
        assert_eq!(report.total, 1);
    }

    #[tokio::test]
    async fn favourites_and_groups_follow_a_person_through_every_update() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        let eid = names_ids(&r, "elodie");
        let g = r.svc.create_group("Direction").unwrap();
        r.svc.set_favorite(&eid, true).unwrap();
        r.svc.add_to_group(&g.id, &eid).unwrap();

        let mut moved = person("1", "Élodie Dupont-Martin", "999");
        moved.department = Some("Finance".into());
        r.script.push(snapshot(vec![moved]));
        r.svc.sync_now(&id, true).await.unwrap();

        let page = r
            .svc
            .search(&DirectoryQuery {
                text: "elodie".into(),
                ..Default::default()
            })
            .unwrap();
        let e = &page.items[0];
        assert_eq!(e.display_name, "Élodie Dupont-Martin");
        assert!(e.favorite);
        assert_eq!(e.groups, vec![g.id.clone()]);
        let in_group = r
            .svc
            .search(&DirectoryQuery {
                group_id: Some(g.id),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(in_group.total, 1);
    }

    fn names_ids(r: &Rig, text: &str) -> Vec<String> {
        r.svc
            .search(&DirectoryQuery {
                text: text.into(),
                ..Default::default()
            })
            .unwrap()
            .items
            .into_iter()
            .flat_map(|e| e.sources.into_iter().map(|s| s.record_id))
            .collect()
    }

    #[tokio::test]
    async fn deleting_a_group_keeps_its_contacts() {
        let r = rig();
        let id = add_ldap(&r);
        r.script.push(snapshot(vec![
            person("1", "Élodie Dupont", "1"),
            person("2", "Bob", "2"),
        ]));
        r.svc.sync_now(&id, true).await.unwrap();
        let g = r.svc.create_group("Clients").unwrap();
        r.svc.add_to_group(&g.id, &names_ids(&r, "")).unwrap();
        r.svc.delete_group(&g.id).unwrap();
        assert!(r.svc.groups().unwrap().is_empty());
        assert_eq!(names(&r, "").len(), 2);
    }

    #[tokio::test]
    async fn the_next_synchronisation_continues_from_the_cursor_and_applies_the_changes_only() {
        let r = rig();
        let id = add_ldap(&r);
        r.script.push(Ok(Fetched {
            contacts: vec![
                person("1", "Élodie Dupont", "1"),
                person("2", "Bob Martin", "2"),
            ],
            complete: true,
            cursor: Some("delta-1".into()),
            ..Default::default()
        }));
        r.svc.sync_now(&id, true).await.unwrap();
        r.script.push(Ok(Fetched {
            contacts: vec![person("3", "Chloé Bernard", "3")],
            removed: vec!["2".into()],
            complete: false,
            cursor: Some("delta-2".into()),
        }));
        let report = r.svc.sync_now(&id, true).await.unwrap();
        assert_eq!((report.added, report.removed, report.total), (1, 1, 2));
        assert_eq!(
            *r.script.cursors.lock().unwrap(),
            vec![None, Some("delta-1".to_owned())]
        );
        assert_eq!(names(&r, ""), vec!["Chloé Bernard", "Élodie Dupont"]);
    }

    #[tokio::test]
    async fn only_one_synchronisation_of_a_source_runs_at_a_time() {
        let r = rig();
        let id = add_ldap(&r);
        *r.script.delay.lock().unwrap() = Duration::from_millis(150);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        let svc = r.svc.clone();
        let first = {
            let id = id.clone();
            tokio::spawn(async move { svc.sync_now(&id, true).await })
        };
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(state_of(&r, &id), SourceState::Syncing);
        let second = r.svc.sync_now(&id, true).await;
        assert!(second.unwrap_err().to_string().contains("déjà en cours"));
        assert!(first.await.unwrap().is_ok());
        assert_eq!(state_of(&r, &id), SourceState::Idle);
    }

    #[tokio::test]
    async fn a_slow_source_does_not_block_searching() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        *r.script.delay.lock().unwrap() = Duration::from_millis(300);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        let svc = r.svc.clone();
        let slow = {
            let id = id.clone();
            tokio::spawn(async move { svc.sync_now(&id, true).await })
        };
        tokio::time::sleep(Duration::from_millis(30)).await;
        let started = std::time::Instant::now();
        assert_eq!(names(&r, "elodie").len(), 1);
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "search waited for the synchronisation"
        );
        slow.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn the_scheduler_backs_off_after_a_failure_instead_of_looping() {
        let r = rig();
        let id = add_ldap(&r);
        // an interval of one minute so that the interval itself is not what holds the source back
        r.svc.update_source(&id, "Annuaire", true, 1, None).unwrap();
        let t0 = Utc::now() + chrono::Duration::minutes(5);

        r.script
            .push(Err(SyncError::new(SyncErrorKind::Network, "Injoignable")));
        assert_eq!(r.svc.tick(t0), vec![id.clone()]);
        wait_idle(&r, &id).await;
        assert_eq!(r.script.cursors.lock().unwrap().len(), 1);

        // one failure: wait 1 minute; thirty seconds later nothing starts
        assert!(
            r.svc
                .tick(Utc::now() + chrono::Duration::seconds(30))
                .is_empty()
        );
        assert!(
            r.svc
                .tick(Utc::now() + chrono::Duration::seconds(30))
                .is_empty()
        );

        // a second failure doubles the wait
        r.script
            .push(Err(SyncError::new(SyncErrorKind::Network, "Injoignable")));
        assert_eq!(
            r.svc.tick(Utc::now() + chrono::Duration::minutes(2)),
            vec![id.clone()]
        );
        wait_idle(&r, &id).await;
        assert!(
            r.svc
                .tick(Utc::now() + chrono::Duration::seconds(90))
                .is_empty(),
            "2 minutes now"
        );
        assert_eq!(r.script.cursors.lock().unwrap().len(), 2);

        // success clears the back-off
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        assert_eq!(
            r.svc.tick(Utc::now() + chrono::Duration::minutes(5)),
            vec![id.clone()]
        );
        wait_idle(&r, &id).await;
        assert_eq!(state_of(&r, &id), SourceState::Idle);
    }

    async fn wait_idle(r: &Rig, id: &str) {
        for _ in 0..200 {
            if state_of(r, id) != SourceState::Syncing {
                tokio::time::sleep(Duration::from_millis(5)).await;
                if state_of(r, id) != SourceState::Syncing {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("synchronisation did not finish");
    }

    #[tokio::test]
    async fn a_throttled_source_is_left_alone_for_as_long_as_it_asked() {
        let r = rig();
        let id = add_ldap(&r);
        r.svc.update_source(&id, "Annuaire", true, 1, None).unwrap();
        let mut e = SyncError::new(SyncErrorKind::Throttled, "Trop de requêtes");
        e.retry_after = Some(Duration::from_secs(1800));
        r.script.push(Err(e));
        assert_eq!(
            r.svc.tick(Utc::now() + chrono::Duration::minutes(5)).len(),
            1
        );
        wait_idle(&r, &id).await;
        assert!(
            r.svc
                .tick(Utc::now() + chrono::Duration::minutes(20))
                .is_empty()
        );
        assert_eq!(
            r.svc.tick(Utc::now() + chrono::Duration::minutes(40)).len(),
            1
        );
    }

    #[tokio::test]
    async fn a_source_that_cannot_be_set_up_is_a_configuration_error_not_a_retry_loop() {
        let r = rig();
        let id = add_ldap(&r);
        *r.factory.refuse.lock().unwrap() = Some(SyncError::new(
            SyncErrorKind::Config,
            "Adresse du serveur invalide",
        ));
        assert!(r.svc.sync_now(&id, true).await.is_err());
        let v = r.svc.source(&id).unwrap();
        assert_eq!(
            (v.state, v.error_kind),
            (SourceState::Error, Some(SyncErrorKind::Config))
        );
        assert!(
            r.svc
                .tick(Utc::now() + chrono::Duration::days(1))
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_cache_that_could_not_be_refreshed_for_thirty_days_is_erased() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        assert!(r.svc.expire_caches(Utc::now()).unwrap().is_empty());

        let erased = r
            .svc
            .expire_caches(Utc::now() + chrono::Duration::days(31))
            .unwrap();
        assert_eq!(erased, vec![id.clone()]);
        assert!(names(&r, "").is_empty());
        let v = r.svc.source(&id).unwrap();
        assert!(v.last_error.unwrap().contains("effacée"));
        assert_eq!(v.contact_count, 0);
        assert!(!v.stale);
    }

    #[tokio::test]
    async fn the_cache_of_an_old_source_is_flagged_stale_before_it_expires() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        r.db.with(|c| {
            c.execute(
                "UPDATE dir_sources SET last_success_at = ?1 WHERE id = ?2",
                rusqlite::params![(Utc::now() - chrono::Duration::days(40)).to_rfc3339(), id],
            )
        })
        .unwrap();
        assert!(r.svc.source(&id).unwrap().stale);
    }

    #[tokio::test]
    async fn disconnecting_erases_the_secrets_and_the_cache_but_not_the_personal_data() {
        let r = rig();
        let id = add_ldap(&r);
        assert!(
            r.secrets
                .get(&secret_key(&id, "password"))
                .unwrap()
                .is_some()
        );
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        let eid = names_ids(&r, "elodie");
        r.svc.set_favorite(&eid, true).unwrap();

        r.svc.disconnect(&id).unwrap();
        assert!(
            r.secrets
                .get(&secret_key(&id, "password"))
                .unwrap()
                .is_none(),
            "password erased"
        );
        assert!(names(&r, "").is_empty(), "cache erased");
        let v = r.svc.source(&id).unwrap();
        assert_eq!(
            (v.state, v.contact_count, v.enabled),
            (SourceState::Disabled, 0, false)
        );
        assert!(
            r.svc.store().favorites().unwrap().contains(&eid[0]),
            "favourites kept"
        );
        // a disabled source is not synchronised on its own
        assert!(
            r.svc
                .tick(Utc::now() + chrono::Duration::days(1))
                .is_empty()
        );
    }

    #[tokio::test]
    async fn removing_a_source_removes_its_secrets_and_everything_about_its_contacts() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        let eid = names_ids(&r, "elodie");
        r.svc.set_favorite(&eid, true).unwrap();
        r.svc.remove_source(&id).unwrap();
        assert!(
            r.secrets
                .get(&secret_key(&id, "password"))
                .unwrap()
                .is_none()
        );
        assert!(r.svc.store().favorites().unwrap().is_empty());
        assert_eq!(
            r.svc.sources().unwrap().len(),
            1,
            "only the local source is left"
        );
    }

    #[tokio::test]
    async fn the_secret_never_reaches_the_database_or_a_source_view() {
        let r = rig();
        let id = add_ldap(&r);
        let view = serde_json::to_string(&r.svc.source(&id).unwrap()).unwrap();
        assert!(!view.contains("s3cret"));
        let stored = r.svc.store().get_source(&id).unwrap().unwrap();
        assert!(!stored.config.to_string().contains("s3cret"));
        assert!(!format!("{stored:?}").contains("s3cret"));
    }

    #[tokio::test]
    async fn the_local_address_book_is_part_of_the_directory_and_follows_its_edits() {
        let r = rig();
        assert_eq!(r.svc.sources().unwrap()[0].id, LOCAL_SOURCE_ID);
        assert!(names(&r, "").is_empty(), "an empty directory");
        let c =
            r.db.save_contact(&ContactInput {
                id: None,
                first_name: "Ada".into(),
                last_name: "Lovelace".into(),
                company: Some("Analytical".into()),
                number: "sip:ada@example.com".into(),
            })
            .unwrap();
        r.svc.contacts_changed();
        let page = r
            .svc
            .search(&DirectoryQuery {
                text: "lovelace".into(),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total, 1);
        let e = &page.items[0];
        assert!(!e.read_only, "the local address book is editable");
        assert_eq!(e.sources[0].source_id, LOCAL_SOURCE_ID);
        assert_eq!(e.sources[0].external_id, c.id);
        assert_eq!(e.phones[0].kind, PhoneKind::Sip);
        assert_eq!(r.svc.sources().unwrap()[0].contact_count, 1);

        r.db.delete_contact(&c.id).unwrap();
        r.svc.contacts_changed();
        assert!(names(&r, "").is_empty());
    }

    #[tokio::test]
    async fn enterprise_records_are_read_only() {
        let r = rig();
        let id = add_ldap(&r);
        r.script
            .push(snapshot(vec![person("1", "Élodie Dupont", "1")]));
        r.svc.sync_now(&id, true).await.unwrap();
        let page = r.svc.search(&DirectoryQuery::default()).unwrap();
        assert!(page.items[0].read_only);
        assert!(r.svc.source(&id).unwrap().read_only);
    }

    #[test]
    fn source_names_are_checked() {
        let r = rig();
        let cfg = serde_json::json!({});
        assert!(
            r.svc
                .add_source(SourceKind::Ldap, "  ", &cfg, 60, None)
                .is_err()
        );
        assert!(
            r.svc
                .add_source(SourceKind::Local, "x", &cfg, 60, None)
                .is_err()
        );
    }

    #[tokio::test]
    async fn a_disabled_source_is_not_synchronised_unless_asked() {
        let r = rig();
        let id = add_ldap(&r);
        r.svc
            .update_source(&id, "Annuaire", false, 60, None)
            .unwrap();
        assert!(r.svc.sync_now(&id, false).await.is_err());
        assert_eq!(r.script.cursors.lock().unwrap().len(), 0);
    }
}
