# Jarvis Mobile

A small, honest Android voice assistant: a WebView HUD in front, a Gemini
cloud brain, and native Android tools for apps, calls, SMS, alarms, flashlight,
volume, battery, camera — plus a natural neural voice and real Play Store
install automation. No Gradle required — a single PowerShell script builds the
APK with the Android SDK command-line tools.

## Features

- **Always online (background)** — a foreground service keeps Jarvis listening
  after you leave the app: say "Jarvis ..." from any app, even with the screen
  off. A low-priority "Jarvis online" notification stays visible (Android
  requires it). Turn it off in **Settings > Always online (background)**.
- Tap the orb and speak in English or Roman Urdu (or type a command).
- **Fast answers** — short recognition silence window, trimmed prompt/history,
  and a pre-warmed neural-voice cache so common replies start instantly.
- **PC-quality neural voice** (Gemini TTS, 24 kHz WAV). Long replies are split
  into sentences, synthesised in parallel and played in order, so the first
  words start in a couple of seconds. Falls back to the Android voice if the
  network or key is missing.
- **Full-reply voice (v2.0.0)** — if one sentence fails to synthesise or play,
  Jarvis skips only that sentence and keeps speaking the rest, so replies no
  longer stop halfway. A failed Android voice engine reports an error instead
  of hanging.
- **Memory 2.0 (v2.1.0)** — long-term memory is now structured by category
  (about you, preferences, projects, goals, routine, health, people, work).
  Relevant memories are recalled per question instead of the whole list, so
  answers stay fast. Pin any detail forever with ★, say "yaad rakho ..." to
  teach it instantly, ask "mere project ke baare mein kya yaad hai?" to recall,
  and "bhool jao ..." to forget. Earlier conversation is summarised on the
  phone so long chats are not forgotten, without sending extra context.
- **Assistant 2.2 (v2.2.0)** — personality profiles, writing-voice learning,
  local calendar with real phone-calendar insert, scheduled routines, work
  tools (GitHub, Slack, Notion, Linear, Jira), remote MCP servers, page reading
  and summarising, and global dictation with spoken edits. See
  [docs/ASSISTANT.md](docs/ASSISTANT.md) for setup and honest limits.
- **Clearer voice and app commands (v2.0.0)** — "band karo voice" now locks the
  voice (it used to unlock it), and app names match whole words only, so
  "headphone" no longer opens the Phone app.
- **Phone automation (optional)** — with the "Jarvis Automation" accessibility
  service on, Jarvis can read the current screen, tap any visible button, type
  into fields, and press Back / Home / Recents / Notifications.
- **Full Play Store install** — `install_app` searches Play Store, taps the
  result, taps **Install**, waits for the download and taps **Open**.
- Opens installed apps by name (YouTube, Chrome, Brave, Gmail, WhatsApp,
  Instagram, Maps, Camera, Settings, Calculator, Clock, and more).
- Handles calls, SMS drafts, alarms, timers, flashlight, volume, battery,
  Wi-Fi/Bluetooth settings, and web searches.
- **Smart home control** for lights, fans, AC, TV, doors, blinds, coffee machine
  and plugs, plus one-word scenes (morning, movie, sleep, guest, work, away,
  party). The built-in virtual home works with no setup; optional Home Assistant
  connection for real devices.
- **News briefings** from Google News with no extra API key.
- Optional Gmail inbox summaries through Notification Access.
- Long-term memory saved on the phone, and a much more natural conversation
  style (short spoken answers, real opinions, follows up like the PC Jarvis).
- Everything personal stays on the phone. There is no analytics server.

## First launch (API key)

Jarvis needs a free Gemini API key. On first launch:

1. Tap **START JARVIS**.
2. Tap **OPEN GOOGLE AI STUDIO** (or visit
   <https://aistudio.google.com/app/apikey>).
3. Sign in, tap **Create API key**, and copy the key.
4. Paste it on the **GEMINI API KEY** screen and tap **Save**.

The same key powers both the brain and the neural voice. It is stored in
Android SharedPreferences and is remembered forever. You can change or remove
it later in **Settings > GEMINI API KEY**. The key is only sent to Google's
Gemini API — it is never uploaded anywhere else.

## Phone automation (install + screen control)

Android does not allow silent APK installs or taps in other apps. Jarvis uses
the standard AccessibilityService route (the same mechanism automation apps
use):

1. Open **Settings > Phone automation > Enable**.
2. Turn on **Jarvis Automation** and allow it.
3. Say: *"Play Store se Duolingo install karo"*.

Jarvis opens the real Play Store search, taps the app, taps **Install**, waits
for the download, then taps **Open**. Every message reports what really
happened. If automation is off, Jarvis still opens the Play Store search and
asks you to tap Install.

The service never reads passwords. It only looks at visible text/buttons while
performing a task. Turn it off any time in Android Accessibility settings.

## Assistant 2.2 (personality, calendar, routines, work, MCP, dictation)

Open **Settings > ASSISTANT 2.2** for the new panels. Everything here is
optional and stores its data in this app's local storage on the phone.

- **Personality** — pick Jarvis, Professional, Friendly, Concise, Mentor,
  Creative, or write a custom instruction. Paste a paragraph you wrote and tap
  **Learn my voice** so drafts match your tone; feedback notes are applied to
  later drafts.
- **Calendar** — say *"kal 3 baje Ali se meeting"* or *"meeting tomorrow 5 pm"*.
  Events are saved locally and can be copied as `.ics`. Turn on **Phone
  calendar** to open the standard Android event screen (Android's own Save
  button finishes it; Jarvis never writes the calendar database silently).
- **Routines** — *"routine add 07:30: news sunao"*. Routines run while Jarvis is
  open or its foreground service is alive. Android may kill the process, so
  they are not guaranteed after the app is force-stopped.
- **Work tools** — GitHub issues/PRs, Slack read/summarise/post, Notion
  search/read/append, Linear and Jira. Add your own token in **Work tools**;
  tokens stay in local storage. Every write asks you to say **"confirm"** first.
- **MCP** — Jarvis Mobile is an MCP *client* over streamable HTTP. Phones cannot
  host a local stdio MCP server for other apps, and servers that require an
  `mcp-session-id` header may not work with the current bridge.
- **Page read / summarise** — *"read this page"* or *"summarize this page"* reads
  the visible screen through Phone automation.
- **Dictation** — *"start dictation"*, then speak; *"stop dictation"* ends it.
  Spoken edits: *"scratch that"*, *"delete last word"*, *"new paragraph"*,
  *"comma"*, *"capitalize that"*. With Phone automation on, text is typed into
  the focused field; otherwise it goes to the clipboard.

## Smart home

Jarvis ships with a complete **virtual home**, so nothing extra is required to
try it. Say commands like:

- *"drawing room ki light on karo"* / *"bedroom AC 22 degree"*
- *"TV band karo"*, *"main door lock karo"*, *"kitchen blinds kholo"*
- *"coffee machine on karo"*, *"iron plug off karo"*
- *"movie mode"*, *"good night"*, *"mehman mode"*, *"bahar ja raha hoon"*
- *"ghar ka status batao"*

Devices: lights (drawing room, bedroom, kitchen, bathroom, study, garden), fans
(bedroom, drawing room), ACs (bedroom, drawing room), TV, main/back doors,
blinds (drawing room, bedroom, kitchen), coffee machine, charger and iron plugs.
States are saved in the WebView's local storage on the phone.

### Optional Home Assistant

Open **Settings > SMART HOME**, enter your Home Assistant URL (for example
`http://192.168.1.10:8123`) and a long-lived access token, then tap **Save &
connect**. Jarvis mirrors every command to the real devices and can import their
state with *"sync home"*. Plain `http://` is accepted only for local/private
addresses; public URLs must use `https://`.

Without Home Assistant everything still works locally, so the feature never
blocks the rest of the assistant.

## News

Say *"news sunao"*, *"aaj ki khabar"* or *"latest news about cricket"*. Jarvis
reads Google News RSS and needs no NewsAPI/OpenWeatherMap account. Headlines are
cached for five minutes to avoid repeat downloads.

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

Output: `JarvisMobile.apk` in this folder. Version 2.2.0 (versionCode 12).

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
| `app/java/com/jarvis/mobile/` | Native bridge, speech, neural TTS, automation, intents |
| `app/java/com/jarvis/mobile/JarvisService.java` | Foreground service for always-on background listening |
| `app/res/xml/accessibility_service_config.xml` | Phone automation service config |
| `build_apk.ps1` | Builds and signs the APK without Gradle |
| `install_on_phone.ps1` | Installs the APK over USB |
| `components/` | Optional component checker and notes |

## Privacy

- The API key lives in app-private SharedPreferences.
- Memory notes and settings live in the WebView's local storage on the phone.
- Smart-home state and an optional Home Assistant token stay in that local
  storage; the token is sent only to the Home Assistant URL you enter.
- Notification Access is optional and used only for Gmail summaries.
- Work-tool tokens, calendar events, routines, personality samples and MCP
  server settings stay in the WebView's local storage. Tokens are sent only to
  the service you configured.
- The accessibility service runs only while a Jarvis automation task is active.
- This repository contains no API keys, keystores, logs, or personal data.

## Troubleshooting

- **"Key theek nahi lag rahi"** — make sure the key starts with `AIza` and has
  no spaces. Create a fresh key in Google AI Studio if needed.
- **No voice / robotic voice** — check **Settings > JARVIS VOICE (NEURAL)**.
  With a working internet connection and key, the natural voice is used.
  Turning it off uses the Android TTS voice, which needs a male English (India)
  voice in Android Settings > Text-to-speech output.
- **Install does nothing** — enable **Jarvis Automation** in Accessibility
  settings, then retry. Jarvis never claims an install succeeded unless it saw
  the real Open button.
- **Mic does not start** — grant the microphone permission, and install the
  Google app / Speech Recognition & Synthesis.
- **Background listening stops** — allow notifications for Jarvis, and turn off
  battery optimisation for it (**Settings > Apps > Jarvis > Battery > Unrestricted**).
  Do not swipe the app away from Recents; press Back instead, which keeps the
  service running.
- **Build cannot find SDK/JDK** — use the `-Sdk` and `-Jdk` arguments above.

## License

Use it, learn from it, improve it. Attribution is appreciated but not required.
