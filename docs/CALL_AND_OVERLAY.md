# Real auto-call and screen highlight (Android)

These are **real device actions**, not simulations. No call success, overlay, or
transcript is ever reported unless the native Android API returned a real result.
The release build stays non-debuggable, version `2.3.2` / `versionCode 16`, and
tap-to-talk remains the default (hands-free and background wake word are opt-in).

## 1. Permissions (declared in `app/AndroidManifest.xml`)

- `android.permission.CALL_PHONE` — dangerous runtime permission. Jarvis asks for
  it when you say **"call permission do"** (or call `requestCallPermission()`).
  Check the real state with `canCallPhone()` / `call_status`.
- `android.permission.SYSTEM_ALERT_WINDOW` — **special** permission, NOT a normal
  runtime permission. You must enable **Settings → Apps → Jarvis → Display over
  other apps** (the tool opens `ACTION_MANAGE_OVERLAY_PERMISSION` for you).
  Until then `OverlayGuide` returns `permission: "needed"` and draws nothing.

No other permissions were added. No debug-only command hook was added to release
behavior; the existing QA hooks in `MainActivity` remain debug-only and untouched.

## 2. Auto-call setup (explicit, one-time opt-in)

Jarvis will never place a silent call by default. All three must be true:

1. A number is saved: say **"call setup +92 3xx xxxxxxx"**, then answer **"haan"**
   to the confirmation. Until you confirm, nothing is saved or enabled.
2. `CALL_PHONE` is granted in Android Settings.
3. Auto-call is explicitly enabled: say **"auto call on"**, or the confirmed
   `call setup` flow sets it. Say **"auto call off"** to revoke the opt-in.

Then **"mujhe call kar"**, **"jarvis call kare"** or **"call me when needed"**
calls `auto_call`. `AppIntents.autoCall` checks the three conditions, then fires
`Intent.ACTION_CALL` (`tel:<number>`) from the app/accessibility service context.
`ok:true` means only that `startActivity` did not throw — it does **not** mean the
call was answered. A `SecurityException`, a missing step, or a blocked background
start returns `ok:false` with `needs_user_action` and the exact step to fix.

Every attempt is recorded in private `SharedPreferences` (`jarvis_mobile`) with
`auto_call_last_ts`, `auto_call_last_number`, `auto_call_last_reason` and
`auto_call_last_ok`. **"call status"** (or `call_status`) reports all of this
factually. `call_number` is unchanged: it still opens the dialer with
`ACTION_DIAL` and requires you to press Call.

### Android limits — read this

- Android 10+ (API 29+) normally **blocks activity starts from the background**,
  including `ACTION_CALL`. A foreground `JarvisService` with its ongoing
  notification is required to keep the app in an allowed state, and some OEMs
  (Xiaomi, Samsung, OnePlus, etc.) still block or prompt for calls from
  background apps even then. If Jarvis is not visible, the result honestly asks
  you to open Jarvis or enable **Phone automation** (accessibility), which is a
  documented background-start exemption. There is no way around a hard OEM block.
- **No incoming call interception, no call answering, no call recording and no
  call transcript.** Android does not give a normal app these capabilities. The
  old `phone_agent_operation` transcript action still answers honestly that it
  cannot do this. Never treat TTS/STT text as a call transcript.

## 3. Screen highlight

**"screen par dikhao"**, **"highlight karo"** or **"ye button dikhao"** runs
`overlay_highlight`. If exact accessibility bounds (`x`, `y`, `width`, `height`)
are supplied, `OverlayGuide.show()` draws there. If only a label is supplied,
the real bounds are looked up from the accessibility node tree (Phone automation
must be on) and used. The result is a real `WindowManager` view of type
`TYPE_APPLICATION_OVERLAY` (API 26+) drawing a translucent purple rounded/circular
highlight with a red border and a small label. It is non-focusable and
non-touchable, so it cannot swallow your taps.

**"highlight hatao"** calls `overlay_hide` and removes the actual view.
`overlayStatus()` / `canDrawOverlay()` report the true state. If the permission is
off, no view is added and the JSON includes `permission: "needed"` plus an intent
for `android.settings.action.MANAGE_OVERLAY_PERMISSION`.

Highlights follow the bounds Android reports at that moment; they do not track a
moving element, are not screenshots, and do not read the screen unless Phone
automation is on.

## 4. Tool/native surface (for QA)

- JS tools: `auto_call`, `overlay_highlight`, `overlay_hide`, `call_status`
  (declared in `toolDeclarations()`, routed in `runTool()` and `callTool()`).
- `@JavascriptInterface`: `canDrawOverlay`, `openOverlaySettings`, `overlayShow`,
  `overlayHide`, `overlayStatus`, `canCallPhone`, `requestCallPermission`,
  `setAutoCallNumber`, `getAutoCallNumber`, `setAutoCallEnabled`,
  `getAutoCallEnabled`, `autoCall`.
- AppIntents cases: `auto_call`, `overlay_highlight`, `overlay_hide`,
  `overlay_settings`, `call_status`.

Static checks live in `tests/mobile_reel_test.ps1`. No APK is built or claimed
passing by these source checks.
