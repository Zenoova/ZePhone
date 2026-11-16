#!/usr/bin/env bash
# Creates one small macOS application per ZePhone action, to use with the Stream Deck action
# "System > Open" (or from any launcher: Shortcuts, Alfred, Raycast...).
#
# Each application runs `zephone ctl <command>` against the ZePhone that is already open and quits at once.
# It never starts ZePhone, and it holds no secret: the control socket is private to your user.
#
# Usage:  make-buttons.sh [--app /Applications/ZePhone.app] [--out "$HOME/Documents/ZePhone Stream Deck"]
#
# Needs only what macOS ships (osacompile, PlistBuddy, codesign).
set -euo pipefail

APP="/Applications/ZePhone.app"
OUT="$HOME/Documents/ZePhone Stream Deck"
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:?--app needs a path}"; shift 2 ;;
    --out) OUT="${2:?--out needs a folder}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

BIN="$APP/Contents/MacOS/zephone"
[ -x "$BIN" ] || { echo "ZePhone not found at $APP (use --app)" >&2; exit 1; }
# The path ends up inside a shell command inside an AppleScript string: refuse anything that could break out.
case "$BIN" in
  *\'*|*\"*|*\\*|*\$*|*\`*|*$'\n'*) echo "the path of ZePhone must not contain quotes, backslashes, \$ or backticks" >&2; exit 1 ;;
esac

mkdir -p "$OUT"

# name | zephone ctl arguments
BUTTONS=(
  "ZePhone - Answer|answer"
  "ZePhone - Decline|reject"
  "ZePhone - Hang up|hangup"
  "ZePhone - Mute (toggle)|mute toggle"
  "ZePhone - Mute ON|mute on"
  "ZePhone - Mute OFF|mute off"
  "ZePhone - Hold (toggle)|hold toggle"
  "ZePhone - Do not disturb (toggle)|dnd toggle"
  "ZePhone - Show|show"
  "ZePhone - Dialer|dialer"
  "ZePhone - Search contacts|search"
)

for entry in "${BUTTONS[@]}"; do
  name="${entry%%|*}"
  args="${entry#*|}"
  app="$OUT/$name.app"
  rm -rf "$app"
  # `; true`: the button never shows an error dialog. The answer of the command is in its exit code,
  # which only matters to scripts (see docs/CONTROL.md).
  osacompile -o "$app" -e "do shell script \"'$BIN' ctl $args >/dev/null 2>&1; true\""
  # No Dock icon, no menu bar flash.
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$app/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$app/Contents/Info.plist"
  codesign --force --deep -s - "$app" >/dev/null 2>&1
  echo "created: $app"
done

echo
echo "Done. In Stream Deck, drag \"System > Open\" onto a key and choose one of these applications."
