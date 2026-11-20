fn main() {
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
        "CoreFoundation",
        "SystemConfiguration",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-lib=resolv");
}
