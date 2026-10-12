// Your progress: review cards, streak, hearts, settings, pinned Show cards.
// Saved to a file on the phone (and mirrored in localStorage), exportable as a backup.
import { useEffect, useState } from 'preact/hooks';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface SavedCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export interface Settings {
  reminderOn: boolean;
  reminderTime: string; // "11:00"
  hearts: boolean;
}

export interface DayLog {
  done?: boolean;
  reviews: number;
  learned: number;
  /** first attempts at quiz questions today, and how many were right */
  tries?: number;
  right?: number;
}

export interface SessionState {
  date: string;
  step: number;
  index: number;
  steps: { key: string; ids: string[] }[];
}

export interface ProgressData {
  v: 1;
  cards: Record<string, SavedCard>;
  days: Record<string, DayLog>;
  streak: { count: number; last: string };
  hearts: { n: number; at: number };
  settings: Settings;
  pins: string[];
  address: string;
  placementDone: boolean;
  session: SessionState | null;
  /** scene id -> times completed */
  scenes: Record<string, number>;
  /** mission id -> when you did it, and an optional note */
  missions: Record<string, { date: string; note?: string }>;
  /** today's suggested mission */
  missionPick: { date: string; id: string } | null;
  /** phrase id -> how many times you've missed it recently (the "Tricky ones") */
  misses: Record<string, number>;
}

export const MAX_HEARTS = 5;
export const HEART_MS = 30 * 60 * 1000;
const FILE = 'progress.json';
const LS = 'gk.progress';

const defaults = (): ProgressData => ({
  v: 1,
  cards: {},
  days: {},
  streak: { count: 0, last: '' },
  hearts: { n: MAX_HEARTS, at: Date.now() },
  settings: { reminderOn: true, reminderTime: '11:00', hearts: true },
  pins: ['little-thai', 'f-my-way', 'f-no-offal', 'dont-understand', 'type-it'],
  address: '',
  placementDone: false,
  session: null,
  scenes: {},
  missions: {},
  missionPick: null,
  misses: {},
});

let state: ProgressData = defaults();
const subs = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const P = () => state;

export function update(fn: (p: ProgressData) => void) {
  fn(state);
  state = { ...state };
  subs.forEach(s => s());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

export function useProgress(): ProgressData {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(x => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return state;
}

/** Save right now (the app is going to the background). */
export function flushSave() {
  clearTimeout(saveTimer);
  save();
}

async function save() {
  const text = JSON.stringify(state);
  try { localStorage.setItem(LS, text); } catch { /* storage full or blocked */ }
  if (Capacitor.isNativePlatform()) {
    try { await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: text, encoding: Encoding.UTF8 }); } catch { /* keep the localStorage copy */ }
  }
}

function merge(raw: Partial<ProgressData>): ProgressData {
  const d = defaults();
  return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings ?? {}) }, hearts: raw.hearts ?? d.hearts, streak: raw.streak ?? d.streak };
}

export async function loadProgress() {
  let text: string | null = null;
  if (Capacitor.isNativePlatform()) {
    try {
      const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      text = typeof r.data === 'string' ? r.data : await r.data.text();
    } catch { /* first run */ }
  }
  if (!text) try { text = localStorage.getItem(LS); } catch { /* blocked */ }
  if (text) try { state = merge(JSON.parse(text)); } catch { /* corrupt: keep defaults */ }
}

// ---- dates, streak, hearts ----

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = () => today(new Date(Date.now() - 86400000));

export function dayLog(p: ProgressData, date = today()): DayLog {
  return p.days[date] ?? { reviews: 0, learned: 0 };
}

export function logDay(fn: (d: DayLog) => void) {
  update(p => {
    const d = { ...dayLog(p) };
    fn(d);
    p.days = { ...p.days, [today()]: d };
  });
}

export function finishDay() {
  update(p => {
    const t = today();
    p.days = { ...p.days, [t]: { ...dayLog(p), done: true } };
    if (p.streak.last !== t) p.streak = { count: p.streak.last === yesterday() ? p.streak.count + 1 : 1, last: t };
  });
}

/** Remember a miss (or ease off after a right answer) for the Tricky ones list. */
export function noteMiss(id: string, ok: boolean) {
  update(p => {
    const n = p.misses[id] ?? 0;
    if (!ok) p.misses = { ...p.misses, [id]: n + 1 };
    else if (n > 0) {
      const next = { ...p.misses };
      if (n <= 1) delete next[id]; else next[id] = n - 1;
      p.misses = next;
    }
  });
}

export const trickyIds = (p: ProgressData, limit = 12) =>
  Object.entries(p.misses).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);

/** Streak as it stands now: it only breaks once a whole day has been missed. */
export function currentStreak(p: ProgressData): number {
  return p.streak.last === today() || p.streak.last === yesterday() ? p.streak.count : 0;
}

export function hearts(p: ProgressData): { n: number; nextIn: number } {
  if (!p.settings.hearts) return { n: MAX_HEARTS, nextIn: 0 };
  const gained = Math.floor((Date.now() - p.hearts.at) / HEART_MS);
  const n = Math.min(MAX_HEARTS, p.hearts.n + gained);
  const nextIn = n >= MAX_HEARTS ? 0 : HEART_MS - ((Date.now() - p.hearts.at) % HEART_MS);
  return { n, nextIn };
}

export function loseHeart() {
  update(p => {
    if (!p.settings.hearts) return;
    const now = Date.now();
    const gained = Math.floor((now - p.hearts.at) / HEART_MS);
    const n = Math.min(MAX_HEARTS, p.hearts.n + gained);
    // when full, the refill clock starts now; otherwise keep the part of a refill already earned
    p.hearts = { n: Math.max(0, n - 1), at: n >= MAX_HEARTS ? now : p.hearts.at + gained * HEART_MS };
  });
}

/** Wipes learning progress (cards, streak, sessions, hearts) but keeps settings, pins and address. */
export function resetProgress() {
  update(p => {
    const d = defaults();
    p.cards = {};
    p.days = {};
    p.streak = d.streak;
    p.hearts = d.hearts;
    p.session = null;
    p.placementDone = false;
    p.scenes = {};
    p.missions = {};
    p.missionPick = null;
    p.misses = {};
  });
}

// ---- backup ----

export async function exportBackup(): Promise<string> {
  const name = `gin-khao-backup-${today()}.json`;
  const text = JSON.stringify(state, null, 1);
  if (!Capacitor.isNativePlatform()) return 'Backups work in the installed app.';
  const { uri } = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: text, encoding: Encoding.UTF8 });
  await Share.share({ title: 'Gin Khao backup', text: 'Gin Khao progress backup', files: [uri], dialogTitle: 'Save your backup' });
  return 'Backup ready. Save it to Drive or send it to yourself.';
}

export function importBackup(text: string): string | null {
  try {
    const raw = JSON.parse(text);
    if (raw?.v !== 1 || typeof raw.cards !== 'object') return "That file isn't a Gin Khao backup.";
    state = merge(raw);
    subs.forEach(s => s());
    save();
    return null;
  } catch {
    return "Couldn't read that file.";
  }
}
