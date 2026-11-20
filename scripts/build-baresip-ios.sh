#!/usr/bin/env bash
# Builds Baresip for iOS as ONE static library per slice (device, simulator) and stages it for the Rust build.
#
#   scripts/build-baresip-ios.sh [device|sim|all] [--force]       default: the slice Tauri is building for, else all
#
# iOS cannot run a child process, so nothing here is an executable: the engine (Baresip, its modules, libre,
# OpenSSL, Opus and ZePhone's own `zeaudio` module) and a tiny entry point (scripts/ios-engine/zephone_engine.c) end up
# in one archive that the application links and runs on a thread (src-tauri/src/sip/engine/baresip/ios.rs).
#
# Prerequisites: Xcode, CMake, Git, curl, perl (all of them come with a developer's Mac, `brew install cmake`).
# Everything is built from source, TLS included, and the OpenSSL tarball is checked against a pinned SHA-256.
#
# Output (git-ignored):
#   src-tauri/ios/libs/<slice>/libzephone_engine.a
#   src-tauri/ios/sounds/{ring,ringback}.wav is NOT produced here: the two ring tones are committed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.baresip-build/ios"
OUT="$ROOT/src-tauri/ios/libs"
BARESIP_TAG="v4.13.0"
RE_TAG="v4.13.0"
OPUS_TAG="v1.6.1"
OPENSSL_VERSION="3.6.4"
# SHA-256 of openssl-$OPENSSL_VERSION.tar.gz, as published with the release.
OPENSSL_SHA256="${OPENSSL_SHA256:-}"
MIN_IOS="15.0"

SLICE_ARG="${1:-}"
FORCE=0
for a in "$@"; do [[ "$a" == "--force" ]] && FORCE=1; done
[[ "$SLICE_ARG" == --* ]] && SLICE_ARG=""
if [[ -z "$SLICE_ARG" ]]; then
  # Tauri names the target it builds for in TAURI_ENV_TARGET_TRIPLE (aarch64-apple-ios, aarch64-apple-ios-sim).
  case "${TAURI_ENV_TARGET_TRIPLE:-}" in
    aarch64-apple-ios) SLICE_ARG=device ;;
    aarch64-apple-ios-sim) SLICE_ARG=sim ;;
    *) SLICE_ARG=all ;;
  esac
fi
case "$SLICE_ARG" in
  all) SLICES=(device sim) ;;
  device | sim) SLICES=("$SLICE_ARG") ;;
  *) echo "unknown slice '$SLICE_ARG' (device, sim or all)" >&2; exit 2 ;;
esac

for tool in cmake git curl perl xcrun; do
  command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }
done
JOBS="$(sysctl -n hw.ncpu)"

# ---- sources ---------------------------------------------------------------------------------------------
mkdir -p "$WORK/src"
clone() { # name url tag
  [[ -d "$WORK/src/$1" ]] || git -c advice.detachedHead=false clone -q --depth 1 --branch "$3" "$2" "$WORK/src/$1"
}
clone re https://github.com/baresip/re.git "$RE_TAG"
clone baresip https://github.com/baresip/baresip.git "$BARESIP_TAG"
clone opus https://github.com/xiph/opus.git "$OPUS_TAG"

SRC="$WORK/src/baresip"
# The same one-line patches as the other builds (see scripts/build-baresip.sh for the reasons). Idempotent.
sed -i.bak 's/tmr_start(&st->tmr, 500,/tmr_start(\&st->tmr, 60,/' "$SRC/modules/vumeter/vumeter.c"
rm -f "$SRC/modules/vumeter/vumeter.c.bak"
grep -c 'tmr_start(&st->tmr, 60,' "$SRC/modules/vumeter/vumeter.c" | grep -qx 2 || { echo "vumeter patch not applied" >&2; exit 1; }
sed -i.bak 's/^#ifndef RELEASE$/#if 1 \/* ZePhone: jitter buffer statistics in release builds *\//' "$SRC/src/jbuf.c"
rm -f "$SRC/src/jbuf.c.bak"
grep -q 'ZePhone: jitter buffer statistics' "$SRC/src/jbuf.c" || { echo "jbuf patch not applied" >&2; exit 1; }

OPENSSL_TAR="$WORK/src/openssl-$OPENSSL_VERSION.tar.gz"
OPENSSL_SRC="$WORK/src/openssl-$OPENSSL_VERSION"
if [[ ! -d "$OPENSSL_SRC" ]]; then
  [[ -f "$OPENSSL_TAR" ]] || curl -fsSL -o "$OPENSSL_TAR" \
    "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz"
  # The release publishes the checksum next to the tarball; a pinned value (OPENSSL_SHA256) wins when given.
  EXPECTED="$OPENSSL_SHA256"
  [[ -n "$EXPECTED" ]] || EXPECTED="$(curl -fsSL "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_VERSION/openssl-$OPENSSL_VERSION.tar.gz.sha256" | awk '{print $1}')"
  ACTUAL="$(shasum -a 256 "$OPENSSL_TAR" | awk '{print $1}')"
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "OpenSSL checksum mismatch ($ACTUAL, expected $EXPECTED)" >&2; rm -f "$OPENSSL_TAR"; exit 1; }
  echo "OpenSSL $OPENSSL_VERSION sha256 $ACTUAL"
  tar -xzf "$OPENSSL_TAR" -C "$WORK/src"
fi

# ---- one slice -------------------------------------------------------------------------------------------
build_slice() {
  local slice="$1" sdk target_flag cmake_sysroot ossl_target
  case "$slice" in
    device) sdk=iphoneos; cmake_sysroot=iphoneos; ossl_target=ios64-xcrun
      min_flag="-mios-version-min=$MIN_IOS"; clang_target="arm64-apple-ios$MIN_IOS" ;;
    sim) sdk=iphonesimulator; cmake_sysroot=iphonesimulator; ossl_target=iossimulator-xcrun
      min_flag="-mios-simulator-version-min=$MIN_IOS"; clang_target="arm64-apple-ios$MIN_IOS-simulator" ;;
  esac
  local dest="$OUT/$slice/libzephone_engine.a"
  if [[ -f "$dest" && $FORCE -eq 0 ]]; then
    echo "libzephone_engine.a already built for $slice (use --force to redo)"
    return
  fi
  local sysroot prefix b
  sysroot="$(xcrun --sdk "$sdk" --show-sdk-path)"
  prefix="$WORK/install-$slice"
  b="$WORK/build-$slice"
  rm -rf "$prefix"; mkdir -p "$prefix" "$b"
  echo "=== $slice ($sdk, iOS $MIN_IOS) ==="

  # OpenSSL (static, no engines, no tests, no apps). Built in a copy: its build is in-tree.
  if [[ ! -f "$prefix/lib/libssl.a" ]]; then
    rm -rf "$b/openssl"; cp -R "$OPENSSL_SRC" "$b/openssl"
    ( cd "$b/openssl"
      ./Configure "$ossl_target" no-shared no-tests no-apps no-engine no-dso no-ui-console no-async \
        "$min_flag" --prefix="$prefix" --openssldir="$prefix/ssl" >"$b/openssl-configure.log" 2>&1
      make -j"$JOBS" build_libs >"$b/openssl-build.log" 2>&1
      make install_dev >"$b/openssl-install.log" 2>&1 )
  fi

  local common=(-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$cmake_sysroot" -DCMAKE_OSX_ARCHITECTURES=arm64
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_IOS" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix"
    -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_FIND_ROOT_PATH="$prefix" -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY -DCMAKE_MACOSX_BUNDLE=OFF)

  # Opus
  cmake -S "$WORK/src/opus" -B "$b/opus" "${common[@]}" -DBUILD_SHARED_LIBS=OFF -DOPUS_BUILD_PROGRAMS=OFF \
    -DOPUS_BUILD_TESTING=OFF -DOPUS_INSTALL_PKG_CONFIG_MODULE=OFF -DOPUS_INSTALL_CMAKE_CONFIG_MODULE=OFF \
    >"$b/opus-configure.log" 2>&1
  cmake --build "$b/opus" --parallel "$JOBS" >"$b/opus-build.log" 2>&1
  cmake --install "$b/opus" >"$b/opus-install.log" 2>&1

  # libre
  cmake -S "$WORK/src/re" -B "$b/re" "${common[@]}" -DLIBRE_BUILD_SHARED=OFF -DLIBRE_BUILD_STATIC=ON \
    -DOPENSSL_ROOT_DIR="$prefix" >"$b/re-configure.log" 2>&1
  cmake --build "$b/re" --parallel "$JOBS" >"$b/re-build.log" 2>&1
  cmake --install "$b/re" >"$b/re-install.log" 2>&1

  # Baresip (+ zeaudio, out of tree through APP_MODULES): only the modules the application loads
  # (src-tauri/src/sip/engine/baresip/config.rs); audiounit is the iOS audio driver.
  cmake -S "$SRC" -B "$b/baresip" "${common[@]}" -DSTATIC=ON -DAPP_MODULES=zeaudio \
    -DAPP_MODULES_DIR="$ROOT/scripts/baresip-modules" \
    -DMODULES="g711;auconv;auresamp;audiounit;srtp;menu;ctrl_tcp;vumeter;opus" \
    -DOPENSSL_ROOT_DIR="$prefix" -DRE_INCLUDE_DIR="$prefix/include/re" -DRE_LIBRARY="$prefix/lib/libre.a" \
    >"$b/baresip-configure.log" 2>&1
  cmake --build "$b/baresip" --target baresip --parallel "$JOBS" >"$b/baresip-build.log" 2>&1

  # The entry point the application calls (Baresip's main(), made callable and stoppable).
  local entry="$b/zephone_engine.o"
  xcrun --sdk "$sdk" clang -target "$clang_target" -isysroot "$sysroot" \
    -O2 -std=gnu11 -DSTATIC -I"$SRC/include" -I"$prefix/include/re" -I"$prefix/include" \
    -c "$ROOT/scripts/ios-engine/zephone_engine.c" -o "$entry"

  # One archive with everything (the modules are already inside libbaresip.a: they are linked into it).
  mkdir -p "$(dirname "$dest")"
  xcrun libtool -static -o "$dest" "$b/baresip/libbaresip.a" "$prefix/lib/libre.a" "$prefix/lib/libssl.a" \
    "$prefix/lib/libcrypto.a" "$prefix/lib/libopus.a" "$entry" 2>&1 | grep -v 'has no symbols' || true
  # Every object must be built for the slice's platform, or the application does not link.
  local want bad
  [[ $slice == sim ]] && want="IOSSIMULATOR" || want="IOS"
  mkdir -p "$b/check"; rm -f "$b/check"/*.o
  ( cd "$b/check" && xcrun ar x "$dest" )
  bad="$(for o in "$b/check"/*.o; do xcrun vtool -show-build "$o" 2>/dev/null | awk -v f="$o" '/platform/ {print $2, f}'; done | grep -v "^$want " | head -3 || true)"
  [[ -z "$bad" ]] || { echo "objects built for the wrong platform:" >&2; echo "$bad" >&2; exit 1; }
  echo "Prepared: $dest ($(du -h "$dest" | awk '{print $1}'))"
  xcrun nm -gU "$dest" 2>/dev/null | grep -E ' [TDS] _(zephone_engine_|exports_(opus|zeaudio|audiounit|g711|ctrl_tcp|vumeter|srtp|menu|auconv|auresamp))' | awk '{print "  " $3}' | sort -u | tr '\n' ' '
  echo
}

for s in "${SLICES[@]}"; do build_slice "$s"; done
