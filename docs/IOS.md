# ZePhone on iPhone and iPad

ZePhone also runs on iOS and iPadOS (15.0 or later). It is **the same application**: the same Rust core, the same Baresip engine,
the same web interface, laid out for a phone. Everything specific to iOS is selected by `cfg(target_os = "ios")` / `cfg(mobile)`
on the Rust side and by `isMobile()` on the web side (an iPad is detected too, although it asks for the desktop version of
pages).

This page says what was built, how, and — above all — what was **verified and what was not**.

## How the engine runs

iOS lets an application run nothing but itself: there is no sidecar and no child process. The engine therefore cannot be started
the way it is on a computer or on Android. It is **linked into the application** and runs on a thread of it:

- [`scripts/build-baresip-ios.sh`](../scripts/build-baresip-ios.sh) builds, for the iPhone (`aarch64-apple-ios`) and for the
  simulator (`aarch64-apple-ios-sim`), OpenSSL, Opus, libre and Baresip, with the modules the application loads (`g711`, `opus`,
  `auconv`, `auresamp`, `audiounit`, `srtp`, `vumeter`, `menu`, `ctrl_tcp`) and ZePhone's own `zeaudio`, all STATIC, plus a tiny
  entry point, into **one archive per slice**: `src-tauri/ios/libs/<device|sim>/libzephone_engine.a` (git-ignored). OpenSSL's
  tarball is checked against the SHA-256 the release publishes (or a pinned `OPENSSL_SHA256`). It needs Xcode, CMake and Git; the
  first run takes about four minutes per slice. `npm run sidecar:ios [device|sim|all] [--force]` runs it (and `tauri ios
build|dev` runs it for the slice being built).
- [`scripts/ios-engine/zephone_engine.c`](../scripts/ios-engine/zephone_engine.c) is Baresip's `main()` made callable
  (`zephone_engine_run`) and stoppable from another thread (`zephone_engine_stop`), without the command line, the signal handlers
  (the application owns the signals) and the console output (every log line goes to the application's log, where secrets are
  redacted as for the other engines). It also reads the system's DNS servers (`zephone_engine_dns_servers`).
- [`ios.rs`](../src-tauri/src/sip/engine/baresip/ios.rs) runs it on a thread. **Everything else is unchanged**: the engine is
  still driven through `ctrl_tcp`, bound to **`127.0.0.1` on a random port**, by the same supervisor, so the `SipEngine` trait, the
  manager, the commands and the UI know nothing about it. An engine restart (the "Restart now" button, a crash back-off) is a
  stop and a start of the thread, in the same process.
- [`build.rs`](../src-tauri/build.rs) links the archive (and the system libraries it needs: AudioToolbox, CoreAudio, AVFoundation,
  AVFAudio, SystemConfiguration, `resolv`, `z`); the same frameworks are listed in the Xcode project
  ([`project.yml`](../src-tauri/gen/apple/project.yml)).

Audio goes through Baresip's **`audiounit`** module (the Voice Processing I/O unit: echo cancellation and gain control by the
system); the application configures the shared `AVAudioSession`
([`call_audio.rs`](../src-tauri/src/app/call_audio.rs)): "play and record" with the voice-chat mode while a call exists (earpiece,
call volume, Bluetooth headsets over the hands-free profile) and the loudspeaker button; the session is given back, with a "notify
others" flag so that music can resume, when the last call ends.

## Building

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm install
npm run tauri ios build -- --debug --target aarch64-sim   # simulator → src-tauri/gen/apple/build/arm64-sim/ZePhone.app
npm run tauri ios dev "iPhone 17 Pro"                      # simulator, with the Vite dev server
```

Add `--ci` to skip the prompts. `npm run tauri ios init --ci` (already done) generated the Xcode project in
[`src-tauri/gen/apple`](../src-tauri/gen/apple), which is committed, with these changes to what Tauri generated: the frameworks
above, `NSMicrophoneUsageDescription`, `NSLocalNetworkUsageDescription` and the `audio` background mode in
[`project.yml`](../src-tauri/gen/apple/project.yml). After editing it, run `xcodegen generate` in `src-tauri/gen/apple`. The
project builds for the iPhone **and** the iPad (`TARGETED_DEVICE_FAMILY` 1,2) with a deployment target of iOS 15.0.

A build for a real device needs a development team (`bundle > iOS > developmentTeam` in `tauri.conf.json`, or
`APPLE_DEVELOPMENT_TEAM`); none is set in the repository.

## What the iOS shell does

- **Secrets stay in the Keychain** (the `keyring` crate, as on macOS). SIP passwords are never in SQLite, in a file or in a log;
  the application can be reinstalled over itself and the account registers again with the password it finds in the Keychain.
- **Server certificates are always verified** (`sip_verify_server yes`). iOS has no CA file Baresip could read, so the application
  carries one: [`src-tauri/ios/cacert.pem`](../src-tauri/ios/cacert.pem), the root bundle macOS 26 ships as `/etc/ssl/cert.pem`
  (128 certificates, SHA-256 `9dae8d76…`), written next to the engine's configuration at every start. Refresh it by copying
  that file from a newer macOS. The Network settings page still accepts an extra CA file for a private authority, but a file
  outside the application's sandbox cannot be read on iOS, so that option is of little use there.
- **DNS**: host names are resolved through the system (`getaddrinfo`, which follows the network's DNS, VPNs and IPv6-only networks);
  the system's DNS servers are only given to Baresip for the SRV/NAPTR records only a DNS server can answer. `8.8.8.8` is named
  only when the system names none.
- **Microphone**: asked at launch through `AVCaptureDevice`, with the text of `NSMicrophoneUsageDescription`.
- **No** tray icon, global shortcuts, "launch at login", headset-button monitoring (HID), `zephone ctl` socket, system address book
  or call window of its own: the call screen covers the application until you put it away, as on Android.
- **The page keeps out of the notch, the status bar and the home indicator** (`viewport-fit=cover` and
  `env(safe-area-inset-*)`; dialogs too). Two iOS quirks needed a fix in the shell:
  [`viewport_ios.rs`](../src-tauri/src/app/viewport_ios.rs) turns off the scroll view's automatic insets (otherwise the page
  stopped 96 points above the bottom of an iPhone 17 Pro). Text fields are 16 px on a touch screen (otherwise iOS zooms in when
  one is focused).
- **Navigation is the system's own tab bar** (`UITabBar`, [`native_tabbar_ios.rs`](../src-tauri/src/app/native_tabbar_ios.rs)):
  Liquid Glass when the application is built with the iOS 26 SDK (as it is), the classic bar before. The page describes the five
  tabs (SF Symbols) and follows the taps through a Tauri event; it keeps the selection, the missed-call badge and the visibility
  (the bar goes away behind the call screen) in step ([`NativeTabBar.tsx`](../src/layouts/NativeTabBar.tsx)). The webview covers the whole
  screen and the bar floats over it: the page scrolls under the glass, and leaves room for the last lines through a CSS variable the
  shell sets (`--native-tabbar-height`). The dock's two other items moved: the **account** (face, availability, switch, add) is a button at the top right
  of every page, and the **voice orb** is chosen in Settings → General. Other systems keep the page's dock.
- **Device contacts** are a read-only directory source (Settings → Directory → Add a source → Device contacts), read through
  the same Contacts framework as on the Mac ([`system_contacts_apple.rs`](../src-tauri/src/directory/system_contacts_apple.rs)),
  with the text of `NSContactsUsageDescription`. Only names, company, job title, e-mail, numbers and SIP addresses are read.
  "Open the privacy settings" opens the application's page in Settings.
- The audio-device settings (microphone/speaker/ringer choice) are replaced by the system's routing, as on Android.

## Verified

On the **iOS Simulator** (Xcode 26.0.1, iPhone 17 Pro on iOS 26.1; the iPad Pro 11-inch (M4) for the layout), host: Apple silicon Mac:

- `npm run tauri ios build -- --debug --target aarch64-sim` builds and the application runs, on the iPhone and on the iPad.
- `npm run tauri ios dev "iPhone 17 Pro"` builds, deploys to the simulator and runs the application against the Vite dev server.
- The engine starts in-process; `ctrl_tcp` answers on loopback; **"Restart now" restarts it without leaving the process** (and a
  bug found that way, a lost end-of-thread signal that made restarts fail with "busy", is fixed and tested).
- A SIP account entered in the interface (UDP, a throw-away FreeSWITCH on `127.0.0.1:15060`, the engine told to use
  `net_interface 127.0.0.1` through the Network page) **registers with Digest authentication**: FreeSWITCH reports
  `Registered(UDP)`, user agent `baresip v4.13.0 (ios)`. The password came from the Keychain (checked: it is nowhere in the
  application's data container, which was searched for it, and the account registered again after a reinstall).
- An **incoming call** (FreeSWITCH originate to the account) rings, shows the call screen, is **answered**, negotiates **Opus
  48 kHz**, runs for 33 s with live audio levels and call statistics, and is **hung up**. An outgoing call to a number the PBX
  refuses reports its SIP error (`480`) as a toast and the call ends.
- Device contacts: the source connects and 8 contacts of the simulator (two of them added from a vCard) appear in the Directory
  and can be called. The permission was granted to the simulator with `xcrun simctl privacy`, so **the system's own question
  was not seen**.
- The tab bar: tapping a tab opens its section; the History badge counts a missed call; the bar disappears behind an incoming
  call and comes back after it; the account button opens its list; on the iPad the bar takes the iPad's own form (icons beside
  their labels) at the bottom.
- Layout: safe areas on the iPhone (Dynamic Island, home indicator) and the iPad; dialogs; the dock; the keypad (the keys are
  well over 44 pt).
- The existing suites still pass on the Mac: `npx vitest run` (385 tests), `tsc`, `eslint`, `cargo test --lib` (468 tests) and the
  real-Baresip end-to-end suites (`engine_integration`, `manager_e2e`: 21 tests) — the process-based engine was touched to
  make room for the embedded one.
- The device slice of the engine (`aarch64-apple-ios`) is built, and every object of both slices is checked to be built for the
  right platform.

For these checks the microphone permission was granted to the simulator with `xcrun simctl privacy` (no dialog was clicked).

## Not verified

- **A real iPhone or iPad.** Nothing was run on a device: no signing, no install. In particular the device slice was
  built and its objects checked, but never linked into an application or run.
- **Sound actually heard or captured.** The simulator's audio goes through the Mac's devices; the call statistics there showed
  late packets (the audio units of the simulator are not paced like a device's), which says nothing about a phone. Echo
  cancellation, the earpiece, the loudspeaker button, Bluetooth routing and interruptions (a cellular call, Siri) are untested.
- A call that **starts from the application** and is answered (only the failure path was seen), hold, transfer, DTMF, recording.
- **SIP over TLS / SRTP**, and the bundled CA store against a real server. **G.722 is not available** (no spandsp).
- The tab bar **before iOS 26**: the simulator runtimes installed here are iOS 26.0 and 26.1 only. The bar is given the standard
  appearance explicitly (a page is not a scroll view UIKit knows, so it would otherwise stay transparent), but the classic look
  was not seen. Also not seen: the Settings → General voice-orb picker, the tab bar in landscape, and VoiceOver on it.
- Landscape, split view and Stage Manager on the iPad (the webview is re-fitted at every resize, but this was not exercised), the
  dark theme, Dynamic Type, VoiceOver.
- A long run: battery, memory, the engine's thread over hours.

## Not done

- **A call does not survive the application being suspended.** The `audio` background mode keeps a call that is in progress alive
  while the screen is off or another application is in front, but nothing keeps the **registration** alive when there is no call:
  iOS suspends the application, the registration lapses and **incoming calls do not ring**.
- **CallKit and PushKit** (the system's call screen, ringing a suspended application) are the stretch goal and are **not
  implemented**. They need a VoIP push service on the PBX side (an Apple certificate, a push gateway that wakes the phone
  before the INVITE is delivered), and a CallKit provider that reports every PushKit push as a call within seconds. A plan:
  register the device's PushKit token in the SIP `Contact` (`pn-*` parameters, RFC 8599) of a push-aware server; report the push
  to a `CXProvider` from `PKPushRegistryDelegate`; start the engine and register; connect the CallKit answer action to the
  existing `accept`. Without a push-aware PBX it cannot work, whatever the application does.
- No local notification for a missed call while suspended.
- Only the iPhone/iPad simulator ARM64 slice was exercised; there is no x86_64 simulator slice.
- The iPad uses the phone layout, centred; there is no split view with a call list next to the call.
- `ITSAppUsesNonExemptEncryption` is not set in `Info.plist`: the application uses TLS and SRTP, and the export-compliance
  declaration for the App Store is the publisher's to make.
