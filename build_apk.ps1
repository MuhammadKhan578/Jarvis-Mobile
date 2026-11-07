# ------------------------------------------------------------------
#  Jarvis Mobile - APK builder (no Gradle required)
#  Builds the APK with the Android SDK command-line tools:
#    aapt2 -> javac -> d8 -> zip -> zipalign -> apksigner
#
#  Requirements:
#    - JDK 17+            (auto-detected, or pass -Jdk)
#    - Android SDK        (auto-detected, or pass -Sdk)
#    - Python 3 on PATH   (only used to add classes.dex to the APK)
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File .\build_apk.ps1
#    powershell -ExecutionPolicy Bypass -File .\build_apk.ps1 -Sdk "C:\Android\Sdk" -Jdk "C:\Program Files\Java\jdk-17"
# ------------------------------------------------------------------
param(
    [string]$Sdk = "",
    [string]$Jdk = "",
    [string]$VersionName = "1.5.0",
    [int]$VersionCode = 6
)

$ErrorActionPreference = "Stop"

$root  = $PSScriptRoot
$app   = Join-Path $root "app"
$build = Join-Path $root "build"

function Step($name) { Write-Host ""; Write-Host "==> $name" -ForegroundColor Cyan }

function Find-First($paths) {
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

# ---------------------------------------------------------------- Android SDK
$sdkCandidates = @(
    $Sdk,
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
    (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk"),
    "C:\Android\Sdk"
) | Where-Object { $_ }

$sdk = Find-First $sdkCandidates
if (-not $sdk) {
    throw "Android SDK not found. Set ANDROID_HOME or pass -Sdk <path>."
}
if (-not (Test-Path (Join-Path $sdk "build-tools"))) {
    throw "Android build-tools not found under $sdk. Install them with SDK Manager."
}

$bt = Get-ChildItem (Join-Path $sdk "build-tools") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "aapt2.exe") } |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $bt) { throw "No usable Android build-tools found under $($sdk)\build-tools." }
$bt = $bt.FullName

$plat = Get-ChildItem (Join-Path $sdk "platforms") -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "android.jar") } |
    Sort-Object { [int](($_.Name -replace '^android-', '') -replace '\..*$', '') } -Descending |
    Select-Object -First 1
if (-not $plat) { throw "No Android platform (android.jar) found under $($sdk)\platforms." }
$android = Join-Path $plat.FullName "android.jar"
$targetApi = [int](($plat.Name -replace '^android-', '') -replace '\..*$', '')

$aapt2    = Join-Path $bt "aapt2.exe"
$d8       = Join-Path $bt "d8.bat"
$zipalign = Join-Path $bt "zipalign.exe"
$apksign  = Join-Path $bt "apksigner.bat"

# ---------------------------------------------------------------- JDK
function Find-Jdk($extra) {
    $candidates = @(
        $extra,
        $env:JAVA_HOME,
        (Join-Path $env:LOCALAPPDATA "JarvisMobileBuild\jdk17"),
        (Join-Path $env:ProgramFiles "Java\jdk-17"),
        (Join-Path $env:ProgramFiles "Eclipse Adoptium\jdk-17"),
        (Join-Path $env:ProgramFiles "Android\Android Studio\jbr")
    ) | Where-Object { $_ }
    foreach ($p in $candidates) {
        if (Test-Path (Join-Path $p "bin\javac.exe")) { return $p }
    }

    $roots = @(
        (Join-Path $env:ProgramFiles "Java"),
        (Join-Path $env:ProgramFiles "Eclipse Adoptium"),
        (Join-Path $env:LOCALAPPDATA "Programs\Eclipse Adoptium"),
        (Join-Path $env:LOCALAPPDATA "JarvisMobileBuild")
    )
    foreach ($r in $roots) {
        if (-not (Test-Path $r)) { continue }
        $hit = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.FullName "bin\javac.exe") } |
            Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

$jdk = Find-Jdk $Jdk
if (-not $jdk) {
    throw "JDK 17+ not found. Set JAVA_HOME, install a JDK, or pass -Jdk <path>."
}

$javac   = Join-Path $jdk "bin\javac.exe"
$keytool = Join-Path $jdk "bin\keytool.exe"

$env:JAVA_HOME = $jdk
$env:PATH = "$($jdk)\bin;$bt;$env:PATH"

# ---------------------------------------------------------------- prerequisites
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python 3 is required on PATH (it adds classes.dex to the APK)."
}

foreach ($tool in @($aapt2, $d8, $zipalign, $apksign, $javac, $keytool)) {
    if (-not (Test-Path $tool)) { throw "Missing build tool: $tool" }
}

Write-Host "SDK:     $sdk"
Write-Host "Tools:   $bt"
Write-Host "JDK:     $jdk"
Write-Host "Compile: $($plat.Name)"

# ---------------------------------------------------------------- clean
Step "Clean build"
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $build | Out-Null
New-Item -ItemType Directory -Force -Path "$build\gen" | Out-Null
New-Item -ItemType Directory -Force -Path "$build\classes" | Out-Null
New-Item -ItemType Directory -Force -Path "$build\dex" | Out-Null

# ---------------------------------------------------------------- assets
Step "Prepare assets"
$cfg = Join-Path $app "assets\config.properties"
if (Test-Path $cfg) {
    Write-Host "Note: app/assets/config.properties found. Its key will be embedded in this APK." -ForegroundColor Yellow
} else {
    Write-Host "No config.properties (normal). Users enter the key in the app." -ForegroundColor Green
}

# ---------------------------------------------------------------- resources
Step "Compile resources (aapt2 compile)"
& $aapt2 compile --dir (Join-Path $app "res") -o "$build\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

Step "Link resources + manifest (aapt2 link)"
& $aapt2 link `
    -o "$build\base.apk" `
    -I $android `
    --manifest (Join-Path $app "AndroidManifest.xml") `
    -R "$build\res.zip" `
    --java "$build\gen" `
    -A (Join-Path $app "assets") `
    --min-sdk-version 26 `
    --target-sdk-version $targetApi `
    --version-code $VersionCode `
    --version-name $VersionName `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

# ---------------------------------------------------------------- javac
Step "Compile Java"
$sources = @()
$sources += Get-ChildItem -Path (Join-Path $app "java") -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem -Path "$build\gen" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$argFile = "$build\sources.txt"
Set-Content -Path $argFile -Value ($sources | ForEach-Object { '"' + ($_ -replace '\\','/') + '"' }) -Encoding ASCII
& $javac -encoding UTF-8 -source 8 -target 8 -nowarn -classpath $android -d "$build\classes" "@$argFile"
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

# ---------------------------------------------------------------- d8
Step "Dex (d8)"
$classFiles = Get-ChildItem -Path "$build\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
$classList = "$build\classes.txt"
Set-Content -Path $classList -Value ($classFiles | ForEach-Object { $_ -replace '\\','/' }) -Encoding ASCII
& $d8 --release --min-api 26 --lib $android --output "$build\dex" "@$classList"
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

# ---------------------------------------------------------------- package
Step "Package dex into APK"
$unsigned = "$build\unsigned.apk"
Copy-Item "$build\base.apk" $unsigned -Force
$py = @'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
print("dex added")
'@
$pyFile = "$build\add_dex.py"
Set-Content -Path $pyFile -Value $py -Encoding ASCII
& python $pyFile $unsigned "$build\dex\classes.dex"
if ($LASTEXITCODE -ne 0) { throw "packaging failed" }

Step "Align (zipalign)"
$aligned = "$build\aligned.apk"
& $zipalign -f -p 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

# ---------------------------------------------------------------- sign
Step "Sign (apksigner)"
$ksDir = Join-Path $root "keystore"
New-Item -ItemType Directory -Force -Path $ksDir | Out-Null
$ks = Join-Path $ksDir "jarvis.keystore"

# A random development password is generated on first build and kept in the
# git-ignored keystore folder, so no password is ever stored in source.
$passFile = Join-Path $ksDir "keystore.pass"

$storePass = $env:JARVIS_STORE_PASS
if (-not $storePass -and (Test-Path $passFile)) {
    $storePass = (Get-Content $passFile -Raw).Trim()
}
if (-not $storePass) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $storePass = [Convert]::ToBase64String($bytes).Replace('/', '_').Replace('+', '-').Replace('=', '')
    Set-Content -Path $passFile -Value $storePass -Encoding ASCII
}

$keyPass = $env:JARVIS_KEY_PASS
if (-not $keyPass -and (Test-Path $passFile)) {
    $keyPass = (Get-Content $passFile -Raw).Trim()
}
if (-not $keyPass) { $keyPass = $storePass }

if (-not (Test-Path $ks)) {
    Write-Host "No keystore found - generating a local development keystore." -ForegroundColor Yellow
    & $keytool -genkeypair -v `
        -keystore $ks `
        -alias jarvis `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $storePass -keypass $keyPass `
        -dname "CN=Jarvis Mobile, O=Jarvis, C=US"
    if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
    Write-Host "Keystore created at $ks (git-ignored). Back it up if you publish updates." -ForegroundColor Yellow
}

$out = Join-Path $root "JarvisMobile.apk"
& $apksign sign `
    --ks $ks --ks-key-alias jarvis `
    --ks-pass "pass:$storePass" --key-pass "pass:$keyPass" `
    --out $out $aligned
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

Step "Verify"
& $apksign verify --verbose $out
if ($LASTEXITCODE -ne 0) { throw "signature verify failed" }

Write-Host ""
Write-Host "BUILD OK -> $out" -ForegroundColor Green
Write-Host ("Size: {0:N1} MB" -f ((Get-Item $out).Length / 1MB))
