package com.jarvis.mobile;

import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Locale;
import java.util.Queue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/**
 * Real screen highlight overlay.
 *
 * Draws an actual WindowManager view above other apps (TYPE_APPLICATION_OVERLAY,
 * API 26+) at screen bounds supplied by AccessibilityNodeInfo. If Android has
 * not granted "Display over other apps", nothing is drawn and the returned JSON
 * says so instead of pretending a highlight exists.
 */
public final class OverlayGuide {

    private static final int OVERLAY_COLOR = 0xAA7C3CFF;  // translucent purple
    private static final int BORDER_COLOR = 0xFFFF3B6B;   // red border

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private static volatile OverlayGuide instance;

    private WindowManager wm;
    private View highlight;
    private volatile boolean shown;
    private volatile int lastX, lastY, lastW, lastH;
    private volatile String lastLabel = "";

    public OverlayGuide(Context context) {
        this.app = context.getApplicationContext();
    }

    public static OverlayGuide get(Context context) {
        OverlayGuide g = instance;
        if (g == null) {
            synchronized (OverlayGuide.class) {
                g = instance;
                if (g == null) { g = new OverlayGuide(context); instance = g; }
            }
        }
        return g;
    }

    /** True only when Android really allows this app to draw over other apps. */
    public static boolean canDraw(Context context) {
        try { return Settings.canDrawOverlays(context); }
        catch (Exception e) { return false; }
    }

    public boolean canDraw() {
        return canDraw(app);
    }

    public boolean isShown() {
        return shown && highlight != null;
    }

    // --------------------------------------------------------------- public API

    /** Draws a real highlight at absolute screen coordinates. */
    public String show(int x, int y, int w, int h, String label) {
        if (!canDraw()) return permissionJson();

        final int fx = x, fy = y, fw = w, fh = h;
        final String text = label == null ? "" : label.trim();
        if (fw < 4 || fh < 4) {
            return result(false, "Highlight ke liye sahi screen bounds (x, y, width, height) chahiye.", false);
        }

        FutureTask<String> task = new FutureTask<>(() -> {
            try {
                if (highlight != null) {
                    try { windowManager().removeView(highlight); } catch (Exception ignored) { }
                    highlight = null;
                    shown = false;
                }
                WindowManager manager = windowManager();
                if (manager == null) {
                    return result(false, "WindowManager available nahi hai.", false);
                }
                HighlightView view = new HighlightView(app, text);
                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        Math.max(4, fw), Math.max(4, fh),
                        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        PixelFormat.TRANSLUCENT);
                params.gravity = Gravity.TOP | Gravity.START;
                params.x = fx;
                params.y = fy;
                manager.addView(view, params);
                highlight = view;
                shown = true;
                lastX = fx; lastY = fy; lastW = fw; lastH = fh; lastLabel = text;
                return result(true, "Screen par highlight dikh diya.", false);
            } catch (SecurityException e) {
                shown = false;
                return permissionJson();
            } catch (Exception e) {
                shown = false;
                return result(false, "Highlight draw nahi hua: " + e.getMessage(), false);
            }
        });
        return onMain(task);
    }

    /** Removes the real overlay view. Returns ok:false only if removal really failed. */
    public String hide() {
        FutureTask<String> task = new FutureTask<>(() -> {
            if (highlight == null) {
                shown = false;
                return result(true, "Koi highlight chal raha tha nahi.", false);
            }
            try {
                View old = highlight;
                highlight = null;
                shown = false;
                windowManager().removeView(old);
                return result(true, "Highlight hata diya.", false);
            } catch (Exception e) {
                return result(false, "Highlight hata nahi paya: " + e.getMessage(), false);
            }
        });
        return onMain(task);
    }

    public String status() {
        try {
            JSONObject o = new JSONObject();
            boolean allowed = canDraw();
            o.put("ok", true);
            o.put("canDraw", allowed);
            o.put("shown", isShown());
            o.put("permission", allowed ? "granted" : "needed");
            o.put("x", lastX); o.put("y", lastY);
            o.put("width", lastW); o.put("height", lastH);
            o.put("label", lastLabel);
            if (!allowed) {
                o.put("needs_user_action", true);
                o.put("message", "Display over other apps permission needed.");
                o.put("intent", permissionIntentJson());
                o.put("intent_action", Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            } else {
                o.put("needs_user_action", false);
                o.put("message", isShown() ? "Highlight screen par hai." : "Abhi koi highlight nahi hai.");
            }
            return o.toString();
        } catch (Exception e) {
            return result(false, "Overlay status nahi mila.", false);
        }
    }

    /** Opens the real Android "Display over other apps" settings screen. */
    public String openSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + app.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            app.startActivity(i);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("needs_user_action", true);
            o.put("permission", canDraw() ? "granted" : "needed");
            o.put("intent_action", Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            o.put("message", "Display over other apps settings khul gayi. Jarvis ko allow karein.");
            return o.toString();
        } catch (Exception e) {
            return result(false, "Overlay settings nahi khul sakin: " + e.getMessage(), true);
        }
    }

    /**
     * Finds a visible UI element by its text/content-description and highlights
     * its REAL accessibility bounds. Requires the accessibility service.
     */
    public String highlightText(String label) {
        if (!canDraw()) return permissionJson();
        String want = label == null ? "" : label.trim().toLowerCase(Locale.ROOT);
        if (want.isEmpty()) {
            return result(false, "Highlight ke liye button ka naam ya screen bounds do.", false);
        }
        JarvisAccessibilityService svc = JarvisAccessibilityService.instance();
        if (svc == null) {
            return result(false,
                    "Phone automation off hai. Settings > Accessibility > Jarvis Automation on karein, "
                            + "phir 'ye button dikhao' bolein.", true);
        }
        AccessibilityNodeInfo root = svc.getRootInActiveWindow();
        if (root == null) {
            return result(false, "Screen ke bounds abhi available nahi hain. Dobara koshish karein.", false);
        }
        Rect bounds = findBounds(root, want);
        if (bounds == null || bounds.width() < 4 || bounds.height() < 4) {
            return result(false, "Screen par '" + label + "' nahi mila. Exact label bataiye.", false);
        }
        return show(bounds.left, bounds.top, bounds.width(), bounds.height(), label);
    }

    // -------------------------------------------------------------- internal

    private WindowManager windowManager() {
        if (wm == null) wm = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
        return wm;
    }

    private String onMain(FutureTask<String> task) {
        if (Looper.myLooper() == Looper.getMainLooper()) task.run();
        else main.post(task);
        try { return task.get(3, TimeUnit.SECONDS); }
        catch (Exception e) {
            return result(false, "Overlay view main thread par update nahi hua.", false);
        }
    }

    private static Rect findBounds(AccessibilityNodeInfo root, String want) {
        Queue<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        int visited = 0;
        while (!queue.isEmpty() && visited++ < 900) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null) continue;
            String text = node.getText() == null ? "" : node.getText().toString();
            String desc = node.getContentDescription() == null ? "" : node.getContentDescription().toString();
            if (text.toLowerCase(Locale.ROOT).contains(want)
                    || desc.toLowerCase(Locale.ROOT).contains(want)) {
                Rect rect = new Rect();
                node.getBoundsInScreen(rect);
                if (!rect.isEmpty()) return rect;
            }
            for (int i = 0; i < node.getChildCount(); i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return null;
    }

    /** Honest response when the Android overlay permission is missing. */
    public String permissionJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("shown", false);
            o.put("canDraw", false);
            o.put("permission", "needed");
            o.put("needs_user_action", true);
            o.put("message", "Display over other apps permission needed. Jarvis ko yeh izazat do.");
            o.put("intent", permissionIntentJson());
            o.put("intent_action", Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"shown\":false,\"canDraw\":false,\"permission\":\"needed\","
                    + "\"needs_user_action\":true,\"message\":\"Display over other apps permission needed.\"}";
        }
    }

    private JSONObject permissionIntentJson() {
        JSONObject intent = new JSONObject();
        try {
            intent.put("action", Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            intent.put("data", "package:" + app.getPackageName());
        } catch (Exception ignored) { }
        return intent;
    }

    private static String result(boolean ok, String message, boolean needsUser) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("message", message == null ? "" : message);
            o.put("needs_user_action", needsUser);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"message\":\"overlay result error\",\"needs_user_action\":false}";
        }
    }

    /** The actual view added to WindowManager: a purple circle/rounded box + label. */
    private static final class HighlightView extends View {

        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint labelBg = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint labelText = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final String label;

        HighlightView(Context context, String label) {
            super(context);
            this.label = label == null ? "" : label.trim();
            fill.setColor(OVERLAY_COLOR);
            fill.setStyle(Paint.Style.FILL);
            border.setColor(BORDER_COLOR);
            border.setStyle(Paint.Style.STROKE);
            border.setStrokeWidth(6f);
            labelBg.setColor(0xDD4A148C);
            labelBg.setStyle(Paint.Style.FILL);
            labelText.setColor(Color.WHITE);
            labelText.setStyle(Paint.Style.FILL);
            labelText.setFakeBoldText(true);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int w = getWidth();
            int h = getHeight();
            if (w <= 0 || h <= 0) return;
            RectF box = new RectF(4f, 4f, w - 4f, h - 4f);
            float radius = Math.min(w, h) / 2f;
            if (Math.abs(w - h) > Math.min(w, h) * 0.4f) {
                radius = Math.min(32f, Math.min(w, h) / 4f);
            }
            canvas.drawRoundRect(box, radius, radius, fill);
            canvas.drawRoundRect(box, radius, radius, border);

            if (label.isEmpty()) return;
            float size = Math.max(16f, Math.min(28f, Math.min(w, h) / 4f));
            labelText.setTextSize(size);
            float textWidth = labelText.measureText(label);
            float left = Math.max(2f, box.left);
            float top = box.top - size - 10f;
            if (top < 2f) top = Math.min(box.top + 4f, Math.max(2f, h - size - 14f));
            float right = Math.min(w - 2f, left + textWidth + 16f);
            float bottom = Math.min(h - 2f, top + size + 12f);
            canvas.drawRoundRect(new RectF(left, top, right, bottom), 8f, 8f, labelBg);
            canvas.drawText(label, left + 8f, top + size + 3f, labelText);
        }
    }
}
