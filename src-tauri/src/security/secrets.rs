//! Secret storage. SIP passwords live in the OS credential store (Keychain on
//! macOS, Credential Manager on Windows, Secret Service on Linux) and never in
//! SQLite or in logs.

use std::{collections::HashMap, sync::Mutex};

use secrecy::{ExposeSecret, SecretString};

use crate::error::{AppError, AppResult};

pub const KEYCHAIN_SERVICE: &str = "app.zephone.softphone";

pub trait SecretStore: Send + Sync {
    fn set(&self, account_id: &str, secret: &SecretString) -> AppResult<()>;
    fn get(&self, account_id: &str) -> AppResult<Option<SecretString>>;
    fn delete(&self, account_id: &str) -> AppResult<()>;
}

/// Keychain item name. SIP passwords keep their historical `sip-account:` prefix; the directory's secrets (LDAP
/// password, Microsoft refresh token) carry their own `dir:` namespace.
fn entry_name(account_id: &str) -> String {
    if account_id.starts_with("dir:") {
        account_id.to_owned()
    } else {
        format!("sip-account:{account_id}")
    }
}

/// OS-native store through the `keyring` crate.
pub struct KeyringStore;

impl KeyringStore {
    fn entry(account_id: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, &entry_name(account_id))
            .map_err(|e| AppError::Secret(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, account_id: &str, secret: &SecretString) -> AppResult<()> {
        Self::entry(account_id)?
            .set_password(secret.expose_secret())
            .map_err(|e| AppError::Secret(e.to_string()))
    }

    fn get(&self, account_id: &str) -> AppResult<Option<SecretString>> {
        match Self::entry(account_id)?.get_password() {
            Ok(p) => Ok(Some(SecretString::from(p))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }

    fn delete(&self, account_id: &str) -> AppResult<()> {
        match Self::entry(account_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore {
    inner: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn set(&self, account_id: &str, secret: &SecretString) -> AppResult<()> {
        self.inner
            .lock()
            .unwrap()
            .insert(account_id.to_owned(), secret.expose_secret().to_owned());
        Ok(())
    }

    fn get(&self, account_id: &str) -> AppResult<Option<SecretString>> {
        Ok(self
            .inner
            .lock()
            .unwrap()
            .get(account_id)
            .cloned()
            .map(SecretString::from))
    }

    fn delete(&self, account_id: &str) -> AppResult<()> {
        self.inner.lock().unwrap().remove(account_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trip() {
        let s = MemoryStore::default();
        assert!(s.get("a").unwrap().is_none());
        s.set("a", &SecretString::from("pw".to_string())).unwrap();
        assert_eq!(s.get("a").unwrap().unwrap().expose_secret(), "pw");
        s.delete("a").unwrap();
        assert!(s.get("a").unwrap().is_none());
        s.delete("a").unwrap();
    }

    #[test]
    fn directory_secrets_have_their_own_namespace() {
        assert_eq!(entry_name("dir:abc:password"), "dir:abc:password");
        assert_eq!(entry_name("abc"), "sip-account:abc");
    }

    #[test]
    fn debug_never_prints_the_secret() {
        let secret = SecretString::from("hunter2".to_string());
        assert!(!format!("{secret:?}").contains("hunter2"));
    }
}
