# Installing ZePhone

Every version is on the [releases page](https://github.com/Zenoova/ZePhone/releases). Package managers follow the
releases automatically.

## macOS

```bash
brew tap zenoova/zephone
brew trust zenoova/zephone         # recent Homebrew versions refuse a third-party tap until it is trusted
brew install --cask zephone
```

Or download the `.dmg` for your Mac (`aarch64` for Apple silicon, `x64` for Intel).

## Windows

```powershell
winget install Zenoova.ZePhone          # when published to winget
choco install zephone                   # when published to Chocolatey
scoop bucket add zephone https://github.com/Zenoova/scoop-zephone
scoop install zephone
```

Or download the `.msi` or the `-setup.exe`. The installers are not signed yet: Windows SmartScreen may ask for
confirmation ("More info", then "Run anyway").

## Linux

Debian, Ubuntu:

```bash
sudo curl -fsSL https://zenoova.github.io/ZePhone/zephone.gpg -o /usr/share/keyrings/zephone.gpg
echo "deb [signed-by=/usr/share/keyrings/zephone.gpg] https://zenoova.github.io/ZePhone/apt ./" | sudo tee /etc/apt/sources.list.d/zephone.list
sudo apt update && sudo apt install ze-phone
```

Fedora, RHEL, openSUSE:

```bash
sudo curl -fsSL https://zenoova.github.io/ZePhone/zephone.repo -o /etc/yum.repos.d/zephone.repo
sudo dnf install ze-phone
```

Arch Linux (x86_64), from the AUR or from our signed repository:

```bash
yay -S ze-phone-bin                     # AUR

curl -fsSL https://zenoova.github.io/ZePhone/zephone.asc | sudo pacman-key --add -
sudo pacman-key --lsign-key DD585D98B36BF3D081DFC775F5A2444E9D273B53
printf '[zephone]\nSigLevel = Required DatabaseRequired\nServer = https://zenoova.github.io/ZePhone/pacman/$arch\n' | sudo tee -a /etc/pacman.conf
sudo pacman -Sy ze-phone
```

Ubuntu App Center and any system with snap: `sudo snap install zephone` (when published to the Snap Store).

Anywhere: download the `.AppImage`, make it executable (`chmod +x`) and run it.

## Android and iOS

Google Play and TestFlight (App Store) when published; the signed `.apk` is on the releases page.
