// Story: My first month in Chiang Mai. Chapters unlock in order; each one teaches the lines
// its scenes need, plays the scenes, then sets a real-world mission.
import { C, phrase } from './data';
import { sceneDone, scenes } from './scenes';
import { isLearned } from './srs';
import type { Chapter, Scene } from './types';

export const chapters = (): Chapter[] => C().story ?? [];

export const chapterScenes = (ch: Chapter): Scene[] =>
  ch.scenes.map(id => scenes().find(s => s.id === id)).filter((s): s is Scene => !!s);

export const chapterDone = (ch: Chapter) => chapterScenes(ch).every(s => sceneDone(s.id));

export const chapterUnlocked = (i: number) => i === 0 || chapterDone(chapters()[i - 1]);

/** Every phrase the chapter's scenes use: what they say and what you can answer. */
export function chapterPhrases(ch: Chapter): string[] {
  const ids = new Set<string>();
  for (const s of chapterScenes(ch)) {
    for (const st of s.steps) {
      if (st.they) ids.add(st.they);
      for (const r of st.reply ?? []) ids.add(r);
    }
  }
  return [...ids].filter(id => !!phrase(id));
}

export const chapterNew = (ch: Chapter) => chapterPhrases(ch).filter(id => !isLearned(id));

/** The chapter you're on: the first one not finished. */
export function currentChapter(): { ch: Chapter; index: number } | null {
  const all = chapters();
  const index = all.findIndex(ch => !chapterDone(ch));
  return index < 0 ? null : { ch: all[index], index };
}
