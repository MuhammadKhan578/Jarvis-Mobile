package com.jarvis.mobile;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.UUID;

/**
 * REAL direct link from this phone to PC Jarvis over the local Wi-Fi.
 *
 * No fake upload, no fake save, no phone number: every operation is an HTTP
 * request to the PC and reports the PC's own response. Plain HTTP is accepted
 * ONLY for private LAN literals (or a .local mDNS name).
 *
 * All network work happens on a background thread supplied by JsBridge; these
 * methods themselves must never be called on the UI/WebView thread.
 */
public final class DeviceLink {

    /** Same private preferences file used by JsBridge and AppIntents. */
    private static final String PREFS = "jarvis_mobile";
    private static final String KEY_HOST = "pc_link_host";
    private static final String KEY_PORT = "pc_link_port";
    private static final String KEY_TOKEN = "pc_link_token";
    private static final String KEY_LAST_RESULT = "pc_link_last_result";
    private static final String KEY_LAST_TS = "pc_link_last_ts";
    private static final String KEY_LAST_FILE_ID = "pc_link_last_file_id";
    private static final String KEY_LAST_DEST = "pc_link_last_destination";
    private static final String KEY_LAST_NAME = "pc_link_last_name";
    private static final String KEY_LAST_SIZE = "pc_link_last_size";

    private static final int CONNECT_TIMEOUT_MS = 6000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final long RECENT_MS = 60000L;

    private DeviceLink() { }

    // ------------------------------------------------------------- small JSON

    private static String json(boolean ok, String message, boolean needsUser) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("message", message == null ? "" : message);
            o.put("needs_user_action", needsUser);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"needs_user_action\":false,\"message\":\"Result error\"}";
        }
    }

    private static JSONObject need(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("needs_user_action", true);
            o.put("message", message);
        } catch (Exception ignored) { }
        return o;
    }

    private static JSONObject remember(Context ctx, JSONObject result) {
        try {
            SharedPreferences p = prefs(ctx);
            p.edit()
                    .putString(KEY_LAST_RESULT, result.toString())
                    .putLong(KEY_LAST_TS, System.currentTimeMillis())
                    .apply();
        } catch (Exception ignored) { }
        return result;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String friendly(Throwable t) {
        String s = t == null ? "unknown" : String.valueOf(t.getMessage());
        if (s.isEmpty() && t != null) s = t.getClass().getSimpleName();
        return s.length() > 220 ? s.substring(0, 220) : s;
    }

    private static JSONObject parseOrError(String body) {
        try {
            JSONObject o = new JSONObject(body == null ? "" : body.trim());
            return o;
        } catch (Exception e) {
            JSONObject o = new JSONObject();
            try {
                o.put("ok", false);
                o.put("message", "PC ne valid JSON nahi diya: " + clip(body));
            } catch (Exception ignored) { }
            return o;
        }
    }

    private static String clip(String s) {
        String v = s == null ? "" : s.trim();
        return v.length() > 200 ? v.substring(0, 200) : v;
    }

    // ------------------------------------------------------------ host safety

    /** Only a private LAN literal or a .local name may be used with plain HTTP. */
    private static boolean isPrivateHost(String host) {
        if (host == null) return false;
        String h = host.trim().toLowerCase(Locale.US);
        if (h.startsWith("[") && h.endsWith("]")) h = h.substring(1, h.length() - 1);
        if (h.equals("localhost") || h.equals("::1")) return true;
        if (h.endsWith(".local")) {
            String label = h.substring(0, h.length() - 6);
            return !label.isEmpty() && !label.contains(".") && !label.contains("/");
        }
        String[] p = h.split("\\.");
        if (p.length != 4) return false;
        int[] a = new int[4];
        for (int i = 0; i < 4; i++) {
            if (p[i].isEmpty() || p[i].length() > 3) return false;
            for (int j = 0; j < p[i].length(); j++) {
                char c = p[i].charAt(j);
                if (c < '0' || c > '9') return false;
            }
            a[i] = Integer.parseInt(p[i]);
            if (a[i] > 255) return false;
        }
        if (a[0] == 10 || a[0] == 127) return true;
        if (a[0] == 192 && a[1] == 168) return true;
        if (a[0] == 172 && a[1] >= 16 && a[1] <= 31) return true;
        return a[0] == 169 && a[1] == 254;
    }

    /** Accepts "192.168.1.5", "http://192.168.1.5/" and strips any path. */
    private static String normalizeHost(String host) {
        String h = host == null ? "" : host.trim();
        if (h.contains("://")) h = h.substring(h.indexOf("://") + 3);
        int slash = h.indexOf('/');
        if (slash >= 0) h = h.substring(0, slash);
        int colon = h.indexOf(':');
        if (colon > 0 && h.indexOf(':') == h.lastIndexOf(':') && !h.startsWith("[")) {
            h = h.substring(0, colon); // a Roman-Urdu "IP:port" entry
        }
        return h.trim().toLowerCase(Locale.US);
    }

    private static boolean paired(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return !p.getString(KEY_HOST, "").isEmpty()
                && p.getInt(KEY_PORT, 0) > 0
                && !p.getString(KEY_TOKEN, "").isEmpty();
    }

    private static JSONObject notPaired() {
        return need("PC se connect karo: IP, port aur code daalo");
    }

    private static HttpURLConnection open(Context ctx, String path) throws Exception {
        SharedPreferences p = prefs(ctx);
        String host = p.getString(KEY_HOST, "");
        int port = p.getInt(KEY_PORT, 0);
        if (!isPrivateHost(host) || port < 1 || port > 65535) {
            throw new IOException("Host private LAN IP ya .local nahi hai");
        }
        URL url = new URL("http://" + host + ":" + port + path);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(CONNECT_TIMEOUT_MS);
        c.setReadTimeout(READ_TIMEOUT_MS);
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        c.setDoOutput(true);
        return c;
    }

    private static String readAll(InputStream is) throws IOException {
        if (is == null) return "";
        StringBuilder sb = new StringBuilder();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) != -1) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
        return sb.toString();
    }

    private static void writeString(HttpURLConnection c, String body) throws IOException {
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        c.setFixedLengthStreamingMode(data.length);
        try (OutputStream os = new BufferedOutputStream(c.getOutputStream(), 16384)) {
            os.write(data);
        }
    }

    // ---------------------------------------------------------------- pairing

    /** POST {"code":...} to /link/pair and save the REAL token on 2xx + token. */
    public static String connect(Context ctx, String hostText, int port, String code) {
        if (ctx == null) return json(false, "PC link context available nahi hai.", false);
        String host = normalizeHost(hostText);
        String c = code == null ? "" : code.trim();
        if (host.isEmpty() || port < 1 || port > 65535 || c.isEmpty()) {
            return remember(ctx, notPaired()).toString();
        }
        if (!isPrivateHost(host)) {
            return remember(ctx, need("Plain HTTP sirf private LAN IP (192.168.x.x, 10.x.x.x, 172.16-31.x.x) ya .local host ke liye allowed hai.")).toString();
        }
        HttpURLConnection conn = null;
        try {
            JSONObject req = new JSONObject().put("code", c);
            conn = openForHost(host, port, "/link/pair");
            writeString(conn, req.toString());
            int http = conn.getResponseCode();
            InputStream stream = http >= 400 ? conn.getErrorStream() : conn.getInputStream();
            JSONObject server = parseOrError(readAll(stream));
            String token = extractToken(server);
            boolean serverOk = server.has("ok") ? server.optBoolean("ok", false) : !token.isEmpty();
            if (http < 200 || http >= 300 || !serverOk || token.isEmpty()) {
                JSONObject out = need("Pair nahi hua (HTTP " + http + "): " + server.optString("message", clip(server.toString())));
                out.put("http_code", http);
                out.put("host", host);
                out.put("port", port);
                return remember(ctx, out).toString();
            }
            prefs(ctx).edit()
                    .putString(KEY_HOST, host)
                    .putInt(KEY_PORT, port)
                    .putString(KEY_TOKEN, token)
                    .apply();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("needs_user_action", false);
            out.put("message", server.optString("message", "PC Jarvis se pair ho gaya, sir."));
            out.put("host", host);
            out.put("port", port);
            out.put("paired", true);
            return remember(ctx, out).toString();
        } catch (Exception e) {
            return remember(ctx, need("PC se connect nahi ho saka: " + friendly(e))).toString();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Pairing is the one request made before a token exists. */
    private static HttpURLConnection openForHost(String host, int port, String path) throws Exception {
        if (!isPrivateHost(host) || port < 1 || port > 65535) {
            throw new IOException("Host private LAN IP ya .local nahi hai");
        }
        URL url = new URL("http://" + host + ":" + port + path);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(CONNECT_TIMEOUT_MS);
        c.setReadTimeout(READ_TIMEOUT_MS);
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        c.setDoOutput(true);
        return c;
    }

    private static String extractToken(JSONObject server) {
        if (server == null) return "";
        String token = server.optString("token", "");
        if (token.isEmpty()) token = server.optString("access_token", "");
        if (token.isEmpty()) {
            JSONObject data = server.optJSONObject("data");
            if (data != null) token = data.optString("token", data.optString("access_token", ""));
        }
        return token.trim();
    }

    /** LOCAL state only. Never invents a server status. */
    public static String status(Context ctx) {
        if (ctx == null) return json(false, "PC link context available nahi hai.", false);
        try {
            SharedPreferences p = prefs(ctx);
            boolean isPaired = paired(ctx);
            String host = p.getString(KEY_HOST, "");
            int port = p.getInt(KEY_PORT, 0);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("needs_user_action", !isPaired);
            o.put("paired", isPaired);
            o.put("host", host);
            o.put("port", port);
            o.put("has_token", isPaired);
            o.put("server_status", "unknown");
            String last = p.getString(KEY_LAST_RESULT, "");
            long ts = p.getLong(KEY_LAST_TS, 0L);
            if (!last.isEmpty()) {
                try { o.put("last_result", new JSONObject(last)); }
                catch (Exception e) { o.put("last_result", clip(last)); }
            }
            if (ts > 0L) {
                long age = Math.max(0L, System.currentTimeMillis() - ts);
                o.put("last_checked_at", ts);
                o.put("last_checked_age_ms", age);
                if (age <= RECENT_MS) o.put("server_status", "checked_recently");
            }
            o.put("message", isPaired
                    ? "PC " + host + ":" + port + " se paired hai. Server status unknown hai; Status dabaiye."
                    : "Abhi PC se paired nahi hai. PC se connect karo: IP, port aur code daalo.");
            return o.toString();
        } catch (Exception e) {
            return json(false, "Status nahi mila: " + friendly(e), false);
        }
    }

    /** Clears the stored token; host/port remain as a convenience. */
    public static String disconnect(Context ctx) {
        if (ctx == null) return json(false, "PC link context available nahi hai.", false);
        try {
            prefs(ctx).edit().remove(KEY_TOKEN).apply();
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("needs_user_action", false);
            o.put("paired", false);
            o.put("message", "PC link disconnect kar diya. Token phone se hata diya gaya.");
            return remember(ctx, o).toString();
        } catch (Exception e) {
            return json(false, "Disconnect fail: " + friendly(e), false);
        }
    }

    // ------------------------------------------------------------------ files

    private static String displayName(ContentResolver cr, Uri uri) {
        Cursor c = null;
        try {
            c = cr.query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception ignored) { } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) { } }
        }
        String last = uri.getLastPathSegment();
        return last == null ? "" : last;
    }

    private static long querySize(ContentResolver cr, Uri uri) {
        Cursor c = null;
        try {
            c = cr.query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0) return Math.max(0L, c.getLong(i));
            }
        } catch (Exception ignored) { } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) { } }
        }
        return 0L;
    }

    private static String safeName(String name) {
        String n = name == null ? "" : name;
        n = n.replace('\\', '_').replace('/', '_').replace('"', '_')
                .replace('\r', '_').replace('\n', '_').trim();
        if (n.isEmpty()) n = "file.bin";
        return n.length() > 180 ? n.substring(n.length() - 180) : n;
    }

    /**
     * Streams a REAL multipart upload to /link/upload. Success is claimed only
     * for HTTP 2xx AND the PC's JSON ok == true.
     */
    public static String sendFile(Context ctx, String uriOrPath) {
        if (ctx == null) return json(false, "PC link context available nahi hai.", false);
        if (!paired(ctx)) return remember(ctx, notPaired()).toString();
        String src = uriOrPath == null ? "" : uriOrPath.trim();
        if (src.isEmpty()) {
            return remember(ctx, need("File chuno: 'ye file PC par bhejo' bolein ya path do.")).toString();
        }
        InputStream in = null;
        File spool = null;
        HttpURLConnection conn = null;
        try {
            String name;
            long size;
            if (src.startsWith("content://")) {
                Uri uri = Uri.parse(src);
                ContentResolver cr = ctx.getContentResolver();
                name = safeName(displayName(cr, uri)); // real display name
                size = querySize(cr, uri);
                in = cr.openInputStream(uri);
                if (in == null) throw new IOException("Content khol nahi gaya");
                if (size <= 0L) {
                    // Unknown length: spool once so the upload can use a fixed
                    // Content-Length (many simple PC servers reject chunked POST).
                    spool = File.createTempFile("jarvis_pc_send_", ".bin", ctx.getCacheDir());
                    try (OutputStream os = new FileOutputStream(spool)) {
                        size = copy(in, os);
                    }
                    in.close();
                    in = new BufferedInputStream(new FileInputStream(spool));
                }
            } else {
                String path = src.startsWith("file://") ? String.valueOf(Uri.parse(src).getPath()) : src;
                File f = new File(path);
                if (!f.isFile()) throw new IOException("File nahi mila: " + path);
                name = safeName(f.getName());
                size = f.length();
                in = new BufferedInputStream(new FileInputStream(f));
            }
            if (size <= 0L) throw new IOException("File khali hai");

            String boundary = "----JarvisLink" + UUID.randomUUID().toString().replace("-", "");
            String head = "--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"filename\"\r\n\r\n"
                    + name + "\r\n"
                    + "--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"" + name + "\"\r\n"
                    + "Content-Type: application/octet-stream\r\n\r\n";
            String tail = "\r\n--" + boundary + "--\r\n";
            byte[] headBytes = head.getBytes(StandardCharsets.UTF_8);
            byte[] tailBytes = tail.getBytes(StandardCharsets.UTF_8);

            conn = open(ctx, "/link/upload");
            conn.setRequestProperty("X-Jarvis-Token", prefs(ctx).getString(KEY_TOKEN, ""));
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            conn.setFixedLengthStreamingMode(headBytes.length + size + tailBytes.length);
            try (OutputStream os = new BufferedOutputStream(conn.getOutputStream(), 32768)) {
                os.write(headBytes);
                copy(in, os);
                os.write(tailBytes);
                os.flush();
            }
            int http = conn.getResponseCode();
            InputStream stream = http >= 400 ? conn.getErrorStream() : conn.getInputStream();
            JSONObject server = parseOrError(readAll(stream));
            boolean ok = http >= 200 && http < 300 && server.optBoolean("ok", false);

            JSONObject out = copyServer(server);
            out.put("http_code", http);
            out.put("ok", ok);
            out.put("needs_user_action", ok ? false : true);
            JSONObject data = server.optJSONObject("data");
            String id = server.optString("id", server.optString("file_id", ""));
            if (id.isEmpty() && data != null) id = data.optString("id", data.optString("file_id", ""));
            out.put("id", id);
            out.put("name", server.optString("name", data != null ? data.optString("name", name) : name));
            out.put("size", server.optLong("size", data != null ? data.optLong("size", size) : size));
            out.put("message", server.optString("message", ok
                    ? "File PC par bhej diya, sir. Ab kahan save karna hai?"
                    : "PC ne upload reject kiya (HTTP " + http + ")."));
            if (ok) {
                SharedPreferences p = prefs(ctx);
                p.edit().putString(KEY_LAST_FILE_ID, id)
                        .putString(KEY_LAST_NAME, out.optString("name", name))
                        .putLong(KEY_LAST_SIZE, out.optLong("size", size)).apply();
            }
            return remember(ctx, out).toString();
        } catch (Exception e) {
            JSONObject out = need("Upload fail hua: " + friendly(e));
            return remember(ctx, out).toString();
        } finally {
            if (in != null) { try { in.close(); } catch (Exception ignored) { } }
            if (conn != null) conn.disconnect();
            if (spool != null) { try { spool.delete(); } catch (Exception ignored) { } }
        }
    }

    private static long copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[32768];
        long total = 0L;
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            total += n;
        }
        out.flush();
        return total;
    }

    private static JSONObject copyServer(JSONObject server) {
        JSONObject out = new JSONObject();
        if (server == null) return out;
        Iterator<String> keys = server.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            try { out.put(k, server.get(k)); } catch (Exception ignored) { }
        }
        return out;
    }

    /** POST JSON to the PC; returns the PC's real response fields. */
    private static String postJson(Context ctx, String path, JSONObject req) {
        if (!paired(ctx)) return remember(ctx, notPaired()).toString();
        HttpURLConnection conn = null;
        try {
            conn = open(ctx, path);
            conn.setRequestProperty("X-Jarvis-Token", prefs(ctx).getString(KEY_TOKEN, ""));
            writeString(conn, req.toString());
            int http = conn.getResponseCode();
            InputStream stream = http >= 400 ? conn.getErrorStream() : conn.getInputStream();
            JSONObject server = parseOrError(readAll(stream));
            boolean hasReply = server.has("reply") || server.has("message") || server.has("response");
            boolean serverOk = server.has("ok") ? server.optBoolean("ok", false) : hasReply;
            boolean ok = http >= 200 && http < 300 && serverOk;
            String message = server.optString("message", server.optString("reply", ""));
            if (message.isEmpty()) message = server.optString("response", "");
            if (message.isEmpty()) message = ok ? "PC Jarvis ne jawab diya." : "PC ne jawab nahi diya (HTTP " + http + ").";
            JSONObject out = copyServer(server);
            out.put("http_code", http);
            out.put("ok", ok);
            out.put("needs_user_action", !ok || server.optBoolean("needs_user_action", false));
            out.put("message", message);
            if (server.has("reply")) out.put("reply", server.optString("reply", message));
            else if (ok) out.put("reply", message);
            if (message.toLowerCase(Locale.US).contains("confirmation required")) {
                out.put("ok", false);
                out.put("needs_user_action", true);
            }
            return remember(ctx, out).toString();
        } catch (Exception e) {
            return remember(ctx, need("PC link request fail: " + friendly(e))).toString();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** POST /link/save; the PC enforces its own confirmation gate. */
    public static String save(Context ctx, String fileId, String destination) {
        return save(ctx, fileId, destination, false);
    }

    /** confirmed=true ONLY after the user explicitly says yes to an overwrite. */
    public static String save(Context ctx, String fileId, String destination, boolean confirmed) {
        if (ctx == null) return json(false, "PC link context available nahi hai.", false);
        if (!paired(ctx)) return remember(ctx, notPaired()).toString();
        String id = fileId == null ? "" : fileId.trim();
        if (id.isEmpty()) id = prefs(ctx).getString(KEY_LAST_FILE_ID, "");
        if (id.isEmpty()) {
            return remember(ctx, need("Pehle file upload karo ya file_id do.")).toString();
        }
        String dest = destination == null ? "" : destination.trim();
        if (dest.isEmpty() && !confirmed) {
            dest = prefs(ctx).getString(KEY_LAST_DEST, "");
        }
        if (dest.isEmpty() && !confirmed) {
            return remember(ctx, need("PC par kahan save karna hai? Jaise 'PC par Downloads mein save karo'.")).toString();
        }
        if (!dest.isEmpty()) {
            prefs(ctx).edit().putString(KEY_LAST_DEST, dest).apply();
        }
        try {
            JSONObject req = new JSONObject()
                    .put("id", id)                 // PC's canonical key
                    .put("file_id", id)            // backward-compatible alias
                    .put("destination", dest)
                    .put("confirmed", confirmed);
            return postJson(ctx, "/link/save", req);
        } catch (Exception e) {
            return remember(ctx, need("Save request nahi ban saka: " + friendly(e))).toString();
        }
    }

    /** POST /link/command; the reply is whatever PC Jarvis actually returned. */
    public static String command(Context ctx, String text) {
        if (ctx == null) return json(false, "PC link context available nahi hai.", false);
        if (!paired(ctx)) return remember(ctx, notPaired()).toString();
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) return remember(ctx, need("PC ke liye message bolo.")).toString();
        try {
            JSONObject req = new JSONObject().put("text", t);
            return postJson(ctx, "/link/command", req);
        } catch (Exception e) {
            return remember(ctx, need("Command nahi bana: " + friendly(e))).toString();
        }
    }

    /** Last REAL uploaded file id, used when the user says only the destination. */
    public static String lastFileId(Context ctx) {
        if (ctx == null) return "";
        return prefs(ctx).getString(KEY_LAST_FILE_ID, "");
    }

    /** Last REAL destination asked for by the user, for explicit confirmation. */
    public static String lastDestination(Context ctx) {
        if (ctx == null) return "";
        return prefs(ctx).getString(KEY_LAST_DEST, "");
    }
}
