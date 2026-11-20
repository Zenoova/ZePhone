use super::*;
use std::sync::Mutex as StdMutex;

#[derive(Default)]
struct Fake(StdMutex<Vec<(String, String)>>);

#[async_trait]
impl Transport for Fake {
    async fn post(
        &self,
        url: &str,
        _: &str,
        _: &[(&str, String)],
        body: String,
    ) -> Result<(), String> {
        self.0.lock().unwrap().push((url.to_owned(), body));
        Ok(())
    }
}

const DSN: &str = "https://k@o1.ingest.de.sentry.io/7";

fn service(dsn: bool, ga: bool) -> (Arc<Telemetry>, Arc<Fake>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let fake = Arc::new(Fake::default());
    let cfg = Config {
        dsn: dsn.then(|| Dsn::parse(DSN).unwrap()),
        ga: ga.then(|| ga::Ga {
            measurement_id: "G-TEST".into(),
            api_secret: "s".into(),
        }),
        environment: "test".into(),
    };
    let t = Telemetry::new(
        cfg,
        fake.clone(),
        Arc::new(Database::open_in_memory().unwrap()),
        dir.path().join("crash"),
    );
    (t, fake, dir)
}

fn consent(crash: bool, stats: bool) -> PrivacySettings {
    PrivacySettings {
        crash_reports: crash,
        usage_stats: stats,
        answered: true,
    }
}

#[tokio::test]
async fn nothing_is_sent_before_the_notice_of_the_first_launch_is_validated() {
    let (t, fake, _d) = service(true, true);
    let fresh = PrivacySettings::default();
    assert!(fresh.crash_reports && fresh.usage_stats && !fresh.answered, "on by default");
    t.apply(&fresh).await;
    t.track("app_open", &[]).await.unwrap();
    t.report_webview_error("Error", "boom", "").await;
    assert!(fake.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn validating_the_notice_with_the_defaults_turns_both_on() {
    let (t, fake, _d) = service(true, true);
    t.apply(&PrivacySettings { answered: true, ..PrivacySettings::default() }).await;
    t.report_webview_error("Error", "boom", "").await;
    let sent = fake.0.lock().unwrap();
    assert_eq!(sent.len(), 2, "{sent:?}");
}

#[tokio::test]
async fn turning_one_off_keeps_the_other() {
    let (t, fake, _d) = service(true, true);
    t.apply(&consent(false, true)).await;
    t.report_webview_error("Error", "boom", "").await;
    let sent = fake.0.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].0.contains("google-analytics"));
}

#[tokio::test]
async fn usage_counts_go_to_google_analytics_once_allowed_and_app_open_is_sent_once() {
    let (t, fake, _d) = service(true, true);
    t.apply(&consent(false, true)).await;
    t.apply(&consent(false, true)).await;
    t.track("call_outgoing", &[]).await.unwrap();
    let sent = fake.0.lock().unwrap();
    assert_eq!(sent.len(), 2, "{sent:?}");
    assert!(
        sent[0]
            .0
            .starts_with("https://www.google-analytics.com/mp/collect?measurement_id=G-TEST")
    );
    assert!(sent[0].1.contains("app_open") && sent[1].1.contains("call_outgoing"));
}

#[tokio::test]
async fn an_event_that_is_not_listed_is_refused_even_with_consent() {
    let (t, fake, _d) = service(true, true);
    t.apply(&consent(true, true)).await;
    fake.0.lock().unwrap().clear();
    assert!(
        t.track("dialed_number", &[("number".into(), "0123456789".into())])
            .await
            .is_err()
    );
    assert!(fake.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn webview_errors_are_scrubbed_sent_and_limited() {
    let (t, fake, _d) = service(true, false);
    t.apply(&consent(true, false)).await;
    t.report_webview_error(
        "TypeError",
        "cannot read sip:alice@pbx.example.com",
        "f@tauri://localhost/assets/index.js:1:2345",
    )
    .await;
    {
        let sent = fake.0.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].0.ends_with("/api/7/envelope/"));
        assert!(
            !sent[0].1.contains("alice") && !sent[0].1.contains("pbx"),
            "{}",
            sent[0].1
        );
        assert!(sent[0].1.contains("index.js"));
    }
    for _ in 0..50 {
        t.report_webview_error("Error", "again", "").await;
    }
    assert_eq!(fake.0.lock().unwrap().len(), MAX_WEBVIEW_ERRORS as usize);
}

#[tokio::test]
async fn a_crash_written_before_is_sent_at_the_next_start_unless_turned_off() {
    let (t, fake, d) = service(true, false);
    sentry::write_pending(
        &d.path().join("crash"),
        &panic_report("index out of bounds", "src/x.rs", 9),
    );
    t.apply(&PrivacySettings::default()).await;
    assert!(fake.0.lock().unwrap().is_empty());
    assert_eq!(
        sentry::pending_files(&d.path().join("crash")).len(),
        1,
        "kept until the user answers"
    );
    t.apply(&consent(true, false)).await;
    assert_eq!(fake.0.lock().unwrap().len(), 1);
    assert!(sentry::pending_files(&d.path().join("crash")).is_empty());
}

#[tokio::test]
async fn turning_it_off_deletes_what_was_waiting() {
    let (t, fake, d) = service(true, false);
    sentry::write_pending(&d.path().join("crash"), &panic_report("x", "src/x.rs", 9));
    t.apply(&consent(false, false)).await;
    assert!(fake.0.lock().unwrap().is_empty());
    assert!(sentry::pending_files(&d.path().join("crash")).is_empty());
}

#[tokio::test]
async fn without_build_identifiers_nothing_is_ever_sent() {
    let (t, fake, _d) = service(false, false);
    t.apply(&consent(true, true)).await;
    t.track("app_open", &[]).await.unwrap();
    t.report_webview_error("Error", "x", "").await;
    assert!(fake.0.lock().unwrap().is_empty());
}

#[test]
fn the_installation_id_is_stable_and_can_be_reset() {
    let (t, _f, _d) = service(true, true);
    let a = t.install_id();
    assert_eq!(a, t.install_id());
    t.reset_install_id();
    assert_ne!(a, t.install_id());
}

#[test]
fn javascript_stacks_of_both_engines_are_read() {
    let frames =
        parse_js_stack("at run (https://x/a.js:10:5)\nf@tauri://localhost/b.js:3:4\nnoise");
    assert_eq!(frames.len(), 2);
    assert_eq!(
        (frames[0].function.as_deref(), frames[0].line),
        (Some("run"), Some(10))
    );
    assert_eq!(
        (frames[1].function.as_deref(), frames[1].line),
        (Some("f"), Some(3))
    );
}

/// Sends one labelled event to the real Sentry project, to check the envelope is accepted:
/// `ZEPHONE_SENTRY_DSN=... cargo test --lib live_sentry -- --ignored`
#[tokio::test]
#[ignore = "talks to the network"]
async fn live_sentry_accepts_the_envelope() {
    let dsn = Dsn::parse(&std::env::var("ZEPHONE_SENTRY_DSN").unwrap()).unwrap();
    let report = Report::new(
        Origin::Backend,
        "SelfTest",
        "ZePhone telemetry self-test (not a real error)",
        vec![],
        false,
    );
    let ctx = sentry::Context { environment: "self-test", install_id: "self-test" };
    HttpTransport::new()
        .post(
            &dsn.envelope_url(),
            "application/x-sentry-envelope",
            &[("x-sentry-auth", dsn.auth_header())],
            sentry::envelope(&dsn, &report, &ctx),
        )
        .await
        .unwrap();
}
