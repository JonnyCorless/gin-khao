// Content sync: fetch the manifest from GitHub Pages and keep a copy of every file on the phone.
// On first launch, files that match the copy built into the APK are copied from there instead
// of downloaded, so the app works offline straight after install.
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
const native = Capacitor.isNativePlatform();

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchJson<T>(url: string): Promise<T> {
  // The query string skips GitHub Pages' 10-minute cache for the small index files.
  const r = await fetch(url.startsWith('http') ? `${url}?t=${Date.now()}` : url, { cache: 'no-store' });
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

async function copyIn(url: string, path: string) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  await Filesystem.writeFile({ path: `${ROOT}/${path}`, directory: DIR, data: await blobToBase64(await r.blob()), recursive: true });
}

async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<void>, onStep: () => void) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(async t => { await fn(t); onStep(); }));
  }
}

async function bundledManifest(): Promise<Manifest | null> {
  try {
    return await fetchJson<Manifest>('./bundled/manifest.json');
  } catch {
    return null; // running a downloaded web update, which doesn't carry the bundled copy
  }
}

async function syncNative(progress?: Progress): Promise<Loaded> {
  const localText = await readLocal('manifest.json');
  const local: Manifest | null = localText ? JSON.parse(localText) : null;
  let manifest = local;
  let source: Loaded['source'] = 'cached';
  let error: string | undefined;

  const pull = async (target: Manifest) => {
    const have = new Map((local?.files ?? []).map(f => [f.path, f.sha1]));
    const bundled = await bundledManifest();
    const inApk = new Map((bundled?.files ?? []).map(f => [f.path, f.sha1]));
    const todo = target.files.filter(f => have.get(f.path) !== f.sha1);
    let done = 0;
    progress?.(0, todo.length);
    await inBatches(todo, 8, f => (inApk.get(f.path) === f.sha1 ? copyIn(`./bundled/${f.path}`, f.path) : copyIn(`${CONTENT_URL}${f.path}`, f.path)), () => progress?.(++done, todo.length));
    await Filesystem.writeFile({ path: `${ROOT}/manifest.json`, directory: DIR, data: JSON.stringify(target), encoding: Encoding.UTF8, recursive: true });
    manifest = target;
  };

  try {
    const remote = await fetchJson<Manifest>(`${CONTENT_URL}manifest.json`);
    if (!local || remote.version !== local.version) await pull(remote);
    source = 'synced';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (!local) {
      // Offline on first launch: install the copy built into the APK.
      const bundled = await bundledManifest();
      if (bundled) {
        try {
          await pull(bundled);
          source = 'bundled';
        } catch { /* fall through */ }
      }
    }
  }

  const text = manifest ? await readLocal('content.json') : null;
  if (!manifest || !text) throw new Error(error ?? 'No content on this phone yet. Connect to the internet and reopen Gin Khao.');
  const { uri } = await Filesystem.getUri({ path: ROOT, directory: DIR });
  const base = Capacitor.convertFileSrc(uri);
  return { content: JSON.parse(text), version: manifest.version, source, error, audioUrl: id => `${base}/audio/${id}.mp3` };
}

async function syncWeb(): Promise<Loaded> {
  try {
    if (import.meta.env.DEV) throw new Error('dev: use the local content build');
    const [content, manifest] = await Promise.all([fetchJson<Content>(`${CONTENT_URL}content.json`), fetchJson<Manifest>(`${CONTENT_URL}manifest.json`)]);
    return { content, version: manifest.version, source: 'synced', audioUrl: id => `${CONTENT_URL}audio/${id}.mp3` };
  } catch (e) {
    const [content, manifest] = await Promise.all([fetchJson<Content>('./bundled/content.json'), fetchJson<Manifest>('./bundled/manifest.json')]);
    return { content, version: manifest.version, source: 'bundled', error: String(e), audioUrl: id => `./bundled/audio/${id}.mp3` };
  }
}

export const loadContent = (progress?: Progress): Promise<Loaded> => (native ? syncNative(progress) : syncWeb());
