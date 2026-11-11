//! Validation and normalisation of everything that ends up in a command sent
//! to the SIP engine. Baresip commands are whitespace-separated lines and its
//! account syntax uses `;` and `"` as delimiters, so we are strict here.

use std::net::IpAddr;

use crate::error::{AppError, AppResult};

fn has_control(s: &str) -> bool {
    s.chars().any(|c| c.is_control())
}

pub fn validate_host(host: &str) -> Result<(), String> {
    let h = host.trim();
    if h.is_empty() {
        return Err("valeur obligatoire".into());
    }
    if h.len() > 253 {
        return Err("trop long".into());
    }
    if h.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    if h.starts_with('[') || h.contains(':') {
        return Err("adresse IPv6 invalide (ou port non attendu ici)".into());
    }
    if h.starts_with(['.', '-']) || h.ends_with(['.', '-']) || h.contains("..") {
        return Err("nom d'hôte invalide".into());
    }
    if !h
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(
            "caractères non autorisés (lettres, chiffres, '.', '-' et '_' uniquement)".into(),
        );
    }
    Ok(())
}

/// `host`, `host:port`, `[v6]` or `[v6]:port`.
pub fn validate_host_port(value: &str) -> Result<(), String> {
    let (host, port) = split_host_port(value.trim())?;
    validate_host(&host)?;
    if let Some(p) = port
        && p == 0
    {
        return Err("port invalide".into());
    }
    Ok(())
}

/// Splits `host[:port]` handling bracketed IPv6. Returns the bare host.
pub fn split_host_port(value: &str) -> Result<(String, Option<u16>), String> {
    if let Some(rest) = value.strip_prefix('[') {
        let end = rest.find(']').ok_or("crochet fermant manquant")?;
        let host = &rest[..end];
        let after = &rest[end + 1..];
        let port = match after.strip_prefix(':') {
            Some(p) => Some(p.parse::<u16>().map_err(|_| "port invalide")?),
            None if after.is_empty() => None,
            None => return Err("syntaxe invalide".into()),
        };
        return Ok((host.to_string(), port));
    }
    // Bare IPv6 (several colons) has no port.
    if value.matches(':').count() > 1 {
        return Ok((value.to_string(), None));
    }
    match value.split_once(':') {
        Some((h, p)) => Ok((
            h.to_string(),
            Some(p.parse::<u16>().map_err(|_| "port invalide")?),
        )),
        None => Ok((value.to_string(), None)),
    }
}

/// Formats a host for use inside a URI (adds brackets to IPv6 literals).
pub fn host_for_uri(host: &str) -> String {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V6(_)) => format!("[{host}]"),
        _ => host.to_string(),
    }
}

pub fn validate_user(user: &str) -> Result<(), String> {
    if user.is_empty() {
        return Err("valeur obligatoire".into());
    }
    if user.len() > 64 {
        return Err("trop long (64 caractères max.)".into());
    }
    if !user
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-' | '~' | '!' | '*'))
    {
        return Err(
            "caractères non autorisés (lettres, chiffres et . _ + - ~ ! * uniquement)".into(),
        );
    }
    Ok(())
}

/// Values we put between double quotes in a baresip account line.
pub fn validate_quoted_value(v: &str) -> Result<(), String> {
    if v.len() > 128 {
        return Err("trop long (128 caractères max.)".into());
    }
    if v.contains('"') || v.contains('\\') || has_control(v) {
        return Err("guillemets, antislash et caractères de contrôle interdits".into());
    }
    Ok(())
}

/// Baresip parses `auth_pass="..."` with libre's parameter decoder, which has no
/// escape mechanism: a double quote or line break in the password cannot be sent.
pub fn validate_password(pw: &str) -> AppResult<()> {
    if pw.len() > 256 {
        return Err(AppError::validation(
            "Mot de passe trop long (256 caractères max.)",
        ));
    }
    if pw.contains('"') || has_control(pw) {
        return Err(AppError::validation(
            "Le mot de passe ne peut pas contenir de guillemet double (\") ni de caractère de contrôle \
             (limitation de la syntaxe de compte de Baresip).",
        ));
    }
    Ok(())
}

fn is_phone_like(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| {
            c.is_ascii_digit() || matches!(c, '+' | '*' | '#' | ' ' | '-' | '.' | '(' | ')')
        })
}

fn encode_user(user: &str) -> String {
    let mut out = String::with_capacity(user.len());
    for c in user.chars() {
        match c {
            '#' => out.push_str("%23"),
            c => out.push(c),
        }
    }
    out
}

/// Turns what a user typed (number, extension, `user@host`, `sip:...`) into a
/// full SIP URI that is safe to hand to the engine. `default_domain` is used
/// for bare numbers.
pub fn normalize_target(input: &str, default_domain: &str) -> Result<String, String> {
    let t = input.trim();
    if t.is_empty() {
        return Err("destinataire vide".into());
    }
    if t.len() > 200 {
        return Err("destinataire trop long".into());
    }
    if has_control(t) || t.contains(['<', '>', '"', '\\', ',']) {
        return Err("caractères non autorisés".into());
    }

    let lower = t.to_ascii_lowercase();
    let (scheme, rest) = if let Some(r) = lower.strip_prefix("sips:") {
        ("sips", &t[t.len() - r.len()..])
    } else if let Some(r) = lower.strip_prefix("sip:") {
        ("sip", &t[t.len() - r.len()..])
    } else {
        ("sip", t)
    };

    if rest.contains(char::is_whitespace) && !is_phone_like(rest) {
        return Err("espaces non autorisés".into());
    }

    // Split optional URI parameters (only `transport=` is accepted).
    let (addr, params) = match rest.split_once(';') {
        Some((a, p)) => (a, Some(p)),
        None => (rest, None),
    };
    let transport_param = match params {
        None => None,
        Some(p) => {
            let (k, v) = p.split_once('=').ok_or("paramètre d'URI invalide")?;
            if !k.eq_ignore_ascii_case("transport")
                || !matches!(v.to_ascii_lowercase().as_str(), "udp" | "tcp" | "tls")
            {
                return Err("seul le paramètre transport=udp|tcp|tls est accepté".into());
            }
            Some(v.to_ascii_lowercase())
        }
    };

    let (user, host_part) = match addr.rsplit_once('@') {
        Some((u, h)) => (Some(u), h.to_string()),
        None if is_phone_like(addr) || validate_user(addr).is_ok() => {
            (Some(addr), default_domain.to_string())
        }
        None => (None, addr.to_string()), // `sip:host`
    };

    let user = match user {
        Some(u) => {
            let cleaned: String = if is_phone_like(u) {
                u.chars()
                    .filter(|c| !matches!(c, ' ' | '-' | '.' | '(' | ')'))
                    .collect()
            } else {
                u.to_string()
            };
            if cleaned.is_empty() {
                return Err("numéro vide".into());
            }
            // `#` may legitimately appear in a dialled number; allow it, percent-encoded.
            let probe: String = cleaned.chars().filter(|c| *c != '#').collect();
            if !probe.is_empty() {
                validate_user(&probe).map_err(|e| format!("numéro/identifiant : {e}"))?;
            }
            Some(encode_user(&cleaned))
        }
        None => None,
    };

    let (host, port) = split_host_port(&host_part)?;
    validate_host(&host).map_err(|e| format!("hôte : {e}"))?;
    if port == Some(0) {
        return Err("port invalide".into());
    }

    let mut uri = String::from(scheme);
    uri.push(':');
    if let Some(u) = user {
        uri.push_str(&u);
        uri.push('@');
    }
    uri.push_str(&host_for_uri(&host));
    if let Some(p) = port {
        uri.push_str(&format!(":{p}"));
    }
    if let Some(t) = transport_param {
        uri.push_str(&format!(";transport={t}"));
    }
    Ok(uri)
}

/// Extracts the user part from anything that looks like a SIP address
/// (`"Bob" <sip:bob@host;x=y>`, `sip:bob@host`, `bob@host`), percent-decoded.
pub fn user_part(uri: &str) -> String {
    let inner = match (uri.find('<'), uri.rfind('>')) {
        (Some(a), Some(b)) if a < b => &uri[a + 1..b],
        _ => uri,
    };
    let lower = inner.to_ascii_lowercase();
    let inner =
        if lower.starts_with("sips:") || lower.starts_with("sip:") || lower.starts_with("tel:") {
            &inner[inner.find(':').map(|i| i + 1).unwrap_or(0)..]
        } else {
            inner
        };
    let before_params = inner.split(';').next().unwrap_or(inner);
    let user = match before_params.rsplit_once('@') {
        Some((u, _)) => u,
        None => before_params,
    };
    percent_decode(user)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Some(v) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Canonical form used to match engine events to accounts: lower-case,
/// no display name, no `<>`, no URI parameters, no default port.
pub fn normalize_aor(aor: &str) -> String {
    let inner = match (aor.find('<'), aor.rfind('>')) {
        (Some(a), Some(b)) if a < b => &aor[a + 1..b],
        _ => aor,
    };
    let mut s = inner.trim().to_ascii_lowercase();
    if let Some(i) = s.find(';') {
        s.truncate(i);
    }
    for default_port in [":5060", ":5061"] {
        if s.ends_with(default_port) {
            let n = s.len() - default_port.len();
            s.truncate(n);
        }
    }
    s
}

/// Do two "numbers" designate the same party? Handles `+33`/`0033`/`0` prefixes
/// loosely (suffix match on at least 8 digits) and falls back to a
/// case-insensitive comparison for alphanumeric usernames.
pub fn numbers_match(a: &str, b: &str) -> bool {
    let ua = user_part(a);
    let ub = user_part(b);
    if ua.is_empty() || ub.is_empty() {
        return false;
    }
    if ua.eq_ignore_ascii_case(&ub) {
        return true;
    }
    let da = digits(&ua);
    let db = digits(&ub);
    if da.is_empty() || db.is_empty() || !is_phone_like(&ua) || !is_phone_like(&ub) {
        return false;
    }
    if da == db {
        return true;
    }
    let (short, long) = if da.len() <= db.len() {
        (&da, &db)
    } else {
        (&db, &da)
    };
    short.len() >= 8 && long.ends_with(short.as_str())
}

/// Digits of a number with the international (`00`) or national (`0`) trunk prefix removed.
fn digits(s: &str) -> String {
    let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if let Some(rest) = d.strip_prefix("00") {
        rest.to_string()
    } else if let Some(rest) = d.strip_prefix('0') {
        rest.to_string()
    } else {
        d
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts() {
        assert!(validate_host("sip.example.com").is_ok());
        assert!(validate_host("192.168.1.10").is_ok());
        assert!(validate_host("::1").is_ok());
        assert!(validate_host("pbx_1.lan").is_ok());
        assert!(validate_host("").is_err());
        assert!(validate_host("bad host").is_err());
        assert!(validate_host("a;b").is_err());
        assert!(validate_host("host:5060").is_err());
        assert!(validate_host(".example.com").is_err());
    }

    #[test]
    fn host_port() {
        assert!(validate_host_port("proxy.example.com:5061").is_ok());
        assert!(validate_host_port("[2001:db8::1]:5060").is_ok());
        assert!(validate_host_port("proxy.example.com:99999").is_err());
        assert!(validate_host_port("proxy.example.com:0").is_err());
        assert_eq!(host_for_uri("2001:db8::1"), "[2001:db8::1]");
        assert_eq!(host_for_uri("example.com"), "example.com");
    }

    #[test]
    fn passwords() {
        assert!(validate_password("p@ss;w0rd with space").is_ok());
        assert!(validate_password("with\"quote").is_err());
        assert!(validate_password("line\nbreak").is_err());
    }

    #[test]
    fn targets_from_numbers() {
        assert_eq!(
            normalize_target("1002", "pbx.lan").unwrap(),
            "sip:1002@pbx.lan"
        );
        assert_eq!(
            normalize_target("+33 6 12 34 56 78", "pbx.lan").unwrap(),
            "sip:+33612345678@pbx.lan"
        );
        assert_eq!(
            normalize_target("(01) 23-45.67", "pbx.lan").unwrap(),
            "sip:01234567@pbx.lan"
        );
        assert_eq!(
            normalize_target("*21#", "pbx.lan").unwrap(),
            "sip:*21%23@pbx.lan"
        );
        assert_eq!(
            normalize_target("reception", "pbx.lan").unwrap(),
            "sip:reception@pbx.lan"
        );
    }

    #[test]
    fn targets_from_uris() {
        assert_eq!(
            normalize_target("sip:bob@example.com", "x").unwrap(),
            "sip:bob@example.com"
        );
        assert_eq!(
            normalize_target("SIP:bob@Example.com:5070", "x").unwrap(),
            "sip:bob@Example.com:5070"
        );
        assert_eq!(
            normalize_target("bob@example.com", "x").unwrap(),
            "sip:bob@example.com"
        );
        assert_eq!(
            normalize_target("sips:bob@example.com", "x").unwrap(),
            "sips:bob@example.com"
        );
        assert_eq!(
            normalize_target("sip:bob@example.com;transport=tcp", "x").unwrap(),
            "sip:bob@example.com;transport=tcp"
        );
        assert_eq!(
            normalize_target("sip:bob@[2001:db8::1]:5070", "x").unwrap(),
            "sip:bob@[2001:db8::1]:5070"
        );
    }

    #[test]
    fn rejects_dangerous_targets() {
        for bad in [
            "",
            "   ",
            "sip:bob@example.com;foo=bar",
            "bob@example.com extra",
            "bob@exa mple.com",
            "sip:bob@example.com\nhangup",
            "<sip:bob@example.com>",
            "sip:\"bob\"@example.com",
            "sip:bob@example.com:0",
            "sip:bob@example.com:99999",
            "a,b",
        ] {
            assert!(
                normalize_target(bad, "pbx.lan").is_err(),
                "should reject {bad:?}"
            );
        }
    }

    #[test]
    fn user_parts() {
        assert_eq!(user_part("sip:1002@example.com"), "1002");
        assert_eq!(user_part("\"Bob\" <sip:bob@example.com;x=y>"), "bob");
        assert_eq!(user_part("sip:*21%23@pbx"), "*21#");
        assert_eq!(user_part("+33612345678"), "+33612345678");
        assert_eq!(user_part("tel:+33612345678"), "+33612345678");
        assert_eq!(user_part("sip:example.com"), "example.com");
    }

    #[test]
    fn aor_normalisation() {
        assert_eq!(
            normalize_aor("sip:1001@Example.com"),
            "sip:1001@example.com"
        );
        assert_eq!(
            normalize_aor("<sip:1001@example.com;transport=tls>"),
            "sip:1001@example.com"
        );
        assert_eq!(
            normalize_aor("sip:1001@example.com:5060"),
            "sip:1001@example.com"
        );
    }

    #[test]
    fn matching_numbers() {
        assert!(numbers_match("sip:1002@pbx", "1002"));
        assert!(numbers_match("sip:+33612345678@pbx", "0033612345678"));
        assert!(numbers_match("sip:0612345678@pbx", "+33612345678"));
        assert!(numbers_match("sip:612345678@pbx", "+33612345678"));
        assert!(!numbers_match("sip:1002@pbx", "1003"));
        assert!(numbers_match("sip:Alice@pbx", "alice"));
        assert!(!numbers_match("", "1002"));
    }
}
