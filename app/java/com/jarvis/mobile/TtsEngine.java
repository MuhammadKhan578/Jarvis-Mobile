package com.jarvis.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Male-first Android TextToSpeech wrapper.
 *
 * The app always asks for a male voice.  Android does not expose a reliable
 * "gender" flag for every engine, so we combine: explicit voice choice, any
 * "male" feature flag, a low pitch, and en-IN / en-GB as preferred locales.
 */
public class TtsEngine implements TextToSpeech.OnInitListener {

    public interface Listener {
        void onTtsDone();
        void onTtsError(String message);
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean initFailed = false;
    private Listener listener;

    private String pendingRoman = "";
    private String pendingUrdu = "";
    private String gender = "male";
    private String voiceName = "";
    private float rate = 0.97f;
    private String lastUtteranceId = "";
    private int sequence = 0;
    private String lastLang = "en";

    public TtsEngine(Context context) {
        this.context = context.getApplicationContext();
        main.post(this::initEngine);
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    private void initEngine() {
        if (tts != null) return;
        try {
            tts = new TextToSpeech(context, this);
        } catch (Exception e) {
            initFailed = true;
            notifyError("TTS start nahi ho saka: " + e.getMessage());
        }
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            initFailed = true;
            notifyError("Is phone par Text To Speech engine nahi mila. Settings > Text-to-speech check karein.");
            return;
        }
        try {
            tts.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }
                @Override public void onDone(String utteranceId) {
                    if (utteranceId != null && utteranceId.equals(lastUtteranceId)) {
                        main.post(() -> { if (listener != null) listener.onTtsDone(); });
                    }
                }
                @Override public void onError(String utteranceId) {
                    if (utteranceId != null && utteranceId.equals(lastUtteranceId)) {
                        main.post(() -> notifyError("Voice output fail ho gaya."));
                    }
                }
                @Override public void onStop(String utteranceId, boolean interrupted) {
                    if (utteranceId != null && utteranceId.equals(lastUtteranceId)) {
                        main.post(() -> { if (listener != null) listener.onTtsDone(); });
                    }
                }
            });
            ready = true;
            applyVoice("en");
            if (!pendingRoman.isEmpty() || !pendingUrdu.isEmpty()) {
                String r = pendingRoman, u = pendingUrdu;
                pendingRoman = ""; pendingUrdu = "";
                speak(r, u);
            }
        } catch (Exception e) {
            initFailed = true;
            notifyError("TTS configure nahi ho saka: " + e.getMessage());
        }
    }

    private static final String[] KNOWN_MALE = {
            "en-in-x-end-local", "en-in-x-end-network",
            "en-gb-x-gbb-local", "en-gb-x-gbb-network",
            "en-gb-x-gbd-local", "en-gb-x-gbd-network"
    };

    private static boolean isKnownMale(String name) {
        if (name == null) return false;
        String n = name.toLowerCase(Locale.ROOT);
        for (String m : KNOWN_MALE) if (m.equals(n)) return true;
        return false;
    }

    public boolean hasUrduVoice() {
        if (tts == null) return false;
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return false;
            boolean wantMale = !"female".equals(gender);
            for (Voice v : voices) {
                if (v.getLocale() == null || !"ur".equals(v.getLocale().getLanguage())) continue;
                if (!wantMale) return true;
                String f = v.getFeatures() == null ? ""
                        : android.text.TextUtils.join(" ", v.getFeatures()).toLowerCase(Locale.ROOT);
                if (f.contains("male") && !f.contains("female")) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private void applyVoice(String langCode) {
        if (tts == null) return;
        lastLang = langCode;
        boolean wantUrdu = "ur".equals(langCode) && hasUrduVoice();
        String wantLang = wantUrdu ? "ur" : "en";
        Voice best = null;
        int bestScore = Integer.MIN_VALUE;
        try {
            Set<Voice> voices = tts.getVoices();
            List<Voice> list = voices == null ? new ArrayList<>() : new ArrayList<>(voices);
            for (Voice v : list) {
                if (v.getLocale() == null || !wantLang.equals(v.getLocale().getLanguage())) continue;
                int score = 0;
                String country = v.getLocale().getCountry();
                if ("IN".equals(country)) score += 100;
                else if ("GB".equals(country)) score += 60;
                else if ("US".equals(country)) score += 40;
                score += v.getQuality() * 10;
                if (v.isNetworkConnectionRequired()) score -= 15;
                String features = v.getFeatures() == null ? "" : android.text.TextUtils.join(" ", v.getFeatures()).toLowerCase(Locale.ROOT);
                if (features.contains("male") && !features.contains("female")) score += 300;
                if (features.contains("female")) score -= 40;
                if (isKnownMale(v.getName())) score += 700;
                if (!voiceName.isEmpty() && voiceName.equals(v.getName())) score += 1000;
                if (score > bestScore) { bestScore = score; best = v; }
            }
            if (best != null) tts.setVoice(best);
            if (!wantUrdu) {
                int avail = tts.setLanguage(new Locale("en", "IN"));
                if (avail == TextToSpeech.LANG_MISSING_DATA || avail == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.US);
                }
            } else {
                tts.setLanguage(new Locale("ur", "PK"));
            }
            // setLanguage() can silently replace the voice, so set our chosen
            // voice again *after* the language call.  This keeps the male voice
            // locked instead of drifting to the language default (often female).
            if (best != null) tts.setVoice(best);
        } catch (Exception ignored) { }
        boolean male = !"female".equals(gender);
        boolean knownMale = best != null && isKnownMale(best.getName());
        tts.setPitch(male ? (knownMale ? 1.0f : 0.80f) : 1.12f);
        tts.setSpeechRate(clampRate(rate));
        String applied = best == null ? "default" : best.getName();
        try {
            Voice actual = tts.getVoice();
            if (actual != null && actual.getName() != null) applied = actual.getName();
        } catch (Exception ignored) { }
        android.util.Log.d("JarvisMobile", "TTS voice=" + applied
                + " lang=" + wantLang + " male=" + male + " knownMale=" + knownMale);
    }

    private float clampRate(float r) {
        if (r < 0.5f) return 0.5f;
        if (r > 1.6f) return 1.6f;
        return r;
    }

    public void setPrefs(String newGender, float newRate, String newVoiceName) {
        main.post(() -> {
            if (newGender != null && !newGender.isEmpty()) gender = newGender;
            rate = clampRate(newRate);
            if (newVoiceName != null) voiceName = newVoiceName;
            if (ready) applyVoice(lastLang);
        });
    }

    public String getVoicesJson() {
        JSONArray arr = new JSONArray();
        try {
            if (tts == null) initEngine();
            Set<Voice> voices = tts == null ? null : tts.getVoices();
            if (voices != null) {
                List<Voice> list = new ArrayList<>(voices);
                Collections.sort(list, Comparator.comparing(v -> v.getLocale() == null ? "" :
                        v.getLocale().toLanguageTag() + " " + v.getName()));
                for (Voice v : list) {
                    String features = v.getFeatures() == null ? "" : android.text.TextUtils.join(" ", v.getFeatures()).toLowerCase(Locale.ROOT);
                    String g = features.contains("male") ? "male" : (features.contains("female") ? "female" : "");
                    JSONObject o = new JSONObject();
                    o.put("name", v.getName());
                    o.put("locale", v.getLocale() == null ? "" : v.getLocale().toLanguageTag());
                    o.put("quality", v.getQuality());
                    o.put("network", v.isNetworkConnectionRequired());
                    o.put("gender", g);
                    arr.put(o);
                }
            }
        } catch (Exception ignored) { }
        return arr.toString();
    }

    /** Speaks the roman line, or the urdu line when a real Urdu voice exists. */
    public void speak(String roman, String urdu) {
        main.post(() -> {
            if (tts == null && !initFailed) initEngine();
            if (!ready) {
                pendingRoman = roman == null ? "" : roman;
                pendingUrdu = urdu == null ? "" : urdu;
                return;
            }
            boolean urduVoice = urdu != null && !urdu.trim().isEmpty() && hasUrduVoice();
            String text = urduVoice ? urdu.trim() : (roman == null ? "" : roman.trim());
            String lang = urduVoice ? "ur" : "en";
            if (text.isEmpty()) { notifyDone(); return; }
            text = cleanForSpeech(text);
            if (text.isEmpty()) { notifyDone(); return; }
            applyVoice(lang);
            String id = "jv" + (++sequence);
            lastUtteranceId = id;
            android.os.Bundle params = new android.os.Bundle();
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, id);
            int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, id);
            if (r != TextToSpeech.SUCCESS) notifyError("Voice output shuru nahi ho saka.");
        });
    }

    private String cleanForSpeech(String text) {
        String t = text;
        t = t.replaceAll("```[\\s\\S]*?```", " ");
        t = t.replaceAll("[*_#>`]+", " ");
        t = t.replaceAll("[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]", " "); // emoji
        t = t.replaceAll("\\s+", " ");
        return t.trim();
    }

    public void stop() {
        main.post(() -> {
            try { if (tts != null) tts.stop(); } catch (Exception ignored) { }
        });
    }

    public void shutdown() {
        main.post(() -> {
            try { if (tts != null) { tts.stop(); tts.shutdown(); } } catch (Exception ignored) { }
            tts = null;
            ready = false;
        });
    }

    private void notifyDone() {
        if (listener != null) listener.onTtsDone();
    }

    private void notifyError(String msg) {
        if (listener != null) listener.onTtsError(msg);
    }
}
