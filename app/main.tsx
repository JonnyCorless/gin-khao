import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import '@fontsource-variable/figtree';
import '@fontsource/noto-sans-thai-looped/400.css';
import '@fontsource/noto-sans-thai-looped/600.css';
import '@fontsource/kanit/500.css';
import './styles.css';
import { setLoaded } from './data';
import { onReminderTap, scheduleReminders } from './reminders';
import { Browse } from './screens/Browse';
import { Food, receiveMenu } from './screens/Food';
import { Settings } from './screens/Settings';
import { ShowTab } from './screens/ShowTab';
import { Today } from './screens/Today';
import { initMine } from './mine';
import { flushSave, loadProgress } from './store';
import { loadContent } from './sync';
import { Icon } from './ui/icons';
import { closeShow, ShowOverlay } from './ui/ShowOverlay';
import { closeLab, SpeakLab } from './ui/SpeakLab';
import { checkUpdates, UpdateBanner } from './updates';
import { confirmBoot } from './updater';
import { updateWidget } from './widget';

type Tab = 'today' | 'browse' | 'food' | 'show' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'browse', label: 'Browse', icon: 'browse' },
  { id: 'food', label: 'Food', icon: 'bowl' },
  { id: 'show', label: 'Show', icon: 'show' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const isTab = (s: string): s is Tab => TABS.some(t => t.id === s);
const routeOf = (url: string) => url.replace(/^ginkhao:\/\//, '').split(/[/?#]/)[0];
const paramOf = (url: string, key: string) => { try { return new URL(url.replace(/^ginkhao:/, 'https:')).searchParams.get(key); } catch { return null; } };

function Loading({ done, total, error }: { done: number; total: number; error: string }) {
  return (
    <main class="loading">
      <svg viewBox="0 0 108 108" width="96" height="96" aria-hidden="true" class="logo">
        <circle cx="54" cy="54" r="54" fill="var(--indigo)" />
        <path d="M47 37c-3-4 3-7 0-12M61 37c-3-4 3-7 0-12" stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none" />
        <path d="M35 56c1-10 9-15 19-15s18 5 19 15z" fill="#E2C25A" />
        <path d="M31 56h46c0 14-10 24-23 24S31 70 31 56zM46 79h16l-2 5h-12z" fill="#fff" />
      </svg>
      <div class="loading-th" lang="th">กินข้าว</div>
      {error ? <p class="bad">{error}</p> : <p class="muted">{total > 0 ? `Getting your phrases ready… ${done}/${total}` : 'Opening…'}</p>}
      {total > 0 && !error && <div class="bar"><div style={{ width: `${(done / total) * 100}%` }} /></div>}
    </main>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('today');
  const [openSit, setOpenSit] = useState<string | null>(null);

  const [menuKey, setMenuKey] = useState(0);
  const go = (url: string) => {
    const route = routeOf(url);
    closeShow();
    closeLab();
    if (route === 'menu') {
      // text shared from Google Lens (or anywhere): open it in the menu checker
      const text = paramOf(url, 'text');
      if (text) receiveMenu(text);
      setMenuKey(k => k + 1);
      setTab('food');
      return;
    }
    if (isTab(route)) setTab(route);
  };

  useEffect(() => {
    (async () => {
      try {
        await loadProgress();
        setLoaded(await loadContent((done, total) => setProg({ done, total })));
        await initMine();
        setReady(true);
        confirmBoot();
        checkUpdates();
        scheduleReminders();
        updateWidget();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    if (!Capacitor.isNativePlatform()) return;
    CapApp.getLaunchUrl().then(r => { if (r?.url) go(r.url); }).catch(() => {});
    const h1 = CapApp.addListener('appUrlOpen', e => go(e.url));
    onReminderTap(route => go(`ginkhao://${route}`));
    const h2 = CapApp.addListener('resume', () => { checkUpdates(); });
    const h3 = CapApp.addListener('pause', () => { flushSave(); });
    return () => { h1.then(h => h.remove()); h2.then(h => h.remove()); h3.then(h => h.remove()); };
  }, []);

  // Android back: close Show mode, then leave a situation, then go back to Today, then minimise.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      if (closeShow() || closeLab()) return;
      if (tab === 'browse' && openSit) { setOpenSit(null); return; }
      if (tab !== 'today') { setTab('today'); return; }
      CapApp.minimizeApp();
    });
    return () => { h.then(x => x.remove()); };
  }, [tab, openSit]);

  useEffect(() => { window.scrollTo(0, 0); }, [tab, openSit]);

  if (!ready) return <Loading {...prog} error={error} />;

  return (
    <>
      <UpdateBanner />
      <main class="app">
        {tab === 'today' && <Today />}
        {tab === 'browse' && <Browse open={openSit} setOpen={setOpenSit} />}
        {tab === 'food' && <Food key={menuKey} />}
        {tab === 'show' && <ShowTab />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav class="tabs" aria-label="Sections">
        {TABS.map(t => (
          <button key={t.id} class={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => { if (t.id === 'browse' && tab === 'browse') setOpenSit(null); setTab(t.id); }}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <SpeakLab />
      <ShowOverlay />
    </>
  );
}

render(<App />, document.getElementById('root')!);
