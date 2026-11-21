#!/usr/bin/env bash
# Signs ZePhone.app for the Mac App Store and wraps it in the installer package the store takes.
#
#   scripts/sign-mas.sh <ZePhone.app> [--package <ZePhone.pkg>]
#
# Environment:
#   MAS_APP_IDENTITY        signing identity of the code ("3rd Party Mac Developer Application: ..." or "Apple
#                           Distribution: ..."). "-" signs ad hoc, for a local test of the sandbox.
#   MAS_INSTALLER_IDENTITY  identity of the package ("3rd Party Mac Developer Installer: ..." / "Mac Installer
#                           Distribution"). Only needed with --package.
#   MAS_PROFILE             the Mac App Store provisioning profile (.provisionprofile), embedded in the bundle.
#   MAS_TEAM_ID             the Apple team (3RWC6787PS): written to the entitlements next to the application
#                           identifier, as the store wants. Without a profile these two restricted entitlements
#                           are left out: macOS refuses to start an application that claims them without one.
#   MAS_KEYCHAIN            keychain that holds the identities (CI: a throw-away one).
#   MAS_HARDENED=1          also turns on the hardened runtime (not required by the store; used to test that the
#                           engine and its modules load under library validation).
#
# Every Mach-O file of the bundle is signed, from the inside out, with the same identity, which is what library
# validation needs: the engine loads its modules (Contents/Resources/engine/modules/*.so) and libraries
# (Contents/Frameworks/*.dylib) with dlopen. Nothing is signed with --deep.
set -euo pipefail

APP="${1:?usage: sign-mas.sh <ZePhone.app> [--package <ZePhone.pkg>]}"
shift || true
PKG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --package) PKG="${2:?--package needs a path}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENT_APP="$ROOT/src-tauri/Entitlements.mas.plist"
ENT_CHILD="$ROOT/src-tauri/Entitlements.mas.inherit.plist"
IDENTITY="${MAS_APP_IDENTITY:?MAS_APP_IDENTITY is not set}"
[[ -d "$APP/Contents" ]] || { echo "not an application bundle: $APP" >&2; exit 1; }

EXE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
MAIN="$APP/Contents/MacOS/$EXE_NAME"
ENGINE="$APP/Contents/MacOS/baresip"
[[ -x "$MAIN" ]] || { echo "main executable not found: $MAIN" >&2; exit 1; }
[[ -x "$ENGINE" ]] || { echo "the engine is not in the bundle: $ENGINE" >&2; exit 1; }

common=(--force --sign "$IDENTITY")
[[ "$IDENTITY" != "-" ]] && common+=(--timestamp)
[[ "${MAS_HARDENED:-}" == "1" ]] && common+=(--options runtime)
[[ -n "${MAS_KEYCHAIN:-}" ]] && common+=(--keychain "$MAS_KEYCHAIN")

# The entitlements of the application, with the identifiers of the profile.
ENT_TMP="$(mktemp -d)"
trap 'rm -rf "$ENT_TMP"' EXIT
cp "$ENT_APP" "$ENT_TMP/app.plist"
if [[ -n "${MAS_PROFILE:-}" ]]; then
  : "${MAS_TEAM_ID:?MAS_TEAM_ID is not set}"
  BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
  /usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string $MAS_TEAM_ID.$BUNDLE_ID" "$ENT_TMP/app.plist"
  /usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $MAS_TEAM_ID" "$ENT_TMP/app.plist"
  cp "$MAS_PROFILE" "$APP/Contents/embedded.provisionprofile"
fi

# 1. Libraries and modules (not executables: no entitlements).
while IFS= read -r -d '' f; do
  [[ "$f" == "$MAIN" || "$f" == "$ENGINE" ]] && continue
  if file -b "$f" | grep -q 'Mach-O'; then
    echo "sign $(basename "$f")"
    codesign "${common[@]}" "$f"
  fi
done < <(find "$APP/Contents" -type f -print0)

# 2. The engine: a child process that inherits the sandbox of the application.
codesign "${common[@]}" --entitlements "$ENT_CHILD" "$ENGINE"
# 3. The application.
codesign "${common[@]}" --entitlements "$ENT_TMP/app.plist" "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
echo "--- entitlements of the application"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - || true
echo "--- entitlements of the engine"
codesign -d --entitlements - --xml "$ENGINE" 2>/dev/null | plutil -p - || true

if [[ -n "$PKG" ]]; then
  : "${MAS_INSTALLER_IDENTITY:?MAS_INSTALLER_IDENTITY is not set}"
  kc=()
  [[ -n "${MAS_KEYCHAIN:-}" ]] && kc=(--keychain "$MAS_KEYCHAIN")
  productbuild --component "$APP" /Applications --sign "$MAS_INSTALLER_IDENTITY" ${kc[@]+"${kc[@]}"} "$PKG"
  pkgutil --check-signature "$PKG" || true
  echo "package: $PKG"
fi
