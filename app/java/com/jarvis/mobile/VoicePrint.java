package com.jarvis.mobile;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;

/**
 * Local, on-device speaker check. No cloud, no upload, no account.
 *
 * A short utterance is reduced to a small MFCC-like vector (13 coefficients).
 * Enrolment stores that vector in private app storage; verification compares
 * a later utterance with a cosine score. This is a convenience lock, not a
 * biometric guarantee - the UI says so honestly and it is always skippable.
 */
final class VoicePrint {
    static final int SAMPLE_RATE = 16000;
    private static final String PREF = "jarvis_voiceprint";
    private static final String KEY_VECTOR = "vector";
    private static final String KEY_ENABLED = "enabled";
    private static final int NFFT = 512;
    private static final int HOP = 160;
    private static final int COEFS = 13;
    private static final int FILTERS = 26;
    private static final double PRE_EMPH = 0.97;

    private final SharedPreferences prefs;
    private float[] enrolled;
    private float lastScore = -1f;

    VoicePrint(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
        load();
    }

    private void load() {
        String raw = prefs.getString(KEY_VECTOR, "");
        if (raw == null || raw.isEmpty()) { enrolled = null; return; }
        try {
            JSONArray a = new JSONArray(raw);
            if (a.length() != COEFS) { enrolled = null; return; }
            float[] v = new float[COEFS];
            for (int i = 0; i < COEFS; i++) v[i] = (float) a.getDouble(i);
            enrolled = v;
        } catch (Exception e) {
            enrolled = null;
        }
    }

    boolean hasEnrollment() { return enrolled != null; }

    boolean isEnabled() { return hasEnrollment() && prefs.getBoolean(KEY_ENABLED, false); }

    void setEnabled(boolean on) {
        prefs.edit().putBoolean(KEY_ENABLED, on && hasEnrollment()).apply();
    }

    void clear() {
        prefs.edit().remove(KEY_VECTOR).putBoolean(KEY_ENABLED, false).apply();
        enrolled = null;
        lastScore = -1f;
    }

    float lastScore() { return lastScore; }

    /** Enrol or refine the vector. Two samples are averaged; stored privately. */
    boolean enroll(short[] pcm) {
        float[] v = features(pcm);
        if (v == null) return false;
        if (enrolled != null) {
            for (int i = 0; i < COEFS; i++) enrolled[i] = 0.5f * enrolled[i] + 0.5f * v[i];
            v = enrolled;
        }
        normalize(v);
        try {
            JSONArray a = new JSONArray();
            for (int i = 0; i < COEFS; i++) a.put((double) v[i]);
            prefs.edit().putString(KEY_VECTOR, a.toString()).putBoolean(KEY_ENABLED, true).apply();
            enrolled = v;
            lastScore = 1f;
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** >0.80 means the same voice in practice on a quiet TECNO mic. */
    boolean verify(short[] pcm) {
        lastScore = -1f;
        if (enrolled == null) return true;
        float[] v = features(pcm);
        if (v == null) return false;
        float dot = 0f;
        for (int i = 0; i < COEFS; i++) dot += enrolled[i] * v[i];
        lastScore = dot;
        return dot >= 0.80f;
    }

    private static void normalize(float[] v) {
        double norm = 0;
        for (float x : v) norm += x * x;
        if (norm < 1e-12) return;
        double inv = 1.0 / Math.sqrt(norm);
        for (int i = 0; i < v.length; i++) v[i] *= inv;
    }

    private static double mel(double hz) { return 2595.0 * Math.log10(1.0 + hz / 700.0); }
    private static double hzFromMel(double m) { return 700.0 * (Math.pow(10.0, m / 2595.0) - 1.0); }

    private static void fft(double[] re, double[] im) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            while (j >= bit) { j -= bit; bit >>= 1; }
            j += bit;
            if (i < j) {
                double t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2.0 * Math.PI / len;
            double wr = Math.cos(ang), wi = Math.sin(ang);
            int half = len >> 1;
            for (int i = 0; i < n; i += len) {
                double cr = 1, ci = 0;
                for (int k = 0; k < half; k++) {
                    int u = i + k, v = u + half;
                    double tr = re[v] * cr - im[v] * ci;
                    double ti = re[v] * ci + im[v] * cr;
                    re[v] = re[u] - tr; im[v] = im[u] - ti;
                    re[u] += tr; im[u] += ti;
                    double ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
    }

    private static float[] features(short[] pcm) {
        if (pcm == null || pcm.length < NFFT + HOP) return null;
        int frames = (pcm.length - NFFT) / HOP;
        if (frames < 2) return null;

        // Mel filterbank edges, computed once.
        int[] start = new int[FILTERS], end = new int[FILTERS];
        double maxMel = mel(SAMPLE_RATE / 2.0);
        for (int m = 0; m < FILTERS; m++) {
            double f0 = maxMel * m / (FILTERS + 1.0);
            double f1 = maxMel * (m + 2.0) / (FILTERS + 1.0);
            start[m] = (int) Math.floor(hzFromMel(f0) / (SAMPLE_RATE / 2.0) * (NFFT / 2.0));
            end[m] = (int) Math.ceil(hzFromMel(f1) / (SAMPLE_RATE / 2.0) * (NFFT / 2.0));
            if (end[m] <= start[m]) end[m] = start[m] + 1;
            if (end[m] > NFFT / 2) end[m] = NFFT / 2;
        }

        double[] sum = new double[COEFS];
        int used = 0;
        double[] re = new double[NFFT], im = new double[NFFT];
        double[] logE = new double[FILTERS];
        for (int f = 0; f < frames; f++) {
            int off = f * HOP;
            double energy = 0;
            for (int i = 0; i < NFFT; i++) {
                double cur = pcm[off + i] / 32768.0;
                double prev = (off + i > 0) ? pcm[off + i - 1] / 32768.0 : 0.0;
                double w = 0.54 - 0.46 * Math.cos(2.0 * Math.PI * i / (NFFT - 1));
                re[i] = (cur - PRE_EMPH * prev) * w;
                im[i] = 0;
                energy += re[i] * re[i];
            }
            if (energy < 1e-7) continue;
            fft(re, im);
            for (int m = 0; m < FILTERS; m++) {
                double acc = 0;
                for (int k = start[m]; k < end[m]; k++) {
                    double p = re[k] * re[k] + im[k] * im[k];
                    double w = (k - start[m] + 1.0) / (end[m] - start[m] + 1.0);
                    acc += p * w;
                }
                logE[m] = Math.log(acc + 1e-10);
            }
            for (int c = 1; c <= COEFS; c++) {
                double d = 0;
                for (int m = 0; m < FILTERS; m++) {
                    d += logE[m] * Math.cos(Math.PI * c * (m + 0.5) / FILTERS);
                }
                sum[c - 1] += d;
            }
            used++;
        }
        if (used == 0) return null;
        float[] v = new float[COEFS];
        for (int i = 0; i < COEFS; i++) v[i] = (float) (sum[i] / used);
        normalize(v);
        return v;
    }
}
