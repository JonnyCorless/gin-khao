// Runs a list of exercises: intro cards, multiple choice, listening, prices.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { play } from '../audio';
import { category, item, phrase, scriptItem, scriptLessonOf, soundSetOf } from '../data';
import { decode, options, type Ex } from '../lesson';
import { hearts, loseHeart, MAX_HEARTS, useProgress } from '../store';
import type { Item } from '../types';
import { bad, good, tap } from './haptics';
import { Icon } from './icons';
import { PlayButton } from './PhraseCard';
import { SpeakCheck, SpeakLabButton } from './Speak';

/** first: the first time this question was asked in this lesson (repeats after a miss aren't graded again) */
export interface Answer { ex: Ex; ok: boolean; first: boolean }

interface Props {
  title: string;
  exs: string[];
  start?: number;
  useHearts?: boolean;
  /** Show a "Don't know" button (placement check), which counts as a wrong answer. */
  dontKnow?: boolean;
  /** Bring missed questions back a few cards later (with the intro again for new phrases). */
  requeue?: boolean;
  /** The question list changed (a miss was requeued), so a paused session can resume with it. */
  onQueue?: (queue: string[]) => void;
  onAnswer?: (a: Answer) => void;
  onProgress?: (index: number) => void;
  onDone: () => void;
  onExit: () => void;
}

export function HeartsBar() {
  const p = useProgress();
  const h = hearts(p);
  if (!p.settings.hearts) return null;
  return (
    <span class="hearts" aria-label={`${h.n} of ${MAX_HEARTS} hearts`}>
      {Array.from({ length: MAX_HEARTS }, (_, i) => <span class={i < h.n ? 'h on' : 'h'} key={i}><Icon name="heart" size={16} fill={i < h.n} /></span>)}
    </span>
  );
}

const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60000));

export function Lesson({ title, exs, start = 0, useHearts = true, dontKnow = false, requeue = true, onQueue, onAnswer, onProgress, onDone, onExit }: Props) {
  const p = useProgress();
  const [queue, setQueue] = useState(exs);
  const [i, setI] = useState(start);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<null | boolean>(null);
  const [skipped, setSkipped] = useState(false);
  const asked = useRef(new Set<string>());
  const raw = queue[Math.min(i, queue.length - 1)];
  // keyed on position too, so a repeated question still resets the screen
  const ex = useMemo(() => decode(raw), [raw, i]);
  const it = item(ex.id);
  const isChoice = ex.type === 'meaning' || ex.type === 'recall' || ex.type === 'listen' || ex.type === 'read' || ex.type === 'sound';
  const choices = useMemo(() => (isChoice ? options(ex) : []), [ex]);
  const h = hearts(p);
  const outOfHearts = useHearts && p.settings.hearts && h.n <= 0 && verdict === null;

  useEffect(() => {
    setPicked(null);
    setTyped('');
    setVerdict(null);
    setSkipped(false);
    // reading questions stay silent until answered, or the sound would give it away
    if (ex.type === 'intro' || ex.type === 'listen' || ex.type === 'price' || ex.type === 'meaning' || ex.type === 'sound') {
      const t = setTimeout(() => play(ex.id), 250);
      return () => clearTimeout(t);
    }
  }, [ex]);

  const answer = (ok: boolean) => {
    setVerdict(ok);
    (ok ? good : bad)();
    if (!ok && useHearts) loseHeart();
    const first = !asked.current.has(raw);
    asked.current.add(raw);
    onAnswer?.({ ex, ok, first });
    if ((!ok || ex.type === 'read') && ex.type !== 'price') play(ex.id);
    if (!ok && requeue && ex.type !== 'price') {
      // ask it again a few cards later; new phrases get their intro card again first
      const hadIntro = queue.slice(0, i).includes(`intro:${ex.id}`);
      const again = hadIntro ? [`intro:${ex.id}`, raw] : [raw];
      const at = Math.min(i + 4, queue.length);
      const q = [...queue.slice(0, at), ...again, ...queue.slice(at)];
      setQueue(q);
      onQueue?.(q);
    }
  };

  const next = () => {
    tap();
    if (i + 1 >= queue.length) { onDone(); return; }
    onProgress?.(i + 1);
    setI(i + 1);
  };

  const pct = Math.round((i / queue.length) * 100);

  return (
    <div class="lesson">
      <header class="lesson-top">
        <button class="icon-btn" onClick={onExit} aria-label="Close"><Icon name="close" /></button>
        <div class="bar" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
        {useHearts && <HeartsBar />}
      </header>

      {outOfHearts ? (
        <div class="lesson-body center">
          <div class="big-icon"><Icon name="heart" size={40} /></div>
          <h2>Out of hearts</h2>
          <p class="muted">Next heart in {mins(h.nextIn)} min. Your place is saved. Browse, Food and Show cards stay open meanwhile.</p>
          <button class="btn primary" onClick={onExit}>OK</button>
        </div>
      ) : (
        <div class="lesson-body">
          <div class="eyebrow">{title}</div>
          {ex.type === 'intro' && it && <Intro it={it} />}
          {isChoice && it && (
            <Choice ex={ex} it={it} choices={choices} picked={picked} reveal={verdict !== null}
              onPick={k => { if (verdict !== null) return; setPicked(k); answer(choices[k].id === it.id); }} />
          )}
          {ex.type === 'price' && (
            <Price n={ex.n!} id={ex.id} typed={typed} setTyped={setTyped} reveal={verdict !== null}
              onCheck={v => answer(v === ex.n)} />
          )}
        </div>
      )}

      {!outOfHearts && (ex.type === 'intro' ? (
        <footer class="lesson-foot"><button class="btn primary wide" onClick={next}>Next</button></footer>
      ) : verdict === null ? (dontKnow && (
        <footer class="lesson-foot"><button class="btn ghost wide" onClick={() => { setSkipped(true); answer(false); }}>Don't know</button></footer>
      )) : (
        <footer class={`lesson-foot fb ${verdict ? 'ok' : 'no'}`}>
          <div class="fb-text">
            <b>{verdict ? pickPraise() : skipped ? 'Here it is' : 'Not quite'}</b>
            {it && <span><span lang="th">{it.th}</span> · {it.rom} · {it.en}</span>}
            {ex.type === 'price' && <span>It was {ex.n!.toLocaleString('en-US')} baht</span>}
          </div>
          <button class="btn primary wide" onClick={next}>Continue</button>
        </footer>
      ))}
    </div>
  );
}

const PRAISE = ['Nice', 'Correct', 'Spot on', 'Yes', 'Good ear'];
const pickPraise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];

function Intro({ it }: { it: Item }) {
  const p = phrase(it.id);
  const cat = category(it.id);
  const s = scriptItem(it.id);
  const les = scriptLessonOf(it.id);
  const set = soundSetOf(it.id);
  const label = s ? (les?.type === 'letter' ? 'New letter' : les?.type === 'vowel' ? 'New vowel' : les?.type === 'digit' ? 'Thai digit' : 'New sign')
    : set ? 'Sound-alike' : p?.kind === 'hear' ? 'You will hear' : p?.kind === 'word' ? 'New word' : 'New phrase';
  return (
    <div class="intro">
      <div class="who">{label}</div>
      <div class={`intro-th${s ? ` script-${les?.type}` : ''}`} lang="th">{it.th}</div>
      <div class="intro-rom">{it.rom}</div>
      <div class="intro-en">{s?.word ? <>{it.en} <span class="muted">· as in {s.word}</span></> : it.en}</div>
      {s?.cls && <span class={`cls-chip ${s.cls}`}>{s.cls} class</span>}
      {it.note && <p class="note">{it.note}</p>}
      {set && <p class="note">{set.tip}</p>}
      <div class="intro-acts">
        <PlayButton id={it.id} size="lg" />
        <button class="btn ghost" onClick={() => play(it.id, 0.7)}>Slow</button>
        {(cat === 'phrase' || cat === 'food') && p?.kind !== 'hear' && <SpeakCheck it={it} />}
        {(cat === 'phrase' || cat === 'sound' || cat === 'food') && <SpeakLabButton it={it} />}
      </div>
    </div>
  );
}

function Choice({ ex, it, choices, picked, reveal, onPick }: { ex: Ex; it: Item; choices: Item[]; picked: number | null; reveal: boolean; onPick: (k: number) => void }) {
  const les = scriptLessonOf(it.id);
  const thaiOpts = ex.type === 'recall' || ex.type === 'sound';
  const prompt =
    ex.type === 'recall' ? <div class="q-en">{it.en}</div>
    : ex.type === 'read' ? <div class={`q-sign script-${les?.type ?? 'sign'}`} lang="th">{it.th}</div>
    : ex.type === 'sound' ? (
      <div class="q-listen">
        <PlayButton id={it.id} size="lg" />
        <span class="muted">Which one did you hear?</span>
        <button class="mini-btn" onClick={() => play(it.id, 0.7)}>slow</button>
      </div>
    )
    : ex.type === 'listen' && !reveal ? <div class="q-listen"><PlayButton id={it.id} size="lg" /><span class="muted">Listen, then pick what it means</span></div>
    : <div class="q-th" lang="th">{it.th}</div>;
  return (
    <div class="choice">
      <div class="q-prompt">
        {prompt}
        {reveal && ex.type !== 'recall' && ex.type !== 'sound' && <div class="rom">{it.rom}</div>}
        {(ex.type === 'meaning' || (ex.type === 'read' && reveal)) && <PlayButton id={it.id} size="sm" />}
      </div>
      {ex.type === 'read' && !reveal && <p class="muted center small">Read it, then pick. You'll hear it after.</p>}
      <div class={`q-opts${thaiOpts ? ' thai' : ''}`}>
        {choices.map((c, k) => {
          const cls = reveal ? (c.id === it.id ? ' right' : k === picked ? ' wrong' : ' dim') : '';
          return (
            <button key={c.id} class={`q-opt${cls}`} onClick={() => { if (ex.type === 'recall' && !reveal) play(c.id); onPick(k); }} disabled={reveal}>
              {thaiOpts ? <><span class="th" lang="th">{c.th}</span><span class="rom">{c.rom}</span>{ex.type === 'sound' && <span class="en small">{c.en}</span>}</> : c.en}
            </button>
          );
        })}
      </div>
      {reveal && ex.type === 'sound' && (
        <div class="replay-row">
          {choices.map(c => <button key={c.id} class="rchip" onClick={() => play(c.id)}><span class="th" lang="th">{c.th}</span><span class="rom">{c.rom}</span></button>)}
        </div>
      )}
    </div>
  );
}

function Price({ n, id, typed, setTyped, reveal, onCheck }: { n: number; id: string; typed: string; setTyped: (s: string) => void; reveal: boolean; onCheck: (v: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, [id]);
  return (
    <form class="price" onSubmit={e => { e.preventDefault(); const v = parseInt(typed.replace(/\D/g, ''), 10); if (!isNaN(v) && !reveal) onCheck(v); }}>
      <div class="q-listen"><PlayButton id={id} size="lg" /><span class="muted">Type the price you hear</span></div>
      <div class="price-row">
        <input ref={ref} id="price-in" inputMode="numeric" autoComplete="off" value={typed} onInput={e => setTyped((e.target as HTMLInputElement).value)} disabled={reveal} placeholder="baht" />
        <button class="btn primary" type="submit" disabled={reveal || !typed}>Check</button>
      </div>
      <button type="button" class="btn ghost" onClick={() => play(id, 0.7)}>Play slowly</button>
      {reveal && <div class="price-ans">{n.toLocaleString('en-US')} baht</div>}
    </form>
  );
}
