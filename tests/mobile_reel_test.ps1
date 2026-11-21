$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'app'
$js = Join-Path $app 'assets\www\app.js'
$manifest = Join-Path $app 'AndroidManifest.xml'
$bridge = Join-Path $app 'java\com\jarvis\mobile\JsBridge.java'
$intents = Join-Path $app 'java\com\jarvis\mobile\AppIntents.java'
$overlay = Join-Path $app 'java\com\jarvis\mobile\OverlayGuide.java'
$docs = Join-Path $root 'docs\CALL_AND_OVERLAY.md'
$build = Join-Path $root 'build_apk.ps1'
$apk = Join-Path $root 'JarvisMobile.apk'
$fail = 0
$pass = 0
$skip = 0

function Check($name, [bool]$ok) {
  if ($ok) { Write-Host "PASS $name" -ForegroundColor Green; $script:pass++ }
  else { Write-Host "FAIL $name" -ForegroundColor Red; $script:fail++ }
}
function SkipCheck($name) {
  Write-Host "SKIP $name" -ForegroundColor Yellow
  $script:skip++
}

$jsText = Get-Content $js -Raw
$manifestText = Get-Content $manifest -Raw
$bridgeText = Get-Content $bridge -Raw
$intentsText = Get-Content $intents -Raw
$buildText = Get-Content $build -Raw
$overlayText = if (Test-Path $overlay) { Get-Content $overlay -Raw } else { '' }
$docsText = if (Test-Path $docs) { Get-Content $docs -Raw } else { '' }

Check 'app.js version' ($jsText -match "2\.3\.1")
Check 'manifest version' ($manifestText -match 'versionCode="15"' -and $manifestText -match 'versionName="2\.3\.1"')
Check 'build script version' ($buildText -match '"2\.3\.1"' -and $buildText -match '\$VersionCode = 15')
Check 'release APK not debuggable in manifest' ($manifestText -notmatch 'android:debuggable="true"')

# Existing reel tools (unchanged).
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

# --- New: real permissions -------------------------------------------------
Check 'manifest CALL_PHONE permission' ($manifestText -match '<uses-permission android:name="android\.permission\.CALL_PHONE"\s*/>')
Check 'manifest SYSTEM_ALERT_WINDOW permission' ($manifestText -match '<uses-permission android:name="android\.permission\.SYSTEM_ALERT_WINDOW"\s*/>')

# --- New: JS tool declarations + routing ----------------------------------
$newTools = @('auto_call', 'overlay_highlight', 'overlay_hide', 'call_status')
foreach ($tool in $newTools) {
  Check "declares $tool" ($jsText -match "name: '$tool'")
  Check "routes $tool in runTool/callTool" ($jsText -match "name === '$tool'")
}

# --- New: real native bridge methods --------------------------------------
$newNative = @('canDrawOverlay', 'openOverlaySettings', 'overlayShow', 'overlayHide',
  'overlayStatus', 'canCallPhone', 'requestCallPermission', 'setAutoCallNumber',
  'getAutoCallNumber', 'setAutoCallEnabled', 'getAutoCallEnabled', 'autoCall')
foreach ($method in $newNative) {
  Check "bridge $method" ($bridgeText -match "public (void|String|boolean) $method\(")
  Check "bridge $method is @JavascriptInterface" ($bridgeText -match "@JavascriptInterface\s+public (void|String|boolean) $method\(")
}

# --- New: OverlayGuide really draws an overlay ----------------------------
Check 'OverlayGuide.java exists' (Test-Path $overlay)
Check 'overlay uses TYPE_APPLICATION_OVERLAY' ($overlayText -match 'TYPE_APPLICATION_OVERLAY')
Check 'overlay checks Settings.canDrawOverlays' ($overlayText -match 'Settings\.canDrawOverlays')
Check 'overlay offers MANAGE_OVERLAY_PERMISSION intent' ($overlayText -match 'ACTION_MANAGE_OVERLAY_PERMISSION')
foreach ($method in @('show', 'hide', 'isShown', 'canDraw')) {
  Check "OverlayGuide has $method()" ($overlayText -match "(public|static).*\b$method\(")
}

# --- New: AppIntents cases and real ACTION_CALL ---------------------------
foreach ($caseName in @('auto_call', 'overlay_highlight', 'overlay_hide', 'overlay_settings', 'call_status')) {
  Check "AppIntents case $caseName" ($intentsText -match "case `"$caseName`":")
}
Check 'AppIntents uses Intent.ACTION_CALL' ($intentsText -match 'Intent\.ACTION_CALL')
Check 'AppIntents catches SecurityException' ($intentsText -match 'catch \(SecurityException')
Check 'AppIntents records last attempt fields' ($intentsText -match 'auto_call_last_ts' -and $intentsText -match 'auto_call_last_number' -and $intentsText -match 'auto_call_last_reason' -and $intentsText -match 'auto_call_last_ok')
Check 'AppIntents auto-call opt-in defaults false' ($intentsText -match 'getBoolean\(KEY_AUTO_CALL_ENABLED, false\)')

# --- New: JS defaults, local routes, honest notes -------------------------
Check 'DEFAULTS autoCallEnabled false' ($jsText -match 'autoCallEnabled:\s*false')
Check "DEFAULTS autoCallNumber ''" ($jsText -match "autoCallNumber:\s*''")
foreach ($phrase in @('mujhe call kar', 'jarvis call kare', 'call me when needed',
    'screen par dikhao', 'highlight karo', 'highlight hatao', 'call setup')) {
  Check "local command route: $phrase" ($jsText -match [regex]::Escape($phrase))
}
Check 'help mentions Display over other apps' ($jsText -match 'Display over other apps')
Check 'about mentions explicit opt-in' ($jsText -match 'explicit opt-in')
Check 'settings default handsFree unchanged' ($jsText -match 'handsFree:\s*false')
Check 'settings default alwaysOn unchanged' ($jsText -match 'alwaysOn:\s*false')

# --- New: documentation ----------------------------------------------------
Check 'docs/CALL_AND_OVERLAY.md exists' (Test-Path $docs)
Check 'docs state ACTION_CALL is real' ($docsText -match 'ACTION_CALL')
Check 'docs state no recording/transcript' ($docsText -match 'transcript')
Check 'docs state background call limits' ($docsText -match 'Android 10\+')

if (Get-Command node -ErrorAction SilentlyContinue) {
  & node --check $js 2>&1 | Out-Null
  Check 'JavaScript syntax' ($LASTEXITCODE -eq 0)
} else {
  SkipCheck 'JavaScript syntax (node not installed)'
}

if (Test-Path $apk) {
  $sdk = $env:ANDROID_HOME
  if (-not $sdk) { $sdk = 'C:\Users\Shahid\AppData\Local\Android\Sdk' }
  $signer = Join-Path $sdk 'build-tools\36.0.0\apksigner.bat'
  if (Test-Path $signer) {
    & $signer verify $apk 2>&1 | Out-Null
    Check 'APK signature' ($LASTEXITCODE -eq 0)
  } else {
    SkipCheck 'APK signature (apksigner not found)'
  }
} else {
  Check 'APK exists' $false
}

Write-Host "RESULT pass=$pass skip=$skip fail=$fail" -ForegroundColor Cyan
if ($fail) { throw "$fail mobile reel checks failed" }
Write-Host 'ALL MOBILE REEL CHECKS PASSED' -ForegroundColor Cyan
