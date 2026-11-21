$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$js = Join-Path $app 'assets\www\app.js'
$manifest = Join-Path $app 'AndroidManifest.xml'
$bridge = Join-Path $app 'java\com\jarvis\mobile\JsBridge.java'
$build = Join-Path $root 'build_apk.ps1'
$apk = Join-Path $root 'JarvisMobile.apk'
$fail = 0

function Check($name, [bool]$ok) {
  if ($ok) { Write-Host "PASS $name" -ForegroundColor Green }
  else { Write-Host "FAIL $name" -ForegroundColor Red; $script:fail++ }
}

$jsText = Get-Content $js -Raw
$manifestText = Get-Content $manifest -Raw
$bridgeText = Get-Content $bridge -Raw
$buildText = Get-Content $build -Raw

Check 'app.js version' ($jsText -match "2\.3\.0")
Check 'manifest version' ($manifestText -match 'versionCode="14"' -and $manifestText -match 'versionName="2\.3\.0"')
Check 'build script version' ($buildText -match '"2\.3\.0"' -and $buildText -match '\$VersionCode = 14')
Check 'release APK not debuggable in manifest' ($manifestText -notmatch 'android:debuggable="true"')

$tools = @('iss_operation', 'image_operation', 'video_operation', 'commerce_operation',
  'analytics_operation', 'notification_operation', 'phone_agent_operation', 'game_operation')
foreach ($tool in $tools) {
  Check "declares $tool" ($jsText -match "name: '$tool'")
  Check "routes $tool" ($jsText -match "name === '$tool'")
}

$native = @('pickMedia', 'editPhoto', 'trimVideo', 'openMedia', 'mediaSelfTest')
foreach ($method in $native) {
  Check "bridge $method" ($bridgeText -match "public (void|String) $method\(")
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  & node --check $js 2>&1 | Out-Null
  Check 'JavaScript syntax' ($LASTEXITCODE -eq 0)
} else {
  Write-Host 'SKIP JavaScript syntax (node not installed)'
}

if (Test-Path $apk) {
  $sdk = $env:ANDROID_HOME
  if (-not $sdk) { $sdk = 'C:\Users\Shahid\AppData\Local\Android\Sdk' }
  $signer = Join-Path $sdk 'build-tools\36.0.0\apksigner.bat'
  if (Test-Path $signer) {
    & $signer verify $apk 2>&1 | Out-Null
    Check 'APK signature' ($LASTEXITCODE -eq 0)
  } else {
    Write-Host 'SKIP APK signature (apksigner not found)'
  }
} else {
  Check 'APK exists' $false
}

if ($fail) { throw "$fail mobile reel checks failed" }
Write-Host 'ALL MOBILE REEL CHECKS PASSED' -ForegroundColor Cyan
