# Builds Baresip from source for Windows (MSVC, x64) and stages it as the Tauri sidecar.
#
#   scripts\build-baresip.ps1 [-Tag v4.13.0] [-Force]
#
# Prerequisites: Visual Studio Build Tools 2022 ("Desktop development with C++"), CMake, Git.
# OpenSSL and Opus are fetched and built by vcpkg (cloned into .baresip-build\vcpkg).
#
# Baresip is built STATIC on Windows: every module is linked into baresip.exe, so the sidecar is a single
# file (no DLL search path to get right). The `module xxx.dll` lines of the generated config still work (Baresip
# resolves them against the compiled-in modules); empty `<module>.dll` marker files are shipped in the modules
# folder so the application knows which optional modules (opus, g722, vumeter, zeaudio) are available.
#
# Output (same layout as scripts/prepare-baresip.sh on macOS):
#   src-tauri\binaries\baresip-<target-triple>.exe
#   src-tauri\resources\baresip\modules\*.dll   (markers)
#   src-tauri\resources\baresip\sounds\*.wav
#   src-tauri\resources\baresip\licenses\*
[CmdletBinding()]
param(
    [string]$Tag = 'v4.13.0',
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$Tauri = Join-Path $Root 'src-tauri'
$Work = Join-Path $Root '.baresip-build'
$Triple = 'x86_64-pc-windows-msvc'
$ExeOut = Join-Path $Tauri "binaries\baresip-$Triple.exe"
$Stamp = Join-Path $Tauri "binaries\.prepared-$Triple"

if ((Test-Path $ExeOut) -and (Test-Path $Stamp) -and -not $Force) {
    Write-Host "baresip sidecar already prepared for $Triple (use -Force to redo)"
    return
}

function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed (exit code $LASTEXITCODE)" }
}

foreach ($tool in 'git', 'cmake') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "missing '$tool' (scoop install $tool)"
    }
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vsPath = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
if (-not $vsPath) {
    throw "Visual Studio Build Tools with the C++ workload were not found. Install them with:`n  winget install --id Microsoft.VisualStudio.2022.BuildTools --override `"--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`""
}
$vsMajor = ((& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion) -split '\.')[0]
$generator = switch ($vsMajor) { '18' { 'Visual Studio 18 2026' } default { 'Visual Studio 17 2022' } }

New-Item -ItemType Directory -Force $Work | Out-Null
$Src = Join-Path $Work 'baresip'
$ReSrc = Join-Path $Work 're'
$Prefix = Join-Path $Work 'install'

# ---- sources ----------------------------------------------------------------
foreach ($p in @(@('baresip', $Src), @('re', $ReSrc))) {
    if (-not (Test-Path $p[1])) {
        Invoke-Native git @('clone', '--depth', '1', '--branch', $Tag, "https://github.com/baresip/$($p[0]).git", $p[1])
    }
}

# Same two one-line patches as scripts/build-baresip.sh (see there for the reasons). Idempotent.
$vu = Join-Path $Src 'modules\vumeter\vumeter.c'
$t = Get-Content $vu -Raw
$t = $t -replace 'tmr_start\(&st->tmr, 500,', 'tmr_start(&st->tmr, 60,'
Set-Content $vu $t -NoNewline
if (([regex]::Matches($t, 'tmr_start\(&st->tmr, 60,')).Count -ne 2) { throw 'vumeter patch not applied' }
$jb = Join-Path $Src 'src\jbuf.c'
$t = Get-Content $jb -Raw
$t = $t -replace '(?m)^#ifndef RELEASE\r?$', '#if 1 /* ZePhone: jitter buffer statistics in release builds */'
Set-Content $jb $t -NoNewline
if ($t -notmatch 'ZePhone: jitter buffer statistics') { throw 'jbuf patch not applied' }

# Third patch: Baresip parses its command line only when HAVE_GETOPT is set, which MSVC never does (no getopt.h).
# Without it `-f <config dir>` would be ignored. Use a small getopt of our own on Windows.
Copy-Item (Join-Path $Root 'scripts\baresip-modules\win32\getopt.h') (Join-Path $Src 'src\getopt.h') -Force
$mn = Join-Path $Src 'src\main.c'
$t = Get-Content $mn -Raw
$t = $t -replace '(?m)^#ifdef HAVE_GETOPT\r?$', '#if defined(HAVE_GETOPT) || defined(WIN32) /* ZePhone: getopt on Windows */'
Set-Content $mn $t -NoNewline
if (([regex]::Matches($t, 'ZePhone: getopt on Windows')).Count -ne 3) { throw 'getopt patch not applied' }

# ---- third-party libraries (vcpkg) -------------------------------------------------
$Vcpkg = Join-Path $Work 'vcpkg'
if (-not (Test-Path (Join-Path $Vcpkg 'vcpkg.exe'))) {
    if (-not (Test-Path $Vcpkg)) { Invoke-Native git @('clone', '--depth', '1', 'https://github.com/microsoft/vcpkg.git', $Vcpkg) }
    Invoke-Native (Join-Path $Vcpkg 'bootstrap-vcpkg.bat') @('-disableMetrics')
}
# Static libraries, shared CRT (nothing to ship next to the exe), Release only: a Debug build of Opus/OpenSSL
# would pull in the debug CRT and fail to link into the Release executable.
$VcTriplet = 'x64-windows-static-md-rel'
$Triplets = Join-Path $Work 'triplets'
New-Item -ItemType Directory -Force $Triplets | Out-Null
Set-Content (Join-Path $Triplets "$VcTriplet.cmake") @'
set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)
set(VCPKG_BUILD_TYPE release)
'@
$VcOverlay = "--overlay-triplets=$Triplets"
# G.722 is not available on Windows: its Baresip module needs spandsp, which vcpkg does not provide.
Invoke-Native (Join-Path $Vcpkg 'vcpkg.exe') @('install', '--triplet', $VcTriplet, $VcOverlay, '--disable-metrics', "openssl:$VcTriplet", "opus:$VcTriplet")
$VcInstalled = Join-Path $Vcpkg "installed\$VcTriplet"
$Toolchain = Join-Path $Vcpkg 'scripts\buildsystems\vcpkg.cmake'
$common = @('-G', $generator, '-A', 'x64', "-DCMAKE_TOOLCHAIN_FILE=$Toolchain", "-DVCPKG_TARGET_TRIPLET=$VcTriplet",
    "-DCMAKE_INSTALL_PREFIX=$Prefix", "-DCMAKE_PREFIX_PATH=$Prefix;$VcInstalled", '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL')

# ---- libre -----------------------------------------------------------------------------
Invoke-Native cmake (@('-S', $ReSrc, '-B', (Join-Path $Work 'build-re'), '-DLIBRE_BUILD_SHARED=OFF', '-DLIBRE_BUILD_STATIC=ON') + $common)
Invoke-Native cmake @('--build', (Join-Path $Work 'build-re'), '--config', 'Release', '--parallel')
Invoke-Native cmake @('--install', (Join-Path $Work 'build-re'), '--config', 'Release')

# ---- baresip (+ zeaudio, out of tree through APP_MODULES) -----------------------------------
Invoke-Native cmake (@('-S', $Src, '-B', (Join-Path $Work 'build'), '-DSTATIC=ON',
        '-DAPP_MODULES=zeaudio', "-DAPP_MODULES_DIR=$(Join-Path $Root 'scripts\baresip-modules')") + $common)
Invoke-Native cmake @('--build', (Join-Path $Work 'build'), '--config', 'Release', '--parallel')
Invoke-Native cmake @('--install', (Join-Path $Work 'build'), '--config', 'Release')

$built = Join-Path $Prefix 'bin\baresip.exe'
if (-not (Test-Path $built)) { throw "baresip.exe not found in $Prefix\bin" }

# ---- stage the sidecar ------------------------------------------------------------------
$bin = Join-Path $Tauri 'binaries'
$res = Join-Path $Tauri 'resources\baresip'
Remove-Item -Recurse -Force $bin, $res -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $bin, "$res\modules", "$res\sounds", "$res\licenses" | Out-Null
Copy-Item $built $ExeOut

$sounds = Join-Path $Prefix 'share\baresip'
foreach ($s in 'ring.wav', 'ringback.wav') { Copy-Item (Join-Path $sounds $s) "$res\sounds\$s" }

# Modules are compiled into baresip.exe: ship one marker per module the application may ask for.
$modules = 'g711', 'auconv', 'auresamp', 'wasapi', 'srtp', 'menu', 'ctrl_tcp', 'vumeter', 'zeaudio', 'opus'
foreach ($m in $modules) {
    Set-Content -Path "$res\modules\$m.dll" -Value "Built into baresip.exe (static build). This marker only tells ZePhone the module is available.`n" -NoNewline
}

# Licences: Baresip, libre, and the libraries linked into the executable.
Copy-Item (Join-Path $Src 'LICENSE') "$res\licenses\baresip-LICENSE"
Copy-Item (Join-Path $ReSrc 'LICENSE') "$res\licenses\libre-LICENSE"
$manifest = @("baresip $Tag", "libre $Tag")
foreach ($pkg in 'openssl', 'opus') {
    $copyright = Join-Path $Vcpkg "installed\$VcTriplet\share\$pkg\copyright"
    if (Test-Path $copyright) {
        Copy-Item $copyright "$res\licenses\$pkg-LICENSE"
        $manifest += $pkg
    }
}
Set-Content "$res\licenses\MANIFEST.txt" ($manifest -join "`n") -NoNewline

# `baresip -h` exits non-zero: check its output rather than its status.
$ErrorActionPreference = 'Continue'   # the usage text goes to stderr
$help = (& $ExeOut -h 2>&1 | Out-String)
$ErrorActionPreference = 'Stop'
if ($help -notmatch 'Usage: baresip') { throw 'the built baresip.exe does not start or does not parse its command line' }

New-Item -ItemType File $Stamp -Force | Out-Null
Write-Host "Prepared: $ExeOut"
Write-Host "  modules: $($modules -join ' ')"
