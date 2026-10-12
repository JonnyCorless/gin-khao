import { characters, character, familiarity, sceneDone, scenesFor, sceneUnlocked } from '../scenes';
import { useProgress } from '../store';
import type { Scene } from '../types';
import { Avatar } from './avatars';
import { tap } from './haptics';
import { Icon } from './icons';

export function RegularsRow({ onOpen }: { onOpen: (who: string) => void }) {
  useProgress();
  const cast = characters();
  if (!cast.length) return null;
  return (
    <section class="block">
      <h3>Your regulars</h3>
      <div class="regulars">
        {cast.map(c => {
          const f = familiarity(c.id);
          return (
            <button key={c.id} class="regular" onClick={() => { tap(); onOpen(c.id); }}>
              <Avatar id={c.avatar} color={c.color} size={60} />
              <b>{c.name}</b>
              <span class="muted small">{c.role}</span>
              <span class="dots" aria-label={`${f.done} of ${f.total} scenes`}>
                {Array.from({ length: f.total }, (_, k) => <i key={k} class={k < f.done ? 'on' : ''} />)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function RegularView({ who, onBack, onPlay }: { who: string; onBack: () => void; onPlay: (s: Scene) => void }) {
  useProgress();
  const c = character(who)!;
  const f = familiarity(who);
  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div><h1>{c.name}</h1><span class="th muted" lang="th">{c.th}</span></div>
      </header>
      <section class="card regular-card" style={{ background: c.color }}>
        <Avatar id={c.avatar} color={c.color} size={96} />
        <div>
          <div class="eyebrow dark">{c.role} · {f.label}</div>
          <p class="dark">{c.about}</p>
        </div>
      </section>
      <section class="block">
        <h3>Scenes</h3>
        <div class="scene-list">
          {scenesFor(who).map((s, k) => {
            const done = sceneDone(s.id);
            const open = sceneUnlocked(s);
            return (
              <button key={s.id} class={`scene-row${open ? '' : ' locked'}`} disabled={!open} onClick={() => { tap(); onPlay(s); }}>
                <span class={`step-dot${done ? ' done' : ''}`}>{done ? <Icon name="check" size={14} /> : k + 1}</span>
                <span class="scene-row-text"><b>{s.title}</b><span class="muted small">{open ? s.setup : 'Finish the scene before this one first.'}</span></span>
                <Icon name="chevron" size={18} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
