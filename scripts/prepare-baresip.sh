#!/usr/bin/env bash
# Prepares the Baresip sidecar for Tauri (macOS).
#
# Copies a Baresip install (Homebrew by default, any prefix via BARESIP_PREFIX)
# into src-tauri/ in a relocatable form:
#
#   src-tauri/binaries/baresip-<target-triple>     sidecar executable (externalBin)
#   src-tauri/binaries/libs/*.dylib                dylibs bundled into Contents/Frameworks
#   src-tauri/resources/baresip/modules/*.so       Baresip modules (allow-list)
#   src-tauri/resources/baresip/sounds/*.wav       ring tones
#   src-tauri/resources/baresip/licenses/*         upstream licences
#
# Install names are rewritten to @rpath so the bundle never depends on
# Homebrew at run time, and every Mach-O file is re-signed ad hoc (required on
# Apple Silicon after install_name_tool). Tauri re-signs the final app bundle.
#
# Usage: scripts/prepare-baresip.sh [--force]
set -euo pipefail
exec 3>&2
install_name_tool() { command install_name_tool "$@" 2> >(grep -v 'invalidate the code signature' >&3) ; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI="$ROOT/src-tauri"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "prepare-baresip.sh only supports macOS for now (see README for Windows/Linux)." >&2
  exit 1
fi

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
[[ -n "$TRIPLE" ]] || { echo "cannot determine the Rust host triple (is rustc installed?)" >&2; exit 1; }

EXE_OUT="$TAURI/binaries/baresip-$TRIPLE"
STAMP="$TAURI/binaries/.prepared-$TRIPLE"
if [[ -f "$EXE_OUT" && -f "$STAMP" && "${1:-}" != "--force" ]]; then
  echo "baresip sidecar already prepared for $TRIPLE (use --force to redo)"
  exit 0
fi

# ---- locate the Baresip install -------------------------------------------
PREFIX="${BARESIP_PREFIX:-}"
if [[ -z "$PREFIX" ]]; then
  if command -v brew >/dev/null 2>&1 && brew --prefix baresip >/dev/null 2>&1; then
    PREFIX="$(brew --prefix baresip)"
  elif command -v baresip >/dev/null 2>&1; then
    PREFIX="$(cd "$(dirname "$(command -v baresip)")/.." && pwd)"
  fi
fi
[[ -x "$PREFIX/bin/baresip" ]] || {
  echo "Baresip not found. Install it (brew install baresip) or set BARESIP_PREFIX." >&2
  exit 1
}
MODULES_SRC="$PREFIX/lib/baresip/modules"
SOUNDS_SRC="$PREFIX/share/baresip"
[[ -d "$MODULES_SRC" ]] || { echo "module directory not found: $MODULES_SRC" >&2; exit 1; }
echo "Using Baresip at $PREFIX"

# Only what the app needs: no httpd/cons/stdio/dbus control surface.
MODULES=(g711 g722 opus auconv auresamp coreaudio srtp menu ctrl_tcp)
SOUNDS=(ring.wav ringback.wav)

rm -rf "$TAURI/binaries" "$TAURI/resources/baresip"
mkdir -p "$TAURI/binaries/libs" "$TAURI/resources/baresip/modules" "$TAURI/resources/baresip/sounds" \
         "$TAURI/resources/baresip/licenses"

# ---- helpers ---------------------------------------------------------------
is_system_lib() { [[ "$1" == /usr/lib/* || "$1" == /System/* ]]; }

rpaths_of() { otool -l "$1" | awk '/LC_RPATH/{f=1} f&&/ path /{print $2; f=0}'; }

# Resolve a dependency reference of $1 to a real file.
resolve_dep() {
  local owner="$1" dep="$2"
  case "$dep" in
    @rpath/*)
      local name="${dep#@rpath/}" rp
      while IFS= read -r rp; do
        rp="${rp/@loader_path/$(dirname "$owner")}"
        rp="${rp/@executable_path/$(dirname "$PREFIX/bin/baresip")}"
        [[ -f "$rp/$name" ]] && { echo "$rp/$name"; return 0; }
      done < <(rpaths_of "$owner")
      [[ -f "$PREFIX/lib/$name" ]] && { echo "$PREFIX/lib/$name"; return 0; }
      return 1 ;;
    @loader_path/*) echo "$(dirname "$owner")/${dep#@loader_path/}" ;;
    /*) [[ -f "$dep" ]] && echo "$dep" || return 1 ;;
    *) return 1 ;;
  esac
}

BUNDLED=()   # basenames already copied
copy_lib_tree() {
  local owner="$1" dep real base
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    is_system_lib "$dep" && continue
    real="$(resolve_dep "$owner" "$dep")" || { echo "cannot resolve $dep (needed by $owner)" >&2; exit 1; }
    real="$(cd "$(dirname "$real")" && pwd -P)/$(basename "$real")"
    base="$(basename "$real")"
    if [[ " ${BUNDLED[*]:-} " != *" $base "* ]]; then
      BUNDLED+=("$base")
      cp -L "$real" "$TAURI/binaries/libs/$base"
      chmod u+w "$TAURI/binaries/libs/$base"
      copy_lib_tree "$real"
    fi
  done < <(otool -L "$owner" | tail -n +2 | awk '{print $1}')
}

fix_refs() {
  # Point every non-system reference of $1 at @rpath/<basename>.
  local file="$1" dep
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    is_system_lib "$dep" && continue
    [[ "$dep" == @rpath/* && "$dep" != /* ]] && continue
    install_name_tool -change "$dep" "@rpath/$(basename "$dep")" "$file"
  done < <(otool -L "$file" | tail -n +2 | awk '{print $1}')
}

# ---- executable and its dylibs ------------------------------------------------
cp "$PREFIX/bin/baresip" "$EXE_OUT"
chmod u+w "$EXE_OUT"
copy_lib_tree "$PREFIX/bin/baresip"

fix_refs "$EXE_OUT"
# Drop the Homebrew rpath, add the bundle (../Frameworks) and dev (target/debug) locations.
# Quieter: install_name_tool warns about signatures that we re-create at the end.
while IFS= read -r rp; do install_name_tool -delete_rpath "$rp" "$EXE_OUT"; done < <(rpaths_of "$EXE_OUT")
install_name_tool -add_rpath "@executable_path/../Frameworks" "$EXE_OUT"
install_name_tool -add_rpath "@executable_path/../../binaries/libs" "$EXE_OUT"
install_name_tool -add_rpath "@executable_path/libs" "$EXE_OUT"   # running it straight from src-tauri/binaries

for lib in "$TAURI/binaries/libs/"*.dylib; do
  base="$(basename "$lib")"
  install_name_tool -id "@rpath/$base" "$lib"
  fix_refs "$lib"
  while IFS= read -r rp; do install_name_tool -delete_rpath "$rp" "$lib"; done < <(rpaths_of "$lib")
  install_name_tool -add_rpath "@loader_path" "$lib"
done

# ---- modules -----------------------------------------------------------------
for m in "${MODULES[@]}"; do
  src="$MODULES_SRC/$m.so"
  if [[ -f "$src" ]]; then
    cp -L "$src" "$TAURI/resources/baresip/modules/$m.so"
    chmod u+w "$TAURI/resources/baresip/modules/$m.so"
    if otool -L "$src" | tail -n +2 | awk '{print $1}' | grep -vqE '^(/usr/lib/|/System/)'; then
      echo "warning: module $m.so links against non-system libraries:" >&2
      otool -L "$src" | tail -n +2 | awk '{print "   " $1}' | grep -vE '(/usr/lib/|/System/)' >&2 || true
    fi
  else
    echo "note: optional module $m.so is not part of this Baresip build (skipped)"
  fi
done

for s in "${SOUNDS[@]}"; do cp "$SOUNDS_SRC/$s" "$TAURI/resources/baresip/sounds/$s"; done

# ---- licences ------------------------------------------------------------------
for pkg in baresip libre; do
  p="$(brew --prefix "$pkg" 2>/dev/null || true)"
  for f in LICENSE LICENSE.txt COPYING; do
    [[ -n "$p" && -f "$p/$f" ]] && cp "$p/$f" "$TAURI/resources/baresip/licenses/$pkg-$f" || true
  done
done

# ---- ad-hoc signature (mandatory on arm64 after editing load commands) -----------
codesign --force --sign - "$TAURI/binaries/libs/"*.dylib
codesign --force --sign - "$TAURI/resources/baresip/modules/"*.so
codesign --force --sign - "$EXE_OUT"

# ---- sanity checks ----------------------------------------------------------------
if otool -L "$EXE_OUT" "$TAURI/binaries/libs/"*.dylib | grep -q '/opt/homebrew\|/usr/local/'; then
  echo "error: a Homebrew path is still referenced:" >&2
  otool -L "$EXE_OUT" "$TAURI/binaries/libs/"*.dylib | grep '/opt/homebrew\|/usr/local/' >&2
  exit 1
fi
# `baresip -h` exits non-zero, so check its output instead of its status.
HELP_OUT="$("$EXE_OUT" -h 2>&1 || true)"
[[ "$HELP_OUT" == *"Usage: baresip"* ]] || { echo "error: the relocated baresip does not start" >&2; exit 1; }

touch "$STAMP"
echo "Prepared: $EXE_OUT"
echo "  libs:    $(ls "$TAURI/binaries/libs" | tr '\n' ' ')"
echo "  modules: $(ls "$TAURI/resources/baresip/modules" | tr '\n' ' ')"
