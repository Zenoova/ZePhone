//! The company directory: contacts from several sources (the local address book, LDAP, Microsoft 365) in one
//! searchable place, with personal favourites and groups kept apart from what the sources provide.
//!
//! * [`model`] — contacts, sources, queries: nothing that depends on how a source is reached;
//! * [`normalize`] — folded text and number keys for searching, dialable numbers;
//! * the connectors (`ldap`, `microsoft`) turn a source into [`model::RemoteContact`]s.

pub mod connectors;
pub mod index;
pub mod ldap;
pub mod microsoft;
pub mod model;
pub mod normalize;
pub mod service;
pub mod store;
pub mod sync;
pub mod system_contacts;
// Compiled everywhere so that its parsing is tested on a computer; only Android runs it.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) mod system_contacts_android;
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod system_contacts_apple;
