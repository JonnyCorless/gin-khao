// Your voice: record from the mic, and draw pitch lines (on the phone, no server).
import { Capacitor } from '@capacitor/core';
import { srcFor } from './audio';
import { nativeInfo } from './updater';

// ---- recording ----

export interface Recording { blob: Blob; url: string }

export interface Recorder {
  stop: () => Promise<Recording>;
  cancel: () => void;
  /** 0..1, for a live level meter */
  level: () => number;
}

/** The mic in the web view needs a permission the first APKs didn't declare (added in 0.3.0). */
export async function micBlocker(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return "This phone's web view can't record audio.";
  if (Capacitor.isNativePlatform()) {
    const info = await nativeInfo();
    if (info && info.versionCode < 300) return 'Recording needs app version 0.3.0. Update it in Settings › App updates.';
  }
  return null;
}

export async function startRecording(): Promise<Recorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    throw new Error('Gin Khao needs the microphone for this. Allow it when Android asks, or in Settings › Apps › Gin Khao › Permissions.');
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  // a small analyser for the level meter
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const release = () => { stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); };
  rec.start();
  return {
    level: () => {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      return Math.min(1, Math.sqrt(s / buf.length) * 6);
    },
    cancel: () => { try { rec.stop(); } catch { /* already stopped */ } release(); },
    stop: () => new Promise(resolve => {
      rec.onstop = () => {
        release();
        const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' });
        resolve({ blob, url: URL.createObjectURL(blob) });
      };
      rec.stop();
    }),
  };
}

// ---- pitch ----

const SR = 16000;
const HOP = 160; // 10 ms
const FRAME = 800; // 50 ms
const MIN_F = 70;
const MAX_F = 450;

/** A pitch line: time from 0 to 1 across the voiced part, pitch in semitones around the speaker's middle. */
export interface PitchLine { pts: ({ x: number; y: number } | null)[]; seconds: number }

async function decode(data: ArrayBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, SR, SR); // decoding resamples to the context's 16 kHz
  const ab = await ctx.decodeAudioData(data);
  if (ab.numberOfChannels === 1) return ab.getChannelData(0);
  const a = ab.getChannelData(0), b = ab.getChannelData(1);
  return a.map((x, i) => (x + b[i]) / 2);
}

/** YIN pitch estimate for one frame, in Hz, or null when it isn't voiced. */
function yin(x: Float32Array, start: number): number | null {
  const maxLag = Math.floor(SR / MIN_F), minLag = Math.floor(SR / MAX_F);
  const w = FRAME - maxLag;
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) { const v = x[start + i] - x[start + i + tau]; s += v * v; }
    d[tau] = s;
  }
  let run = 0;
  const c = new Float32Array(maxLag + 2);
  c[0] = 1;
  for (let tau = 1; tau <= maxLag + 1; tau++) { run += d[tau]; c[tau] = run ? (d[tau] * tau) / run : 1; }
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (c[tau] < 0.15) {
      while (tau + 1 <= maxLag && c[tau + 1] < c[tau]) tau++;
      const a = c[tau - 1], b = c[tau], e = c[tau + 1];
      const den = a - 2 * b + e;
      const shift = den ? (a - e) / (2 * den) : 0;
      return SR / (tau + shift);
    }
  }
  return null;
}

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function pitchLine(data: ArrayBuffer): Promise<PitchLine> {
  const x = await decode(data);
  const frames = Math.max(0, Math.floor((x.length - FRAME - 2) / HOP));
  const rms: number[] = [];
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < FRAME; i += 2) s += x[f * HOP + i] ** 2;
    rms.push(Math.sqrt(s / (FRAME / 2)));
  }
  const loud = Math.max(0.0001, ...rms);
  let hz: (number | null)[] = rms.map((r, f) => (r > loud * 0.12 ? yin(x, f * HOP) : null));
  // smooth: median of 5, and drop lone frames (usually a breath or a click)
  hz = hz.map((v, i) => {
    if (v === null) return null;
    const win = hz.slice(Math.max(0, i - 2), i + 3).filter((y): y is number => y !== null);
    return win.length >= 3 ? median(win) : null;
  });
  // drop runs of voice shorter than 50 ms: clicks and consonant noise, not part of the tune
  for (let i = 0; i < hz.length;) {
    if (hz[i] === null) { i++; continue; }
    let j = i;
    while (j < hz.length && hz[j] !== null) j++;
    if (j - i < 5) for (let k = i; k < j; k++) hz[k] = null;
    i = j;
  }
  // and a light 3-point average so the line reads as a line
  hz = hz.map((v, i) => {
    if (v === null) return null;
    const win = [hz[i - 1], v, hz[i + 1]].filter((y): y is number => y != null);
    return win.reduce((s, y) => s + y, 0) / win.length;
  });
  const voiced = hz.filter((v): v is number => v !== null);
  if (voiced.length < 3) return { pts: [], seconds: x.length / SR };
  const mid = median(voiced);
  const first = hz.findIndex(v => v !== null);
  let last = hz.length - 1;
  while (hz[last] === null) last--;
  const span = Math.max(1, last - first);
  const pts = hz.slice(first, last + 1).map((v, i) => {
    if (v === null) return null;
    const st = 12 * Math.log2(v / mid);
    return Math.abs(st) > 12 ? null : { x: i / span, y: st }; // a jump of more than an octave is an error
  });
  return { pts, seconds: x.length / SR };
}

const cache = new Map<string, Promise<PitchLine>>();

/** The native speaker's pitch line for an item (worked out once per item). */
export function nativePitch(id: string): Promise<PitchLine> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(srcFor(id)).then(r => r.arrayBuffer()).then(pitchLine);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export const blobPitch = async (blob: Blob) => pitchLine(await blob.arrayBuffer());
