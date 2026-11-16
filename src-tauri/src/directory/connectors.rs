//! Builds the connector of a stored source: reads its non-secret configuration from the database record, its
//! secrets from the credential store, and the company CA (if any) from the network settings.

use std::sync::Arc;

use super::{
    ldap::{LdapConfig, LdapConnector},
    microsoft::{Endpoints, MicrosoftConfig, MicrosoftConnector},
    model::{SourceKind, SyncErrorKind},
    store::SourceRow,
    sync::{Connector, ConnectorFactory, SyncError, secret_key},
    system_contacts::{SystemContactsConnector, platform_provider},
};
use crate::{database::Database, security::secrets::SecretStore};

pub struct RealConnectorFactory {
    db: Arc<Database>,
    microsoft: Endpoints,
}

impl RealConnectorFactory {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            microsoft: Endpoints::default(),
        }
    }

    /// For tests that stand a stand-in Microsoft service on the loopback. The connector still refuses any
    /// unencrypted address that is not the loopback.
    pub fn with_microsoft_endpoints(db: Arc<Database>, microsoft: Endpoints) -> Self {
        Self { db, microsoft }
    }

    /// The additional certificate authority the user configured for the network (PEM), if any.
    fn ca_pem(&self) -> Result<Option<Vec<u8>>, SyncError> {
        let Some(path) = self
            .db
            .get_settings()
            .ok()
            .and_then(|s| s.network.custom_ca_file)
        else {
            return Ok(None);
        };
        std::fs::read(&path).map(Some).map_err(|_| {
            SyncError::new(
                SyncErrorKind::Config,
                "The certificate authority file (Settings → Network) is unreadable.",
            )
        })
    }
}

impl ConnectorFactory for RealConnectorFactory {
    fn build(
        &self,
        source: &SourceRow,
        secrets: Arc<dyn SecretStore>,
    ) -> Result<Box<dyn Connector>, SyncError> {
        match source.kind {
            SourceKind::Ldap => {
                let config: LdapConfig =
                    serde_json::from_value(source.config.clone()).map_err(|_| {
                        SyncError::new(
                            SyncErrorKind::Config,
                            "The configuration of this source is unreadable: edit it.",
                        )
                    })?;
                let password = secrets
                    .get(&secret_key(&source.id, "password"))
                    .map_err(|_| {
                        SyncError::new(
                            SyncErrorKind::Config,
                            "The password of this source is not accessible in the keychain.",
                        )
                    })?;
                if !config.bind_dn.trim().is_empty() && password.is_none() {
                    return Err(SyncError::new(
                        SyncErrorKind::Auth,
                        "The password of this source is no longer saved: enter it again.",
                    ));
                }
                Ok(Box::new(LdapConnector::new(
                    config,
                    password,
                    self.ca_pem()?,
                )))
            }
            SourceKind::MicrosoftOrg | SourceKind::MicrosoftPersonal => {
                let config: MicrosoftConfig = serde_json::from_value(source.config.clone())
                    .map_err(|_| {
                        SyncError::new(
                            SyncErrorKind::Config,
                            "The configuration of this source is unreadable: edit it.",
                        )
                    })?;
                let ca = self.ca_pem()?;
                Ok(Box::new(MicrosoftConnector::new(
                    source.kind,
                    config,
                    self.microsoft.clone(),
                    secrets,
                    source.id.clone(),
                    ca.as_deref(),
                )?))
            }
            SourceKind::SystemContacts => {
                Ok(Box::new(SystemContactsConnector::new(platform_provider())))
            }
            SourceKind::Local => Err(SyncError::new(
                SyncErrorKind::Config,
                "The local address book has nothing to sync.",
            )),
        }
    }
}
