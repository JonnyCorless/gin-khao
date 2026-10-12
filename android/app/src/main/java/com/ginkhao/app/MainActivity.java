package com.ginkhao.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.plugin.WebView;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdaterPlugin.class);
        guardWebUpdate();
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
        super.onNewIntent(intent);
        handle(intent);
    }

    private void handle(Intent i) {
        if (i != null && UpdaterPlugin.APK_DONE.equals(i.getAction()) && UpdaterPlugin.instance != null) {
            UpdaterPlugin.instance.handleStatus(i);
        }
    }
}
