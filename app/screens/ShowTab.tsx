import { useState } from 'preact/hooks';
import { item } from '../data';
import { update, useProgress } from '../store';
import type { Item } from '../types';
import { Icon } from '../ui/icons';
import { togglePin } from '../ui/PhraseCard';
import { openShow } from '../ui/ShowOverlay';

export function ShowTab() {
  const p = useProgress();
  const [editing, setEditing] = useState(!p.address);
  const pins = p.pins.map(item).filter(Boolean) as Item[];
  const address: Item = { id: 'my-address', th: p.address, rom: '', en: 'My address' };
  return (
    <div class="screen">
      <header class="screen-head">
        <h1>Show cards</h1>
        <p class="muted">Tap a card to fill the screen with it and hand your phone over. Pin more from any phrase. Long-press the Gin Khao icon to jump straight here.</p>
      </header>

      <div class="show-list">
        {pins.map(it => (
          <div class="show-card" key={it.id}>
            <button class="show-main" onClick={() => openShow(it)}>
              <span class="th" lang="th">{it.th}</span>
              <span class="muted">{it.en}</span>
            </button>
            <button class="icon-btn" onClick={() => togglePin(it.id)} aria-label={`Unpin ${it.en}`}><Icon name="close" size={18} /></button>
          </div>
        ))}
        {pins.length === 0 && <p class="muted">No pinned cards. Tap Pin on any phrase in Browse or Food.</p>}
      </div>

      <section class="block">
        <h3>My address</h3>
        <p class="muted">For Grab, deliveries and the water man. Paste it in Thai (ask your landlord to type it once).</p>
        {editing ? (
          <>
            <label class="eyebrow" for="addr">Address in Thai</label>
            <textarea id="addr" lang="th" class="addr" value={p.address} placeholder="บ้านเลขที่ …" onInput={e => update(x => { x.address = (e.target as HTMLTextAreaElement).value; })} />
            {p.address && <button class="btn primary" onClick={() => setEditing(false)}>Done</button>}
          </>
        ) : (
          <div class="show-card">
            <button class="show-main" onClick={() => openShow(address)}>
              <span class="th" lang="th">{p.address}</span>
              <span class="muted">My address</span>
            </button>
            <button class="icon-btn" onClick={() => setEditing(true)} aria-label="Edit address"><Icon name="edit" size={18} /></button>
          </div>
        )}
      </section>
    </div>
  );
}
