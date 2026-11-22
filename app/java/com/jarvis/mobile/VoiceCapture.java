package com.jarvis.mobile;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import java.io.ByteArrayOutputStream;

/** Short private PCM capture used only for the optional local voice check. */
final class VoiceCapture {
    private static final int RATE = VoicePrint.SAMPLE_RATE;
    private static final int FRAMES = 1280; // 80 ms at 16 kHz

    private final AudioRecord record;
    private final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    private volatile boolean running = false;
    private Thread reader;

    VoiceCapture() {
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        int size = Math.max(min, FRAMES * 2 * 4);
        AudioRecord r;
        try {
            r = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size);
        } catch (Exception e) {
            r = null;
        }
        record = r;
    }

    boolean available() { return record != null && record.getState() == AudioRecord.STATE_INITIALIZED; }

    boolean start() {
        if (!available() || running) return false;
        try {
            record.startRecording();
            running = true;
            pcm.reset();
            reader = new Thread(() -> {
                byte[] buf = new byte[FRAMES * 2];
                while (running) {
                    int n = record.read(buf, 0, buf.length);
                    if (n > 0) {
                        synchronized (pcm) { pcm.write(buf, 0, n); }
                    } else if (n < 0) {
                        break;
                    }
                }
            }, "jarvis-voice-capture");
            reader.start();
            return true;
        } catch (Exception e) {
            running = false;
            return false;
        }
    }

    short[] stop() {
        running = false;
        if (reader != null) {
            try { reader.join(600); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            reader = null;
        }
        try {
            if (record != null && record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                record.stop();
            }
        } catch (Exception e) { }
        byte[] bytes;
        synchronized (pcm) { bytes = pcm.toByteArray(); }
        int count = bytes.length / 2;
        if (count == 0) return null;
        short[] out = new short[count];
        java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(out);
        return out;
    }

    void release() {
        running = false;
        try { if (record != null) record.release(); } catch (Exception e) { }
    }
}
