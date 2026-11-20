//! Anonymous usage counts for Google Analytics 4, sent with the Measurement Protocol (the application is not a web
//! page, so there is no tag to load). Only the events and parameters listed here can be sent: the webview asks
//! for an event by name, and anything else is refused.

use serde_json::{Value, json};

/// Events the application may report. Adding one is a decision to review, not a string to pass through.
pub const EVENTS: &[&str] = &[
    "app_open",
    "account_added",
    "call_outgoing",
    "call_incoming",
];

/// Parameters an event may carry, with the values each accepts.
const PARAMS: &[(&str, &str, &[&str])] = &[("account_added", "transport", &["udp", "tcp", "tls"])];

pub struct Ga {
    pub measurement_id: String,
    pub api_secret: String,
}

impl Ga {
    pub fn endpoint(&self) -> String {
        format!(
            "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
            self.measurement_id, self.api_secret
        )
    }
}

/// Checks an event and its parameters against the lists above.
pub fn validate(event: &str, params: &[(String, String)]) -> Result<(), String> {
    if !EVENTS.contains(&event) {
        return Err(format!("unknown event `{event}`"));
    }
    for (k, v) in params {
        let allowed = PARAMS
            .iter()
            .any(|(e, key, values)| *e == event && key == k && values.contains(&v.as_str()));
        if !allowed {
            return Err(format!("parameter `{k}` is not allowed for `{event}`"));
        }
    }
    Ok(())
}

/// The request body. `client_id` is the random identifier of this installation; the platform and the version
/// are added to every event.
pub fn body(client_id: &str, event: &str, params: &[(String, String)], app_version: &str) -> Value {
    let mut p = serde_json::Map::new();
    for (k, v) in params {
        p.insert(k.clone(), Value::String(v.clone()));
    }
    p.insert("app_version".into(), Value::String(app_version.into()));
    p.insert(
        "platform".into(),
        Value::String(std::env::consts::OS.into()),
    );
    // Without an engagement time, Google Analytics does not show the event in its real-time report.
    p.insert("engagement_time_msec".into(), json!(1));
    json!({
        "client_id": client_id,
        "non_personalized_ads": true,
        "events": [{ "name": event, "params": p }],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(k: &str, v: &str) -> Vec<(String, String)> {
        vec![(k.into(), v.into())]
    }

    #[test]
    fn only_listed_events_and_parameters_pass() {
        assert!(validate("app_open", &[]).is_ok());
        assert!(validate("account_added", &p("transport", "tls")).is_ok());
        assert!(validate("call_outgoing", &[]).is_ok());
        assert!(validate("page_view", &[]).is_err());
        assert!(validate("account_added", &p("transport", "sip:alice@pbx")).is_err());
        assert!(validate("account_added", &p("username", "1001")).is_err());
        assert!(validate("call_incoming", &p("transport", "tls")).is_err());
    }

    #[test]
    fn the_body_carries_the_installation_id_the_version_and_the_platform_only() {
        let b = body("id-1", "account_added", &p("transport", "udp"), "0.1.0");
        assert_eq!(b["client_id"], "id-1");
        let params = &b["events"][0]["params"];
        assert_eq!(params["transport"], "udp");
        assert_eq!(params["app_version"], "0.1.0");
        assert_eq!(params["platform"], std::env::consts::OS);
        assert_eq!(params["engagement_time_msec"], 1);
        assert_eq!(params.as_object().unwrap().len(), 4);
    }
}
