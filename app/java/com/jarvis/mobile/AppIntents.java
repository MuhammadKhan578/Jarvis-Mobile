package com.jarvis.mobile;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.AlarmClock;
import android.provider.MediaStore;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** All phone actions Jarvis can perform. Every result is real; nothing is faked. */
public final class AppIntents {

    private static final Map<String, String> APPS = new LinkedHashMap<>();
    static {
        APPS.put("brave", "com.brave.browser");
        APPS.put("chrome", "com.android.chrome");
        APPS.put("youtube", "com.google.android.youtube");
        APPS.put("gmail", "com.google.android.gm");
        APPS.put("whatsapp", "com.whatsapp");
        APPS.put("instagram", "com.instagram.android");
        APPS.put("facebook", "com.facebook.katana");
        APPS.put("messenger", "com.facebook.orca");
        APPS.put("telegram", "org.telegram.messenger");
        APPS.put("tiktok", "com.zhiliaoapp.musically");
        APPS.put("snapchat", "com.snapchat.android");
        APPS.put("spotify", "com.spotify.music");
        APPS.put("netflix", "com.netflix.mediaclient");
        APPS.put("maps", "com.google.android.apps.maps");
        APPS.put("google maps", "com.google.android.apps.maps");
        APPS.put("photos", "com.google.android.apps.photos");
        APPS.put("gallery", "com.google.android.apps.photos");
        APPS.put("play store", "com.android.vending");
        APPS.put("phone", "com.google.android.dialer");
        APPS.put("dialer", "com.google.android.dialer");
        APPS.put("messages", "com.google.android.apps.messaging");
        APPS.put("contacts", "com.google.android.contacts");
        APPS.put("calendar", "com.google.android.calendar");
        APPS.put("keep", "com.google.android.keep");
        APPS.put("files", "com.google.android.documentsui");
        APPS.put("file manager", "com.google.android.documentsui");
        APPS.put("settings", "com.android.settings");
        APPS.put("calculator", "com.google.android.calculator");
        APPS.put("clock", "com.google.android.deskclock");
        APPS.put("alarm", "com.google.android.deskclock");
        APPS.put("camera", "camera");
        APPS.put("music", "music");
        APPS.put("browser", "browser");
        APPS.put("internet", "browser");
        APPS.put("email", "gmail");
        APPS.put("mail", "gmail");
        APPS.put("video", "youtube");
    }

    private AppIntents() { }

    public static String execute(Context context, String tool, JSONObject args) {
        try {
            switch (tool) {
                case "open_app": return openApp(context, args.optString("app_name", ""));
                case "open_url": return openUrl(context, args.optString("url", ""));
                case "youtube_search": return youtubeSearch(context, args.optString("query", ""));
                case "youtube_channel": return youtubeChannel(context, args.optString("channel_name", ""));
                case "send_whatsapp": return whatsapp(context, args.optString("phone", ""), args.optString("message", ""));
                case "send_sms": return sms(context, args.optString("phone", ""), args.optString("message", ""));
                case "call_number": return dial(context, args.optString("phone", ""));
                case "compose_email": return email(context, args.optString("to", ""), args.optString("subject", ""), args.optString("body", ""));
                case "open_gmail": return openGmail(context);
                case "read_inbox": return GmailListener.readForTool(context, args.optInt("limit", 8));
                case "open_inbox": return openGmail(context);
                case "set_alarm": return alarm(context, args.optInt("hour", 7), args.optInt("minute", 0), args.optString("label", "Jarvis alarm"));
                case "set_timer": return timer(context, args.optInt("seconds", 300), args.optString("label", "Jarvis timer"));
                case "navigate": return navigate(context, args.optString("place", ""));
                case "web_search": return webSearch(context, args.optString("query", ""));
                case "device_status": return deviceStatus(context);
                case "set_volume": return volume(context, args.optString("direction", ""), args.optInt("percent", -1));
                case "torch": return torch(context, args.optBoolean("on", true));
                case "open_settings": return openSettings(context, args.optString("section", ""));
                case "list_apps": return listApps(context, args.optInt("limit", 40));
                case "share_text": return share(context, args.optString("text", ""));
                case "open_play_store": return playStore(context, args.optString("app_name", ""));
                case "notification_access": return openNotificationAccess(context);
                case "tts_settings": return openTtsSettings(context);
                case "open_camera": return openCamera(context);
                case "automation_settings": return openAutomationSettings(context);
                case "ui_click": return uiClick(context, args.optString("text", ""));
                case "ui_type": return uiType(context, args.optString("text", ""));
                case "ui_dump": return uiDump(context);
                case "system_action": return systemAction(context, args.optString("action", ""));
                default: return res(false, "Mobile app mein yeh tool nahi hai: " + tool, false, null);
            }
        } catch (Exception e) {
            return res(false, "Tool fail hua: " + e.getMessage(), false, null);
        }
    }

    // ---------------------------------------------------------------- helpers

    private static String res(boolean ok, String message, boolean needsUser, Object data) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("message", message == null ? "" : message);
            o.put("needs_user_action", needsUser);
            if (data != null) o.put("data", data);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"result error\",\"needs_user_action\":false}";
        }
    }

    private static boolean launchPackage(Context c, String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        if (!launchAllowed(c)) return false;
        try {
            Intent i = c.getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            launchContext(c).startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean start(Context c, Intent intent) {
        if (!launchAllowed(c)) return false;
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            launchContext(c).startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            android.util.Log.w("JarvisMobile", "start: no activity for " + intent + " :: " + e);
            return false;
        } catch (Exception e) {
            android.util.Log.w("JarvisMobile", "start: failed for " + intent + " :: " + e);
            return false;
        }
    }

    /**
     * Android 10+ blocks activity starts from a background app. A bound
     * accessibility service is one of the documented exemptions, so when
     * Phone automation is on we launch through it; otherwise we use the normal
     * context (works while the app is on screen).
     */
    private static Context launchContext(Context c) {
        try {
            JarvisAccessibilityService svc = JarvisAccessibilityService.instance();
            if (svc != null) return svc;
        } catch (Exception ignored) { }
        return c;
    }

    /** Background activity starts are blocked unless the app is visible or has automation on. */
    private static boolean launchAllowed(Context c) {
        try {
            if (MainActivity.visible) return true;
        } catch (Exception ignored) { }
        try {
            return JarvisAccessibilityService.instance() != null;
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean hasAnyBrowser(Context c) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com"));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i.resolveActivity(c.getPackageManager()) != null;
    }

    private static String openApp(Context c, String rawName) {
        String name = rawName == null ? "" : rawName.trim().toLowerCase(Locale.ROOT);
        name = name.replaceAll("\\b(app|application|kholo|khol|open|launch|chalao)\\b", " ").trim();
        if (name.isEmpty()) return res(false, "App ka naam nahi mila.", false, null);

        String pkg = null;
        // Exact name first, then a whole-word match (longest key wins).  A plain
        // substring check used to turn "headphone" into the Phone app.
        for (Map.Entry<String, String> e : APPS.entrySet()) {
            if (name.equals(e.getKey())) { pkg = e.getValue(); break; }
        }
        if (pkg == null) {
            int best = 0;
            for (Map.Entry<String, String> e : APPS.entrySet()) {
                String key = e.getKey();
                if (key.length() > best && containsWord(name, key)) {
                    best = key.length();
                    pkg = e.getValue();
                }
            }
        }
        if ("camera".equals(pkg)) return openCamera(c);
        if ("music".equals(pkg)) {
            if (launchPackage(c, "com.spotify.music")) return res(true, "Spotify khol diya.", false, null);
            if (launchPackage(c, "com.google.android.apps.youtube.music")) return res(true, "YouTube Music khol diya.", false, null);
            return res(false, "Koi music app nahi mili.", false, null);
        }
        if ("browser".equals(pkg)) {
            for (String b : new String[]{"com.brave.browser", "com.android.chrome", "org.mozilla.firefox", "com.microsoft.emmx"}) {
                if (launchPackage(c, b)) return res(true, "Browser khol diya.", false, null);
            }
            if (hasAnyBrowser(c)) {
                return start(c, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com")))
                        ? res(true, "Browser khol diya.", false, null)
                        : res(false, "Browser nahi khul saka.", false, null);
            }
            return res(false, "Is phone par browser nahi mila.", false, null);
        }
        if (pkg != null && launchPackage(c, pkg)) return res(true, appLabel(c, pkg) + " khol diya.", false, null);

        // Unknown name: search installed apps by their visible label.
        String byLabel = findPackageByLabel(c, name);
        if (byLabel != null && launchPackage(c, byLabel)) {
            return res(true, appLabel(c, byLabel) + " khol diya.", false, null);
        }
        if ("gmail".equals(pkg)) return openGmail(c);
        if (!launchAllowed(c)) {
            return res(false, "Background se app kholne ke liye Settings > Phone automation on karein.",
                    true, null);
        }
        return res(false, "Phone par '" + rawName + "' app nahi mili.", false, null);
    }

    /**
     * True when {@code key} appears in {@code text} as a whole word/phrase, so
     * "headphone" never matches "phone" and "google maps" is preferred over
     * "maps" (the longest key wins at the call site).
     */
    private static boolean containsWord(String text, String key) {
        if (key == null || key.isEmpty()) return false;
        int from = 0;
        while (true) {
            int i = text.indexOf(key, from);
            if (i < 0) return false;
            int end = i + key.length();
            boolean leftOk = i == 0 || !Character.isLetterOrDigit(text.charAt(i - 1));
            boolean rightOk = end >= text.length() || !Character.isLetterOrDigit(text.charAt(end));
            if (leftOk && rightOk) return true;
            from = i + 1;
        }
    }

    private static String appLabel(Context c, String pkg) {
        try {
            PackageManager pm = c.getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    private static String findPackageByLabel(Context c, String query) {
        try {
            PackageManager pm = c.getPackageManager();
            String q = query.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").trim();
            if (q.isEmpty()) return null;
            String bestPkg = null;
            int best = 0;
            for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
                Intent launch = pm.getLaunchIntentForPackage(ai.packageName);
                if (launch == null) continue;
                String label = pm.getApplicationLabel(ai).toString().toLowerCase(Locale.ROOT);
                int score = 0;
                if (label.equals(q)) score = 100;
                else if (label.startsWith(q)) score = 80;
                else if (label.contains(q)) score = 60;
                else if (q.contains(label) && label.length() >= 3) score = 40;
                if (score > best) { best = score; bestPkg = ai.packageName; }
            }
            return best >= 40 ? bestPkg : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String openUrl(Context c, String url) {
        String u = url == null ? "" : url.trim();
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            return res(false, "Sirf http ya https link khul sakta hai.", false, null);
        }
        boolean ok = start(c, new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
        return res(ok, ok ? "Link khol diya." : "Link kholne wala koi app nahi mila.", false, null);
    }

    private static String youtubeSearch(Context c, String query) {
        String q = query == null ? "" : query.trim();
        if (q.isEmpty()) return res(false, "Kya search karna hai?", false, null);
        String url = "https://www.youtube.com/results?search_query=" + Uri.encode(q);
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.setPackage("com.google.android.youtube");
        if (start(c, i)) return res(true, "YouTube par '" + q + "' search khol diya.", false, null);
        boolean ok = start(c, new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        return res(ok, ok ? "YouTube search browser mein khol diya." : "YouTube nahi khul saka.", false, null);
    }

    private static String youtubeChannel(Context c, String channel) {
        String q = channel == null ? "" : channel.trim();
        if (q.isEmpty()) return res(false, "Channel ka naam bataiye.", false, null);
        String url = "https://www.youtube.com/results?search_query=" + Uri.encode(q) + "+channel";
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.setPackage("com.google.android.youtube");
        boolean ok = start(c, i) || start(c, new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        return res(ok,
                ok ? "YouTube par '" + q + "' channel khol diya. Subscribe button aap ko khud dabana hoga."
                        : "YouTube channel nahi khul saka.",
                true, null);
    }

    private static String whatsapp(Context c, String phone, String message) {
        String text = message == null ? "" : message;
        String digits = phone == null ? "" : phone.replaceAll("[^0-9]", "");
        String url = digits.isEmpty() ? "https://wa.me/?text=" + Uri.encode(text)
                : "https://wa.me/" + digits + "?text=" + Uri.encode(text);
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.setPackage("com.whatsapp");
        if (start(c, i)) {
            return res(true, "WhatsApp mein message tayyar hai. Send button aap dabaiye.", true, null);
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        if (start(c, Intent.createChooser(send, "Message bhejein"))) {
            return res(true, "Message tayyar hai, app chun kar send karein.", true, null);
        }
        return res(false, "WhatsApp install nahi hai.", false, null);
    }

    private static String sms(Context c, String phone, String message) {
        String digits = phone == null ? "" : phone.replaceAll("[^0-9+]", "");
        if (digits.isEmpty()) return res(false, "Number bataiye, phir SMS tayyar karunga.", false, null);
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + digits));
        i.putExtra("sms_body", message == null ? "" : message);
        boolean ok = start(c, i);
        return res(ok, ok ? "SMS tayyar hai, Send dabaiye." : "SMS app nahi mila.", true, null);
    }

    private static String dial(Context c, String phone) {
        String digits = phone == null ? "" : phone.replaceAll("[^0-9+]", "");
        if (digits.isEmpty()) return res(false, "Number bataiye.", false, null);
        boolean ok = start(c, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + digits)));
        return res(ok, ok ? "Dialer khol diya." : "Dialer nahi mila.", true, null);
    }

    private static String email(Context c, String to, String subject, String body) {
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + (to == null ? "" : Uri.encode(to))));
        if (subject != null && !subject.isEmpty()) i.putExtra(Intent.EXTRA_SUBJECT, subject);
        if (body != null && !body.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, body);
        i.setPackage("com.google.android.gm");
        if (!start(c, i)) {
            i.setPackage(null);
            if (!start(c, i)) return res(false, "Email app nahi mila.", false, null);
        }
        return res(true, "Email draft tayyar hai. Send button aap dabaiye.", true, null);
    }

    private static String openGmail(Context c) {
        if (launchPackage(c, "com.google.android.gm")) return res(true, "Gmail khol diya.", false, null);
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://mail.google.com"));
        boolean ok = start(c, i);
        return res(ok, ok ? "Gmail browser mein khol diya." : "Gmail nahi khul saka.", false, null);
    }

    private static String alarm(Context c, int hour, int minute, String label) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, Math.max(0, Math.min(23, hour)));
        i.putExtra(AlarmClock.EXTRA_MINUTES, Math.max(0, Math.min(59, minute)));
        i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        boolean ok = start(c, i);
        return res(ok, ok ? "Clock app khol diya; alarm confirm karein." : "Alarm app nahi mila.", true, null);
    }

    private static String timer(Context c, int seconds, String label) {
        if (seconds <= 0) seconds = 300;
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
        i.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        boolean ok = start(c, i);
        return res(ok, ok ? "Timer tayyar hai; start confirm karein." : "Timer app nahi mila.", true, null);
    }

    private static String navigate(Context c, String place) {
        String q = place == null ? "" : place.trim();
        if (q.isEmpty()) return res(false, "Kahan jana hai?", false, null);
        Intent nav = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(q)));
        nav.setPackage("com.google.android.apps.maps");
        if (start(c, nav)) return res(true, "Maps mein navigation khol diya.", false, null);
        boolean ok = start(c, new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(q))));
        return res(ok, ok ? "Maps mein jagah khol di." : "Maps app nahi mila.", false, null);
    }

    private static String webSearch(Context c, String query) {
        String q = query == null ? "" : query.trim();
        if (q.isEmpty()) return res(false, "Kya search karna hai?", false, null);
        boolean ok = start(c, new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://www.google.com/search?q=" + Uri.encode(q))));
        return res(ok, ok ? "Browser mein search khol diya." : "Browser nahi mila.", false, null);
    }

    private static String openCamera(Context c) {
        Intent i = new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
        boolean ok = start(c, i);
        return res(ok, ok ? "Camera khol diya." : "Camera app nahi mila.", false, null);
    }

    private static String share(Context c, String text) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
        boolean ok = start(c, Intent.createChooser(i, "Share"));
        return res(ok, ok ? "Share menu khol diya." : "Share nahi ho saka.", false, null);
    }

    private static String playStore(Context c, String appName) {
        String q = appName == null ? "" : appName.trim();
        String market = q.isEmpty()
                ? "market://search?q=apps"
                : "market://search?q=" + Uri.encode(q) + "&c=apps";
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(market));
        i.setPackage("com.android.vending");
        if (start(c, i)) {
            return res(true, q.isEmpty() ? "Play Store khol diya." : "Play Store par '" + q + "' search khol diya.", false, null);
        }
        String web = q.isEmpty()
                ? "https://play.google.com/store/apps"
                : "https://play.google.com/store/search?q=" + Uri.encode(q) + "&c=apps";
        boolean ok = start(c, new Intent(Intent.ACTION_VIEW, Uri.parse(web)));
        return res(ok, ok ? "Play Store khol diya." : "Play Store nahi khul saka.", false, null);
    }

    private static String openAutomationSettings(Context c) {
        boolean ok = start(c, new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        return res(ok,
                ok ? "Accessibility settings khul gayi. 'Jarvis Automation' on karein."
                        : "Accessibility settings nahi khuli.",
                true, null);
    }

    private static String uiClick(Context c, String text) {
        if (!JarvisAccessibilityService.isConnected()) {
            return res(false, "Automation off hai. Settings se on karein.", true, null);
        }
        boolean ok = JarvisAccessibilityService.clickText(text);
        return res(ok,
                ok ? "'" + text + "' par tap kar diya." : "Screen par '" + text + "' nahi mila.",
                !ok, null);
    }

    private static String uiType(Context c, String text) {
        if (!JarvisAccessibilityService.isConnected()) {
            return res(false, "Automation off hai. Settings se on karein.", true, null);
        }
        boolean ok = JarvisAccessibilityService.setText(text);
        return res(ok, ok ? "Text likh diya." : "Koi text field nahi mili.", !ok, null);
    }

    private static String uiDump(Context c) {
        if (!JarvisAccessibilityService.isConnected()) {
            return res(false, "Automation off hai. Settings se on karein.", true, null);
        }
        String screen = JarvisAccessibilityService.dumpTexts();
        try {
            JSONObject data = new JSONObject();
            data.put("screen", screen);
            return res(true, screen.isEmpty() ? "Screen khali lag rahi hai." : "Screen padh li.", false, data);
        } catch (Exception e) {
            return res(false, "Screen padhi nahi gayi.", false, null);
        }
    }

    private static String systemAction(Context c, String action) {
        if (!JarvisAccessibilityService.isConnected()) {
            return res(false, "Automation off hai. Settings se on karein.", true, null);
        }
        boolean ok = JarvisAccessibilityService.performAction(action);
        return res(ok, ok ? action + " kar diya." : "Yeh system action nahi hua.", !ok, null);
    }

    private static String openSettings(Context c, String section) {
        String s = section == null ? "" : section.toLowerCase(Locale.ROOT);
        String action = Settings.ACTION_SETTINGS;
        if (s.contains("wifi")) action = Settings.ACTION_WIFI_SETTINGS;
        else if (s.contains("bluetooth")) action = Settings.ACTION_BLUETOOTH_SETTINGS;
        else if (s.contains("sound")) action = Settings.ACTION_SOUND_SETTINGS;
        else if (s.contains("display")) action = Settings.ACTION_DISPLAY_SETTINGS;
        else if (s.contains("battery")) action = Settings.ACTION_BATTERY_SAVER_SETTINGS;
        else if (s.contains("location")) action = Settings.ACTION_LOCATION_SOURCE_SETTINGS;
        else if (s.contains("data")) action = Settings.ACTION_DATA_ROAMING_SETTINGS;
        else if (s.contains("airplane")) action = Settings.ACTION_AIRPLANE_MODE_SETTINGS;
        else if (s.contains("accessibility")) action = Settings.ACTION_ACCESSIBILITY_SETTINGS;
        else if (s.contains("language")) action = Settings.ACTION_LOCALE_SETTINGS;
        boolean ok = start(c, new Intent(action));
        return res(ok, ok ? "Settings khol di." : "Settings nahi khuli.", false, null);
    }

    private static String openNotificationAccess(Context c) {
        boolean ok = start(c, new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
        return res(ok, ok ? "Notification access settings khol di. Jarvis ko allow karein." : "Settings nahi khuli.", true, null);
    }

    private static String openTtsSettings(Context c) {
        boolean ok = start(c, new Intent("com.android.settings.TTS_SETTINGS"));
        if (!ok) ok = start(c, new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        return res(ok, ok ? "Text-to-speech settings khol di." : "Settings nahi khuli.", true, null);
    }

    private static String volume(Context c, String direction, int percent) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return res(false, "Volume control nahi mila.", false, null);
        String d = direction == null ? "" : direction.toLowerCase(Locale.ROOT);
        int stream = AudioManager.STREAM_MUSIC;
        if (d.contains("ring")) stream = AudioManager.STREAM_RING;
        else if (d.contains("alarm")) stream = AudioManager.STREAM_ALARM;
        else if (d.contains("call")) stream = AudioManager.STREAM_VOICE_CALL;
        try {
            if (percent >= 0) {
                int max = am.getStreamMaxVolume(stream);
                int value = Math.round(max * Math.min(100, percent) / 100f);
                am.setStreamVolume(stream, value, 0);
                return res(true, "Volume " + percent + " percent kar diya.", false, null);
            }
            if (d.contains("mute") || d.contains("band")) {
                am.adjustStreamVolume(stream, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI);
                return res(true, "Volume mute kar diya.", false, null);
            }
            if (d.contains("unmute")) {
                am.adjustStreamVolume(stream, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI);
                return res(true, "Volume unmute kar diya.", false, null);
            }
            int dir = d.contains("down") || d.contains("kam") ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_RAISE;
            am.adjustStreamVolume(stream, dir, AudioManager.FLAG_SHOW_UI);
            return res(true, "Volume adjust kar diya.", false, null);
        } catch (Exception e) {
            return res(false, "Volume change nahi hua.", false, null);
        }
    }

    private static String torch(Context c, boolean on) {
        try {
            CameraManager cm = (CameraManager) c.getSystemService(Context.CAMERA_SERVICE);
            if (cm == null) return res(false, "Flashlight nahi mila.", false, null);
            // Prefer the back camera; some phones list a front camera with flash first.
            String best = null;
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics ch = cm.getCameraCharacteristics(id);
                Boolean flash = ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (flash == null || !flash) continue;
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                boolean back = facing != null && facing == CameraCharacteristics.LENS_FACING_BACK;
                if (best == null || back) best = id;
                if (back) break;
            }
            if (best != null) {
                cm.setTorchMode(best, on);
                return res(true, on ? "Flashlight on kar di." : "Flashlight off kar di.", false, null);
            }
            return res(false, "Is phone mein flashlight nahi hai.", false, null);
        } catch (SecurityException e) {
            return res(false, "Camera permission chahiye flashlight ke liye.", false, null);
        } catch (Exception e) {
            return res(false, "Flashlight control nahi hua.", false, null);
        }
    }

    private static String listApps(Context c, int limit) {
        try {
            PackageManager pm = c.getPackageManager();
            List<String> labels = new ArrayList<>();
            for (ApplicationInfo ai : pm.getInstalledApplications(0)) {
                if (pm.getLaunchIntentForPackage(ai.packageName) != null) {
                    labels.add(pm.getApplicationLabel(ai).toString());
                }
            }
            Collections.sort(labels, String.CASE_INSENSITIVE_ORDER);
            JSONArray arr = new JSONArray();
            int n = Math.min(Math.max(1, limit), labels.size());
            for (int i = 0; i < n; i++) arr.put(labels.get(i));
            JSONObject data = new JSONObject();
            data.put("apps", arr);
            data.put("total", labels.size());
            return res(true, labels.size() + " apps mile.", false, data);
        } catch (Exception e) {
            return res(false, "Apps list nahi mili.", false, null);
        }
    }

    private static String deviceStatus(Context c) {
        try {
            JSONObject data = new JSONObject();
            data.put("android", Build.VERSION.RELEASE);
            data.put("sdk", Build.VERSION.SDK_INT);
            data.put("model", Build.MANUFACTURER + " " + Build.MODEL);

            Intent battery = c.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery == null ? 100 : battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = battery == null ? -1 : battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            int pct = (level >= 0 && scale > 0) ? Math.round(level * 100f / scale) : -1;
            data.put("battery", pct);
            data.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);

            ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
            boolean online = false;
            String type = "none";
            if (cm != null) {
                if (Build.VERSION.SDK_INT >= 23) {
                    android.net.Network n = cm.getActiveNetwork();
                    NetworkCapabilities caps = n == null ? null : cm.getNetworkCapabilities(n);
                    if (caps != null) {
                        online = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
                        else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "mobile";
                        else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) type = "ethernet";
                    }
                } else {
                    NetworkInfo ni = cm.getActiveNetworkInfo();
                    online = ni != null && ni.isConnected();
                    type = ni == null ? "none" : ni.getTypeName().toLowerCase(Locale.ROOT);
                }
            }
            data.put("online", online);
            data.put("network", type);

            StatFs stat = new StatFs(Environment.getDataDirectory().getPath());
            long free = stat.getAvailableBytes();
            long total = stat.getTotalBytes();
            data.put("storage_free_gb", Math.round(free / (1024.0 * 1024 * 1024) * 10) / 10.0);
            data.put("storage_total_gb", Math.round(total / (1024.0 * 1024 * 1024) * 10) / 10.0);
            return res(true, "Device status mil gaya.", false, data);
        } catch (Exception e) {
            return res(false, "Status nahi mila.", false, null);
        }
    }
}
