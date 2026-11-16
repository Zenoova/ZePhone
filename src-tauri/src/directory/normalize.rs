//! Text and number normalisation for the directory.
//!
//! Two rules drive everything here:
//!  * what the user sees and dials is the ORIGINAL value of the source — it is never rewritten;
//!  * searching and comparing use derived keys (folded text, digits only), computed on the side.

use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

/// Folds text for searching: lower case, no accents, ligatures expanded, and every run of non-alphanumeric
/// characters turned into a single space. `"Élodie  Dupont-Martin"` becomes `"elodie dupont martin"`.
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut gap = false;
    for c in s.nfd().filter(|c| !is_combining_mark(*c)) {
        for lc in c.to_lowercase() {
            let expanded: &str = match lc {
                'æ' => "ae",
                'œ' => "oe",
                'ß' => "ss",
                'ø' => "o",
                'ł' => "l",
                'đ' | 'ð' => "d",
                'þ' => "th",
                'ı' => "i",
                _ => "",
            };
            if !expanded.is_empty() {
                if gap && !out.is_empty() {
                    out.push(' ');
                }
                gap = false;
                out.push_str(expanded);
            } else if lc.is_alphanumeric() {
                if gap && !out.is_empty() {
                    out.push(' ');
                }
                gap = false;
                out.push(lc);
            } else {
                gap = true;
            }
        }
    }
    out
}

/// Is this a SIP address rather than a telephone number (`sip:bob@host`, `bob@host`)?
pub fn is_sip_address(number: &str) -> bool {
    let t = number.trim();
    let lower = t.to_ascii_lowercase();
    lower.starts_with("sip:") || lower.starts_with("sips:") || t.contains('@')
}

/// Splits a trailing extension off a number: `"+33 1 23 45 67 89 poste 4567"` gives the main number and `"4567"`.
/// Markers: `poste`, `ext`, `ext.`, `x`. SIP addresses and numbers without a marker are returned whole.
pub fn split_extension(number: &str) -> (&str, Option<&str>) {
    if is_sip_address(number) {
        return (number.trim(), None);
    }
    let lower = number.to_ascii_lowercase();
    for marker in ["poste", "ext.", "ext", "x"] {
        let Some(pos) = lower.rfind(marker) else {
            continue;
        };
        let main = number[..pos].trim_end();
        let ext = number[pos + marker.len()..]
            .trim_start_matches(|c: char| c == '.' || c == ':' || c.is_whitespace());
        if !ext.is_empty()
            && ext.chars().all(|c| c.is_ascii_digit())
            && main.chars().any(|c| c.is_ascii_digit())
        {
            return (main, Some(ext));
        }
    }
    (number.trim(), None)
}

/// `"+33 (0)1 23 45 67 89"` → `"+33 1 23 45 67 89"`: the optional trunk zero written in brackets is not part of the
/// international number.
fn drop_bracketed_trunk_zero(s: &str) -> String {
    s.replace("(0)", "")
}

/// Digits of the main number, for searching and comparing: `"+33 (0)1 23-45.67.89"` → `"33123456789"`.
/// The extension is not included (see [`extension_digits`]).
pub fn phone_digits(number: &str) -> String {
    if is_sip_address(number) {
        return String::new();
    }
    let (main, _) = split_extension(number);
    drop_bracketed_trunk_zero(main)
        .chars()
        .filter(char::is_ascii_digit)
        .collect()
}

/// The extension written after a main number (`"... poste 4567"`), digits only.
pub fn extension_digits(number: &str) -> Option<String> {
    split_extension(number).1.map(str::to_owned)
}

/// The string to hand to the dialling code. SIP addresses are kept as they are, a number is cleaned of its
/// spaces, dashes, dots, brackets and extension marker; `+`, `*` and `#` are kept, and so is a bare internal
/// extension (`"4567"`). `None` when there is nothing to dial.
pub fn dialable(number: &str) -> Option<String> {
    let t = number.trim();
    if t.is_empty() {
        return None;
    }
    if is_sip_address(t) {
        return Some(t.to_owned());
    }
    let (main, _) = split_extension(t);
    let cleaned: String = drop_bracketed_trunk_zero(main)
        .chars()
        .enumerate()
        .filter(|(i, c)| c.is_ascii_digit() || matches!(c, '*' | '#') || (*c == '+' && *i == 0))
        .map(|(_, c)| c)
        .collect();
    cleaned
        .chars()
        .any(|c| c.is_ascii_digit())
        .then_some(cleaned)
}

/// A query that is made of digits and the usual separators (`"01 23-45.67"`, `"+33 1 23"`) searches telephone
/// numbers. Returns its digits, or `None` for a text query (or one with too few digits to mean a number).
pub fn phone_query(q: &str) -> Option<String> {
    let t = q.trim();
    if t.is_empty()
        || !t
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, ' ' | '+' | '-' | '.' | '(' | ')' | '/'))
    {
        return None;
    }
    let digits: String = drop_bracketed_trunk_zero(t)
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    (digits.len() >= 3).then_some(digits)
}

/// Does a stored number (its digits) answer a number the user typed (its digits)?
/// A plain "contains" first; then the national form against the international one (`0123456789` against
/// `+33123456789`), through their common last digits — at least 8 of them, like the call matching does.
pub fn digits_match(query: &str, stored: &str) -> bool {
    if query.is_empty() || stored.is_empty() {
        return false;
    }
    if stored.contains(query) {
        return true;
    }
    // "0123456789" typed, "+33123456789" stored: drop the national trunk zero of the query.
    let nz = query.trim_start_matches('0');
    if query.starts_with('0') && nz.len() >= 8 && stored.contains(nz) {
        return true;
    }
    // "+33123456789" typed (digits 33123456789), "0123456789" stored.
    let stored_nz = stored.trim_start_matches('0');
    stored.starts_with('0') && stored_nz.len() >= 8 && query.ends_with(stored_nz)
}

/// Are these two numbers (as digits) the same line? Equal, or the national and the international form of one
/// number (`0123456789` and `33123456789`: at least 8 shared last digits after the trunk zero).
pub fn same_number(a: &str, b: &str) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a == b {
        return true;
    }
    let nat = |x: &str, other: &str| {
        let nz = x.trim_start_matches('0');
        x.starts_with('0') && nz.len() >= 8 && other.ends_with(nz) && other.len() > x.len() - 1
    };
    nat(a, b) || nat(b, a)
}

/// A query that is only an extension marker and digits (`"poste 4567"`, `"ext. 12"`): returns the digits.
pub fn extension_query(q: &str) -> Option<String> {
    let f = fold(q);
    let rest = ["poste", "extension", "ext"]
        .iter()
        .find_map(|m| f.strip_prefix(m))?
        .trim();
    (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())).then(|| rest.to_owned())
}

/// `user@host` of a SIP address, lower-cased, without scheme, port, parameters or display name:
/// `"Alice" <sip:Alice@PBX.example.com:5060;transport=tls>` gives `alice@pbx.example.com`. `None` for anything
/// that is not an address with a host.
pub fn sip_identity(address: &str) -> Option<String> {
    let t = address.trim();
    let inner = match (t.find('<'), t.rfind('>')) {
        (Some(a), Some(b)) if a < b => &t[a + 1..b],
        _ => t,
    };
    let lower = inner.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("sips:")
        .or_else(|| lower.strip_prefix("sip:"))
        .unwrap_or(&lower);
    let rest = rest.split([';', '?']).next()?;
    let (user, host) = rest.split_once('@')?;
    let host = host.split(':').next()?;
    (!user.is_empty() && !host.is_empty()).then(|| format!("{user}@{host}"))
}

/// What links two records of different sources as the same person: their e-mail address, nothing else.
/// Never the name — two people can share one.
pub fn link_key(email: Option<&str>) -> Option<String> {
    let e = email?.trim().to_lowercase();
    (e.contains('@') && e.len() > 3).then_some(e)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folding_ignores_case_accents_and_separators() {
        assert_eq!(fold("Élodie  Dupont-Martin"), "elodie dupont martin");
        assert_eq!(fold("ÉLODIE"), fold("elodie"));
        assert_eq!(fold("François Lœuillet"), "francois loeuillet");
        assert_eq!(fold("Straße"), "strasse");
        assert_eq!(fold("  O'Brien, Sean  "), "o brien sean");
        assert_eq!(fold("Zoë"), "zoe");
        assert_eq!(fold(""), "");
        assert_eq!(fold("--"), "");
    }

    #[test]
    fn digits_ignore_every_separator_and_the_bracketed_trunk_zero() {
        for n in [
            "+33 1 23 45 67 89",
            "+33-1-23-45-67-89",
            "+33 (0)1 23.45.67.89",
            "+33123456789",
        ] {
            assert_eq!(phone_digits(n), "33123456789", "{n}");
        }
        assert_eq!(phone_digits("01 23 45 67 89"), "0123456789");
        assert_eq!(phone_digits("sip:alice@example.com"), "");
    }

    #[test]
    fn an_extension_marker_is_split_off() {
        assert_eq!(
            split_extension("+33 1 23 45 67 89 poste 4567"),
            ("+33 1 23 45 67 89", Some("4567"))
        );
        assert_eq!(
            split_extension("0123456789 ext. 12"),
            ("0123456789", Some("12"))
        );
        assert_eq!(
            split_extension("0123456789 x12"),
            ("0123456789", Some("12"))
        );
        assert_eq!(split_extension("4567"), ("4567", None));
        // not a marker: the "x" of a user name in an address
        assert_eq!(
            split_extension("sip:max123@example.com"),
            ("sip:max123@example.com", None)
        );
        assert_eq!(phone_digits("0123456789 poste 4567"), "0123456789");
        assert_eq!(
            extension_digits("0123456789 poste 4567").as_deref(),
            Some("4567")
        );
    }

    #[test]
    fn what_is_dialled_keeps_internal_extensions_and_sip_addresses_intact() {
        assert_eq!(
            dialable("+33 (0)1 23-45.67.89").as_deref(),
            Some("+33123456789")
        );
        assert_eq!(dialable("01 23 45 67 89").as_deref(), Some("0123456789"));
        assert_eq!(dialable("4567").as_deref(), Some("4567")); // an internal extension
        assert_eq!(dialable("*72").as_deref(), Some("*72"));
        assert_eq!(
            dialable("0123456789 poste 4567").as_deref(),
            Some("0123456789")
        );
        assert_eq!(
            dialable("sip:alice@example.com").as_deref(),
            Some("sip:alice@example.com")
        );
        assert_eq!(
            dialable(" alice@example.com ").as_deref(),
            Some("alice@example.com")
        );
        assert_eq!(dialable("   "), None);
        assert_eq!(dialable("n/a"), None);
    }

    /// What the directory hands to the dialling code must be something that code accepts, for every way a source
    /// writes a number: it is the real `normalize_target` of the SIP engine that decides.
    #[test]
    fn everything_the_directory_dials_is_accepted_by_the_applications_own_dialling() {
        for (written, expected_user) in [
            ("+33 1 23 45 67 89", "+33123456789"),
            ("+33 (0)1 23-45.67.89", "+33123456789"),
            ("01 23 45 67 89", "0123456789"),
            ("01.23.45.67.89 poste 4567", "0123456789"),
            ("06 12-34-56-78", "0612345678"),
            ("4567", "4567"),
            ("*72", "*72"),
        ] {
            let dial = dialable(written).unwrap_or_else(|| panic!("{written} is dialable"));
            let uri = crate::sip::uri::normalize_target(&dial, "pbx.example.com")
                .unwrap_or_else(|e| panic!("{written} -> {dial}: {e}"));
            assert!(
                uri.starts_with(&format!("sip:{}@", expected_user.replace('*', "%2A")))
                    || uri.starts_with(&format!("sip:{expected_user}@")),
                "{written} -> {uri}"
            );
        }
        // a SIP address and a user@host address go through untouched
        for address in ["sip:alice@example.com", "alice@example.com"] {
            let dial = dialable(address).unwrap();
            assert_eq!(dial, address);
            assert!(crate::sip::uri::normalize_target(&dial, "pbx.example.com").is_ok());
        }
    }

    #[test]
    fn a_sip_address_is_reduced_to_its_user_and_host() {
        for a in [
            "sip:alice@pbx.example.com",
            "SIP:Alice@PBX.example.com:5060",
            "\"Alice\" <sip:alice@pbx.example.com;transport=tls>",
            "sips:alice@pbx.example.com;x=y",
            "alice@pbx.example.com",
        ] {
            assert_eq!(
                sip_identity(a).as_deref(),
                Some("alice@pbx.example.com"),
                "{a}"
            );
        }
        assert_eq!(sip_identity("0123456789"), None);
        assert_eq!(sip_identity("sip:pbx.example.com"), None);
        assert_eq!(sip_identity("sip:@pbx.example.com"), None);
        assert_eq!(sip_identity(""), None);
    }

    #[test]
    fn a_plus_only_counts_at_the_start() {
        assert_eq!(dialable("01+23").as_deref(), Some("0123"));
    }

    #[test]
    fn a_query_of_digits_and_separators_is_a_telephone_search() {
        assert_eq!(phone_query("01 23-45.67").as_deref(), Some("01234567"));
        assert_eq!(phone_query("+33 (0)1 23").as_deref(), Some("33123"));
        assert_eq!(phone_query("elodie"), None);
        assert_eq!(phone_query("12"), None); // too short to be a number: a text search
        assert_eq!(phone_query("  "), None);
        assert_eq!(phone_query("poste 4567"), None);
    }

    #[test]
    fn numbers_are_found_whatever_their_separators() {
        let stored = phone_digits("01.23.45.67.89");
        for typed in ["0123456789", "01 23 45 67 89", "01-23-45-67-89", "23 45 67"] {
            assert!(
                digits_match(&phone_query(typed).unwrap(), &stored),
                "{typed}"
            );
        }
        assert!(!digits_match("0123456780", &stored));
    }

    #[test]
    fn the_national_and_the_international_form_are_the_same_number() {
        let intl = phone_digits("+33 1 23 45 67 89");
        let national = phone_digits("01 23 45 67 89");
        assert!(digits_match("0123456789", &intl));
        assert!(digits_match(&intl, &national));
        // too short to be sure: no equivalence
        assert!(!digits_match("01234", &phone_digits("+33 1 23")));
        assert!(!digits_match("", &intl));
    }

    #[test]
    fn the_same_line_written_nationally_and_internationally_is_recognised() {
        assert!(same_number("0123456789", "33123456789"));
        assert!(same_number("33123456789", "0123456789"));
        assert!(same_number("0123456789", "0123456789"));
        assert!(!same_number("0123456789", "33123456780"));
        assert!(!same_number("0612", "33612"), "too short to be sure");
        assert!(!same_number("", ""));
    }

    #[test]
    fn a_query_naming_an_extension_is_recognised() {
        assert_eq!(extension_query("poste 4567").as_deref(), Some("4567"));
        assert_eq!(extension_query("Ext. 12").as_deref(), Some("12"));
        assert_eq!(extension_query("extension 12"), Some("12".into()));
        assert_eq!(extension_query("poste"), None);
        assert_eq!(extension_query("poste dupont"), None);
        assert_eq!(extension_query("4567"), None);
    }

    #[test]
    fn records_are_only_linked_by_a_proper_email_address() {
        assert_eq!(
            link_key(Some(" Elodie.Dupont@Example.com ")).as_deref(),
            Some("elodie.dupont@example.com")
        );
        assert_eq!(link_key(Some("not an address")), None);
        assert_eq!(link_key(Some("")), None);
        assert_eq!(link_key(None), None);
    }
}
