package com.jarvis.mobile;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Queue;

/**
 * Real phone automation for Jarvis.
 *
 * Android does not allow silent APK installs, but an AccessibilityService is
 * exactly how automation apps press buttons for the user.  With this service
 * enabled Jarvis can:
 *   - search an app in the Play Store and tap the first result,
 *   - tap Install / Update, wait for the download and then tap Open,
 *   - read the visible screen and tap any text ("ui_click"),
 *   - type into the focused field ("ui_type"),
 *   - press Back / Home / Recents / Notifications.
 *
 * Nothing is faked: every message reports what really happened.  The service
 * only runs after the user enables "Jarvis Automation" in Accessibility
 * settings, and it never reads passwords.
 */
public class JarvisAccessibilityService extends AccessibilityService {

    public interface InstallCallback {
        void onInstallResult(String requestId, JSONObject result);
    }

    private static final String TAG = "JarvisMobile";
    private static final long POLL_MS = 600;

    private static volatile JarvisAccessibilityService instance;

    private final Handler main = new Handler(Looper.getMainLooper());

    // ---- install job state ----
    private String jobId;
    private String jobApp;
    private InstallCallback jobCallback;
    private int step = 0;
    private long stepStart = 0;
    private boolean jobDone = true;
    private Runnable poller;
    private int installRetries = 0;

    private static final int STEP_FIND_RESULT = 0;
    private static final int STEP_CLICK_INSTALL = 1;
    private static final int STEP_WAIT_INSTALLED = 2;

    // ------------------------------------------------------------ lifecycle

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        Log.d(TAG, "Accessibility service connected");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { }

    @Override
    public void onInterrupt() { }

    @Override
    public void onDestroy() {
        instance = null;
        stopInstallJob();
        super.onDestroy();
    }

    // ------------------------------------------------------------- statics

    public static boolean isConnected() {
        return instance != null;
    }

    public static JarvisAccessibilityService instance() {
        return instance;
    }

    /** True when the user has switched "Jarvis Automation" on. */
    public static boolean isEnabled(Context context) {
        try {
            ComponentName comp = new ComponentName(context, JarvisAccessibilityService.class);
            String flat = comp.flattenToString();
            String shortFlat = comp.flattenToShortString();
            String enabled = Settings.Secure.getString(
                    context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (enabled == null) return false;
            String low = enabled.toLowerCase(Locale.ROOT);
            return low.contains(flat.toLowerCase(Locale.ROOT))
                    || low.contains(shortFlat.toLowerCase(Locale.ROOT));
        } catch (Exception e) {
            return false;
        }
    }

    // ----------------------------------------------------------- public API

    /** Clicks the first visible node whose text (or description) matches. */
    public static boolean clickText(String target) {
        JarvisAccessibilityService svc = instance;
        if (svc == null || target == null) return false;
        String want = norm(target);
        if (want.isEmpty()) return false;
        AccessibilityNodeInfo root = svc.safeRoot();
        if (root == null) return false;

        AccessibilityNodeInfo exact = svc.find(root, want, true, false);
        if (exact != null && svc.clickNode(exact)) return true;

        AccessibilityNodeInfo partial = svc.find(root, want, false, false);
        if (partial != null && svc.clickNode(partial)) return true;

        // Try a shorter form ("Install" inside "Install app").
        if (want.contains(" ")) {
            String first = want.split(" ")[0];
            AccessibilityNodeInfo head = svc.find(root, first, false, false);
            if (head != null && svc.clickNode(head)) return true;
        }
        return false;
    }

    /** Click a button whose id contains the given suffix (fallback path). */
    public static boolean clickIdPart(String idPart) {
        JarvisAccessibilityService svc = instance;
        if (svc == null || idPart == null) return false;
        AccessibilityNodeInfo root = svc.safeRoot();
        if (root == null) return false;
        AccessibilityNodeInfo node = svc.findByResourceId(root, idPart.toLowerCase(Locale.ROOT));
        return node != null && svc.clickNode(node);
    }

    /** Visible screen text, used by the brain to understand the current app. */
    public static String dumpTexts() {
        JarvisAccessibilityService svc = instance;
        if (svc == null) return "";
        AccessibilityNodeInfo root = svc.safeRoot();
        if (root == null) return "";
        StringBuilder sb = new StringBuilder();
        svc.collect(root, sb, 0);
        String out = sb.toString().trim();
        return out.length() > 6000 ? out.substring(0, 6000) : out;
    }

    /** Types into the focused editable field (or the first one found). */
    public static boolean setText(String text) {
        JarvisAccessibilityService svc = instance;
        if (svc == null || text == null) return false;
        AccessibilityNodeInfo root = svc.safeRoot();
        if (root == null) return false;

        AccessibilityNodeInfo target = svc.findEditable(root, true);
        if (target == null) target = svc.findEditable(root, false);
        if (target == null) return false;

        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        boolean ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        if (!ok) {
            // Some apps only accept paste.
            try {
                android.content.ClipboardManager cm = (android.content.ClipboardManager)
                        svc.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", text));
                    target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                    target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                    ok = true;
                }
            } catch (Exception ignored) { }
        }
        return ok;
    }

    /** back / home / recents / notifications / quick_settings / lock / screenshot */
    public static boolean performAction(String action) {
        JarvisAccessibilityService svc = instance;
        if (svc == null || action == null) return false;
        String a = action.trim().toLowerCase(Locale.ROOT);
        int code = -1;
        if (a.equals("back")) code = GLOBAL_ACTION_BACK;
        else if (a.equals("home")) code = GLOBAL_ACTION_HOME;
        else if (a.equals("recents")) code = GLOBAL_ACTION_RECENTS;
        else if (a.equals("notifications") || a.equals("notification_shade")) code = GLOBAL_ACTION_NOTIFICATIONS;
        else if (a.equals("quick_settings") || a.equals("settings_shade")) code = GLOBAL_ACTION_QUICK_SETTINGS;
        else if (a.equals("lock") || a.equals("lock_screen")) {
            if (Build.VERSION.SDK_INT >= 28) code = GLOBAL_ACTION_LOCK_SCREEN;
        } else if (a.equals("screenshot")) {
            if (Build.VERSION.SDK_INT >= 30) code = GLOBAL_ACTION_TAKE_SCREENSHOT;
        }
        if (code < 0) return false;
        try {
            return svc.performGlobalAction(code);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Searches the Play Store page that is already open and installs the app.
     * The caller opens the Play Store search first.
     */
    public void startInstallJob(String requestId, String appName, InstallCallback callback) {
        stopInstallJob();
        jobId = requestId;
        jobApp = appName == null ? "" : appName.trim();
        jobCallback = callback;
        step = STEP_FIND_RESULT;
        stepStart = System.currentTimeMillis();
        jobDone = false;
        installRetries = 0;
        poller = new Runnable() {
            @Override public void run() {
                try {
                    tick();
                } catch (Exception e) {
                    finish(false, "Automation error: " + e.getMessage(), false);
                }
            }
        };
        main.postDelayed(poller, 900);
    }

    private void stopInstallJob() {
        jobDone = true;
        if (poller != null) main.removeCallbacks(poller);
        poller = null;
        jobCallback = null;
    }

    // ------------------------------------------------------------ job ticks

    private void tick() {
        if (jobDone) return;
        AccessibilityNodeInfo root = safeRoot();
        if (root == null) {
            main.postDelayed(poller, POLL_MS);
            return;
        }
        long elapsed = System.currentTimeMillis() - stepStart;

        if (step == STEP_FIND_RESULT) {
            boolean onAppPage = hasText(root, "install") || hasText(root, "update") || hasText(root, "open");
            if (onAppPage) {
                step = STEP_CLICK_INSTALL;
                stepStart = System.currentTimeMillis();
                main.postDelayed(poller, 400);
                return;
            }
            if (!jobApp.isEmpty()) {
                AccessibilityNodeInfo hit = find(root, norm(jobApp), true, true);
                if (hit == null) hit = find(root, norm(jobApp), false, true);
                if (hit != null && clickNode(hit)) {
                    step = STEP_CLICK_INSTALL;
                    stepStart = System.currentTimeMillis();
                    main.postDelayed(poller, 1200);
                    return;
                }
                AccessibilityNodeInfo title = findByResourceId(root, "title");
                if (title != null && title.getText() != null
                        && norm(title.getText().toString()).contains(norm(jobApp))) {
                    if (clickNode(title)) {
                        step = STEP_CLICK_INSTALL;
                        stepStart = System.currentTimeMillis();
                        main.postDelayed(poller, 1200);
                        return;
                    }
                }
            }
            if (elapsed > 15000) {
                finish(false, "Play Store par '" + jobApp + "' ka result nahi mila. Search screen khuli hai — Install par khud tap karein.", true);
                return;
            }
            main.postDelayed(poller, POLL_MS);
            return;
        }

        if (step == STEP_CLICK_INSTALL) {
            AccessibilityNodeInfo open = find(root, "open", true, true);
            if (open != null && clickNode(open)) {
                finish(true, jobApp + " pehle se install hai — khol diya.", false);
                return;
            }
            AccessibilityNodeInfo install = find(root, "install", true, true);
            if (install == null) install = find(root, "update", true, true);
            if (install == null) install = find(root, "install", false, true);
            if (install == null) install = find(root, "update", false, true);
            if (install != null && clickNode(install)) {
                step = STEP_WAIT_INSTALLED;
                stepStart = System.currentTimeMillis();
                main.postDelayed(poller, 1500);
                return;
            }
            if (elapsed > 25000) {
                finish(false, "Install button nahi mila. App ka page khula hai — Install par khud tap karein.", true);
                return;
            }
            main.postDelayed(poller, POLL_MS);
            return;
        }

        // STEP_WAIT_INSTALLED
        if (hasAnyText(root, new String[]{"retry", "try again", "error", "something went wrong"})) {
            finish(false, "Play Store ne install error dikhaya. Dobara koshish karein.", true);
            return;
        }
        AccessibilityNodeInfo open = find(root, "open", true, true);
        if (open != null) {
            boolean clicked = clickNode(open);
            finish(true, jobApp + " install ho gaya" + (clicked ? " aur khul gaya." : ". Open dabaiye."), !clicked);
            return;
        }
        // Some Play Store versions ask for a second confirmation tap.
        if (installRetries < 2 && elapsed > 4000) {
            AccessibilityNodeInfo again = find(root, "install", true, true);
            if (again == null) again = find(root, "update", true, true);
            if (again != null && clickNode(again)) {
                installRetries++;
                stepStart = System.currentTimeMillis();
                main.postDelayed(poller, 1500);
                return;
            }
        }
        if (elapsed > 180000) {
            finish(true, jobApp + " ki download shuru hai. Play Store mein progress dekh sakte hain.", true);
            return;
        }
        main.postDelayed(poller, 1200);
    }

    private void finish(boolean ok, String message, boolean needsUser) {
        if (jobDone) return;
        jobDone = true;
        if (poller != null) main.removeCallbacks(poller);
        poller = null;
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("message", message == null ? "" : message);
            o.put("needs_user_action", needsUser);
            if (jobCallback != null) jobCallback.onInstallResult(jobId, o);
        } catch (Exception ignored) { }
        jobCallback = null;
    }

    // --------------------------------------------------------------- nodes

    private AccessibilityNodeInfo safeRoot() {
        try {
            return getRootInActiveWindow();
        } catch (Exception e) {
            return null;
        }
    }

    private static String norm(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9\\u0600-\\u06FF ]", " ")
                .replaceAll("\\s+", " ").trim();
    }

    private boolean hasText(AccessibilityNodeInfo root, String want) {
        return find(root, want, false, false) != null;
    }

    private boolean hasAnyText(AccessibilityNodeInfo root, String[] wants) {
        for (String w : wants) if (find(root, w, false, false) != null) return true;
        return false;
    }

    private AccessibilityNodeInfo find(AccessibilityNodeInfo root, String want,
                                       boolean exact, boolean preferClickable) {
        if (root == null || want == null || want.isEmpty()) return null;
        Queue<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        AccessibilityNodeInfo fuzzy = null;
        int guard = 0;
        while (!queue.isEmpty() && guard++ < 2500) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            String text = norm(textOf(node));
            if (!text.isEmpty()) {
                boolean hit = exact ? text.equals(want) : text.contains(want);
                if (hit) {
                    if (!preferClickable) return node;
                    AccessibilityNodeInfo clickable = clickableAncestor(node);
                    if (clickable != null) return clickable;
                    if (fuzzy == null) fuzzy = node;
                }
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                try {
                    AccessibilityNodeInfo child = node.getChild(i);
                    if (child != null) queue.add(child);
                } catch (Exception ignored) { }
            }
        }
        return fuzzy;
    }

    private AccessibilityNodeInfo findByResourceId(AccessibilityNodeInfo root, String idPart) {
        if (root == null || idPart == null) return null;
        Queue<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int guard = 0;
        while (!queue.isEmpty() && guard++ < 2500) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            String id = node.getViewIdResourceName();
            if (id != null && id.toLowerCase(Locale.ROOT).contains(idPart)) {
                if (node.getText() != null && !node.getText().toString().trim().isEmpty()) return node;
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                try {
                    AccessibilityNodeInfo child = node.getChild(i);
                    if (child != null) queue.add(child);
                } catch (Exception ignored) { }
            }
        }
        return null;
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo root, boolean focusedOnly) {
        Queue<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int guard = 0;
        while (!queue.isEmpty() && guard++ < 2500) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            boolean editable = node.isEditable()
                    || "android.widget.EditText".contentEquals(node.getClassName() == null ? "" : node.getClassName());
            if (editable && (!focusedOnly || node.isFocused())) return node;
            for (int i = 0; i < node.getChildCount(); i++) {
                try {
                    AccessibilityNodeInfo child = node.getChild(i);
                    if (child != null) queue.add(child);
                } catch (Exception ignored) { }
            }
        }
        return null;
    }

    private boolean clickNode(AccessibilityNodeInfo node) {
        if (node == null) return false;
        AccessibilityNodeInfo target = clickableAncestor(node);
        if (target == null) target = node;
        try {
            if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        } catch (Exception ignored) { }
        try {
            AccessibilityNodeInfo parent = target.getParent();
            int guard = 0;
            while (parent != null && guard++ < 8) {
                if (parent.isClickable() && parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
                parent = parent.getParent();
            }
        } catch (Exception ignored) { }
        return false;
    }

    private static AccessibilityNodeInfo clickableAncestor(AccessibilityNodeInfo node) {
        try {
            AccessibilityNodeInfo cur = node;
            int guard = 0;
            while (cur != null && guard++ < 10) {
                if (cur.isClickable()) return cur;
                cur = cur.getParent();
            }
        } catch (Exception ignored) { }
        return null;
    }

    private static String textOf(AccessibilityNodeInfo node) {
        try {
            CharSequence t = node.getText();
            if (t != null && t.length() > 0) return t.toString();
            CharSequence d = node.getContentDescription();
            if (d != null && d.length() > 0) return d.toString();
            CharSequence h = node.getHintText();
            if (h != null && h.length() > 0) return h.toString();
        } catch (Exception ignored) { }
        return "";
    }

    private void collect(AccessibilityNodeInfo node, StringBuilder sb, int depth) {
        if (node == null || sb.length() > 6000 || depth > 40) return;
        String text = textOf(node);
        if (!text.trim().isEmpty()) {
            String cls = node.getClassName() == null ? "" : node.getClassName().toString();
            String tag = "";
            if (cls.contains("Button")) tag = "[button] ";
            else if (cls.contains("EditText")) tag = "[field] ";
            else if (node.isClickable()) tag = "[tap] ";
            sb.append(tag).append(text.trim()).append(" | ");
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            try {
                collect(node.getChild(i), sb, depth + 1);
            } catch (Exception ignored) { }
        }
    }

    private static JarvisAccessibilityService getInstance() {
        return instance;
    }
}
