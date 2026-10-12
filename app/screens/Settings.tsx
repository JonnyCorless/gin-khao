import { useState } from 'preact/hooks';
import { C, item } from '../data';
import { askPermission, scheduleReminders } from '../reminders';
import { learnedCount } from '../srs';
import { exportBackup, importBackup, resetProgress, update, useProgress } from '../store';
import { AppUpdates } from '../updates';
import { openLink } from '../ui/ShowOverlay';
import { SpeakCheck } from '../ui/Speak';

function Toggle({ id, on, onChange, label, hint }: { id: string; on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label class="toggle-row" for={id}>
      <span><b>{label}</b>{hint && <span class="muted small">{hint}</span>}</span>
      <input id={id} type="checkbox" role="switch" checked={on} onChange={e => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

export function Settings() {
  const p = useProgress();
  const [msg, setMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const hello = item('hello');

  const setReminder = async (on: boolean) => {
    if (on && !(await askPermission())) { setMsg('Notifications are blocked. Allow them for Gin Khao in Android settings.'); }
    update(x => { x.settings = { ...x.settings, reminderOn: on }; });
    scheduleReminders();
  };

  return (
    <div class="screen">
      <header class="screen-head"><h1>Settings</h1></header>

      <section class="block">
        <h3>Daily reminder</h3>
        <div class="settings-group">
          <Toggle id="rem-on" on={p.settings.reminderOn} onChange={setReminder} label="Remind me" hint="Once a day, only if today's session isn't done." />
          {p.settings.reminderOn && (
            <label class="toggle-row" for="rem-time">
              <span><b>Time</b><span class="muted small">Before your 2pm shift works well.</span></span>
              <input id="rem-time" type="time" value={p.settings.reminderTime}
                onChange={e => { update(x => { x.settings = { ...x.settings, reminderTime: (e.target as HTMLInputElement).value || '11:00' }; }); scheduleReminders(); }} />
            </label>
          )}
          {msg && <p class="bad small">{msg}</p>}
        </div>
      </section>

      <section class="block">
        <h3>Lessons</h3>
        <div class="settings-group">
          <Toggle id="hearts" on={p.settings.hearts} onChange={v => update(x => { x.settings = { ...x.settings, hearts: v }; })} label="Hearts" hint="Lose one per mistake in lessons. One comes back every 30 minutes." />
        </div>
      </section>

      <section class="block">
        <h3>Speaking check</h3>
        <div class="settings-group">
          <p class="muted">Say <b lang="th">สวัสดีครับ</b> (sà-wàt-dee káp) to test the microphone.</p>
          {hello && <SpeakCheck it={hello} />}
        </div>
      </section>

      <section class="block">
        <h3>Backup</h3>
        <div class="settings-group">
          <p class="muted">Your progress lives on this phone. Save a backup file to Drive or send it to yourself, so a new phone can pick up where you left off.</p>
          <div class="row">
            <button class="btn ghost" onClick={async () => setMsg(await exportBackup())}>Save backup</button>
            <label class="btn ghost" for="import">Restore backup</label>
            <input id="import" type="file" accept="application/json,.json" hidden onChange={async e => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              const err = importBackup(await f.text());
              setMsg(err ?? 'Backup restored.');
            }} />
          </div>
          {msg && <p class="muted small">{msg}</p>}
        </div>
      </section>

      <section class="block">
        <h3>Start over</h3>
        <div class="settings-group">
          <p class="muted">Clears everything you've learned, your streak and today's session, so Gin Khao starts again from the first phrase. Your reminder, pinned cards and address stay.</p>
          {resetDone ? (
            <p class="good-text">Done. Go to Today to start from the beginning.</p>
          ) : confirmReset ? (
            <div class="row">
              <button class="btn danger" onClick={() => { resetProgress(); setConfirmReset(false); setResetDone(true); }}>Yes, start over</button>
              <button class="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button class="btn ghost" onClick={() => { setConfirmReset(true); setResetDone(false); }}>Start over…</button>
          )}
        </div>
      </section>

      <section class="block">
        <h3>App updates</h3>
        <AppUpdates />
      </section>

      <section class="block">
        <h3>About</h3>
        <div class="settings-group">
          <p class="muted">{learnedCount()} of {C().phrases.length} phrases learned. Thai audio is a neural voice in standard Central Thai, so it works in Bangkok too.</p>
          <p class="muted">No Thai speaker has checked every phrase. If a local corrects you, use "Report this phrase" in Show mode, or:</p>
          <button class="btn ghost" onClick={() => openLink('https://github.com/JonnyCorless/gin-khao/issues/new?title=Phrase%20check')}>Report a problem</button>
        </div>
      </section>
    </div>
  );
}
