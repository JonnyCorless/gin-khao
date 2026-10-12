// My phrases: things locals teach you, saved on the phone with an optional recording of them saying it.
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { setAudioOverride } from './audio';
import { setMine } from './data';
import { P, today, update, type MyPhrase } from './store';
import { blobToBase64 } from './sync';

const native = Capacitor.isNativePlatform();
const DIR = Directory.Data;
const path = (m: Pick<MyPhrase, 'id' | 'audio'>) => `mine/${m.id}.${m.audio}`;

const extOf = (blob: Blob) => (blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm');

function sync() {
  setMine(P().mine.map(m => ({ id: m.id, th: m.th, rom: m.rom, en: m.en, note: m.note })));
}

/** On start: register your phrases and point their play buttons at your recordings. */
export async function initMine() {
  sync();
  if (!native) return;
  for (const m of P().mine) {
    if (!m.audio) continue;
    try {
      const { uri } = await Filesystem.getUri({ path: path(m), directory: DIR });
      setAudioOverride(m.id, Capacitor.convertFileSrc(uri));
    } catch { /* recording missing */ }
  }
}

export async function saveMine(fields: Omit<MyPhrase, 'id' | 'added' | 'audio'>, recording: Blob | null, id?: string): Promise<string> {
  const mid = id ?? `mine-${Date.now().toString(36)}`;
  const prev = P().mine.find(m => m.id === mid);
  let audio = prev?.audio;
  if (recording) {
    audio = extOf(recording);
    if (native) {
      await Filesystem.writeFile({ path: path({ id: mid, audio }), directory: DIR, data: await blobToBase64(recording), recursive: true });
      const { uri } = await Filesystem.getUri({ path: path({ id: mid, audio }), directory: DIR });
      setAudioOverride(mid, Capacitor.convertFileSrc(uri));
    } else {
      setAudioOverride(mid, URL.createObjectURL(recording)); // the web preview keeps it until reload
    }
  }
  const entry: MyPhrase = { id: mid, en: fields.en.trim(), th: fields.th.trim(), rom: fields.rom.trim(), note: fields.note?.trim() || undefined, audio, added: prev?.added ?? today() };
  update(p => { p.mine = prev ? p.mine.map(m => (m.id === mid ? entry : m)) : [entry, ...p.mine]; });
  sync();
  return mid;
}

export async function deleteMine(id: string) {
  const m = P().mine.find(x => x.id === id);
  update(p => {
    p.mine = p.mine.filter(x => x.id !== id);
    p.pins = p.pins.filter(x => x !== id);
    const { [id]: _, ...cards } = p.cards;
    p.cards = cards;
  });
  setAudioOverride(id, null);
  sync();
  if (m?.audio && native) await Filesystem.deleteFile({ path: path(m), directory: DIR }).catch(() => {});
}

/** A GitHub issue so the phrase can be checked and added to Gin Khao for everyone, with proper audio. */
export function suggestUrl(m: MyPhrase): string {
  const title = `New phrase: ${m.en}`;
  const body = `**English:** ${m.en}\n**Thai:** ${m.th || '(not typed)'}\n**Sounds like:** ${m.rom || '-'}\n**Where I heard it:** ${m.note || '-'}\n`;
  return `https://github.com/JonnyCorless/gin-khao/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
