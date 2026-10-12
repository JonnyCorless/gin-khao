// A role-play scene: a chat with one of your regulars.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { play } from '../audio';
import { item } from '../data';
import { options, shuffle } from '../lesson';
import { character } from '../scenes';
import { judge, listenThai } from '../speech';
import { hearts, loseHeart, useProgress } from '../store';
import type { Item, Scene } from '../types';
import { Avatar } from './avatars';
import { bad, good, tap } from './haptics';
import { Icon } from './icons';
import { HeartsBar } from './Lesson';

type Msg = { who: 'they' | 'you' | 'narr' | 'task'; id?: string; text?: string };

export function ScenePlayer({ scene, onDone, onExit }: { scene: Scene; onDone: () => void; onExit: () => void }) {
  const p = useProgress();
  const ch = character(scene.who)!;
  const [i, setI] = useState(0);
  const [log, setLog] = useState<Msg[]>([{ who: 'narr', text: scene.setup }]);
  const [wrongPicked, setWrongPicked] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [hint, setHint] = useState('');
  const [listening, setListening] = useState(false);
  const [finished, setFinished] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false); // blocks a second tap before the screen redraws
  const step = scene.steps[i];
  const h = hearts(p);
  const outOfHearts = p.settings.hearts && h.n <= 0 && !finished;

  const choices = useMemo(() => (step?.reply ? shuffle([...step.reply, ...(step.wrong ?? [])]).map(item).filter(Boolean) as Item[] : []), [i]);
  const checkOpts = useMemo(() => (step?.check && step.they ? options({ type: 'meaning', id: step.they }) : []), [i]);

  // show each step as it arrives
  useEffect(() => {
    if (!step) return;
    setWrongPicked([]);
    setAnswered(false);
    lock.current = false;
    setHint('');
    if (step.they) {
      setLog(l => [...l, { who: 'they', id: step.they }]);
      const t = setTimeout(() => play(step.they!), 350);
      return () => clearTimeout(t);
    }
    if (step.narrate) setLog(l => [...l, { who: 'narr', text: step.narrate }]);
    if (step.you) setLog(l => [...l, { who: 'task', text: step.you }]);
  }, [i]);

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [log, answered, wrongPicked]);

  const next = () => {
    if (i + 1 >= scene.steps.length) { setFinished(true); good(); return; }
    setI(i + 1);
  };

  const choose = async (it: Item) => {
    if (answered || lock.current) return;
    if (step.reply?.includes(it.id)) {
      lock.current = true;
      setAnswered(true);
      good();
      setLog(l => [...l, { who: 'you', id: it.id }]);
      await play(it.id);
      setTimeout(next, 250);
    } else {
      bad();
      loseHeart();
      setWrongPicked(w => [...w, it.id]);
      setHint(`"${it.en}" doesn't fit here. Try again.`);
    }
  };

  const say = async () => {
    setListening(true);
    setHint('');
    try {
      const heard = await listenThai('');
      let best: { it: Item; score: number } | null = null;
      for (const c of choices) {
        const j = judge(c, heard);
        if (j.ok && (!best || j.score > best.score)) best = { it: c, score: j.score };
      }
      if (best) choose(best.it);
      else setHint(`Didn't catch that. Heard: ${heard[0] ?? '(nothing)'}`);
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e));
    }
    setListening(false);
  };

  const check = (it: Item) => {
    if (answered || lock.current) return;
    if (it.id === step.they) {
      lock.current = true;
      setAnswered(true);
      good();
      setLog(l => [...l, { who: 'narr', text: `You understood: "${it.en}"` }]);
      setTimeout(next, 500);
    } else {
      bad();
      loseHeart();
      setWrongPicked(w => [...w, it.id]);
      play(step.they!);
      setHint('Not quite. Listen again.');
    }
  };

  return (
    <div class="lesson scene">
      <header class="lesson-top">
        <button class="icon-btn" onClick={onExit} aria-label="Close"><Icon name="close" /></button>
        <div class="scene-who">
          <Avatar id={ch.avatar} color={ch.color} size={36} />
          <span><b>{ch.name}</b><span class="muted small">{scene.title}</span></span>
        </div>
        <HeartsBar />
      </header>

      <div class="chat" ref={chatRef}>
        {log.map((m, k) => <Bubble key={k} m={m} color={ch.color} avatar={ch.avatar} />)}
        {finished && (
          <div class="scene-end">
            <Avatar id={ch.avatar} color={ch.color} size={72} />
            <p>{scene.end}</p>
          </div>
        )}
      </div>

      <footer class="scene-foot">
        {finished ? (
          <button class="btn primary wide" onClick={onDone}>Done</button>
        ) : outOfHearts ? (
          <div class="center-text">
            <p class="muted">Out of hearts. Next one in {Math.max(1, Math.ceil(h.nextIn / 60000))} min.</p>
            <button class="btn primary wide" onClick={onExit}>OK</button>
          </div>
        ) : step?.reply ? (
          <>
            <div class="who">{step.you ? 'You say' : 'You reply'}</div>
            <div class="scene-choices">
              {choices.map(c => (
                <button key={c.id} class={`scene-choice${wrongPicked.includes(c.id) ? ' wrong' : ''}`} disabled={answered || wrongPicked.includes(c.id)}
                  onClick={() => { tap(); choose(c); }}>
                  <span class="th" lang="th">{c.th}</span>
                  <span class="rom">{c.rom}</span>
                  <span class="en">{c.en}</span>
                </button>
              ))}
            </div>
            <div class="scene-tools">
              <button class="btn ghost sm" onClick={say} disabled={listening || answered}><Icon name="mic" size={16} />{listening ? 'Listening…' : 'Say it instead'}</button>
              {step.they && <button class="btn ghost sm" onClick={() => play(step.they!)}><Icon name="play" size={14} />Again</button>}
            </div>
          </>
        ) : step?.check ? (
          <>
            <div class="who">What did {ch.name.split(' ').pop()} say?</div>
            <div class="q-opts">
              {checkOpts.map(c => (
                <button key={c.id} class={`q-opt${wrongPicked.includes(c.id) ? ' wrong' : ''}${answered && c.id === step.they ? ' right' : ''}`}
                  disabled={answered || wrongPicked.includes(c.id)} onClick={() => check(c)}>{c.en}</button>
              ))}
            </div>
            <div class="scene-tools"><button class="btn ghost sm" onClick={() => play(step.they!)}><Icon name="play" size={14} />Again</button></div>
          </>
        ) : (
          <button class="btn primary wide" onClick={() => { tap(); next(); }}>Continue</button>
        )}
        {hint && <p class="scene-hint">{hint}</p>}
      </footer>
    </div>
  );
}

function Bubble({ m, color, avatar }: { m: Msg; color: string; avatar: string }) {
  if (m.who === 'narr') return <p class="narr">{m.text}</p>;
  if (m.who === 'task') return <p class="task"><Icon name="sparkle" size={14} />{m.text}</p>;
  const it = item(m.id!)!;
  if (m.who === 'they') {
    return (
      <div class="bubble-row they">
        <Avatar id={avatar} color={color} size={30} />
        <button class="bubble they" onClick={() => play(it.id)}>
          <span class="th" lang="th">{it.th}</span>
          <span class="rom">{it.rom}</span>
        </button>
      </div>
    );
  }
  return (
    <div class="bubble-row you">
      <button class="bubble you" onClick={() => play(it.id)}>
        <span class="th" lang="th">{it.th}</span>
        <span class="rom">{it.rom}</span>
      </button>
    </div>
  );
}
