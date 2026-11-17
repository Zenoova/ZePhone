<p align="center"><img src="src-tauri/icons/source/zephone-logo.svg" alt="ZePhone logo" width="128" /></p>

# ZePhone

Universal SIP desktop softphone — **Tauri 2 + React + Rust + Baresip**.
macOS first; Windows runs too (see [Windows](#windows)); the architecture is ready for Linux.

ZePhone is not a simulator: SIP signalling and audio (RTP/SRTP) are handled by
[Baresip](https://github.com/baresip/baresip), embedded in the application as a Tauri _sidecar_.
No PBX is hard-coded: you enter your server, domain, credentials, port and transport
(UDP, TCP, TLS).

> **Honest status**: the engine, accounts, calls (outgoing/incoming), two-way audio, DTMF,
> hold, transfer, history and contacts are tested automatically against the **real** Baresip
> (see [Tests](#tests)). What cannot be validated without real hardware or a real server is listed in
> [Known limits](#known-limits).

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Choosing the engine: Baresip process vs libbaresip](#choosing-the-engine)
- [Requirements](#requirements)
- [Running in development](#running-in-development)
- [Building the macOS application (.app / .dmg)](#building-the-macos-application)
- [Using ZePhone with your PBX](#using-zephone-with-your-pbx)
- [Tests](#tests)
- [Security](#security)
- [Windows](#windows)
- [Linux](#linux)
- [Known limits](#known-limits)
- [Logo](#logo)
- [Licenses](#licenses)

## Features

| Area                           | What works                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts                       | **In the dock, next to the voice orb**: the icon is the small face ([blobatar](https://blobatar.dev), drawn locally from the account address) of the connected account; it opens a simple list (face, name, availability, switch — greyed out when disabled) with a button to **add a SIP account**. The detailed list is in Settings → SIP accounts. **Several accounts are connected at the same time** (one SIP agent per account in the engine) and each receives its calls simultaneously — answering a second call puts the first on hold (verified with two real engines); add/edit/delete, default account, enabling, connect/disconnect, outbound proxy, registration interval, SRTP. Real-time status **derived from SIP events** (Not configured · Connecting · Registered · Disconnected · Error) with the SIP code (401, 403, 404, 408, 503…). A 401 challenge followed by a successful authentication is **not** a failure.                                                                      |
| Call window                    | **Calls open in a separate window** (the main window stays free: keypad, contacts, history). The voice of the other party is a living orb (**real** audio level measured by Baresip; it "thinks" while ringing and "speaks" when the voice is there), a muted microphone shows a "Mic muted" notice, aligned controls (microphone, hold, keypad, transfer, hang up), DTMF pad in frosted glass. **Top right: the volumes, and an options menu** (keep on top, open ZePhone, and for developers: call information, SIP engine log, copy the call ID). The window closes by itself when the call ends.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Outgoing calls                 | Keypad, free-form SIP address, calling from a contact or from the history, default account (nothing is shown above the keypad with a single account; with several, an arrow next to "Call" lets you call with another account), real progress (initializing → dialing → remote ringing → connected), duration, mute, hold/resume, DTMF (RFC 4733), blind transfer (REFER), hang up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Incoming calls                 | Ringtone (Baresip), incoming-call window over any section, native notification, accept/decline (603), missed call, reception with the window closed (menu bar icon).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audio                          | Microphone/output selection (CoreAudio names), USB/Bluetooth devices, G.711 PCMA/PCMU, **G.722 and Opus** (custom Baresip build, `npm run sidecar:hd`), SRTP; wideband codecs are preferred, G.711 remains the universal fallback. macOS microphone permission (`NSMicrophoneUsageDescription`, `audio-input` entitlement).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Volumes                        | Two sliders ([Fluid Slider](https://www.sonaui.com/docs/fluid-slider) by Sona UI): **incoming sound** (what you hear) and **outgoing sound** (what the other party hears from your microphone), from 0 to 200%. In the call window and in Settings → Audio; applied **live** during the call by Baresip's `zeaudio` module, and remembered afterwards.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Recording                      | **Automatic**: every answered call is recorded **locally**, with no button or notice during the call (can be turned off in Settings → Audio). Both voices are written by the `zeaudio` module, then mixed into one mono WAV (≤ 16 kHz) in the app's data folder; the **Recordings** tab lists them with Detent's [Voice note](https://detentui.com/components/voicenote) player (full width, waveform, speed, playback). Nothing leaves the Mac.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Advanced statistics            | In the call window: ⋮ menu → **Advanced statistics**. Six charts updated every second (jitter and round trip, incidents of the received sound — late, lost, overflowed and flushed packets —, regularity of the audio blocks to the speaker and from the microphone, buffer, bitrate, audio filter processing time), key figures and a **plain-words reading** ("the gap is in the received stream", "the network is clean: it is this computer"…). Measurements are taken by Baresip and by `zeaudio`; nothing leaves the Mac.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| History                        | Incoming/outgoing/missed/declined/failed, real measured duration, account, result; one-click call back, deletion, search, filters, "unread missed calls" badge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Enterprise directory           | The **Directory** tab brings together your local contacts, an **LDAP / Active Directory directory** and **Microsoft 365** (the organization's directory **and**, separately, your personal Outlook contacts): instant search that ignores accents and number separators, filters by source, department, group and favorites, a card with every number (work, mobile, internal extension, SIP) **each one callable, copyable or transferable**, personal groups. Company records are read-only, cached locally and synchronized on a schedule; an outage never empties the directory. Calls (incoming and outgoing) are **named** by the directory when the number belongs to only one person. **Mac contacts** (the Contacts app) can be added, read-only and after your permission. Setup, rights and limits: [`docs/DIRECTORY.md`](docs/DIRECTORY.md).                                                                                                                                                       |
| Shortcuts and external control | Configurable **global shortcuts** (answer, decline, hang up, mute, hold, show the keypad, search a contact, "Do not disturb"), active in all applications even with the window minimized; a settings page with keyboard capture, duplicate detection, refused combinations explained and an "active / not enabled" state; a **command line** `zephone ctl` (private per-user socket, no network port) that drives the already-open instance with structured answers; a **Stream Deck** example. Shortcuts, the menu bar menu and the command line all go through the same executor, which picks the targeted call by a documented rule and never hangs up "everything". Rules, security and limits: [`docs/CONTROL.md`](docs/CONTROL.md).                                                                                                                                                                                                                                                                      |
| Headsets and audio devices     | **Microphone, conversation output and ringtone chosen separately** (follow the system, a specific headset found again by its identifier, a fallback device), with the **device actually in use** shown as the engine confirmed it and missing choices flagged without being erased. Plugging and unplugging are followed on the system (wait for a moment of calm, 2.5 s grace period): **a call is never cut**, and **never moves to public speakers on its own without permission**; mute and hold are kept. **Headset buttons** (HID Telephony page: answer, hang up, mute, hold) interpreted according to the real state of the calls, never declining a call or acting without a ZePhone call; they can be turned off without touching the audio. Quick access to devices during a call and an **audio diagnostic** (tests started by you, never during a call). The three levels (audio, buttons, extras) and what could **not** be tried for lack of a headset: [`docs/HEADSETS.md`](docs/HEADSETS.md). |
| Local contacts                 | First name, last name, company, SIP number/URI, add/edit/delete from the directory; the contact's name is shown on incoming/outgoing calls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Settings                       | SIP accounts (detailed list), audio (volumes, recording), network (local SIP port, interface, custom TLS CA, SIP trace, engine restart, log), notifications, general (light/dark/auto theme, start at login, start minimized, menu bar icon, keep running when closed), about.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Robustness                     | Engine supervised and restarted automatically (back-off), unreachable PBX or wrong credentials without crashing, no orphan process (see [Security](#security)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Architecture

```
┌──────────────────────── ZePhone.app ─────────────────────────┐
│  Webview (React + strict TS + Tailwind + shadcn/ui + Zustand)  │
│    stores ◄── events ──┐         ▲ invoke (typed commands)      │
│                         │         │                             │
│  Rust (Tauri 2)         │         │                             │
│   commands/ ───────► SipManager ◄─┘  (all the call logic)       │
│                        │  ▲  │   ├─ SQLite (accounts*, contacts,│
│                        │  │  │   │   history, settings)         │
│                        │  │  │   └─ Keychain (passwords)        │
│                        ▼  │  ▼                                   │
│                    trait SipEngine  ◄── replaceable: FFI, other  │
│                        │                                         │
│                BaresipEngine (supervises the sidecar)            │
└────────────────────────┼─────────────────────────────────────────┘
                         │ ctrl_tcp (JSON/netstring) 127.0.0.1:<random port>
                    ┌────▼─────┐  RTP/SRTP, SIP (UDP/TCP/TLS)
                    │ baresip  │◄──────────────────────────────► PBX / carrier
                    └──────────┘  CoreAudio ◄──► microphone / speakers
```

\* without passwords.

- **The frontend knows nothing about SIP**: it sends intents (`dial`, `answer_call`, `hold_call`…) and
  receives state (`account:status`, `call:update`, `engine:state`, `history:changed`).
- **The call logic is in Rust** (`src-tauri/src/sip/manager.rs`): an incoming call is handled
  (ringtone, notification, history) even if the webview is hidden or reloaded.
- **Pure, tested state machines**: `sip/registration.rs`, `sip/calls.rs`.
- **Engine abstraction**: `sip/engine/mod.rs` (`trait SipEngine`, neutral events). Replacing Baresip
  with `libbaresip` over FFI or with another stack touches neither the manager, nor the commands, nor the UI.

```
src/                         React (app/, layouts/, features/{dialer,calls,contacts,history,recordings,settings},
                             components/arc = Arc UI, components/ui = shadcn (form fields, dock, Sona slider),
                             components/detent = Voice note player, components/orbs = OrbKit orbs,
                             components/icons = animated Lucide icons (AnimateIcons),
                             services/telephony = typed API, stores/, hooks/, types/)
src-tauri/src/
  sip/engine/                trait SipEngine, netstring, parsing of Baresip events
  sip/engine/baresip/        config, process (lifecycle), ctrl_tcp client, BaresipEngine (supervision)
  sip/{manager,calls,registration,diagnostics,uri,types}.rs
  database/                  SQLite + migrations (PRAGMA user_version)
  security/                  Keychain (keyring), masking of secrets in logs
  audio/                     device list (cpal), macOS microphone permission (objc2)
  recording/                 mixing of the two voices of a call into a WAV (streaming), waveform
  app/, commands/            Tauri glue: events, tray, notifications, invoke API
  tests/                     integration tests against the real Baresip
scripts/baresip-modules/     zeaudio: ZePhone's audio filter for Baresip (volumes, recording)
scripts/prepare-baresip.sh   prepares the relocatable sidecar for the bundle
```

## Choosing the engine

|                                   | A — `libbaresip` (C FFI)                                                                                                              | B — driven Baresip process (`ctrl_tcp`) ✅                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Integration                       | bindgen + linking libre/libbaresip/OpenSSL/modules into the Rust binary; threading ("libre is not thread-safe") to be handled by hand | self-contained binary embedded as a Tauri _sidecar_                               |
| Stability                         | a C crash takes down the whole application                                                                                            | an engine crash is isolated and the engine is **restarted** by the supervisor     |
| Getting started / macOS packaging | complex C build chain                                                                                                                 | `scripts/prepare-baresip.sh` relocates binary + dylibs + modules                  |
| Command latency                   | direct call                                                                                                                           | local TCP loop, negligible for call control (the audio does not go through Rust)  |
| Evolution                         | —                                                                                                                                     | the `SipEngine` abstraction allows moving to (A) later without rewriting the rest |

**Decision: B for v1.** A single Baresip process for the whole life of the app (never one process per call),
supervised, stopped cleanly, and controlled through the `ctrl_tcp` module (netstring framing `<len>:<json>,` —
checked in Baresip 4.13's code, not only in the docs).

Points checked in the Baresip 4.13 sources (not assumed):

- `ctrl_tcp` listens on **0.0.0.0:4444 by default, without authentication**: ZePhone forces
  `127.0.0.1:<random free port>` at each start;
- a single client connection; events have `"event": true` (the docs say `"true"`: both are accepted);
- `REGISTER_OK/FAIL` carry `"<code> <reason>"`; only the **final** result of the transaction is reported
  (the intermediate 401 is never a failure);
- `CALL_HOLD/CALL_RESUME` are only emitted for **remote** holds: the local "on hold" state is tracked on the
  Rust side;
- Baresip ignores loopback addresses for calls unless `net_interface` names them explicitly.

## Requirements

macOS 11+ (Apple Silicon or Intel), Xcode Command Line Tools, Node 20+, stable Rust.

```bash
brew install baresip rustup
rustup default stable
rustup target add x86_64-apple-darwin   # optional: Intel / universal build
npm install
```

To embed **G.722 and Opus** (missing from Baresip's Homebrew bottle):

```bash
brew install cmake pkgconf opus spandsp
npm run sidecar:hd        # builds Baresip from source (tag = libre version) then prepares the sidecar
```

Homebrew is used **only to develop**: the packaged application embeds Baresip, libre and OpenSSL
(and Opus/spandsp with the HD build) without asking anything of the end user.

## Running in development

```bash
npm run tauri dev
```

`npm run sidecar` (called automatically before `dev` and `build`) copies Baresip from Homebrew (or
`BARESIP_PREFIX=/path`) to `src-tauri/binaries/` and `src-tauri/resources/`, rewriting the library
paths (`@rpath`), then signs ad hoc. To recreate: `npm run sidecar -- --force`.

Preview of the interface **without a backend** (visual review only, no SIP communication):
`npm run dev` then open <http://localhost:1420/?mock>.

## Building the macOS application

```bash
npm run tauri build                          # .app + .dmg (macOS)
npm run tauri build -- --bundles app         # .app only
npm run tauri build -- --target universal-apple-darwin   # Apple Silicon + Intel (see below)
```

Outputs: `src-tauri/target/release/bundle/macos/ZePhone.app` and
`src-tauri/target/release/bundle/dmg/ZePhone_<version>_<arch>.dmg`.

Bundle contents: `Contents/MacOS/{zephone,baresip}`, `Contents/Frameworks/{libbaresip,libre,libssl,libcrypto}.dylib`,
`Contents/Resources/engine/{modules,sounds,licenses}`. `Info.plist` contains `NSMicrophoneUsageDescription`;
`Entitlements.plist` grants `audio-input` (hardened runtime) and `disable-library-validation` (Baresip loads its
modules with `dlopen`).

**Signing / notarization**: the local build is signed _ad hoc_ (`signingIdentity: "-"`). To distribute,
provide your Developer ID identity and the `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` variables
(see the Tauri docs); **all the Mach-O files in the bundle (sidecar, dylibs, modules) must be signed with the same
identity**. On the first launch of a non-notarized app, Gatekeeper asks for confirmation
(right-click › Open).

**Universal build**: `prepare-baresip.sh` prepares the architecture of the host machine. For a universal binary, produce
an `x86_64` Baresip/libre/OpenSSL (e.g. with a Rosetta Homebrew) and merge with `lipo`, or publish two separate builds
(one `.dmg` per architecture) — not done here.

## Using ZePhone with your PBX

1. Open ZePhone → **Settings › SIP accounts › Add**.
2. Fill in: _SIP server_ (`sip.example.com`), _Port_ (`5060` / `5061`), _Transport_, _Domain_ (if different),
   _Username_, _Authentication username_ (if different), _Password_ (typed in the application,
   stored in the Keychain, never in clear text).
3. **Add and connect**: the status becomes _Registered_ (or shows the SIP code of the error).
4. Dial a number on the **Keypad** and call; allow the microphone at the first prompt.

Limitation of Baresip's account syntax: a password cannot contain the `"` character (refused with a clear
message).

## Tests

```bash
# Rust: unit tests (states, parsing, validation, database, scripted manager) — need nothing
cd src-tauri && cargo test --lib

# Rust: end to end against the REAL Baresip (needs `npm run sidecar`; ausine/aufile test modules of the local Baresip)
npm run test:e2e

# Rust: interoperability against a REAL PBX (FreeSWITCH started on the fly, loopback, random password, cleaned up afterwards)
brew install freeswitch && npm run test:pbx

# Frontend
npm run typecheck && npm run lint && npm test && npm run build
```

What the integration tests cover (no engine mock):

- sidecar start, version/codecs (including Opus and G.722 if embedded), control port **on loopback only**,
  no `accounts` file;
- shutdown without orphan processes; automatic restart after the engine is `SIGKILL`ed;
- registration through a test registrar with a **Digest 401 challenge** (then 200), wrong password → **401**,
  403, 503, TCP connection refused; no password in the logs;
- **a real call between two Baresip instances** with RTP: a 440 Hz sine and an 880 Hz sine are sent, received and written
  to WAV on both sides (two-way audio measured, in Opus), DTMF, hold/resume, mute, hang up, 603 decline;
- **call statistics** (`zestats`): codec, packets in both directions, jitter buffer and regularity of the audio blocks read on two real engines during a call; recording on both sides never holds up the audio threads (filter time measured, no sample lost);
- **enterprise directory**: LDAP reading against a **real OpenLDAP** (`slapd` on loopback, LDAPS with a throwaway certificate and verification, StartTLS, paging, access rights, wrong password, outage then recovery, deletion and update followed, favorites and groups kept); the Microsoft connector against a local **stand-in service** (OAuth + PKCE, Graph, delta, rate limiting) — see what this does not prove in [`docs/DIRECTORY.md`](docs/DIRECTORY.md);
- **audio devices and headsets**: changing the microphone, the output, during hold, after a mute and with a refused device, **in the middle of a real call** between two Baresip engines (the signal is measured: mute stays muted, the new source is the one the other side hears, the new output does receive the voice) — `tests/audio_e2e.rs`; the logic for choosing, unplugging and interpreting buttons is simulated and says so — see what was not tried without a headset in [`docs/HEADSETS.md`](docs/HEADSETS.md);
- **external control**: the actions (answer, decline, hang up, mute, hold, dial, "Do not disturb") driven only by the common executor and by the private socket on **real calls** between two Baresip engines, with the state confirmed by the engine (`tests/control_e2e.rs`); the global shortcut actually pressed from the system is described in [`docs/CONTROL.md`](docs/CONTROL.md);
- a full `SipManager` (real engine + SQLite): statuses, outgoing/incoming call, missed, declined, history, contact name,
  notifications;
- **FreeSWITCH (real third-party PBX)**: Digest registration, wrong password → `403 Forbidden`, outgoing call to an extension by
  its number, audio in both directions relayed by the PBX, DTMF, hold/resume, incoming call with the contact's name, **blind transfer (REFER)**
  to a 3rd extension, missed call;
- the audio device names listed by the UI are accepted by Baresip (CoreAudio) and an unknown name is refused.

Checked by hand on the packaged application (debug and release): start, sidecar launch, `127.0.0.1` connection, files in
`0600/0700`, quitting with ⌘Q (Apple event) / `SIGTERM` / `SIGKILL` **without an orphan process**; `.dmg` verified (`hdiutil verify`)
and ad hoc signature valid after mounting.

## Security

- SIP passwords: **macOS Keychain** (`keyring`) — no password column in the database, `SecretString` on the Rust side,
  systematic masking (`auth_pass=***`) in logs and error messages.
- No configuration file containing credentials: accounts are created in memory in Baresip through
  the local control socket. The engine folder is `0700`, the files `0600`.
- `ctrl_tcp`: `127.0.0.1` only, random port, **never exposed to the frontend** (minimal Tauri capabilities:
  `core:default`, no shell/fs/http plugin for the webview). Known limit: `ctrl_tcp` has no
  authentication; a local process of the same user could connect to it.
- Strict validation of inputs before anything is sent to the engine (`sip/uri.rs`): spaces, `;`, `"`, `<>` and line breaks are refused.
- TLS certificate verification **always on** (`sip_verify_server yes`); system CAs, plus an optional PEM file.
- Strict CSP in the webview; no telemetry.
- Engine lifecycle: graceful stop (hangup → unregister → `quit`), cleanup on ⌘Q, `SIGTERM/INT/HUP`,
  watchdog for `SIGKILL`/crash (macOS/Linux), cleanup of a stale instance at the next start.
- Baresip opens SIP listeners (UDP/TCP) on the local interfaces to receive calls, like any softphone;
  this is inherent to receiving calls (use a firewall or "Local interface" in Network to restrict it).

## Windows

ZePhone starts and runs its SIP engine on Windows 10/11 (x64). Tested here: the application starts, Baresip is
supervised and loads its modules (G.711, Opus, SRTP, VU meter, `zeaudio`, WASAPI) and finds the microphone and the
speakers. A call with a real PBX has **not** been tried on Windows.

Requirements: Node 20+, [Rust](https://rustup.rs) (MSVC toolchain), CMake, Git, and the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++"
workload. With [Scoop](https://scoop.sh) and winget:

```powershell
scoop install rustup-msvc cmake
rustup default stable
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
npm install
npm run tauri dev
```

There is no ready-made Baresip for Windows, so `npm run sidecar` (run automatically by `tauri dev` / `tauri build`) **builds it
once** with [`scripts/build-baresip.ps1`](scripts/build-baresip.ps1): OpenSSL and Opus come from vcpkg (cloned into
`.baresip-build/`), then libre, Baresip and the `zeaudio` module are compiled with CMake. The first run takes several minutes.
Differences with macOS:

- Baresip is built **statically**: the modules are inside `baresip.exe`. The `modules/*.dll` files in the resources are empty
  markers telling the application which modules exist.
- Audio goes through the WASAPI module, which opens devices by **endpoint id** (not by name): ZePhone uses the id as the device
  identity on Windows.
- `getopt` (missing from MSVC) is provided by a small header patched in at build time: without it Baresip ignores `-f <config>`.
- **G.722 is not available** (its module needs spandsp, which vcpkg does not provide); G.711 and Opus are.

Not done on Windows yet: the anti-orphan watchdog (a `KILL_ON_JOB_CLOSE` Job Object — a normal quit or Ctrl-C cleans up), the
`zephone ctl` command line and its socket, headset buttons, system contacts, and a default CA bundle for SIP over TLS (set a
custom CA in Settings → Network for a private PBX). `tauri build` produces the `.msi` / `.exe` installers.

## Linux

The Rust code is portable (audio driver, module extension, paths, keychain selected by `cfg`). What remains is providing the sidecar:

1. **Get/build Baresip** (the `baresip` package or a CMake build) with the modules `g711`, `auconv`, `auresamp`, `srtp`, `menu`,
   `ctrl_tcp`, an audio driver (`alsa`/`pulse`/`pipewire`) and if possible `g722`, `opus`.
2. **Name the binary** `src-tauri/binaries/baresip-<triple>` (`x86_64-unknown-linux-gnu`…, see `rustc -vV`), copy the modules to
   `src-tauri/resources/baresip/{modules,sounds,licenses}` and the shared libraries in `rpath` (`$ORIGIN/../lib/zephone`).
3. Build dependencies: `libwebkit2gtk-4.1-dev`, `libdbus-1-dev`, `libasound2-dev`; the keychain goes through Secret Service.
4. `tauri build` then produces `.deb` / `.AppImage`.

**This part has not been run here.**

## Known limits

- **Recording a call may require the other person's consent** (depending on the country): recording is automatic but purely local, and can be turned off in Settings → Audio; it is up to you to inform the people you talk to. Only one call is recorded at a time; the files are mono WAVs (≈ 115 MB per hour at 16 kHz), uncompressed.
- **Checked with the real engine, not in the real window**: recording of both voices and the volumes are tested with two real Baresip engines (synthetic voices, complete files, amplitude divided by 2 at 50%, silence at 0%); the opening of the call window, the recordings player and the menu have only been seen in the browser preview (`npm run dev`, `/?mock`, `/?mock&window=call`) — test them with a real call.
- **Components**: [Arc UI](https://uiarc.dev) components (dialogs, standard buttons, switches, badges, tabs — the same in history and settings —, menu, popover) are used wherever their API allows; form fields (input, dropdown, label), custom-styled buttons (call buttons, icons) and the dock stay in shadcn / in-house components. Notifications use [Ding](https://ding.yusufcengiz.dev).
- **OrbKit orbs**: only the 14 MIT-licensed orbs are embedded. The other 19 are ports of @XorDev shaders, reserved for **non-commercial** use with attribution: they are not included (see `src/components/orbs/README.md` to add them in a personal build). The orbs are WebGL shaders: the heaviest (volumetric) costs GPU, the resolution is capped at 1.5×; WebGL has only been checked in the browser preview, not in the app's WKWebView window.
- **Translucent background**: it uses Tauri's private `macOSPrivateApi` API (transparent window + `NSVisualEffectView`), incompatible with the Mac App Store; it is not the native "Liquid Glass" material of macOS 26 but the classic transparency effect. It is ignored on Windows/Linux.
- **Voice dropouts**: the `zeaudio` module no longer writes to disk or takes a lock in the audio threads (that was a real, measured defect: the filter could hold a 20 ms block for more than 10 ms). Advanced statistics say where a dropout is (received stream, buffer, this Mac's audio blocks); they see neither the remote service before it sends, nor the speaker after playback.
- **Mac contacts**: reading is written with Apple's Contacts framework and tested without touching any contact; it has not been exercised on real contacts (it asks for your permission in the installed application). Only macOS is supported for now (iOS, Android, Windows, Linux: see [`docs/DIRECTORY.md`](docs/DIRECTORY.md)).
- **Enterprise directory**: the LDAP connector is checked against a real OpenLDAP, not against an Active Directory; the **Microsoft 365 connector is implemented but could not be validated without a real tenant** (it needs an application registration, an account and, for the full directory, an administrator's consent) — it is tested against a stand-in service. No presence (availability) is shown: ZePhone does not receive any. LDAP rereads everything at each synchronization (no delta); contacts changed in a source are read-only.
- **Not verified without real hardware/server**: capture/playback on the real microphone and speakers during a call
  (the tests use synthetic audio sources/sinks; the selection of CoreAudio devices and the microphone permission
  are verified, though); the display of the microphone prompt and the TCC attribution to the Baresip subprocess on a **clean first
  launch**, the native macOS notification, the ringtone on the speaker, a real VoIP carrier, TLS with a real certificate.
- **Codecs**: Baresip's Homebrew bottle only provides G.711; Opus and G.722 come from `npm run sidecar:hd`. G.722 relies
  on **spandsp (LGPL-2.1, dynamically linked, unmaintained project)**: see `THIRD_PARTY_NOTICES.md`. Without these modules the application
  automatically falls back to G.711.
- **Transfer**: blind transfer (REFER); no attended transfer in the interface. One outgoing call at a time while it is being set up.
- **NAT**: no configurable STUN/TURN/ICE in the v1 UI (modules are available in Baresip).
- **Video, instant messaging, presence, BLF**: out of scope.
- **A single `ctrl_tcp` client** at a time (Baresip limitation) and **no authentication** on this channel (see Security).
- Universal macOS build, notarization, Windows, Linux: documented, not run.
- SIP password containing `"`: not supported (limitation of Baresip's address syntax).

## Logo

The logo takes up the **Zenoova** mark (two overlapping shapes, one outlined, the other solid, with a thin
line where they cross), but the two circles are replaced by two of the SIP account avatars
([Blobatar](https://blobatar.dev)), in black and white only: a light version (the application's) and a
dark version. The faces are drawn from fixed names, not from an account: the logo is the same for everyone.
`node scripts/make-logo.mjs` regenerates the SVGs; icons of all sizes are derived from it with
`npx tauri icon src-tauri/icons/source/zephone-logo-1024.png` (the PNG can be obtained with any SVG
rasterizing tool).

## Licenses

ZePhone embeds:

- **Baresip** and **libre** — BSD-3-Clause;
- **OpenSSL** (`libssl`/`libcrypto`) — Apache-2.0;
- Baresip is built with **two one-line changes** (`scripts/build-baresip.sh`): the `vumeter` module reports audio levels every 60 ms instead of 500 ms, and the jitter buffer keeps its counters (lost, late, flushes…) in the production build, where Baresip disables them, plus the in-house `zeaudio` module (`scripts/baresip-modules/zeaudio`, BSD-3);
- **Opus** (BSD-3-Clause) and **spandsp** for G.722 (LGPL-2.1, dynamic), plus their dependencies (libtiff, libjpeg-turbo, libwebp, xz, zstd);
- G.711 is built into Baresip.

The license texts are in the bundle's `Contents/Resources/engine/licenses/` (`MANIFEST.txt` lists the versions).
See also [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). **No license is declared yet for ZePhone's own code.** The Rust/JS dependencies (Tauri, React, shadcn/ui, Radix, Tailwind, rusqlite,
keyring, cpal…) are under MIT / Apache-2.0 licenses.
