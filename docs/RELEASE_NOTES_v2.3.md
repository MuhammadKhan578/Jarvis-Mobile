# Jarvis Mobile v2.3.0 release notes

## Reel-compatible capabilities

- Real ISS lookup and phone map hand-off.
- Native Android photo picker with real local edits: info, resize, crop,
  rotate, flip, grayscale, sepia, blur and text. Outputs are separate files and
  originals are never overwritten.
- Native Android video picker and real MP4 stream-copy trim with
  `MediaExtractor` and `MediaMuxer`.
- `openMedia` hand-off to the phone's gallery/editor without `file://` URIs.
- Local grocery list plus real food/grocery search hand-offs. No order or
  payment is claimed.
- Public analytics checks and an honest login-only response for Instagram
  insights.
- ntfy alerts configured by the user and sent only after confirmation.
- Confirmation-gated dial hand-off; no silent calls or invented transcripts.
- Honest mobile response for Steam/Epic commands, plus a real Play Store search.

## QA hooks

`window.__jarvisSelfTest()` now includes `reelMedia` and `reelMediaSelfTest`.
The latter creates and edits a synthetic bitmap in the app cache only.

## Boundaries

- Detailed video/audio understanding, call recording/transcription, background
  removal and desktop overlays remain PC-level features and are reported
  honestly on mobile.
- APK is signed with the existing local keystore; WebView DevTools and the
  `cmd` hook remain debug-build only. The release APK is non-debuggable.
