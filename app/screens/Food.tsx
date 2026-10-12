import { useEffect, useRef, useState } from 'preact/hooks';
import { play } from '../audio';
import { C, item } from '../data';
import { shuffle } from '../lesson';
import { checkMenu, SAMPLE_MENU } from '../menu';
import type { Item, Lvl } from '../types';
import { tap } from '../ui/haptics';
import { Icon } from '../ui/icons';
import { Lesson } from '../ui/Lesson';
import { PhraseCard, PlayButton } from '../ui/PhraseCard';
import { openShow } from '../ui/ShowOverlay';

const LVL: Record<Lvl, string> = { avoid: 'Offal', care: 'Ask first', ok: 'Usually fine' };
export const LvlChip = ({ l }: { l: Lvl }) => <span class={`lvl ${l}`}>{LVL[l]}</span>;

const MENU_KEY = 'gk.menu';
let shared: string | null = null;
const loadMenu = () => { if (shared !== null) return shared; try { return localStorage.getItem(MENU_KEY) ?? SAMPLE_MENU; } catch { return SAMPLE_MENU; } };

/** Text shared into Gin Khao: the menu checker opens with it. */
export function receiveMenu(text: string) {
  shared = text;
  try { localStorage.setItem(MENU_KEY, text); } catch { /* ignore */ }
}

function Tile({ it }: { it: Item }) {
  return (
    <div class="tile">
      <div class="tile-head">{it.lvl && <LvlChip l={it.lvl} />}<PlayButton id={it.id} size="sm" /></div>
      <div class="sign" lang="th">{it.th}</div>
      <div class="rom">{it.rom}</div>
      <div class="en">{it.en}</div>
      {it.note && <p class="note">{it.note}</p>}
    </div>
  );
}

function Row({ it }: { it: Item }) {
  return (
    <div class="row-item">
      <div class="row-text">
        <div class="row-top"><span class="sign" lang="th">{it.th}</span>{it.lvl && <LvlChip l={it.lvl} />}</div>
        <div class="rom">{it.rom}</div>
        <div class="en">{it.en}</div>
        {it.note && <p class="note">{it.note}</p>}
      </div>
      <PlayButton id={it.id} />
    </div>
  );
}

function Mini({ it }: { it: Item }) {
  return (
    <button class="mini" onClick={() => { tap(); play(it.id); }}>
      <span class="sign" lang="th">{it.th}</span>
      <span class="rom">{it.rom}</span>
      <span class="en">{it.en}</span>
    </button>
  );
}

function MenuChecker() {
  const [text, setText] = useState(loadMenu);
  const [fromShare] = useState(shared !== null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (shared === null) return;
    shared = null;
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, []);
  const save = (t: string) => { setText(t); try { localStorage.setItem(MENU_KEY, t); } catch { /* ignore */ } };
  const results = checkMenu(text);
  return (
    <section class="block" ref={ref} id="menu-checker">
      <h3>Menu checker</h3>
      {fromShare
        ? <p class="good-text">Menu received. Each dish gets a verdict below.</p>
        : <p class="muted">Point Google Lens at a menu, tap Text, select it all, then Share › Gin Khao. Or copy and paste it here, one dish per line. An example menu is loaded.</p>}
      <label class="eyebrow" for="menu-in">Menu text</label>
      <textarea id="menu-in" lang="th" spellcheck={false} value={text} onInput={e => save((e.target as HTMLTextAreaElement).value)} />
      <div class="row">
        <button class="btn ghost" onClick={() => save(SAMPLE_MENU)}>Load example</button>
        <button class="btn ghost" onClick={() => save('')}>Clear</button>
      </div>
      <div class="results" aria-live="polite">
        {results.length === 0 && <p class="muted">Paste a menu above and each dish gets a verdict here.</p>}
        {results.map((r, k) => {
          let at = 0;
          const parts = [];
          for (const h of r.hits) {
            parts.push(r.line.slice(at, h.start));
            parts.push(<mark class={h.lvl} key={h.start}>{r.line.slice(h.start, h.end)}</mark>);
            at = h.end;
          }
          parts.push(r.line.slice(at));
          const why = [...new Set(r.hits.map(h => h.why))].join(' · ');
          return (
            <div class="res" key={k}>
              <span class={`lvl ${r.verdict}`}>{r.verdict === 'avoid' ? 'Offal likely' : r.verdict === 'care' ? 'Ask first' : 'No offal words found'}</span>
              <div class="res-line" lang="th">{parts}</div>
              {why && <div class="muted small">{why}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Food() {
  const [drill, setDrill] = useState<string[] | null>(null);
  const f = C().food;
  if (drill) return <Lesson title="Spot-it drill" exs={drill} useHearts={false} onDone={() => setDrill(null)} onExit={() => setDrill(null)} />;
  const order = ['f-no-offal', 'f-has-offal', 'f-dont-eat-offal', 'f-no-blood', 'f-just-minced', 'f-what-meat'].map(item).filter(Boolean) as Item[];
  const myWay = item('f-my-way');
  const stomach = f.spot.find(x => x.id === 'w-stomach')!;
  return (
    <div class="screen">
      <header class="screen-head">
        <h1>Food guard</h1>
        <p class="muted">Street menus are mostly Thai only, and offal rarely gets an English label. Learn to spot about ten words by shape and you can dodge it.</p>
      </header>

      {myWay && (
        <button class="card usual" onClick={() => openShow(myWay)}>
          <span class="eyebrow">Your usual · tap to show</span>
          <span class="th big" lang="th">{myWay.th}</span>
          <span class="muted">{myWay.en}</span>
        </button>
      )}

      <button class="card drill-cta" onClick={() => setDrill(shuffle([...f.spot, ...f.dishes, ...f.northern]).slice(0, 10).map(x => `meaning:${x.id}`))}>
        <Icon name="search" size={26} />
        <span><b>Spot-it drill</b><span class="muted">10 menu words. No hearts at stake.</span></span>
        <Icon name="chevron" />
      </button>

      <section class="block">
        <h3>Say it before you order</h3>
        <div class="cards">{order.map(p => <PhraseCard key={p.id} it={p} />)}</div>
      </section>

      <section class="block">
        <h3>Words to spot on a menu</h3>
        <p class="muted">Shown in the plain lettering used on shop signs.</p>
        <div class="tiles">{f.spot.map(x => <Tile key={x.id} it={x} />)}</div>
      </section>

      <section class="block">
        <h3>The one that catches everyone</h3>
        <p class="muted">Nearly the same letters. Check the middle.</p>
        <div class="versus">
          <button class="vs bad" onClick={() => play(stomach.id)}><LvlChip l="avoid" /><span class="sign" lang="th">กระเพาะ</span><span class="rom">grà-pó</span><span>stomach</span></button>
          <button class="vs good" onClick={() => play(f.basil.id)}><LvlChip l="ok" /><span class="sign" lang="th">กะเพรา</span><span class="rom">gà-prao</span><span>holy basil</span></button>
        </div>
      </section>

      <section class="block">
        <h3>Chiang Mai dishes</h3>
        <div class="rows">{f.northern.map(x => <Row key={x.id} it={x} />)}</div>
      </section>

      <section class="block">
        <h3>Dishes that often include offal</h3>
        <div class="rows">{f.dishes.map(x => <Row key={x.id} it={x} />)}</div>
      </section>

      <section class="block">
        <h3>Usually offal-free</h3>
        <div class="minis">{f.safe.map(x => <Mini key={x.id} it={x} />)}</div>
      </section>

      <section class="block">
        <h3>Meat words</h3>
        <div class="minis">{f.meats.map(x => <Mini key={x.id} it={x} />)}</div>
      </section>

      <MenuChecker />
    </div>
  );
}
