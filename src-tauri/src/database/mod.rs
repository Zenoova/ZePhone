//! SQLite persistence (accounts without secrets, contacts, call history, settings).

mod accounts;
mod contacts;
mod history;
mod settings;

pub use history::{HistoryFilter, HistoryKind};

use std::{path::Path, sync::Mutex};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub struct Database {
    conn: Mutex<Connection>,
}

const MIGRATIONS: &[&str] = &[
    // v1
    r#"
    CREATE TABLE accounts (
        id                TEXT PRIMARY KEY,
        label             TEXT NOT NULL,
        display_name      TEXT,
        server            TEXT NOT NULL,
        port              INTEGER NOT NULL,
        domain            TEXT NOT NULL,
        username          TEXT NOT NULL,
        auth_username     TEXT,
        transport         TEXT NOT NULL,
        outbound_proxy    TEXT,
        register_interval INTEGER NOT NULL,
        media_encryption  TEXT NOT NULL DEFAULT 'none',
        enabled           INTEGER NOT NULL DEFAULT 1,
        is_default        INTEGER NOT NULL DEFAULT 0,
        position          INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE contacts (
        id         TEXT PRIMARY KEY,
        first_name TEXT NOT NULL DEFAULT '',
        last_name  TEXT NOT NULL DEFAULT '',
        company    TEXT,
        number     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_contacts_name ON contacts (last_name COLLATE NOCASE, first_name COLLATE NOCASE);

    -- No foreign key to accounts: history must survive account deletion.
    CREATE TABLE call_history (
        id             TEXT PRIMARY KEY,
        account_id     TEXT,
        account_label  TEXT,
        remote_uri     TEXT NOT NULL,
        remote_number  TEXT NOT NULL,
        contact_name   TEXT,
        direction      TEXT NOT NULL,
        result         TEXT NOT NULL,
        started_at     TEXT NOT NULL,
        answered_at    TEXT,
        ended_at       TEXT NOT NULL,
        duration_secs  INTEGER NOT NULL DEFAULT 0,
        sip_code       INTEGER,
        reason         TEXT
    );
    CREATE INDEX idx_history_started ON call_history (started_at DESC);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
];

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::Database(e.to_string()))?;
        }
        let conn = Connection::open(path)?;
        // Keep the database readable by the current user only.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        Self::init(conn)
    }

    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let mut conn = self.conn.lock().unwrap();
        let current = conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? as usize;
        if current > MIGRATIONS.len() {
            return Err(AppError::Database(format!(
                "la base de données est plus récente (v{current}) que cette version de l'application"
            )));
        }
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
        }
        Ok(())
    }

    pub(crate) fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> AppResult<T> {
        let mut conn = self.conn.lock().unwrap();
        f(&mut conn).map_err(AppError::from)
    }

    pub fn schema_version(&self) -> AppResult<usize> {
        self.with(|c| c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))).map(|v| v as usize)
    }
}

/// Escapes `%`, `_` and `\` for use in a `LIKE ... ESCAPE '\'` pattern.
pub(crate) fn like_pattern(q: &str) -> String {
    let mut out = String::from("%");
    for c in q.trim().chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('%');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_run_once_and_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
        drop(db);
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn newer_database_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        drop(Database::open(&path).unwrap());
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);
        assert!(Database::open(&path).is_err());
    }

    #[test]
    fn like_patterns_are_escaped() {
        assert_eq!(like_pattern("a%b_c\\"), "%a\\%b\\_c\\\\%");
    }

    #[cfg(unix)]
    #[test]
    fn database_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db.sqlite");
        drop(Database::open(&path).unwrap());
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
