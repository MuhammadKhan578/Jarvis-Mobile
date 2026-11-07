package com.jarvis.mobile;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;

/**
 * Speech recognition restricted to English (India).
 *
 * Roman Urdu is understood through its Latin transcription, exactly like the
 * desktop Jarvis.  No Urdu (ur-PK) recognition model is used, because that
 * model produces Urdu script and misses Roman Urdu words.
 *
 * Accuracy notes (parity with the desktop Jarvis):
 *  - Google is given a vocabulary bias list, so app names like "Brave" and
 *    command words like "kholo" are preferred over similar sounding words.
 *  - It returns up to 8 candidates; the web layer scores all of them and picks
 *    the one that matches Jarvis vocabulary instead of blindly taking the
 *    first guess (which is what turned "Brave" into "Brain").
 *  - The silence window is long enough that a short pause in the middle of a
 *    sentence does not cut the sentence in half.
 *  - If the final result never arrives but a partial result did, that partial
 *    transcript is used instead of losing the command.
 */
public class SpeechEngine {

    public interface Listener {
        void onSpeechPartial(String text);
        void onSpeechFinal(String text, ArrayList<String> alternatives);
        void onSpeechError(int code, String message);
        void onSpeechEnd();
        void onSpeechReady();
        void onSpeechRms(float rms);
    }

    /** Words Jarvis expects to hear. Biasing lifts their recognition confidence. */
    private static final String[] BIAS_WORDS = {
            // wake word
            "jarvis", "hey jarvis",
            // apps
            "brave", "chrome", "youtube", "gmail", "whatsapp", "instagram", "facebook",
            "messenger", "telegram", "tiktok", "snapchat", "spotify", "netflix", "maps",
            "google maps", "photos", "gallery", "play store", "phone", "dialer", "messages",
            "contacts", "calendar", "keep", "files", "file manager", "settings", "calculator",
            "clock", "alarm", "camera", "music", "browser", "internet", "email", "mail", "video",
            // actions (Roman Urdu + English)
            "kholo", "khol do", "band karo", "chalao", "batao", "dikhao", "lagao", "suno",
            "likho", "banao", "bhejo", "padho", "bajao", "open", "launch", "play", "send",
            "call", "check", "set", "install", "install karo", "download", "search", "dhundo",
            "tap", "click", "type", "subscribe", "follow", "like", "share",
            // phone features
            "flashlight", "torch", "volume", "timer", "reminder", "inbox", "notification",
            "screenshot", "battery", "brightness", "wifi", "bluetooth", "airplane mode",
            "duolingo", "whatsapp", "instagram", "tiktok", "application", "automation",
            // small talk
            "kaise ho", "kya haal hai", "time kya hai", "good morning", "good night"
    };

    private final Context context;
    private Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private volatile boolean listening = false;
    private boolean destroyed = false;

    /**
     * Background ("always online") mode.
     *
     * When the WebView is hidden Android throttles its timers, so the JS layer
     * cannot reliably restart the recognizer. In auto-loop mode the native side
     * re-arms the microphone itself, which is what keeps "Hey Jarvis" working
     * with the screen off.
     */
    private volatile boolean autoLoop = false;
    /** Set while Jarvis is thinking or speaking: no mic restarts during that. */
    private volatile boolean held = false;
    private volatile boolean blockedByPermission = false;
    private Runnable restartRunnable;

    /**
     * Restart backoff: grows while the mic hears nothing, resets on speech.
     * Prevents the "beep every second" loop when nobody is talking.
     */
    private int emptyStreak = 0;

    /** Google's recognizer beep is played on the media/notification streams. */
    private final AudioManager audio;
    private final int[] beepStreams = {
            AudioManager.STREAM_MUSIC,
            AudioManager.STREAM_NOTIFICATION,
            AudioManager.STREAM_SYSTEM,
            AudioManager.STREAM_ACCESSIBILITY
    };
    private final boolean[] beepWasMuted = new boolean[beepStreams.length];
    private boolean beepMuted = false;
    private Runnable beepTimer;

    /** Recovery watchdog for a recognizer session that never calls back. */
    private Runnable watchdog;

    /** Every distinct transcript heard during the current utterance. */
    private final LinkedHashSet<String> heard = new LinkedHashSet<>();
    private String lastPartial = "";

    public SpeechEngine(Context context) {
        this.context = context.getApplicationContext();
        this.audio = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
        main.post(this::createRecognizer);
    }

    public void setListener(Listener newListener) {
        this.listener = newListener;
    }

    private void createRecognizer() {
        if (destroyed) return;
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            android.util.Log.w("JarvisMobile", "STT unavailable: no recognition service");
            return;
        }
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context);
            android.util.Log.d("JarvisMobile", "STT recognizer created");
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    listening = true;
                    scheduleBeepRestore(350);
                    android.util.Log.d("JarvisMobile", "STT ready");
                    if (listener != null) listener.onSpeechReady();
                }
                @Override public void onBeginningOfSpeech() {
                    armWatchdog(25000);
                    restoreBeepStreams();
                }
                @Override public void onRmsChanged(float rmsdB) {
                    if (listener != null) listener.onSpeechRms(rmsdB);
                }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() {
                    restoreBeepStreams();
                    if (listener != null) listener.onSpeechEnd();
                }
                @Override public void onError(int error) {
                    listening = false;
                    cancelWatchdog();
                    restoreBeepStreams();
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        blockedByPermission = true;
                    }
                    // A partial transcript is better than losing the command.
                    if ((error == SpeechRecognizer.ERROR_NO_MATCH
                            || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)
                            && !lastPartial.isEmpty()) {
                        ArrayList<String> all = snapshot();
                        if (!all.contains(lastPartial)) all.add(0, lastPartial);
                        android.util.Log.d("JarvisMobile", "STT recover partial: " + lastPartial);
                        if (listener != null) listener.onSpeechFinal(lastPartial, all);
                        emptyStreak = 0;
                        scheduleRestart(400);
                        return;
                    }
                    android.util.Log.w("JarvisMobile", "STT error " + error + " " + errorText(error));
                    if (listener != null) listener.onSpeechError(error, errorText(error));
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        // Do not spin: wait for the user to grant the permission.
                        return;
                    }
                    scheduleRestart(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY
                            ? 1000
                            : nextRestartDelay(false));
                }
                @Override public void onResults(Bundle results) {
                    listening = false;
                    cancelWatchdog();
                    restoreBeepStreams();
                    ArrayList<String> all = collect(results);
                    if (all.isEmpty() && !lastPartial.isEmpty()) all.add(0, lastPartial);
                    String text = all.isEmpty() ? "" : all.get(0);
                    android.util.Log.d("JarvisMobile", "STT result: " + text + " (candidates=" + all.size() + ")");
                    if (listener != null) {
                        if (text.isEmpty()) listener.onSpeechError(SpeechRecognizer.ERROR_NO_MATCH,
                                "Awaaz mili lekin alfaz samajh nahi aaye.");
                        else listener.onSpeechFinal(text, all);
                    }
                    scheduleRestart(nextRestartDelay(!text.isEmpty()));
                }
                @Override public void onPartialResults(Bundle partialResults) {
                    String text = firstResult(partialResults);
                    if (text.isEmpty()) return;
                    emptyStreak = 0;
                    lastPartial = text;
                    heard.add(text);
                    armWatchdog(25000);
                    if (listener != null) listener.onSpeechPartial(text);
                }
                @Override public void onEvent(int eventType, Bundle params) { }
            });
        } catch (Exception e) {
            recognizer = null;
        }
    }

    private String firstResult(Bundle bundle) {
        if (bundle == null) return "";
        ArrayList<String> list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return "";
        for (String s : list) {
            if (s != null && !s.trim().isEmpty()) return s.trim();
        }
        return "";
    }

    /** Final candidates first (Google's confidence order), then partials. */
    private ArrayList<String> collect(Bundle bundle) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (bundle != null) {
            ArrayList<String> list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (list != null) {
                for (String s : list) {
                    if (s == null) continue;
                    String t = s.trim();
                    if (!t.isEmpty()) out.add(t);
                }
            }
        }
        // Most recent partials first, they are usually closer to the words spoken.
        ArrayList<String> recent = new ArrayList<>(heard);
        for (int i = recent.size() - 1; i >= 0; i--) out.add(recent.get(i));
        return new ArrayList<>(out);
    }

    private ArrayList<String> snapshot() {
        return new ArrayList<>(heard);
    }

    // --------------------------------------------------- beep + session guard

    /**
     * Google's speech service plays a short chime on every recognizer start.
     * There is no public API to disable it, so the standard workaround is to
     * briefly mute the streams it uses and restore them right after the
     * session becomes ready. Only used for the native background loop.
     */
    private void muteBeepStreams() {
        if (audio == null || beepMuted) return;
        beepMuted = true;
        for (int i = 0; i < beepStreams.length; i++) {
            try {
                beepWasMuted[i] = audio.isStreamMute(beepStreams[i]);
                if (!beepWasMuted[i]) audio.setStreamMute(beepStreams[i], true);
            } catch (Exception ignored) {
                beepWasMuted[i] = false;
            }
        }
    }

    private void restoreBeepStreams() {
        if (!beepMuted) return;
        beepMuted = false;
        if (beepTimer != null) {
            main.removeCallbacks(beepTimer);
            beepTimer = null;
        }
        if (audio == null) return;
        for (int i = 0; i < beepStreams.length; i++) {
            try {
                if (!beepWasMuted[i]) audio.setStreamMute(beepStreams[i], false);
            } catch (Exception ignored) { }
        }
    }

    private void scheduleBeepRestore(long delayMs) {
        if (!beepMuted) return;
        if (beepTimer != null) main.removeCallbacks(beepTimer);
        beepTimer = this::restoreBeepStreams;
        main.postDelayed(beepTimer, Math.max(120, delayMs));
    }

    private void armWatchdog(long timeoutMs) {
        cancelWatchdog();
        if (!autoLoop) return;
        watchdog = () -> {
            watchdog = null;
            if (!autoLoop || held || destroyed || !listening) return;
            android.util.Log.w("JarvisMobile", "STT watchdog: hung session, restarting");
            restoreBeepStreams();
            try { if (recognizer != null) recognizer.cancel(); } catch (Exception ignored) { }
            listening = false;
            heard.clear();
            lastPartial = "";
            if (listener != null) {
                listener.onSpeechError(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, "Speech timeout.");
            }
            scheduleRestart(nextRestartDelay(false));
        };
        main.postDelayed(watchdog, timeoutMs);
    }

    private void cancelWatchdog() {
        if (watchdog != null) {
            main.removeCallbacks(watchdog);
            watchdog = null;
        }
    }

    private long nextRestartDelay(boolean heardSomething) {
        if (heardSomething) {
            emptyStreak = 0;
            return 400;
        }
        emptyStreak = Math.min(emptyStreak + 1, 6);
        // Keep the idle gap short: the chime is muted, and the user should not
        // have to wait long before "Hey Jarvis" is heard again.
        return Math.min(2000L, 700L + emptyStreak * 400L);
    }

    public boolean isRecognitionAvailable() {
        return SpeechRecognizer.isRecognitionAvailable(context);
    }

    public boolean isListening() {
        return listening;
    }

    public void start() {
        main.post(() -> {
            if (destroyed) return;
            if (held) return;
            if (recognizer == null) createRecognizer();
            if (recognizer == null) {
                if (listener != null) listener.onSpeechError(-1,
                        "Speech recognition available nahi hai. Google app install/enable karein.");
                return;
            }
            if (listening) return;
            if (blockedByPermission) {
                if (context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
                blockedByPermission = false;
            }
            heard.clear();
            lastPartial = "";
            if (autoLoop) {
                // Native restarts produce a chime on every loop; silence it.
                muteBeepStreams();
            }
            try {
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-IN");
                intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 8);
                intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
                // Short windows: a voice assistant must answer immediately.
                // 1.2s of silence is enough to know the sentence finished.
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 650L);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.putExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, new ArrayList<>(Arrays.asList(BIAS_WORDS)));
                }
                listening = true;
                recognizer.startListening(intent);
                if (autoLoop) {
                    scheduleBeepRestore(2500);
                    armWatchdog(25000);
                }
            } catch (Exception e) {
                listening = false;
                restoreBeepStreams();
                cancelWatchdog();
                if (listener != null) listener.onSpeechError(-1,
                        "Microphone start nahi ho saka: " + e.getMessage());
            }
        });
    }

    // ------------------------------------------------- background listen loop

    /** Native auto-restart of the microphone (used while the app is in background). */
    public void setAutoLoop(boolean on) {
        boolean was = autoLoop;
        autoLoop = on;
        if (on) {
            if (!was) scheduleRestart(200);
        } else {
            cancelRestart();
            cancelWatchdog();
            restoreBeepStreams();
        }
    }

    public boolean isAutoLoop() {
        return autoLoop;
    }

    /** Pause the loop while Jarvis is thinking or speaking, then resume. */
    public void setHeld(boolean value) {
        boolean changed = held != value;
        held = value;
        if (value) {
            cancelRestart();
            cancelWatchdog();
        } else if (autoLoop && changed) {
            scheduleRestart(250);
        }
    }

    public boolean isHeld() {
        return held;
    }

    private void cancelRestart() {
        if (restartRunnable != null) {
            main.removeCallbacks(restartRunnable);
            restartRunnable = null;
        }
    }

    private void scheduleRestart(long delayMs) {
        if (!autoLoop || held || destroyed) return;
        cancelRestart();
        restartRunnable = new Runnable() {
            @Override
            public void run() {
                restartRunnable = null;
                if (!autoLoop || held || destroyed || listening) return;
                start();
            }
        };
        main.postDelayed(restartRunnable, Math.max(150, delayMs));
    }

    /** Stops but still delivers the final result. */
    public void stop() {
        main.post(() -> {
            restoreBeepStreams();
            try { if (recognizer != null && listening) recognizer.stopListening(); } catch (Exception ignored) { }
        });
    }

    /** Stops immediately and throws away any pending result. */
    public void cancel() {
        main.post(() -> {
            cancelRestart();
            cancelWatchdog();
            restoreBeepStreams();
            try { if (recognizer != null) recognizer.cancel(); } catch (Exception ignored) { }
            listening = false;
            heard.clear();
            lastPartial = "";
        });
    }

    public void destroy() {
        destroyed = true;
        autoLoop = false;
        main.post(() -> {
            cancelRestart();
            cancelWatchdog();
            restoreBeepStreams();
            try { if (recognizer != null) { recognizer.cancel(); recognizer.destroy(); } } catch (Exception ignored) { }
            recognizer = null;
            listening = false;
            heard.clear();
            lastPartial = "";
        });
    }

    private String errorText(int code) {
        switch (code) {
            case SpeechRecognizer.ERROR_AUDIO: return "Microphone audio problem.";
            case SpeechRecognizer.ERROR_CLIENT: return "Speech client problem.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission nahi hai.";
            case SpeechRecognizer.ERROR_NETWORK: return "Speech service ko internet nahi mil raha.";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "Speech service timeout.";
            case SpeechRecognizer.ERROR_NO_MATCH: return "Kuch samajh nahi aaya.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "Speech recognizer busy hai.";
            case SpeechRecognizer.ERROR_SERVER: return "Speech server error.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "Koi awaaz nahi aayi.";
            default: return "Speech error (" + code + ").";
        }
    }
}
