import { useEffect, useRef, useState } from 'preact/hooks';
import { hasAudio, play, playUrl, stop } from '../audio';
import { item } from '../data';
import { quizFor, shuffle } from '../lesson';
import { deleteMine, saveMine, suggestUrl } from '../mine';
import { listenThai } from '../speech';
import { grade } from '../srs';
import { update, useProgress, type MyPhrase } from '../store';
import type { Item } from '../types';
import { micBlocker, startRecording, type Recorder, type Recording } from '../voice';
import { good, tap } from '../ui/haptics';
import { Icon } from '../ui/icons';
import { Lesson } from '../ui/Lesson';
import { PlayButton, togglePin } from '../ui/PhraseCard';
import { openLink, openShow } from '../ui/ShowOverlay';

export function ShowTab() {
  const p = useProgress();
  const [editing, setEditing] = useState(!p.address);
  const [form, setForm] = useState<MyPhrase | 'new' | null>(null);
  const [drill, setDrill] = useState<string[] | null>(null);
  const pins = p.pins.map(item).filter(Boolean) as Item[];
  const address: Item = { id: 'my-address', th: p.address, rom: '', en: 'My address' };

  if (drill) {
    return (
      <Lesson title="My phrases" exs={drill}
        onAnswer={({ ex, ok, first }) => { if (first && ex.type !== 'intro') grade(ex.id, ok ? 'good' : 'again'); }}
        onDone={() => setDrill(null)} onExit={() => setDrill(null)} />
    );
  }
  if (form) return <MyPhraseForm edit={form === 'new' ? null : form} onDone={() => setForm(null)} />;

  const practisable = p.mine.filter(m => m.th);
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
              <span class="th" lang="th">{it.th || it.en}</span>
              <span class="muted">{it.th ? it.en : ''}</span>
            </button>
            <button class="icon-btn" onClick={() => togglePin(it.id)} aria-label={`Unpin ${it.en}`}><Icon name="close" size={18} /></button>
          </div>
        ))}
        {pins.length === 0 && <p class="muted">No pinned cards. Tap Pin on any phrase in Browse or Food.</p>}
      </div>

      <section class="block">
        <div class="block-head">
          <h3>My phrases</h3>
          <button class="btn primary sm" onClick={() => { tap(); setForm('new'); }}><Icon name="plus" size={16} />Add</button>
        </div>
        <p class="muted">Something a local taught you? Save it here, and ask them to say it into your phone.</p>
        {p.mine.length > 0 && (
          <div class="cards">
            {p.mine.map(m => <MineCard key={m.id} m={m} pinned={p.pins.includes(m.id)} onEdit={() => setForm(m)} />)}
          </div>
        )}
        {practisable.length > 0 && (
          <button class="btn ghost" onClick={() => setDrill(shuffle(practisable).flatMap(m => [`intro:${m.id}`, quizFor(m.id)!]))}>Practise my phrases</button>
        )}
      </section>

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

function MineCard({ m, pinned, onEdit }: { m: MyPhrase; pinned: boolean; onEdit: () => void }) {
  const it = item(m.id) ?? { id: m.id, th: m.th, rom: m.rom, en: m.en };
  return (
    <article class="pcard mine">
      <div class="pcard-main">
        <div class="pcard-text">
          {m.th && <div class="th" lang="th">{m.th}</div>}
          {m.rom && <div class="rom">{m.rom}</div>}
          <div class="en">{m.en}</div>
          {m.note && <p class="note">{m.note}</p>}
        </div>
        <div class="pcard-acts">{hasAudio(m.id) && <PlayButton id={m.id} />}</div>
      </div>
      <div class="pcard-tools">
        {m.th && <button class="tool" onClick={() => openShow(it)}><Icon name="expand" size={16} />Show</button>}
        <button class={`tool${pinned ? ' on' : ''}`} onClick={() => togglePin(m.id)}><Icon name={pinned ? 'pinned' : 'pin'} size={16} />{pinned ? 'Pinned' : 'Pin'}</button>
        <button class="tool" onClick={onEdit}><Icon name="edit" size={16} />Edit</button>
        <button class="tool" onClick={() => openLink(suggestUrl(m))}><Icon name="flag" size={16} />Suggest</button>
      </div>
    </article>
  );
}

function MyPhraseForm({ edit, onDone }: { edit: MyPhrase | null; onDone: () => void }) {
  const [en, setEn] = useState(edit?.en ?? '');
  const [th, setTh] = useState(edit?.th ?? '');
  const [rom, setRom] = useState(edit?.rom ?? '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [take, setTake] = useState<Recording | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rec = useRef<Recorder | null>(null);

  useEffect(() => { micBlocker().then(setBlocked); return () => { rec.current?.cancel(); stop(); }; }, []);

  const hearIt = async () => {
    setErr('');
    setBusy('listen');
    try {
      const heard = await listenThai('Let them say it');
      if (heard[0]) setTh(heard[0]);
      else setErr("Didn't catch anything. Try again, closer to the phone.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy('');
  };

  const toggleRec = async () => {
    setErr('');
    if (recording && rec.current) {
      const r = await rec.current.stop();
      rec.current = null;
      setRecording(false);
      setTake(r);
      playUrl('take', r.url);
      return;
    }
    try {
      rec.current = await startRecording();
      setRecording(true);
      tap();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!en.trim()) { setErr('Add what it means in English.'); return; }
    setBusy('save');
    try {
      await saveMine({ en, th, rom, note }, take?.blob ?? null, edit?.id);
      good();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy('');
    }
  };

  return (
    <div class="screen">
      <header class="screen-head with-back">
        <button class="icon-btn" onClick={onDone} aria-label="Back"><Icon name="back" /></button>
        <div><h1>{edit ? 'Edit phrase' : 'Add a phrase'}</h1><span class="muted">Saved on this phone. Backups keep the words; recordings stay on the phone.</span></div>
      </header>

      <label class="field">
        <span class="eyebrow">What it means</span>
        <input value={en} placeholder="e.g. Not too much rice" onInput={e => setEn((e.target as HTMLInputElement).value)} />
      </label>

      <div class="field">
        <span class="eyebrow">In Thai (optional)</span>
        <textarea lang="th" class="addr" value={th} placeholder="Ask them to type it, or tap below and let them say it" onInput={e => setTh((e.target as HTMLTextAreaElement).value)} />
        <button class="btn ghost sm" onClick={hearIt} disabled={!!busy}><Icon name="mic" size={16} />{busy === 'listen' ? 'Listening…' : 'Let them say it (types it in)'}</button>
      </div>

      <label class="field">
        <span class="eyebrow">How it sounds to you (optional)</span>
        <input value={rom} placeholder="e.g. kâao nít-dieow" onInput={e => setRom((e.target as HTMLInputElement).value)} />
      </label>

      <div class="field">
        <span class="eyebrow">Their voice (optional)</span>
        {blocked ? <p class="muted small">{blocked}</p> : (
          <div class="row">
            <button class={`btn ${recording ? 'danger' : 'ghost'}`} onClick={toggleRec}><Icon name="mic" size={16} />{recording ? 'Stop' : take || edit?.audio ? 'Record again' : 'Record them saying it'}</button>
            {take && <button class="btn ghost" onClick={() => playUrl('take', take.url)}><Icon name="play" size={16} />Play</button>}
            {!take && edit?.audio && <button class="btn ghost" onClick={() => play(edit.id)}><Icon name="play" size={16} />Play</button>}
          </div>
        )}
        <span class="muted small">Ask them to say it slowly. You'll practise against their voice.</span>
      </div>

      <label class="field">
        <span class="eyebrow">Who taught you, where (optional)</span>
        <input value={note} placeholder="Pa Noi, at the market" onInput={e => setNote((e.target as HTMLInputElement).value)} />
      </label>

      {err && <p class="bad small">{err}</p>}
      <button class="btn primary wide" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
      {edit && (confirmDelete ? (
        <div class="row">
          <span class="small">Delete this phrase and its recording?</span>
          <button class="btn danger sm" onClick={async () => { await deleteMine(edit.id); onDone(); }}>Delete</button>
          <button class="btn ghost sm" onClick={() => setConfirmDelete(false)}>Keep</button>
        </div>
      ) : (
        <button class="link-btn" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} />Delete phrase</button>
      ))}
    </div>
  );
}
