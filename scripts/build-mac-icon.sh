#!/usr/bin/env bash
# Compiles the Icon Composer icon (src-tauri/icons/ZePhone.icon) into src-tauri/icons/mac/Assets.car with Xcode 26, so that
# the macOS application has the same icon as the iPhone and iPad: light, dark and tinted looks, with the glass effect.
# Tauri's bundler adds the file to the application (bundle > resources) and Info.plist names the icon (CFBundleIconName).
# Run it again after changing the .icon, and commit the new Assets.car.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.baresip-build/mac-icon"
OUT="$ROOT/src-tauri/icons/mac"

command -v xcodegen >/dev/null || { echo "missing xcodegen (brew install xcodegen)" >&2; exit 1; }
rm -rf "$WORK"; mkdir -p "$WORK" "$OUT"
cp "$ROOT/scripts/mac-icon/main.swift" "$WORK/main.swift"
sed "s#\.\./\.\./src-tauri/icons/ZePhone.icon#$ROOT/src-tauri/icons/ZePhone.icon#" "$ROOT/scripts/mac-icon/project.yml" > "$WORK/project.yml"
( cd "$WORK" && xcodegen generate >/dev/null )
xcodebuild -project "$WORK/zephone-mac-icon.xcodeproj" -scheme ZePhone -configuration Release \
  -derivedDataPath "$WORK/build" CODE_SIGNING_ALLOWED=NO build >"$WORK/build.log" 2>&1 \
  || { tail -20 "$WORK/build.log" >&2; exit 1; }
CAR="$WORK/build/Build/Products/Release/ZePhone.app/Contents/Resources/Assets.car"
[[ -f "$CAR" ]] || { echo "Xcode did not produce an Assets.car" >&2; exit 1; }
cp "$CAR" "$OUT/Assets.car"
xcrun assetutil --info "$OUT/Assets.car" | grep -c '"Appearance"' | xargs echo "appearances in the catalog:"
echo "Wrote $OUT/Assets.car"
