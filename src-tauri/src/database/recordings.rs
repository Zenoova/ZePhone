use rusqlite::{Row, params};

use super::Database;
use crate::{error::AppResult, recording::Recording, sip::types::CallDirection};

fn from_row(r: &Row<'_>) -> rusqlite::Result<Recording> {
    let direction: String = r.get("direction")?;
    let peaks: String = r.get("peaks")?;
    Ok(Recording {
        id: r.get("id")?,
        call_id: r.get("call_id")?,
        history_id: r.get("history_id")?,
        file_name: r.get("file_name")?,
        path: String::new(), // filled in by the caller, who knows the folder
        started_at: r.get("started_at")?,
        duration_secs: r.get::<_, i64>("duration_secs")?.max(0) as u64,
        size_bytes: r.get::<_, i64>("size_bytes")?.max(0) as u64,
        remote_number: r.get("remote_number")?,
        remote_name: r.get("remote_name")?,
        account_label: r.get("account_label")?,
        direction: CallDirection::parse(&direction).unwrap_or(CallDirection::Outgoing),
        peaks: serde_json::from_str(&peaks).unwrap_or_default(),
    })
}

impl Database {
    pub fn insert_recording(&self, rec: &Recording) -> AppResult<()> {
        let peaks = serde_json::to_string(&rec.peaks).unwrap_or_else(|_| "[]".into());
        self.with(|c| {
            c.execute(
                "INSERT INTO recordings (id, call_id, history_id, file_name, started_at, duration_secs, size_bytes,
                    remote_number, remote_name, account_label, direction, peaks)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    rec.id,
                    rec.call_id,
                    rec.history_id,
                    rec.file_name,
                    rec.started_at,
                    rec.duration_secs as i64,
                    rec.size_bytes as i64,
                    rec.remote_number,
                    rec.remote_name,
                    rec.account_label,
                    rec.direction.as_str(),
                    peaks,
                ],
            )
            .map(|_| ())
        })
    }

    /// Newest first.
    pub fn list_recordings(&self) -> AppResult<Vec<Recording>> {
        self.with(|c| {
            let mut stmt = c.prepare("SELECT * FROM recordings ORDER BY started_at DESC")?;
            stmt.query_map([], from_row)?.collect()
        })
    }

    pub fn get_recording(&self, id: &str) -> AppResult<Option<Recording>> {
        self.with(|c| {
            let mut stmt = c.prepare("SELECT * FROM recordings WHERE id = ?1")?;
            let mut rows = stmt.query_map(params![id], from_row)?;
            rows.next().transpose()
        })
    }

    pub fn delete_recording(&self, id: &str) -> AppResult<()> {
        self.with(|c| {
            c.execute("DELETE FROM recordings WHERE id = ?1", params![id])
                .map(|_| ())
        })
    }

    /// Ties the recordings of a call to the history entry written when the call ended.
    pub fn link_recordings_to_history(&self, call_id: &str, history_id: &str) -> AppResult<usize> {
        self.with(|c| {
            c.execute(
                "UPDATE recordings SET history_id = ?2 WHERE call_id = ?1 AND history_id IS NULL",
                params![call_id, history_id],
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(id: &str, started: &str) -> Recording {
        Recording {
            id: id.into(),
            call_id: Some("call1".into()),
            history_id: None,
            file_name: format!("{id}.wav"),
            path: String::new(),
            started_at: started.into(),
            duration_secs: 42,
            size_bytes: 1_000,
            remote_number: "1002".into(),
            remote_name: Some("Bob".into()),
            account_label: Some("Bureau".into()),
            direction: CallDirection::Incoming,
            peaks: vec![0, 128, 255],
        }
    }

    #[test]
    fn recordings_round_trip_newest_first() {
        let db = Database::open_in_memory().unwrap();
        db.insert_recording(&rec("a", "2026-01-01T10:00:00Z"))
            .unwrap();
        db.insert_recording(&rec("b", "2026-01-02T10:00:00Z"))
            .unwrap();
        let all = db.list_recordings().unwrap();
        assert_eq!(
            all.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert_eq!(all[0].peaks, vec![0, 128, 255]);
        assert_eq!(all[0].direction, CallDirection::Incoming);
        assert_eq!(
            db.get_recording("a")
                .unwrap()
                .unwrap()
                .remote_name
                .as_deref(),
            Some("Bob")
        );
        assert!(db.get_recording("zzz").unwrap().is_none());
    }

    #[test]
    fn recordings_are_linked_to_the_history_entry_once() {
        let db = Database::open_in_memory().unwrap();
        db.insert_recording(&rec("a", "2026-01-01T10:00:00Z"))
            .unwrap();
        assert_eq!(db.link_recordings_to_history("call1", "h1").unwrap(), 1);
        assert_eq!(db.link_recordings_to_history("call1", "h2").unwrap(), 0);
        assert_eq!(
            db.get_recording("a")
                .unwrap()
                .unwrap()
                .history_id
                .as_deref(),
            Some("h1")
        );
    }

    #[test]
    fn a_recording_can_be_deleted() {
        let db = Database::open_in_memory().unwrap();
        db.insert_recording(&rec("a", "2026-01-01T10:00:00Z"))
            .unwrap();
        db.delete_recording("a").unwrap();
        assert!(db.list_recordings().unwrap().is_empty());
    }
}
