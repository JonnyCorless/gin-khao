import { useState } from 'preact/hooks';
import { play } from '../audio';
import { C } from '../data';
import { itemExercises, randomPrice, shuffle } from '../lesson';
import { grade, isLearned, learnedCount } from '../srs';
import { noteMiss, useProgress } from '../store';
import type { Phrase, ScriptLesson, SoundSet } from '../types';
import { tap } from '../ui/haptics';
import { Icon } from '../ui/icons';
import { Lesson, type Answer } from '../ui/Lesson';
import { PhraseCard } from '../ui/PhraseCard';

type Seg = 'places' | 'read' | 'ears';
let lastSeg: Seg = 'places'; // remembered while the app is open

type Drill = { title: string; exs: string[] };

/** Grades script and sound-alike items on the first try at the real question: reading in silence,
 *  or picking which sound-alike you heard (the warm-up quiz after each intro isn't graded). */
function useItemGrader() {
  return ({ ex, ok, first }: Answer) => {
    if (ex.type === 'price' || ex.type === 'intro') return;
    noteMiss(ex.id, ok);
    if (first && (ex.type === 'read' || ex.type === 'sound')) grade(ex.id, ok ? 'good' : 'again');
  };
}

export function Browse({ open, setOpen }: { open: string | null; setOpen: (id: string | null) => void }) {
  useProgress();
  const [seg, setSegState] = useState<Seg>(lastSeg);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [detail, setDetail] = useState<ScriptLesson | null>(null);
  const onAnswer = useItemGrader();
  const setSeg = (s: Seg) => { lastSeg = s; setSegState(s); };
  const sits = C().situations;
  const sit = sits.find(s => s.id === open);
  if (drill) return <Lesson title={drill.title} exs={drill.exs} onAnswer={onAnswer} onDone={() => setDrill(null)} onExit={() => setDrill(null)} />;
  if (sit) return <SituationView id={sit.id} onBack={() => setOpen(null)} />;
  if (detail) return <ScriptDetail les={detail} onBack={() => setDetail(null)} onDrill={setDrill} />;
  return (
    <div class="screen">
      <header class="screen-head">
        <h1>Browse</h1>
        <div class="seg wide" role="tablist">
          <button role="tab" aria-selected={seg === 'places'} class={seg === 'places' ? 'on' : ''} onClick={() => setSeg('places')}>Places</button>
          <button role="tab" aria-selected={seg === 'read'} class={seg === 'read' ? 'on' : ''} onClick={() => setSeg('read')}>Read</button>
          <button role="tab" aria-selected={seg === 'ears'} class={seg === 'ears' ? 'on' : ''} onClick={() => setSeg('ears')}>Ears</button>
        </div>
      </header>
      {seg === 'places' && <Places onOpen={id => { tap(); setOpen(id); }} />}
      {seg === 'read' && <Read onDetail={setDetail} onDrill={setDrill} />}
      {seg === 'ears' && <Ears onDrill={setDrill} onOpen={id => { tap(); setOpen(id); }} />}
    </div>
  );
}

function Places({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <>
      <p class="muted">Everything, any time. Open a place before you go in.</p>
      <div class="sit-grid">
        {C().situations.map(s => {
          const total = C().phrases.filter(p => p.situation === s.id).length;
          const n = learnedCount(s.id);
          return (
            <button class="sit-tile" key={s.id} onClick={() => onOpen(s.id)}>
              <span class="sit-icon"><Icon name={s.icon} size={26} /></span>
              <b>{s.title}</b>
              <span class="th small" lang="th">{s.th}</span>
              <span class="meter" aria-label={`${n} of ${total} learned`}><span style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></span>
              <span class="muted small">{n}/{total} learned</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---- reading ----

function lessonDrill(les: ScriptLesson): Drill {
  const ids = les.items.map(i => i.id);
  const fresh = ids.filter(id => !isLearned(id));
  // new items get taught (intro + quiz); a lesson you know becomes a quick mixed drill
  return fresh.length
    ? { title: les.title, exs: itemExercises(fresh.slice(0, 8), 'read') }
    : { title: les.title, exs: shuffle(ids).slice(0, 10).map(id => `read:${id}`) };
}

function Read({ onDetail, onDrill }: { onDetail: (l: ScriptLesson) => void; onDrill: (d: Drill) => void }) {
  const lessons = C().script ?? [];
  const known = lessons.flatMap(l => l.items).filter(i => isLearned(i.id));
  return (
    <>
      <p class="muted">Sign words first: learn their shape, like a logo. Then the letters, a few at a time.</p>
      {known.length >= 6 && (
        <button class="card drill-cta" onClick={() => onDrill({ title: 'Reading review', exs: shuffle(known).slice(0, 12).map(i => `read:${i.id}`) })}>
          <Icon name="read" size={28} />
          <span><b>Mixed reading review</b><span class="muted">{known.length} words and letters you know</span></span>
          <Icon name="chevron" />
        </button>
      )}
      <div class="script-list">
        {lessons.map(les => {
          const n = les.items.filter(i => isLearned(i.id)).length;
          const fresh = les.items.length - n;
          return (
            <article class="card script-card" key={les.id}>
              <button class="script-card-main" onClick={() => { tap(); onDetail(les); }}>
                <span class={`script-preview script-${les.type}`} lang="th">{les.items.slice(0, les.type === 'sign' ? 3 : 6).map(i => i.th).join(les.type === 'sign' ? ' · ' : ' ')}</span>
                <b>{les.title}</b>
                <span class="muted small">{les.blurb}</span>
                <span class="meter"><span style={{ width: `${(n / les.items.length) * 100}%` }} /></span>
              </button>
              <div class="row">
                <button class={`btn ${fresh ? 'primary' : 'ghost'} sm`} onClick={() => onDrill(lessonDrill(les))}>{fresh ? (n ? `Next ${Math.min(fresh, 8)}` : 'Learn') : 'Practise'}</button>
                <span class="muted small">{n}/{les.items.length}</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function ScriptDetail({ les, onBack, onDrill }: { les: ScriptLesson; onBack: () => void; onDrill: (d: Drill) => void }) {
  useProgress();
  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div><h1>{les.title}</h1><span class="muted">{les.blurb}</span></div>
      </header>
      <button class="btn primary wide" onClick={() => onDrill(lessonDrill(les))}>{les.items.some(i => !isLearned(i.id)) ? 'Learn these' : 'Practise these'}</button>
      <div class={`glyph-grid ${les.type}`}>
        {les.items.map(i => (
          <button key={i.id} class={`glyph${isLearned(i.id) ? ' learned' : ''}${i.cls ? ` ${i.cls}` : ''}`} onClick={() => { tap(); play(i.id); }}>
            <span class={`glyph-th script-${les.type}`} lang="th">{i.th}</span>
            <span class="rom">{i.rom}</span>
            <span class="muted small">{i.word ? `${i.en} · ${i.word}` : i.en}</span>
          </button>
        ))}
      </div>
      {les.type === 'letter' && (
        <p class="note">Colours show the class: <span class="cls-chip mid">mid</span> <span class="cls-chip low">low</span> <span class="cls-chip high">high</span>. You don't need classes yet. Later they tell you the tone.</p>
      )}
    </div>
  );
}

// ---- ears ----

function setDrill(set: SoundSet): Drill {
  const ids = set.words.map(w => w.id);
  if (ids.some(id => !isLearned(id))) return { title: set.title, exs: [...itemExercises(ids, 'sound'), ...shuffle([...ids, ...ids]).map(id => `sound:${id}`)] };
  return { title: set.title, exs: shuffle([...ids, ...ids, ...ids]).slice(0, 8).map(id => `sound:${id}`) };
}

function Ears({ onDrill, onOpen }: { onDrill: (d: Drill) => void; onOpen: (situation: string) => void }) {
  const sets = C().sounds ?? [];
  const lanna = C().situations.find(s => s.id === 'lanna');
  const allWords = sets.flatMap(s => s.words);
  return (
    <>
      <p class="muted">Train your ear on the sounds that trip everyone up, then the numbers and the Northern dialect.</p>
      <div class="practice">
        <button class="tile-btn" onClick={() => onDrill({ title: 'Price drill', exs: Array.from({ length: 10 }, () => `price:${randomPrice()}`) })}>
          <Icon name="coins" /><b>Prices</b><span>Catch the number</span>
        </button>
        {lanna && (
          <button class="tile-btn" onClick={() => onOpen(lanna.id)}>
            <Icon name="mountain" /><b>{lanna.title}</b><span lang="th">{lanna.th}</span>
          </button>
        )}
        {allWords.length > 0 && (
          <button class="tile-btn" onClick={() => onDrill({ title: 'Sound-alike mix', exs: shuffle(allWords).slice(0, 12).map(w => `sound:${w.id}`) })}>
            <Icon name="ear" /><b>Sound-alike mix</b><span>12 from every set</span>
          </button>
        )}
      </div>
      <h3>Sound-alikes</h3>
      <div class="cards">
        {sets.map(s => {
          const n = s.words.filter(w => isLearned(w.id)).length;
          return (
            <article class="card sound-card" key={s.id}>
              <div class="sound-head">
                <b>{s.title}</b>
                <button class={`btn ${n < s.words.length ? 'primary' : 'ghost'} sm`} onClick={() => onDrill(setDrill(s))}>{n < s.words.length ? 'Learn' : 'Drill'}</button>
              </div>
              <div class="rchips">
                {s.words.map(w => (
                  <button key={w.id} class="rchip" onClick={() => { tap(); play(w.id); }}>
                    <span class="th" lang="th">{w.th}</span>
                    <span class="rom">{w.rom}</span>
                    <span class="en">{w.en}</span>
                  </button>
                ))}
              </div>
              <p class="note">{s.tip}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}

// ---- a place ----

function SituationView({ id, onBack }: { id: string; onBack: () => void }) {
  const [drill, setDrillState] = useState<string[] | null>(null);
  const s = C().situations.find(x => x.id === id)!;
  const ps = C().phrases.filter(p => p.situation === id);
  const hear = ps.filter(p => p.kind === 'hear');
  // replies already shown under the staff lines aren't repeated in "You can say"
  const replied = new Set(hear.flatMap(p => p.replies ?? []));
  const say = ps.filter(p => p.kind === 'say' && !replied.has(p.id));
  const words = ps.filter(p => p.kind === 'word');

  if (drill) {
    return <Lesson title="Price drill" exs={drill} onDone={() => setDrillState(null)} onExit={() => setDrillState(null)} />;
  }

  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div>
          <h1>{s.title}</h1>
          <span class="th muted" lang="th">{s.th}</span>
        </div>
      </header>
      <p class="lede">{s.blurb}</p>

      {id === 'numbers' && (
        <section class="block">
          <button class="card drill-cta" onClick={() => setDrillState(Array.from({ length: 10 }, () => `price:${randomPrice()}`))}>
            <Icon name="coins" size={28} />
            <span><b>Price ear trainer</b><span class="muted">10 real prices, spoken the way shops say them</span></span>
            <Icon name="chevron" />
          </button>
          <div class="num-grid">
            {words.map(w => <NumTile key={w.id} p={w} />)}
          </div>
        </section>
      )}

      {hear.length > 0 && (
        <section class="block">
          <h3>They'll ask you</h3>
          <div class="cards">{hear.map(p => <PhraseCard key={p.id} it={p} they />)}</div>
        </section>
      )}
      {say.length > 0 && (
        <section class="block">
          <h3>You can say</h3>
          <div class="cards">{say.map(p => <PhraseCard key={p.id} it={p} />)}</div>
        </section>
      )}
      {id !== 'numbers' && words.length > 0 && (
        <section class="block">
          <h3>Words</h3>
          <div class="cards">{words.map(p => <PhraseCard key={p.id} it={p} />)}</div>
        </section>
      )}
    </div>
  );
}

function NumTile({ p }: { p: Phrase }) {
  const learned = isLearned(p.id);
  return (
    <button class={`num${learned ? ' learned' : ''}`} onClick={() => { tap(); play(p.id); }}>
      <b>{p.en}</b>
      <span class="th" lang="th">{p.th}</span>
      <span class="rom">{p.rom}</span>
    </button>
  );
}
