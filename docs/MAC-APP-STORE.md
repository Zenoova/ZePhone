# ZePhone on the Mac App Store

The Mac App Store build is **not** the Developer ID one that ships as a `.dmg`. It is sandboxed, signed with the
store's certificates, carries a provisioning profile and goes to App Store Connect in an installer package. Both builds
come from the same sources; nothing of the Developer ID build changed (`src-tauri/Entitlements.plist` is untouched).

The automation is written and switched off (`ENABLE_MAS`). What is left is the portal work only you can do: see
[the checklist](#what-you-do-by-hand).

## What differs from the `.dmg` build

| | Developer ID (`.dmg`) | Mac App Store |
|---|---|---|
| Entitlements | `src-tauri/Entitlements.plist`: hardened runtime, `disable-library-validation` | `src-tauri/Entitlements.mas.plist` (the application) and `Entitlements.mas.inherit.plist` (the engine) |
| Sandbox | no | yes (`com.apple.security.app-sandbox`) |
| Signed with | Developer ID Application | the store's application certificate, plus **Mac Installer Distribution** for the package |
| Profile | none | Mac App Store provisioning profile, embedded as `Contents/embedded.provisionprofile` |
| Output | `.dmg`, notarized | `.pkg`, checked and uploaded with `xcrun altool` (no notarization: Apple reviews it) |
| Translucent window | yes | **no**, the windows are opaque (the private macOS API behind it is refused by the store) |
| Architectures | Apple silicon and Intel | **Apple silicon only** (the engine is built for one architecture) |
| Built by | `desktop` job of `release.yml` | `mas` job of `release.yml`, `scripts/build-mas.sh`, `scripts/sign-mas.sh` |

### The entitlements

`Entitlements.mas.plist` (the application):

| Entitlement | Why |
|---|---|
| `com.apple.security.app-sandbox` | required by the store |
| `com.apple.security.network.client` | SIP signalling, RTP/SRTP, TLS to the PBX, LDAP, Microsoft 365, diagnostics |
| `com.apple.security.network.server` | the sockets the engine listens on (SIP over TCP, incoming media) and the loopback redirect of the Microsoft sign-in |
| `com.apple.security.device.audio-input` | microphone (the engine is covered by the same grant) |
| `com.apple.security.personal-information.addressbook` | "Contacts du Mac" source, read-only |
| `com.apple.security.device.usb` | the buttons of USB call-control headsets (`IOHIDManager`); **not exercised** here, no headset on the test Mac |

Not needed, so not asked for: `application-groups`, `files.user-selected.*` (the application has no file dialog),
`bluetooth`, `cs.disable-library-validation`, any `temporary-exception`.
`com.apple.application-identifier` and `com.apple.developer.team-identifier` are added to the signed copy by
`scripts/sign-mas.sh` when a profile is given (macOS refuses to start a program that claims them without one, so they
are not in the committed file).

`Entitlements.mas.inherit.plist` (the engine, `Contents/MacOS/baresip`) holds only `app-sandbox` and
`com.apple.security.inherit`: the sandbox kills a helper that inherits and asks for anything else.

## Does the Baresip child process run in the sandbox?

**Yes.** Checked on this Mac, ad hoc signed, with the sandbox really on:

- The application starts the engine (`Contents/MacOS/baresip`) as a child process. With `inherit` it runs inside the
  application's sandbox and has its network and microphone rights. It loads its modules with `dlopen` from
  `Contents/Resources/engine/modules/*.so` and its libraries from `Contents/Frameworks/*.dylib`: inside the bundle, which the
  sandbox lets a program read and map.
- **A real call**: the real engine code (`SipManager` + `BaresipEngine` + SQLite) in a sandboxed bundle registered
  to a throw-away FreeSWITCH on 127.0.0.1, called another extension, the other side answered, and audio went both ways
  (ZePhone heard 29 164 bytes, the other phone 96 044). The identical test without the sandbox gives the same numbers.
- **The control port stays on the loopback.** The config the engine reads has `ctrl_tcp_listen 127.0.0.1:<random port>`; with
  the real sandboxed application, the only socket of `ctrl_tcp` is `127.0.0.1:52065` (`lsof`), and the application
  drove the engine through it.
- **Paths are in the container.** Under the sandbox `HOME` is
  `~/Library/Containers/<bundle id>/Data`: the database, the engine's `config` and `baresip.pid`, the logs and the recordings are
  there, and nothing was written elsewhere. The modules and the sounds are read from the bundle.
- **The keychain works** (a sandboxed program creating, reading and deleting a generic password in the login keychain,
  which is how `keyring` stores the SIP passwords).

### `disable-library-validation` is not needed

Library validation only applies when the **hardened runtime** is on. The Developer ID build has it (notarization needs
it), and there the modules, which Homebrew or the build signs ad hoc, would be refused: hence the exception in
`Entitlements.plist`. Observed here: with the hardened runtime on and everything ad hoc, the engine does not start.

The Mac App Store does not require the hardened runtime, and the store build does not turn it on
(`MAS_HARDENED=1` in `sign-mas.sh` does, for a test). Besides, `sign-mas.sh` signs **every** Mach-O file of the bundle
(libraries, modules, the engine, the application), from the inside out, with the **same identity**, so even with the hardened runtime
on, everything shares one Team ID and library validation lets the engine load its modules. Nothing is signed with
`--deep`.

Sandbox-and-hardened-runtime together **with a real Team ID** could not be run here: that needs a trusted
signing identity, which would mean touching the Keychain (see [what is not verified](#what-is-not-verified)).

## Things that do not work in the sandbox (and what ZePhone does)

| Feature | In the store build |
|---|---|
| `zephone ctl`, Stream Deck, the control socket | **Off.** The default path (`~/Library/Application Support/com.zenoova.zephone/control.sock` inside the container) is 129 bytes, more than the 100 a Unix socket allows: the application logs `control socket not started: socket path too long` and carries on. Making it work takes an App Group (short path in `~/Library/Group Containers/<team>.…`), i.e. the `application-groups` entitlement, a portal capability and a code change; not done. |
| Start at login (Settings → General) | **Not working yet.** `tauri-plugin-autostart` writes a LaunchAgent, which a sandboxed application cannot install. The store way is `SMAppService.mainApp` (macOS 13+). Not done; until then the toggle should be hidden in this build. |
| Translucent background | Off: the windows are opaque. The `translucent` setting does nothing. How the opaque windows look has **not been seen** (the screen could not be captured here). |
| Auto-update | none in ZePhone; the store updates the application. |

## What is not verified

- Anything that needs the real certificates: the signature by the store identity, the embedded profile, the
  `.pkg` signature, `altool --validate-app`, App Review. The CI job runs the validation on every manual run, so the first
  run tells.
- Hardened runtime plus a real Team ID (above).
- The USB headset buttons, the microphone and the contacts in the sandbox (the entitlements are there; no prompt was
  answered). The tests used synthetic audio.
- The look of the opaque windows; the start-at-login toggle; Intel Macs (arm64 only).
- `ITSAppUsesNonExemptEncryption` is **not** set in `Info.plist`: ZePhone uses TLS and SRTP, so App Store Connect asks
  the export-compliance question for every build (as TestFlight does for iOS).

## What you do by hand

Everything in the portal, once. Nothing here needs the Keychain: use `openssl`, like for the iOS key. Do not paste
passwords or the `.p8` in a chat.

### 1. Certificates (developer.apple.com → Certificates, IDs & Profiles → Certificates → +)

1. **The application's certificate.** Either:
   - reuse the **Apple Distribution** certificate of the iOS build (`~/.zephone-signing/ios-distribution.p12`): Apple
     accepts it for Mac App Store applications, and it needs nothing new; or
   - create a **Mac App Distribution** one (formerly "3rd Party Mac Developer Application").
2. **Mac Installer Distribution** (formerly "3rd Party Mac Developer Installer"): signs the `.pkg`. Create it with a
   key of your own:

   ```bash
   cd ~/.zephone-signing
   openssl req -new -newkey rsa:2048 -nodes -keyout mas-installer.key -out mas-installer.csr \
     -subj "/CN=ZePhone Mac Installer/O=ZePhone/C=FR"
   ```

   Upload `mas-installer.csr`, download the `.cer`, then:

   ```bash
   openssl x509 -inform der -in mac_installer.cer -out mas-installer.pem
   openssl pkcs12 -export -legacy -inkey mas-installer.key -in mas-installer.pem -out mas-installer.p12
   ```

   Give the `.p12` **the same password** as the others (`APPLE_CERTIFICATE_PASSWORD` is used for all of them); drop
   `-legacy` if your OpenSSL is not 3.x. If you created a Mac App Distribution certificate in 1, make its `.p12` the
   same way, with its own key.

### 2. The App ID

Identifiers → `com.zenoova.zephone` (it exists, the iOS app uses it). Check that macOS is among its platforms. **No capability
is needed**: the sandbox entitlements are not portal capabilities. Do **not** add App Groups (nothing uses them).

### 3. The provisioning profile

Profiles → + → **Distribution** → **Mac App Store Connect** → App ID `com.zenoova.zephone` → the application
certificate of 1 → name it `ZePhone Mac App Store` → download the `.provisionprofile`. (It lasts a year, like the
certificates: renew it and the secret.)

### 4. GitHub secrets and variables

```bash
base64 -i ~/.zephone-signing/ios-distribution.p12 | gh secret set APPLE_MAS_APPLICATION_CERTIFICATE   # or your Mac App Distribution .p12
base64 -i ~/.zephone-signing/mas-installer.p12     | gh secret set APPLE_MAS_INSTALLER_CERTIFICATE
base64 -i ~/Downloads/ZePhone_Mac_App_Store.provisionprofile | gh secret set APPLE_MAS_PROVISIONING_PROFILE
gh variable set ENABLE_MAS --body true
```

`APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8`, `APPLE_CERTIFICATE_PASSWORD` and the variable `APPLE_TEAM_ID`
already exist and are reused. The identities' names are read from the certificates; set the variables
`APPLE_MAS_APP_IDENTITY` and `APPLE_MAS_INSTALLER_IDENTITY` only if the job picks the wrong one.

### 5. App Store Connect (the macOS 1.0 version is still empty)

- Texts, keywords, screenshots (Mac sizes), support and marketing URLs: [STORE-LISTING.md](STORE-LISTING.md).
- Privacy policy URL, and the "App Privacy" answers: [PRIVACY.md](PRIVACY.md) (Sentry and GA4 diagnostics; no call data).
- Category Productivity, age rating, price, availability.
- **Notes for App Review: give a SIP account that works** (server, user, password): without one the reviewer sees an empty phone.
- Export compliance: the application uses encryption (TLS, SRTP) and answers the standard exemption questions.
- Once a build has been processed, select it on the version and submit for review.

### 6. First run

Run the _Release_ workflow by hand (Actions → Release → Run workflow, give a version): the `mas` job builds, signs,
packages and has Apple **validate** the package, but sends nothing. Fix what it reports, then push to `stable`: the
same job uploads the build, which appears in App Store Connect after processing.

## Trying the sandbox on this Mac

```bash
npm run sidecar:hd                 # or `npm run sidecar`, to try with the Homebrew engine
scripts/build-mas.sh --debug       # ad hoc signed, sandboxed: dist-mas/ stays empty without the installer identity
```

The application it prints lives in `src-tauri/target/<triple>/debug/bundle/macos/ZePhone.app`. A sandboxed copy
makes its own container named after the bundle identifier: to keep your real data apart, change `CFBundleIdentifier` in
a copy and run `MAS_APP_IDENTITY=- scripts/sign-mas.sh <copy>`. `ZEPHONE_CONTROL_SOCKET=<short path in the container>`
brings the control socket back for the test.
