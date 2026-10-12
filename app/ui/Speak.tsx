import { useState } from 'preact/hooks';
import { judge, listenThai, type Judgement } from '../speech';
import type { Item } from '../types';
import { bad, good, tap } from './haptics';
import { Icon } from './icons';
import { openLab } from './SpeakLab';

/** Tap, say the phrase, see whether a Thai ear would have understood you. */
export function SpeakCheck({ it, onResult }: { it: Item; onResult?: (ok: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Judgement | null>(null);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      const heard = await listenThai(it.th);
      const j = judge(it, heard);
      setRes(j);
      (j.ok ? good : bad)();
      onResult?.(j.ok);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <div class="speak">
      <button class="btn ghost" onClick={go} disabled={busy}><Icon name="mic" size={18} />{busy ? 'Listening…' : res ? 'Try again' : 'Say it'}</button>
      {res && (
        <div class={`speak-res ${res.ok ? 'ok' : 'no'}`}>
          <b>{res.ok ? 'Understood' : 'Not quite'}</b>
          <span>Heard: <span lang="th">{res.heard || '(nothing)'}</span></span>
        </div>
      )}
      {err && <p class="bad small">{err}</p>}
    </div>
  );
}

/** Opens the speaking lab: record & compare with pitch lines, or shadowing. */
export function SpeakLabButton({ it, small = false }: { it: Item; small?: boolean }) {
  return (
    <button class={small ? 'tool' : 'btn ghost'} onClick={e => { e.stopPropagation(); tap(); openLab(it); }}>
      <Icon name="wave" size={small ? 16 : 18} />{small ? 'Practise' : 'Compare'}
    </button>
  );
}
