// Show mode: the phrase full screen, big enough to hand your phone to someone.
import { useEffect, useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { play } from '../audio';
import { item } from '../data';
import type { Item } from '../types';
import { Icon } from './icons';

let setter: ((it: Item | null) => void) | null = null;
let isOpen = false;

/** For the Android back button: closes Show mode if it's open. */
export function closeShow(): boolean {
  if (!isOpen || !setter) return false;
  setter(null);
  return true;
}

export function openShow(idOrItem: string | Item) {
  const it = typeof idOrItem === 'string' ? item(idOrItem) : idOrItem;
  if (it && setter) setter(it);
}

export function reportUrl(it: Item): string {
  const title = `Phrase check: ${it.id}`;
  const body = `**Phrase:** ${it.th}\n**Romanisation:** ${it.rom}\n**English:** ${it.en}\n\n**What a local said / what seems wrong:**\n\n`;
  return `https://github.com/JonnyCorless/gin-khao/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export async function openLink(url: string) {
  if (Capacitor.isNativePlatform()) await Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

export function ShowOverlay() {
  const [it, setIt] = useState<Item | null>(null);
  useEffect(() => { setter = setIt; return () => { setter = null; }; }, []);
  useEffect(() => {
    isOpen = !!it;
    if (!it) return;
    if (it.id !== 'my-address') play(it.id);
    if (Capacitor.isNativePlatform()) KeepAwake.keepAwake().catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIt(null); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (Capacitor.isNativePlatform()) KeepAwake.allowSleep().catch(() => {});
    };
  }, [it]);
  if (!it) return null;
  const address = it.id === 'my-address';
  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Show this phrase">
      <button class="ov-close" onClick={() => setIt(null)} aria-label="Close"><Icon name="close" size={26} /></button>
      <div class="ov-body">
        <div class="ov-th" lang="th">{it.th}</div>
        {!address && <div class="ov-rom">{it.rom}</div>}
        <div class="ov-en">{it.en}</div>
      </div>
      <div class="ov-foot">
        {!address && <button class="btn primary lg" onClick={() => play(it.id)}><Icon name="play" size={18} />Play</button>}
        {!address && <button class="link-btn" onClick={() => openLink(reportUrl(it))}><Icon name="flag" size={14} />Report this phrase</button>}
      </div>
    </div>
  );
}
