// The loaded content, shared across screens, plus lookups.
import type { Loaded } from './sync';
import type { Item, Phrase } from './types';

let loaded: Loaded | null = null;
let byId = new Map<string, Item>();

export function setLoaded(l: Loaded) {
  loaded = l;
  const c = l.content;
  byId = new Map<string, Item>();
  for (const p of c.phrases) byId.set(p.id, p);
  for (const list of [c.food.spot, c.food.dishes, c.food.northern, c.food.safe, c.food.meats]) for (const i of list) byId.set(i.id, i);
  byId.set(c.food.basil.id, c.food.basil);
}

export const L = () => loaded!;
export const C = () => loaded!.content;
export const item = (id: string) => byId.get(id);
export const phrase = (id: string) => byId.get(id) as Phrase | undefined;
export const audioUrl = (id: string) => loaded!.audioUrl(id);
export const situationOf = (p: Phrase) => loaded!.content.situations.find(s => s.id === p.situation);
