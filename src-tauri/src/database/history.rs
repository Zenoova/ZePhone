use rusqlite::{Row, params};
use serde::Deserialize;

use super::{Database, like_pattern};
use crate::{
    error::AppResult,
    sip::types::{CallDirection, CallResult, HistoryEntry},
};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum HistoryKind {
    #[default]
    All,
    Incoming,
    Outgoing,
    Missed,
    /// Failed + rejected + cancelled.
    Failed,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryFilter {
    pub query: Option<String>,
    pub kind: HistoryKind,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

fn from_row(r: &Row<'_>) -> rusqlite::Result<HistoryEntry> {
    let direction: String = r.get("direction")?;
    let result: String = r.get("result")?;
    Ok(HistoryEntry {
        id: r.get("id")?,
        account_id: r.get("account_id")?,
        account_label: r.get("account_label")?,
        remote_uri: r.get("remote_uri")?,
        remote_number: r.get("remote_number")?,
        contact_name: r.get("contact_name")?,
        direction: CallDirection::parse(&direction).unwrap_or(CallDirection::Outgoing),
        result: CallResult::parse(&result).unwrap_or(CallResult::Failed),
        started_at: r.get("started_at")?,
        answered_at: r.get("answered_at")?,
        ended_at: r.get("ended_at")?,
        duration_secs: r.get::<_, i64>("duration_secs")?.max(0) as u64,
        sip_code: r.get::<_, Option<i64>>("sip_code")?.map(|c| c as u16),
        reason: r.get("reason")?,
    })
}

impl Database {
    pub fn insert_history(&self, h: &HistoryEntry) -> AppResult<()> {
        self.with(|c| {
            c.execute(
                "INSERT INTO call_history (id, account_id, account_label, remote_uri, remote_number, contact_name,
                    direction, result, started_at, answered_at, ended_at, duration_secs, sip_code, reason)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    h.id,
                    h.account_id,
                    h.account_label,
                    h.remote_uri,
                    h.remote_number,
                    h.contact_name,
                    h.direction.as_str(),
                    h.result.as_str(),
                    h.started_at,
                    h.answered_at,
                    h.ended_at,
                    h.duration_secs as i64,
                    h.sip_code.map(i64::from),
                    h.reason,
                ],
            )
            .map(|_| ())
        })
    }

    pub fn list_history(&self, f: &HistoryFilter) -> AppResult<Vec<HistoryEntry>> {
        let mut sql = String::from("SELECT * FROM call_history WHERE 1=1");
        let mut args: Vec<String> = vec![];
        match f.kind {
            HistoryKind::All => {}
            HistoryKind::Incoming => sql.push_str(" AND direction = 'incoming'"),
            HistoryKind::Outgoing => sql.push_str(" AND direction = 'outgoing'"),
            HistoryKind::Missed => sql.push_str(" AND result = 'missed'"),
            HistoryKind::Failed => sql.push_str(" AND result IN ('failed','rejected','cancelled')"),
        }
        if let Some(q) = f.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            args.push(like_pattern(q));
            sql.push_str(
                " AND (remote_number LIKE ?1 ESCAPE '\\' OR remote_uri LIKE ?1 ESCAPE '\\'
                       OR contact_name LIKE ?1 ESCAPE '\\' OR account_label LIKE ?1 ESCAPE '\\')",
            );
        }
        sql.push_str(" ORDER BY started_at DESC, rowid DESC");
        let limit = f.limit.unwrap_or(200).clamp(1, 1000);
        let offset = f.offset.unwrap_or(0);
        sql.push_str(&format!(" LIMIT {limit} OFFSET {offset}"));
        self.with(|c| {
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), from_row)?;
            rows.collect()
        })
    }

    pub fn delete_history(&self, id: &str) -> AppResult<()> {
        self.with(|c| {
            c.execute("DELETE FROM call_history WHERE id = ?1", [id])
                .map(|_| ())
        })
    }

    pub fn clear_history(&self) -> AppResult<()> {
        self.with(|c| c.execute("DELETE FROM call_history", []).map(|_| ()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        id: &str,
        started: &str,
        dir: CallDirection,
        res: CallResult,
        number: &str,
    ) -> HistoryEntry {
        HistoryEntry {
            id: id.into(),
            account_id: Some("acc".into()),
            account_label: Some("Bureau".into()),
            remote_uri: format!("sip:{number}@pbx"),
            remote_number: number.into(),
            contact_name: (number == "1002").then(|| "Bob".to_string()),
            direction: dir,
            result: res,
            started_at: started.into(),
            answered_at: (res == CallResult::Answered).then(|| started.to_string()),
            ended_at: started.into(),
            duration_secs: if res == CallResult::Answered { 42 } else { 0 },
            sip_code: (res == CallResult::Failed).then_some(486),
            reason: None,
        }
    }

    fn seeded() -> Database {
        let db = Database::open_in_memory().unwrap();
        db.insert_history(&entry(
            "1",
            "2026-01-01T10:00:00Z",
            CallDirection::Outgoing,
            CallResult::Answered,
            "1002",
        ))
        .unwrap();
        db.insert_history(&entry(
            "2",
            "2026-01-02T10:00:00Z",
            CallDirection::Incoming,
            CallResult::Missed,
            "1003",
        ))
        .unwrap();
        db.insert_history(&entry(
            "3",
            "2026-01-03T10:00:00Z",
            CallDirection::Outgoing,
            CallResult::Failed,
            "1004",
        ))
        .unwrap();
        db.insert_history(&entry(
            "4",
            "2026-01-04T10:00:00Z",
            CallDirection::Incoming,
            CallResult::Rejected,
            "1005",
        ))
        .unwrap();
        db
    }

    fn ids(db: &Database, f: HistoryFilter) -> Vec<String> {
        db.list_history(&f)
            .unwrap()
            .into_iter()
            .map(|h| h.id)
            .collect()
    }

    #[test]
    fn newest_first_and_round_trip() {
        let db = seeded();
        assert_eq!(ids(&db, HistoryFilter::default()), vec!["4", "3", "2", "1"]);
        let h = &db.list_history(&HistoryFilter::default()).unwrap()[3];
        assert_eq!(h.duration_secs, 42);
        assert_eq!(h.result, CallResult::Answered);
        assert_eq!(h.contact_name.as_deref(), Some("Bob"));
    }

    #[test]
    fn filters() {
        let db = seeded();
        let k = |kind| HistoryFilter {
            kind,
            ..Default::default()
        };
        assert_eq!(ids(&db, k(HistoryKind::Missed)), vec!["2"]);
        assert_eq!(ids(&db, k(HistoryKind::Incoming)), vec!["4", "2"]);
        assert_eq!(ids(&db, k(HistoryKind::Outgoing)), vec!["3", "1"]);
        assert_eq!(ids(&db, k(HistoryKind::Failed)), vec!["4", "3"]);
    }

    #[test]
    fn search_by_number_and_contact_name() {
        let db = seeded();
        let q = |s: &str| HistoryFilter {
            query: Some(s.into()),
            ..Default::default()
        };
        assert_eq!(ids(&db, q("1003")), vec!["2"]);
        assert_eq!(ids(&db, q("bob")), vec!["1"]);
        assert!(ids(&db, q("nothing")).is_empty());
    }

    #[test]
    fn pagination_and_limit_clamp() {
        let db = seeded();
        let f = HistoryFilter {
            limit: Some(2),
            offset: Some(1),
            ..Default::default()
        };
        assert_eq!(ids(&db, f), vec!["3", "2"]);
        let f = HistoryFilter {
            limit: Some(0),
            ..Default::default()
        };
        assert_eq!(ids(&db, f).len(), 1, "limit is clamped to at least 1");
    }

    #[test]
    fn delete_one_and_clear() {
        let db = seeded();
        db.delete_history("2").unwrap();
        assert_eq!(ids(&db, HistoryFilter::default()), vec!["4", "3", "1"]);
        db.clear_history().unwrap();
        assert!(ids(&db, HistoryFilter::default()).is_empty());
    }

    #[test]
    fn history_survives_account_deletion() {
        let db = seeded();
        db.delete_account("acc").unwrap();
        assert_eq!(db.list_history(&HistoryFilter::default()).unwrap().len(), 4);
    }
}
