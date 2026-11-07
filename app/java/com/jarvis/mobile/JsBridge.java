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
import java.util.Locale;
import java.util.Properties;

/**
 * The bridge between the HTML interface and Android hardware.
 * Everything here reports the real result; no action is ever pretended.
 */
public class JsBridge implements TtsEngine.Listener, SpeechEngine.Listener {

    private static final String TAG = "JarvisMobile";
    private static final String PREFS = "jarvis_mobile";
    private static final String KEY_GEMINI = "gemini_key";
    private static final String KEY_SEEDED = "key_seeded";

    private final Activity activity;
    private final WebView web;
    private final TtsEngine tts;
    private final SpeechEngine speech;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean pendingListen = false;

    public JsBridge(Activity activity, WebView web, TtsEngine tts, SpeechEngine speech) {
        this.activity = activity;
        this.web = web;
        this.tts = tts;
        this.speech = speech;
        this.prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.tts.setListener(this);
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
        callJs("window.jarvisNative&&jarvisNative.onTtsDone()");
    }

    @Override
    public void onTtsError(String message) {
        callJs("window.jarvisNative&&jarvisNative.onTtsError(" + q(message) + ")");
    }

    @JavascriptInterface
    public void speak(String roman, String urdu) {
        tts.speak(roman, urdu);
    }

    @JavascriptInterface
    public void stopSpeaking() {
        tts.stop();
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
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingListen = true;
            main.post(() -> activity.requestPermissions(
                    new String[]{Manifest.permission.RECORD_AUDIO}, MainActivity.REQ_MIC));
            return "permission";
        }
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
        if ("mic".equals(which) && granted && pendingListen) {
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
        if (k.length() < 20) return false;
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
        final int readTimeout = Math.max(8000, Math.min(30000, timeoutMs));
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/"
                        + model + ":generateContent");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(12000);
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
                callJs("window.__jarvisHttp(" + q(requestId) + "," + code + "," + q(text) + ")");
            } catch (Exception e) {
                String msg = e.toString();
                String safe = msg.replace("\"", "'");
                callJs("window.__jarvisHttp(" + q(requestId) + ",0," +
                        q("{\"error\":{\"message\":\"" + safe + "\",\"status\":\"TRANSPORT\"}}") + ")");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "jarvis-gemini").start();
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
        return "1.2.0";
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

    @JavascriptInterface
    public void finishApp() {
        main.post(() -> {
            try { speech.destroy(); } catch (Exception ignored) { }
            try { tts.shutdown(); } catch (Exception ignored) { }
            activity.finishAffinity();
        });
    }
}
