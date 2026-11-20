#!/usr/bin/env bash
# Builds Baresip from source for Linux (x86_64 or aarch64) and stages it as the Tauri sidecar.
#
#   scripts/build-baresip-linux.sh [baresip-tag] [--force]       default tag: v4.13.0
#
# Prerequisites (Debian/Ubuntu; scripts/setup-linux.sh installs them):
#   build-essential cmake git pkg-config libssl-dev libopus-dev libasound2-dev
#
# Like on Windows and Android, Baresip is built STATIC: every module is linked into the `baresip` executable, so the
# sidecar is a single file (OpenSSL, Opus and ALSA are the system's shared libraries). The `module xxx.so` lines of the
# generated config still work (Baresip resolves them against the compiled-in modules); empty `<module>.so` marker files
# are shipped in the modules folder so that the application knows which optional modules (opus, vumeter, zeaudio) exist.
# G.722 is not built (its module needs spandsp).
#
# Output (same layout as scripts/prepare-baresip.sh on macOS):
#   src-tauri/binaries/baresip-<target-triple>
#   src-tauri/resources/baresip/modules/*.so   (markers)
#   src-tauri/resources/baresip/sounds/*.wav
#   src-tauri/resources/baresip/licenses/*
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI="$ROOT/src-tauri"
WORK="$ROOT/.baresip-build/linux"
TAG="v4.13.0"
FORCE=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    v*) TAG="$a" ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || { echo "build-baresip-linux.sh only runs on Linux" >&2; exit 1; }
for tool in cmake git pkg-config cc rustc; do
  command -v "$tool" >/dev/null || { echo "missing $tool (see scripts/setup-linux.sh)" >&2; exit 1; }
done
for pc in openssl opus alsa; do
  pkg-config --exists "$pc" || { echo "missing development files for $pc (see scripts/setup-linux.sh)" >&2; exit 1; }
done

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
EXE_OUT="$TAURI/binaries/baresip-$TRIPLE"
STAMP="$TAURI/binaries/.prepared-$TRIPLE"
if [[ -f "$EXE_OUT" && -f "$STAMP" && $FORCE -eq 0 ]]; then
  echo "baresip sidecar already prepared for $TRIPLE (use --force to redo)"
  exit 0
fi

mkdir -p "$WORK"
SRC="$WORK/baresip"; RE="$WORK/re"; PREFIX="$WORK/install"
for p in "baresip $SRC" "re $RE"; do
  set -- $p
  [[ -d "$2" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$TAG" "https://github.com/baresip/$1.git" "$2"
done

# The same two one-line patches as the other builds (see scripts/build-baresip.sh for the reasons). Idempotent.
sed -i 's/tmr_start(&st->tmr, 500,/tmr_start(\&st->tmr, 60,/' "$SRC/modules/vumeter/vumeter.c"
grep -c 'tmr_start(&st->tmr, 60,' "$SRC/modules/vumeter/vumeter.c" | grep -qx 2 || { echo "vumeter patch not applied" >&2; exit 1; }
sed -i 's/^#ifndef RELEASE$/#if 1 \/* ZePhone: jitter buffer statistics in release builds *\//' "$SRC/src/jbuf.c"
grep -q 'ZePhone: jitter buffer statistics' "$SRC/src/jbuf.c" || { echo "jbuf patch not applied" >&2; exit 1; }

JOBS="$(nproc)"
echo "=== libre $TAG"
cmake -S "$RE" -B "$WORK/build-re" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DLIBRE_BUILD_SHARED=OFF -DLIBRE_BUILD_STATIC=ON >"$WORK/re-configure.log" 2>&1
cmake --build "$WORK/build-re" --parallel "$JOBS" >"$WORK/re-build.log" 2>&1
cmake --install "$WORK/build-re" >"$WORK/re-install.log" 2>&1

echo "=== baresip $TAG (static, with zeaudio)"
MODULES=(g711 auconv auresamp alsa srtp menu ctrl_tcp vumeter opus)
cmake -S "$SRC" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DSTATIC=ON -DAPP_MODULES=zeaudio -DAPP_MODULES_DIR="$ROOT/scripts/baresip-modules" \
  -DMODULES="$(IFS=';'; echo "${MODULES[*]}")" >"$WORK/configure.log" 2>&1 \
  || { tail -20 "$WORK/configure.log" >&2; exit 1; }
# Only the executable (Baresip's own tests are of no use here).
cmake --build "$WORK/build" --target baresip_exe --parallel "$JOBS" >"$WORK/build.log" 2>&1 \
  || { tail -30 "$WORK/build.log" >&2; exit 1; }
BUILT="$WORK/build/baresip"
[[ -x "$BUILT" ]] || { echo "baresip not found in $WORK/build" >&2; exit 1; }

# ---- stage the sidecar ------------------------------------------------------------------
rm -rf "$TAURI/binaries" "$TAURI/resources/baresip"
mkdir -p "$TAURI/binaries" "$TAURI/resources/baresip/modules" "$TAURI/resources/baresip/sounds" "$TAURI/resources/baresip/licenses"
cp "$BUILT" "$EXE_OUT"
strip "$EXE_OUT"
for s in ring.wav ringback.wav; do cp "$SRC/share/$s" "$TAURI/resources/baresip/sounds/$s"; done
for m in "${MODULES[@]}" zeaudio; do
  printf 'Built into baresip (static build). This marker only tells ZePhone the module is available.\n' >"$TAURI/resources/baresip/modules/$m.so"
done
cp "$SRC/LICENSE" "$TAURI/resources/baresip/licenses/baresip-LICENSE"
cp "$RE/LICENSE" "$TAURI/resources/baresip/licenses/libre-LICENSE"
printf 'baresip %s\nlibre %s\nopenssl (system)\nopus (system)\nalsa-lib (system)\n' "$TAG" "$TAG" >"$TAURI/resources/baresip/licenses/MANIFEST.txt"

# `baresip -h` exits non-zero: check its output rather than its status.
HELP="$("$EXE_OUT" -h 2>&1 || true)"
[[ "$HELP" == *"Usage: baresip"* ]] || { echo "error: the built baresip does not start" >&2; exit 1; }

touch "$STAMP"
echo "Prepared: $EXE_OUT"
echo "  modules: ${MODULES[*]} zeaudio"
