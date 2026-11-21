# Releasing ZePhone

A release is a push to the **`stable`** branch. Everything else is automatic.

```bash
git push origin main:stable        # or merge main into stable
```

`.github/workflows/release.yml` then:

1. reads the **Conventional Commits** made since the last release tag and decides the next version
   (`scripts/next-version.mjs`): `feat` bumps the minor, `fix` and `perf` the patch, a breaking change (`feat!:` or a
   `BREAKING CHANGE:` footer) the major (the minor while the version is still `0.y.z`). `docs`, `chore`, `ci`, `test`,
   `build`, `refactor` and `style` never release on their own: if there is nothing to release, nothing happens;
2. writes the version into `package.json`, `tauri.conf.json`, `Cargo.toml` and the lock files, adds the release to
   `CHANGELOG.md`, and commits that to `stable` as `chore(release): vX.Y.Z`: the application carries the version and the
   tag points at that commit. (The first release is the version the files already carry.)
3. builds every installer from that commit, attaches them to a GitHub Release (notes grouped by Features, Fixes,
   Performance and Breaking changes), and publishes it;
4. calls `.github/workflows/distribute.yml`, which sends it to the stores and package managers.

Commit messages therefore matter: `feat(calls): add transfer` and `fix: crash on hang up` make a release, `docs: ...`
does not.

To **test the builds without publishing anything**, run the _Release_ workflow by hand from the Actions tab on any
branch: it builds a draft release, commits nothing and publishes nothing. Give a version to build that one, or leave it
empty to follow the commits.

## What a release produces

| File | Built on | Where it goes |
|---|---|---|
| `.dmg` (Apple silicon, Intel), signed with Developer ID and notarized | macOS | GitHub Release, Homebrew |
| `.msi`, `.exe` (not signed) | Windows | GitHub Release, winget, Chocolatey, Scoop |
| `.deb`, `.rpm`, `.AppImage` (x64 and arm64) | Linux | GitHub Release, apt, dnf and pacman (x86_64) repositories, AUR |
| `.apk` (signed) and `.aab` | Linux | GitHub Release (APK), Google Play (AAB) |
| iOS app | macOS | TestFlight |
| `.pkg` for the Mac App Store (Apple silicon, sandboxed; when `ENABLE_MAS` is on) | macOS | App Store Connect |

## The channels

A channel runs only when its switch is on: a repository **variable** `ENABLE_<CHANNEL>` set to `true`.

| Channel | Switch | Needs | State |
|---|---|---|---|
| GitHub Release | always | – | ready |
| Google Play (internal testing, draft) | `ENABLE_PLAY` | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | on |
| TestFlight | always (iOS job) | `APPLE_*` secrets | on |
| Homebrew tap `Zenoova/homebrew-zephone` | `ENABLE_HOMEBREW` | `HOMEBREW_TAP_DEPLOY_KEY` | on |
| Scoop bucket `Zenoova/scoop-zephone` | `ENABLE_SCOOP` | `SCOOP_BUCKET_DEPLOY_KEY` | on |
| apt, dnf and pacman repositories (GitHub Pages) | `ENABLE_LINUX_REPOSITORIES` | `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` | on |
| Arch User Repository (`zephone-bin`) | `ENABLE_AUR` | `AUR_SSH_PRIVATE_KEY`, and an account on aur.archlinux.org with the matching public key | off |
| Snap Store | `ENABLE_SNAP` | `SNAPCRAFT_STORE_CREDENTIALS` (`snapcraft export-login`) | off |
| winget | `ENABLE_WINGET` | `WINGET_TOKEN` (classic token, `public_repo`), and a first version submitted by hand | off |
| Chocolatey | `ENABLE_CHOCOLATEY` | `CHOCOLATEY_API_KEY` | off |
| Microsoft Store, Samsung Galaxy Store, Huawei AppGallery, Aptoide | – | accounts being verified, or an app entry to create first | not written yet |
| Mac App Store | `ENABLE_MAS` | `APPLE_MAS_APPLICATION_CERTIFICATE`, `APPLE_MAS_INSTALLER_CERTIFICATE`, `APPLE_MAS_PROVISIONING_PROFILE` (see [MAC-APP-STORE.md](MAC-APP-STORE.md)) | off, needs the portal steps |

## Secrets and variables

| Name | Kind | What |
|---|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | secret | Developer ID Application certificate (`.p12`) |
| `APPLE_SIGNING_IDENTITY` | variable | its name |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | secret | App Store Connect API key (notarization, TestFlight) |
| `APPLE_TEAM_ID` | variable | `3RWC6787PS` |
| `APPLE_IOS_DISTRIBUTION_CERTIFICATE`, `APPLE_IOS_PROVISIONING_PROFILE` | secret | iOS distribution certificate and App Store profile |
| `APPLE_MAS_APPLICATION_CERTIFICATE`, `APPLE_MAS_INSTALLER_CERTIFICATE`, `APPLE_MAS_PROVISIONING_PROFILE` | secret | Mac App Store: application certificate, installer certificate (both `.p12`, password `APPLE_CERTIFICATE_PASSWORD`), profile (base64) |
| `APPLE_MAS_APP_IDENTITY`, `APPLE_MAS_INSTALLER_IDENTITY` | variable | their names; optional, read from the certificates when empty |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` | secret | Android upload key |
| `ANDROID_KEY_ALIAS` | variable | `upload` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | secret | service account that may release to testing tracks |
| `ZEPHONE_SENTRY_DSN`, `ZEPHONE_GA_MEASUREMENT_ID` | variable | diagnostics identifiers (see [PRIVACY.md](PRIVACY.md)) |
| `ZEPHONE_GA_API_SECRET` | secret | Google Analytics Measurement Protocol secret |
| `HOMEBREW_TAP_DEPLOY_KEY`, `SCOOP_BUCKET_DEPLOY_KEY` | secret | SSH deploy keys with write access to the tap and the bucket |
| `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` | secret | key that signs the apt, dnf and pacman repositories |
| `AUR_SSH_PRIVATE_KEY` | secret | SSH key of the AUR account |

The signing keys were generated outside the Keychain and are kept in `~/.zephone-signing` on the maintainer's machine:
keep a copy in a password manager, because GitHub never shows a secret again.

## Install, for users

See [INSTALL.md](INSTALL.md).

## Known limits

- Windows installers are **not signed**: SmartScreen warns on first launch. winget and Chocolatey may flag them.
- The Play upload is a **draft** on the _internal_ track until the app has been released once from the Play Console.
- Each iOS build asks App Store Connect for the export-compliance answer (the app uses TLS and SRTP).
- apt and dnf repositories keep the three newest versions; older ones stay on the GitHub Release.
