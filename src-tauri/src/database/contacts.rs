use chrono::Utc;
use rusqlite::{Row, params};
use uuid::Uuid;

use super::{Database, like_pattern};
use crate::{
    error::{AppError, AppResult},
    sip::{
        types::{Contact, ContactInput},
        uri,
    },
};

fn from_row(r: &Row<'_>) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: r.get("id")?,
        first_name: r.get("first_name")?,
        last_name: r.get("last_name")?,
        company: r.get("company")?,
        number: r.get("number")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

impl Database {
    pub fn list_contacts(&self, query: Option<&str>) -> AppResult<Vec<Contact>> {
        self.with(|c| {
            let order = "ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, company COLLATE NOCASE";
            match query.map(str::trim).filter(|q| !q.is_empty()) {
                Some(q) => {
                    let like = like_pattern(q);
                    let mut stmt = c.prepare(&format!(
                        "SELECT * FROM contacts
                         WHERE first_name LIKE ?1 ESCAPE '\\' OR last_name LIKE ?1 ESCAPE '\\'
                            OR company LIKE ?1 ESCAPE '\\' OR number LIKE ?1 ESCAPE '\\'
                            OR (first_name || ' ' || last_name) LIKE ?1 ESCAPE '\\'
                         {order}"
                    ))?;
                    let rows = stmt.query_map([like], from_row)?;
                    rows.collect()
                }
                None => {
                    let mut stmt = c.prepare(&format!("SELECT * FROM contacts {order}"))?;
                    let rows = stmt.query_map([], from_row)?;
                    rows.collect()
                }
            }
        })
    }

    pub fn get_contact(&self, id: &str) -> AppResult<Option<Contact>> {
        self.with(|c| {
            let mut stmt = c.prepare("SELECT * FROM contacts WHERE id = ?1")?;
            let mut rows = stmt.query_map([id], from_row)?;
            rows.next().transpose()
        })
    }

    pub fn save_contact(&self, input: &ContactInput) -> AppResult<Contact> {
        input.validate()?;
        let now = Utc::now().to_rfc3339();
        let company = input
            .company
            .as_ref()
            .map(|c| c.trim().to_owned())
            .filter(|c| !c.is_empty());
        match &input.id {
            Some(id) => {
                let n = self.with(|c| {
                    c.execute(
                        "UPDATE contacts SET first_name=?2, last_name=?3, company=?4, number=?5, updated_at=?6 WHERE id=?1",
                        params![id, input.first_name.trim(), input.last_name.trim(), company, input.number.trim(), now],
                    )
                })?;
                if n == 0 {
                    return Err(AppError::NotFound("contact".into()));
                }
                self.get_contact(id)?
                    .ok_or_else(|| AppError::NotFound("contact".into()))
            }
            None => {
                let id = Uuid::new_v4().to_string();
                self.with(|c| {
                    c.execute(
                        "INSERT INTO contacts (id, first_name, last_name, company, number, created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?6)",
                        params![id, input.first_name.trim(), input.last_name.trim(), company, input.number.trim(), now],
                    )
                })?;
                self.get_contact(&id)?
                    .ok_or_else(|| AppError::NotFound("contact".into()))
            }
        }
    }

    pub fn delete_contact(&self, id: &str) -> AppResult<()> {
        self.with(|c| {
            c.execute("DELETE FROM contacts WHERE id = ?1", [id])
                .map(|_| ())
        })
    }

    /// Finds the contact whose number matches a SIP URI / phone number (see [`uri::numbers_match`]).
    pub fn find_contact_by_number(&self, number_or_uri: &str) -> AppResult<Option<Contact>> {
        let all = self.list_contacts(None)?;
        Ok(all
            .into_iter()
            .find(|c| uri::numbers_match(&c.number, number_or_uri)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(first: &str, last: &str, number: &str) -> ContactInput {
        ContactInput {
            id: None,
            first_name: first.into(),
            last_name: last.into(),
            company: None,
            number: number.into(),
        }
    }

    #[test]
    fn create_update_delete() {
        let db = Database::open_in_memory().unwrap();
        let c = db.save_contact(&input("Ada", "Lovelace", "1001")).unwrap();
        assert_eq!(c.first_name, "Ada");
        let mut upd = input("Ada", "Byron", "sip:ada@example.com");
        upd.id = Some(c.id.clone());
        upd.company = Some("  Analytical Engines ".into());
        let c2 = db.save_contact(&upd).unwrap();
        assert_eq!(c2.last_name, "Byron");
        assert_eq!(c2.company.as_deref(), Some("Analytical Engines"));
        assert_eq!(c2.created_at, c.created_at);
        db.delete_contact(&c.id).unwrap();
        assert!(db.get_contact(&c.id).unwrap().is_none());
        let mut ghost = input("X", "Y", "1");
        ghost.id = Some("nope".into());
        assert!(db.save_contact(&ghost).is_err());
    }

    #[test]
    fn search_matches_name_company_number_and_full_name() {
        let db = Database::open_in_memory().unwrap();
        db.save_contact(&input("Ada", "Lovelace", "1001")).unwrap();
        let mut c = input("Grace", "Hopper", "+33612345678");
        c.company = Some("Navy".into());
        db.save_contact(&c).unwrap();
        let names = |q: &str| -> Vec<String> {
            db.list_contacts(Some(q))
                .unwrap()
                .into_iter()
                .map(|c| c.first_name)
                .collect()
        };
        assert_eq!(names("love"), vec!["Ada"]);
        assert_eq!(names("navy"), vec!["Grace"]);
        assert_eq!(names("3361"), vec!["Grace"]);
        assert_eq!(names("ada lovelace"), vec!["Ada"]);
        assert!(names("zzz").is_empty());
        assert_eq!(db.list_contacts(Some("  ")).unwrap().len(), 2);
    }

    #[test]
    fn search_is_not_a_sql_injection_vector() {
        let db = Database::open_in_memory().unwrap();
        db.save_contact(&input("Ada", "Lovelace", "1001")).unwrap();
        assert!(db.list_contacts(Some("' OR 1=1 --")).unwrap().is_empty());
        assert!(
            db.list_contacts(Some("%")).unwrap().is_empty(),
            "% is a literal, not a wildcard"
        );
    }

    #[test]
    fn contacts_are_sorted_case_insensitively() {
        let db = Database::open_in_memory().unwrap();
        db.save_contact(&input("b", "zulu", "2")).unwrap();
        db.save_contact(&input("a", "Alpha", "1")).unwrap();
        let order: Vec<_> = db
            .list_contacts(None)
            .unwrap()
            .into_iter()
            .map(|c| c.last_name)
            .collect();
        assert_eq!(order, vec!["Alpha", "zulu"]);
    }

    #[test]
    fn lookup_by_number_handles_uris_and_formats() {
        let db = Database::open_in_memory().unwrap();
        db.save_contact(&input("Ada", "Lovelace", "+33 6 12 34 56 78"))
            .unwrap();
        db.save_contact(&input("Bob", "Ext", "1002")).unwrap();
        assert_eq!(
            db.find_contact_by_number("sip:+33612345678@pbx")
                .unwrap()
                .unwrap()
                .first_name,
            "Ada"
        );
        assert_eq!(
            db.find_contact_by_number("sip:1002@pbx")
                .unwrap()
                .unwrap()
                .first_name,
            "Bob"
        );
        assert!(db.find_contact_by_number("sip:9999@pbx").unwrap().is_none());
    }

    #[test]
    fn invalid_contacts_are_rejected() {
        let db = Database::open_in_memory().unwrap();
        assert!(db.save_contact(&input("", "", "1001")).is_err());
        assert!(db.save_contact(&input("Ada", "", "")).is_err());
        assert!(db.save_contact(&input("Ada", "", "bad number;x")).is_err());
    }
}
