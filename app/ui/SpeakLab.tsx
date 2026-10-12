// The speaking lab: record yourself and compare with the native voice (with pitch lines),
// or shadow, speaking along with the voice. Nothing is graded except a gentle "pitch shape" hint.
import { useEffect, useRef, useState } from 'preact/hooks';
import { play, playUrl, stop } from '../audio';
import type { Item } from '../types';
import { blobPitch, micBlocker, nativePitch, startRecording, type PitchLine, type Recorder, type Recording } from '../voice';
import { bad, good, tap } from './haptics';
import { Icon } from './icons';

let setter: ((it: Item | null) => void) | null = null;
let isOpen = false;

export function openLab(it: Item) { setter?.(it); }
/** For the Android back button. */
export function closeLab(): boolean {
  if (!isOpen || !setter) return false;
  setter(null);
  return true;
}

// ---- the pitch chart ----

const W = 320, H = 132, PAD = 10, RANGE = 9; // semitones above and below the middle

function paths(line: PitchLine | null): string[] {
  if (!line) return [];
  const out: string[] = [];
  let cur: string[] = [];
  for (const p of line.pts) {
    if (!p) { if (cur.length > 1) out.push(cur.join(' ')); cur = []; continue; }
    const y = Math.max(-RANGE, Math.min(RANGE, p.y));
    cur.push(`${(PAD + p.x * (W - 2 * PAD)).toFixed(1)},${(H / 2 - (y / RANGE) * (H / 2 - PAD)).toFixed(1)}`);
  }
  if (cur.length > 1) out.push(cur.join(' '));
  return out;
}

export function PitchChart({ them, you }: { them: PitchLine | null; you?: PitchLine | null }) {
  return (
    <figure class="pitch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pitch lines: how the voice rises and falls">
        <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} class="pitch-mid" />
        {paths(them).map((d, i) => <polyline key={`t${i}`} points={d} class="pitch-them" />)}
        {paths(you ?? null).map((d, i) => <polyline key={`y${i}`} points={d} class="pitch-you" />)}
      </svg>
      <figcaption>
        <span class="key them" />Thai voice
        {you !== undefined && <><span class="key you" />You</>}
        {!them && <span class="muted"> · drawing…</span>}
      </figcaption>
    </figure>
  );
}

/** How alike two pitch shapes are, from -1 to 1 (correlation of the lines resampled to the same length). */
function shapeMatch(a: PitchLine, b: PitchLine): number | null {
  const N = 24;
  const sample = (l: PitchLine) => {
    const pts = l.pts.filter((p): p is { x: number; y: number } => !!p);
    if (pts.length < 5) return null;
    return Array.from({ length: N }, (_, i) => {
      const x = i / (N - 1);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      return best.y;
    });
  };
  const xa = sample(a), xb = sample(b);
  if (!xa || !xb) return null;
  const m = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = m(xa), mb = m(xb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < N; i++) { num += (xa[i] - ma) * (xb[i] - mb); da += (xa[i] - ma) ** 2; db += (xb[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- the lab ----

export function SpeakLab() {
  const [it, setIt] = useState<Item | null>(null);
  useEffect(() => { setter = setIt; return () => { setter = null; }; }, []);
  useEffect(() => { isOpen = !!it; if (!it) stop(); }, [it]);
  if (!it) return null;
  return <Lab key={it.id} it={it} onClose={() => setIt(null)} />;
}

function Lab({ it, onClose }: { it: Item; onClose: () => void }) {
  const [mode, setMode] = useState<'compare' | 'shadow'>('compare');
  const [them, setThem] = useState<PitchLine | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    nativePitch(it.id).then(setThem).catch(() => {});
    micBlocker().then(setBlocked);
  }, [it.id]);
  return (
    <div class="lab" role="dialog" aria-modal="true" aria-label="Speaking practice">
      <header class="lab-top">
        <button class="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={mode === 'compare'} class={mode === 'compare' ? 'on' : ''} onClick={() => { stop(); setMode('compare'); }}>Record & compare</button>
          <button role="tab" aria-selected={mode === 'shadow'} class={mode === 'shadow' ? 'on' : ''} onClick={() => { stop(); setMode('shadow'); }}>Shadow</button>
        </div>
      </header>
      <div class="lab-body">
        <div class="lab-phrase">
          <div class="th" lang="th">{it.th}</div>
          <div class="rom">{it.rom}</div>
          <div class="muted">{it.en}</div>
        </div>
        {mode === 'compare' ? <Compare it={it} them={them} blocked={blocked} /> : <Shadow it={it} them={them} />}
      </div>
    </div>
  );
}

function Compare({ it, them, blocked }: { it: Item; them: PitchLine | null; blocked: string | null }) {
  const [state, setState] = useState<'idle' | 'rec' | 'review'>('idle');
  const [take, setTake] = useState<Recording | null>(null);
  const [you, setYou] = useState<PitchLine | null>(null);
  const [err, setErr] = useState('');
  const [level, setLevel] = useState(0);
  const rec = useRef<Recorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { rec.current?.cancel(); clearTimeout(timer.current); if (take) URL.revokeObjectURL(take.url); }, []);

  const both = async (r: Recording | null = take) => {
    if (!r) return;
    await play(it.id);
    await wait(350);
    await playUrl('you', r.url);
  };

  const finish = async () => {
    clearTimeout(timer.current);
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    const done = await r.stop();
    setTake(done);
    setState('review');
    try { setYou(await blobPitch(done.blob)); } catch { setYou({ pts: [], seconds: 0 }); }
    both(done);
  };

  const record = async () => {
    setErr('');
    stop();
    try {
      rec.current = await startRecording();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    tap();
    setYou(null);
    setState('rec');
    const max = Math.max(3000, (them?.seconds ?? 2) * 2000 + 1000);
    timer.current = setTimeout(finish, max);
    const tick = () => { if (rec.current) { setLevel(rec.current.level()); requestAnimationFrame(tick); } };
    requestAnimationFrame(tick);
  };

  const match = them && you ? shapeMatch(them, you) : null;
  useEffect(() => { if (match !== null) (match >= 0.45 ? good : bad)(); }, [match !== null]);

  if (blocked) {
    return (
      <>
        <PitchChart them={them} />
        <p class="lab-note">{blocked}</p>
        <div class="lab-acts"><button class="btn primary" onClick={() => play(it.id)}><Icon name="play" size={18} />Play</button><button class="btn ghost" onClick={() => play(it.id, 0.7)}>Slow</button></div>
      </>
    );
  }

  return (
    <>
      <PitchChart them={them} you={state === 'review' ? you : undefined} />
      {state === 'review' && you && (
        <p class={`lab-verdict ${match === null ? '' : match >= 0.7 ? 'ok' : match >= 0.45 ? 'close' : 'no'}`}>
          {match === null ? "Couldn't hear enough voice. Try again a little louder."
            : match >= 0.7 ? 'Same shape. Your pitch rises and falls like theirs.'
            : match >= 0.45 ? 'Close. Look where the gold line goes a different way from the blue.'
            : 'A different shape. Listen to where their voice rises and falls, then try again.'}
        </p>
      )}
      {state !== 'review' && <p class="lab-note">{state === 'rec' ? 'Recording… say it now, then tap stop.' : 'Listen first. Then record yourself. You hear theirs and yours back to back, with both pitch lines.'}</p>}
      <div class="lab-acts">
        {state === 'rec' ? (
          <button class="rec-btn on" onClick={finish} aria-label="Stop recording" style={{ boxShadow: `0 0 0 ${4 + level * 18}px rgb(178 58 46 / 0.18)` }}>
            <span class="rec-square" />
          </button>
        ) : (
          <>
            <button class="btn ghost" onClick={() => play(it.id)}><Icon name="play" size={16} />Theirs</button>
            <button class="rec-btn" onClick={record} aria-label={state === 'review' ? 'Record again' : 'Record'}><Icon name="mic" size={30} /></button>
            {state === 'review' ? <button class="btn ghost" onClick={() => take && playUrl('you', take.url)}><Icon name="play" size={16} />Yours</button>
              : <button class="btn ghost" onClick={() => play(it.id, 0.7)}>Slow</button>}
          </>
        )}
      </div>
      {state === 'review' && <button class="link-btn center" onClick={() => both()}>Play both again</button>}
      {err && <p class="bad small center">{err}</p>}
    </>
  );
}

const ROUNDS: { rate: number; label: string }[] = [
  { rate: 0.7, label: 'slow' }, { rate: 0.7, label: 'slow' }, { rate: 1, label: 'normal' }, { rate: 1, label: 'normal' },
];

function Shadow({ it, them }: { it: Item; them: PitchLine | null }) {
  const [round, setRound] = useState(-1);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; stop(); }, []);
  const go = async () => {
    for (let r = 0; r < ROUNDS.length; r++) {
      if (!alive.current) return;
      setRound(r);
      await play(it.id, ROUNDS[r].rate);
      await wait(900);
    }
    if (alive.current) { setRound(ROUNDS.length); good(); }
  };
  const running = round >= 0 && round < ROUNDS.length;
  return (
    <>
      <PitchChart them={them} />
      <p class="lab-note">
        {running ? <>Round {round + 1} of {ROUNDS.length} · {ROUNDS[round].label}. Speak with the voice, out loud.</>
          : round === ROUNDS.length ? 'Done. Shadowing trains your mouth and your ear together. Do it again any time.'
          : 'Speak along with the voice, at the same time, four rounds: slow, slow, normal, normal. No marks, just copy the tune.'}
      </p>
      <div class="lab-acts">
        <button class="btn primary lg" onClick={() => { tap(); go(); }} disabled={running}><Icon name="play" size={18} />{round === ROUNDS.length ? 'Again' : running ? 'Shadowing…' : 'Start'}</button>
      </div>
    </>
  );
}
