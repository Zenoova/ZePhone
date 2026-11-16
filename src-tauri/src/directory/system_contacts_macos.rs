//! The Mac's Contacts, through Apple's Contacts framework.
//!
//! Permission: the system asks the user the first time (the text comes from `NSContactsUsageDescription` in
//! `Info.plist`), and the hardened-runtime bundle carries the `com.apple.security.personal-information.addressbook`
//! entitlement. Nothing here is ever called without the user having asked to connect the source.
//!
//! Only the properties the directory uses are requested (`keysToFetch`): asking a contact for a property that was
//! not fetched raises an Objective-C exception, so the list below and the getters in [`raw_of`] must stay in step.

use std::{cell::RefCell, ptr::NonNull, time::Duration};

use async_trait::async_trait;
use block2::{RcBlock, StackBlock};
use objc2::{
    AnyThread,
    rc::Retained,
    runtime::{Bool, ProtocolObject},
};
use objc2_contacts::{
    CNAuthorizationStatus, CNContact, CNContactDepartmentNameKey, CNContactEmailAddressesKey,
    CNContactFamilyNameKey, CNContactFetchRequest, CNContactGivenNameKey,
    CNContactInstantMessageAddressesKey, CNContactJobTitleKey, CNContactNicknameKey,
    CNContactOrganizationNameKey, CNContactPhoneNumbersKey, CNContactStore, CNEntityType,
};
use objc2_foundation::{NSArray, NSBundle, NSError, NSString};

use super::system_contacts::{Access, ContactsProvider, ProviderError, RawContact};

pub struct MacContacts;

fn status() -> Access {
    // SAFETY: a class method with no preconditions; Apple documents it as thread safe.
    let st = unsafe { CNContactStore::authorizationStatusForEntityType(CNEntityType::Contacts) };
    match st {
        CNAuthorizationStatus::Authorized | CNAuthorizationStatus::Limited => Access::Authorized,
        CNAuthorizationStatus::Denied => Access::Denied,
        CNAuthorizationStatus::Restricted => Access::Restricted,
        _ => Access::NotDetermined,
    }
}

/// Without the usage text in the bundle's `Info.plist`, asking for permission terminates the process. A binary run
/// outside its bundle (a test, `cargo run`) has none: it must not ask.
fn can_ask() -> bool {
    has_usage_description(&NSBundle::mainBundle())
}

fn has_usage_description(bundle: &NSBundle) -> bool {
    let key = NSString::from_str("NSContactsUsageDescription");
    bundle.objectForInfoDictionaryKey(&key).is_some()
}

/// What a contact is, read from the properties that were fetched.
///
/// # Safety
/// `c` must have been fetched with every key of [`read_all`]'s `keysToFetch`.
unsafe fn raw_of(c: &CNContact) -> RawContact {
    // SAFETY (all calls below): the properties were fetched, so the getters cannot raise.
    unsafe {
        let text = |v: Retained<NSString>| v.to_string();
        let phones = c
            .phoneNumbers()
            .iter()
            .map(|lv| {
                (
                    lv.label().map(|l| l.to_string()),
                    lv.value().stringValue().to_string(),
                )
            })
            .collect();
        let emails = c
            .emailAddresses()
            .iter()
            .map(|lv| lv.value().to_string())
            .collect();
        let sip_addresses = c
            .instantMessageAddresses()
            .iter()
            .filter_map(|lv| {
                let im = lv.value();
                let (user, service) = (im.username().to_string(), im.service().to_string());
                let lower = user.to_ascii_lowercase();
                if lower.starts_with("sip:") || lower.starts_with("sips:") {
                    Some(user)
                } else if service.eq_ignore_ascii_case("sip") && user.contains('@') {
                    Some(format!("sip:{user}"))
                } else {
                    None
                }
            })
            .collect();
        RawContact {
            identifier: text(c.identifier()),
            given_name: text(c.givenName()),
            family_name: text(c.familyName()),
            nickname: text(c.nickname()),
            organization: text(c.organizationName()),
            department: text(c.departmentName()),
            job_title: text(c.jobTitle()),
            phones,
            emails,
            sip_addresses,
        }
    }
}

#[async_trait]
impl ContactsProvider for MacContacts {
    fn access(&self) -> Access {
        status()
    }

    async fn request_access(&self) -> Access {
        let now = status();
        if now != Access::NotDetermined {
            return now;
        }
        if !can_ask() {
            log::warn!(
                "contacts permission not requested: this build has no NSContactsUsageDescription"
            );
            return Access::Unsupported;
        }
        // The Objective-C objects live and die on one blocking thread: they are not `Send`.
        let _ = tokio::task::spawn_blocking(|| {
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            // SAFETY: plain Objective-C object creation and a call whose completion block we own for its duration.
            let store = unsafe { CNContactStore::new() };
            let block = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
                let _ = tx.send(());
            });
            unsafe {
                store.requestAccessForEntityType_completionHandler(CNEntityType::Contacts, &block)
            };
            // The system shows its question and calls the block when the user answers (on any thread).
            let _ = rx.recv_timeout(Duration::from_secs(120));
        })
        .await;
        status()
    }

    fn read_all(&self) -> Result<Vec<RawContact>, ProviderError> {
        // SAFETY: the keys are the NSString constants of the framework; the request, the store and the block live
        // for this call only; `raw_of` is given contacts fetched with exactly these keys.
        unsafe {
            let keys = NSArray::from_slice(&[
                ProtocolObject::from_ref(CNContactGivenNameKey),
                ProtocolObject::from_ref(CNContactFamilyNameKey),
                ProtocolObject::from_ref(CNContactNicknameKey),
                ProtocolObject::from_ref(CNContactOrganizationNameKey),
                ProtocolObject::from_ref(CNContactDepartmentNameKey),
                ProtocolObject::from_ref(CNContactJobTitleKey),
                ProtocolObject::from_ref(CNContactPhoneNumbersKey),
                ProtocolObject::from_ref(CNContactEmailAddressesKey),
                ProtocolObject::from_ref(CNContactInstantMessageAddressesKey),
            ]);
            let request =
                CNContactFetchRequest::initWithKeysToFetch(CNContactFetchRequest::alloc(), &keys);
            // One card per person, even when the same person is in several accounts (iCloud, Google...).
            request.setUnifyResults(true);
            let store = CNContactStore::new();
            let found = RefCell::new(Vec::new());
            let block = StackBlock::new(|contact: NonNull<CNContact>, _stop: NonNull<Bool>| {
                found.borrow_mut().push(raw_of(contact.as_ref()));
            });
            let mut error: Option<Retained<NSError>> = None;
            let ok = store.enumerateContactsWithFetchRequest_error_usingBlock(
                &request,
                Some(&mut error),
                &block,
            );
            if !ok {
                // The reason is the system's; it can name a person, so it goes nowhere.
                return Err(ProviderError("enumeration failed".into()));
            }
            Ok(found.into_inner())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests never read a contact: they only ask the system about permission, which shows nothing and
    // needs no permission. Reading the real address book is `reads_the_real_address_book` below, run by hand.

    #[test]
    fn the_permission_state_can_be_read_without_asking_anything() {
        let a = MacContacts.access();
        assert!(matches!(
            a,
            Access::NotDetermined | Access::Denied | Access::Restricted | Access::Authorized
        ));
    }

    /// A bundle on disk: `Contents/Info.plist` with an identifier, and the usage text when asked.
    fn bundle(dir: &std::path::Path, with_usage_text: bool) -> Retained<NSBundle> {
        let contents = dir.join("T.bundle/Contents");
        std::fs::create_dir_all(&contents).unwrap();
        let usage = if with_usage_text {
            "<key>NSContactsUsageDescription</key><string>test</string>"
        } else {
            ""
        };
        std::fs::write(
            contents.join("Info.plist"),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>\
                 <key>CFBundleIdentifier</key><string>app.zephone.test</string>{usage}</dict></plist>"
            ),
        )
        .unwrap();
        let path = NSString::from_str(dir.join("T.bundle").to_str().unwrap());
        NSBundle::bundleWithPath(&path).expect("a valid bundle")
    }

    #[test]
    fn without_the_usage_text_the_system_would_end_the_process_so_it_is_never_asked() {
        // Asking for permission from a bundle without `NSContactsUsageDescription` terminates the process.
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_usage_description(&bundle(dir.path(), false)));
    }

    #[test]
    fn with_the_usage_text_it_may_ask() {
        let dir = tempfile::tempdir().unwrap();
        assert!(has_usage_description(&bundle(dir.path(), true)));
    }

    /// Reads the real address book of the person running the test, and prints how many cards there are — never
    /// what is in them. Needs the permission to have been given to the program running the tests.
    /// `cargo test --lib reads_the_real_address_book -- --ignored --nocapture`
    #[test]
    #[ignore = "reads the real address book of whoever runs it"]
    fn reads_the_real_address_book() {
        if MacContacts.access() != Access::Authorized {
            eprintln!(
                "SKIPPED: this program is not allowed to read the contacts ({:?})",
                MacContacts.access()
            );
            return;
        }
        let all = MacContacts.read_all().expect("reads the contacts");
        let useful = all
            .iter()
            .filter_map(crate::directory::system_contacts::map_contact)
            .count();
        eprintln!(
            "{} cards read, {} usable in the directory",
            all.len(),
            useful
        );
    }
}
