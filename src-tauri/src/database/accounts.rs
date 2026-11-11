use rusqlite::{Row, params};

use super::Database;
use crate::{
    error::{AppError, AppResult},
    sip::types::{Account, MediaEncryption, Transport},
};

fn from_row(r: &Row<'_>) -> rusqlite::Result<Account> {
    let transport: String = r.get("transport")?;
    let media: String = r.get("media_encryption")?;
    Ok(Account {
        id: r.get("id")?,
        label: r.get("label")?,
        display_name: r.get("display_name")?,
        server: r.get("server")?,
        port: r.get::<_, i64>("port")? as u16,
        domain: r.get("domain")?,
        username: r.get("username")?,
        auth_username: r.get("auth_username")?,
        transport: Transport::parse(&transport).unwrap_or_default(),
        outbound_proxy: r.get("outbound_proxy")?,
        register_interval: r.get::<_, i64>("register_interval")? as u32,
        media_encryption: MediaEncryption::parse(&media).unwrap_or_default(),
        enabled: r.get::<_, i64>("enabled")? != 0,
        is_default: r.get::<_, i64>("is_default")? != 0,
    })
}

impl Database {
    pub fn list_accounts(&self) -> AppResult<Vec<Account>> {
        self.with(|c| {
            let mut stmt = c.prepare("SELECT * FROM accounts ORDER BY position, rowid")?;
            let rows = stmt.query_map([], from_row)?;
            rows.collect()
        })
    }

    pub fn get_account(&self, id: &str) -> AppResult<Option<Account>> {
        self.with(|c| {
            let mut stmt = c.prepare("SELECT * FROM accounts WHERE id = ?1")?;
            let mut rows = stmt.query_map([id], from_row)?;
            rows.next().transpose()
        })
    }

    /// Inserts or updates an account. The first account ever created becomes the default;
    /// marking one as default clears the flag on the others (exactly one default at all times).
    pub fn upsert_account(&self, a: &Account) -> AppResult<Account> {
        self.with(|c| {
            let tx = c.transaction()?;
            let count: i64 = tx.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))?;
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)", [&a.id], |r| r.get(0))?;
            let make_default = a.is_default || count == 0 || (!exists && count == 0);
            if make_default {
                tx.execute("UPDATE accounts SET is_default = 0", [])?;
            }
            let position: i64 = if exists {
                tx.query_row("SELECT position FROM accounts WHERE id = ?1", [&a.id], |r| r.get(0))?
            } else {
                tx.query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM accounts", [], |r| r.get(0))?
            };
            let keep_default: bool = if exists && !make_default {
                tx.query_row("SELECT is_default FROM accounts WHERE id = ?1", [&a.id], |r| r.get::<_, i64>(0))? != 0
            } else {
                make_default
            };
            tx.execute(
                "INSERT INTO accounts (id, label, display_name, server, port, domain, username, auth_username,
                    transport, outbound_proxy, register_interval, media_encryption, enabled, is_default, position)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                 ON CONFLICT(id) DO UPDATE SET
                    label=excluded.label, display_name=excluded.display_name, server=excluded.server,
                    port=excluded.port, domain=excluded.domain, username=excluded.username,
                    auth_username=excluded.auth_username, transport=excluded.transport,
                    outbound_proxy=excluded.outbound_proxy, register_interval=excluded.register_interval,
                    media_encryption=excluded.media_encryption, enabled=excluded.enabled,
                    is_default=excluded.is_default",
                params![
                    a.id,
                    a.label,
                    a.display_name,
                    a.server,
                    a.port as i64,
                    a.domain,
                    a.username,
                    a.auth_username,
                    a.transport.as_param(),
                    a.outbound_proxy,
                    a.register_interval as i64,
                    a.media_encryption.as_str(),
                    a.enabled as i64,
                    keep_default as i64,
                    position,
                ],
            )?;
            let stored = tx.query_row("SELECT * FROM accounts WHERE id = ?1", [&a.id], from_row)?;
            tx.commit()?;
            Ok(stored)
        })
    }

    /// Deletes an account; if it was the default, the first remaining one takes over.
    pub fn delete_account(&self, id: &str) -> AppResult<()> {
        self.with(|c| {
            let tx = c.transaction()?;
            let was_default: bool = tx
                .query_row("SELECT is_default FROM accounts WHERE id = ?1", [id], |r| r.get::<_, i64>(0))
                .map(|v| v != 0)
                .unwrap_or(false);
            tx.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
            if was_default {
                tx.execute(
                    "UPDATE accounts SET is_default = 1 WHERE id = (SELECT id FROM accounts ORDER BY position, rowid LIMIT 1)",
                    [],
                )?;
            }
            tx.commit()
        })
    }

    pub fn set_default_account(&self, id: &str) -> AppResult<()> {
        let changed = self.with(|c| {
            let tx = c.transaction()?;
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)", [id], |r| r.get(0))?;
            if exists {
                tx.execute("UPDATE accounts SET is_default = (id = ?1)", [id])?;
            }
            tx.commit()?;
            Ok(exists)
        })?;
        if changed { Ok(()) } else { Err(AppError::NotFound("compte".into())) }
    }

    pub fn set_account_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        let n = self.with(|c| c.execute("UPDATE accounts SET enabled = ?2 WHERE id = ?1", params![id, enabled as i64]))?;
        if n == 0 { Err(AppError::NotFound("compte".into())) } else { Ok(()) }
    }

    pub fn default_account(&self) -> AppResult<Option<Account>> {
        self.with(|c| {
            let mut stmt = c.prepare("SELECT * FROM accounts WHERE is_default = 1 LIMIT 1")?;
            let mut rows = stmt.query_map([], from_row)?;
            rows.next().transpose()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(id: &str, default: bool) -> Account {
        Account {
            id: id.into(),
            label: format!("Compte {id}"),
            display_name: Some("Ada".into()),
            server: "sip.example.com".into(),
            port: 5061,
            domain: "example.com".into(),
            username: "1001".into(),
            auth_username: Some("auth1001".into()),
            transport: Transport::Tls,
            outbound_proxy: Some("proxy.example.com:5061".into()),
            register_interval: 300,
            media_encryption: MediaEncryption::SrtpMandatory,
            enabled: true,
            is_default: default,
        }
    }

    #[test]
    fn round_trips_every_field() {
        let db = Database::open_in_memory().unwrap();
        let stored = db.upsert_account(&acc("a", false)).unwrap();
        let mut expected = acc("a", true);
        expected.is_default = true; // first account becomes the default
        assert_eq!(stored, expected);
        assert_eq!(db.get_account("a").unwrap().unwrap(), expected);
        assert!(db.get_account("zzz").unwrap().is_none());
    }

    #[test]
    fn exactly_one_default_account() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_account(&acc("a", false)).unwrap();
        db.upsert_account(&acc("b", false)).unwrap();
        db.upsert_account(&acc("c", true)).unwrap();
        let defaults: Vec<_> = db.list_accounts().unwrap().into_iter().filter(|a| a.is_default).map(|a| a.id).collect();
        assert_eq!(defaults, vec!["c"]);
        db.set_default_account("b").unwrap();
        assert_eq!(db.default_account().unwrap().unwrap().id, "b");
        assert!(db.set_default_account("nope").is_err());
    }

    #[test]
    fn editing_an_account_keeps_its_position_and_default_flag() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_account(&acc("a", false)).unwrap();
        db.upsert_account(&acc("b", false)).unwrap();
        let mut edited = acc("a", false);
        edited.label = "Renommé".into();
        db.upsert_account(&edited).unwrap();
        let list = db.list_accounts().unwrap();
        assert_eq!(list.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(list[0].label, "Renommé");
        assert!(list[0].is_default, "an edit without the default flag must not demote the default account");
    }

    #[test]
    fn deleting_the_default_promotes_another() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_account(&acc("a", false)).unwrap();
        db.upsert_account(&acc("b", false)).unwrap();
        db.delete_account("a").unwrap();
        assert_eq!(db.default_account().unwrap().unwrap().id, "b");
        db.delete_account("b").unwrap();
        assert!(db.default_account().unwrap().is_none());
        db.delete_account("b").unwrap(); // idempotent
    }

    #[test]
    fn enable_disable() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_account(&acc("a", false)).unwrap();
        db.set_account_enabled("a", false).unwrap();
        assert!(!db.get_account("a").unwrap().unwrap().enabled);
        assert!(db.set_account_enabled("zzz", true).is_err());
    }

    #[test]
    fn no_password_column_exists() {
        let db = Database::open_in_memory().unwrap();
        let cols: Vec<String> = db
            .with(|c| {
                let mut s = c.prepare("PRAGMA table_info(accounts)")?;
                let r = s.query_map([], |r| r.get::<_, String>(1))?;
                r.collect()
            })
            .unwrap();
        assert!(!cols.iter().any(|c| c.contains("pass") || c.contains("secret")), "{cols:?}");
    }
}
