//! What a source connector is, and the rules that decide when to synchronise.

use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};

use super::{
    model::{RemoteContact, SyncErrorKind},
    store::SourceRow,
};
use crate::security::secrets::SecretStore;

/// What a connector read from its source.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Fetched {
    /// A complete copy of the source (`complete`), or the records that were added or changed since the cursor.
    pub contacts: Vec<RemoteContact>,
    /// The external ids the source says were deleted. Only for a partial read.
    pub removed: Vec<String>,
    /// `true` when `contacts` is everything the source has: what is missing from it is deleted.
    /// `false` for the changes since the cursor.
    pub complete: bool,
    /// Where the next synchronisation continues from (a delta link...).
    pub cursor: Option<String>,
}

/// Why a synchronisation failed, in words the user can act on. Never carries a credential or a contact.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncError {
    pub kind: SyncErrorKind,
    pub message: String,
    /// The service asked to wait this long before the next request.
    pub retry_after: Option<Duration>,
}

impl SyncError {
    pub fn new(kind: SyncErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after: None,
        }
    }
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// A way to read contacts from one source. Connectors know nothing about the cache, the index or the UI.
#[async_trait]
pub trait Connector: Send + Sync {
    /// Reads the source. `cursor` is what the previous successful read returned; a connector whose cursor is
    /// no longer valid falls back to a complete read. `progress` is told how many contacts were read so far.
    async fn fetch(
        &self,
        cursor: Option<&str>,
        progress: &(dyn Fn(usize) + Send + Sync),
    ) -> Result<Fetched, SyncError>;
}

/// Builds the connector of a stored source, reading its secrets from the credential store.
pub trait ConnectorFactory: Send + Sync {
    fn build(
        &self,
        source: &SourceRow,
        secrets: &dyn SecretStore,
    ) -> Result<Box<dyn Connector>, SyncError>;
}

/// Name of a source's secret in the credential store.
pub fn secret_key(source_id: &str, what: &str) -> String {
    format!("dir:{source_id}:{what}")
}

/// How long to wait after the `failures`-th failure in a row before trying again on its own:
/// 1, 2, 4... minutes, never more than an hour. A source is never retried in a tight loop.
pub fn backoff_delay(failures: u32) -> Duration {
    let minutes = 1u64 << failures.saturating_sub(1).min(6);
    Duration::from_secs(minutes.min(60) * 60)
}

/// Failures that retrying cannot fix: the user has to do something first.
pub fn needs_the_user(kind: SyncErrorKind) -> bool {
    matches!(
        kind,
        SyncErrorKind::Auth | SyncErrorKind::Forbidden | SyncErrorKind::Config
    )
}

fn parse_time(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Is it time to synchronise this source on its own?
pub fn is_due(
    source: &SourceRow,
    now: DateTime<Utc>,
    blocked_until: Option<DateTime<Utc>>,
) -> bool {
    if !source.enabled || source.sync_interval_min == 0 {
        return false;
    }
    if source.error_kind.is_some_and(needs_the_user) {
        return false; // waits for the user: reconnecting, fixing the settings
    }
    if blocked_until.is_some_and(|t| t > now) {
        return false;
    }
    match source.last_attempt_at.as_deref().and_then(parse_time) {
        None => true,
        Some(at) => now - at >= chrono::Duration::minutes(i64::from(source.sync_interval_min)),
    }
}

/// How long cached contacts may go without a successful synchronisation before they are erased: personal data of
/// third parties are not kept indefinitely for a source that cannot be reached any more.
pub const CACHE_MAX_AGE_DAYS: i64 = 30;

/// Has the cache of this source outlived [`CACHE_MAX_AGE_DAYS`]?
pub fn is_expired(source: &SourceRow, now: DateTime<Utc>) -> bool {
    source
        .last_success_at
        .as_deref()
        .and_then(parse_time)
        .is_some_and(|at| now - at > chrono::Duration::days(CACHE_MAX_AGE_DAYS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directory::model::SourceKind;

    fn source() -> SourceRow {
        SourceRow {
            id: "s".into(),
            kind: SourceKind::Ldap,
            name: "n".into(),
            enabled: true,
            config: serde_json::json!({}),
            sync_interval_min: 60,
            cursor: None,
            last_success_at: None,
            last_attempt_at: None,
            last_error: None,
            error_kind: None,
        }
    }

    fn at(s: &str) -> DateTime<Utc> {
        parse_time(s).unwrap()
    }

    #[test]
    fn the_back_off_doubles_and_never_exceeds_an_hour() {
        let minutes: Vec<u64> = (1..=9).map(|n| backoff_delay(n).as_secs() / 60).collect();
        assert_eq!(minutes, [1, 2, 4, 8, 16, 32, 60, 60, 60]);
        assert_eq!(backoff_delay(0).as_secs(), 60);
        assert_eq!(backoff_delay(u32::MAX).as_secs(), 3600);
    }

    #[test]
    fn a_source_is_due_once_its_interval_has_passed() {
        let mut s = source();
        let now = at("2026-01-01T12:00:00Z");
        assert!(is_due(&s, now, None), "never tried");
        s.last_attempt_at = Some("2026-01-01T11:30:00Z".into());
        assert!(!is_due(&s, now, None), "30 min ago, every 60");
        s.last_attempt_at = Some("2026-01-01T10:59:00Z".into());
        assert!(is_due(&s, now, None));
    }

    #[test]
    fn manual_and_disabled_sources_are_never_due() {
        let now = at("2026-01-01T12:00:00Z");
        let mut s = source();
        s.sync_interval_min = 0;
        assert!(!is_due(&s, now, None), "manual only");
        let mut s = source();
        s.enabled = false;
        assert!(!is_due(&s, now, None));
    }

    #[test]
    fn a_failure_that_needs_the_user_is_not_retried_on_its_own() {
        let now = at("2026-01-01T12:00:00Z");
        for kind in [
            SyncErrorKind::Auth,
            SyncErrorKind::Forbidden,
            SyncErrorKind::Config,
        ] {
            let mut s = source();
            s.last_attempt_at = Some("2025-12-01T00:00:00Z".into());
            s.error_kind = Some(kind);
            assert!(!is_due(&s, now, None), "{kind:?}");
        }
        for kind in [
            SyncErrorKind::Network,
            SyncErrorKind::Server,
            SyncErrorKind::Throttled,
        ] {
            let mut s = source();
            s.last_attempt_at = Some("2025-12-01T00:00:00Z".into());
            s.error_kind = Some(kind);
            assert!(is_due(&s, now, None), "{kind:?}");
        }
    }

    #[test]
    fn a_back_off_holds_the_source_back_until_it_ends() {
        let now = at("2026-01-01T12:00:00Z");
        let mut s = source();
        s.last_attempt_at = Some("2025-12-01T00:00:00Z".into());
        assert!(!is_due(&s, now, Some(at("2026-01-01T12:05:00Z"))));
        assert!(is_due(&s, now, Some(at("2026-01-01T11:59:00Z"))));
    }

    #[test]
    fn a_cache_expires_after_thirty_days_without_a_successful_synchronisation() {
        let now = at("2026-02-01T00:00:00Z");
        let mut s = source();
        assert!(!is_expired(&s, now), "never synchronised: nothing cached");
        s.last_success_at = Some("2026-01-10T00:00:00Z".into());
        assert!(!is_expired(&s, now));
        s.last_success_at = Some("2025-12-31T00:00:00Z".into());
        assert!(is_expired(&s, now));
    }

    #[test]
    fn secrets_are_named_by_source() {
        assert_eq!(secret_key("abc", "password"), "dir:abc:password");
    }
}
