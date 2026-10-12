// Update state (web builds and APKs) shared by the banner and Settings > App updates.
import { useEffect, useState } from 'preact/hooks';
import { APP_VERSION, WEB_BUILD } from './config';
import { L } from './data';
import { Icon } from './ui/icons';
import { applyWeb, checkApk, installApk, native, nativeInfo, prepareWeb, Updater, type ApkLatest, type NativeInfo } from './updater';

interface UpdState { info: NativeInfo | null; apk: ApkLatest | null; webReady: number | null; checking: boolean; error: string }
let st: UpdState = { info: null, apk: null, webReady: null, checking: false, error: '' };
const subs = new Set<() => void>();
const set = (patch: Partial<UpdState>) => { st = { ...st, ...patch }; subs.forEach(f => f()); };

function useUpd(): UpdState {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(x => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return st;
}

export async function checkUpdates() {
  const info = await nativeInfo();
  set({ info });
  if (!info) return;
  set({ checking: true, error: '' });
  try {
    set({ apk: await checkApk(info) });
    set({ webReady: await prepareWeb(info) });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
  set({ checking: false });
}

export function UpdateBanner() {
  const u = useUpd();
  const [busy, setBusy] = useState(false);
  if (!u.webReady) return null;
  return (
    <div class="update-banner">
      <Icon name="sparkle" size={20} />
      <span><b>Update ready.</b> A new version of Gin Khao is downloaded.</span>
      <button class="btn primary sm" disabled={busy} onClick={() => { setBusy(true); applyWeb(u.webReady!).catch(() => setBusy(false)); }}>
        {busy ? 'Restarting…' : 'Restart'}
      </button>
    </div>
  );
}

export function AppUpdates() {
  const u = useUpd();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (u.info?.status) setStatus(u.info.status); }, [u.info]);
  useEffect(() => {
    if (!native) return;
    const h = Updater.addListener('apkStatus', s => { setStatus(s.message); setBusy(s.busy); });
    return () => { h.then(x => x.remove()); };
  }, []);
  return (
    <div class="settings-group">
      {u.info && !u.apk && !u.checking && !u.error && <p class="muted">The app is up to date.</p>}
      {u.apk && (
        <div class="apk-new">
          <b>New app version {u.apk.name}</b>
          {u.apk.notes && <span class="muted">{u.apk.notes}</span>}
          <button class="btn primary" disabled={busy} onClick={() => { setBusy(true); installApk(u.apk!).catch(e => { setStatus(String(e)); setBusy(false); }); }}>
            {busy ? 'Working…' : 'Update app'}
          </button>
        </div>
      )}
      {status && <p class="muted">{status}</p>}
      {u.info?.webReverted && <p class="bad">The last update didn't start, so Gin Khao went back to the built-in version.</p>}
      {u.error && <p class="bad">Couldn't check for updates: {u.error}</p>}
      <dl class="versions">
        <dt>App</dt><dd>{u.info ? `${u.info.versionName} (${u.info.versionCode})` : APP_VERSION}</dd>
        <dt>Web build</dt><dd>{WEB_BUILD || 'dev'}</dd>
        <dt>Content</dt><dd>{L().version}</dd>
      </dl>
      <button class="btn ghost" onClick={checkUpdates} disabled={u.checking}>{u.checking ? 'Checking…' : 'Check now'}</button>
    </div>
  );
}
