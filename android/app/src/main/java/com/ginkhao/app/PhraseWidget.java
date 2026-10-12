package com.ginkhao.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: a phrase of the day. The web app hands over a week of phrases
 * (Updater.setWidget), so the widget moves on to the next one each day without the app open.
 * Tap the phrase to open Gin Khao; tap play to hear it.
 */
public class PhraseWidget extends AppWidgetProvider {

    static final String PLAY = "com.ginkhao.app.WIDGET_PLAY";
    static final String KEY = "widgetItems";

    static void refresh(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, PhraseWidget.class));
        if (ids.length > 0) new PhraseWidget().onUpdate(ctx, m, ids);
    }

    /** Today's entry, or the latest one before today, or the first. */
    private static JSONObject pick(Context ctx) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(UpdaterPlugin.PREFS, Context.MODE_PRIVATE);
            JSONArray a = new JSONArray(p.getString(KEY, "[]"));
            if (a.length() == 0) return null;
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            JSONObject best = a.getJSONObject(0);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                if (o.optString("date").compareTo(today) <= 0) best = o;
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    private static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        JSONObject o = pick(ctx);
        for (int wid : widgetIds) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_phrase);
            if (o != null) {
                v.setTextViewText(R.id.w_th, o.optString("th"));
                v.setTextViewText(R.id.w_rom, o.optString("rom"));
                v.setTextViewText(R.id.w_en, o.optString("en"));
            } else {
                v.setTextViewText(R.id.w_th, "กินข้าว");
                v.setTextViewText(R.id.w_rom, "gin kâao");
                v.setTextViewText(R.id.w_en, "Open Gin Khao to start");
            }
            Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("ginkhao://today"), ctx, MainActivity.class);
            v.setOnClickPendingIntent(R.id.w_body, PendingIntent.getActivity(ctx, 11, open, flags()));
            Intent play = new Intent(ctx, PhraseWidget.class).setAction(PLAY);
            if (o != null) play.putExtra("id", o.optString("id"));
            v.setOnClickPendingIntent(R.id.w_play, PendingIntent.getBroadcast(ctx, 12, play, flags()));
            mgr.updateAppWidget(wid, v);
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (!PLAY.equals(intent.getAction())) return;
        String id = intent.getStringExtra("id");
        if (id == null || id.isEmpty() || id.contains("/")) return;
        File f = new File(ctx.getFilesDir(), "content/audio/" + id + ".mp3");
        if (!f.exists()) return;
        final PendingResult done = goAsync();
        try {
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
            mp.setDataSource(f.getAbsolutePath());
            mp.setOnCompletionListener(p -> { p.release(); done.finish(); });
            mp.setOnErrorListener((p, w, e) -> { p.release(); done.finish(); return true; });
            mp.prepare();
            mp.start();
        } catch (Exception e) {
            done.finish();
        }
    }
}
