//! Application-wide error type. Serialised as `{ kind, message }` so the
//! frontend can show a readable message without parsing strings.

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{0} not found")]
    NotFound(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("secure storage error: {0}")]
    Secret(String),
    #[error("SIP engine error: {0}")]
    Engine(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "validation",
            AppError::NotFound(_) => "notFound",
            AppError::Database(_) => "database",
            AppError::Secret(_) => "secret",
            AppError::Engine(_) => "engine",
            AppError::Other(_) => "other",
        }
    }

    pub fn validation(msg: impl Into<String>) -> Self {
        AppError::Validation(msg.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_kind_and_message() {
        let err = AppError::validation("bad port");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "validation");
        assert_eq!(json["message"], "bad port");
    }
}
