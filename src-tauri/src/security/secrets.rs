//! Secret storage. SIP passwords live in the OS credential store (Keychain on
//! macOS, Credential Manager on Windows, Secret Service on Linux) and never in
//! SQLite or in logs.

use std::{collections::HashMap, sync::Mutex};

use secrecy::{ExposeSecret, SecretString};

use crate::error::{AppError, AppResult};

/// The name the SIP passwords are stored under. It was the application's identifier before it became
/// `com.zenoova.zephone`; it stays as it is so that the passwords already saved are still found.
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

/// The store the application uses: the OS credential store on a computer, a private file per secret on Android
/// (see [`FileStore`]). `data_dir` is the application's private data folder.
pub fn default_store(data_dir: &std::path::Path) -> std::sync::Arc<dyn SecretStore> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = data_dir;
        std::sync::Arc::new(KeyringStore)
    }
    #[cfg(target_os = "android")]
    {
        std::sync::Arc::new(FileStore::new(data_dir.join("secrets")))
    }
}

/// One file per secret, in a folder only the application can read: Android keeps each application's data apart
/// (a separate user id) and encrypts it at rest, and has no credential store a native library can reach without
/// the Java side. The file name is the hex of the entry name, so nothing in it needs escaping.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub struct FileStore {
    dir: std::path::PathBuf,
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
impl FileStore {
    pub fn new(dir: std::path::PathBuf) -> Self {
        Self { dir }
    }

    fn path(&self, account_id: &str) -> std::path::PathBuf {
        let name: String = entry_name(account_id)
            .bytes()
            .map(|b| format!("{b:02x}"))
            .collect();
        self.dir.join(name)
    }
}

impl SecretStore for FileStore {
    fn set(&self, account_id: &str, secret: &SecretString) -> AppResult<()> {
        let io = |e: std::io::Error| AppError::Secret(e.to_string());
        std::fs::create_dir_all(&self.dir).map_err(io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.dir, std::fs::Permissions::from_mode(0o700))
                .map_err(io)?;
        }
        crate::sip::engine::baresip::process::write_private_file(
            &self.path(account_id),
            secret.expose_secret(),
        )
        .map_err(io)
    }

    fn get(&self, account_id: &str) -> AppResult<Option<SecretString>> {
        match std::fs::read_to_string(self.path(account_id)) {
            Ok(p) => Ok(Some(SecretString::from(p))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }

    fn delete(&self, account_id: &str) -> AppResult<()> {
        match std::fs::remove_file(self.path(account_id)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }
}

/// OS-native store through the `keyring` crate.
#[cfg(not(target_os = "android"))]
pub struct KeyringStore;

#[cfg(not(target_os = "android"))]
impl KeyringStore {
    fn entry(account_id: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, &entry_name(account_id))
            .map_err(|e| AppError::Secret(e.to_string()))
    }
}

#[cfg(not(target_os = "android"))]
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
    fn file_store_round_trip_and_privacy() {
        let dir = tempfile::tempdir().unwrap();
        let s = FileStore::new(dir.path().join("secrets"));
        assert!(s.get("a").unwrap().is_none());
        s.set("a", &SecretString::from("pw".to_string())).unwrap();
        s.set("dir:x:password", &SecretString::from("other".to_string()))
            .unwrap();
        assert_eq!(s.get("a").unwrap().unwrap().expose_secret(), "pw");
        assert_eq!(
            s.get("dir:x:password").unwrap().unwrap().expose_secret(),
            "other"
        );
        s.set("a", &SecretString::from("new".to_string())).unwrap();
        assert_eq!(s.get("a").unwrap().unwrap().expose_secret(), "new");
        s.delete("a").unwrap();
        assert!(s.get("a").unwrap().is_none());
        s.delete("a").unwrap();
        // The file name reveals neither the account nor the secret.
        for e in std::fs::read_dir(dir.path().join("secrets")).unwrap() {
            let n = e.unwrap().file_name().to_string_lossy().into_owned();
            assert!(n.bytes().all(|b| b.is_ascii_hexdigit()), "{n}");
        }
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
