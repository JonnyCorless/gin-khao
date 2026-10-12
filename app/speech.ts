// Speaking check: Android's Thai speech recognition, judged leniently.
// It answers "would a Thai ear understand you?", not "were your tones perfect?".
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type { Item } from './types';

export async function listenThai(prompt: string): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) throw new Error('Speaking practice works in the installed app.');
  const { available } = await SpeechRecognition.available();
  if (!available) throw new Error('Speech recognition is not available. Install or update the Google app, then try again.');
  const perm = await SpeechRecognition.requestPermissions();
  if (perm.speechRecognition !== 'granted') throw new Error('Gin Khao needs the microphone for this. Allow it in Android settings.');
  const r = await SpeechRecognition.start({ language: 'th-TH', maxResults: 5, prompt, partialResults: false, popup: true });
  return r.matches ?? [];
}

// Polite endings and fillers that shouldn't decide right or wrong.
const ENDINGS = /(ครับ|คับ|ครัช|ค่ะ|คะ|ค่า|ฮะ|จ้ะ|จ้า|นะ)+$/;
export const normalizeThai = (s: string) => s.replace(/[\s.,!?'"\-–—…]/g, '').replace(ENDINGS, '');

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

export interface Judgement { ok: boolean; heard: string; score: number }

export function judge(target: Item, heard: string[]): Judgement {
  const goals = [target.th, ...(target.alt ?? [])].map(normalizeThai);
  let best: Judgement = { ok: false, heard: heard[0] ?? '', score: 0 };
  for (const h of heard) {
    const hn = normalizeThai(h);
    for (const g of goals) {
      const score = hn.includes(g) ? 1 : similarity(hn, g);
      if (score > best.score) best = { ok: score >= 0.75, heard: h, score };
    }
  }
  return best;
}
