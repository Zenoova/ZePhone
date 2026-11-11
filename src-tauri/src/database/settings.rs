use super::Database;
use crate::{error::AppResult, sip::types::Settings};

const KEY: &str = "app";

impl Database {
    /// Stored as one JSON document; fields missing from older versions fall back to defaults.
    pub fn get_settings(&self) -> AppResult<Settings> {
        let raw: Option<String> = self.with(|c| {
            let mut stmt = c.prepare("SELECT value FROM settings WHERE key = ?1")?;
            let mut rows = stmt.query_map([KEY], |r| r.get::<_, String>(0))?;
            rows.next().transpose()
        })?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn save_settings(&self, s: &Settings) -> AppResult<()> {
        let json = serde_json::to_string(s).map_err(|e| crate::error::AppError::Database(e.to_string()))?;
        self.with(|c| {
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [KEY, json.as_str()],
            )
            .map(|_| ())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sip::types::Theme;

    #[test]
    fn defaults_then_round_trip() {
        let db = Database::open_in_memory().unwrap();
        let mut s = db.get_settings().unwrap();
        assert_eq!(s, Settings::default());
        s.general.theme = Theme::Dark;
        s.audio.input_device = Some("USB Mic".into());
        s.network.local_sip_port = Some(5070);
        db.save_settings(&s).unwrap();
        assert_eq!(db.get_settings().unwrap(), s);
    }

    #[test]
    fn corrupt_settings_fall_back_to_defaults() {
        let db = Database::open_in_memory().unwrap();
        db.with(|c| c.execute("INSERT INTO settings (key, value) VALUES ('app', '{not json')", []).map(|_| ())).unwrap();
        assert_eq!(db.get_settings().unwrap(), Settings::default());
    }
}
