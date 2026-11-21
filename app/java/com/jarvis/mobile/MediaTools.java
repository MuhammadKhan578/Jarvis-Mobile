package com.jarvis.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.util.SparseIntArray;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Native media helpers for the WebView bridge. Uses only android.* and org.json.*.
 * Every failure is reported as JSON; nothing is reported as successful unless the
 * file really exists on disk.
 */
public final class MediaTools {

    private static final String TAG = "JarvisMedia";

    private static final int MAX_IMAGE_PIXELS = 16_000_000;
    private static final int MAX_IMAGE_DIMENSION = 8192;
    private static final int MAX_EDIT_DIMENSION = 4096;
    private static final long MAX_COPY_BYTES = 512L * 1024L * 1024L;
    private static final int MAX_SAMPLE_BUFFER = 512 * 1024;
    private static final long TRIM_TOLERANCE_US = 500_000L; // 0.5 s

    /** Bridge callback; JsBridge's implementation posts to the main thread. */
    public interface Callback {
        void onJs(String js);
    }

    private final Activity activity;
    private final Callback callback;
    private final Handler main = new Handler(Looper.getMainLooper());

    public MediaTools(Activity activity, Callback callback) {
        this.activity = activity;
        this.callback = callback == null ? js -> Log.d(TAG, js) : callback;
    }

    // --------------------------------------------------------------- helpers

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    private static String friendly(Throwable t) {
        if (t == null) return "Unknown error";
        String m = t.getMessage();
        if (m == null || m.trim().isEmpty()) m = t.getClass().getSimpleName();
        return m.length() > 300 ? m.substring(0, 300) : m;
    }

    private void fireJs(String js) {
        try { callback.onJs(js); } catch (Throwable ignored) { }
    }

    private static JSONObject baseError(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("message", message == null ? "Failed" : message);
        } catch (Exception ignored) { }
        return o;
    }

    private static String pickError(String id, String message) {
        JSONObject o = baseError(message);
        try {
            o.put("path", "");
            o.put("uri", "");
            o.put("name", "");
            o.put("kind", "any");
            o.put("size", 0);
        } catch (Exception ignored) { }
        return "window.jarvisMediaPicked(" + q(id) + "," + q(o.toString()) + ")";
    }

    private static String trimErrorJson(String message) {
        JSONObject o = baseError(message);
        try {
            o.put("output", "");
            o.put("bytes", 0);
            o.put("duration", 0);
        } catch (Exception ignored) { }
        return o.toString();
    }

    private static String editErrorJson(String message) {
        JSONObject o = baseError(message);
        try {
            o.put("output", "");
            o.put("width", 0);
            o.put("height", 0);
            o.put("bytes", 0);
        } catch (Exception ignored) { }
        return o.toString();
    }

    private static JSONObject parseOptions(String optionsJson) {
        try {
            return new JSONObject(optionsJson == null || optionsJson.trim().isEmpty()
                    ? "{}" : optionsJson);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static String stamp() {
        return new SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(new Date());
    }

    /** Keeps only a small, predictable character set in generated file names. */
    private static String safeName(String raw, String fallback) {
        if (raw == null) raw = "";
        String s = raw.replace('\\', '_').replace('/', '_');
        s = s.replaceAll("[^A-Za-z0-9._-]", "_");
        s = s.replaceAll("_{2,}", "_");
        while (s.startsWith("_") || s.startsWith(".")) s = s.substring(1);
        if (s.length() > 64) s = s.substring(s.length() - 64);
        return s.isEmpty() ? (fallback == null ? "media" : fallback) : s;
    }

    private static int clamp(int value, int lo, int hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    private static void close(InputStream in) {
        if (in == null) return;
        try { in.close(); } catch (Exception ignored) { }
    }

    private static void close(OutputStream out) {
        if (out == null) return;
        try { out.close(); } catch (Exception ignored) { }
    }

    private static void recycle(Bitmap b) {
        if (b != null) { try { b.recycle(); } catch (Throwable ignored) { } }
    }

    private void runOnMainSync(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            r.run();
            return;
        }
        final CountDownLatch latch = new CountDownLatch(1);
        main.post(() -> {
            try { r.run(); } finally { latch.countDown(); }
        });
        try {
            if (!latch.await(4000, TimeUnit.MILLISECONDS)) {
                Log.w(TAG, "main-thread operation timed out");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ------------------------------------------------------------- 1) picker

    /** Launches a system content picker. Must be called from JsBridge. */
    public void pickMedia(final String kind, final int requestCode, final String requestId) {
        final String id = requestId == null ? "" : requestId;
        final String type = mimeForKind(kind);
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.setType(type);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                activity.startActivityForResult(i, requestCode);
            } catch (Throwable t) {
                fireJs(pickError(id, "Media picker unavailable: " + friendly(t)));
            }
        });
    }

    /** Called by MainActivity -> JsBridge after the picker returns. */
    public void onPickResult(final int requestCode, final int resultCode,
                             final Intent data, final String requestId) {
        final String id = requestId == null ? "" : requestId;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            fireJs(pickError(id, resultCode == Activity.RESULT_CANCELED
                    ? "Selection cancelled" : "No media selected"));
            return;
        }
        final Uri uri = data.getData();
        // Copying a large file must not block the main thread.
        new Thread(() -> {
            OutputStream os = null;
            InputStream in = null;
            File dest = null;
            try {
                ContentResolver cr = activity.getContentResolver();
                try {
                    cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Throwable ignored) {
                    // Some providers do not support persistable grants; the copy
                    // below still succeeds for this session.
                }
                String mime = safeMime(cr.getType(uri));
                String kind = normalKind(mime.startsWith("image/") ? "image"
                        : mime.startsWith("video/") ? "video" : kindFromType(uri));
                String display = queryDisplayName(cr, uri);
                String ext = extensionForMime(mime, kind);
                String name = safeName(display, kind) + "_" + stamp() + ext;
                File dir = new File(activity.getCacheDir(), "picked");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IOException("Cannot create media cache");
                }
                dest = new File(dir, name);
                in = openSource(activity, uri.toString());
                os = new FileOutputStream(dest);
                byte[] buf = new byte[16 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > MAX_COPY_BYTES) {
                        throw new IOException("Selected file is too large (512 MB limit)");
                    }
                    os.write(buf, 0, n);
                }
                os.flush();
                close(os);
                os = null;
                if (!dest.exists() || dest.length() <= 0) {
                    throw new IOException("Selected file was empty");
                }
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("message", "Media selected");
                o.put("path", dest.getAbsolutePath());
                o.put("uri", uri.toString());
                o.put("name", name);
                o.put("kind", kind);
                o.put("size", dest.length());
                fireJs("window.jarvisMediaPicked(" + q(id) + "," + q(o.toString()) + ")");
            } catch (Throwable t) {
                close(os);
                if (dest != null) { try { dest.delete(); } catch (Exception ignored) { } }
                fireJs(pickError(id, "Could not copy selected media: " + friendly(t)));
            } finally {
                close(in);
            }
        }, "jarvis-media-copy").start();
    }

    private static String mimeForKind(String kind) {
        String k = kind == null ? "" : kind.trim().toLowerCase(Locale.US);
        if (k.startsWith("image") || k.equals("photo") || k.equals("picture")) return "image/*";
        if (k.startsWith("video") || k.equals("movie")) return "video/*";
        return "*/*";
    }

    private static String normalKind(String kind) {
        String k = kind == null ? "" : kind.trim().toLowerCase(Locale.US);
        if (k.startsWith("image") || k.equals("photo") || k.equals("picture")) return "image";
        if (k.startsWith("video") || k.equals("movie")) return "video";
        return "any";
    }

    private static String kindFromType(Uri uri) {
        String s = uri == null ? "" : uri.toString();
        String k = normalKind(s);
        return "any".equals(k) ? "*/*" : k;
    }

    private static String safeMime(String mime) {
        if (mime == null) return "";
        String m = mime.trim().toLowerCase(Locale.US);
        return m.matches("[a-z0-9.+-]+/[a-z0-9.+-]+") ? m : "";
    }

    private static String extensionForMime(String mime, String kind) {
        if (mime.equals("image/jpeg") || mime.equals("image/jpg")) return ".jpg";
        if (mime.equals("image/png")) return ".png";
        if (mime.equals("image/webp")) return ".webp";
        if (mime.equals("image/gif")) return ".gif";
        if (mime.equals("video/mp4")) return ".mp4";
        if (mime.equals("video/3gpp")) return ".3gp";
        if (mime.startsWith("video/")) return ".mp4";
        if (mime.startsWith("image/")) return ".jpg";
        return "video".equals(kind) ? ".mp4" : "image".equals(kind) ? ".jpg" : ".bin";
    }

    private static String queryDisplayName(ContentResolver cr, Uri uri) {
        Cursor c = null;
        try {
            c = cr.query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } catch (Throwable ignored) { } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) { } }
        }
        return null;
    }

    private static InputStream openSource(Context ctx, String src) throws IOException {
        if (src == null) throw new IOException("Empty path");
        String s = src.trim();
        if (s.startsWith("content://")) {
            InputStream is = ctx.getContentResolver().openInputStream(Uri.parse(s));
            if (is == null) throw new IOException("Cannot open content");
            return is;
        }
        if (s.startsWith("file://")) {
            String p = Uri.parse(s).getPath();
            if (p == null) throw new IOException("Invalid file URI");
            s = p;
        }
        File f = new File(s);
        if (!f.isFile()) throw new IOException("File not found");
        return new FileInputStream(f);
    }

    private static long sourceBytes(Context ctx, String src) {
        try {
            String s = src == null ? "" : src.trim();
            if (s.startsWith("content://")) {
                Cursor c = ctx.getContentResolver().query(Uri.parse(s), null, null, null, null);
                try {
                    if (c != null && c.moveToFirst()) {
                        int i = c.getColumnIndex(OpenableColumns.SIZE);
                        if (i >= 0) return Math.max(0L, c.getLong(i));
                    }
                } finally {
                    if (c != null) c.close();
                }
                return 0;
            }
            if (s.startsWith("file://")) s = Uri.parse(s).getPath();
            File f = new File(s == null ? "" : s);
            return f.isFile() ? f.length() : 0;
        } catch (Throwable ignored) { return 0; }
    }

    // ---------------------------------------------------------- 2) photo edit

    /** Synchronous image operation. Never writes to the source file. */
    public String editPhoto(String path, String action, String optionsJson) {
        Bitmap source = null;
        try {
            JSONObject opt = parseOptions(optionsJson);
            String a = action == null ? "info" : action.trim().toLowerCase(Locale.US);
            if (a.isEmpty()) a = "info";

            source = loadBitmap(activity, path, MAX_IMAGE_PIXELS);
            if ("info".equals(a)) {
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("message", "Image info");
                o.put("output", "");
                o.put("width", source.getWidth());
                o.put("height", source.getHeight());
                o.put("bytes", sourceBytes(activity, path));
                return o.toString();
            }

            Bitmap result = applyAction(source, a, opt);
            if (result == null) throw new IOException("Image operation produced no result");
            boolean png = isPng(path);
            File dir = pictureDir();
            File out = saveBitmap(result, dir,
                    safeName("jarvis_edit_" + a, "edit") + "_" + stamp() + (png ? ".png" : ".jpg"),
                    png);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("message", "Photo saved");
            o.put("output", out.getAbsolutePath());
            o.put("width", result.getWidth());
            o.put("height", result.getHeight());
            o.put("bytes", out.length());
            return o.toString();
        } catch (Throwable t) {
            return editErrorJson("Photo edit failed: " + friendly(t));
        } finally {
            recycle(source);
        }
    }

    private static boolean isPng(String path) {
        if (path == null) return false;
        String s = path.trim().toLowerCase(Locale.US);
        int q = s.indexOf('?');
        if (q > 0) s = s.substring(0, q);
        return s.endsWith(".png");
    }

    private File pictureDir() throws IOException {
        File base = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (base == null) base = new File(activity.getFilesDir(), "Pictures");
        File dir = new File(base, "Jarvis");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create picture folder");
        return dir;
    }

    private File movieDir() throws IOException {
        File base = activity.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (base == null) base = new File(activity.getFilesDir(), "Movies");
        File dir = new File(base, "Jarvis");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create movie folder");
        return dir;
    }

    private static int sampleSize(int w, int h) {
        int s = 1;
        while (((long) w * h) / ((long) s * s) > MAX_IMAGE_PIXELS) s *= 2;
        while (Math.max(w, h) / s > MAX_IMAGE_DIMENSION) s *= 2;
        return Math.max(1, s);
    }

    private static Bitmap loadBitmap(Context ctx, String path, int maxPixels) throws Exception {
        if (path == null || path.trim().isEmpty()) throw new IOException("No image path");
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        InputStream is = null;
        try {
            is = openSource(ctx, path);
            BitmapFactory.decodeStream(is, null, bounds);
        } finally {
            close(is);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new IOException("Not a readable image");
        }
        int s = sampleSize(bounds.outWidth, bounds.outHeight);
        while (((long) bounds.outWidth * bounds.outHeight) / ((long) s * s) > maxPixels) s *= 2;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = s;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        is = null;
        Bitmap decoded;
        try {
            is = openSource(ctx, path);
            decoded = BitmapFactory.decodeStream(is, null, opts);
        } finally {
            close(is);
        }
        if (decoded == null) throw new IOException("Image decode failed");
        Bitmap fixed = correctOrientation(decoded, readExifOrientation(ctx, path));
        if (fixed != decoded) decoded.recycle();
        return fixed;
    }

    private static int readExifOrientation(Context ctx, String path) {
        InputStream is = null;
        try {
            if (path != null && path.trim().startsWith("content://")) {
                is = ctx.getContentResolver().openInputStream(Uri.parse(path.trim()));
                if (is == null) return ExifInterface.ORIENTATION_NORMAL;
                ExifInterface exif = new ExifInterface(is);
                return exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL);
            }
            String p = path == null ? "" : path.trim();
            if (p.startsWith("file://")) p = Uri.parse(p).getPath();
            ExifInterface exif = new ExifInterface(p);
            return exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL);
        } catch (Throwable ignored) {
            return ExifInterface.ORIENTATION_NORMAL;
        } finally {
            close(is);
        }
    }

    private static Bitmap correctOrientation(Bitmap src, int orientation) {
        Matrix m = new Matrix();
        float cx = src.getWidth() / 2f;
        float cy = src.getHeight() / 2f;
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90:
                m.setRotate(90, cx, cy);
                break;
            case ExifInterface.ORIENTATION_ROTATE_180:
                m.setRotate(180, cx, cy);
                break;
            case ExifInterface.ORIENTATION_ROTATE_270:
                m.setRotate(270, cx, cy);
                break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                m.setScale(-1, 1, cx, cy);
                break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                m.setScale(1, -1, cx, cy);
                break;
            case ExifInterface.ORIENTATION_TRANSPOSE:
                m.setRotate(90, cx, cy);
                m.postScale(-1, 1, cx, cy);
                break;
            case ExifInterface.ORIENTATION_TRANSVERSE:
                m.setRotate(270, cx, cy);
                m.postScale(-1, 1, cx, cy);
                break;
            default:
                return src;
        }
        return Bitmap.createBitmap(src, 0, 0, src.getWidth(), src.getHeight(), m, true);
    }

    private static Bitmap copyBitmap(Bitmap src) {
        Bitmap.Config cfg = src.getConfig() == null ? Bitmap.Config.ARGB_8888 : src.getConfig();
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), cfg);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        c.drawBitmap(src, 0, 0, p);
        return out;
    }

    private static Bitmap applyAction(Bitmap src, String action, JSONObject opt) throws Exception {
        int w = src.getWidth();
        int h = src.getHeight();

        if ("resize".equals(action)) {
            int tw = opt.optInt("width", 0);
            int th = opt.optInt("height", 0);
            if (tw <= 0 && th <= 0) throw new IOException("Give width and/or height");
            if (tw > 0 && th <= 0) th = Math.max(1, Math.round(h * (tw / (float) w)));
            if (th > 0 && tw <= 0) tw = Math.max(1, Math.round(w * (th / (float) h)));
            tw = clamp(tw, 1, MAX_EDIT_DIMENSION);
            th = clamp(th, 1, MAX_EDIT_DIMENSION);
            return tw == w && th == h ? copyBitmap(src) : Bitmap.createScaledBitmap(src, tw, th, true);
        }

        if ("crop".equals(action)) {
            int x = clamp(opt.optInt("x", 0), 0, Math.max(0, w - 1));
            int y = clamp(opt.optInt("y", 0), 0, Math.max(0, h - 1));
            int cw = clamp(opt.optInt("crop_width", 0), 0, w - x);
            int ch = clamp(opt.optInt("crop_height", 0), 0, h - y);
            if (cw <= 0 || ch <= 0) throw new IOException("Give crop_width and crop_height");
            return Bitmap.createBitmap(src, x, y, cw, ch);
        }

        if ("rotate".equals(action)) {
            double d = opt.optDouble("degrees", 90);
            if (Double.isNaN(d) || Double.isInfinite(d)) d = 90;
            Matrix m = new Matrix();
            m.setRotate((float) d, w / 2f, h / 2f);
            return Bitmap.createBitmap(src, 0, 0, w, h, m, true);
        }

        if ("flip".equals(action)) {
            String f = opt.optString("flip", "horizontal").trim().toLowerCase(Locale.US);
            boolean fh = f.equals("h") || f.equals("x") || f.equals("horizontal")
                    || f.equals("left") || f.equals("right");
            boolean fv = f.equals("v") || f.equals("y") || f.equals("vertical")
                    || f.equals("up") || f.equals("down");
            if (!fh && !fv) fh = true;
            Matrix m = new Matrix();
            if (fh && fv) {
                m.setScale(-1, -1, w / 2f, h / 2f);
            } else if (fh) {
                m.setScale(-1, 1, w / 2f, h / 2f);
            } else {
                m.setScale(1, -1, w / 2f, h / 2f);
            }
            return Bitmap.createBitmap(src, 0, 0, w, h, m, true);
        }

        if ("grayscale".equals(action) || "sepia".equals(action)) {
            Bitmap out = copyBitmap(src);
            Canvas c = new Canvas(out);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            ColorMatrix cm = new ColorMatrix();
            if ("grayscale".equals(action)) {
                cm.setSaturation(0f);
            } else {
                cm.set(new float[]{
                        0.393f, 0.769f, 0.189f, 0f, 0f,
                        0.349f, 0.686f, 0.168f, 0f, 0f,
                        0.272f, 0.534f, 0.131f, 0f, 0f,
                        0f, 0f, 0f, 1f, 0f,
                        0f, 0f, 0f, 0f, 1f
                });
            }
            p.setColorFilter(new ColorMatrixColorFilter(cm));
            c.drawBitmap(src, 0, 0, p);
            return out;
        }

        if ("blur".equals(action)) {
            int radius = clamp(opt.optInt("blur", 4), 1, 24);
            int factor = Math.max(2, Math.min(12, radius));
            int sw = Math.max(1, w / factor);
            int sh = Math.max(1, h / factor);
            Bitmap small = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888);
            Canvas c1 = new Canvas(small);
            Paint p1 = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            c1.drawBitmap(src, new Rect(0, 0, w, h), new Rect(0, 0, sw, sh), p1);
            Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c2 = new Canvas(out);
            Paint p2 = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            c2.drawBitmap(small, new Rect(0, 0, sw, sh), new Rect(0, 0, w, h), p2);
            small.recycle();
            return out;
        }

        if ("text".equals(action)) {
            String text = opt.optString("text", "");
            if (text.trim().isEmpty()) throw new IOException("Give text to draw");
            Bitmap out = copyBitmap(src);
            Canvas c = new Canvas(out);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setStyle(Paint.Style.FILL);
            p.setColor(Color.WHITE);
            float size = Math.max(14f, Math.min(Math.min(w, h) / 9f, 160f));
            p.setTextSize(size);
            p.setShadowLayer(Math.max(1f, size / 8f), 1f, 1f, Color.BLACK);
            float pad = Math.max(4f, size * 0.5f);
            c.drawText(text, pad, h - pad, p);
            return out;
        }

        throw new IOException("Unsupported action: " + action);
    }

    private static File saveBitmap(Bitmap bmp, File dir, String name, boolean png) throws IOException {
        File out = new File(dir, name);
        if (out.exists() && !out.delete()) throw new IOException("Cannot replace output file");
        OutputStream os = null;
        boolean ok;
        try {
            os = new FileOutputStream(out);
            ok = bmp.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG,
                    png ? 100 : 92, os);
            os.flush();
        } finally {
            close(os);
        }
        if (!ok || !out.isFile() || out.length() <= 0) {
            try { out.delete(); } catch (Exception ignored) { }
            throw new IOException("Image could not be saved");
        }
        return out;
    }

    // ---------------------------------------------------------- 3) video trim

    /** Real stream-copy trim. Runs off the main thread; reports via jarvisMediaDone. */
    public void trimVideo(final String path, final double startSec, final double endSec,
                          final String requestId) {
        final String id = requestId == null ? "" : requestId;
        new Thread(() -> {
            JSONObject result = null;
            try {
                result = trimInternal(path, startSec, endSec);
            } catch (Throwable t) {
                result = baseError("Video trim failed: " + friendly(t));
                try {
                    result.put("output", "");
                    result.put("bytes", 0);
                    result.put("duration", 0);
                } catch (Exception ignored) { }
            }
            final String json = result.toString();
            fireJs("window.jarvisMediaDone(" + q(id) + "," + q(json) + ")");
        }, "jarvis-video-trim").start();
    }

    private JSONObject trimInternal(String path, double startSec, double endSec) throws Exception {
        if (path == null || path.trim().isEmpty()) throw new IOException("No video path");
        if (Double.isNaN(startSec) || Double.isNaN(endSec)
                || Double.isInfinite(startSec) || Double.isInfinite(endSec)) {
            throw new IOException("Invalid time range");
        }
        if (startSec < 0 || endSec <= startSec) throw new IOException("Start must be before end");

        long startUs = (long) Math.floor(startSec * 1_000_000.0);
        long endUs = (long) Math.ceil(endSec * 1_000_000.0);
        if (endUs <= startUs) throw new IOException("Time range is too short");

        MediaExtractor ex = new MediaExtractor();
        File out = null;
        boolean done = false;
        try {
            String src = path.trim();
            if (src.startsWith("content://")) {
                ex.setDataSource(activity, Uri.parse(src), null);
            } else {
                if (src.startsWith("file://")) src = Uri.parse(src).getPath();
                ex.setDataSource(src);
            }

            int video = -1;
            int audio = -1;
            long durationUs = 0;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime == null) continue;
                if (video < 0 && mime.startsWith("video/")) {
                    video = i;
                    durationUs = Math.max(durationUs, safeDuration(f));
                } else if (audio < 0 && mime.startsWith("audio/")) {
                    audio = i;
                    durationUs = Math.max(durationUs, safeDuration(f));
                }
            }
            if (video < 0 && audio < 0) throw new IOException("No video or audio track found");
            if (durationUs > 0 && endUs > durationUs + TRIM_TOLERANCE_US) {
                throw new IOException("End time is past the end of the video");
            }
            if (durationUs > 0 && startUs >= durationUs) {
                throw new IOException("Start time is past the end of the video");
            }

            long requestedUs = endUs - startUs;
            if (video >= 0) ex.selectTrack(video);
            if (audio >= 0) ex.selectTrack(audio);

            out = new File(movieDir(), safeName("jarvis_trim", "trim") + "_" + stamp() + ".mp4");
            long lastUs = 0;
            MediaMuxer muxer = new MediaMuxer(out.getAbsolutePath(),
                    MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            try {
                SparseIntArray trackMap = new SparseIntArray();
                if (video >= 0) {
                    MediaFormat f = ex.getTrackFormat(video);
                    f.setLong(MediaFormat.KEY_DURATION, requestedUs);
                    trackMap.put(video, muxer.addTrack(f));
                }
                if (audio >= 0) {
                    MediaFormat f = ex.getTrackFormat(audio);
                    f.setLong(MediaFormat.KEY_DURATION, requestedUs);
                    trackMap.put(audio, muxer.addTrack(f));
                }

                muxer.start();
                ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
                long baseUs = ex.getSampleTime();
                if (baseUs < 0) baseUs = startUs;

                ByteBuffer buf = ByteBuffer.allocateDirect(MAX_SAMPLE_BUFFER);
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                boolean wrote = false;
                while (true) {
                    int track = ex.getSampleTrackIndex();
                    if (track < 0) break;
                    int size = ex.readSampleData(buf, 0);
                    long pts = ex.getSampleTime();
                    int flags = ex.getSampleFlags();
                    if (size < 0 || pts < 0) {
                        if (!ex.advance()) break;
                        continue;
                    }
                    if (pts > endUs) break;
                    long adjusted = Math.max(0L, pts - baseUs);
                    info.set(0, size, adjusted, flags);
                    muxer.writeSampleData(trackMap.get(track), buf, info);
                    wrote = true;
                    lastUs = Math.max(lastUs, adjusted);
                    buf.clear();
                    if (!ex.advance()) break;
                }
                muxer.stop();
                if (!wrote) throw new IOException("No samples in the selected range");
            } finally {
                try { muxer.release(); } catch (Throwable ignored) { }
            }

            if (!out.isFile() || out.length() <= 0) {
                throw new IOException("Trimmed video was not written");
            }
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("message", "Video trimmed");
            o.put("output", out.getAbsolutePath());
            o.put("bytes", out.length());
            o.put("duration", lastUs > 0 ? (lastUs / 1_000_000.0) : (requestedUs / 1_000_000.0));
            done = true;
            return o;
        } finally {
            try { ex.release(); } catch (Throwable ignored) { }
            if (!done && out != null) { try { out.delete(); } catch (Exception ignored) { } }
        }
    }

    private static long safeDuration(MediaFormat f) {
        try {
            return f.containsKey(MediaFormat.KEY_DURATION) ? f.getLong(MediaFormat.KEY_DURATION) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    // ------------------------------------------------------------ 4) open media

    /** Opens a content URI or publishes a local file to MediaStore first. */
    public String openMedia(String pathOrUri, String kind) {
        final JSONObject o = new JSONObject();
        final String src = pathOrUri == null ? "" : pathOrUri.trim();
        final String k = kind == null ? "" : kind.trim().toLowerCase(Locale.US);
        final boolean edit = k.contains("edit");
        if (src.isEmpty()) return baseError("No file or URI given").toString();

        final boolean[] ok = new boolean[1];
        final String[] message = new String[]{"Media could not be opened"};
        runOnMainSync(() -> {
            try {
                Uri uri;
                String mime;
                boolean content = src.startsWith("content://");
                if (content) {
                    uri = Uri.parse(src);
                    mime = safeMime(activity.getContentResolver().getType(uri));
                    if (mime.isEmpty()) mime = mimeForType(k, src);
                } else {
                    String path = src.startsWith("file://") ? Uri.parse(src).getPath() : src;
                    if (path == null || path.isEmpty()) throw new IOException("Invalid path");
                    File f = new File(path);
                    if (!f.isFile()) throw new IOException("File not found");
                    mime = mimeForType(k, path);
                    uri = publishToMediaStore(f, mime);
                }

                Intent i = new Intent(edit ? Intent.ACTION_EDIT : Intent.ACTION_VIEW);
                i.setData(uri);
                if (!mime.isEmpty()) i.setType(mime);
                int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK;
                if (edit) flags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                i.addFlags(flags);

                ResolveInfo ri = activity.getPackageManager().resolveActivity(i, 0);
                if (ri == null || ri.activityInfo == null) {
                    throw new IOException("No app on this phone can open this media");
                }
                ActivityInfo ai = ri.activityInfo;
                try {
                    activity.grantUriPermission(ai.packageName, uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                                    | (edit ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0));
                } catch (Throwable ignored) { }
                activity.startActivity(i);
                ok[0] = true;
                message[0] = edit ? "Editor opened" : "Media opened";
            } catch (Throwable t) {
                ok[0] = false;
                message[0] = friendly(t);
            }
        });
        try {
            o.put("ok", ok[0]);
            o.put("message", message[0]);
        } catch (Exception ignored) { }
        return o.toString();
    }

    private static String mimeForType(String kind, String pathOrUri) {
        String k = kind == null ? "" : kind.toLowerCase(Locale.US);
        if (k.contains("video") || k.contains("movie")) return "video/mp4";
        if (k.contains("image") || k.contains("photo") || k.contains("picture")) {
            return isPng(pathOrUri) ? "image/png" : "image/jpeg";
        }
        String s = pathOrUri == null ? "" : pathOrUri.toLowerCase(Locale.US);
        int q = s.indexOf('?');
        if (q > 0) s = s.substring(0, q);
        if (s.endsWith(".png")) return "image/png";
        if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
        if (s.endsWith(".webp")) return "image/webp";
        if (s.endsWith(".mp4")) return "video/mp4";
        if (s.endsWith(".3gp")) return "video/3gpp";
        return "";
    }

    private Uri publishToMediaStore(File file, String mime) throws Exception {
        ContentResolver cr = activity.getContentResolver();
        String name = safeName(file.getName(), "media");
        if (mime == null || mime.isEmpty()) mime = mimeForType("", file.getName());
        boolean video = mime.startsWith("video/");
        boolean image = mime.startsWith("image/");
        if (!video && !image) throw new IOException("Unsupported media type");

        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Jarvis");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri base = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            Uri uri = cr.insert(base, values);
            if (uri == null) throw new IOException("MediaStore insert failed");
            ParcelFileDescriptor pfd = null;
            try {
                pfd = cr.openFileDescriptor(uri, "w");
                if (pfd == null) throw new IOException("Cannot open MediaStore file");
                InputStream in = null;
                OutputStream os = null;
                byte[] buf = new byte[16 * 1024];
                try {
                    in = new FileInputStream(file);
                    os = new FileOutputStream(pfd.getFileDescriptor());
                    int n;
                    while ((n = in.read(buf)) != -1) os.write(buf, 0, n);
                    os.flush();
                } finally {
                    close(in);
                    if (os != null) { try { os.flush(); } catch (Exception ignored) { } }
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, done, null, null);
            } catch (Exception e) {
                try { cr.delete(uri, null, null); } catch (Throwable ignored) { }
                throw new IOException("Could not index media: " + friendly(e), e);
            } finally {
                if (pfd != null) { try { pfd.close(); } catch (Exception ignored) { } }
            }
            return uri;
        }

        if (image) {
            String inserted = MediaStore.Images.Media.insertImage(
                    cr, file.getAbsolutePath(), name, null);
            if (inserted == null) throw new IOException("Could not add image to MediaStore");
            return Uri.parse(inserted);
        }
        ContentValues legacy = new ContentValues();
        legacy.put(MediaStore.Video.Media.DATA, file.getAbsolutePath());
        legacy.put(MediaStore.Video.Media.MIME_TYPE, mime);
        legacy.put(MediaStore.Video.Media.TITLE, name);
        Uri uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, legacy);
        if (uri == null) throw new IOException("Could not add video to MediaStore");
        return uri;
    }

    // ------------------------------------------------------------ 5) self test

    /** Synthetic QA check only: never reads or writes user media. */
    public String mediaSelfTest() {
        Bitmap source = null;
        Bitmap resized = null;
        Bitmap gray = null;
        try {
            File dir = new File(activity.getCacheDir(), "jarvis_selftest");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create test folder");

            File srcFile = new File(dir, "source.png");
            source = Bitmap.createBitmap(128, 96, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(source);
            c.drawColor(Color.rgb(200, 100, 50));
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setColor(Color.rgb(30, 180, 90));
            c.drawRect(new Rect(10, 10, 80, 60), p);
            File savedSource = saveBitmap(source, dir, "source.png", true);

            Bitmap decoded = loadBitmap(activity, savedSource.getAbsolutePath(), MAX_IMAGE_PIXELS);
            if (decoded != source) {
                recycle(source);
                source = decoded;
            }
            resized = applyAction(source, "resize",
                    new JSONObject().put("width", 64).put("height", 48));
            File resizedFile = saveBitmap(resized, dir, "resized_64x48.png", true);
            gray = applyAction(resized, "grayscale", new JSONObject());
            File grayFile = saveBitmap(gray, dir, "grayscale_64x48.png", true);

            if (resized.getWidth() != 64 || resized.getHeight() != 48
                    || !resizedFile.isFile() || !grayFile.isFile()
                    || resizedFile.length() <= 0 || grayFile.length() <= 0
                    || !savedSource.isFile() || savedSource.length() <= 0) {
                throw new IOException("Self-test output check failed");
            }
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("message", "Media self-test passed");
            o.put("source", savedSource.getAbsolutePath());
            o.put("source_size", savedSource.length());
            o.put("resized", resizedFile.getAbsolutePath());
            o.put("resized_size", resizedFile.length());
            o.put("grayscale", grayFile.getAbsolutePath());
            o.put("grayscale_size", grayFile.length());
            o.put("width", resized.getWidth());
            o.put("height", resized.getHeight());
            return o.toString();
        } catch (Throwable t) {
            return editErrorJson("Media self-test failed: " + friendly(t));
        } finally {
            recycle(gray);
            recycle(resized);
            recycle(source);
        }
    }
}
