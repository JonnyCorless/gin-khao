package com.ginkhao.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.plugin.WebView;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdaterPlugin.class);
        guardWebUpdate();
        setIntent(fromShare(getIntent()));
        super.onCreate(savedInstanceState);
        handle(getIntent());
    }

    /**
     * Web code downloaded from GitHub runs from a folder on the phone. The web app calls
     * Updater.bootOk() once it has started; if it fails to start twice in a row,
     * go back to the copy built into the APK (same safety net as LifeRPG).
     */
    private void guardWebUpdate() {
        SharedPreferences p = getSharedPreferences(UpdaterPlugin.PREFS, MODE_PRIVATE);
        SharedPreferences cap = getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, MODE_PRIVATE);
        String path = cap.getString(WebView.CAP_SERVER_PATH, "");
        if (path == null || path.isEmpty()) {
            p.edit().putInt("bootTries", 0).apply();
            return;
        }
        int tries = p.getInt("bootTries", 0) + 1;
        if (tries > 2) {
            cap.edit().putString(WebView.CAP_SERVER_PATH, "").apply();
            p.edit().putInt("bootTries", 0).putBoolean("webReverted", true).apply();
        } else {
            p.edit().putInt("bootTries", tries).apply();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        Intent i = fromShare(intent);
        super.onNewIntent(i);
        handle(i);
    }

    /**
     * Text shared to Gin Khao (from Google Lens, say) becomes a ginkhao://menu link, which the
     * web app opens in the menu checker. Capacitor passes VIEW links on to the web app as it is.
     */
    private Intent fromShare(Intent i) {
        if (i == null || !Intent.ACTION_SEND.equals(i.getAction())) return i;
        CharSequence text = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return i;
        String t = text.toString();
        if (t.length() > 6000) t = t.substring(0, 6000);
        Intent v = new Intent(Intent.ACTION_VIEW, Uri.parse("ginkhao://menu?text=" + Uri.encode(t)), this, MainActivity.class);
        v.addFlags(i.getFlags());
        return v;
    }

    private void handle(Intent i) {
        if (i != null && UpdaterPlugin.APK_DONE.equals(i.getAction()) && UpdaterPlugin.instance != null) {
            UpdaterPlugin.instance.handleStatus(i);
        }
    }
}
