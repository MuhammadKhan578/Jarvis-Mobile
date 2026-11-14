package com.jarvis.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

/**
 * The bridge between the HTML interface and Android hardware.
 * Everything here reports the real result; no action is ever pretended.
 */
public class JsBridge implements TtsEngine.Listener, SpeechEngine.Listener, NeuralTts.Listener {

    private static final String TAG = "JarvisMobile";
    private static final String PREFS = "jarvis_mobile";
    private static final String KEY_GEMINI = "gemini_key";
    private static final String KEY_SEEDED = "key_seeded";
    private static final String KEY_NEURAL = "neural_voice";
    private static final String KEY_NEURAL_VOICE = "neural_voice_name";

    private final Activity activity;
    private final WebView web;
    private final TtsEngine tts;
    private final NeuralTts neural;
    private final SpeechEngine speech;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private static final long NEURAL_START_TIMEOUT_MS = 4500;
    private boolean pendingListen = false;
    private String pendingRoman = "";
    private String pendingUrdu = "";
    private volatile boolean neuralActive = false;
    /** Invalidates old TTS watchdogs when a new reply starts. */
    private volatile int speechSeq = 0;
    /** User pressed the in-app mic button to turn the microphone off. */
    private volatile boolean micMuted = false;

    public JsBridge(Activity activity, WebView web, TtsEngine tts, SpeechEngine speech) {
        this.activity = activity;
        this.web = web;
        this.tts = tts;
        this.speech = speech;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.tts.setListener(this);
        this.neural = new NeuralTts(activity);
        this.neural.setListener(this);
        GmailListener.init(activity);
    }

    // ------------------------------------------------------------- JS helper

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    private void callJs(String js) {
        main.post(() -> {
            try {
                if (web != null) web.evaluateJavascript(js, null);
            } catch (Exception ignored) { }
        });
    }

    // ------------------------------------------------------- TTS callbacks

    @Override
    public void onTtsDone() {
        speechSeq++;
        neuralActive = false;
        releaseMic();
        callJs("window.jarvisNative&&jarvisNative.onTtsDone()");
    }

    @Override
    public void onTtsError(String message) {
        speechSeq++;
        neuralActive = false;
        releaseMic();
        callJs("window.jarvisNative&&jarvisNative.onTtsError(" + q(message) + ")");
    }

    @Override
    public void onNeuralDone() {
        speechSeq++;
        neuralActive = false;
        releaseMic();
        callJs("window.jarvisNative&&jarvisNative.onTtsDone()");
    }

    @Override
    public void onNeuralError(String message) {
        // Already played a sentence? Then a fallback would repeat it. Just end.
        boolean played = neural.hasPlayedAny();
        speechSeq++;
        neuralActive = false;
        if (played) {
            releaseMic();
            callJs("window.jarvisNative&&jarvisNative.onTtsDone()");
            return;
        }
        Log.w(TAG, "Neural voice failed, using system voice: " + message);
        tts.speak(pendingRoman, pendingUrdu);
    }

    /** The microphone stays off while Jarvis is thinking or talking. */
    private void releaseMic() {
        try {
            if (speech == null) return;
            if (micMuted) speech.setHeld(true);
            else speech.setHeld(false);
        } catch (Exception ignored) { }
    }

    /**
     * Speaks the reply.  Prefers the natural Gemini neural voice (same quality
     * family as the PC version) and falls back to the Android voice if the
     * request cannot be completed.
     */
    @JavascriptInterface
    public void speak(String roman, String urdu) {
        pendingRoman = roman == null ? "" : roman.trim();
        pendingUrdu = urdu == null ? "" : urdu.trim();
        final int seq = ++speechSeq;
        try { if (speech != null) speech.setHeld(true); } catch (Exception ignored) { }
        if (pendingRoman.isEmpty() && pendingUrdu.isEmpty()) {
            releaseMic();
            callJs("window.jarvisNative&&jarvisNative.onTtsDone()");
            return;
        }
        boolean wantNeural = prefs.getBoolean(KEY_NEURAL, true) && !readKey().isEmpty();
        String text = speechText(pendingRoman, pendingUrdu);
        List<String> sentences = splitSentences(text);
        if (wantNeural && !sentences.isEmpty()) {
            tts.stop();
            neuralActive = true;
            neural.speak(sentences, prefs.getString(KEY_NEURAL_VOICE, "Charon"), readKey());
            // Speed guard: if the neural voice has not started speaking in
            // 4.5 s, stop waiting and use the instant Android voice.
            main.postDelayed(() -> {
                if (seq != speechSeq || !neuralActive) return;
                if (neural.hasPlayedAny()) return;
                Log.w(TAG, "Neural voice slow; switching to system voice.");
                neuralActive = false;
                neural.stop();
                tts.speak(pendingRoman, pendingUrdu);
            }, NEURAL_START_TIMEOUT_MS);
            return;
        }
        neural.stop();
        neuralActive = false;
        tts.speak(pendingRoman, pendingUrdu);
    }

    @JavascriptInterface
    public void stopSpeaking() {
        speechSeq++;
        neural.stop();
        neuralActive = false;
        tts.stop();
        releaseMic();
    }

    // ------------------------------------------------- background always-on

    /**
     * Turns the background mode on/off. When on, a foreground service keeps the
     * process alive and SpeechEngine restarts the microphone natively, so
     * "Hey Jarvis" works with the app closed on screen, even with the phone locked.
     */
    @JavascriptInterface
    public void setAlwaysOn(boolean on) {
        prefs.edit().putBoolean(JarvisService.KEY_ALWAYS_ON, on).apply();
        if (on && !micMuted) {
            JarvisService.start(activity);
        } else {
            JarvisService.stop(activity);
        }
        try { if (speech != null) speech.setAutoLoop(on && !micMuted); } catch (Exception ignored) { }
        if (!on) releaseMic();
    }

    @JavascriptInterface
    public boolean isAlwaysOn() {
        return prefs.getBoolean(JarvisService.KEY_ALWAYS_ON, true);
    }

    /** Native mic loop: JS timers are frozen in the background, this is not. */
    @JavascriptInterface
    public void setAutoListen(boolean on) {
        try { if (speech != null) speech.setAutoLoop(on && !micMuted); } catch (Exception ignored) { }
    }

    /** User mute from the orb button. Nothing may re-arm the mic until false. */
    @JavascriptInterface
    public void setMicMuted(boolean muted) {
        micMuted = muted;
        if (muted) pendingListen = false;
        try {
            if (speech != null) {
                if (muted) {
                    speech.setAutoLoop(false);
                    speech.setHeld(true);
                    speech.cancel();
                } else {
                    speech.setHeld(false);
                }
            }
            // While muted there is nothing to keep alive, so remove the
            // misleading "Jarvis online" notification and its wake lock.
            if (muted) {
                JarvisService.stop(activity);
            } else if (prefs.getBoolean(JarvisService.KEY_ALWAYS_ON, true)) {
                JarvisService.start(activity);
            }
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public boolean isMicMuted() {
        return micMuted;
    }

    @JavascriptInterface
    public void holdListening(boolean hold) {
        try { if (speech != null) speech.setHeld(hold); } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public boolean isHoldingMic() {
        try { return speech != null && speech.isHeld(); } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public void openServiceSettings() {
        main.post(() -> {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                i.setData(Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(i);
            } catch (Exception ignored) { }
        });
    }

    /** Caches the phrases Jarvis says most often so audio starts instantly. */
    @JavascriptInterface
    public void warmVoice() {
        try {
            if (!prefs.getBoolean(KEY_NEURAL, true)) return;
            String key = readKey();
            if (key.isEmpty()) return;
            String voice = prefs.getString(KEY_NEURAL_VOICE, "Charon");
            List<String> warm = new ArrayList<>();
            warm.add("Ji sir?");
            warm.add("Ji sir, boliye.");
            warm.add("Ho gaya, sir.");
            warm.add("Theek hai sir.");
            warm.add("Sun raha hoon, sir.");
            warm.add("Ek second sir.");
            warm.add("Khol diya, sir.");
            neural.prefetch(warm, voice, key);
        } catch (Exception ignored) { }
    }

    /** Urdu script sounds right with the neural voice; Roman text uses English. */
    private static String speechText(String roman, String urdu) {
        if (urdu != null && urdu.matches(".*[\\u0600-\\u06FF].*")) return urdu;
        return roman == null ? "" : roman;
    }

    private static List<String> splitSentences(String text) {
        List<String> out = new ArrayList<>();
        String t = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        if (t.isEmpty()) return out;
        String[] parts = t.split("(?<=[.!?\\u06D4\\u061F])\\s+");
        StringBuilder buf = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.trim().isEmpty()) continue;
            String s = p.trim();
            if (s.length() > 220) {
                // Very long sentence: break at commas so audio starts sooner.
                for (String piece : s.split("(?<=[,;])\\s+")) {
                    if (piece.trim().isEmpty()) continue;
                    if (buf.length() + piece.length() > 220 && buf.length() > 0) {
                        out.add(buf.toString().trim());
                        buf.setLength(0);
                    }
                    buf.append(piece.trim()).append(' ');
                }
            } else {
                if (buf.length() + s.length() > 220 && buf.length() > 0) {
                    out.add(buf.toString().trim());
                    buf.setLength(0);
                }
                buf.append(s).append(' ');
            }
        }
        if (buf.length() > 0) out.add(buf.toString().trim());
        if (out.isEmpty()) out.add(t);
        // Keep the queue small; merge extra sentences into the last one.
        while (out.size() > 6) {
            int last = out.size() - 1;
            out.set(last - 1, out.get(last - 1) + " " + out.remove(last));
        }
        return out;
    }

    @JavascriptInterface
    public void setVoicePrefs(String gender, double rate, String voiceName) {
        prefs.edit()
                .putString("voice_gender", gender == null ? "male" : gender)
                .putFloat("voice_rate", (float) rate)
                .putString("voice_name", voiceName == null ? "" : voiceName)
                .apply();
        tts.setPrefs(gender, (float) rate, voiceName);
    }

    @JavascriptInterface
    public void setNeuralPrefs(boolean enabled, String voiceName) {
        String v = (voiceName == null || voiceName.trim().isEmpty()) ? "Charon" : voiceName.trim();
        prefs.edit().putBoolean(KEY_NEURAL, enabled).putString(KEY_NEURAL_VOICE, v).apply();
    }

    @JavascriptInterface
    public String getNeuralPrefs() {
        try {
            JSONObject o = new JSONObject();
            o.put("enabled", prefs.getBoolean(KEY_NEURAL, true));
            o.put("voice", prefs.getString(KEY_NEURAL_VOICE, "Charon"));
            return o.toString();
        } catch (Exception e) {
            return "{\"enabled\":true,\"voice\":\"Charon\"}";
        }
    }

    @JavascriptInterface
    public String getVoicePrefs() {
        try {
            JSONObject o = new JSONObject();
            o.put("gender", prefs.getString("voice_gender", "male"));
            o.put("rate", prefs.getFloat("voice_rate", 0.97f));
            o.put("voice_name", prefs.getString("voice_name", ""));
            return o.toString();
        } catch (Exception e) {
            return "{\"gender\":\"male\",\"rate\":0.97,\"voice_name\":\"\"}";
        }
    }

    @JavascriptInterface
    public String getVoices() {
        return tts.getVoicesJson();
    }

    @JavascriptInterface
    public boolean hasUrduVoice() {
        return tts.hasUrduVoice();
    }

    @JavascriptInterface
    public void openTtsSettings() {
        AppIntents.execute(activity, "tts_settings", new JSONObject());
    }

    @JavascriptInterface
    public void openUrl(String url) {
        try {
            String u = url == null ? "" : url.trim();
            if (!u.startsWith("https://") && !u.startsWith("http://")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
            activity.startActivity(i);
        } catch (Exception e) {
            toast("Browser open nahi ho saka.");
        }
    }

    // ------------------------------------------------------- phone automation

    @JavascriptInterface
    public boolean hasAutomation() {
        return JarvisAccessibilityService.isEnabled(activity);
    }

    @JavascriptInterface
    public void openAutomationSettings() {
        main.post(() -> {
            try {
                activity.startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS));
                toast("Jarvis Automation on karein.");
            } catch (Exception e) {
                toast("Accessibility settings nahi khuli.");
            }
        });
    }

    /**
     * Searches the Play Store and installs the app by tapping the real buttons.
     * The final result is delivered to JS as window.jarvisAutomationDone(id, json).
     */
    @JavascriptInterface
    public void startInstall(final String requestId, final String appName) {
        final String name = appName == null ? "" : appName.trim();
        if (name.isEmpty()) {
            automationResult(requestId, false, "App ka naam nahi mila.", false);
            return;
        }
        main.post(() -> {
            // Always open the real Play Store search first, so a manual tap is
            // possible even when automation is switched off.
            try {
                JSONObject args = new JSONObject().put("app_name", name);
                AppIntents.execute(activity, "open_play_store", args);
            } catch (Exception ignored) { }
            if (!JarvisAccessibilityService.isConnected()) {
                automationResult(requestId, false,
                        "Automation off hai. Play Store khul gaya — Install khud dabaiye, "
                                + "ya Settings > Phone automation on karein.", true);
                return;
            }
            try {
                JarvisAccessibilityService svc = JarvisAccessibilityService.instance();
                if (svc == null) {
                    automationResult(requestId, false, "Automation service ready nahi hai.", true);
                    return;
                }
                svc.startInstallJob(requestId, name, (id, result) -> {
                    String json = result == null ? "{\"ok\":false}" : result.toString();
                    callJs("window.jarvisAutomationDone&&window.jarvisAutomationDone("
                            + q(id) + "," + q(json) + ")");
                    try {
                        String msg = result == null ? "Install fail hua." : result.optString("message", "");
                        if (!msg.isEmpty()) toast(msg);
                    } catch (Exception ignored) { }
                });
            } catch (Exception e) {
                automationResult(requestId, false, "Install shuru nahi ho saka: " + e.getMessage(), true);
            }
        });
    }

    private void automationResult(String id, boolean ok, String message, boolean needsUser) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("message", message == null ? "" : message);
            o.put("needs_user_action", needsUser);
            callJs("window.jarvisAutomationDone&&window.jarvisAutomationDone("
                    + q(id) + "," + q(o.toString()) + ")");
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public boolean uiClick(String text) {
        return JarvisAccessibilityService.clickText(text);
    }

    @JavascriptInterface
    public boolean uiClickId(String idPart) {
        return JarvisAccessibilityService.clickIdPart(idPart);
    }

    @JavascriptInterface
    public String uiDump() {
        return JarvisAccessibilityService.dumpTexts();
    }

    @JavascriptInterface
    public boolean uiType(String text) {
        return JarvisAccessibilityService.setText(text);
    }

    @JavascriptInterface
    public boolean systemAction(String action) {
        return JarvisAccessibilityService.performAction(action);
    }

    // ------------------------------------------------------- STT callbacks

    @Override
    public void onSpeechPartial(String text) {
        callJs("window.jarvisNative&&jarvisNative.onSpeechPartial(" + q(text) + ")");
    }

    @Override
    public void onSpeechFinal(String text, java.util.ArrayList<String> alternatives) {
        JSONArray arr = new JSONArray();
        if (alternatives != null) {
            for (String s : alternatives) arr.put(s == null ? "" : s);
        }
        callJs("window.jarvisNative&&jarvisNative.onSpeechFinal(" + q(text) + "," + q(arr.toString()) + ")");
    }

    @Override
    public void onSpeechError(int code, String message) {
        callJs("window.jarvisNative&&jarvisNative.onSpeechError(" + code + "," + q(message) + ")");
    }

    @Override
    public void onSpeechEnd() {
        callJs("window.jarvisNative&&jarvisNative.onSpeechEnd()");
    }

    @Override
    public void onSpeechReady() {
        callJs("window.jarvisNative&&jarvisNative.onSpeechReady()");
    }

    @Override
    public void onSpeechRms(float rms) {
        callJs("window.jarvisNative&&jarvisNative.onSpeechRms(" + String.format(Locale.US, "%.1f", rms) + ")");
    }

    @JavascriptInterface
    public String startListening() {
        if (micMuted) return "muted";
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingListen = true;
            main.post(() -> activity.requestPermissions(
                    new String[]{Manifest.permission.RECORD_AUDIO}, MainActivity.REQ_MIC));
            return "permission";
        }
        // A manual start always wins over the "thinking/speaking" hold.
        try { speech.setHeld(false); } catch (Exception ignored) { }
        speech.start();
        return "ok";
    }

    @JavascriptInterface
    public void stopListening() {
        speech.stop();
    }

    @JavascriptInterface
    public void cancelListening() {
        speech.cancel();
    }

    @JavascriptInterface
    public boolean isListening() {
        return speech.isListening();
    }

    /** True when the phone has a working speech recognition service. */
    @JavascriptInterface
    public boolean canListen() {
        try { return speech.isRecognitionAvailable(); } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public boolean hasPermission(String which) {
        String w = which == null ? "" : which;
        if (w.equals("mic")) {
            return activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        }
        if (w.equals("camera")) {
            return activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        }
        if (w.equals("notifications")) {
            return GmailListener.hasAccess(activity);
        }
        return false;
    }

    @JavascriptInterface
    public void requestMicPermission() {
        main.post(() -> activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MainActivity.REQ_MIC));
    }

    @JavascriptInterface
    public void requestCameraPermission() {
        main.post(() -> activity.requestPermissions(new String[]{Manifest.permission.CAMERA}, MainActivity.REQ_CAMERA));
    }

    @JavascriptInterface
    public void openNotificationAccess() {
        AppIntents.execute(activity, "notification_access", new JSONObject());
    }

    @JavascriptInterface
    public boolean hasNotificationAccess() {
        return GmailListener.hasAccess(activity);
    }

    @JavascriptInterface
    public String getGmailNotifications(int limit) {
        return GmailListener.readItemsJson(activity, limit);
    }

    @JavascriptInterface
    public void clearGmailNotifications() {
        GmailListener.clearAll(activity);
    }

    public void onPermissionResult(String which, boolean granted) {
        callJs("window.jarvisNative&&jarvisNative.onPermission(" + q(which) + "," + granted + ")");
        if ("mic".equals(which) && granted && pendingListen && !micMuted) {
            pendingListen = false;
            speech.start();
        } else if ("mic".equals(which) && !granted) {
            pendingListen = false;
        }
    }

    // ---------------------------------------------------------- Gemini HTTP

    @JavascriptInterface
    public boolean hasApiKey() {
        return !readKey().isEmpty();
    }

    @JavascriptInterface
    public String getKeyMask() {
        String k = readKey();
        if (k.isEmpty()) return "";
        if (k.length() <= 10) return "••••";
        return k.substring(0, 6) + "••••••" + k.substring(k.length() - 4);
    }

    @JavascriptInterface
    public boolean setApiKey(String key) {
        String k = key == null ? "" : key.trim();
        if (k.length() >= 2 && k.charAt(0) == k.charAt(k.length() - 1)
                && (k.charAt(0) == '"' || k.charAt(0) == '\'')) {
            k = k.substring(1, k.length() - 1).trim();
        }
        if (k.length() < 20) return false;
        // Google now issues "AQ..." auth keys; only reject obvious garbage.
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            if (c < 33 || c > 126) return false;
        }
        prefs.edit().putString(KEY_GEMINI, k).putBoolean(KEY_SEEDED, true).apply();
        return true;
    }

    @JavascriptInterface
    public void clearApiKey() {
        prefs.edit().putString(KEY_GEMINI, "").putBoolean(KEY_SEEDED, true).apply();
    }

    private String readKey() {
        String k = prefs.getString(KEY_GEMINI, "").trim();
        if (!k.isEmpty()) return k;
        if (prefs.getBoolean(KEY_SEEDED, false)) return "";
        try (InputStream is = activity.getAssets().open("config.properties")) {
            Properties p = new Properties();
            p.load(is);
            k = p.getProperty("gemini_api_key", "").trim();
            if (!k.isEmpty()) {
                prefs.edit().putString(KEY_GEMINI, k).putBoolean(KEY_SEEDED, true).apply();
            }
        } catch (Exception ignored) { }
        return k;
    }

    @JavascriptInterface
    public void httpGemini(final String requestId, final String model, final String payload, final int timeoutMs) {
        final String key = readKey();
        if (key.isEmpty()) {
            callJs("window.__jarvisHttp(" + q(requestId) + ",0," +
                    q("{\"error\":{\"message\":\"NO_API_KEY\",\"status\":\"NO_API_KEY\"}}") + ")");
            return;
        }
        if (model == null || !model.matches("[A-Za-z0-9._-]{3,80}")) {
            callJs("window.__jarvisHttp(" + q(requestId) + ",0," +
                    q("{\"error\":{\"message\":\"BAD_MODEL\",\"status\":\"BAD_MODEL\"}}") + ")");
            return;
        }
        final int readTimeout = Math.max(6000, Math.min(20000, timeoutMs));
        new Thread(() -> {
            HttpURLConnection conn = null;
            boolean reusable = false;
            try {
                URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/"
                        + model + ":generateContent");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(readTimeout);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("x-goog-api-key", key);
                byte[] body = payload.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }
                int code = conn.getResponseCode();
                InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String text = readAll(stream);
                reusable = stream != null;
                callJs("window.__jarvisHttp(" + q(requestId) + "," + code + "," + q(text) + ")");
            } catch (Exception e) {
                String msg = e.toString();
                String safe = msg.replace("\"", "'");
                callJs("window.__jarvisHttp(" + q(requestId) + ",0," +
                        q("{\"error\":{\"message\":\"" + safe + "\",\"status\":\"TRANSPORT\"}}") + ")");
            } finally {
                // Fully-read responses stay in the keep-alive pool, so the next
                // command reuses the TLS connection instead of reconnecting.
                if (conn != null && !reusable) conn.disconnect();
            }
        }, "jarvis-gemini").start();
    }

    @JavascriptInterface
    public void httpRequest(final String requestId, final String method, final String urlText,
                            final String headersJson, final String body, final int timeoutMs) {
        final String id = requestId == null ? "" : requestId;
        final String verb = method == null ? "GET" : method.trim().toUpperCase(Locale.US);
        if (!verb.equals("GET") && !verb.equals("POST") && !verb.equals("PUT") &&
                !verb.equals("PATCH") && !verb.equals("DELETE")) {
            callJs("window.__jarvisHttpRaw(" + q(id) + ",0," + q("Only GET, POST, PUT, PATCH and DELETE are allowed") + ")");
            return;
        }
        URL target;
        try {
            target = new URL(urlText == null ? "" : urlText);
        } catch (Exception e) {
            callJs("window.__jarvisHttpRaw(" + q(id) + ",0," + q("Invalid URL") + ")");
            return;
        }
        String scheme = target.getProtocol() == null ? "" : target.getProtocol().toLowerCase(Locale.US);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            callJs("window.__jarvisHttpRaw(" + q(id) + ",0," + q("Only http and https are allowed") + ")");
            return;
        }
        // Cleartext is only for a Home Assistant box on the local network.
        if (scheme.equals("http") && !isPrivateHttpHost(target.getHost())) {
            callJs("window.__jarvisHttpRaw(" + q(id) + ",0," +
                    q("Plain http is only allowed for local addresses") + ")");
            return;
        }
        final int readTimeout = Math.max(3000, Math.min(15000, timeoutMs));
        final URL url = target;
        new Thread(() -> {
            HttpURLConnection conn = null;
            boolean reusable = false;
            try {
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod(verb);
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(readTimeout);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Mobile Safari/537.36");
                try {
                    JSONObject headers = new JSONObject(
                            headersJson == null || headersJson.trim().isEmpty() ? "{}" : headersJson);
                    java.util.Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String name = keys.next();
                        String lower = name.toLowerCase(Locale.US);
                        if (lower.equals("host") || lower.equals("connection") ||
                                lower.equals("content-length") || lower.equals("transfer-encoding") ||
                                lower.equals("upgrade") || lower.equals("keep-alive")) {
                            continue;
                        }
                        String value = headers.optString(name, "");
                        if (!value.isEmpty()) conn.setRequestProperty(name, value);
                    }
                } catch (Exception ignored) { }

                if (!verb.equals("GET")) {
                    byte[] data = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(data.length);
                    if (data.length > 0) {
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(data);
                        }
                    }
                }
                int code = conn.getResponseCode();
                InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String text = readAll(stream);
                reusable = stream != null;
                callJs("window.__jarvisHttpRaw(" + q(id) + "," + code + "," + q(text) + ")");
            } catch (Exception e) {
                callJs("window.__jarvisHttpRaw(" + q(id) + ",0," + q("NETWORK: " + e) + ")");
            } finally {
                if (conn != null && !reusable) conn.disconnect();
            }
        }, "jarvis-http").start();
    }

    private static boolean isPrivateHttpHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.US);
        if (h.isEmpty()) return false;
        if (h.equals("localhost") || h.equals("::1") || h.equals("[::1]")) return true;
        if (h.endsWith(".local")) return true;
        if (!h.contains(".")) return true; // a local hostname such as "homeassistant"
        return h.matches("^10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")
                || h.matches("^127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$")
                || h.matches("^192\\.168\\.\\d{1,3}\\.\\d{1,3}$")
                || h.matches("^172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}$")
                || h.matches("^169\\.254\\.\\d{1,3}\\.\\d{1,3}$");
    }

    private static String readAll(InputStream is) {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
        } catch (Exception ignored) { }
        return sb.toString();
    }

    // --------------------------------------------------------------- tools

    @JavascriptInterface
    public String executeTool(String name, String argsJson) {
        try {
            JSONObject args = new JSONObject(argsJson == null || argsJson.isEmpty() ? "{}" : argsJson);
            String result = AppIntents.execute(activity, name, args);
            Log.d(TAG, "tool " + name + " -> " + result);
            return result;
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"Tool arguments galat hain.\",\"needs_user_action\":false}";
        }
    }

    @JavascriptInterface
    public String getStatus() {
        return AppIntents.execute(activity, "device_status", new JSONObject());
    }

    @JavascriptInterface
    public String version() {
        return "2.2.0";
    }

    @JavascriptInterface
    public String deviceSummary() {
        return Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE;
    }

    @JavascriptInterface
    public void log(String message) {
        Log.d("JarvisWeb", message == null ? "" : message);
    }

    // ------------------------------------------------------------ small UI

    @JavascriptInterface
    public void toast(String message) {
        main.post(() -> Toast.makeText(activity, message == null ? "" : message, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            int d = Math.max(10, Math.min(800, ms));
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(d);
            }
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public void keepAwake(boolean on) {
        main.post(() -> {
            try {
                if (on) activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } catch (Exception ignored) { }
        });
    }

    @JavascriptInterface
    public void copyText(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Jarvis", text == null ? "" : text));
        } catch (Exception ignored) { }
    }

    /** Dictation: append text to the field that currently has focus. */
    @JavascriptInterface
    public String insertText(String text) {
        String safe = text == null ? "" : text;
        try {
            if (JarvisAccessibilityService.appendText(safe)) {
                return "{\"ok\":true,\"mode\":\"typed\"}";
            }
        } catch (Exception ignored) { }
        try {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Jarvis", safe));
        } catch (Exception ignored) { }
        return "{\"ok\":false,\"mode\":\"clipboard\"}";
    }

    /** Dictation edit: replace the whole focused field with the corrected buffer. */
    @JavascriptInterface
    public String replaceText(String text) {
        String safe = text == null ? "" : text;
        try {
            if (JarvisAccessibilityService.setText(safe)) {
                return "{\"ok\":true,\"mode\":\"replaced\"}";
            }
        } catch (Exception ignored) { }
        try {
            ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Jarvis", safe));
        } catch (Exception ignored) { }
        return "{\"ok\":false,\"mode\":\"clipboard\"}";
    }

    @JavascriptInterface
    public void finishApp() {
        main.post(() -> {
            try { prefs.edit().putBoolean(JarvisService.KEY_ALWAYS_ON, false).apply(); } catch (Exception ignored) { }
            try { JarvisService.stop(activity); } catch (Exception ignored) { }
            try { speech.destroy(); } catch (Exception ignored) { }
            try { neural.shutdown(); } catch (Exception ignored) { }
            try { tts.shutdown(); } catch (Exception ignored) { }
            activity.finishAffinity();
        });
    }
}
