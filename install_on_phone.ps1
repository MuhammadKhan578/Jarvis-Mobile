# Jarvis Mobile - install the built APK on a USB-connected phone.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install_on_phone.ps1
#   powershell -ExecutionPolicy Bypass -File .\install_on_phone.ps1 -Sdk "C:\Android\Sdk"

param(
    [string]$Sdk = "",
    [string]$Apk = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not $Apk) { $Apk = Join-Path $root "JarvisMobile.apk" }

if (-not (Test-Path $Apk)) {
    throw "JarvisMobile.apk not found. Run build_apk.ps1 first."
}

function Find-Adb {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        $Sdk,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
        (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk"),
        "C:\Android\Sdk"
    ) | Where-Object { $_ }

    foreach ($p in $candidates) {
        $adb = Join-Path $p "platform-tools\adb.exe"
        if (Test-Path $adb) { return $adb }
    }

    $cmd = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$adb = Find-Adb
if (-not $adb) {
    throw "adb not found. Install Android SDK platform-tools, or pass -Sdk <path>."
}

Write-Host "Looking for a phone..." -ForegroundColor Cyan
$devices = & $adb devices
$devices | ForEach-Object { Write-Host $_ }

$ready = $devices | Where-Object { $_ -match "\sdevice$" }
if (-not $ready) {
    Write-Host ""
    Write-Host "No phone found. Enable USB debugging, connect the cable," -ForegroundColor Yellow
    Write-Host "then tap Allow on the phone when 'adb devices' asks." -ForegroundColor Yellow
    exit 1
}

Write-Host "Installing..." -ForegroundColor Cyan
& $adb install -r $Apk
if ($LASTEXITCODE -ne 0) { throw "Install failed." }

Write-Host "Launching..." -ForegroundColor Cyan
& $adb shell am start -n com.jarvis.mobile/.MainActivity
Write-Host "Done. Jarvis should now be open on the phone." -ForegroundColor Green
