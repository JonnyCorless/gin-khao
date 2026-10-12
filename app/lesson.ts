// Exercises and today's session. An exercise is stored as "type:id" (or "price:85") so a
// half-finished session survives closing the app.
import { C, item, phrase } from './data';
import { sessionScene } from './scenes';
import { curriculum, dueIds, isLearned, nextNew } from './srs';
import { P, today, update, type SessionState } from './store';
import type { Item, Phrase } from './types';

export type ExType = 'intro' | 'meaning' | 'recall' | 'listen' | 'price';
export interface Ex { type: ExType; id: string; n?: number }

export const decode = (s: string): Ex => {
  const [type, id] = s.split(':') as [ExType, string];
  return type === 'price' ? { type, id: `price-${id}`, n: Number(id) } : { type, id };
};

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
export const shuffle = <T,>(xs: T[]): T[] => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

function quizType(p: Phrase): ExType {
  if (p.kind === 'say') return pick<ExType>(['meaning', 'recall', 'listen', 'recall']);
  return pick<ExType>(['meaning', 'listen']);
}

/** Realistic prices: mostly small amounts, some hundreds, a few thousands. */
export function randomPrice(): number {
  const all = C().prices;
  const r = Math.random();
  const band = r < 0.45 ? all.filter(n => n <= 100) : r < 0.88 ? all.filter(n => n > 100 && n < 1000) : all.filter(n => n >= 1000);
  return pick(band);
}

export interface StepInfo { key: string; title: string; blurb: string; icon: string }
export const STEPS: Record<string, StepInfo> = {
  review: { key: 'review', title: 'Warm-up review', blurb: 'Phrases due today', icon: 'sparkle' },
  learn: { key: 'learn', title: 'New phrases', blurb: 'Hear, say, then check', icon: 'browse' },
  listen: { key: 'listen', title: 'Listening', blurb: 'What staff say to you', icon: 'ear' },
  scene: { key: 'scene', title: 'Scene', blurb: 'Role-play with one of your regulars', icon: 'people' },
  prices: { key: 'prices', title: 'Prices', blurb: 'Catch the number', icon: 'coins' },
};

export const NEW_PER_DAY = 8;

/** Fewer new phrases when the review pile is big or the last session was rough. */
export function newPerDay(): number {
  if (dueIds(99).length >= 25) return 4;
  const days = P().days;
  const last = Object.keys(days).filter(d => d < today()).sort().pop();
  const log = last ? days[last] : undefined;
  if (log?.tries && log.tries >= 6 && (log.right ?? 0) / log.tries < 0.7) return 5;
  return NEW_PER_DAY;
}

export function buildSession(): SessionState {
  const review = dueIds(25).map(id => phrase(id)).filter((p): p is Phrase => !!p).map(p => `${quizType(p)}:${p.id}`);
  const fresh = nextNew(newPerDay());
  const learn: string[] = [];
  for (const p of fresh) learn.push(`intro:${p.id}`, `${p.kind === 'say' ? 'meaning' : 'listen'}:${p.id}`);
  for (const p of shuffle(fresh)) learn.push(`${p.kind === 'say' ? 'recall' : 'meaning'}:${p.id}`);
  const hearLearned = C().phrases.filter(p => p.kind === 'hear' && isLearned(p.id));
  const hearPool = hearLearned.length >= 4 ? hearLearned : curriculum().filter(p => p.kind === 'hear').slice(0, 10);
  const listen = shuffle(hearPool).slice(0, 5).map(p => `listen:${p.id}`);
  const prices = Array.from({ length: 4 }, () => `price:${randomPrice()}`);
  const scene = sessionScene();
  const steps = [
    { key: 'review', ids: review },
    { key: 'learn', ids: learn },
    { key: 'listen', ids: listen },
    { key: 'scene', ids: scene ? [`scene:${scene.id}`] : [] },
    { key: 'prices', ids: prices },
  ].filter(s => s.ids.length > 0);
  return { date: today(), step: 0, index: 0, steps };
}

export function todaysSession(): SessionState {
  const s = P().session;
  if (s && s.date === today()) return s;
  const fresh = buildSession();
  update(p => { p.session = fresh; });
  return fresh;
}

/** Placement: things you may already know. Right answers are marked as known so Today skips them. */
export const PLACEMENT = [
  'listen:hello', 'meaning:thank-you', 'listen:how-much', 'meaning:take-this', 'listen:little-thai',
  'listen:p-95-full', 'meaning:p-full', 'listen:n-5', 'listen:n-9', 'listen:n-10', 'listen:n-100',
  'listen:s-bag', 'meaning:s-heat', 'listen:f-not-spicy', 'price:45', 'price:120',
];

// ---- answer options ----

/** Four English meanings (or four Thai phrases for recall), the right one included. */
export function options(ex: Ex): Item[] {
  const target = item(ex.id);
  if (!target) return [];
  const p = phrase(ex.id);
  const key = (x: Item) => (ex.type === 'recall' ? x.th : x.en);
  let pools: Item[][];
  if (p && p.situation) {
    const all = C().phrases;
    const kind = ex.type === 'recall' ? 'say' : p.kind;
    // same situation and kind first, then same kind anywhere, then anything
    pools = [all.filter(x => x.situation === p.situation && x.kind === kind), all.filter(x => x.kind === kind), all];
  } else {
    const f = C().food; // food words and dishes
    pools = [[...f.spot, ...f.dishes, ...f.northern, ...f.safe, ...f.meats]];
  }
  const seen = new Set([key(target)]);
  const out: Item[] = [];
  for (const pool of pools) {
    for (const x of shuffle(pool)) {
      if (out.length >= 3) break;
      if (seen.has(key(x))) continue;
      seen.add(key(x));
      out.push(x);
    }
  }
  return shuffle([target, ...out]);
}
