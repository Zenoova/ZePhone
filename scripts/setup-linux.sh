#!/usr/bin/env bash
# Installs what is needed to build and run ZePhone on Debian/Ubuntu (x86_64 or arm64): system packages, Rust (rustup) and
# Node.js (the official tarball, checked against the published SHA-256, into ~/.local/node). Run it once; it asks for
# your password for `apt` only.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.12.0}"

sudo apt-get update
sudo apt-get install -y build-essential cmake git curl pkg-config xz-utils \
  libssl-dev libopus-dev libasound2-dev libdbus-1-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
  libsecret-1-0 gnome-keyring

if ! command -v rustc >/dev/null && [[ ! -x "$HOME/.cargo/bin/rustc" ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  case "$(uname -m)" in aarch64 | arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "unsupported CPU $(uname -m)" >&2; exit 1 ;; esac
  TARBALL="node-$NODE_VERSION-linux-$ARCH.tar.xz"
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/$TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
  curl -fsSL -o "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$HOME/.local/node"
  tar -xJf "$TMP/$TARBALL" -C "$HOME/.local/node" --strip-components=1
  rm -rf "$TMP"
  echo 'export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"' >>"$HOME/.profile"
fi
echo
echo "Done. Open a new terminal (or run: . ~/.profile), then in the ZePhone folder:"
echo "  npm install && npm run tauri build -- --debug --no-bundle"
