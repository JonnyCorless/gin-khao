import { hasAudio, play, usePlaying } from '../audio';
import { item } from '../data';
import { P, update, useProgress } from '../store';
import type { Item, Phrase } from '../types';
import { tap } from './haptics';
import { Icon } from './icons';
import { openShow } from './ShowOverlay';
import { SpeakLabButton } from './Speak';

export function PlayButton({ id, size = 'md' }: { id: string; size?: 'sm' | 'md' | 'lg' }) {
  const on = usePlaying(id);
  return (
    <button class={`play play-${size}${on ? ' on' : ''}`} onClick={e => { e.stopPropagation(); tap(); play(id); }} aria-label="Play">
      <Icon name="play" size={size === 'sm' ? 14 : size === 'lg' ? 26 : 18} />
    </button>
  );
}

export function togglePin(id: string) {
  update(p => { p.pins = p.pins.includes(id) ? p.pins.filter(x => x !== id) : [...p.pins, id]; });
}

/** A phrase: Thai, toned romanisation, English, audio, Show and pin. "they" styles it as something said to you. */
export function PhraseCard({ it, they = false, showReplies = true }: { it: Item | Phrase; they?: boolean; showReplies?: boolean }) {
  const prog = useProgress();
  const pinned = prog.pins.includes(it.id);
  const replies = showReplies ? ((it as Phrase).replies ?? []).map(item).filter(Boolean) as Item[] : [];
  return (
    <article class={`pcard${they ? ' they' : ''}`}>
      <div class="pcard-main">
        <div class="pcard-text">
          {they && <div class="who">They say</div>}
          <div class="th" lang="th">{it.th}</div>
          <div class="rom">{it.rom}</div>
          <div class="en">{it.en}</div>
          {it.note && <p class="note">{it.note}</p>}
        </div>
        <div class="pcard-acts">
          <PlayButton id={it.id} />
          <button class="mini-btn" onClick={() => { tap(); play(it.id, 0.7); }}>slow</button>
        </div>
      </div>
      <div class="pcard-tools">
        <button class="tool" onClick={() => openShow(it.id)}><Icon name="expand" size={16} />Show</button>
        <button class={`tool${pinned ? ' on' : ''}`} onClick={() => togglePin(it.id)}><Icon name={pinned ? 'pinned' : 'pin'} size={16} />{pinned ? 'Pinned' : 'Pin'}</button>
        {hasAudio(it.id) && <SpeakLabButton it={it} small />}
      </div>
      {replies.length > 0 && (
        <div class="replies">
          <div class="who">You reply</div>
          <div class="rchips">
            {replies.map(r => (
              <button class="rchip" key={r.id} onClick={() => { tap(); play(r.id); }}>
                <span class="th" lang="th">{r.th}</span>
                <span class="rom">{r.rom}</span>
                <span class="en">{r.en}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export const isPinned = (id: string) => P().pins.includes(id);
