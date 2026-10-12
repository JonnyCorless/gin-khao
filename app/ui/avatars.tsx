// The regulars, as soft line portraits. Fixed colours: each sits on its own pastel disc,
// which reads the same in light and dark mode.
import type { JSX } from 'preact';

const INK = '#1C2340';
const SKIN = { a: '#EDCBA8', b: '#D9AE86', c: '#C69872' };
const s = { stroke: INK, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

function Face({ skin, smile = 'M43 54q5 4 10 0', eyes = 'dots' }: { skin: string; smile?: string; eyes?: 'dots' | 'happy' }) {
  return (
    <g>
      <path d="M44 63h8v7h-8z" fill={skin} {...s} />
      <ellipse cx="48" cy="45" rx="15.5" ry="18" fill={skin} {...s} />
      {eyes === 'dots'
        ? <g fill={INK}><circle cx="42" cy="45" r="1.7" /><circle cx="54" cy="45" r="1.7" /></g>
        : <g fill="none" {...s}><path d="M39.5 45.5q2.5-2.5 5 0" /><path d="M51.5 45.5q2.5-2.5 5 0" /></g>}
      <path d={smile} fill="none" {...s} />
      <path d="M47 48.5q1 2-1 2.6" fill="none" {...s} stroke-width={1.2} />
    </g>
  );
}

const Body = ({ fill, d = 'M17 96c2-17 14-25 31-25s29 8 31 25z' }: { fill: string; d?: string }) => <path d={d} fill={fill} {...s} />;

const PORTRAITS: Record<string, () => JSX.Element> = {
  // 7-Eleven: young, ponytail, green work polo with collar
  may: () => (
    <g>
      <Body fill="#5E9C76" />
      <path d="M40 72l8 8 8-8" fill="#fff" {...s} />
      <path d="M62 34c8 2 10 14 5 22" fill="#2B2420" {...s} />
      <Face skin={SKIN.a} eyes="happy" />
      <path d="M32.5 44c-1-15 8-22 16-22s16 6 15.5 21c-4-6-11-9-18-9c-5 0-10 3-13.5 10z" fill="#2B2420" {...s} />
    </g>
  ),
  // Khao soi stall: grey bun, apron
  noi: () => (
    <g>
      <Body fill="#B0563A" />
      <path d="M33 96V80q15 6 30 0v16z" fill="#FFF8EC" {...s} />
      <circle cx="48" cy="22" r="7" fill="#9A9690" {...s} />
      <Face skin={SKIN.b} eyes="happy" smile="M42 54q6 5 12 0" />
      <path d="M32.5 44c0-13 7-20 15.5-20s15.5 7 15.5 20c-3-6-9-9-15.5-9s-12.5 3-15.5 9z" fill="#9A9690" {...s} />
      <path d="M36.5 49.5l2 1M59.5 49.5l-2 1" {...s} />
    </g>
  ),
  // Petrol station: red cap, red shirt
  ploy: () => (
    <g>
      <Body fill="#C8463A" />
      <path d="M58 36c6 4 7 14 3 22" fill="#2B2420" {...s} />
      <Face skin={SKIN.a} />
      <path d="M32 38c1-10 8-15 16-15s15 5 16 15z" fill="#C8463A" {...s} />
      <path d="M30 38h26" {...s} stroke-width={2.4} />
    </g>
  ),
  // Repair shop: short hair, cap backwards, towel on shoulder
  tum: () => (
    <g>
      <Body fill="#4A5A7A" />
      <path d="M22 86q8-12 18-14l2 8q-10 2-14 10z" fill="#E9A23B" {...s} />
      <Face skin={SKIN.c} smile="M44 55q4 2 8 0" />
      <path d="M32.5 42c0-12 7-18 15.5-18s15.5 6 15.5 18c-2-4-8-7-15.5-7s-13.5 3-15.5 7z" fill="#2B2420" {...s} />
      <path d="M33 33q15-12 30 0q-3 3-15 3t-15-3z" fill="#3A4A6A" {...s} />
      <path d="M33 33q-5 1-8 3" {...s} stroke-width={2.4} />
    </g>
  ),
  // Pharmacy: bob, glasses, white coat
  fon: () => (
    <g>
      <Body fill="#FFFFFF" />
      <path d="M40 72l8 12 8-12" fill="#7FB7C9" {...s} />
      <path d="M31 44c-1 9 1 16 4 18M65 44c1 9-1 16-4 18" fill="none" {...s} />
      <path d="M31 47c-2-15 6-24 17-24s19 9 17 24c-3-7-9-11-17-11s-14 4-17 11z" fill="#2B2420" {...s} />
      <Face skin={SKIN.a} />
      <g fill="none" {...s}><circle cx="42" cy="45" r="4.2" /><circle cx="54" cy="45" r="4.2" /><path d="M46.2 45h3.6" /></g>
    </g>
  ),
  // Landlady: neat perm, gold earrings, purple blouse
  ying: () => (
    <g>
      <Body fill="#7A5AA0" />
      <Face skin={SKIN.b} />
      <path d="M31 46c-4-17 5-25 17-25s21 8 17 25c-1-6-3-9-5-10c-4 3-10 3-14 0c-4 3-10 3-12 0c-2 1-3 4-3 10z" fill="#3A2E2A" {...s} />
      <g fill="#E2C25A" {...s} stroke-width={1}><circle cx="32.5" cy="53" r="2" /><circle cx="63.5" cy="53" r="2" /></g>
    </g>
  ),
  // Neighbour: bald top, grey sides, moustache, patterned shirt
  mon: () => (
    <g>
      <Body fill="#5C8DB8" />
      <g fill="#FFFFFF" opacity="0.7"><circle cx="30" cy="86" r="2" /><circle cx="40" cy="90" r="2" /><circle cx="58" cy="88" r="2" /><circle cx="67" cy="84" r="2" /></g>
      <Face skin={SKIN.c} eyes="happy" smile="M43 56q5 3 10 0" />
      <path d="M32.5 45c-1-5 1-9 3-11M63.5 45c1-5-1-9-3-11" fill="none" stroke="#9A9690" stroke-width={3.4} stroke-linecap="round" />
      <path d="M41 52.5q7-3 14 0q-7 2-14 0z" fill="#9A9690" {...s} />
    </g>
  ),
  // Police: peaked cap, khaki uniform
  chai: () => (
    <g>
      <Body fill="#8C7A55" />
      <path d="M40 72l8 8 8-8" fill="#6F6043" {...s} />
      <Face skin={SKIN.b} smile="M44 55h8" />
      <path d="M30 35q18-14 36 0v4H30z" fill="#6B5A3A" {...s} />
      <path d="M28 39h40q-6 5-20 5t-20-5z" fill="#2B2420" {...s} />
      <circle cx="48" cy="31" r="2.6" fill="#E2C25A" {...s} stroke-width={1} />
    </g>
  ),
};

export function Avatar({ id, color, size = 56 }: { id: string; color: string; size?: number }) {
  const P = PORTRAITS[id];
  return (
    <svg class="avatar" viewBox="0 0 96 96" width={size} height={size} aria-hidden="true">
      <defs><clipPath id={`clip-${id}`}><circle cx="48" cy="48" r="48" /></clipPath></defs>
      <circle cx="48" cy="48" r="48" fill={color} />
      <g clip-path={`url(#clip-${id})`}>{P ? <P /> : null}</g>
    </svg>
  );
}
