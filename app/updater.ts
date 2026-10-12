// LifeRPG-style updates.
// 1. Web code: on open, download the newer web build from GitHub Pages into phone storage,
//    then ask to restart into it. A build only becomes permanent once it has started properly.
// 2. APK: apk/latest.json names a newer APK; the native Updater downloads it and Android asks to install.
import { Capacitor, registerPlugin, WebView, type PluginListenerHandle } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { CONTENT_URL, WEB_BUILD } from './config';
import { blobToBase64 } from './sync';

export interface NativeInfo { versionCode: number; versionName: string; canInstall: boolean; busy: boolean; status: string; webReverted: boolean }
export interface ApkLatest { code: number; name: string; file: string; notes?: string }
interface WebVersion { build: number; minApk: number; files: { path: string; sha1: string }[] }

interface UpdaterPlugin {
  info(): Promise<NativeInfo>;
  bootOk(): Promise<void>;
  install(o: { url: string }): Promise<void>;
  addListener(event: 'apkStatus', cb: (s: { message: string; busy: boolean }) => void): Promise<PluginListenerHandle>;
}
export const Updater = registerPlugin<UpdaterPlugin>('Updater');
export const native = Capacitor.isNativePlatform();

const getJson = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
};

/** Call once the app has rendered: keeps a freshly applied web build for future launches. */
export async function confirmBoot(): Promise<void> {
  if (!native) return;
  try {
    await Updater.bootOk();
    const { path } = await WebView.getServerBasePath();
    if (path && path.startsWith('/')) await WebView.persistServerBasePath();
  } catch {
    /* older APK without the Updater plugin */
  }
}

export async function nativeInfo(): Promise<NativeInfo | null> {
  if (!native) return null;
  try {
    return await Updater.info();
  } catch {
    return null;
  }
}

export async function checkApk(info: NativeInfo): Promise<ApkLatest | null> {
  const latest = await getJson<ApkLatest>(`${CONTENT_URL}apk/latest.json`);
  return latest.code > info.versionCode ? latest : null;
}

export const installApk = (latest: ApkLatest) => Updater.install({ url: `${CONTENT_URL}apk/${latest.file}` });

/** Downloads a newer web build if there is one. Returns its build number when it's ready to apply. */
export async function prepareWeb(info: NativeInfo): Promise<number | null> {
  const v = await getJson<WebVersion>(`${CONTENT_URL}web/version.json`);
  if (v.build <= WEB_BUILD || info.versionCode < v.minApk) return null;
  const dir = `web/${v.build}`;
  try {
    await Filesystem.stat({ path: `${dir}/.complete`, directory: Directory.Data });
    return v.build;
  } catch {
    /* not downloaded yet */
  }
  for (const f of v.files) {
    const r = await fetch(`${CONTENT_URL}web/${f.path}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} for web/${f.path}`);
    await Filesystem.writeFile({ path: `${dir}/${f.path}`, directory: Directory.Data, data: await blobToBase64(await r.blob()), recursive: true });
  }
  await Filesystem.writeFile({ path: `${dir}/.complete`, directory: Directory.Data, data: '', recursive: true });
  return v.build;
}

/** Restarts into the downloaded web build. */
export async function applyWeb(build: number): Promise<void> {
  const { uri } = await Filesystem.getUri({ path: `web/${build}`, directory: Directory.Data });
  await WebView.setServerBasePath({ path: decodeURIComponent(uri.replace(/^file:\/\//, '')) });
}
