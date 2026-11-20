fn main() {
    telemetry_identifiers();
    link_ios_engine();
    tauri_build::build()
}

/// iOS cannot run Baresip as a child process: it is linked into the application as a static library
/// (`npm run sidecar:ios`, see `scripts/build-baresip-ios.sh`), one build per slice (device, simulator).
fn link_ios_engine() {
    println!("cargo:rerun-if-changed=ios/libs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }
    let slice = if std::env::var("TARGET").is_ok_and(|t| t.ends_with("-sim")) {
        "sim"
    } else {
        "device"
    };
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("ios")
        .join("libs")
        .join(slice);
    if !dir.join("libzephone_engine.a").is_file() {
        println!(
            "cargo:warning=the SIP engine for iOS ({slice}) is missing: run `npm run sidecar:ios` first"
        );
    }
    println!("cargo:rustc-link-search=native={}", dir.display());
    println!("cargo:rustc-link-lib=static=zephone_engine");
    // What the engine itself needs from the system: audio units, the network configuration, the DNS resolver.
    for framework in [
        "AudioToolbox",
        "CoreAudio",
        "AVFoundation",
        "AVFAudio",
        "Contacts",
        "CoreFoundation",
        "SystemConfiguration",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    // The DNS resolver, and zlib (libre's checksums).
    println!("cargo:rustc-link-lib=resolv");
    println!("cargo:rustc-link-lib=z");
}

/// The identifiers of the diagnostics services (Sentry, Google Analytics) are not in the repository: they come
/// from the environment of the build (the CI's secrets) or from `telemetry.env`, which Git ignores. A build
/// without them, such as a fork's, sends nothing, ever.
fn telemetry_identifiers() {
    const KEYS: [&str; 3] = [
        "ZEPHONE_SENTRY_DSN",
        "ZEPHONE_GA_MEASUREMENT_ID",
        "ZEPHONE_GA_API_SECRET",
    ];
    println!("cargo:rerun-if-changed=telemetry.env");
    let file = std::fs::read_to_string("telemetry.env").unwrap_or_default();
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        let from_file = file.lines().find_map(|l| {
            let (k, v) = l.split_once('=')?;
            (k.trim() == key).then(|| v.trim().trim_matches('"').to_owned())
        });
        let value = std::env::var(key).ok().or(from_file).unwrap_or_default();
        if !value.is_empty() {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}
