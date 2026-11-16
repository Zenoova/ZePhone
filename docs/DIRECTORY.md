# Enterprise directory

ZePhone brings together in one place — the **Directory** tab — several sources of contacts:

| Source                           | What it is                                               | Editable here? |
| -------------------------------- | -------------------------------------------------------- | -------------- |
| **Local contacts**               | ZePhone's own address book (always there)                | yes            |
| **LDAP / Active Directory**      | The people of a company LDAP server                      | no (read-only) |
| **Microsoft 365 · organization** | The people of the company's Microsoft Entra ID directory | no             |
| **Outlook · personal contacts**  | **The user's own** Outlook contacts (not the company's)  | no             |
| **Mac contacts**                 | The computer's Contacts application (macOS)              | no (read-only) |

The two Microsoft sources are **two different things** (a directory shared by the whole company, and a
private address book): they are connected separately and never mixed up.

What stays yours: your personal **favorites** and **groups**. They are stored apart from the synchronized data,
tied to the stable identifier of each contact, and so survive updates and outages.

## Find, call, transfer

- Search ignores case and accents ("elodie" finds "Élodie") and looks in the name, first name, company,
  department, job title, e-mail, SIP addresses and numbers. A number is found in spite of spaces, dots and dashes
  (`06 12-34-56-78` = `0612345678`), in its national or international form (`01 23…` = `+33 1 23…`), and an internal
  extension is searched as `4567` or `poste 4567`.
- A contact with **several numbers** is never called "at random": the call button asks which one (work,
  mobile, internal extension…). Each number is shown **as the source wrote it**.
- A call goes through ZePhone's dialing (`dial`), a transfer through its transfer (`transfer_call`). Numbers are
  cleaned up for dialing (`+33 (0)1 23-45.67.89` → `+33123456789`); a **SIP address** and an **internal extension** are kept
  as they are.
- **Transfer** is offered when a call is in progress (not a call on hold). In the call window, "Transfer"
  also opens a directory search.
- Keyboard: `/` goes to the search · `↓` goes down into the results · `↑ ↓ Home End PageUp PageDown` move ·
  `Enter` opens the card · `Ctrl/⌘ + Enter` calls (if there is a single number) · `F` toggles favorite · `Esc` goes back to the search.
- The list is virtualized: a few thousand contacts stay smooth (20,000 contacts: ~10 ms per search, measured).

## Naming calls

A call — incoming or outgoing — whose number is not in **your local contacts** is named by the enterprise directory, on
the ringing screen, in the notification and during the call. The order is: **your local contacts**, then **the directory**, then the name
the caller sends about themselves.

- **Only when it is certain.** The name is only shown if the number belongs to **a single person**: two people
  who share a number, or the same extension in two sources, give **no name** (the number is kept, or the name the
  caller sends). Two cards from different sources that have the same e-mail address count as one person.
- **How the number is recognized.** By its digits, however it is written: `0123456789`, `+33 1 23 45 67 89`,
  `0033123456789` and `+33 (0)1 23 45 67 89` designate the same line. An internal extension must be **identical** (`456` is not
  `4567`). A SIP address is recognized by its user **and** its server: `sip:chloe@pbx.company.com` is not
  `sip:chloe@other.com`. Fewer than 3 digits: never a name.
- **Not in the history.** The name taken from the directory is shown during the call but **is not copied into the history**:
  the history survives the disconnection of a source, whose cache is erased. The history keeps what it already kept (your local
  contact, or the name sent by the caller).
- A source that is disconnected, disabled, or whose cache has expired no longer names anyone.

**Presence**: ZePhone has no presence feature (BLF, SIMPLE); the directory therefore shows **no availability**.
Being in the directory says nothing about whether a person can be reached.

## Connecting an LDAP directory

Settings → Directory → Add a source → _LDAP or Active Directory directory_.

| Field             | Example                                   | Note                                                                                                                  |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Address           | `ldaps://ldap.company.com:636`            | `ldaps://` recommended, or `ldap://` + StartTLS                                                                       |
| Account (Bind DN) | `cn=reader,dc=company,dc=com`             | empty = anonymous read                                                                                                |
| Password          | —                                         | stored in the system **keychain**, never in a file                                                                    |
| Search base       | `ou=people,dc=company,dc=com`             |                                                                                                                       |
| Filter            | `(objectClass=inetOrgPerson)`             | for Active Directory: `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` |
| Mapping           | pre-filled (OpenLDAP or Active Directory) | one or more attributes per field; numbers have a type                                                                 |

- **Why no intermediate service**: ZePhone is a native application; its Rust engine opens the LDAP connection itself
  (a web page could not). Nothing goes through a third-party server.
- **Test the connection** connects, authenticates and shows the **first ten contacts** as the configuration would
  produce them, with useful warnings (no entry, no number, no identifier). **"Save and enable" is only
  possible after a successful test of the settings as they are**: a change needs a new test.
- **Security**: the server's certificate is **always verified** (system store, plus the certificate authority from
  _Settings → Network_ if your company has its own); there is no option to turn it off. A password is
  never sent in clear text: `ldap://` without StartTLS is refused as soon as an account is given. Attribute names and the filter are
  validated before anything is sent.
- **Rights**: the directory shows what the **sign-in account** is allowed to read, nothing more. A server that answers "base
  not found" to an account without rights is explained as such.
- **Stable identifier**: `entryUUID` (OpenLDAP) or `objectGUID` (Active Directory); the DN, which changes when an
  entry is renamed, is only used as a last resort.
- **No technical groups**: only people are read. The "departments" offered as a filter are the values of the
  _department_ field of the records; the server's security groups never become categories.
- LDAP has no standard mechanism to report deletions: each synchronization rereads the **whole** directory in pages
  (500 by default), which makes it possible to detect the people who left.

## Connecting Microsoft 365

Settings → Directory → Add a source → _Microsoft 365: the organization's directory_ or _Outlook: my personal contacts_.

ZePhone uses the official **OAuth 2.0 "authorization code + PKCE"** flow (RFC 7636) with Microsoft Graph: signing in happens
**in your browser, on Microsoft's page**; ZePhone never sees your password, holds **no application
secret** (public client) and only keeps the refresh token, in the keychain.

### What to prepare (once, by the administrator or the user)

ZePhone does not provide an application identifier: **your organization has to register one** (Microsoft Entra admin
center → App registrations → New registration).

1. Account types: _this organization only_ (directory); _organization and personal accounts_ (Outlook contacts).
2. Redirect URI: platform **Mobile and desktop applications**, value `http://localhost`.
3. Authentication → **Allow public client flows: Yes**.
4. API permissions → Microsoft Graph → **Delegated**, then, if necessary, **Grant admin consent**:

| Source                     | Permissions (read-only)                 | Administrator consent                     |
| -------------------------- | --------------------------------------- | ----------------------------------------- |
| Organization — full level  | `User.Read.All` + `offline_access`      | **yes** (usually)                         |
| Organization — basic level | `User.ReadBasic.All` + `offline_access` | no (name and e-mail only, **no numbers**) |
| Personal Outlook contacts  | `Contacts.Read` + `offline_access`      | no                                        |

5. Copy the **application (client) ID** into ZePhone; the tenant is `organizations`, `common`, a tenant identifier
   or a domain.

### Possible restrictions, and what ZePhone tells you

| Situation                                     | Message / action                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The administrator has not consented           | "Your organization's administrator must allow the application…" with the list of permissions to pass on, then **Reconnect** |
| Conditional access policy                     | "A conditional access policy blocks this sign-in"                                                                           |
| Account without a mailbox (personal contacts) | "This account has no Outlook mailbox"                                                                                       |
| Token revoked / expired / password changed    | **Reconnect** — never retried automatically                                                                                 |
| Rate limiting (429)                           | waits for the duration Microsoft asks for (capped at 1 h)                                                                   |

The organization's directory is synchronized **by differences** (`/users/delta`) at the full level; if the synchronization link
expires, ZePhone rereads everything. Personal contacts are reread in full (stable Outlook identifiers).

## Mac contacts

Settings → Directory → Add a source → **Mac contacts (read-only)**. The contacts of the Contacts application are added to
the directory: search, card, call, transfer, groups, favorites, and the name shown on calls, as for the other sources.

- **One permission, yours.** macOS asks its own question the first time ("ZePhone would like to access your
  contacts"). If you decline, **nothing is created** and ZePhone tells you where to change your mind (_System Settings → Privacy &
  Security → Contacts_, with a button that goes there). If you withdraw the permission later, the source goes into error with a
  **Allow access** button; it is never retried by itself.
- **Read-only, local.** ZePhone does not modify, add or delete **any** contact. Nothing goes over the network, no
  password is involved. Only these are read: name, nickname, company, department, job title, e-mail, numbers and SIP addresses. **Not**
  photos, notes, birthdays or postal addresses.
- **One card per person**: if the same person is in several accounts (iCloud, Google…), macOS already presents them
  unified. Fax and pager numbers are dropped; labels (`mobile`, `iPhone`, `work`, `home`,
  "Cell", "Office", "Extension"…) give the type of the number, and a free label is kept as you wrote it.
- **Priority**: your contacts (ZePhone's, then the Mac's) come before the enterprise directory to name a card or a
  call. Two cards are only merged if they have the same e-mail address.
- **Rereading**: the whole address book is reread every 15 minutes (it is local, so quick), or on demand ("Sync"). ZePhone's
  cache is erased when the source is disconnected, as for the others.
- **Technical**: Apple's Contacts framework (`CNContactStore`); the application declares the usage in `Info.plist`
  (`NSContactsUsageDescription`) and the right to access the address book in its entitlements. The same Rust code will serve
  other platforms: only the native reading is specific to each (iOS, Android: to be written).

## Synchronization, local cache, outages

- **First synchronization** on connection; **manual refresh** ("Sync"); **automatic frequency**
  adjustable per source (15 min, 1 h, 6 h, 24 h, or manual). Reads happen in the background: the interface never blocks.
- Each contact keeps its **stable identifier** (`<source>/<source's identifier>`) and its **provenance**. Two people are
  **never** matched on their name alone; two cards from different sources are only merged if they have the **same
  e-mail address**, and the card then shows both provenances.
- **An outage never empties the directory.** Contacts are only replaced after a **complete, successful** read, in a single
  transaction. An error (network, server, authentication, rate limiting) is noted on the source, which shows its error and
  the date of its last success. A source that suddenly answers "nobody" when it had contacts is refused.
- A contact deleted from the source disappears **after a successful synchronization**, along with the favorites and group memberships that
  no longer designated anyone.
- **Retries**: spaced out (1, 2, 4… minutes, never more than an hour), never in a loop; an error that needs an action from
  the user (credentials, permission, configuration) is **not** retried by itself.
- **Local cache** (SQLite, in the application's data folder): erased on **disconnection**, on request
  ("Clear the cache"), and **after 30 days without a successful synchronization**. Favorites and groups are kept, and
  find their contacts again if the source is reconnected.
- The logs contain no name, number or identifier: only counters and error types.

## Verification

| Journey                                                          | How it is verified                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "elodie" finds "Élodie"; numbers with spaces/dashes              | Rust tests (`directory::index`), interface tests, **real OpenLDAP server**                                                                                                                                    |
| Several numbers, calling the right one                           | interface tests (`DirectoryPage`, `ContactSheet`); dialing goes through `dial`                                                                                                                                |
| Internal extensions and SIP addresses are usable                 | Rust test against `sip::uri::normalize_target`                                                                                                                                                                |
| An update keeps favorites and groups                             | Rust tests (`store`, `service`) and **real OpenLDAP**                                                                                                                                                         |
| Same name ≠ same person                                          | Rust tests (`index`) and **real OpenLDAP** (two "Jean Martin")                                                                                                                                                |
| An outage does not empty the directory                           | Rust tests, **real OpenLDAP stopped then restarted**, fake Microsoft service                                                                                                                                  |
| Deleting a group keeps the contacts                              | Rust tests (`store`, `service`)                                                                                                                                                                               |
| Authentication error → clear action                              | Rust + interface tests ("Reconnect")                                                                                                                                                                          |
| Call and transfer through the real SIP functions                 | interface tests (`dial`, `transfer_call`) + real SIP normalization                                                                                                                                            |
| Mac contacts: permission, refusal, withdrawal, labels, read-only | Rust tests (`system_contacts`, `service`) with a fake address book; **authorization state and the "no question outside the application" guard** tested on macOS without reading any contact; interface tested |
| Calls named by the directory, only when it is certain            | Rust tests (`index`, `service`, manager) and **real calls between two Baresip engines** (`manager_e2e`): directory name, two possible people = no name, local contact first, history without the name         |

Running the tests: `cd src-tauri && cargo test --lib directory`, `cargo test --test directory_ldap -- --test-threads=1`
(starts a real `slapd` — `brew install openldap openssl@3` — on loopback, over TLS with a throwaway certificate),
`cargo test --test directory_microsoft`, and `npm test`.

**What is not verified without a real connection**: reading **real** Mac contacts (it needs your permission in the installed application; a test to run by hand, `cargo test --lib reads_the_real_address_book -- --ignored --nocapture`, only prints numbers); the Microsoft connector is tested against a **stand-in service**
(real HTTP code, real PKCE verified on the server side, paging, delta, 429, token expiry…), not against a real Microsoft 365
tenant; the connection to a real Active Directory has not been tried either (OpenLDAP has).
