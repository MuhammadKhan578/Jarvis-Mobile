package com.jarvis.mobile;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    public static final int REQ_MIC = 1001;
    public static final int REQ_CAMERA = 1002;
    public static final int REQ_NOTIF = 1003;

    private WebView web;
    private JsBridge bridge;
    private TtsEngine tts;
    private SpeechEngine speech;
    private String pendingCmd = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        pendingCmd = getIntent() == null ? null : getIntent().getStringExtra("cmd");

        try {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        } catch (Exception ignored) { }

        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#050B12"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " JarvisMobile/1.0");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(
                        "console.log('JARVIS_SELFTEST '+(window.__jarvisSelfTest?window.__jarvisSelfTest():'no-selftest'))",
                        null);
                if (pendingCmd != null && !pendingCmd.isEmpty()) {
                    String cmd = pendingCmd;
                    pendingCmd = null;
                    view.evaluateJavascript(
                            "window.jarvisDebugCommand&&window.jarvisDebugCommand(" + org.json.JSONObject.quote(cmd) + ")",
                            null);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("JarvisWeb", m.message() + "  @" + m.lineNumber());
                return true;
            }
        });

        tts = new TtsEngine(this);
        speech = new SpeechEngine(this);
        bridge = new JsBridge(this, web, tts, speech);
        speech.setListener(bridge);

        web.addJavascriptInterface(bridge, "Android");
        applyInsets(web);
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");

        startBackgroundIfEnabled();
        askNotificationPermission();
    }

    /** Keeps Jarvis listening after the user leaves the app. */
    private void startBackgroundIfEnabled() {
        try {
            if (JarvisService.isEnabled(this)) JarvisService.start(this);
        } catch (Exception ignored) { }
    }

    private void askNotificationPermission() {
        try {
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
            }
        } catch (Exception ignored) { }
    }

    private void applyInsets(View view) {
        view.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = 0, bottom = 0;
            try {
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets status = insets.getInsets(WindowInsets.Type.statusBars());
                    android.graphics.Insets nav = insets.getInsets(WindowInsets.Type.navigationBars());
                    android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    android.graphics.Insets cut = insets.getInsets(WindowInsets.Type.displayCutout());
                    top = Math.max(status.top, cut.top);
                    bottom = Math.max(Math.max(nav.bottom, ime.bottom), cut.bottom);
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                    if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                        top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                    }
                }
            } catch (Exception ignored) { }
            v.setPadding(0, top, 0, bottom);
            return insets;
        });
        view.requestApplyInsets();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null || web == null) return;
        String cmd = intent.getStringExtra("cmd");
        if (cmd != null && !cmd.isEmpty()) {
            web.evaluateJavascript(
                    "window.jarvisDebugCommand&&window.jarvisDebugCommand(" + org.json.JSONObject.quote(cmd) + ")",
                    null);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean granted = results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_MIC) {
            if (bridge != null) bridge.onPermissionResult("mic", granted);
        } else if (requestCode == REQ_CAMERA) {
            if (bridge != null) bridge.onPermissionResult("camera", granted);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Do NOT cancel the microphone or the voice here: the whole point of
        // background mode is that Jarvis keeps listening and finishes talking
        // while the user is in another app or the screen is off.
        if (web != null) web.evaluateJavascript("window.jarvisNative&&jarvisNative.onAppPause()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        startBackgroundIfEnabled();
        if (web != null) web.evaluateJavascript("window.jarvisNative&&jarvisNative.onAppResume()", null);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.jarvisNative&&jarvisNative.onBack)?jarvisNative.onBack():false",
                value -> {
                    if (value == null || !value.contains("true")) {
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onDestroy() {
        try { if (speech != null) speech.destroy(); } catch (Exception ignored) { }
        try { if (tts != null) tts.shutdown(); } catch (Exception ignored) { }
        try { if (web != null) { web.removeJavascriptInterface("Android"); web.destroy(); } } catch (Exception ignored) { }
        super.onDestroy();
    }
}
