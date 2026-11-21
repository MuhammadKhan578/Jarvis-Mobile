# Jarvis Mobile v2.3.2 release notes

Adds the Android half of the direct Mobile Jarvis ↔ PC Jarvis link. The release
APK stays signed and **non-debuggable**.

## New in v2.3.2

- **Device Link panel:** enter the PC's LAN IP, port `8766` and the one-time code
  from `device link code`, then Connect. A random token is saved on the phone and
  required for every later request.
- **Any-file upload:** `ye file PC par bhejo` opens the system picker for photos,
  videos, zips and documents. The file is streamed to the PC over Wi‑Fi. Success
  is shown only when the PC's real JSON says `ok: true`.
- **Ask-then-save:** PC Jarvis speaks "PC par kaha save karna hai?". Say
  `PC par Downloads mein save karo` or `D:\backup\photo.jpg mein save karo`.
  If the target exists, Jarvis asks for confirmation; say `confirm save` and the
  explicit confirmed request is sent. Nothing is overwritten silently.
- **Wi‑Fi intercom:** `PC Jarvis ko call karo` starts a voice loop. Each spoken
  command goes to the PC over `/link/command`, the real PC reply is spoken, and
  the mic is re-armed for the next command until you say `band karo`/`goodbye`.
- **Honest native result:** no fake upload, fake save, fake call or fake phone
  number. Plain HTTP is restricted to private LAN IPs / `.local` hosts.

## Important clarification

**Ye phone call nahi hai.** Isme koi SIM number nahi chahiye — ye sirf same
Wi‑Fi / hotspot par app ke andar ka voice intercom hai. Real telephone call ke
liye PC repository ki Twilio line (`docs/PHONE_LINE.md`) chahiye.

## Honest limits

- Same Wi‑Fi or hotspot required; there is no cloud relay.
- 200 MB per file cap from the PC server.
- No incoming-call interception or call recording on Android.
- Debug-only QA hooks remain unavailable in the release APK.

## Verification

- `node --check app\assets\www\app.js` — clean.
- `powershell -ExecutionPolicy Bypass -File .\tests\mobile_reel_test.ps1` —
  **161 checks passed, 0 failed**.
- APK: version `2.3.2`, versionCode `16`, signed (v2/v3), non-debuggable.
- SHA256: `B2995F27E011FE8A1A93C12491160344A0131C73FE7D7ED6F3B02BBB5D9C16E0`
  (verified from the final signed APK; download and compare before install).
