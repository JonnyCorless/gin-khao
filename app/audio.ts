// Plays the pre-made Thai audio for an item. One sound at a time.
import { useEffect, useState } from 'preact/hooks';
import { audioUrl } from './data';

let current: HTMLAudioElement | null = null;
let finishCurrent: (() => void) | null = null;
let playingId: string | null = null;
const subs = new Set<(id: string | null) => void>();
const announce = (id: string | null) => { playingId = id; subs.forEach(s => s(id)); };

/** Plays an item. rate < 1 means "slow": a real slow recording (id.slow.mp3), not a stretched clip,
 *  because stretching on the phone stutters. Falls back to the normal clip if the slow one is missing. */
export function play(id: string, rate = 1): Promise<void> {
  stop();
  const slow = rate < 1;
  const a = new Audio(slow ? audioUrl(id).replace(/\.mp3$/, '.slow.mp3') : audioUrl(id));
  current = a;
  announce(id);
  return new Promise(resolve => {
    const end = () => { if (current === a) { current = null; finishCurrent = null; announce(null); } resolve(); };
    finishCurrent = resolve; // if another sound interrupts this one, still count it as finished
    a.onended = end;
    a.onerror = () => {
      if (slow && current === a) { finishCurrent = null; play(id).then(resolve); return; }
      end();
    };
    // a missing slow file rejects with NotSupportedError and is handled by onerror above
    a.play().catch(e => { if (!slow || (e as Error).name !== 'NotSupportedError') end(); });
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
