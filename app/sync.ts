// Content sync: fetch the manifest from GitHub Pages and keep a copy of every file on the phone.
// The app opens straight away from the copy on the phone; new content downloads in the background
// and swaps in when it's complete. Only the very first launch waits (and that copies from the APK
// where it can, so it works offline straight after install).
import { useEffect, useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { CONTENT_URL } from './config';
import type { Content } from './types';

interface ManifestFile { path: string; sha1: string; size: number }
interface Manifest { version: string; files: ManifestFile[] }

export interface Loaded {
  content: Content;
  version: string;
  source: 'synced' | 'cached' | 'bundled';
  audioUrl: (id: string) => string;
  error?: string;
}

export type Progress = (done: number, total: number) => void;

const DIR = Directory.Data;
const ROOT = 'content';
// path -> sha1 of every file already on the phone, saved as it goes so a download can resume
const HAVE = 'have.json';
const native = Capacitor.isNativePlatform();

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** fetch with a time limit, so a weak signal can't hang the app */
async function fetchWithin(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson<T>(url: string, ms = 10000): Promise<T> {
  // The query string skips GitHub Pages' 10-minute cache for the small index files.
  const r = await fetchWithin(url.startsWith('http') ? `${url}?t=${Date.now()}` : url, ms, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

async function readLocal(path: string): Promise<string | null> {
  try {
    const r = await Filesystem.readFile({ path: `${ROOT}/${path}`, directory: DIR, encoding: Encoding.UTF8 });
    return typeof r.data === 'string' ? r.data : await r.data.text();
  } catch {
    return null;
  }
}

const writeLocal = (path: string, text: string) =>
  Filesystem.writeFile({ path: `${ROOT}/${path}`, directory: DIR, data: text, encoding: Encoding.UTF8, recursive: true });

async function copyIn(url: string, path: string) {
  const r = await fetchWithin(url, 30000, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  await Filesystem.writeFile({ path: `${ROOT}/${path}`, directory: DIR, data: await blobToBase64(await r.blob()), recursive: true });
}

async function bundledManifest(): Promise<Manifest | null> {
  try {
    return await fetchJson<Manifest>('./bundled/manifest.json');
  } catch {
    return null; // running a downloaded web update, which doesn't carry the bundled copy
  }
}

// ---- background sync status, for the little progress pill ----

export interface SyncState { active: boolean; done: number; total: number }
let syncState: SyncState = { active: false, done: 0, total: 0 };
const syncSubs = new Set<(s: SyncState) => void>();
const setSync = (s: SyncState) => { syncState = s; syncSubs.forEach(f => f(s)); };

export function useSyncState(): SyncState {
  const [s, set] = useState(syncState);
  useEffect(() => { syncSubs.add(set); return () => { syncSubs.delete(set); }; }, []);
  return s;
}

// ---- native ----

async function loadLocal(): Promise<{ manifest: Manifest; content: Content } | null> {
  const [m, c] = await Promise.all([readLocal('manifest.json'), readLocal('content.json')]);
  if (!m || !c) return null;
  try {
    return { manifest: JSON.parse(m), content: JSON.parse(c) };
  } catch {
    return null;
  }
}

async function nativeLoaded(content: Content, version: string, source: Loaded['source'], error?: string): Promise<Loaded> {
  const { uri } = await Filesystem.getUri({ path: ROOT, directory: DIR });
  const base = Capacitor.convertFileSrc(uri);
  return { content, version, source, error, audioUrl: id => `${base}/audio/${id}.mp3` };
}

/** Brings the phone's copy up to `target`. Resumable: finished files are remembered as it goes.
 *  content.json and manifest.json are written last, so the app never reads a half-finished set. */
async function pull(target: Manifest, localManifest: Manifest | null, progress?: Progress) {
  let have: Record<string, string> = {};
  const saved = await readLocal(HAVE);
  if (saved) try { have = JSON.parse(saved); } catch { /* start from the manifest */ }
  for (const f of localManifest?.files ?? []) if (!(f.path in have)) have[f.path] = f.sha1;

  const bundled = await bundledManifest();
  const inApk = new Map((bundled?.files ?? []).map(f => [f.path, f.sha1]));
  const last = new Set(['content.json', 'manifest.json']);
  const todo = target.files.filter(f => have[f.path] !== f.sha1 && !last.has(f.path));
  let done = 0;
  const total = todo.length + 1;
  progress?.(0, total);
  const BATCH = 8;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async f => {
      await (inApk.get(f.path) === f.sha1 ? copyIn(`./bundled/${f.path}`, f.path) : copyIn(`${CONTENT_URL}${f.path}`, f.path));
      have[f.path] = f.sha1;
      progress?.(++done, total);
    }));
    if ((i / BATCH) % 5 === 4) await writeLocal(HAVE, JSON.stringify(have)); // every 40 files
  }
  const c = target.files.find(f => f.path === 'content.json');
  if (c) {
    await (inApk.get(c.path) === c.sha1 ? copyIn('./bundled/content.json', c.path) : copyIn(`${CONTENT_URL}content.json`, c.path));
    have[c.path] = c.sha1;
  }
  await writeLocal(HAVE, JSON.stringify(have));
  await writeLocal('manifest.json', JSON.stringify(target));
  progress?.(total, total);
}

let syncing = false;

/** Checks GitHub for newer content and downloads it in the background. Calls onNew when it's in place. */
export async function syncInBackground(onNew: (l: Loaded) => void): Promise<void> {
  if (!native || syncing) return;
  syncing = true;
  try {
    const local = await loadLocal();
    const remote = await fetchJson<Manifest>(`${CONTENT_URL}manifest.json`);
    if (local && remote.version === local.manifest.version) return;
    setSync({ active: true, done: 0, total: 0 });
    await pull(remote, local?.manifest ?? null, (done, total) => setSync({ active: true, done, total }));
    const fresh = await loadLocal();
    if (fresh) onNew(await nativeLoaded(fresh.content, fresh.manifest.version, 'synced'));
  } catch {
    /* offline or a hiccup: try again next time the app opens */
  } finally {
    syncing = false;
    setSync({ active: false, done: 0, total: 0 });
  }
}

async function loadNative(progress?: Progress): Promise<Loaded> {
  // Usual case: open from the phone's copy straight away.
  const local = await loadLocal();
  if (local) return nativeLoaded(local.content, local.manifest.version, 'cached');

  // First launch: get content before showing anything, from GitHub or the copy inside the APK.
  let error: string | undefined;
  try {
    const remote = await fetchJson<Manifest>(`${CONTENT_URL}manifest.json`, 15000);
    await pull(remote, null, progress);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    const bundled = await bundledManifest();
    if (bundled) {
      try { await pull(bundled, null, progress); } catch { /* fall through */ }
    }
  }
  const got = await loadLocal();
  if (!got) throw new Error(error ?? 'No content on this phone yet. Connect to the internet and reopen Gin Khao.');
  return nativeLoaded(got.content, got.manifest.version, error ? 'bundled' : 'synced', error);
}

// ---- web (the browser preview) ----

async function loadWeb(): Promise<Loaded> {
  try {
    if (import.meta.env.DEV) throw new Error('dev: use the local content build');
    const [content, manifest] = await Promise.all([fetchJson<Content>(`${CONTENT_URL}content.json`), fetchJson<Manifest>(`${CONTENT_URL}manifest.json`)]);
    return { content, version: manifest.version, source: 'synced', audioUrl: id => `${CONTENT_URL}audio/${id}.mp3` };
  } catch (e) {
    const [content, manifest] = await Promise.all([fetchJson<Content>('./bundled/content.json'), fetchJson<Manifest>('./bundled/manifest.json')]);
    return { content, version: manifest.version, source: 'bundled', error: String(e), audioUrl: id => `./bundled/audio/${id}.mp3` };
  }
}

export const loadContent = (progress?: Progress): Promise<Loaded> => (native ? loadNative(progress) : loadWeb());
