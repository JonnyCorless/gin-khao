import { useState } from 'preact/hooks';
import { play } from '../audio';
import { C } from '../data';
import { randomPrice } from '../lesson';
import { isLearned, learnedCount } from '../srs';
import { useProgress } from '../store';
import type { Phrase } from '../types';
import { tap } from '../ui/haptics';
import { Icon } from '../ui/icons';
import { Lesson } from '../ui/Lesson';
import { PhraseCard } from '../ui/PhraseCard';

export function Browse({ open, setOpen }: { open: string | null; setOpen: (id: string | null) => void }) {
  useProgress();
  const sits = C().situations;
  const sit = sits.find(s => s.id === open);
  if (sit) return <SituationView id={sit.id} onBack={() => setOpen(null)} />;
  return (
    <div class="screen">
      <header class="screen-head">
        <h1>Browse</h1>
        <p class="muted">Everything, any time. Open a place before you go in.</p>
      </header>
      <div class="sit-grid">
        {sits.map(s => {
          const total = C().phrases.filter(p => p.situation === s.id).length;
          const n = learnedCount(s.id);
          return (
            <button class="sit-tile" key={s.id} onClick={() => { tap(); setOpen(s.id); }}>
              <span class="sit-icon"><Icon name={s.icon} size={26} /></span>
              <b>{s.title}</b>
              <span class="th small" lang="th">{s.th}</span>
              <span class="meter" aria-label={`${n} of ${total} learned`}><span style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></span>
              <span class="muted small">{n}/{total} learned</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SituationView({ id, onBack }: { id: string; onBack: () => void }) {
  const [drill, setDrill] = useState<string[] | null>(null);
  const s = C().situations.find(x => x.id === id)!;
  const ps = C().phrases.filter(p => p.situation === id);
  const hear = ps.filter(p => p.kind === 'hear');
  // replies already shown under the staff lines aren't repeated in "You can say"
  const replied = new Set(hear.flatMap(p => p.replies ?? []));
  const say = ps.filter(p => p.kind === 'say' && !replied.has(p.id));
  const words = ps.filter(p => p.kind === 'word');

  if (drill) {
    return <Lesson title="Price drill" exs={drill} onDone={() => setDrill(null)} onExit={() => setDrill(null)} />;
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
          <button class="card drill-cta" onClick={() => setDrill(Array.from({ length: 10 }, () => `price:${randomPrice()}`))}>
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
