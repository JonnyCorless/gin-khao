// Plays the pre-made Thai audio for an item. One sound at a time.
import { useEffect, useState } from 'preact/hooks';
import { audioUrl } from './data';

let current: HTMLAudioElement | null = null;
let playingId: string | null = null;
const subs = new Set<(id: string | null) => void>();
const announce = (id: string | null) => { playingId = id; subs.forEach(s => s(id)); };

export function play(id: string, rate = 1): Promise<void> {
  stop();
  const a = new Audio(audioUrl(id));
  a.playbackRate = rate;
  current = a;
  announce(id);
  return new Promise(resolve => {
    const end = () => { if (current === a) { current = null; announce(null); } resolve(); };
    a.onended = end;
    a.onerror = end;
    a.play().catch(end);
  });
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
    announce(null);
  }
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
