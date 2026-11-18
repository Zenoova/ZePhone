# Builds Baresip for Android (NDK, one build per ABI) and stages it for the Gradle project.
#
#   scripts\build-baresip-android.ps1 [-Abi arm64-v8a,x86_64] [-Tag v4.13.0] [-Force]
#
# Prerequisites: the Android NDK (ANDROID_NDK_HOME, or ANDROID_HOME\ndk\<version>), CMake, Git, and either Windows
# or PowerShell 7 (`pwsh`) on macOS / Linux. OpenSSL and Opus are fetched and built by vcpkg (cloned into
# .baresip-build\vcpkg, shared with the Windows build).
#
# Android has no sidecar: the engine is a PIE executable named `libbaresip.so` so that the package manager extracts
# it with the native libraries, from where the application may run it (see
# src-tauri/src/sip/engine/baresip/android.rs). Like on Windows, Baresip is built STATIC: every module is inside
# the executable, so there is nothing else to ship.
#
# Output:
#   src-tauri\android\jniLibs\<abi>\libbaresip.so     (picked up by src-tauri\gen\android\app\build.gradle.kts)
[CmdletBinding()]
param(
    [string]$Abi = 'arm64-v8a',
    [string]$Tag = 'v4.13.0',
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root 'src-tauri\android\jniLibs'
$Work = Join-Path $Root '.baresip-build'
$AndroidWork = Join-Path $Work 'android'
$ApiLevel = 28   # Baresip's AAudio module uses AAudio calls added in 28: keep in step with minSdk in gen/android/app/build.gradle.kts
$LibsApiLevel = 26   # OpenSSL and Opus are built for an older level (it runs on newer ones): no need to rebuild them
$IsWin = $PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows

# ABI -> vcpkg architecture and the clang triple of the NDK.
$Targets = @{
    'arm64-v8a' = @{ Arch = 'arm64'; Triplet = 'arm64-android-zephone'; Host = 'aarch64-linux-android' }
    'x86_64'    = @{ Arch = 'x64';   Triplet = 'x64-android-zephone';   Host = 'x86_64-linux-android' }
}
$Abis = @($Abi -split '[,; ]+' | Where-Object { $_ })
foreach ($a in $Abis) {
    if (-not $Targets.ContainsKey($a)) { throw "unsupported ABI '$a' (supported: $($Targets.Keys -join ', '))" }
}

function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed (exit code $LASTEXITCODE)" }
}

# ---- tools ---------------------------------------------------------------------------------------
foreach ($tool in 'git', 'cmake') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "missing '$tool'" }
}
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
$ndk = if ($env:ANDROID_NDK_HOME) { $env:ANDROID_NDK_HOME } elseif ($env:NDK_HOME) { $env:NDK_HOME }
if (-not $ndk -and $sdkRoot -and (Test-Path (Join-Path $sdkRoot 'ndk'))) {
    $ndk = (Get-ChildItem (Join-Path $sdkRoot 'ndk') -Directory | Sort-Object Name | Select-Object -Last 1).FullName
}
if (-not $ndk -or -not (Test-Path $ndk)) {
    throw 'Android NDK not found: install it (sdkmanager "ndk;27.2.12479018") and set ANDROID_HOME or ANDROID_NDK_HOME'
}
$ndkToolchain = Join-Path $ndk 'build\cmake\android.toolchain.cmake'
$prebuilt = Get-ChildItem (Join-Path $ndk 'toolchains\llvm\prebuilt') -Directory | Select-Object -First 1
$strip = Join-Path $prebuilt.FullName ('bin\llvm-strip' + $(if ($IsWin) { '.exe' } else { '' }))
$env:ANDROID_NDK_HOME = $ndk   # read by vcpkg's Android toolchain
Write-Host "NDK: $ndk"

$pending = @($Abis | Where-Object { $Force -or -not (Test-Path (Join-Path $Out "$_\libbaresip.so")) })
if ($pending.Count -eq 0) {
    Write-Host "libbaresip.so already built for $($Abis -join ', ') (use -Force to redo)"
    return
}

New-Item -ItemType Directory -Force $AndroidWork | Out-Null
$Src = Join-Path $AndroidWork 'baresip'
$ReSrc = Join-Path $AndroidWork 're'

# ---- sources -------------------------------------------------------------------------------------
foreach ($p in @(@('baresip', $Src), @('re', $ReSrc))) {
    if (-not (Test-Path $p[1])) {
        Invoke-Native git @('clone', '--depth', '1', '--branch', $Tag, "https://github.com/baresip/$($p[0]).git", $p[1])
    }
}
# The same one-line patches as the other builds (see scripts/build-baresip.sh for the reasons). Idempotent.
# Android has getopt: no third patch.
$vu = Join-Path $Src 'modules/vumeter/vumeter.c'
$t = Get-Content $vu -Raw
$t = $t -replace 'tmr_start\(&st->tmr, 500,', 'tmr_start(&st->tmr, 60,'
Set-Content $vu $t -NoNewline
if (([regex]::Matches($t, 'tmr_start\(&st->tmr, 60,')).Count -ne 2) { throw 'vumeter patch not applied' }
$jb = Join-Path $Src 'src/jbuf.c'
$t = Get-Content $jb -Raw
$t = $t -replace '(?m)^#ifndef RELEASE\r?$', '#if 1 /* ZePhone: jitter buffer statistics in release builds */'
Set-Content $jb $t -NoNewline
if ($t -notmatch 'ZePhone: jitter buffer statistics') { throw 'jbuf patch not applied' }

# ---- third-party libraries (vcpkg) ------------------------------------------------------------------
$Vcpkg = Join-Path $Work 'vcpkg'
$vcpkgExe = Join-Path $Vcpkg ('vcpkg' + $(if ($IsWin) { '.exe' } else { '' }))
if (-not (Test-Path $vcpkgExe)) {
    if (-not (Test-Path $Vcpkg)) { Invoke-Native git @('clone', '--depth', '1', 'https://github.com/microsoft/vcpkg.git', $Vcpkg) }
    if ($IsWin) { Invoke-Native (Join-Path $Vcpkg 'bootstrap-vcpkg.bat') @('-disableMetrics') }
    else { Invoke-Native (Join-Path $Vcpkg 'bootstrap-vcpkg.sh') @('-disableMetrics') }
}
# Static libraries, Release only, for the API level the application targets.
$Triplets = Join-Path $AndroidWork 'triplets'
New-Item -ItemType Directory -Force $Triplets | Out-Null
foreach ($name in $Targets.Keys) {
    $tg = $Targets[$name]
    Set-Content (Join-Path $Triplets "$($tg.Triplet).cmake") @"
set(VCPKG_TARGET_ARCHITECTURE $($tg.Arch))
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)
set(VCPKG_BUILD_TYPE release)
set(VCPKG_CMAKE_SYSTEM_NAME Android)
set(VCPKG_CMAKE_SYSTEM_VERSION $LibsApiLevel)
set(VCPKG_MAKE_BUILD_TRIPLET "--host=$($tg.Host)")
set(VCPKG_CMAKE_CONFIGURE_OPTIONS -DANDROID_ABI=$name)
"@
}
$vcOverlay = "--overlay-triplets=$Triplets"

foreach ($a in $pending) {
    $tg = $Targets[$a]
    $triplet = $tg.Triplet
    Write-Host "=== $a ($triplet) ==="
    Invoke-Native $vcpkgExe @('install', '--triplet', $triplet, $vcOverlay, '--disable-metrics', "openssl:$triplet", "opus:$triplet")
    $vcInstalled = Join-Path $Vcpkg "installed\$triplet"
    $vcToolchain = Join-Path $Vcpkg 'scripts\buildsystems\vcpkg.cmake'

    # Ninja comes with vcpkg (or the PATH).
    $ninja = (Get-Command ninja -ErrorAction SilentlyContinue).Source
    if (-not $ninja) {
        $ninja = (Get-ChildItem (Join-Path $Vcpkg 'downloads\tools') -Recurse -Filter ('ninja' + $(if ($IsWin) { '.exe' } else { '' })) -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
    }
    if (-not $ninja) { throw 'ninja not found (scoop install ninja)' }

    $prefix = Join-Path $AndroidWork "install-$a"
    $common = @('-G', 'Ninja', "-DCMAKE_MAKE_PROGRAM=$ninja", '-DCMAKE_BUILD_TYPE=Release',
        "-DCMAKE_TOOLCHAIN_FILE=$vcToolchain", "-DVCPKG_CHAINLOAD_TOOLCHAIN_FILE=$ndkToolchain",
        "-DVCPKG_TARGET_TRIPLET=$triplet", "-DVCPKG_OVERLAY_TRIPLETS=$Triplets", '-DVCPKG_MANIFEST_MODE=OFF',
        "-DANDROID_ABI=$a", "-DANDROID_PLATFORM=android-$ApiLevel",
        "-DCMAKE_INSTALL_PREFIX=$prefix", "-DCMAKE_PREFIX_PATH=$prefix;$vcInstalled",
        "-DCMAKE_FIND_ROOT_PATH=$prefix;$vcInstalled")

    # libre
    $buildRe = Join-Path $AndroidWork "build-re-$a"
    Invoke-Native cmake (@('-S', $ReSrc, '-B', $buildRe, '-DLIBRE_BUILD_SHARED=OFF', '-DLIBRE_BUILD_STATIC=ON') + $common)
    Invoke-Native cmake @('--build', $buildRe, '--parallel')
    Invoke-Native cmake @('--install', $buildRe)

    # baresip (+ zeaudio, out of tree through APP_MODULES)
    $buildBs = Join-Path $AndroidWork "build-baresip-$a"
    # Only the modules the application loads (src-tauri/src/sip/engine/baresip/config.rs): Baresip would otherwise
    # try every module it knows, and fail on the ones that need tools Android does not have (pkg-config, V4L2...).
    $modules = @('g711', 'auconv', 'auresamp', 'aaudio', 'srtp', 'menu', 'ctrl_tcp', 'vumeter', 'opus')
    # libre is found by hand: the NDK toolchain only searches under CMAKE_FIND_ROOT_PATH, and Baresip's FindRE
    # looks for the header in `include/`, where libre installs it in `include/re/`.
    Invoke-Native cmake (@('-S', $Src, '-B', $buildBs, '-DSTATIC=ON', '-DAPP_MODULES=zeaudio',
            "-DRE_INCLUDE_DIR=$prefix/include/re", "-DRE_LIBRARY=$prefix/lib/libre.a",
            "-DMODULES=$($modules -join ';')",
            "-DAPP_MODULES_DIR=$(Join-Path $Root 'scripts/baresip-modules')") + $common)
    # Only the executable: Baresip's own tests (`selftest`) do not compile on x86 (they clash with bionic's
    # `struct user`) and are of no use here.
    Invoke-Native cmake @('--build', $buildBs, '--target', 'baresip_exe', '--parallel')

    $built = Join-Path $buildBs 'baresip'
    if (-not (Test-Path $built)) { throw "baresip not found in $buildBs" }

    # ---- stage -----------------------------------------------------------------------------------
    $dest = Join-Path $Out $a
    New-Item -ItemType Directory -Force $dest | Out-Null
    $lib = Join-Path $dest 'libbaresip.so'
    Copy-Item $built $lib -Force
    Invoke-Native $strip @($lib)

    # The executable cannot be run here: check it is what Android will run, and that the modules are inside.
    $bytes = [System.IO.File]::ReadAllBytes($lib)
    if ($bytes[0] -ne 0x7f -or $bytes[1] -ne 0x45 -or $bytes[2] -ne 0x4c -or $bytes[3] -ne 0x46) { throw "$lib is not an ELF file" }
    $text = [System.Text.Encoding]::ASCII.GetString($bytes)
    $missing = @('aaudio', 'zeaudio', 'opus', 'g711', 'ctrl_tcp', 'srtp', 'vumeter', 'menu', 'auresamp', 'auconv') | Where-Object { $text -notmatch [regex]::Escape($_) }
    if ($missing) { throw "modules missing from $lib`: $($missing -join ', ')" }
    Write-Host ("Prepared: {0} ({1:N1} MB)" -f $lib, ($bytes.Length / 1MB))
}
