package com.ginkhao.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app APK updates (same approach as LifeRPG): download the APK named in apk/latest.json,
 * stream it into a PackageInstaller session, and let Android show its "Update" prompt.
 * Android refuses an APK signed with a different key, so a wrong file can't replace the app.
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    static final String APK_DONE = "com.ginkhao.app.APK_DONE";
    static final String PREFS = "ginkhao";
    static UpdaterPlugin instance;
    private volatile boolean busy = false;

    @Override
    public void load() {
        instance = this;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private PackageInfo pkgInfo() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
    }

    @SuppressWarnings("deprecation")
    private long versionCode() {
        try {
            PackageInfo pi = pkgInfo();
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private String versionName() {
        try {
            return pkgInfo().versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        o.put("versionCode", versionCode());
        o.put("versionName", versionName());
        o.put("canInstall", canInstall());
        o.put("busy", busy);
        o.put("status", prefs().getString("apkStatus", ""));
        o.put("webReverted", prefs().getBoolean("webReverted", false));
        call.resolve(o);
    }

    /** Called by the web app once it has started properly, so MainActivity keeps the downloaded update. */
    @PluginMethod
    public void bootOk(PluginCall call) {
        prefs().edit().putInt("bootTries", 0).putBoolean("webReverted", false).apply();
        call.resolve();
    }

    /** The phrase-of-the-day widget: a JSON list of {date, id, th, rom, en} for the coming days. */
    @PluginMethod
    public void setWidget(PluginCall call) {
        String items = call.getString("items", "[]");
        prefs().edit().putString(PhraseWidget.KEY, items).apply();
        PhraseWidget.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No download link");
            return;
        }
        if (busy) {
            call.resolve();
            return;
        }
        if (!canInstall()) {
            say("Turn on Allow from this source for Gin Khao, come back and tap Update app again", false);
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
            } catch (Exception ignored) {}
            call.resolve();
            return;
        }
        busy = true;
        call.resolve();
        new Thread(() -> download(url)).start();
    }

    private void download(String url) {
        PackageInstaller.Session s = null;
        try {
            say("Downloading the new version…", true);
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            if (c.getResponseCode() != 200) throw new Exception("download failed (HTTP " + c.getResponseCode() + ")");
            PackageInstaller pi = getContext().getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            sp.setAppPackageName(getContext().getPackageName());
            s = pi.openSession(pi.createSession(sp));
            InputStream in = c.getInputStream();
            OutputStream out = s.openWrite("app.apk", 0, -1);
            byte[] buf = new byte[65536];
            int n;
            long tot = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                tot += n;
                if (tot > 150_000_000L) throw new Exception("file too big");
            }
            s.fsync(out);
            out.close();
            in.close();
            if (tot < 100_000) throw new Exception("the download looks wrong (" + tot + " bytes)");
            Intent back = new Intent(getContext(), MainActivity.class).setAction(APK_DONE).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getActivity(getContext(), 7, back, fl).getIntentSender());
            s.close();
            s = null;
            say("Downloaded. Tap Update on Android's prompt", false);
        } catch (Exception e) {
            if (s != null) try { s.abandon(); } catch (Exception ignored) {}
            say("Update failed: " + e.getMessage(), false);
        }
        busy = false;
    }

    /** The installer reports back here: show Android's confirm prompt, or say how it went. */
    @SuppressWarnings("deprecation")
    void handleStatus(Intent i) {
        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
        if (st == -999) return;
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent ask = (Intent) i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (ask != null) try {
                getActivity().startActivity(ask);
                return;
            } catch (Exception ignored) {}
            say("Couldn't open Android's install prompt", false);
            return;
        }
        if (st == PackageInstaller.STATUS_SUCCESS) {
            say("Updated to " + versionName(), false);
            return;
        }
        String m = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        say(st == PackageInstaller.STATUS_FAILURE_ABORTED ? "Update cancelled" : "Install didn't finish" + (m != null ? ": " + m : ""), false);
    }

    private void say(String msg, boolean isBusy) {
        prefs().edit().putString("apkStatus", msg).apply();
        JSObject o = new JSObject();
        o.put("message", msg);
        o.put("busy", isBusy);
        notifyListeners("apkStatus", o, true);
    }
}
