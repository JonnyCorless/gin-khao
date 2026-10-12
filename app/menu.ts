// Menu checker: highlights offal, blood and raw words in pasted Thai menu text.
import type { Lvl } from './types';

type Key = [Lvl, RegExp, string];

const KEYS: Key[] = [
  ['avoid', /เครื่องใน/g, 'offal'],
  ['avoid', /ไส้(?!กรอก|อั่ว)/g, 'intestines'],
  ['avoid', /ตับ/g, 'liver'],
  ['avoid', /เลือด/g, 'blood'],
  ['avoid', /กระเพาะ/g, 'stomach (tripe)'],
  ['avoid', /ผ้าขี้ริ้ว/g, 'beef tripe'],
  ['avoid', /หัวใจ/g, 'heart'],
  ['avoid', /ปอด/g, 'lung'],
  ['avoid', /ม้าม/g, 'spleen'],
  ['avoid', /กึ๋น/g, 'gizzard'],
  ['avoid', /ก๋วยจั๊บ/g, 'guay jap comes with intestines'],
  ['avoid', /ลู่/g, 'lûu is raw blood'],
  ['avoid', /ลาบดิบ/g, 'raw larb'],
  ['care', /รวม/g, '"mixed", often includes offal'],
  ['care', /ตีน/g, 'feet'],
  ['care', /เอ็น/g, 'tendon'],
  ['care', /ดิบ/g, 'raw'],
  ['care', /ก้อย/g, 'raw meat salad'],
  ['care', /ปลาร้า/g, 'fermented fish'],
  ['care', /เรือ/g, 'boat noodles: blood in the broth'],
  ['care', /เกาเหลา/g, 'gao lǎo is often offal-heavy'],
  ['care', /พะโล้/g, 'stew, sometimes with intestines'],
  ['care', /ข้าวมันไก่/g, 'often served with blood and liver'],
  ['care', /น้ำเงี้ยว/g, 'náam-ngíao often has blood cubes'],
  ['care', /ลาบ(?!ดิบ)/g, 'larb: some versions add raw blood or liver'],
  ['care', /แกงอ่อม/g, 'often made with offal'],
  ['care', /จิ๊นส้ม|แหนม/g, 'fermented raw pork'],
  ['ok', /กะเพรา/g, 'holy basil (fine)'],
  ['ok', /ไส้กรอก/g, 'sausage (fine)'],
  ['ok', /ไส้อั่ว/g, 'Northern sausage (fine)'],
  ['ok', /ข้าวซอย/g, 'khao soi (usually fine)'],
  ['ok', /หมูสับ/g, 'minced pork'],
  ['ok', /หมู(?!สับ)/g, 'pork'],
  ['ok', /ไก่/g, 'chicken'],
  ['ok', /เนื้อ/g, 'beef'],
  ['ok', /กุ้ง/g, 'prawn'],
  ['ok', /ปลา(?!ร้า)/g, 'fish'],
  ['ok', /หมึก/g, 'squid'],
  ['ok', /เป็ด/g, 'duck'],
  ['ok', /ทะเล/g, 'seafood'],
];

export interface Hit { start: number; end: number; lvl: Lvl; why: string }
export interface LineResult { line: string; hits: Hit[]; verdict: Lvl }

export function checkMenu(text: string): LineResult[] {
  return text
    .split(/\n/)
    .map(s => s.trim())
    .filter(s => /[฀-๿]/.test(s))
    .map(line => {
      const all: Hit[] = [];
      for (const [lvl, re, why] of KEYS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) all.push({ start: m.index, end: m.index + m[0].length, lvl, why });
      }
      all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
      const hits: Hit[] = [];
      let end = -1;
      for (const h of all) if (h.start >= end) { hits.push(h); end = h.end; }
      const verdict: Lvl = hits.some(h => h.lvl === 'avoid') ? 'avoid' : hits.some(h => h.lvl === 'care') ? 'care' : 'ok';
      return { line, hits, verdict };
    });
}

export const SAMPLE_MENU = 'ก๋วยเตี๋ยวหมู เส้นเล็ก 50\nก๋วยจั๊บน้ำข้น 60\nเกาเหลารวม 70\nข้าวซอยไก่ 60\nข้าวมันไก่ 50\nขนมจีนน้ำเงี้ยว 50\nผัดกะเพราหมูสับ ไข่ดาว 60\nไส้อั่ว 80\nลาบเมือง 70';
