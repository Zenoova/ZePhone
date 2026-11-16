//! Human-readable diagnostics for SIP status codes and engine errors.
//! The UI shows the numeric code as well, so users can quote it to their provider.

/// Short French description of a SIP response code in the registration / call context.
pub fn describe_sip_code(code: u16) -> &'static str {
    match code {
        200 => "Saved",
        400 => "Invalid request (400): check the domain and the identifier",
        401 => "Authentication refused (401): wrong authentication username or password",
        403 => "Access denied (403): the server rejects this account or this password",
        404 => "Account or domain not found on the server (404)",
        407 => "Proxy authentication refused (407)",
        408 => "The server is not answering (408, timed out)",
        410 => "Recipient gone (410)",
        480 => "Recipient temporarily unavailable (480)",
        481 => "Transaction unknown to the server (481)",
        482 => "Loop detected (482)",
        484 => "Incomplete address (484)",
        486 => "Busy (486)",
        487 => "Call cancelled (487)",
        488 | 606 => "Media refused (incompatible codecs or encryption)",
        500 => "Internal server error (500)",
        502 => "Bad gateway (502)",
        503 => "Service unavailable (503): the server is overloaded or under maintenance",
        504 => "Gateway timeout (504)",
        600 => "Busy everywhere (600)",
        603 => "Call declined (603)",
        604 => "Recipient does not exist (604)",
        c if (400..500).contains(&c) => "Request refused by the server",
        c if (500..600).contains(&c) => "Server-side error",
        c if (600..700).contains(&c) => "Call permanently refused",
        _ => "Unexpected SIP response",
    }
}

/// Translates engine/network error texts (libre `strerror` style) when there is no SIP code.
pub fn describe_engine_reason(reason: &str) -> String {
    let r = reason.trim();
    let l = r.to_ascii_lowercase();
    let known = [
        (
            "connection refused",
            "Connection refused: no SIP server is listening at this address/port",
        ),
        ("connection reset", "Connection interrupted by the server"),
        (
            "connection timed out",
            "The server is not answering (timed out)",
        ),
        (
            "operation timed out",
            "The server is not answering (timed out)",
        ),
        ("no route to host", "Server unreachable (no route)"),
        ("network is unreachable", "Network unreachable"),
        ("host is down", "The server is offline"),
        ("network is down", "No network connection"),
        (
            "no such file or directory",
            "Server not found (DNS resolution failed?)",
        ),
        ("dns", "DNS resolution failed: check the server name"),
        ("authentication", "Authentication failed"),
        ("certificate", "Invalid or untrusted server TLS certificate"),
        ("ssl", "TLS negotiation failed"),
        ("tls", "TLS negotiation failed"),
        ("local timeout", "No local answer: the call timed out"),
        (
            "mediaenc failed",
            "Media encryption (SRTP) refused by the other party",
        ),
        ("rejected by user", "Declined call"),
    ];
    for (needle, text) in known {
        if l.contains(needle) {
            return text.to_owned();
        }
    }
    if r.is_empty() {
        "Unknown error".to_owned()
    } else {
        r.to_owned()
    }
}

fn standard_reason(code: u16) -> &'static str {
    match code {
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        407 => "Proxy Authentication Required",
        408 => "Request Timeout",
        480 => "Temporarily Unavailable",
        486 => "Busy Here",
        500 => "Server Internal Error",
        503 => "Service Unavailable",
        _ => "",
    }
}

/// Message shown for a registration failure: the explanation for the code, plus the
/// server's own reason phrase when it says something more than the standard one.
pub fn describe_registration_failure(code: Option<u16>, reason: &str) -> String {
    match code {
        Some(c) => {
            let base = describe_sip_code(c);
            let r = reason.trim();
            let l = r.to_ascii_lowercase();
            let redundant = r.is_empty()
                || r.eq_ignore_ascii_case(standard_reason(c))
                || l.contains("timed out")
                || l.contains("timeout");
            if redundant {
                base.to_owned()
            } else {
                format!("{base} — “{r}”")
            }
        }
        None => describe_engine_reason(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn well_known_codes_are_described() {
        for code in [401u16, 403, 404, 408, 503] {
            let d = describe_sip_code(code);
            assert!(d.contains(&code.to_string()), "{code}: {d}");
        }
        assert_eq!(describe_sip_code(499), "Request refused by the server");
        assert_eq!(describe_sip_code(599), "Server-side error");
        assert_eq!(describe_sip_code(666), "Call permanently refused");
        assert_eq!(describe_sip_code(0), "Unexpected SIP response");
    }

    #[test]
    fn engine_reasons_are_translated() {
        assert!(
            describe_engine_reason("Connection refused [61]").starts_with("Connection refused")
        );
        assert!(describe_engine_reason("Connection timed out").contains("timed out"));
        assert_eq!(describe_engine_reason("something weird"), "something weird");
        assert_eq!(describe_engine_reason(""), "Unknown error");
    }

    #[test]
    fn registration_failure_messages() {
        let m = describe_registration_failure(Some(403), "Forbidden");
        assert!(
            m.contains("403") && !m.contains('“'),
            "standard phrase is not repeated: {m}"
        );
        let m = describe_registration_failure(Some(403), "Account disabled");
        assert!(m.contains("403") && m.contains("“Account disabled”"), "{m}");
        let m = describe_registration_failure(Some(401), "Unauthorized");
        assert!(m.contains("401"), "{m}");
        assert!(
            describe_registration_failure(None, "Connection refused [61]")
                .starts_with("Connection refused")
        );
        assert!(
            describe_registration_failure(Some(408), "Connection timed out").contains("timed out")
        );
    }
}
