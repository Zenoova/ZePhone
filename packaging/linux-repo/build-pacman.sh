#!/usr/bin/env bash
# Builds the pacman repository of a release. Runs INSIDE an Arch Linux container (see build-repo.sh): pacman and
# makepkg only exist there.
#
# Mounted by build-repo.sh:   /pages   the gh-pages checkout          /work   the release files
#                             /scripts this folder (read only)       /packaging  packaging/arch (read only)
# Environment:                TAG, GPG_KEY_ID, GPG_PASSPHRASE, GPG_KEY_FILE (armored secret key, in /work)
#
# One CPU only (x86_64): the package repackages the release's amd64 .deb. Metadata and packages are signed.
set -euo pipefail

VERSION="${TAG#v}"
KEEP="${KEEP:-3}"
repo="/pages/pacman/x86_64"

pacman -Syu --noconfirm --needed base-devel git gnupg libarchive

gpg --batch --import "/work/$GPG_KEY_FILE"
gpg_sign() { gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" --local-user "$GPG_KEY_ID" "$@"; }

# ---- the package (makepkg refuses to run as root) -------------------------------------------------------------------
deb="$(ls /work/ZePhone_"${VERSION}"_amd64.deb)"
sha="$(sha256sum "$deb" | cut -d' ' -f1)"
useradd -m builder
build=/home/builder/pkg
mkdir -p "$build"
sed -e "s/@PKGNAME@/zephone/" -e "s/@VERSION@/$VERSION/" -e "s/@SHA_DEB@/$sha/" -e "/@EXTRA@/d" \
  /packaging/PKGBUILD.in > "$build/PKGBUILD"
# makepkg downloads the release file itself; give it the copy we already have instead.
cp "$deb" "$build/ZePhone_${VERSION}_amd64.deb"
chown -R builder:builder /home/builder
su builder -c "cd $build && makepkg --noconfirm --nodeps --skipinteg"

# ---- the repository -------------------------------------------------------------------------------------------------
mkdir -p "$repo"
cp "$build"/zephone-[0-9]*.pkg.tar.zst "$repo/"
rm -f "$repo"/zephone-debug-*
# Newest first (version sort); drop what is beyond KEEP, with its signature.
ls -1 "$repo"/zephone-[0-9]*.pkg.tar.zst | sort -rV | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sig"; done
for pkg in "$repo"/zephone-[0-9]*.pkg.tar.zst; do
  rm -f "$pkg.sig"
  gpg_sign --detach-sign --output "$pkg.sig" "$pkg"
done
cd "$repo"
rm -f zephone.db* zephone.files*
repo-add zephone.db.tar.zst ./zephone-[0-9]*.pkg.tar.zst
# GitHub Pages does not follow the symbolic links repo-add makes: real copies, each one signed.
for name in db files; do
  rm -f "zephone.$name"
  cp "zephone.$name.tar.zst" "zephone.$name"
  rm -f "zephone.$name.sig" "zephone.$name.tar.zst.sig"
  gpg_sign --detach-sign --output "zephone.$name.sig" "zephone.$name"
  cp "zephone.$name.sig" "zephone.$name.tar.zst.sig"
done
chown -R "$(stat -c '%u:%g' /pages)" /pages
echo "pacman repository updated for $TAG"
