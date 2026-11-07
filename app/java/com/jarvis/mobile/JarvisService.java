package com.jarvis.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps Jarvis alive when the app is not on screen.
 *
 * Android freezes and then kills normal apps as soon as the user switches away.
 * A foreground service with the microphone type is the only supported way to
 * keep listening in the background, so this service:
 *   - shows a permanent "Jarvis online" notification (Android requires it),
 *   - holds a partial wake lock so the speech loop still runs with the screen off,
 *   - tells AudioManager that the mic is in use.
 *
 * The listening loop itself lives in SpeechEngine (native, not JS), because the
 * WebView throttles JavaScript timers once it is hidden.
 */
public class JarvisService extends Service {

    public static final String PREFS = "jarvis_mobile";
    public static final String KEY_ALWAYS_ON = "always_on";

    private static final String CHANNEL_ID = "jarvis_online";
    private static final int NOTIF_ID = 7301;

    private PowerManager.WakeLock wakeLock;

    public static void start(Context context) {
        if (context == null) return;
        try {
            Intent i = new Intent(context.getApplicationContext(), JarvisService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
        } catch (Exception ignored) { }
    }

    public static void stop(Context context) {
        if (context == null) return;
        try { context.stopService(new Intent(context.getApplicationContext(), JarvisService.class)); }
        catch (Exception ignored) { }
    }

    public static boolean isEnabled(Context context) {
        try {
            SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            return p.getBoolean(KEY_ALWAYS_ON, true);
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            try {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Jarvis::listen");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            } catch (Exception ignored) { }
        }
        goForeground();
    }

    private void goForeground() {
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            // Android 14+ blocks a background start of a microphone service.
            // The app itself starts this in the foreground, so this only
            // happens after an OS-initiated restart: stay quiet and stop.
            try { startForeground(NOTIF_ID, n); } catch (Exception ignored) { }
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(this, CHANNEL_ID);
        else b = new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Jarvis online")
                .setContentText("“Hey Jarvis” bolein — background mein sun raha hoon.")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setPriority(Notification.PRIORITY_LOW)
                .setContentIntent(content);
        if (Build.VERSION.SDK_INT >= 21) b.setVisibility(Notification.VISIBILITY_PUBLIC);
        return b.build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Jarvis background", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Jarvis ko background mein online rakhta hai.");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        } catch (Exception ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ALWAYS_ON, false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        goForeground();
        // Do not let Android resurrect a service whose activity (and therefore
        // SpeechEngine) no longer exists — that left a zombie notification.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The activity owns the microphone engine. Once the user swipes the app
        // away there is no recognizer left, so stop the service instead of
        // keeping a dead "Jarvis online" notification behind.
        super.onTaskRemoved(rootIntent);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) { }
        wakeLock = null;
        try { stopForeground(true); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
