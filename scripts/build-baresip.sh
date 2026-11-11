#!/usr/bin/env bash
# Builds Baresip from source WITH Opus and G.722 (the Homebrew bottle only ships G.711),
# into .baresip-build/install, then prepares the sidecar from it.
#
#   brew install cmake pkgconf opus spandsp libre   # libre = the version Baresip is built against
#   scripts/build-baresip.sh [baresip-tag]          # default: the version of the installed libre
#
# Licences: Opus is BSD-3-Clause; spandsp (used for G.722) is LGPL-2.1 and is linked dynamically
# (bundled as a separate dylib, licence text shipped in Resources/engine/licenses).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BREW="$(brew --prefix)"
TAG="${1:-v$(brew list --versions libre | awk '{print $2}')}"
WORK="$ROOT/.baresip-build"
SRC="$WORK/baresip"
PREFIX="$WORK/install"

for tool in cmake pkgconf; do
  command -v "$tool" >/dev/null || { echo "missing $tool (brew install $tool)" >&2; exit 1; }
done
[[ -d "$BREW/opt/opus" ]] || { echo "missing opus (brew install opus)" >&2; exit 1; }
[[ -d "$BREW/opt/spandsp" ]] || echo "note: spandsp not installed, G.722 will be skipped (brew install spandsp)"

mkdir -p "$WORK"
if [[ ! -d "$SRC" ]]; then
  git clone --depth 1 --branch "$TAG" https://github.com/baresip/baresip.git "$SRC"
fi

# The vumeter module reports audio levels (VU_TX_REPORT / VU_RX_REPORT, used by the call-screen
# animation) every 500 ms, which is too coarse for a lively display: report every 60 ms instead.
# (Idempotent. Baresip is BSD-licensed; this one-line change is the only modification.)
sed -i.bak 's/tmr_start(&st->tmr, 500,/tmr_start(\&st->tmr, 60,/' "$SRC/modules/vumeter/vumeter.c"
rm -f "$SRC/modules/vumeter/vumeter.c.bak"
grep -c 'tmr_start(&st->tmr, 60,' "$SRC/modules/vumeter/vumeter.c" | grep -qx 2 || { echo "vumeter patch not applied" >&2; exit 1; }

cmake -S "$SRC" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$BREW" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DSTATIC=OFF
cmake --build "$WORK/build" -j"$(sysctl -n hw.ncpu)"
cmake --install "$WORK/build"
cp "$SRC/LICENSE" "$PREFIX/LICENSE"   # BSD-3-Clause, shipped with the bundle

echo "Built: $PREFIX"
ls "$PREFIX/lib/baresip/modules" | grep -E '^(opus|g722|vumeter)\.so$' || true
BARESIP_PREFIX="$PREFIX" "$ROOT/scripts/prepare-baresip.sh" --force
