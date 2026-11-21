#!/usr/bin/env bash
# Builds the apt and dnf/yum repositories of a release into a checkout of the `gh-pages` branch, signed with the
# release GPG key. GitHub Pages then serves them at https://zenoova.github.io/ZePhone/.
#
#   TAG=v1.2.3 PAGES=/path/to/gh-pages-checkout GPG_KEY_ID=<fingerprint> GPG_PASSPHRASE=... \
#     packaging/linux-repo/build-repo.sh
#
# Needs: gh (to download the release files), apt-utils (apt-ftparchive), createrepo-c, gnupg, docker (for pacman).
#
#   apt : flat repository, `deb [signed-by=/usr/share/keyrings/zephone.gpg] https://zenoova.github.io/ZePhone/apt ./`
#   rpm : one repository per CPU (`$basearch`), metadata signed (repo_gpgcheck=1)
#   pacman : x86_64 only, packages and database signed (see build-pacman.sh)
#
# Only the newest KEEP versions are kept: every version is also on the GitHub Release, and Pages must stay small.
set -euo pipefail

: "${TAG:?TAG is required (vX.Y.Z)}"
: "${PAGES:?PAGES is required (a checkout of gh-pages)}"
: "${GPG_KEY_ID:?GPG_KEY_ID is required}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE is required}"
KEEP="${KEEP:-3}"
SITE="${SITE:-https://zenoova.github.io/ZePhone}"
VERSION="${TAG#v}"

work="$(mktemp -d)"
gpg_sign() { gpg --batch --yes --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" --local-user "$GPG_KEY_ID" "$@"; }

# ---- the files of this release ------------------------------------------------------------------------------------
gh release download "$TAG" --pattern '*.deb' --pattern '*.rpm' --dir "$work"

# ---- apt ----------------------------------------------------------------------------------------------------------
apt_dir="$PAGES/apt"
mkdir -p "$apt_dir/pool"
cp "$work"/*.deb "$apt_dir/pool/"
for arch in amd64 arm64; do
  # Newest first (version sort), drop what is beyond KEEP.
  ls -1 "$apt_dir/pool/"ZePhone_*_"$arch".deb 2>/dev/null | sort -rV | tail -n +"$((KEEP + 1))" | xargs -r rm -f
done
(
  cd "$apt_dir"
  apt-ftparchive packages pool > Packages
  gzip -9 -k -f Packages
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin="Zenoova" \
    -o APT::FTPArchive::Release::Label="ZePhone" \
    -o APT::FTPArchive::Release::Suite="stable" \
    -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
    release . > Release
  rm -f InRelease Release.gpg
  gpg_sign --clearsign --output InRelease Release
  gpg_sign --armor --detach-sign --output Release.gpg Release
)

# ---- rpm ----------------------------------------------------------------------------------------------------------
for arch in x86_64 aarch64; do
  rpm_dir="$PAGES/rpm/$arch"
  mkdir -p "$rpm_dir"
  cp "$work"/*."$arch".rpm "$rpm_dir/" 2>/dev/null || true
  ls -1 "$rpm_dir"/*.rpm 2>/dev/null | sort -rV | tail -n +"$((KEEP + 1))" | xargs -r rm -f
  if ls "$rpm_dir"/*.rpm > /dev/null 2>&1; then
    createrepo_c --quiet --update "$rpm_dir"
    rm -f "$rpm_dir/repodata/repomd.xml.asc"
    gpg_sign --armor --detach-sign --output "$rpm_dir/repodata/repomd.xml.asc" "$rpm_dir/repodata/repomd.xml"
  fi
done

# ---- pacman (Arch Linux): built in an Arch container, where pacman and makepkg exist ---------------------------------
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gpg --batch --pinentry-mode loopback --passphrase "$GPG_PASSPHRASE" --armor --export-secret-keys "$GPG_KEY_ID" > "$work/key.asc"
docker run --rm \
  -v "$PAGES:/pages" -v "$work:/work" -v "$here:/scripts:ro" -v "$here/../arch:/packaging:ro" \
  -e TAG -e GPG_KEY_ID -e GPG_PASSPHRASE -e GPG_KEY_FILE=key.asc \
  archlinux:base-devel bash /scripts/build-pacman.sh

# ---- public key and instructions ----------------------------------------------------------------------------------
gpg --batch --armor --export "$GPG_KEY_ID" > "$PAGES/zephone.asc"
gpg --batch --export "$GPG_KEY_ID" > "$PAGES/zephone.gpg"

cat > "$PAGES/zephone.repo" <<EOF
[zephone]
name=ZePhone
baseurl=$SITE/rpm/\$basearch
enabled=1
gpgcheck=0
repo_gpgcheck=1
gpgkey=$SITE/zephone.asc
EOF

cat > "$PAGES/index.html" <<EOF
<!doctype html>
<meta charset="utf-8">
<title>ZePhone packages</title>
<h1>ZePhone packages</h1>
<p>Latest version: $VERSION. Every version is also on the <a href="https://github.com/Zenoova/ZePhone/releases">releases page</a>.</p>
<h2>Debian, Ubuntu (apt)</h2>
<pre>sudo curl -fsSL $SITE/zephone.gpg -o /usr/share/keyrings/zephone.gpg
echo "deb [signed-by=/usr/share/keyrings/zephone.gpg] $SITE/apt ./" | sudo tee /etc/apt/sources.list.d/zephone.list
sudo apt update &amp;&amp; sudo apt install ze-phone</pre>
<h2>Fedora, RHEL, openSUSE (dnf, yum)</h2>
<pre>sudo curl -fsSL $SITE/zephone.repo -o /etc/yum.repos.d/zephone.repo
sudo dnf install ze-phone</pre>
<h2>Arch Linux (pacman, x86_64)</h2>
<pre>curl -fsSL $SITE/zephone.asc | sudo pacman-key --add -
sudo pacman-key --lsign-key $GPG_KEY_ID
printf '[zephone]\nSigLevel = Required DatabaseRequired\nServer = $SITE/pacman/\$arch\n' | sudo tee -a /etc/pacman.conf
sudo pacman -Sy ze-phone</pre>
<p>Or from the AUR: <code>yay -S ze-phone-bin</code>.</p>
EOF
touch "$PAGES/.nojekyll"
rm -rf "$work"
echo "repositories updated for $TAG"
