// The home-screen widget: a phrase of the day for the coming week, handed to the native widget.
import { C } from './data';
import { curriculum, isLearned } from './srs';
import { P, today } from './store';
import type { Phrase } from './types';
import { native, nativeInfo, Updater } from './updater';

const DAY = 86400000;

/** Mostly phrases you've learned (to keep them fresh), else the next ones you're about to learn. */
function pool(): Phrase[] {
  const learned = C().phrases.filter(p => isLearned(p.id) && p.kind !== 'word');
  if (learned.length >= 7) {
    // the shakiest first: most missed, then least stable
    const cards = P().cards;
    return learned
      .sort((a, b) => (P().misses[b.id] ?? 0) - (P().misses[a.id] ?? 0) || cards[a.id].stability - cards[b.id].stability)
      .slice(0, 21);
  }
  return [...learned, ...curriculum().filter(p => !isLearned(p.id) && p.kind !== 'word').slice(0, 7 - learned.length)];
}

export async function updateWidget() {
  if (!native) return;
  try {
    const info = await nativeInfo();
    if (!info || info.versionCode < 300) return; // the widget arrived in 0.3.0
    const ps = pool();
    if (!ps.length) return;
    // a stable pick per date, so reopening the app doesn't reshuffle today's phrase
    const start = Math.floor(Date.parse(today()) / DAY);
    const items = Array.from({ length: 7 }, (_, k) => {
      const p = ps[(start + k) % ps.length];
      return { date: today(new Date(Date.now() + k * DAY)), id: p.id, th: p.th, rom: p.rom, en: p.en };
    });
    await Updater.setWidget({ items: JSON.stringify(items) });
  } catch {
    /* no widget support in this APK */
  }
}
