//! Human-readable diagnostics for SIP status codes and engine errors.
//! The UI shows the numeric code as well, so users can quote it to their provider.

/// Short French description of a SIP response code in the registration / call context.
pub fn describe_sip_code(code: u16) -> &'static str {
    match code {
        200 => "Enregistré",
        400 => "Requête invalide (400) : vérifiez le domaine et l'identifiant",
        401 => {
            "Authentification refusée (401) : identifiant d'authentification ou mot de passe incorrect"
        }
        403 => "Accès refusé (403) : le serveur rejette ce compte ou ce mot de passe",
        404 => "Compte ou domaine introuvable sur le serveur (404)",
        407 => "Authentification du proxy refusée (407)",
        408 => "Le serveur ne répond pas (408, délai dépassé)",
        410 => "Destinataire disparu (410)",
        480 => "Destinataire temporairement indisponible (480)",
        481 => "Transaction inconnue du serveur (481)",
        482 => "Boucle détectée (482)",
        484 => "Adresse incomplète (484)",
        486 => "Occupé (486)",
        487 => "Appel annulé (487)",
        488 | 606 => "Médias refusés (codecs ou chiffrement incompatibles)",
        500 => "Erreur interne du serveur (500)",
        502 => "Passerelle défaillante (502)",
        503 => "Service indisponible (503) : le serveur est surchargé ou en maintenance",
        504 => "Délai de la passerelle dépassé (504)",
        600 => "Occupé partout (600)",
        603 => "Appel refusé (603)",
        604 => "Destinataire inexistant (604)",
        c if (400..500).contains(&c) => "Requête refusée par le serveur",
        c if (500..600).contains(&c) => "Erreur côté serveur",
        c if (600..700).contains(&c) => "Appel refusé de manière définitive",
        _ => "Réponse SIP inattendue",
    }
}

/// Translates engine/network error texts (libre `strerror` style) when there is no SIP code.
pub fn describe_engine_reason(reason: &str) -> String {
    let r = reason.trim();
    let l = r.to_ascii_lowercase();
    let known = [
        (
            "connection refused",
            "Connexion refusée : aucun serveur SIP n'écoute à cette adresse/ce port",
        ),
        ("connection reset", "Connexion interrompue par le serveur"),
        (
            "connection timed out",
            "Le serveur ne répond pas (délai dépassé)",
        ),
        (
            "operation timed out",
            "Le serveur ne répond pas (délai dépassé)",
        ),
        ("no route to host", "Serveur injoignable (aucune route)"),
        ("network is unreachable", "Réseau inaccessible"),
        ("host is down", "Le serveur est hors ligne"),
        ("network is down", "Aucune connexion réseau"),
        (
            "no such file or directory",
            "Serveur introuvable (résolution DNS impossible ?)",
        ),
        (
            "dns",
            "Résolution DNS impossible : vérifiez le nom du serveur",
        ),
        ("authentication", "Échec de l'authentification"),
        (
            "certificate",
            "Certificat TLS du serveur invalide ou non approuvé",
        ),
        ("ssl", "Échec de la négociation TLS"),
        ("tls", "Échec de la négociation TLS"),
        ("local timeout", "Pas de réponse locale : l'appel a expiré"),
        (
            "mediaenc failed",
            "Chiffrement des médias (SRTP) refusé par le correspondant",
        ),
        ("rejected by user", "Appel refusé"),
    ];
    for (needle, text) in known {
        if l.contains(needle) {
            return text.to_owned();
        }
    }
    if r.is_empty() {
        "Erreur inconnue".to_owned()
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
                format!("{base} — « {r} »")
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
        assert_eq!(describe_sip_code(499), "Requête refusée par le serveur");
        assert_eq!(describe_sip_code(599), "Erreur côté serveur");
        assert_eq!(describe_sip_code(666), "Appel refusé de manière définitive");
        assert_eq!(describe_sip_code(0), "Réponse SIP inattendue");
    }

    #[test]
    fn engine_reasons_are_translated() {
        assert!(describe_engine_reason("Connection refused [61]").starts_with("Connexion refusée"));
        assert!(describe_engine_reason("Connection timed out").contains("délai dépassé"));
        assert_eq!(describe_engine_reason("something weird"), "something weird");
        assert_eq!(describe_engine_reason(""), "Erreur inconnue");
    }

    #[test]
    fn registration_failure_messages() {
        let m = describe_registration_failure(Some(403), "Forbidden");
        assert!(
            m.contains("403") && !m.contains('«'),
            "standard phrase is not repeated: {m}"
        );
        let m = describe_registration_failure(Some(403), "Account disabled");
        assert!(
            m.contains("403") && m.contains("« Account disabled »"),
            "{m}"
        );
        let m = describe_registration_failure(Some(401), "Unauthorized");
        assert!(m.contains("401"), "{m}");
        assert!(
            describe_registration_failure(None, "Connection refused [61]")
                .starts_with("Connexion refusée")
        );
        assert!(
            describe_registration_failure(Some(408), "Connection timed out")
                .contains("délai dépassé")
        );
    }
}
