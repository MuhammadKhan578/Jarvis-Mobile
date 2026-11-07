# Jarvis Mobile — component checker (PC side, optional)
# Checks for a JDK and the Android SDK. Downloads a JDK 17 build if none is
# found. Nothing is downloaded for the phone.

$ErrorActionPreference = "Stop"

$buildDir = Join-Path $env:LOCALAPPDATA "JarvisMobileBuild"
$jdkDir   = Join-Path $buildDir "jdk17"
$jdkZip   = Join-Path $buildDir "jdk17.zip"

function Test-Jdk($dir) {
    return (Test-Path (Join-Path $dir "bin\javac.exe"))
}

function Find-Sdk {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
        (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk"),
        "C:\Android\Sdk"
    ) | Where-Object { $_ }
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Find-Jdk {
    $candidates = @(
        $env:JAVA_HOME,
        $jdkDir,
        (Join-Path $env:ProgramFiles "Java\jdk-17"),
        (Join-Path $env:ProgramFiles "Eclipse Adoptium\jdk-17"),
        (Join-Path $env:ProgramFiles "Android\Android Studio\jbr")
    ) | Where-Object { $_ }
    foreach ($p in $candidates) {
        if (Test-Jdk $p) { return $p }
    }
    return $null
}

Write-Host "== Jarvis Mobile components check ==" -ForegroundColor Cyan

$jdk = Find-Jdk
if ($jdk) {
    Write-Host "JDK: OK  ($jdk)" -ForegroundColor Green
} else {
    Write-Host "JDK 17 not found. Downloading (~180 MB)..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
    $url = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
    curl.exe -L --fail --retry 2 -o $jdkZip $url
    if (-not (Test-Path $jdkZip)) { throw "JDK download failed." }
    Write-Host "Extracting..." -ForegroundColor Cyan
    Expand-Archive -Path $jdkZip -DestinationPath $buildDir -Force
    $newDir = Get-ChildItem $buildDir -Directory |
        Where-Object { $_.Name -like "jdk-17*" } | Select-Object -First 1
    if ($newDir -and -not (Test-Jdk $jdkDir)) {
        if (Test-Path $jdkDir) { Remove-Item $jdkDir -Recurse -Force }
        Move-Item $newDir.FullName $jdkDir -Force
    }
    if (-not (Test-Jdk $jdkDir)) { throw "JDK extracted but javac was not found." }
    Write-Host "JDK 17: installed  ($jdkDir)" -ForegroundColor Green
}

$sdk = Find-Sdk
if ($sdk) {
    $bt = Get-ChildItem (Join-Path $sdk "build-tools") -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "aapt2.exe") } |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($bt) {
        Write-Host "Android build-tools: OK  ($($bt.Name))" -ForegroundColor Green
    } else {
        Write-Host "Android build-tools not found. Install them from SDK Manager." -ForegroundColor Yellow
    }

    $plat = Get-ChildItem (Join-Path $sdk "platforms") -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "android.jar") } |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($plat) {
        Write-Host "Android platform: OK  ($($plat.Name))" -ForegroundColor Green
    } else {
        Write-Host "Android platform not found. Install one from SDK Manager." -ForegroundColor Yellow
    }
} else {
    Write-Host "Android SDK not found." -ForegroundColor Yellow
    Write-Host "Install Android Studio / SDK, or set ANDROID_HOME." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Now run:  powershell -ExecutionPolicy Bypass -File .\build_apk.ps1" -ForegroundColor Cyan
