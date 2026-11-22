import type { GameEvent } from "@solanasmash/sim";

/** Tiny WebAudio synth: no asset files. Created lazily on first user gesture (browser autoplay rules). */
let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem("smash.muted") === "1"; } catch { /* storage blocked */ }

function ac(): AudioContext | null {
  if (muted) return null;
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") void ctx.resume(); return ctx; } catch { return null; }
}

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.08, slide = 0, delay = 0) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.1) {
  const a = ac(); if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = buf; g.gain.value = vol; s.connect(g).connect(a.destination); s.start();
}

export const sfx = {
  events(events: GameEvent[]) {
    for (const e of events) {
      if (e.t === "hit") { noise(e.big ? 0.22 : 0.1, e.big ? 0.22 : 0.12); tone(e.big ? 110 : 180, 0.12, "square", 0.1, -60); }
      else if (e.t === "block") tone(520, 0.06, "triangle", 0.08);
      else if (e.t === "ko") { tone(300, 0.5, "sawtooth", 0.1, -240); noise(0.4, 0.2); }
      else if (e.t === "jump") tone(330, 0.09, "square", 0.04, 220);
      else if (e.t === "swing") noise(0.05, 0.05);
    }
  },
  beep(n: number) { tone(n === 0 ? 880 : 440, n === 0 ? 0.3 : 0.12, "square", 0.08); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, "square", 0.08, 0, i * 0.12)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, "triangle", 0.09, 0, i * 0.18)); },
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem("smash.muted", muted ? "1" : "0"); } catch { /* ignore */ }
    return muted;
  },
};
