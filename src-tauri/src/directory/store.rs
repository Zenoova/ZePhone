//! Persistence of the directory: the sources, the cache of what they gave, and the personal favourites and groups.
//!
//! The rules that matter, all enforced here and tested:
//!  * a synchronisation is applied in ONE transaction, after it fully succeeded — a failure never touches the cache;
//!  * a contact that is gone from the source after a successful synchronisation is deleted, together with the
//!    favourites and group memberships that pointed at it;
//!  * disconnecting a source empties its cache but keeps the personal data: they come back with the same ids;
//!  * deleting a group never deletes a contact.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use chrono::Utc;
use rusqlite::{OptionalExtension, Transaction, params};
use uuid::Uuid;

use super::model::{Contact, GroupView, RemoteContact, SourceKind, SyncErrorKind, contact_id};
use crate::{
    database::Database,
    error::{AppError, AppResult},
};

/// A source as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceRow {
    pub id: String,
    pub kind: SourceKind,
    pub name: String,
    pub enabled: bool,
    /// Non-secret settings. Passwords and tokens live in the credential store.
    pub config: serde_json::Value,
    pub sync_interval_min: u32,
    /// Where the next synchronisation continues from (a Graph delta link, for instance).
    pub cursor: Option<String>,
    pub last_success_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_error: Option<String>,
    pub error_kind: Option<SyncErrorKind>,
}

/// What a synchronisation changed in the cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ApplyReport {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    /// How many contacts the source has in the cache now.
    pub total: usize,
}

pub struct DirectoryStore {
    db: Arc<Database>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn error_kind_str(k: SyncErrorKind) -> &'static str {
    match k {
        SyncErrorKind::Network => "network",
        SyncErrorKind::Auth => "auth",
        SyncErrorKind::Forbidden => "forbidden",
        SyncErrorKind::Throttled => "throttled",
        SyncErrorKind::Config => "config",
        SyncErrorKind::Invalid => "invalid",
        SyncErrorKind::Server => "server",
    }
}

fn parse_error_kind(s: &str) -> Option<SyncErrorKind> {
    Some(match s {
        "network" => SyncErrorKind::Network,
        "auth" => SyncErrorKind::Auth,
        "forbidden" => SyncErrorKind::Forbidden,
        "throttled" => SyncErrorKind::Throttled,
        "config" => SyncErrorKind::Config,
        "invalid" => SyncErrorKind::Invalid,
        "server" => SyncErrorKind::Server,
        _ => return None,
    })
}

const SOURCE_COLUMNS: &str = "id, kind, name, enabled, config, sync_interval_min, cursor, last_success_at, \
                              last_attempt_at, last_error, error_kind";

fn source_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<SourceRow> {
    let kind: String = r.get(1)?;
    let config: String = r.get(4)?;
    let error_kind: Option<String> = r.get(10)?;
    Ok(SourceRow {
        id: r.get(0)?,
        kind: SourceKind::parse(&kind).unwrap_or(SourceKind::Ldap),
        name: r.get(2)?,
        enabled: r.get::<_, i64>(3)? != 0,
        config: serde_json::from_str(&config).unwrap_or_default(),
        sync_interval_min: r.get::<_, i64>(5)?.clamp(0, i64::from(u32::MAX)) as u32,
        cursor: r.get(6)?,
        last_success_at: r.get(7)?,
        last_attempt_at: r.get(8)?,
        last_error: r.get(9)?,
        error_kind: error_kind.as_deref().and_then(parse_error_kind),
    })
}

/// Inserts or updates one record; says whether it is new, changed, or the same as before.
fn upsert(
    tx: &Transaction<'_>,
    source_id: &str,
    c: &RemoteContact,
    at: &str,
) -> rusqlite::Result<Change> {
    let data = serde_json::to_string(c).expect("a contact serialises");
    let id = contact_id(source_id, &c.external_id);
    let before: Option<String> = tx
        .query_row("SELECT data FROM dir_contacts WHERE id = ?1", [&id], |r| {
            r.get(0)
        })
        .optional()?;
    match before {
        None => {
            tx.execute(
                "INSERT INTO dir_contacts (id, source_id, external_id, data, updated_at) VALUES (?1,?2,?3,?4,?5)",
                params![id, source_id, c.external_id, data, at],
            )?;
            Ok(Change::Added)
        }
        Some(old) if old == data => Ok(Change::Same),
        Some(_) => {
            tx.execute(
                "UPDATE dir_contacts SET data = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, data, at],
            )?;
            Ok(Change::Updated)
        }
    }
}

enum Change {
    Added,
    Updated,
    Same,
}

/// Deletes a contact from the cache, and the personal data that pointed at it.
fn remove_contact(tx: &Transaction<'_>, id: &str) -> rusqlite::Result<bool> {
    let n = tx.execute("DELETE FROM dir_contacts WHERE id = ?1", [id])?;
    tx.execute("DELETE FROM dir_favorites WHERE contact_id = ?1", [id])?;
    tx.execute("DELETE FROM dir_group_members WHERE contact_id = ?1", [id])?;
    Ok(n > 0)
}

fn count_of(tx: &Transaction<'_>, source_id: &str) -> rusqlite::Result<usize> {
    tx.query_row(
        "SELECT COUNT(*) FROM dir_contacts WHERE source_id = ?1",
        [source_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n as usize)
}

impl DirectoryStore {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    // ------------------------------------------------------------- sources

    pub fn list_sources(&self) -> AppResult<Vec<SourceRow>> {
        self.db.with(|c| {
            let mut stmt = c.prepare(&format!(
                "SELECT {SOURCE_COLUMNS} FROM dir_sources ORDER BY created_at, name"
            ))?;
            stmt.query_map([], source_from_row)?.collect()
        })
    }

    pub fn get_source(&self, id: &str) -> AppResult<Option<SourceRow>> {
        self.db.with(|c| {
            c.query_row(
                &format!("SELECT {SOURCE_COLUMNS} FROM dir_sources WHERE id = ?1"),
                [id],
                source_from_row,
            )
            .optional()
        })
    }

    /// Creates a source and returns its id.
    pub fn insert_source(
        &self,
        kind: SourceKind,
        name: &str,
        config: &serde_json::Value,
        sync_interval_min: u32,
        enabled: bool,
    ) -> AppResult<String> {
        let id = Uuid::new_v4().to_string();
        self.db.with(|c| {
            c.execute(
                "INSERT INTO dir_sources (id, kind, name, enabled, config, sync_interval_min, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    id,
                    kind.as_str(),
                    name,
                    i64::from(enabled),
                    config.to_string(),
                    i64::from(sync_interval_min),
                    now()
                ],
            )
        })?;
        Ok(id)
    }

    /// Changes what the user can change about a source. A changed configuration starts over: the old cursor
    /// belongs to the old configuration.
    pub fn update_source(
        &self,
        id: &str,
        name: &str,
        enabled: bool,
        sync_interval_min: u32,
        config: Option<&serde_json::Value>,
    ) -> AppResult<()> {
        let n = self.db.with(|c| {
            let n = c.execute(
                "UPDATE dir_sources SET name = ?2, enabled = ?3, sync_interval_min = ?4 WHERE id = ?1",
                params![id, name, i64::from(enabled), i64::from(sync_interval_min)],
            )?;
            if let Some(cfg) = config {
                c.execute(
                    "UPDATE dir_sources SET config = ?2, cursor = NULL WHERE id = ?1",
                    params![id, cfg.to_string()],
                )?;
            }
            Ok(n)
        })?;
        if n == 0 {
            return Err(AppError::NotFound("source".into()));
        }
        Ok(())
    }

    pub fn record_attempt(&self, id: &str) -> AppResult<()> {
        self.db.with(|c| {
            c.execute(
                "UPDATE dir_sources SET last_attempt_at = ?2 WHERE id = ?1",
                params![id, now()],
            )
            .map(|_| ())
        })
    }

    /// A failure is only a note on the source: the cache is left exactly as it was.
    pub fn record_failure(&self, id: &str, kind: SyncErrorKind, message: &str) -> AppResult<()> {
        self.db.with(|c| {
            c.execute(
                "UPDATE dir_sources SET last_attempt_at = ?2, last_error = ?3, error_kind = ?4 WHERE id = ?1",
                params![id, now(), message, error_kind_str(kind)],
            )
            .map(|_| ())
        })
    }

    /// The user signed in again (or fixed the settings): the failure no longer applies.
    pub fn clear_failure(&self, id: &str) -> AppResult<()> {
        self.db.with(|c| {
            c.execute(
                "UPDATE dir_sources SET last_error = NULL, error_kind = NULL WHERE id = ?1",
                [id],
            )
            .map(|_| ())
        })
    }

    pub fn contact_count(&self, source_id: &str) -> AppResult<usize> {
        self.db.with(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM dir_contacts WHERE source_id = ?1",
                [source_id],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as usize)
        })
    }

    /// Deletes a source for good: its cache, and the favourites and group memberships of its contacts (there is
    /// nothing left for them to point at).
    pub fn delete_source(&self, id: &str) -> AppResult<()> {
        self.db.with(|c| {
            let tx = c.transaction()?;
            let ids: Vec<String> = {
                let mut stmt = tx.prepare("SELECT id FROM dir_contacts WHERE source_id = ?1")?;
                stmt.query_map([id], |r| r.get(0))?
                    .collect::<Result<_, _>>()?
            };
            for cid in &ids {
                tx.execute("DELETE FROM dir_favorites WHERE contact_id = ?1", [cid])?;
                tx.execute("DELETE FROM dir_group_members WHERE contact_id = ?1", [cid])?;
            }
            tx.execute("DELETE FROM dir_sources WHERE id = ?1", [id])?; // the cache goes with it
            tx.commit()
        })
    }

    /// Empties the cache of a source (disconnection, expiry). The personal favourites and groups stay: they come
    /// back with the contacts if the source is connected again. The synchronisation starts over.
    pub fn clear_cache(&self, source_id: &str) -> AppResult<usize> {
        self.db.with(|c| {
            let tx = c.transaction()?;
            let n = tx.execute("DELETE FROM dir_contacts WHERE source_id = ?1", [source_id])?;
            tx.execute(
                "UPDATE dir_sources SET cursor = NULL, last_success_at = NULL WHERE id = ?1",
                [source_id],
            )?;
            tx.commit()?;
            Ok(n)
        })
    }

    // ------------------------------------------------------------- cache

    pub fn all_contacts(&self) -> AppResult<Vec<Contact>> {
        self.db.with(|c| {
            let mut stmt = c.prepare(
                "SELECT d.id, d.source_id, d.data FROM dir_contacts d
                 JOIN dir_sources s ON s.id = d.source_id WHERE s.enabled = 1",
            )?;
            let rows = stmt.query_map([], |r| {
                let data: String = r.get(2)?;
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, data))
            })?;
            let mut out = Vec::new();
            for row in rows {
                let (id, source_id, data) = row?;
                if let Ok(remote) = serde_json::from_str::<RemoteContact>(&data) {
                    out.push(Contact {
                        id,
                        source_id,
                        remote,
                    });
                }
            }
            Ok(out)
        })
    }

    /// Applies a COMPLETE copy of the source: what is not in it any more is deleted. Only call this with a
    /// snapshot that was read to the end.
    pub fn apply_snapshot(
        &self,
        source_id: &str,
        contacts: &[RemoteContact],
        cursor: Option<&str>,
    ) -> AppResult<ApplyReport> {
        let at = now();
        self.db.with(|c| {
            let tx = c.transaction()?;
            let mut report = ApplyReport::default();
            let mut seen = HashSet::new();
            for rc in contacts {
                match upsert(&tx, source_id, rc, &at)? {
                    Change::Added => report.added += 1,
                    Change::Updated => report.updated += 1,
                    Change::Same => {}
                }
                seen.insert(rc.external_id.clone());
            }
            let existing: Vec<(String, String)> = {
                let mut stmt =
                    tx.prepare("SELECT id, external_id FROM dir_contacts WHERE source_id = ?1")?;
                stmt.query_map([source_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<Result<_, _>>()?
            };
            for (id, external) in existing {
                if !seen.contains(&external) && remove_contact(&tx, &id)? {
                    report.removed += 1;
                }
            }
            report.total = count_of(&tx, source_id)?;
            finish_sync(&tx, source_id, cursor, &at)?;
            tx.commit()?;
            Ok(report)
        })
    }

    /// Applies the changes since the last synchronisation: records to add or update, and the external ids the
    /// source says were deleted.
    pub fn apply_delta(
        &self,
        source_id: &str,
        upserts: &[RemoteContact],
        removed: &[String],
        cursor: Option<&str>,
    ) -> AppResult<ApplyReport> {
        let at = now();
        self.db.with(|c| {
            let tx = c.transaction()?;
            let mut report = ApplyReport::default();
            for rc in upserts {
                match upsert(&tx, source_id, rc, &at)? {
                    Change::Added => report.added += 1,
                    Change::Updated => report.updated += 1,
                    Change::Same => {}
                }
            }
            for external in removed {
                if remove_contact(&tx, &contact_id(source_id, external))? {
                    report.removed += 1;
                }
            }
            report.total = count_of(&tx, source_id)?;
            finish_sync(&tx, source_id, cursor, &at)?;
            tx.commit()?;
            Ok(report)
        })
    }

    // ------------------------------------------------------------- favourites

    pub fn set_favorite(&self, ids: &[String], favorite: bool) -> AppResult<()> {
        self.db.with(|c| {
            let tx = c.transaction()?;
            for id in ids {
                if favorite {
                    tx.execute(
                        "INSERT OR IGNORE INTO dir_favorites (contact_id, added_at) VALUES (?1, ?2)",
                        params![id, now()],
                    )?;
                } else {
                    tx.execute("DELETE FROM dir_favorites WHERE contact_id = ?1", [id])?;
                }
            }
            tx.commit()
        })
    }

    pub fn favorites(&self) -> AppResult<HashSet<String>> {
        self.db.with(|c| {
            let mut stmt = c.prepare("SELECT contact_id FROM dir_favorites")?;
            stmt.query_map([], |r| r.get(0))?.collect()
        })
    }

    // ------------------------------------------------------------- groups

    fn check_group_name(name: &str) -> AppResult<String> {
        let n = name.trim();
        if n.is_empty() || n.chars().count() > 60 || n.chars().any(char::is_control) {
            return Err(AppError::validation(
                "Le nom du groupe doit faire de 1 à 60 caractères",
            ));
        }
        Ok(n.to_owned())
    }

    pub fn create_group(&self, name: &str) -> AppResult<GroupView> {
        let name = Self::check_group_name(name)?;
        let id = Uuid::new_v4().to_string();
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO dir_groups (id, name, created_at) VALUES (?1,?2,?3)",
                    params![id, name, now()],
                )
            })
            .map_err(|e| match e {
                AppError::Database(m) if m.contains("UNIQUE") => {
                    AppError::validation("Un groupe porte déjà ce nom")
                }
                other => other,
            })?;
        Ok(GroupView {
            id,
            name,
            member_count: 0,
        })
    }

    pub fn rename_group(&self, id: &str, name: &str) -> AppResult<()> {
        let name = Self::check_group_name(name)?;
        let result = self.db.with(|c| {
            c.execute(
                "UPDATE dir_groups SET name = ?2 WHERE id = ?1",
                params![id, name],
            )
        });
        match result {
            Ok(0) => Err(AppError::NotFound("groupe".into())),
            Ok(_) => Ok(()),
            Err(AppError::Database(m)) if m.contains("UNIQUE") => {
                Err(AppError::validation("Un groupe porte déjà ce nom"))
            }
            Err(e) => Err(e),
        }
    }

    /// Deletes the group and its memberships. The contacts are not touched.
    pub fn delete_group(&self, id: &str) -> AppResult<()> {
        self.db.with(|c| {
            c.execute("DELETE FROM dir_groups WHERE id = ?1", [id])
                .map(|_| ())
        })
    }

    pub fn groups(&self) -> AppResult<Vec<GroupView>> {
        self.db.with(|c| {
            let mut stmt = c.prepare(
                "SELECT g.id, g.name, (SELECT COUNT(*) FROM dir_group_members m WHERE m.group_id = g.id)
                 FROM dir_groups g ORDER BY g.name COLLATE NOCASE",
            )?;
            stmt.query_map([], |r| {
                Ok(GroupView {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    member_count: r.get::<_, i64>(2)? as usize,
                })
            })?
            .collect()
        })
    }

    pub fn add_to_group(&self, group_id: &str, contact_ids: &[String]) -> AppResult<()> {
        let result = self.db.with(|c| {
            let tx = c.transaction()?;
            for id in contact_ids {
                tx.execute(
                    "INSERT OR IGNORE INTO dir_group_members (group_id, contact_id, added_at) VALUES (?1,?2,?3)",
                    params![group_id, id, now()],
                )?;
            }
            tx.commit()
        });
        match result {
            Err(AppError::Database(m)) if m.contains("FOREIGN KEY") => {
                Err(AppError::NotFound("groupe".into()))
            }
            other => other,
        }
    }

    pub fn remove_from_group(&self, group_id: &str, contact_ids: &[String]) -> AppResult<()> {
        self.db.with(|c| {
            let tx = c.transaction()?;
            for id in contact_ids {
                tx.execute(
                    "DELETE FROM dir_group_members WHERE group_id = ?1 AND contact_id = ?2",
                    params![group_id, id],
                )?;
            }
            tx.commit()
        })
    }

    /// For every contact id, the groups it is in.
    pub fn memberships(&self) -> AppResult<HashMap<String, Vec<String>>> {
        self.db.with(|c| {
            let mut stmt = c.prepare("SELECT contact_id, group_id FROM dir_group_members")?;
            let mut map: HashMap<String, Vec<String>> = HashMap::new();
            for row in
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            {
                let (contact, group) = row?;
                map.entry(contact).or_default().push(group);
            }
            Ok(map)
        })
    }

    pub fn members(&self, group_id: &str) -> AppResult<HashSet<String>> {
        self.db.with(|c| {
            let mut stmt =
                c.prepare("SELECT contact_id FROM dir_group_members WHERE group_id = ?1")?;
            stmt.query_map([group_id], |r| r.get(0))?.collect()
        })
    }
}

/// A successful synchronisation: remember where to continue, and clear any earlier failure.
fn finish_sync(
    tx: &Transaction<'_>,
    source_id: &str,
    cursor: Option<&str>,
    at: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE dir_sources SET cursor = ?2, last_success_at = ?3, last_attempt_at = ?3,
                last_error = NULL, error_kind = NULL WHERE id = ?1",
        params![source_id, cursor, at],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directory::model::{PhoneEntry, PhoneKind};

    fn store() -> DirectoryStore {
        DirectoryStore::new(Arc::new(Database::open_in_memory().unwrap()))
    }

    fn person(id: &str, name: &str, number: &str) -> RemoteContact {
        RemoteContact {
            external_id: id.into(),
            display_name: name.into(),
            phones: vec![PhoneEntry::new(PhoneKind::Work, number)],
            ..Default::default()
        }
    }

    fn source(s: &DirectoryStore) -> String {
        s.insert_source(
            SourceKind::Ldap,
            "Annuaire",
            &serde_json::json!({}),
            60,
            true,
        )
        .unwrap()
    }

    #[test]
    fn a_first_snapshot_adds_everything() {
        let s = store();
        let src = source(&s);
        let r = s
            .apply_snapshot(
                &src,
                &[person("a", "Ada", "1"), person("b", "Bob", "2")],
                Some("c1"),
            )
            .unwrap();
        assert_eq!(
            r,
            ApplyReport {
                added: 2,
                updated: 0,
                removed: 0,
                total: 2
            }
        );
        let row = s.get_source(&src).unwrap().unwrap();
        assert_eq!(row.cursor.as_deref(), Some("c1"));
        assert!(row.last_success_at.is_some());
        assert_eq!(s.all_contacts().unwrap().len(), 2);
    }

    #[test]
    fn a_contact_keeps_its_id_across_synchronisations_and_only_changes_are_counted() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        let id = contact_id(&src, "a");
        let r = s
            .apply_snapshot(&src, &[person("a", "Ada Lovelace", "1")], None)
            .unwrap();
        assert_eq!((r.added, r.updated, r.removed), (0, 1, 0));
        let again = s
            .apply_snapshot(&src, &[person("a", "Ada Lovelace", "1")], None)
            .unwrap();
        assert_eq!((again.added, again.updated, again.removed), (0, 0, 0));
        let all = s.all_contacts().unwrap();
        assert_eq!(all[0].id, id);
        assert_eq!(all[0].remote.display_name, "Ada Lovelace");
    }

    #[test]
    fn a_contact_missing_from_a_successful_snapshot_is_deleted_with_its_personal_data() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(
            &src,
            &[person("a", "Ada", "1"), person("b", "Bob", "2")],
            None,
        )
        .unwrap();
        let (a, b) = (contact_id(&src, "a"), contact_id(&src, "b"));
        let g = s.create_group("Direction").unwrap();
        s.set_favorite(&[a.clone(), b.clone()], true).unwrap();
        s.add_to_group(&g.id, &[a.clone(), b.clone()]).unwrap();

        let r = s
            .apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        assert_eq!((r.removed, r.total), (1, 1));
        assert_eq!(s.favorites().unwrap(), HashSet::from([a.clone()]));
        assert_eq!(s.members(&g.id).unwrap(), HashSet::from([a]));
    }

    #[test]
    fn favourites_and_groups_survive_an_update_of_the_directory() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        let a = contact_id(&src, "a");
        let g = s.create_group("Clients").unwrap();
        s.set_favorite(&[a.clone()], true).unwrap();
        s.add_to_group(&g.id, &[a.clone()]).unwrap();

        // the person changed number and department in the source
        let mut moved = person("a", "Ada", "999");
        moved.department = Some("R&D".into());
        s.apply_snapshot(&src, &[moved], None).unwrap();

        assert!(s.favorites().unwrap().contains(&a));
        assert_eq!(s.members(&g.id).unwrap(), HashSet::from([a.clone()]));
        assert_eq!(s.all_contacts().unwrap()[0].remote.phones[0].number, "999");
    }

    #[test]
    fn a_delta_adds_updates_and_removes_what_the_source_names() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(
            &src,
            &[
                person("a", "Ada", "1"),
                person("b", "Bob", "2"),
                person("c", "Cy", "3"),
            ],
            Some("d1"),
        )
        .unwrap();
        let r = s
            .apply_delta(
                &src,
                &[person("b", "Bob B.", "2"), person("d", "Dee", "4")],
                &["c".to_owned(), "never-existed".to_owned()],
                Some("d2"),
            )
            .unwrap();
        assert_eq!((r.added, r.updated, r.removed, r.total), (1, 1, 1, 3));
        assert_eq!(
            s.get_source(&src).unwrap().unwrap().cursor.as_deref(),
            Some("d2")
        );
    }

    #[test]
    fn a_failure_is_a_note_on_the_source_and_leaves_the_cache_alone() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        s.record_failure(&src, SyncErrorKind::Network, "Serveur injoignable")
            .unwrap();
        let row = s.get_source(&src).unwrap().unwrap();
        assert_eq!(row.error_kind, Some(SyncErrorKind::Network));
        assert_eq!(row.last_error.as_deref(), Some("Serveur injoignable"));
        assert!(
            row.last_success_at.is_some(),
            "the last success is remembered"
        );
        assert_eq!(s.all_contacts().unwrap().len(), 1);
        // the next success clears the failure
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        assert_eq!(s.get_source(&src).unwrap().unwrap().error_kind, None);
    }

    #[test]
    fn disconnecting_empties_the_cache_but_keeps_favourites_and_groups_for_a_reconnection() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], Some("cur"))
            .unwrap();
        let a = contact_id(&src, "a");
        let g = s.create_group("Clients").unwrap();
        s.set_favorite(&[a.clone()], true).unwrap();
        s.add_to_group(&g.id, &[a.clone()]).unwrap();

        assert_eq!(s.clear_cache(&src).unwrap(), 1);
        assert!(s.all_contacts().unwrap().is_empty());
        let row = s.get_source(&src).unwrap().unwrap();
        assert_eq!((row.cursor, row.last_success_at), (None, None));
        assert!(s.favorites().unwrap().contains(&a), "personal data stay");

        // connected again: the same person comes back with the same id, still a favourite and in the group
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        assert_eq!(s.all_contacts().unwrap()[0].id, a);
        assert!(s.members(&g.id).unwrap().contains(&a));
    }

    #[test]
    fn deleting_a_source_deletes_its_cache_and_the_personal_data_about_its_contacts() {
        let s = store();
        let src = source(&s);
        let other = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        s.apply_snapshot(&other, &[person("a", "Ada", "1")], None)
            .unwrap(); // same external id, other source
        let (mine, theirs) = (contact_id(&src, "a"), contact_id(&other, "a"));
        s.set_favorite(&[mine.clone(), theirs.clone()], true)
            .unwrap();

        s.delete_source(&src).unwrap();
        assert_eq!(s.favorites().unwrap(), HashSet::from([theirs]));
        assert_eq!(s.all_contacts().unwrap().len(), 1);
        assert!(s.get_source(&src).unwrap().is_none());
    }

    #[test]
    fn a_disabled_source_is_not_listed() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], None)
            .unwrap();
        s.update_source(&src, "Annuaire", false, 60, None).unwrap();
        assert!(s.all_contacts().unwrap().is_empty());
        assert_eq!(s.contact_count(&src).unwrap(), 1, "but its cache is kept");
    }

    #[test]
    fn changing_the_configuration_starts_the_synchronisation_over() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(&src, &[person("a", "Ada", "1")], Some("old"))
            .unwrap();
        s.update_source(
            &src,
            "Annuaire",
            true,
            60,
            Some(&serde_json::json!({"url": "ldaps://x"})),
        )
        .unwrap();
        let row = s.get_source(&src).unwrap().unwrap();
        assert_eq!(row.cursor, None);
        assert_eq!(row.config["url"], "ldaps://x");
        assert!(s.update_source("nope", "x", true, 0, None).is_err());
    }

    #[test]
    fn groups_are_created_renamed_and_deleted_without_touching_contacts() {
        let s = store();
        let src = source(&s);
        s.apply_snapshot(
            &src,
            &[person("a", "Ada", "1"), person("b", "Bob", "2")],
            None,
        )
        .unwrap();
        let (a, b) = (contact_id(&src, "a"), contact_id(&src, "b"));
        let g = s.create_group("  Clients  ").unwrap();
        assert_eq!(g.name, "Clients");
        s.add_to_group(&g.id, &[a.clone(), b.clone()]).unwrap();
        s.add_to_group(&g.id, &[a.clone()]).unwrap(); // twice: still once
        assert_eq!(s.groups().unwrap()[0].member_count, 2);

        s.rename_group(&g.id, "Grands comptes").unwrap();
        assert_eq!(s.groups().unwrap()[0].name, "Grands comptes");

        s.remove_from_group(&g.id, &[b.clone()]).unwrap();
        assert_eq!(s.members(&g.id).unwrap(), HashSet::from([a]));

        s.delete_group(&g.id).unwrap();
        assert!(s.groups().unwrap().is_empty());
        assert_eq!(
            s.all_contacts().unwrap().len(),
            2,
            "the contacts are still there"
        );
        assert!(s.memberships().unwrap().is_empty());
    }

    #[test]
    fn a_contact_can_be_in_several_groups() {
        let s = store();
        let g1 = s.create_group("A").unwrap();
        let g2 = s.create_group("B").unwrap();
        s.add_to_group(&g1.id, &["x/1".into()]).unwrap();
        s.add_to_group(&g2.id, &["x/1".into()]).unwrap();
        let m = s.memberships().unwrap();
        let mut groups = m["x/1"].clone();
        groups.sort();
        let mut expected = vec![g1.id, g2.id];
        expected.sort();
        assert_eq!(groups, expected);
    }

    #[test]
    fn group_names_are_checked_and_unique_whatever_the_case() {
        let s = store();
        s.create_group("Clients").unwrap();
        assert!(s.create_group("clients").is_err());
        assert!(s.create_group("   ").is_err());
        assert!(s.create_group(&"x".repeat(61)).is_err());
        let other = s.create_group("Fournisseurs").unwrap();
        assert!(s.rename_group(&other.id, "CLIENTS").is_err());
        assert!(s.rename_group("nope", "Z").is_err());
        assert!(s.add_to_group("nope", &["x/1".into()]).is_err());
    }
}
