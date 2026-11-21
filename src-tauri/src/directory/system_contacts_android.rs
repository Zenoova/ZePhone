//! The contacts of an Android phone.
//!
//! The reading is done in Kotlin (`ContactsAccess.kt`, through the `ContentResolver`): the shell hands the Rust side a JSON
//! list, here parsed into [`RawContact`]s that go through the same rules as everywhere else. The permission is
//! `READ_CONTACTS`; the system asks the user the first time ([`ContactsProvider::request_access`]) and the user can take
//! it back in the system settings. The calls reach the activity (`MainActivity`) through JNI, the way the audio route does
//! (`app/call_audio.rs`).

use serde::Deserialize;

use super::system_contacts::{ProviderError, RawContact};

/// What `ContactsAccess.readJson` writes for one person.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct JsonContact {
    id: String,
    given: String,
    family: String,
    nickname: String,
    organization: String,
    department: String,
    title: String,
    phones: Vec<JsonPhone>,
    emails: Vec<String>,
    sip: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct JsonPhone {
    label: String,
    number: String,
}

/// The contacts of the JSON list, in ZePhone's own form. A SIP address the phone stores as `user@host` becomes a `sip:` URI.
fn parse(json: &str) -> Result<Vec<RawContact>, ProviderError> {
    let people: Vec<JsonContact> =
        serde_json::from_str(json).map_err(|_| ProviderError("unreadable contact list".into()))?;
    Ok(people
        .into_iter()
        .map(|p| RawContact {
            identifier: p.id,
            given_name: p.given,
            family_name: p.family,
            nickname: p.nickname,
            organization: p.organization,
            department: p.department,
            job_title: p.title,
            phones: p
                .phones
                .into_iter()
                .map(|n| ((!n.label.is_empty()).then_some(n.label), n.number))
                .collect(),
            emails: p.emails,
            sip_addresses: p
                .sip
                .into_iter()
                .map(|a| {
                    let lower = a.to_ascii_lowercase();
                    if lower.starts_with("sip:") || lower.starts_with("sips:") {
                        a
                    } else {
                        format!("sip:{a}")
                    }
                })
                .collect(),
        })
        .collect())
}

#[cfg(target_os = "android")]
pub use imp::{AndroidContacts, open_settings};

#[cfg(target_os = "android")]
mod imp {
    use std::time::{Duration, Instant};

    use async_trait::async_trait;
    use jni::{JNIEnv, JavaVM, objects::JObject};

    use super::{
        super::system_contacts::{Access, ContactsProvider, ProviderError, RawContact},
        parse,
    };

    pub struct AndroidContacts;

    /// Calls a static method of `ContactsBridge` (Kotlin). A native thread has no class loader of its own: the
    /// application's is asked through the context, which is how the classes of the application are found.
    fn call_bridge<R>(
        method: &str,
        signature: &str,
        read: impl FnOnce(&mut JNIEnv, jni::objects::JValueOwned) -> jni::errors::Result<R>,
    ) -> Result<R, ProviderError> {
        let ctx = ndk_context::android_context();
        // SAFETY: both pointers come from the Android runtime (through `ndk-context`) and live as long as the process; the
        // context is a global reference we only borrow (a `JObject` never frees it).
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| ProviderError(e.to_string()))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| ProviderError(e.to_string()))?;
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        let run = |env: &mut JNIEnv| -> jni::errors::Result<R> {
            let loader = env
                .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
                .l()?;
            let name = env.new_string("com.zenoova.zephone.ContactsBridge")?;
            let class = env
                .call_method(
                    &loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[(&name).into()],
                )?
                .l()?;
            let class = jni::objects::JClass::from(class);
            let value = env.call_static_method(&class, method, signature, &[])?;
            read(env, value)
        };
        let result = run(&mut env);
        if result.is_err() && env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        result.map_err(|e| ProviderError(e.to_string()))
    }

    fn access_now() -> Access {
        match call_bridge("access", "()I", |_, v| v.i()) {
            Ok(2) => Access::Authorized,
            Ok(1) => Access::Denied,
            Ok(_) => Access::NotDetermined,
            Err(e) => {
                log::warn!("cannot read the contacts permission: {}", e.0);
                Access::Unsupported
            }
        }
    }

    #[async_trait]
    impl ContactsProvider for AndroidContacts {
        fn access(&self) -> Access {
            access_now()
        }

        async fn request_access(&self) -> Access {
            let now = access_now();
            if now != Access::NotDetermined {
                return now;
            }
            if let Err(e) = call_bridge("request", "()V", |_, _| Ok(())) {
                log::warn!("cannot ask for the contacts permission: {}", e.0);
                return Access::Unsupported;
            }
            // The system shows its question; the answer is read back until the user has given one.
            let deadline = Instant::now() + Duration::from_secs(120);
            loop {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let now = access_now();
                if now != Access::NotDetermined || Instant::now() >= deadline {
                    return now;
                }
            }
        }

        fn read_all(&self) -> Result<Vec<RawContact>, ProviderError> {
            let json = call_bridge("readJson", "()Ljava/lang/String;", |env, v| {
                let text = v.l()?;
                env.get_string(&text.into()).map(String::from)
            })?;
            parse(&json)
        }
    }

    /// Opens the application's page in the system settings, where the contacts permission can be allowed or taken back.
    pub fn open_settings() -> Result<(), ProviderError> {
        call_bridge("openSettings", "()V", |_, _| Ok(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shells_list_becomes_contacts_with_their_labels_and_sip_addresses() {
        let json = r#"[
          {"id":"7","given":"Alice","family":"Martin","organization":"Acme","title":"CTO",
           "phones":[{"label":"mobile","number":"+33 6 12"},{"label":"","number":"1002"}],
           "emails":["alice@example.com"],"sip":["alice@pbx.example.com","sips:alice@tls.example.com"]},
          {"id":"8"}
        ]"#;
        let all = parse(json).unwrap();
        assert_eq!(all.len(), 2);
        let alice = &all[0];
        assert_eq!(alice.identifier, "7");
        assert_eq!(
            (alice.given_name.as_str(), alice.family_name.as_str()),
            ("Alice", "Martin")
        );
        assert_eq!(alice.job_title, "CTO");
        assert_eq!(
            alice.phones[0],
            (Some("mobile".to_string()), "+33 6 12".to_string())
        );
        assert_eq!(alice.phones[1], (None, "1002".to_string()));
        assert_eq!(
            alice.sip_addresses,
            vec!["sip:alice@pbx.example.com", "sips:alice@tls.example.com"]
        );
        // A person with nothing but an id is a card the directory will drop, not an error.
        assert_eq!(all[1].phones.len(), 0);
    }

    #[test]
    fn garbage_is_an_error_and_not_a_panic() {
        assert!(parse("not json").is_err());
    }
}
