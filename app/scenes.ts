// Regulars, scenes and missions: who unlocks when, and what Today suggests.
import { C } from './data';
import { isLearned } from './srs';
import { P, today, update } from './store';
import type { Character, Mission, Scene } from './types';

export const characters = (): Character[] => C().characters ?? [];
export const scenes = (): Scene[] => C().scenes ?? [];
export const missions = (): Mission[] => C().missions ?? [];
export const character = (id: string) => characters().find(c => c.id === id);
export const scenesFor = (who: string) => scenes().filter(s => s.who === who);

export const sceneDone = (id: string) => (P().scenes[id] ?? 0) > 0;
export const sceneUnlocked = (s: Scene) => (s.needs ?? []).every(sceneDone);

/** How well a regular knows you, from the scenes you've done with them. */
export function familiarity(who: string): { label: string; done: number; total: number } {
  const all = scenesFor(who);
  const done = all.filter(s => sceneDone(s.id)).length;
  const label = done === 0 ? 'New face' : done >= all.length ? 'Regular' : 'Getting to know you';
  return { label, done, total: all.length };
}

const replyIds = (s: Scene) => s.steps.flatMap(st => st.reply ?? []);

/** Today's scene: the first unlocked, unfinished one whose replies you've mostly learned. */
export function sessionScene(): Scene | null {
  for (const s of scenes()) {
    if (sceneDone(s.id) || !sceneUnlocked(s)) continue;
    const ids = replyIds(s);
    const known = ids.filter(isLearned).length;
    if (ids.length && known / ids.length >= 0.5) return s;
  }
  return null;
}

export function finishScene(id: string) {
  update(p => { p.scenes = { ...p.scenes, [id]: (p.scenes[id] ?? 0) + 1 }; });
}

// ---- missions ----

export const missionDone = (id: string) => !!P().missions[id];

function pickMission(skip?: string): Mission | null {
  const open = missions().filter(m => !missionDone(m.id) && m.id !== skip);
  // prefer missions whose phrases you've already learned
  return open.find(m => m.phrases.length > 0 && m.phrases.some(isLearned)) ?? open[0] ?? null;
}

export function todaysMission(): Mission | null {
  const pick = P().missionPick;
  if (pick?.date === today()) {
    const m = missions().find(x => x.id === pick.id);
    if (m) return m;
  }
  const m = pickMission();
  if (m) update(p => { p.missionPick = { date: today(), id: m.id }; });
  return m;
}

export function anotherMission() {
  const cur = P().missionPick?.id;
  const m = pickMission(cur);
  if (m) update(p => { p.missionPick = { date: today(), id: m.id }; });
}

export function completeMission(id: string, note?: string) {
  update(p => { p.missions = { ...p.missions, [id]: { date: today(), note: note?.trim() || undefined } }; });
}

export const BADGES = [
  { n: 1, name: 'First step' },
  { n: 5, name: 'Getting brave' },
  { n: 10, name: 'Local-ish' },
  { n: 20, name: 'Chiang Mai regular' },
];
