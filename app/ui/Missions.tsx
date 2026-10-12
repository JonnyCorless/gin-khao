import { useState } from 'preact/hooks';
import { item } from '../data';
import { anotherMission, BADGES, completeMission, missionDone, missions, todaysMission } from '../scenes';
import { P, useProgress } from '../store';
import type { Item, Mission } from '../types';
import { good } from './haptics';
import { Icon } from './icons';
import { PlayButton } from './PhraseCard';

function PhraseChips({ m }: { m: Mission }) {
  const its = m.phrases.map(item).filter(Boolean) as Item[];
  if (!its.length) return null;
  return (
    <div class="mission-phrases">
      {its.map(it => (
        <div class="mphrase" key={it.id}>
          <PlayButton id={it.id} size="sm" />
          <span><span class="th" lang="th">{it.th}</span><span class="rom small">{it.rom}</span></span>
        </div>
      ))}
    </div>
  );
}

export function MissionCard({ onAll }: { onAll: () => void }) {
  useProgress();
  const m = todaysMission();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const doneCount = Object.keys(P().missions).length;
  if (!m) return null;
  const done = missionDone(m.id);
  return (
    <section class="card mission">
      <div class="mission-head">
        <span class="eyebrow">Today's mission · out in the real world</span>
        <button class="link-btn" onClick={onAll}>All {doneCount ? `(${doneCount} done)` : ''}</button>
      </div>
      <h2>{m.title}</h2>
      <p class="muted">{m.detail}</p>
      <PhraseChips m={m} />
      {done ? (
        <p class="good-text"><Icon name="check" size={16} /> Done. Nice one.</p>
      ) : noting ? (
        <div class="mission-note">
          <label class="eyebrow" for="mnote">How did it go? (optional)</label>
          <textarea id="mnote" class="note-in" value={note} placeholder="She smiled and slowed down…" onInput={e => setNote((e.target as HTMLTextAreaElement).value)} />
          <div class="row">
            <button class="btn primary" onClick={() => { completeMission(m.id, note); good(); setNoting(false); }}>Save</button>
            <button class="btn ghost" onClick={() => setNoting(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div class="row">
          <button class="btn primary" onClick={() => setNoting(true)}>I did it</button>
          <button class="btn ghost" onClick={anotherMission}>Another one</button>
        </div>
      )}
    </section>
  );
}

export function MissionsView({ onBack }: { onBack: () => void }) {
  const p = useProgress();
  const all = missions();
  const n = Object.keys(p.missions).length;
  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div><h1>Missions</h1><span class="muted">{n} of {all.length} done</span></div>
      </header>
      <div class="badges">
        {BADGES.map(b => (
          <div key={b.n} class={`badge${n >= b.n ? ' on' : ''}`}>
            <Icon name={n >= b.n ? 'sparkle' : 'flag'} size={22} />
            <b>{b.name}</b>
            <span class="small">{b.n} mission{b.n > 1 ? 's' : ''}</span>
          </div>
        ))}
      </div>
      <div class="scene-list">
        {all.map(m => {
          const d = p.missions[m.id];
          return (
            <div key={m.id} class={`mission-row${d ? ' done' : ''}`}>
              <span class={`step-dot${d ? ' done' : ''}`}>{d ? <Icon name="check" size={14} /> : <Icon name="flag" size={14} />}</span>
              <span class="scene-row-text">
                <b>{m.title}</b>
                <span class="muted small">{m.detail}</span>
                {d?.note && <span class="mission-done-note">"{d.note}" · {d.date}</span>}
              </span>
              {!d && <button class="btn ghost sm" onClick={() => { completeMission(m.id); good(); }}>Done</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
