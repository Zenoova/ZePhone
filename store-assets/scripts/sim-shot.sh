#!/bin/sh
# Photographs the real iOS application (with its Liquid Glass tab bar) in the Simulator.
#   scripts/sim-shot.sh <name> "<query>" [wait-seconds]
# needs: `node scripts/sim-proxy.mjs` running, the app installed on the device (`npm run tauri ios dev`), the Vite dev server.
# env: SIM = simulator UDID (default: the one booted), THEME = light|dark (default light), OUT = folder (default captures/ios)
SIM="${SIM:-booted}"
OUT="${OUT:-$(dirname "$0")/../captures/ios}"
mkdir -p "$OUT"
printf '%s' "$2" > "$(dirname "$0")/../captures/.sim-query"
xcrun simctl ui "$SIM" appearance "${THEME:-light}"
xcrun simctl terminate "$SIM" com.zenoova.zephone >/dev/null 2>&1
xcrun simctl launch "$SIM" com.zenoova.zephone >/dev/null
sleep "${3:-9}"
xcrun simctl io "$SIM" screenshot "$OUT/$1-${THEME:-light}.png" 2>/dev/null
# An iPad held in landscape still hands over its portrait framebuffer: ROT=270 turns the picture upright.
[ -n "$ROT" ] && sips -r "$ROT" "$OUT/$1-${THEME:-light}.png" >/dev/null
echo "$OUT/$1-${THEME:-light}.png"
