#!/usr/bin/env bash
# Builds ZePhone for the Mac App Store: the application without the private macOS API, signed with the sandbox
# entitlements, and (when MAS_INSTALLER_IDENTITY is set) the installer package the store takes.
#
#   scripts/build-mas.sh [--debug]
#
# Needs the engine (npm run sidecar:hd, or npm run sidecar) and the variables of scripts/sign-mas.sh.
# MAS_BUILD_NUMBER is the build number of the store (CFBundleVersion), which must grow with every upload.
# The result is in dist-mas/. Without MAS_APP_IDENTITY the application is signed ad hoc and no package is made: that
# is enough to try the sandbox on this Mac.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
profile=release
tauri_args=()
if [[ "${1:-}" == "--debug" ]]; then profile=debug; tauri_args+=(--debug); fi

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
[[ "$TRIPLE" == *apple-darwin ]] || { echo "the Mac App Store build is made on a Mac" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The configuration of the store build is the normal one, minus what the store refuses: the private API behind
# the translucent window (the windows are opaque), and the Developer ID entitlements. Tauri signs ad hoc;
# sign-mas.sh signs for real afterwards, file by file.
node - "$ROOT/src-tauri/tauri.conf.json" "$WORK/tauri.mas.json" "${MAS_BUILD_NUMBER:-1}" <<'JS'
const fs = require("node:fs");
const [src, out, build] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(src, "utf8"));
c.app.macOSPrivateApi = false;
for (const w of c.app.windows) w.transparent = false;
c.bundle.macOS = { ...c.bundle.macOS, signingIdentity: "-", entitlements: "Entitlements.mas.plist", bundleVersion: build };
fs.writeFileSync(out, JSON.stringify(c));
JS

# Tauri's build script insists that the `macos-private-api` feature of the `tauri` dependency and the configuration
# agree: the feature is taken out of the manifest for this build only.
cp src-tauri/Cargo.toml "$WORK/Cargo.toml"
trap 'cp "$WORK/Cargo.toml" "$ROOT/src-tauri/Cargo.toml"; rm -rf "$WORK"' EXIT
sed -i.bak 's/"macos-private-api", //' src-tauri/Cargo.toml && rm -f src-tauri/Cargo.toml.bak
grep -q 'macos-private-api' src-tauri/Cargo.toml && { echo "the private API is still in Cargo.toml" >&2; exit 1; }

npx tauri build --bundles app --target "$TRIPLE" --config "$WORK/tauri.mas.json" ${tauri_args[@]+"${tauri_args[@]}"}

APP="$ROOT/src-tauri/target/$TRIPLE/$profile/bundle/macos/ZePhone.app"
[[ -d "$APP" ]] || APP="$ROOT/src-tauri/target/$profile/bundle/macos/ZePhone.app"
[[ -d "$APP" ]] || { echo "ZePhone.app was not built" >&2; exit 1; }

mkdir -p dist-mas
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
export MAS_APP_IDENTITY="${MAS_APP_IDENTITY:--}"
if [[ -n "${MAS_INSTALLER_IDENTITY:-}" ]]; then
  scripts/sign-mas.sh "$APP" --package "dist-mas/ZePhone_${VERSION}_mas.pkg"
else
  scripts/sign-mas.sh "$APP"
fi
echo "application: $APP"
