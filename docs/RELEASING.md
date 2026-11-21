# Releasing ZePhone

A release is a tag. Everything else is automatic.

```bash
git tag v1.2.3 && git push origin v1.2.3
```

`.github/workflows/release.yml` then builds every installer, attaches them to a GitHub Release, publishes it, and calls
`.github/workflows/distribute.yml`, which sends it to the stores and package managers. The version of every installer
is the tag's (`scripts/set-version.mjs` writes it into `package.json`, `tauri.conf.json` and `Cargo.toml` for the
build). To **test the builds without publishing anything**, run the _Release_ workflow by hand from the Actions tab
with a version: it creates a draft release only.

## What a release produces

| File | Built on | Where it goes |
|---|---|---|
| `.dmg` (Apple silicon, Intel), signed with Developer ID and notarized | macOS | GitHub Release, Homebrew |
| `.msi`, `.exe` (not signed) | Windows | GitHub Release, winget, Chocolatey, Scoop |
| `.deb`, `.rpm`, `.AppImage` (x64 and arm64) | Linux | GitHub Release, apt and dnf repositories |
| `.apk` (signed) and `.aab` | Linux | GitHub Release (APK), Google Play (AAB) |
| iOS app | macOS | TestFlight |

## The channels

A channel runs only when its switch is on: a repository **variable** `ENABLE_<CHANNEL>` set to `true`.

| Channel | Switch | Needs | State |
|---|---|---|---|
| GitHub Release | always | – | ready |
| Google Play (internal testing, draft) | `ENABLE_PLAY` | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | on |
| TestFlight | always (iOS job) | `APPLE_*` secrets | on |
| Homebrew tap `Zenoova/homebrew-zephone` | `ENABLE_HOMEBREW` | `HOMEBREW_TAP_DEPLOY_KEY` | on |
| Scoop bucket `Zenoova/scoop-zephone` | `ENABLE_SCOOP` | `SCOOP_BUCKET_DEPLOY_KEY` | on |
| apt and dnf repositories (GitHub Pages) | `ENABLE_LINUX_REPOSITORIES` | `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` | on (Pages must be enabled on `gh-pages`) |
| Snap Store | `ENABLE_SNAP` | `SNAPCRAFT_STORE_CREDENTIALS` (`snapcraft export-login`) | off |
| winget | `ENABLE_WINGET` | `WINGET_TOKEN` (classic token, `public_repo`), and a first version submitted by hand | off |
| Chocolatey | `ENABLE_CHOCOLATEY` | `CHOCOLATEY_API_KEY` | off |
| Microsoft Store, Samsung Galaxy Store, Huawei AppGallery, Aptoide | – | accounts being verified, or an app entry to create first | not written yet |
| Mac App Store | – | the sandbox (the engine is a helper process), certificates and a profile | not started |

## Secrets and variables

| Name | Kind | What |
|---|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | secret | Developer ID Application certificate (`.p12`) |
| `APPLE_SIGNING_IDENTITY` | variable | its name |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | secret | App Store Connect API key (notarization, TestFlight) |
| `APPLE_TEAM_ID` | variable | `3RWC6787PS` |
| `APPLE_IOS_DISTRIBUTION_CERTIFICATE`, `APPLE_IOS_PROVISIONING_PROFILE` | secret | iOS distribution certificate and App Store profile |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` | secret | Android upload key |
| `ANDROID_KEY_ALIAS` | variable | `upload` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | secret | service account that may release to testing tracks |
| `ZEPHONE_SENTRY_DSN`, `ZEPHONE_GA_MEASUREMENT_ID` | variable | diagnostics identifiers (see [PRIVACY.md](PRIVACY.md)) |
| `ZEPHONE_GA_API_SECRET` | secret | Google Analytics Measurement Protocol secret |
| `HOMEBREW_TAP_DEPLOY_KEY`, `SCOOP_BUCKET_DEPLOY_KEY` | secret | SSH deploy keys with write access to the tap and the bucket |
| `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` | secret | key that signs the apt and dnf repositories |

The signing keys were generated outside the Keychain and are kept in `~/.zephone-signing` on the maintainer's machine:
keep a copy in a password manager, because GitHub never shows a secret again.

## Install, for users

See [INSTALL.md](INSTALL.md).

## Known limits

- Windows installers are **not signed**: SmartScreen warns on first launch. winget and Chocolatey may flag them.
- The Play upload is a **draft** on the _internal_ track until the app has been released once from the Play Console.
- Each iOS build asks App Store Connect for the export-compliance answer (the app uses TLS and SRTP).
- apt and dnf repositories keep the three newest versions; older ones stay on the GitHub Release.
