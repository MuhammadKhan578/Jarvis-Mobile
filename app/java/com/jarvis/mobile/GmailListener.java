package com.jarvis.mobile;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Optional Gmail inbox reader.
 *
 * Android does not allow third-party apps to read Gmail directly.  With the
 * user's explicit Notification Access permission, Jarvis can read the Gmail
 * notifications that are visible on the phone and summarise them.  Marking an
 * email read is NOT possible from a notification, so Jarvis never claims it.
 */
public class GmailListener extends NotificationListenerService {

    private static final String PREFS = "jarvis_gmail";
    private static final String KEY_ITEMS = "items";
    private static final int MAX_ITEMS = 40;
    private static final Object LOCK = new Object();

    @Override
    public void onCreate() {
        super.onCreate();
        init(this);
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        init(this);
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active != null) {
                for (StatusBarNotification sbn : active) onNotificationPosted(sbn);
            }
        } catch (Exception ignored) { }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        if (!"com.google.android.gm".equals(sbn.getPackageName())) return;
        try {
            Bundle extras = sbn.getNotification().extras;
            String from = text(extras.getCharSequence(Notification.EXTRA_TITLE));
            String subject = text(extras.getCharSequence(Notification.EXTRA_TEXT));
            String sub = text(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
            String big = text(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            String snippet = big;
            if (snippet.isEmpty() && lines != null) {
                StringBuilder sb = new StringBuilder();
                for (CharSequence line : lines) {
                    if (line != null) sb.append(line).append(' ');
                }
                snippet = sb.toString();
            }
            if (snippet.startsWith(subject)) snippet = snippet.substring(subject.length()).trim();
            if (from.isEmpty() && subject.isEmpty() && snippet.isEmpty()) return;

            JSONObject item = new JSONObject();
            item.put("from", trim(from, 120));
            item.put("subject", trim(subject, 200));
            item.put("snippet", trim(snippet, 400));
            item.put("account", trim(sub, 120));
            item.put("time", sbn.getPostTime());

            synchronized (LOCK) {
                JSONArray items = load();
                JSONArray out = new JSONArray();
                out.put(item);
                for (int i = 0; i < items.length() && out.length() < MAX_ITEMS; i++) {
                    JSONObject old = items.optJSONObject(i);
                    if (old == null) continue;
                    boolean same = old.optString("from").equals(item.optString("from"))
                            && old.optString("subject").equals(item.optString("subject"))
                            && Math.abs(old.optLong("time") - item.optLong("time")) < 120000L;
                    if (!same) out.put(old);
                }
                save(out);
            }
        } catch (Exception ignored) { }
    }

    private static String text(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    private static String trim(String s, int max) {
        if (s == null) return "";
        s = s.replaceAll("\\s+", " ").trim();
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONArray load() {
        try {
            Context c = currentContext();
            if (c == null) return new JSONArray();
            String raw = prefs(c).getString(KEY_ITEMS, "[]");
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void save(JSONArray arr) {
        try {
            Context c = currentContext();
            if (c == null) return;
            prefs(c).edit().putString(KEY_ITEMS, arr.toString()).apply();
        } catch (Exception ignored) { }
    }

    private static Context currentContext() {
        return Holder.context;
    }

    /** Holds an application context so static helpers can work without a live service. */
    public static void init(Context context) {
        Holder.context = context.getApplicationContext();
    }

    private static final class Holder {
        static Context context;
    }

    // -------------------------------------------------------------- public API

    public static boolean hasAccess(Context c) {
        try {
            String enabled = Settings.Secure.getString(c.getContentResolver(),
                    "enabled_notification_listeners");
            if (enabled == null) return false;
            for (String s : enabled.split(":")) {
                ComponentName cn = ComponentName.unflattenFromString(s);
                if (cn != null && c.getPackageName().equals(cn.getPackageName())) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    public static String readItemsJson(Context c, int limit) {
        JSONArray src = load();
        JSONArray out = new JSONArray();
        int n = Math.min(src.length(), Math.max(1, Math.min(limit, MAX_ITEMS)));
        for (int i = 0; i < n; i++) {
            JSONObject o = src.optJSONObject(i);
            if (o == null) continue;
            try {
                JSONObject copy = new JSONObject(o.toString());
                copy.put("time_text", formatTime(o.optLong("time")));
                out.put(copy);
            } catch (Exception ignored) { }
        }
        return out.toString();
    }

    public static String readForTool(Context c, int limit) {
        try {
            JSONObject result = new JSONObject();
            if (!hasAccess(c)) {
                result.put("ok", false);
                result.put("reason", "notification_access");
                result.put("message", "Gmail notifications parhne ke liye Notification Access permission chahiye. Settings khol kar Jarvis ko allow karein.");
                result.put("needs_user_action", true);
                return result.toString();
            }
            JSONArray items = new JSONArray(readItemsJson(c, limit));
            result.put("ok", true);
            result.put("emails", items);
            result.put("count", items.length());
            result.put("mark_read_supported", false);
            result.put("note", "Android par notification se email read mark nahi hoti. Sirf parh kar summary di ja sakti hai; Gmail khol kar mail tap karni hogi.");
            result.put("needs_user_action", false);
            if (items.length() == 0) {
                result.put("message", "Abhi Gmail ki koi notification nahi hai.");
            }
            return result.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"Inbox read nahi ho saka.\",\"needs_user_action\":false}";
        }
    }

    public static void clearAll(Context c) {
        try {
            prefs(c).edit().remove(KEY_ITEMS).apply();
        } catch (Exception ignored) { }
    }

    private static String formatTime(long t) {
        try {
            return new SimpleDateFormat("hh:mm a", Locale.US).format(new Date(t));
        } catch (Exception e) {
            return "";
        }
    }
}
