import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { loadContent, type Loaded, type Phrase } from './sync';
import { APP_VERSION, WEB_BUILD } from './config';
import { applyWeb, checkApk, confirmBoot, installApk, native, nativeInfo, prepareWeb, Updater, type ApkLatest, type NativeInfo } from './updater';
import './styles.css';

function PhraseCard({ p, url }: { p: Phrase; url: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const play = (rate: number) => {
    if (!audio.current) {
      audio.current = new Audio(url);
      audio.current.onended = () => setPlaying(false);
    }
    const a = audio.current;
    a.pause();
    a.currentTime = 0;
    a.playbackRate = rate;
    setPlaying(true);
    a.play().catch(() => setPlaying(false));
  };
  return (
    <article class="card">
      <div class="card-text">
        <div class="th" lang="th">{p.th}</div>
        <div class="rom">{p.rom}</div>
        <div class="en">{p.en}</div>
      </div>
      <div class="card-acts">
        <button class={`play${playing ? ' on' : ''}`} onClick={() => play(1)} aria-label={`Play: ${p.en}`}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
        </button>
        <button class="slow" onClick={() => play(0.7)}>slow</button>
      </div>
    </article>
  );
}

type MicState = { status: 'idle' | 'listening' | 'done' | 'error'; text: string };

function MicTest() {
  const [s, setS] = useState<MicState>({ status: 'idle', text: '' });
  const native = Capacitor.isNativePlatform();
  const run = async () => {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) throw new Error('Speech recognition is not available. Install or update the Google app, then try again.');
      const perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== 'granted') throw new Error('Microphone permission was not granted.');
      setS({ status: 'listening', text: '' });
      const r = await SpeechRecognition.start({ language: 'th-TH', maxResults: 5, prompt: 'พูดว่า สวัสดีครับ', partialResults: false, popup: true });
      const matches = r.matches ?? [];
      setS({ status: 'done', text: matches.length ? matches.join('  ·  ') : 'Nothing heard. Try again, a bit closer to the phone.' });
    } catch (e) {
      setS({ status: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section class="panel">
      <div class="eyebrow">Phase 0 check</div>
      <h2>Thai speech recognition</h2>
      <p class="muted">Tap the button and say <b lang="th">สวัสดีครับ</b> (sà-wàt-dee káp). If Thai text comes back, speaking practice will work on this phone.</p>
      <button class="primary" onClick={run} disabled={!native || s.status === 'listening'}>
        {native ? (s.status === 'listening' ? 'Listening…' : 'Test the mic') : 'Only works in the installed app'}
      </button>
      {s.text && <p class={s.status === 'error' ? 'bad' : 'good'} lang="th">{s.text}</p>}
    </section>
  );
}

function UpdateBanner({ build }: { build: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <section class="banner">
      <div>
        <b>Update ready</b>
        <div class="muted">New version of Gin Khao downloaded (build {build}).</div>
      </div>
      <button class="primary" disabled={busy} onClick={() => { setBusy(true); applyWeb(build).catch(() => setBusy(false)); }}>
        {busy ? 'Restarting…' : 'Restart now'}
      </button>
    </section>
  );
}

function AppUpdates({ info, apk, contentVersion, check, checking, error }: {
  info: NativeInfo | null; apk: ApkLatest | null; contentVersion?: string; check: () => void; checking: boolean; error: string;
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (info?.status) setStatus(info.status);
  }, [info]);
  useEffect(() => {
    if (!native) return;
    const h = Updater.addListener('apkStatus', s => { setStatus(s.message); setBusy(s.busy); });
    return () => { h.then(x => x.remove()); };
  }, []);
  return (
    <section class="panel">
      <div class="eyebrow">Settings</div>
      <h2>App updates</h2>
      {info && !apk && !checking && !error && <p class="muted">The app is up to date.</p>}
      {apk && (
        <div class="apk-new">
          <b>New app version {apk.name}</b>
          {apk.notes && <div class="muted">{apk.notes}</div>}
          <button class="primary" disabled={busy} onClick={() => { setBusy(true); installApk(apk).catch(e => { setStatus(String(e)); setBusy(false); }); }}>
            {busy ? 'Working…' : 'Update app'}
          </button>
        </div>
      )}
      {status && <p class="muted">{status}</p>}
      {info?.webReverted && <p class="bad">The last update didn't start, so Gin Khao went back to the built-in version.</p>}
      {error && <p class="bad">Couldn't check for updates: {error}</p>}
      <dl class="versions">
        <dt>App</dt><dd>{info ? `${info.versionName} (${info.versionCode})` : APP_VERSION}</dd>
        <dt>Web build</dt><dd>{WEB_BUILD || 'dev'}</dd>
        <dt>Content</dt><dd>{contentVersion ?? '…'}</dd>
      </dl>
      <button class="ghost" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check now'}</button>
    </section>
  );
}

function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [apk, setApk] = useState<ApkLatest | null>(null);
  const [webReady, setWebReady] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [updErr, setUpdErr] = useState('');

  const checkUpdates = async () => {
    const ni = await nativeInfo();
    setInfo(ni);
    if (!ni) return;
    setChecking(true);
    setUpdErr('');
    try {
      setApk(await checkApk(ni));
      setWebReady(await prepareWeb(ni));
    } catch (e) {
      setUpdErr(e instanceof Error ? e.message : String(e));
    }
    setChecking(false);
  };

  useEffect(() => {
    confirmBoot();
    loadContent().then(setData).catch(e => setFailed(String(e)));
    checkUpdates();
  }, []);

  const sourceLabel = { synced: 'Up to date from GitHub', cached: 'Offline: using saved content', bundled: 'Offline: using built-in content' };

  return (
    <main class="wrap">
      {webReady && <UpdateBanner build={webReady} />}
      <header class="hero">
        <div class="mark" lang="th">กินข้าว</div>
        <h1>Gin Khao</h1>
        <p class="muted">Thai for daily life in Chiang Mai</p>      </header>

      <section class="status">
        {failed && <span class="bad">Couldn't load content: {failed}</span>}
        {!data && !failed && <span class="muted">Checking for new content…</span>}
        {data && (
          <>
            <span class={`dot ${data.source}`} aria-hidden="true" />
            <span>{sourceLabel[data.source]}</span>
            <span class="muted mono">content {data.version} · app {APP_VERSION}</span>
          </>
        )}
      </section>

      <section class="list">
        {data?.content.phrases.map(p => <PhraseCard key={p.id} p={p} url={data.audioUrl(p)} />)}
      </section>

      <MicTest />

      <AppUpdates info={info} apk={apk} contentVersion={data?.version} check={checkUpdates} checking={checking} error={updErr} />
    </main>
  );
}

render(<App />, document.getElementById('root')!);
