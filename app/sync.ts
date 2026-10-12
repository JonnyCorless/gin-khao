// Content sync: fetch manifest from GitHub Pages, download changed files to the phone,
// and fall back to the copy bundled in the APK when offline.
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { CONTENT_URL } from './config';

export interface Phrase { id: string; th: string; rom: string; en: string; audio: string }
export interface Content { phrases: Phrase[] }
interface ManifestFile { path: string; sha1: string; size: number }
interface Manifest { version: string; files: ManifestFile[] }

export interface Loaded {
  content: Content;
  version: string;
  source: 'synced' | 'cached' | 'bundled';
  audioUrl: (p: Phrase) => string;
  error?: string;
}

const DIR = Directory.Data;
const ROOT = 'content';
const native = Capacitor.isNativePlatform();

async function readLocal(path: string): Promise<string | null> {
  try {
    const r = await Filesystem.readFile({ path: `${ROOT}/${path}`, directory: DIR, encoding: Encoding.UTF8 });
    return typeof r.data === 'string' ? r.data : await r.data.text();
  } catch {
    return null;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

async function localAudioUrl(path: string): Promise<string> {
  const { uri } = await Filesystem.getUri({ path: `${ROOT}/${path}`, directory: DIR });
  return Capacitor.convertFileSrc(uri);
}

async function syncNative(): Promise<Loaded> {
  const localManifestText = await readLocal('manifest.json');
  const local: Manifest | null = localManifestText ? JSON.parse(localManifestText) : null;
  let error: string | undefined;
  let source: Loaded['source'] = local ? 'cached' : 'bundled';
  let manifest = local;

  try {
    const remote = await fetchJson<Manifest>(`${CONTENT_URL}manifest.json`);
    if (!local || remote.version !== local.version) {
      const have = new Map((local?.files ?? []).map(f => [f.path, f.sha1]));
      for (const f of remote.files) {
        if (have.get(f.path) === f.sha1) continue;
        const r = await fetch(`${CONTENT_URL}${f.path}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${r.status} for ${f.path}`);
        await Filesystem.writeFile({ path: `${ROOT}/${f.path}`, directory: DIR, data: await blobToBase64(await r.blob()), recursive: true });
      }
      await Filesystem.writeFile({ path: `${ROOT}/manifest.json`, directory: DIR, data: JSON.stringify(remote), encoding: Encoding.UTF8, recursive: true });
      manifest = remote;
    }
    source = 'synced';
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const contentText = manifest ? await readLocal('content.json') : null;
  if (manifest && contentText) {
    const urls = new Map<string, string>();
    const content: Content = JSON.parse(contentText);
    for (const p of content.phrases) urls.set(p.id, await localAudioUrl(p.audio));
    return { content, version: manifest.version, source, error, audioUrl: p => urls.get(p.id) ?? `./bundled/${p.audio}` };
  }
  return loadBundled(error);
}

async function loadBundled(error?: string): Promise<Loaded> {
  const [content, manifest] = await Promise.all([fetchJson<Content>('./bundled/content.json'), fetchJson<Manifest>('./bundled/manifest.json')]);
  return { content, version: manifest.version, source: 'bundled', error, audioUrl: p => `./bundled/${p.audio}` };
}

async function syncWeb(): Promise<Loaded> {
  try {
    const [content, manifest] = await Promise.all([fetchJson<Content>(`${CONTENT_URL}content.json`), fetchJson<Manifest>(`${CONTENT_URL}manifest.json`)]);
    return { content, version: manifest.version, source: 'synced', audioUrl: p => `${CONTENT_URL}${p.audio}` };
  } catch (e) {
    return loadBundled(e instanceof Error ? e.message : String(e));
  }
}

export const loadContent = (): Promise<Loaded> => (native ? syncNative() : syncWeb());
