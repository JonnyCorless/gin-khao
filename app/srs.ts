// Spaced repetition (FSRS): each phrase comes back just before you'd forget it.
import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';
import { C } from './data';
import { P, update, type SavedCard } from './store';
import type { Phrase } from './types';

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: false, maximum_interval: 365 });

const toCard = (s: SavedCard): Card => ({ ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined });
const fromCard = (c: Card): SavedCard => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last_review: c.last_review?.toISOString(),
});

export type Result = 'again' | 'good' | 'easy';

export function grade(id: string, result: Result) {
  update(p => {
    const now = new Date();
    const saved = p.cards[id];
    const card = saved ? toCard(saved) : createEmptyCard(now);
    const rating = result === 'again' ? Rating.Again : result === 'easy' ? Rating.Easy : Rating.Good;
    p.cards = { ...p.cards, [id]: fromCard(scheduler.next(card, now, rating).card) };
  });
}

export const isLearned = (id: string) => !!P().cards[id];

/** Phrases due for review now, most overdue first. */
export function dueIds(limit = 30): string[] {
  const now = Date.now();
  return Object.entries(P().cards)
    .filter(([, c]) => new Date(c.due).getTime() <= now)
    .sort((a, b) => a[1].due.localeCompare(b[1].due))
    .slice(0, limit)
    .map(([id]) => id);
}

/** The curriculum: situations in order, phrases in file order. */
export function curriculum(): Phrase[] {
  const c = C();
  const order = new Map(c.situations.map((s, i) => [s.id, i]));
  return c.phrases
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (order.get(a.p.situation)! - order.get(b.p.situation)!) || a.i - b.i)
    .map(x => x.p);
}

export function nextNew(n: number): Phrase[] {
  return curriculum().filter(p => !isLearned(p.id)).slice(0, n);
}

export function learnedCount(situation?: string): number {
  const cards = P().cards;
  return C().phrases.filter(p => (!situation || p.situation === situation) && cards[p.id]).length;
}
