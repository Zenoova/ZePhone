//! The company directory: contacts from several sources (the local address book, LDAP, Microsoft 365) in one
//! searchable place, with personal favourites and groups kept apart from what the sources provide.
//!
//! * [`model`] — contacts, sources, queries: nothing that depends on how a source is reached;
//! * [`normalize`] — folded text and number keys for searching, dialable numbers;
//! * the connectors (`ldap`, `microsoft`) turn a source into [`model::RemoteContact`]s.

pub mod model;
pub mod normalize;
pub mod store;
