# Jarvis Mobile — phone components

This folder lists what the phone needs at runtime, and what the PC needs to
rebuild the APK.

## On the phone (runtime)

| Component | Why it is needed | Where to get it |
|-----------|------------------|-----------------|
| **Google app** | Speech recognition (mic input) | Play Store — "Google" |
| **Speech Recognition & Synthesis** | Android speech engine | Play Store (already on most phones) |
| **Male English (India) TTS voice** | Jarvis's male voice | Settings > System > Languages & input > Text-to-speech output > Install voice data |
| **Notification Access** (optional) | Gmail inbox summary | In-app Settings > Gmail inbox > Enable |

> An Urdu TTS voice is optional. If a male Urdu voice is installed, Jarvis
> speaks Urdu script; otherwise the same line is spoken in Roman Urdu with the
> male English (India) voice.

## On the PC (only to rebuild the APK)

| Component | Version | Notes |
|-----------|---------|-------|
| JDK | 17 or newer | `JAVA_HOME`, or a standard JDK install |
| Android SDK platform | any recent API (34+) | `ANDROID_HOME` / `ANDROID_SDK_ROOT` |
| Android build-tools | 34+ | installed through SDK Manager |
| Python 3 | 3.8+ | used only to add `classes.dex` to the APK |

`build_apk.ps1` auto-detects the SDK and JDK. If detection fails, pass them
explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_apk.ps1 -Sdk "C:\Android\Sdk" -Jdk "C:\Program Files\Java\jdk-17"
```

If the JDK is missing, `download_components.ps1` can download a JDK 17 build
into `%LOCALAPPDATA%\JarvisMobileBuild`.

## Gemini API key

The recommended flow is in-app:

1. Install and open Jarvis.
2. Tap **START JARVIS**, then paste your key on the **GEMINI API KEY** screen.
3. The key is stored in Android SharedPreferences and is never asked again.
4. You can change or remove it later in **Settings**.

You can create a free key at <https://aistudio.google.com/app/apikey>.

Advanced/private builds may pre-seed a key by copying
`config.properties.example` to `app/assets/config.properties`. That file is
git-ignored and must never be committed.
