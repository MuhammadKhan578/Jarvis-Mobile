# Jarvis Mobile

A small, honest Android voice assistant: a WebView HUD in front, a Gemini
cloud brain, and native Android tools for apps, calls, SMS, alarms, flashlight,
volume, battery, camera and more. No Gradle required — a single PowerShell
script builds the APK with the Android SDK command-line tools.

## Features

- Tap the orb and speak in English or Roman Urdu (or type a command).
- Opens installed apps by name (YouTube, Chrome, Brave, Gmail, WhatsApp,
  Instagram, Maps, Camera, Settings, Calculator, Clock, and more).
- Handles calls, SMS drafts, alarms, timers, flashlight, volume, battery,
  Wi-Fi/Bluetooth settings, and web searches.
- Optional Gmail inbox summaries through Notification Access.
- Male English (India) voice, with optional Urdu TTS when installed.
- Everything personal stays on the phone. There is no analytics server.

## First launch (API key)

Jarvis needs a free Gemini API key. On first launch:

1. Tap **START JARVIS**.
2. Tap **OPEN GOOGLE AI STUDIO** (or visit
   <https://aistudio.google.com/app/apikey>).
3. Sign in, tap **Create API key**, and copy the key.
4. Paste it on the **GEMINI API KEY** screen and tap **Save**.

The key is stored in Android SharedPreferences and is remembered forever. You
can change or remove it later in **Settings > GEMINI API KEY**. The key is only
sent to Google's Gemini API — it is never uploaded anywhere else.

## Build the APK

Requirements:

- Windows PowerShell 5.1+
- JDK 17 or newer
- Android SDK with build-tools and one platform (API 34+)
- Python 3 on `PATH`

```powershell
# Optional: check/download a JDK and verify the SDK
powershell -ExecutionPolicy Bypass -File .\components\download_components.ps1

# Build
powershell -ExecutionPolicy Bypass -File .\build_apk.ps1
```

If auto-detection fails, pass the paths explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_apk.ps1 `
  -Sdk "C:\Android\Sdk" -Jdk "C:\Program Files\Java\jdk-17"
```

Output: `JarvisMobile.apk` in this folder.

On the first build the script creates a local development keystore at
`keystore/jarvis.keystore` with a random password saved in
`keystore/keystore.pass` (both git-ignored). Keep that folder safe if you
publish updates; otherwise Android treats each build as a different app. Set
`JARVIS_STORE_PASS` / `JARVIS_KEY_PASS` to choose your own password instead.

## Install on a phone

**Option A — USB (adb):**

1. Enable **Developer options > USB debugging** on the phone.
2. Connect the cable and tap **Allow** when asked.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install_on_phone.ps1
```

**Option B — copy the APK:** copy `JarvisMobile.apk` to the phone and tap it.
Allow **Install unknown apps** for the file manager if Android asks.

The package name is `com.jarvis.mobile`.

## Project layout

| Path | Purpose |
|------|---------|
| `app/` | Android source (Java + HTML/CSS/JS HUD) |
| `app/assets/www/` | The HUD: `index.html`, `app.js`, `style.css` |
| `app/java/com/jarvis/mobile/` | Native bridge, speech, TTS, intents, Gmail listener |
| `build_apk.ps1` | Builds and signs the APK without Gradle |
| `install_on_phone.ps1` | Installs the APK over USB |
| `components/` | Optional component checker and notes |

## Privacy

- The API key lives in app-private SharedPreferences.
- Memory notes and settings live in the WebView's local storage on the phone.
- Notification Access is optional and used only for Gmail summaries.
- This repository contains no API keys, keystores, logs, or personal data.

## Troubleshooting

- **"Key theek nahi lag rahi"** — make sure the key starts with `AIza` and has
  no spaces. Create a fresh key in Google AI Studio if needed.
- **No voice** — install a male English (India) TTS voice in Android
  Settings > Text-to-speech output.
- **Mic does not start** — grant the microphone permission, and install the
  Google app / Speech Recognition & Synthesis.
- **Build cannot find SDK/JDK** — use the `-Sdk` and `-Jdk` arguments above.

## License

Use it, learn from it, improve it. Attribution is appreciated but not required.
