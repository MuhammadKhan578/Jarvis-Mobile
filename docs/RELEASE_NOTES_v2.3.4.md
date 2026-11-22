# Jarvis Mobile v2.3.4 release notes

## Real bug fixes carried over from v2.3.3 QA

- `call status` no longer sends a JavaScript object into a Java `String`
  parameter. Native tool arguments are now JSON strings.
- The Android speech recognizer now receives `Integer` extras for silence
  windows instead of `Long`, removing the
  `expected Integer but value was a java.lang.Long` warning on TECNO CAMMON 40 Pro.

## New in v2.3.4

- **Optional one-person voice check.** After the Gemini API key (or after
  choosing "key later"), a skippable card asks whether only your voice should
  control spoken commands. Two short samples are reduced to a 13-value MFCC
  vector and stored in private app storage on the phone. No audio is uploaded,
  no account is needed, and the card says clearly that this is not a biometric
  guarantee.
- **Voice lock setting.** Settings now has `Sirf meri awaaz (voice lock)` with
  enroll, clear and on/off controls. When on, a spoken command that does not
  match the enrolled voice is rejected before handling. Typed commands and the
  setup itself are never blocked.
- **Natural greeting.** `Hello Jarvis, kaise ho` is answered locally and
  instantly with `Kya hua sir? Main bilkul theek hoon, aap bataiye.` This works
  even before an API key is saved.
- **Guided YouTube song play.** `youtube kholo aur <song> gana chalao` opens the
  real YouTube app, uses accessibility to search and tries to start the first
  matching video. If playback cannot be proven, the reply says exactly that and
  leaves the choice to you.
- **Guided Instagram Direct.** `insta kholo, messages mein <contact> ko
  <message> bhejo` opens the real Instagram app, tries to find the named chat and
  prepares the text. A message is never sent on a bare `yes`; the explicit
  `confirm bhejo` step is required. If the UI cannot be matched, the app reports
  honestly instead of pretending the message was delivered.
- **QA fixes found during device testing.** Roman and Urdu reply spans are no
  longer duplicated when the text is identical. Spoken boilerplate is stripped
  from the Instagram contact, so the reply says `My Best Friend ko` instead of
  echoing the whole command. YouTube search now runs *before* the app handoff,
  which fixes the false `YouTube nahi khul saka` on Android 16 (background
  activity starts are blocked once another app takes the screen).

## Verification done here

- `node --check app/assets/www/app.js` — clean.
- `tests/mobile_reel_test.ps1` — **228/228 passed** after the QA fixes (static
  contract, source and build checks; no live third-party writes).
- `build_apk.ps1` — signed APK, version `2.3.4`, versionCode `18`, v2/v3
  signatures, non-debuggable release. SHA256:
  `856023A55B48DAAFB6224D81C1C11076B91F20D93F06504735BE99F26B08EA5A`.
- Installed and exercised on the actual TECNO CAMMON 40 Pro (`TECNO CM6`,
  Android 16, API 36), signing identity unchanged from v2.3.3:
  - Typed `hello jarvis kaise ho` and `kaise ho` → exact local reply
    `Kya hua sir? Main bilkul theek hoon, aap bataiye.`
  - `insta kholo messages mein My Best Friend ko test bhejo` → real Instagram
    app opened; reply correctly names `My Best Friend ko` and leaves Send to the
    user. No bare-`yes` send; `confirm bhejo` without a prepared message reports
    that there is nothing pending.
  - `youtube pe Tum Hi Ho gana chalao` → real YouTube `VIEW` intent launched
    (`BAL_ALLOW_VISIBLE_WINDOW`, `result code=0`), `Tum Hi Ho` visible in the
    results. Reply says the search is open and the user must pick the video
    because Phone automation is off. No fake playback claim.
  - Settings controls for neural voice, hands-free, wake word, background and
    voice lock are present; toggles produce real state toasts. Jarvis settings
    changed during QA were restored (neural voice ON, hands-free OFF, voice lock
    unenrolled).
  - No `FATAL`, `ANR`, `Force finishing`, `expected Integer but value was a
    java.lang.Long`, or `Tool arguments galat hain.` in the final logcat.
  - No system-wide settings, DND, battery or unrelated app data were changed;
    only Jarvis runtime prompts and its own app data were touched.

## Honest limits

- Instagram and YouTube UIs change often. Without a logged-in account and Phone
  automation enabled, the app can open the real app and prepare actions but
  cannot guarantee a recipient tap or video autoplay. No fake success is
  reported.
- The voice lock is a speaker-similarity convenience lock, not a secure
  biometric identity system. It is off by default and skippable.
- No live Gemini API key was available here, so no cloud reply latency or
  model-behaviour claim is made.
