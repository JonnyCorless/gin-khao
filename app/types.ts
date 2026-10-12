export type Kind = 'say' | 'hear' | 'word';
export type Lvl = 'avoid' | 'care' | 'ok';

/** Anything with Thai text and audio (phrases, food words, dishes). */
export interface Item {
  id: string;
  th: string;
  rom: string;
  en: string;
  note?: string;
  alt?: string[];
  lvl?: Lvl;
}

export interface Phrase extends Item {
  kind: Kind;
  situation: string;
  replies?: string[];
}

export interface Situation {
  id: string;
  title: string;
  th: string;
  icon: string;
  blurb: string;
}

export interface Food {
  spot: Item[];
  basil: Item;
  dishes: Item[];
  northern: Item[];
  safe: Item[];
  meats: Item[];
}

export interface Character {
  id: string;
  name: string;
  th: string;
  role: string;
  situation: string;
  avatar: string;
  color: string;
  about: string;
}

export interface SceneStep {
  they?: string;
  you?: string;
  narrate?: string;
  reply?: string[];
  wrong?: string[];
  check?: boolean;
}

export interface Scene {
  id: string;
  title: string;
  who: string;
  setup: string;
  needs?: string[];
  steps: SceneStep[];
  end: string;
}

export interface Mission {
  id: string;
  title: string;
  detail: string;
  phrases: string[];
}

export interface Content {
  schema: number;
  situations: Situation[];
  phrases: Phrase[];
  food: Food;
  prices: number[];
  characters?: Character[];
  scenes?: Scene[];
  missions?: Mission[];
}
