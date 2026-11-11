//! Log scrubbing. Anything that comes back from the engine (stdout, command
//! echoes such as `Creating UA for <sip:...>;auth_pass="..."`) goes through
//! [`redact`] before being logged or stored.

const KEYS: &[&str] = &["auth_pass", "password", "passwd", "pwd"];

/// Replaces the value of any `auth_pass=...`-style parameter with `***`.
/// Handles quoted values (which may contain `;`, spaces and `>`), and bare values
/// (terminated by `;`, `>`, whitespace or end of input).
pub fn redact(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    'outer: while i < input.len() {
        for key in KEYS {
            if lower[i..].starts_with(key) {
                let after_key = i + key.len();
                let rest = &input[after_key..];
                let trimmed = rest.trim_start();
                if let Some(value_part) = trimmed.strip_prefix('=') {
                    let value_part_trim = value_part.trim_start();
                    let value_start = input.len() - value_part_trim.len();
                    let value_len = if let Some(quoted) = value_part_trim.strip_prefix('"') {
                        quoted.find('"').map(|p| p + 2).unwrap_or(value_part_trim.len())
                    } else {
                        value_part_trim
                            .find(|c: char| c == ';' || c == '>' || c == ',' || c.is_whitespace())
                            .unwrap_or(value_part_trim.len())
                    };
                    out.push_str(&input[i..value_start]);
                    out.push_str("***");
                    i = value_start + value_len;
                    continue 'outer;
                }
            }
        }
        let ch = input[i..].chars().next().expect("index is on a char boundary");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_quoted_password_with_separators() {
        let s = r#"Creating UA for <sip:1001@pbx>;auth_user="1001";auth_pass="p;ss >word";regint=300"#;
        let r = redact(s);
        assert!(!r.contains("p;ss"), "{r}");
        assert!(!r.contains("word"), "{r}");
        assert!(r.contains("auth_user=\"1001\""));
        assert!(r.contains("regint=300"));
        assert!(r.contains("auth_pass=***"));
    }

    #[test]
    fn redacts_bare_password() {
        assert_eq!(redact("x auth_pass=secret;y=1"), "x auth_pass=***;y=1");
        assert_eq!(redact("AUTH_PASS = hunter2 rest"), "AUTH_PASS = *** rest");
    }

    #[test]
    fn leaves_other_text_alone_and_handles_unicode() {
        assert_eq!(redact("héllo wörld 🚀"), "héllo wörld 🚀");
        assert_eq!(redact("auth_pass=é🚀;ok"), "auth_pass=***;ok");
    }

    #[test]
    fn unterminated_quote_is_fully_redacted() {
        assert_eq!(redact("auth_pass=\"never closed"), "auth_pass=***");
    }
}
