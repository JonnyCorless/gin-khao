// The story path: My first month in Chiang Mai.
import { item } from '../data';
import { character, completeMission, missionDone, missions, sceneDone } from '../scenes';
import { chapterDone, chapterNew, chapterPhrases, chapters, chapterScenes, chapterUnlocked, currentChapter } from '../story';
import { useProgress } from '../store';
import type { Item, Scene } from '../types';
import { Avatar } from './avatars';
import { good, tap } from './haptics';
import { Icon } from './icons';
import { PlayButton } from './PhraseCard';

/** The card on Today: where you are in the story. */
export function StoryCard({ onOpen }: { onOpen: (index: number | null) => void }) {
  useProgress();
  const all = chapters();
  if (!all.length) return null;
  const cur = currentChapter();
  if (!cur) {
    return (
      <button class="card story-card done" onClick={() => onOpen(null)}>
        <span class="eyebrow">Story · complete</span>
        <h2>Your first month, done</h2>
        <span class="muted">All {all.length} chapters. Replay any of them.</span>
      </button>
    );
  }
  const scs = chapterScenes(cur.ch);
  const who = scs[0] ? character(scs[0].who) : undefined;
  const fresh = chapterNew(cur.ch).length;
  return (
    <section class="card story-card">
      <div class="story-card-head">
        {who && <Avatar id={who.avatar} color={who.color} size={52} />}
        <div>
          <span class="eyebrow">My first month · chapter {cur.index + 1} of {all.length}</span>
          <h2>{cur.ch.title}</h2>
        </div>
      </div>
      <p class="muted">{cur.ch.intro}</p>
      <div class="row">
        <button class="btn primary" onClick={() => { tap(); onOpen(cur.index); }}>{fresh ? `Start · ${fresh} new lines` : 'Continue'}</button>
        <button class="btn ghost" onClick={() => onOpen(null)}>All chapters</button>
      </div>
    </section>
  );
}

export function StoryView({ onBack, onOpen }: { onBack: () => void; onOpen: (index: number) => void }) {
  useProgress();
  const all = chapters();
  const done = all.filter(chapterDone).length;
  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div><h1>My first month</h1><span class="muted">{done} of {all.length} chapters</span></div>
      </header>
      <ol class="story-path">
        {all.map((ch, i) => {
          const open = chapterUnlocked(i);
          const fin = chapterDone(ch);
          return (
            <li key={ch.id} class={`chapter${fin ? ' done' : open ? ' open' : ' locked'}`}>
              <button disabled={!open} onClick={() => { tap(); onOpen(i); }}>
                <span class="chapter-dot">{fin ? <Icon name="check" size={16} /> : open ? i + 1 : <Icon name="lock" size={14} />}</span>
                <span class="chapter-text">
                  <b>{ch.title}</b>
                  <span class="th small muted" lang="th">{ch.th}</span>
                </span>
                {open && <Icon name="chevron" size={18} />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ChapterView({ index, onBack, onLearn, onScene, onNext }: {
  index: number;
  onBack: () => void;
  onLearn: (ids: string[]) => void;
  onScene: (s: Scene) => void;
  onNext: (index: number) => void;
}) {
  useProgress();
  const all = chapters();
  const ch = all[index];
  const scs = chapterScenes(ch);
  const lines = chapterPhrases(ch);
  const fresh = chapterNew(ch);
  const fin = chapterDone(ch);
  const m = ch.mission ? missions().find(x => x.id === ch.mission) : undefined;
  // a scene opens once the lines are learned (or nearly), and the scene before it is done
  const linesReady = fresh.length <= Math.floor(lines.length * 0.25);
  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div><span class="eyebrow">Chapter {index + 1}</span><h1>{ch.title}</h1></div>
      </header>
      <p class="story-intro">{ch.intro}</p>

      <ol class="beats">
        <li class={`beat${!fresh.length ? ' done' : ''}`}>
          <span class="step-dot">{!fresh.length ? <Icon name="check" size={14} /> : 1}</span>
          <div class="beat-body">
            <b>Learn the lines</b>
            <span class="muted small">{fresh.length ? `${fresh.length} new of ${lines.length}. Hear them, say them, check.` : `All ${lines.length} learned.`}</span>
            <button class={`btn ${fresh.length ? 'primary' : 'ghost'} sm`} onClick={() => onLearn(fresh.length ? fresh : lines)}>{fresh.length ? 'Learn' : 'Practise again'}</button>
          </div>
        </li>
        {scs.map((s, k) => {
          const d = sceneDone(s.id);
          const prevDone = k === 0 || sceneDone(scs[k - 1].id);
          const open = (linesReady || d) && prevDone;
          const c = character(s.who);
          return (
            <li key={s.id} class={`beat${d ? ' done' : ''}${open ? '' : ' locked'}`}>
              <span class="step-dot">{d ? <Icon name="check" size={14} /> : k + 2}</span>
              <div class="beat-body">
                <b>{s.title}</b>
                <span class="muted small">{c ? `With ${c.name}. ` : ''}{open ? s.setup : linesReady ? 'After the scene before.' : 'Learn the lines first.'}</span>
                {open && <button class={`btn ${d ? 'ghost' : 'primary'} sm`} onClick={() => onScene(s)}>{d ? 'Play again' : 'Play scene'}</button>}
              </div>
            </li>
          );
        })}
        {m && (
          <li class={`beat${missionDone(m.id) ? ' done' : ''}`}>
            <span class="step-dot">{missionDone(m.id) ? <Icon name="check" size={14} /> : <Icon name="flag" size={14} />}</span>
            <div class="beat-body">
              <b>Mission: {m.title}</b>
              <span class="muted small">{m.detail} Out in Chiang Mai, whenever you're ready.</span>
              <MissionPhrases ids={m.phrases} />
              {!missionDone(m.id) && <button class="btn ghost sm" onClick={() => { completeMission(m.id); good(); }}>I did it</button>}
            </div>
          </li>
        )}
      </ol>

      {fin && (
        <section class="card story-outro">
          <Icon name="sparkle" size={24} />
          <p>{ch.outro}</p>
          {index + 1 < all.length && <button class="btn primary" onClick={() => onNext(index + 1)}>Next: {all[index + 1].title}</button>}
        </section>
      )}
    </div>
  );
}

function MissionPhrases({ ids }: { ids: string[] }) {
  const its = ids.map(item).filter(Boolean) as Item[];
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

