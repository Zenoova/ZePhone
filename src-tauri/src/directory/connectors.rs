//! Builds the connector of a stored source: reads its non-secret configuration from the database record, its
//! secrets from the credential store, and the company CA (if any) from the network settings.

use std::sync::Arc;

use super::{
    ldap::{LdapConfig, LdapConnector},
    microsoft::{Endpoints, MicrosoftConfig, MicrosoftConnector},
    model::{SourceKind, SyncErrorKind},
    store::SourceRow,
    sync::{Connector, ConnectorFactory, SyncError, secret_key},
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
                "Le fichier de l'autorité de certification (Paramètres → Réseau) est illisible.",
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
                            "La configuration de cette source est illisible : modifiez-la.",
                        )
                    })?;
                let password = secrets
                    .get(&secret_key(&source.id, "password"))
                    .map_err(|_| {
                        SyncError::new(
                            SyncErrorKind::Config,
                            "Le mot de passe de cette source est inaccessible dans le trousseau.",
                        )
                    })?;
                if !config.bind_dn.trim().is_empty() && password.is_none() {
                    return Err(SyncError::new(
                        SyncErrorKind::Auth,
                        "Le mot de passe de cette source n'est plus enregistré : saisissez-le à nouveau.",
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
                            "La configuration de cette source est illisible : modifiez-la.",
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
            SourceKind::Local => Err(SyncError::new(
                SyncErrorKind::Config,
                "Le carnet d'adresses local n'a rien à synchroniser.",
            )),
        }
    }
}
