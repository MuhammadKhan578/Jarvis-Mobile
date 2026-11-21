# Jarvis Mobile v2.3.1 release notes

Adds two real Android capabilities on top of v2.3.0. The release APK stays
signed and **non-debuggable**.

## New in v2.3.1

- **Auto-call:** `CALL_PHONE` permission, explicit one-time opt-in, saved callback
  number, and a real `ACTION_CALL` attempt. It reports success only when Android
  accepts the intent; failures and OEM/background restrictions are reported
  honestly. Commands: "call setup <number>", "mujhe call kar / call me when
  needed", "call status". See `docs/CALL_AND_OVERLAY.md`.
- **Highlight overlay:** a real `TYPE_APPLICATION_OVERLAY` purple/red circle and
  label drawn at accessibility bounds. Requires the user to grant "Display over
  other apps"; without permission it says so and opens the settings screen.
  Commands: "screen par dikhao / highlight karo", "highlight hatao".
- Tap-to-talk remains the default; hands-free/background listening is still
  explicit opt-in. Debug-only QA hooks are unchanged and unavailable in release.

## Honest limits

- This app cannot intercept an incoming phone call or provide call
  recording/transcript on Android. For "call Jarvis and give commands", use the
  PC Twilio line documented in the PC repository.
- The overlay needs a permission prompt; it is not a silent desktop-style HUD.
- Smart-home devices remain virtual without an optional Home Assistant setup.

## Verification

- `node --check app\assets\www\app.js` — clean.
- `powershell -ExecutionPolicy Bypass -File .\tests\mobile_reel_test.ps1` —
  **95 checks passed, 0 failed**.
- APK: version `2.3.1`, versionCode `15`, signed (v2/v3), non-debuggable.
- SHA256: `B73575373EE2DD322DE8167BB39EB32242D21F53111396156740A2353844F45F`
