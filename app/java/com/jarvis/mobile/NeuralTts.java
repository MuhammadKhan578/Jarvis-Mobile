package com.jarvis.mobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Natural neural voice for Jarvis, powered by Gemini TTS.
 *
 * The desktop Jarvis sounds human because it uses the Microsoft neural voices.
 * Android's built-in TextToSpeech is robotic, so this class synthesises the
 * same reply with Gemini TTS (the user's existing Gemini key) and plays the
 * returned 24 kHz WAV.  Sentence requests run in parallel and playback stays
 * in order, so the first words start in a couple of seconds even for a longer
 * answer.
 *
 * If anything fails (no key, no network, model missing) the caller falls back
 * to the normal Android voice, so the phone never goes silent.
 */
public class NeuralTts {

    public interface Listener {
        void onNeuralDone();
        void onNeuralError(String message);
    }

    private static final String TAG = "JarvisMobile";

    /** Newest model first; every one of them speaks English and Urdu. */
    private static final String[] MODELS = {
            "gemini-3.8-flash-tts",
            "gemini-3.1-flash-tts-preview",
            "gemini-2.5-flash-preview-tts"
    };

    private static final int MAX_CACHE_FILES = 80;
    private static final int IO_TIMEOUT_MS = 9000;
    private static final int CONNECT_TIMEOUT_MS = 6000;
    /** Remembers the model that worked, so the next reply skips dead models. */
    private static volatile String goodModel = "";

    private List<String> modelOrder() {
        List<String> order = new ArrayList<>();
        String good = goodModel;
        if (good != null && !good.isEmpty()) {
            for (String m : MODELS) {
                if (m.equals(good)) { order.add(m); break; }
            }
        }
        for (String m : MODELS) {
            if (!order.contains(m)) order.add(m);
        }
        return order;
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final Object lock = new Object();

    private Listener listener;
    private MediaPlayer player;

    // ---- per-utterance state (guarded by lock) ----
    private int generation = 0;
    private int total = 0;
    private int nextToPlay = 0;
    private boolean playing = false;
    private boolean playedAny = false;
    private boolean finished = false;
    private final Map<Integer, File> ready = new HashMap<>();
    private String voice = "Charon";
    private String apiKey = "";
    private String lastError = "";

    public NeuralTts(Context context) {
        this.context = context.getApplicationContext();
    }

    public void setListener(Listener l) {
        this.listener = l;
    }

    public boolean isSpeaking() {
        synchronized (lock) {
            return playing || (!finished && total > 0);
        }
    }

    public boolean hasPlayedAny() {
        synchronized (lock) {
            return playedAny;
        }
    }

    public String lastError() {
        synchronized (lock) {
            return lastError;
        }
    }

    /**
     * Speaks the given sentences in order.
     *
     * @param sentences already cleaned, short sentences
     * @param voiceName Gemini prebuilt voice (Charon, Orus, Fenrir, Puck...)
     * @param key       Gemini API key
     */
    public void speak(final List<String> sentences, String voiceName, String key) {
        final List<String> list = sanitize(sentences);
        // Cancel whatever is still playing from the previous reply.
        stop();
        if (list.isEmpty()) {
            main.post(this::notifyDone);
            return;
        }
        final int gen;
        synchronized (lock) {
            gen = ++generation;
            total = list.size();
            nextToPlay = 0;
            playing = false;
            playedAny = false;
            finished = false;
            ready.clear();
            lastError = "";
            voice = (voiceName == null || voiceName.trim().isEmpty()) ? "Charon" : voiceName.trim();
            apiKey = key == null ? "" : key.trim();
        }
        if (apiKey.isEmpty()) {
            fail(gen, "No API key for neural voice.");
            return;
        }
        for (int i = 0; i < list.size(); i++) {
            final int index = i;
            final String text = list.get(i);
            pool.execute(() -> synthesize(gen, index, text));
        }
    }

    public void stop() {
        synchronized (lock) {
            generation++;
            total = 0;
            nextToPlay = 0;
            playing = false;
            finished = true;
            ready.clear();
        }
        main.post(() -> {
            try {
                if (player != null) {
                    player.stop();
                    player.release();
                }
            } catch (Exception ignored) { }
            player = null;
        });
    }

    public void shutdown() {
        stop();
        try { pool.shutdownNow(); } catch (Exception ignored) { }
    }

    /**
     * Warms the on-disk cache for phrases that Jarvis says all the time
     * ("Ji sir?", "Ho gaya, sir.").  Runs quietly in the background and never
     * plays anything, so the first real reply starts instantly.
     */
    public void prefetch(List<String> phrases, String voiceName, String key) {
        final List<String> list = sanitize(phrases);
        final String v = (voiceName == null || voiceName.trim().isEmpty()) ? "Charon" : voiceName.trim();
        final String k = key == null ? "" : key.trim();
        if (k.isEmpty() || list.isEmpty()) return;
        for (final String text : list) {
            pool.execute(() -> {
                try {
                    File cached = new File(ttsDir(), sha1(v + "|" + text) + ".wav");
                    if (cached.exists() && cached.length() > 1000) return;
                    byte[] audio = null;
                    String usedModel = "";
                    for (String model : modelOrder()) {
                        try {
                            audio = requestAudio(model, text, v, k);
                            if (audio != null && audio.length > 1000) {
                                usedModel = model;
                                break;
                            }
                        } catch (Exception ignored) { }
                    }
                    if (audio == null || audio.length <= 1000) return;
                    if (!usedModel.isEmpty()) goodModel = usedModel;
                    store(v, text, audio);
                } catch (Exception ignored) { }
            });
        }
    }

    private void store(String voiceName, String text, byte[] audio) throws Exception {
        File dir = ttsDir();
        File out = new File(dir, sha1(voiceName + "|" + text) + ".wav");
        File tmp = new File(dir, out.getName() + ".part");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(audio);
        }
        if (!tmp.renameTo(out)) {
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(audio);
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
        pruneCache(dir);
    }

    // ------------------------------------------------------------- synthesis

    private void synthesize(int gen, int index, String text) {
        try {
            File cached = cacheFile(text);
            if (cached.exists() && cached.length() > 1000) {
                onFileReady(gen, index, cached);
                return;
            }
            byte[] audio = null;
            Exception last = null;
            String usedModel = "";
            final String useVoice;
            final String useKey;
            synchronized (lock) {
                useVoice = voice;
                useKey = apiKey;
            }
            for (String model : modelOrder()) {
                if (!isCurrent(gen)) return;
                try {
                    audio = requestAudio(model, text, useVoice, useKey);
                    if (audio != null && audio.length > 1000) {
                        usedModel = model;
                        break;
                    }
                } catch (Exception e) {
                    last = e;
                    Log.w(TAG, "TTS " + model + " failed: " + e);
                }
            }
            if (audio == null || audio.length <= 1000) {
                fail(gen, last == null ? "Neural voice ne audio nahi diya." : last.getMessage());
                return;
            }
            if (!usedModel.isEmpty()) goodModel = usedModel;
            store(useVoice, text, audio);
            onFileReady(gen, index, new File(ttsDir(), sha1(useVoice + "|" + text) + ".wav"));
        } catch (Exception e) {
            fail(gen, e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }

    /** Returns a playable WAV file (wraps raw PCM if the model returns l16). */
    private byte[] requestAudio(String model, String text, String voiceName, String key) throws Exception {
        JSONObject part = new JSONObject().put("text", text);
        JSONObject content = new JSONObject()
                .put("parts", new JSONArray().put(part));
        JSONObject voiceConfig = new JSONObject()
                .put("prebuiltVoiceConfig", new JSONObject().put("voiceName", voiceName));
        JSONObject speechConfig = new JSONObject().put("voiceConfig", voiceConfig);
        JSONObject generationConfig = new JSONObject()
                .put("responseModalities", new JSONArray().put("AUDIO"))
                .put("speechConfig", speechConfig);
        JSONObject payload = new JSONObject()
                .put("contents", new JSONArray().put(content))
                .put("generationConfig", generationConfig);

        HttpURLConnection conn = null;
        boolean reusable = false;
        try {
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/"
                    + model + ":generateContent");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(IO_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("x-goog-api-key", key);
            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body);
            }
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String raw = readAll(stream);
            reusable = stream != null;
            if (code < 200 || code >= 300) {
                throw new Exception("TTS HTTP " + code + ": " + trim(raw));
            }
            JSONObject json = new JSONObject(raw);
            JSONArray candidates = json.optJSONArray("candidates");
            if (candidates == null || candidates.length() == 0) {
                throw new Exception("TTS: koi audio nahi mila.");
            }
            JSONObject contentOut = candidates.getJSONObject(0).optJSONObject("content");
            JSONArray parts = contentOut == null ? null : contentOut.optJSONArray("parts");
            if (parts == null || parts.length() == 0) {
                throw new Exception("TTS: audio part nahi mila.");
            }
            JSONObject inline = null;
            for (int i = 0; i < parts.length(); i++) {
                JSONObject p = parts.optJSONObject(i);
                if (p != null && p.optJSONObject("inlineData") != null) {
                    inline = p.optJSONObject("inlineData");
                    break;
                }
            }
            if (inline == null) throw new Exception("TTS: inline audio nahi mila.");
            String mime = inline.optString("mimeType", "audio/wav");
            String b64 = inline.optString("data", "");
            if (b64.isEmpty()) throw new Exception("TTS: khali audio.");
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (mime.startsWith("audio/wav") || mime.startsWith("audio/x-wav")) {
                return bytes;
            }
            int rate = 24000;
            int channels = 1;
            String low = mime.toLowerCase(Locale.ROOT);
            int ri = low.indexOf("rate=");
            if (ri >= 0) {
                int end = ri + 5;
                while (end < low.length() && Character.isDigit(low.charAt(end))) end++;
                try { rate = Integer.parseInt(low.substring(ri + 5, end)); } catch (Exception ignored) { }
            }
            int ci = low.indexOf("channels=");
            if (ci >= 0) {
                int end = ci + 9;
                while (end < low.length() && Character.isDigit(low.charAt(end))) end++;
                try { channels = Integer.parseInt(low.substring(ci + 9, end)); } catch (Exception ignored) { }
            }
            return wrapWav(bytes, rate, channels);
        } finally {
            if (conn != null && !reusable) conn.disconnect();
        }
    }

    /** Minimal 16-bit PCM WAV container. */
    private static byte[] wrapWav(byte[] pcm, int rate, int channels) throws Exception {
        int byteRate = rate * channels * 2;
        int dataLen = pcm.length;
        ByteArrayOutputStream out = new ByteArrayOutputStream(dataLen + 44);
        writeAscii(out, "RIFF");
        writeInt(out, 36 + dataLen);
        writeAscii(out, "WAVE");
        writeAscii(out, "fmt ");
        writeInt(out, 16);
        writeShort(out, 1);              // PCM
        writeShort(out, channels);
        writeInt(out, rate);
        writeInt(out, byteRate);
        writeShort(out, channels * 2);   // block align
        writeShort(out, 16);             // bits
        writeAscii(out, "data");
        writeInt(out, dataLen);
        out.write(pcm);
        return out.toByteArray();
    }

    private static void writeAscii(OutputStream o, String s) throws Exception { o.write(s.getBytes("US-ASCII")); }
    private static void writeInt(OutputStream o, int v) throws Exception {
        o.write(v & 0xff); o.write((v >> 8) & 0xff); o.write((v >> 16) & 0xff); o.write((v >> 24) & 0xff);
    }
    private static void writeShort(OutputStream o, int v) throws Exception {
        o.write(v & 0xff); o.write((v >> 8) & 0xff);
    }

    // -------------------------------------------------------------- playback

    private void onFileReady(int gen, int index, File file) {
        synchronized (lock) {
            if (gen != generation) return;
            ready.put(index, file);
        }
        main.post(() -> pump(gen));
    }

    private void pump(int gen) {
        File file;
        synchronized (lock) {
            if (gen != generation || finished || playing) return;
            if (nextToPlay >= total) return;
            file = ready.get(nextToPlay);
            if (file == null) return;
            playing = true;
        }
        playFile(gen, file);
    }

    private void playFile(final int gen, File file) {
        try {
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            mp.setDataSource(file.getAbsolutePath());
            mp.setOnCompletionListener(m -> {
                synchronized (lock) {
                    if (gen != generation) { safeRelease(m); return; }
                    playedAny = true;
                    playing = false;
                    nextToPlay++;
                }
                safeRelease(m);
                main.post(() -> {
                    pump(gen);
                    maybeFinish(gen);
                });
            });
            mp.setOnErrorListener((m, what, extra) -> {
                fail(gen, "Audio play nahi hua (" + what + ").");
                safeRelease(m);
                return true;
            });
            mp.prepare();
            synchronized (lock) {
                if (gen != generation) {
                    safeRelease(mp);
                    return;
                }
                player = mp;
            }
            mp.start();
            synchronized (lock) {
                playedAny = true;
            }
        } catch (Exception e) {
            fail(gen, "Audio play fail: " + e.getMessage());
        }
    }

    private void maybeFinish(int gen) {
        synchronized (lock) {
            if (gen != generation || finished) return;
            if (playing || nextToPlay < total) return;
            finished = true;
        }
        main.post(this::notifyDone);
    }

    private void fail(int gen, String message) {
        synchronized (lock) {
            if (gen != generation || finished) return;
            finished = true;
            lastError = message == null ? "neural voice error" : message;
            generation++;
        }
        Log.w(TAG, "NeuralTts: " + message);
        main.post(() -> {
            if (listener != null) listener.onNeuralError(lastError);
        });
    }

    private boolean isCurrent(int gen) {
        synchronized (lock) {
            return gen == generation;
        }
    }

    private void notifyDone() {
        if (listener != null) listener.onNeuralDone();
    }

    private static void safeRelease(MediaPlayer mp) {
        try { mp.release(); } catch (Exception ignored) { }
    }

    // ----------------------------------------------------------------- files

    private File ttsDir() {
        File dir = new File(context.getCacheDir(), "neural_tts");
        if (!dir.exists()) //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        return dir;
    }

    private File cacheFile(String text) {
        return new File(ttsDir(), sha1(voice + "|" + text) + ".wav");
    }

    private void pruneCache(File dir) {
        try {
            File[] files = dir.listFiles();
            if (files == null || files.length <= MAX_CACHE_FILES) return;
            List<File> list = new ArrayList<>();
            Collections.addAll(list, files);
            Collections.sort(list, new Comparator<File>() {
                @Override public int compare(File a, File b) {
                    return Long.compare(a.lastModified(), b.lastModified());
                }
            });
            int remove = list.size() - MAX_CACHE_FILES;
            for (int i = 0; i < remove; i++) {
                //noinspection ResultOfMethodCallIgnored
                list.get(i).delete();
            }
        } catch (Exception ignored) { }
    }

    private static String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format(Locale.US, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    // --------------------------------------------------------------- helpers

    private static List<String> sanitize(List<String> in) {
        List<String> out = new ArrayList<>();
        if (in == null) return out;
        for (String s : in) {
            if (s == null) continue;
            String t = s.replaceAll("\\s+", " ").trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
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

    private static String trim(String s) {
        if (s == null) return "";
        s = s.replaceAll("\\s+", " ").trim();
        return s.length() > 160 ? s.substring(0, 160) : s;
    }
}
