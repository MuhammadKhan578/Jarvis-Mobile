# Jarvis Mobile v2.3.3 release notes

Focus: **real bug fixes from a fresh audit** plus **faster replies**. No fake
latency number is claimed; every change below is verifiable in the source.

## Real bugs fixed

- **PC intercom mic race (P0):** `pcHandleIntercom()` used to force `state='idle'`
  and re-arm the microphone immediately after `respond()`, while the reply was
  still speaking. `finishSpeaking()` is now the only place that schedules the
  next intercom listen, so Jarvis cannot hear its own voice.
- **Interrupted TTS reported as success (P1):** `TtsEngine.onStop()` called
  `onTtsDone()`, which released the mic before neural audio started or after a
  user stop. `stop()` now clears the utterance id and `onStop()` is a no-op.
- **Fake PC status (P1):** the Status button used local prefs only and could say
  "checked recently" for a stale failed request. It now performs a real GET to
  the PC's public `/link/status` endpoint and only reports `online` on HTTP 2xx
  with `ok:true`; otherwise it reports `offline` with the real error.
- **Stale PC pairing after failed switch (P2):** connecting to a different PC
  now clears old host/port/token when pairing fails, so an old PC cannot stay
  authoritative.
- **Empty confirmed save destination (P2):** `confirmed:true` no longer skips
  the last-destination fallback; an empty destination is rejected instead of
  being POSTed to the PC.
- **CALL_PHONE result ignored (P3):** `MainActivity.onRequestPermissionsResult()`
  now forwards `REQ_CALL_PHONE` to JS through the normal bridge callback and
  re-checks the OS-granted state.
- **Stale "ASSISTANT 2.2" label (P3):** the visible settings title and prompt
  text now say "ASSISTANT TOOLS"; the version is consistently 2.3.3.
- **Accidental re-save on bare "yes" (P2):** the confirm handler now requires a
  real pending save created by the PC's `confirmation_required` response (valid
  for 2 minutes). A leftover `lastDestination` can no longer trigger an old save.
- **Voice test broke TTS state (P2):** `testVoice()` now calls `speak()` instead
  of raw `Native.speak()`, so the safety timer, `state='speaking'` and mic re-arm
  all work normally.
- **Recognizer callback could crash early (P3):** `onSpeechEnd()` now null-checks
  `stateLabelEl` before writing to it.

## Speed fixes

- Fast mode now tries `gemini-3.5-flash-lite` first (official current model), then
  `gemini-3.6-flash` and `gemini-3.8-flash` as fallbacks. The old list started
  with the heavier `gemini-3.8-flash`.
- Fast mode sends a short, purpose-built system prompt instead of the long
  capability document. It still keeps the honesty rules, memory tool guidance,
  smart-home routing and the exact two-line `ROMAN:` / `URDU:` output format.
- Fast mode disables the reasoning pass, lowers output tokens to 350, caps tool
  loops at 3 rounds, uses a 6 s per-request timeout and a 10 s total budget.
- Removed `thinkingLevel` from `generateContent` requests. That field belongs to
  the newer Interactions API and could cause an `INVALID_ARGUMENT` retry.
- Neural TTS now starts with the official fast `gemini-3.8-flash-lite-tts`
  model. The system-voice safety fallback fires after 3 s instead of 4.5 s, so
  a slow network cannot leave the user waiting in silence.

## Verification

- `node --check app/assets/www/app.js` — exit 0.
- `tests/mobile_reel_test.ps1` — **181/181 checks pass**.
- New offline checks cover all ten bug fixes above, the fast model order, no
  thinking pass, 3-round cap, compact prompt, 10 s budget, fast TTS model,
  3 s fallback guard, every `Native.xxx()` ↔ Java bridge match and every
  `$('#id')` ↔ `index.html` match.
- APK rebuilt with `build_apk.ps1`: version `2.3.3`, versionCode `17`, signed v2/v3,
  non-debuggable. SHA256:
  `9AF00D7D2BF2B34C30DB30F30D427A09C2F9AEA72DC6064A6235D44D7885E89A`.
- No live API key was available here, so no measured first-word latency is claimed.

## Honest limits

- A real reply still needs a network round trip to Gemini and, when neural voice
  is on, a separate TTS request. The changes reduce work; they do not make it
  instant or free.
- Live PC status needs the PC Device Link server running on the same Wi-Fi.
- This release does not add incoming-call interception, call recording, SMS
  auto-send or secret modes.
