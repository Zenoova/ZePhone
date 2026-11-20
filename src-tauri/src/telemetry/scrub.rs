//! Everything that leaves the machine goes through [`scrub`] first. A softphone's text is full of things that must
//! never be sent: SIP addresses, phone numbers, names, passwords, IP addresses, the user's home folder. The
//! rules remove them from any free text (an error message, a panic message, a JavaScript stack).

use regex::{Captures, Regex};
use std::sync::LazyLock;

/// Longest text kept after scrubbing: a report is a hint, not a log.
const MAX_LEN: usize = 1500;

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("a valid scrubbing pattern")
}

static URI: LazyLock<Regex> = LazyLock::new(|| re(r#"(?i)\b(sips?|tel):[^\s;>"'<,)\]]+"#));
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| re(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+"));
/// A display name: `"Alice Martin" <sip:...>` (the address itself is removed first, so look for the bracket).
static DISPLAY_NAME: LazyLock<Regex> = LazyLock::new(|| re(r#""[^"\n]{1,80}"(\s*<)"#));
static BEARER: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\bbearer\s+\S+"));
static TOKEN: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(token|authorization|secret|api[_-]?key)\b(\s*[:=]?\s*)\S+"));
static IPV4: LazyLock<Regex> = LazyLock::new(|| re(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"));
static IPV6: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}"));
static NUMBER: LazyLock<Regex> = LazyLock::new(|| re(r"\+?\d[\d ().\-]{4,}\d"));
static HOME: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)(?:/Users/|/home/|[A-Za-z]:\\Users\\)[^/\\\s:]+"));

/// Removes personal and secret data from `input` and bounds its length.
pub fn scrub(input: &str) -> String {
    let mut s = crate::security::redact::redact(input);
    s = URI.replace_all(&s, "$1:***").into_owned();
    s = EMAIL.replace_all(&s, "***@***").into_owned();
    s = DISPLAY_NAME.replace_all(&s, "\"***\"$1").into_owned();
    s = BEARER.replace_all(&s, "Bearer ***").into_owned();
    s = TOKEN.replace_all(&s, "$1$2***").into_owned();
    s = IPV4.replace_all(&s, "0.0.0.0").into_owned();
    // `12:30:45` is a time, not an address: an IPv6 address has a letter or a `::`.
    s = IPV6
        .replace_all(&s, |c: &Captures| {
            let m = &c[0];
            if m.contains("::") || m.chars().any(|ch| ch.is_ascii_alphabetic()) {
                "::".to_owned()
            } else {
                m.to_owned()
            }
        })
        .into_owned();
    s = NUMBER
        .replace_all(&s, |c: &Captures| {
            let m = &c[0];
            if m.chars().filter(char::is_ascii_digit).count() >= 6 {
                "<number>".to_owned()
            } else {
                m.to_owned()
            }
        })
        .into_owned();
    s = HOME.replace_all(&s, "~").into_owned();
    if s.chars().count() > MAX_LEN {
        s = s.chars().take(MAX_LEN).collect::<String>() + "…";
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sip_addresses_and_display_names_are_removed() {
        let s =
            scrub(r#"INVITE "Alice Martin" <sip:alice@pbx.example.com:5060;transport=tls> failed"#);
        assert!(
            !s.contains("alice") && !s.contains("Alice") && !s.contains("pbx"),
            "{s}"
        );
        assert!(s.contains("sip:***"), "{s}");
    }

    #[test]
    fn tel_uris_numbers_and_emails_are_removed() {
        let s = scrub("dial tel:+33123456789 or +33 1 23 45 67 89 or bob@example.org");
        assert!(
            !s.contains("33123456789") && !s.contains("23 45") && !s.contains("bob"),
            "{s}"
        );
    }

    #[test]
    fn passwords_and_tokens_are_removed() {
        let s = scrub(r#"auth_pass="hunter2 x" Authorization: Bearer abc.def password=zzz"#);
        for secret in ["hunter2", "abc.def", "zzz"] {
            assert!(!s.contains(secret), "{s}");
        }
    }

    #[test]
    fn addresses_are_removed_but_times_and_versions_stay() {
        let s = scrub("from 192.168.1.20 and fe80::1ff:fe23:4567:890a at 12:30:45 v0.1.0 line 512");
        assert!(
            !s.contains("192.168") && !s.contains("fe80") && !s.contains("890a"),
            "{s}"
        );
        assert!(
            s.contains("12:30:45") && s.contains("0.1.0") && s.contains("512"),
            "{s}"
        );
    }

    #[test]
    fn the_home_folder_is_removed_on_every_system() {
        for p in [
            "/Users/gumbraise/GitHub/ZePhone/src/lib.rs",
            "/home/gumbraise/.cargo/x.rs",
            r"C:\Users\Gumbraise\AppData\x.rs",
        ] {
            let s = scrub(p);
            assert!(!s.to_lowercase().contains("gumbraise"), "{s}");
            assert!(s.starts_with('~'), "{s}");
        }
    }

    #[test]
    fn long_text_is_cut() {
        assert!(scrub(&"a".repeat(10_000)).chars().count() <= MAX_LEN + 1);
    }

    #[test]
    fn plain_text_is_untouched() {
        let s = "index out of bounds: the len is 3 but the index is 7";
        assert_eq!(scrub(s), s);
    }
}
