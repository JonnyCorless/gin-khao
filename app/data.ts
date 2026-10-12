// The loaded content, shared across screens, plus lookups.
import type { Loaded } from './sync';
import type { Item, Phrase, ScriptItem, ScriptLesson, SoundSet } from './types';

/** What kind of thing an id is, which decides how it's quizzed. */
export type Category = 'phrase' | 'food' | 'sound' | 'script' | 'mine';

let loaded: Loaded | null = null;
let byId = new Map<string, Item>();
let catOf = new Map<string, Category>();
// for items that aren't phrases: the group wrong answers are drawn from
let poolOf = new Map<string, Item[]>();
let lessonOf = new Map<string, ScriptLesson>();
let setOf = new Map<string, SoundSet>();

export function setLoaded(l: Loaded) {
  loaded = l;
  const c = l.content;
  byId = new Map();
  catOf = new Map();
  poolOf = new Map();
  lessonOf = new Map();
  setOf = new Map();
  const put = (i: Item, cat: Category, pool?: Item[]) => {
    byId.set(i.id, i);
    catOf.set(i.id, cat);
    if (pool) poolOf.set(i.id, pool);
  };
  for (const p of c.phrases) put(p, 'phrase');
  const f = c.food;
  const foodPool = [...f.spot, ...f.dishes, ...f.northern, ...f.safe, ...f.meats];
  for (const i of foodPool) put(i, 'food', foodPool);
  put(f.basil, 'food', foodPool);
  for (const s of c.sounds ?? []) for (const w of s.words) { put(w, 'sound', s.words); setOf.set(w.id, s); }
  const scripts = c.script ?? [];
  for (const les of scripts) {
    // signs share one pool so there are always enough wrong answers; letters stay within their lesson
    const pool = les.type === 'sign' ? scripts.filter(x => x.type === 'sign').flatMap(x => x.items) : les.items;
    for (const i of les.items) { put(i, 'script', pool); lessonOf.set(i.id, les); }
  }
}

let mineIds: string[] = [];
/** Your own phrases join the lookups so they can be pinned, shown and practised like any other. */
export function setMine(items: Item[]) {
  for (const id of mineIds) { byId.delete(id); catOf.delete(id); }
  mineIds = items.map(i => i.id);
  for (const i of items) { byId.set(i.id, i); catOf.set(i.id, 'mine'); }
}

export const L = () => loaded!;
export const C = () => loaded!.content;
export const item = (id: string) => byId.get(id);
/** A phrase from the situations (not a food word, sound-alike or script item). */
export const phrase = (id: string) => (catOf.get(id) === 'phrase' ? (byId.get(id) as Phrase) : undefined);
export const category = (id: string) => catOf.get(id);
export const poolFor = (id: string) => poolOf.get(id);
export const scriptItem = (id: string) => (catOf.get(id) === 'script' ? (byId.get(id) as ScriptItem) : undefined);
export const scriptLessonOf = (id: string) => lessonOf.get(id);
export const soundSetOf = (id: string) => setOf.get(id);
export const audioUrl = (id: string) => loaded!.audioUrl(id);
export const situationOf = (p: Phrase) => loaded!.content.situations.find(s => s.id === p.situation);
