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

cmake -S "$SRC" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$BREW" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DSTATIC=OFF
cmake --build "$WORK/build" -j"$(sysctl -n hw.ncpu)"
cmake --install "$WORK/build"

echo "Built: $PREFIX"
ls "$PREFIX/lib/baresip/modules" | grep -E '^(opus|g722)\.so$' || true
BARESIP_PREFIX="$PREFIX" "$ROOT/scripts/prepare-baresip.sh" --force
