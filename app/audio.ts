// Plays the pre-made Thai audio for an item. One sound at a time.
import { useEffect, useState } from 'preact/hooks';
import { audioUrl } from './data';

let current: HTMLAudioElement | null = null;
let finishCurrent: (() => void) | null = null;
let playingId: string | null = null;
const subs = new Set<(id: string | null) => void>();
const announce = (id: string | null) => { playingId = id; subs.forEach(s => s(id)); };

// Audio that isn't in the content feed: your own phrases, recorded on the phone.
const overrides = new Map<string, string>();
export const setAudioOverride = (id: string, url: string | null) => { if (url) overrides.set(id, url); else overrides.delete(id); };
export const hasAudio = (id: string) => overrides.has(id) || !id.startsWith('mine-');
/** Where an item's (normal speed) audio lives. */
export const srcFor = (id: string) => overrides.get(id) ?? audioUrl(id);

/** Plays an item. rate < 1 means "slow": a real slow recording (id.slow.mp3), not a stretched clip,
 *  because stretching on the phone stutters. Falls back to the normal clip if the slow one is missing. */
export function play(id: string, rate = 1): Promise<void> {
  const own = overrides.get(id);
  if (own) return playSrc(id, own);
  const slow = rate < 1;
  return playSrc(id, slow ? audioUrl(id).replace(/\.mp3$/, '.slow.mp3') : audioUrl(id), slow ? () => play(id) : undefined);
}

/** Plays any URL (a recording of you, say). key is what play buttons watch for their "playing" state. */
export const playUrl = (key: string, url: string) => playSrc(key, url);

function playSrc(key: string, src: string, fallback?: () => Promise<void>): Promise<void> {
  stop();
  const a = new Audio(src);
  current = a;
  announce(key);
  return new Promise(resolve => {
    const end = () => { if (current === a) { current = null; finishCurrent = null; announce(null); } resolve(); };
    finishCurrent = resolve; // if another sound interrupts this one, still count it as finished
    a.onended = end;
    a.onerror = () => {
      if (fallback && current === a) { finishCurrent = null; fallback().then(resolve); return; }
      end();
    };
    // a missing file rejects with NotSupportedError and is handled by onerror above
    a.play().catch(e => { if (!fallback || (e as Error).name !== 'NotSupportedError') end(); });
  });
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
    announce(null);
  }
  const f = finishCurrent;
  finishCurrent = null;
  f?.();
}

/** True while this item's audio is playing (for the gold "speaking" state on play buttons). */
export function usePlaying(id: string): boolean {
  const [on, setOn] = useState(playingId === id);
  useEffect(() => {
    const f = (p: string | null) => setOn(p === id);
    subs.add(f);
    return () => { subs.delete(f); };
  }, [id]);
  return on;
}
