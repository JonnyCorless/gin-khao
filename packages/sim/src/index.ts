/**
 * SolanaSmash deterministic fighting core.
 *
 * Rules that keep this safe to use as the authority for real-money results:
 *  - Pure integer arithmetic (fixed point, 1 px = FP units). No Math.sin/cos/random, no Date.
 *  - step(state, inputs) is the ONLY thing that advances the game, and it depends on
 *    nothing but (state, inputs). Same inputs => same result on every machine.
 *  - The server runs this for the authoritative result; the client runs the same code for
 *    prediction.
 */

export const FP = 256;
export const TICK_RATE = 60;
export const MATCH_SECONDS = 300;
export const MATCH_FRAMES = MATCH_SECONDS * TICK_RATE;
export const SUDDEN_DEATH_FRAMES = 120 * TICK_RATE;
export const START_STOCKS = 3;

export const INPUT = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  JUMP: 16,
  ATTACK: 32,
  SPECIAL: 64,
  SHIELD: 128,
} as const;

export const A = {
  IDLE: 0,
  ATTACK: 1,
  SPECIAL: 2,
  SHIELD: 3,
  DODGE: 4,
  HITSTUN: 5,
  RESPAWN: 6,
} as const;

const fp = (v: number) => Math.round(v * FP);

// ---------- Stage (px) ----------
export const STAGE = {
  main: { left: 320, right: 960, top: 480, bottom: 560 },
  soft: [
    { left: 400, right: 560, top: 360 },
    { left: 720, right: 880, top: 360 },
  ],
  blast: { left: -200, right: 1480, top: -320, bottom: 900 },
  width: 1280,
  height: 720,
};

export const HURT_W = 40;
export const HURT_H = 64;

// ---------- Characters ----------
export interface Move {
  startup: number;
  active: number;
  recovery: number;
  hb: { x: number; y: number; w: number; h: number }; // px, relative to feet, facing right
  dmg: number;
  base: number; // knockback, px/frame * 100
  growth: number; // extra knockback per 100% damage, px/frame * 100
  dirx: number; // launch direction * 100 (mirrored by facing)
  diry: number;
  lunge?: number; // px/frame forward velocity while active
  projectile?: { speed: number; life: number; w: number; h: number; cooldown: number };
}

export interface Character {
  name: string;
  runSpeed: number;
  accel: number;
  friction: number;
  airSpeed: number;
  airAccel: number;
  jumpV: number;
  airJumpV: number;
  gravity: number;
  fallMax: number;
  fastFall: number;
  weight: number; // 100 = average, higher = harder to launch
  moves: { neutral: Move; forward: Move; up: Move; down: Move; special: Move };
}

export const CHARACTERS: Character[] = [
  {
    name: "Pounce",
    runSpeed: 4.6,
    accel: 0.6,
    friction: 0.55,
    airSpeed: 3.8,
    airAccel: 0.35,
    jumpV: 13.5,
    airJumpV: 12.5,
    gravity: 0.62,
    fallMax: 11,
    fastFall: 15,
    weight: 90,
    moves: {
      neutral: { startup: 3, active: 3, recovery: 8, hb: { x: 10, y: -50, w: 40, h: 24 }, dmg: 3, base: 150, growth: 40, dirx: 95, diry: -30 },
      forward: { startup: 9, active: 4, recovery: 18, hb: { x: 10, y: -48, w: 56, h: 28 }, dmg: 11, base: 420, growth: 650, dirx: 92, diry: -39 },
      up: { startup: 7, active: 5, recovery: 16, hb: { x: -24, y: -100, w: 48, h: 44 }, dmg: 9, base: 380, growth: 520, dirx: 10, diry: -99 },
      down: { startup: 6, active: 4, recovery: 16, hb: { x: 0, y: -14, w: 60, h: 14 }, dmg: 8, base: 300, growth: 300, dirx: 70, diry: -71 },
      special: { startup: 8, active: 6, recovery: 22, hb: { x: 0, y: -50, w: 56, h: 36 }, dmg: 9, base: 350, growth: 420, dirx: 80, diry: -60, lunge: 9 },
    },
  },
  {
    name: "Bork",
    runSpeed: 3.6,
    accel: 0.45,
    friction: 0.5,
    airSpeed: 3.0,
    airAccel: 0.28,
    jumpV: 12.5,
    airJumpV: 11.5,
    gravity: 0.7,
    fallMax: 12,
    fastFall: 16,
    weight: 115,
    moves: {
      neutral: { startup: 5, active: 3, recovery: 10, hb: { x: 8, y: -50, w: 46, h: 26 }, dmg: 4, base: 170, growth: 50, dirx: 95, diry: -30 },
      forward: { startup: 14, active: 5, recovery: 26, hb: { x: 8, y: -50, w: 70, h: 34 }, dmg: 14, base: 450, growth: 750, dirx: 92, diry: -39 },
      up: { startup: 9, active: 5, recovery: 20, hb: { x: -30, y: -104, w: 60, h: 48 }, dmg: 10, base: 400, growth: 560, dirx: 10, diry: -99 },
      down: { startup: 8, active: 4, recovery: 20, hb: { x: -10, y: -14, w: 80, h: 14 }, dmg: 9, base: 320, growth: 320, dirx: 70, diry: -71 },
      special: {
        startup: 10, active: 1, recovery: 20,
        hb: { x: 0, y: 0, w: 0, h: 0 },
        dmg: 6, base: 220, growth: 160, dirx: 90, diry: -43,
        projectile: { speed: 8, life: 70, w: 24, h: 16, cooldown: 40 },
      },
    },
  },
  {
    // Original character, archetype only: a Victorian consulting-detective silhouette
    // (deerstalker hat, coat, cane). Not any specific studio's likeness or design.
    name: "Quillborne",
    runSpeed: 5.0,
    accel: 0.65,
    friction: 0.58,
    airSpeed: 4.0,
    airAccel: 0.38,
    jumpV: 13.0,
    airJumpV: 12.0,
    gravity: 0.6,
    fallMax: 10.5,
    fastFall: 14,
    weight: 85,
    moves: {
      neutral: { startup: 2, active: 3, recovery: 7, hb: { x: 10, y: -50, w: 36, h: 22 }, dmg: 2, base: 140, growth: 35, dirx: 95, diry: -25 },
      forward: { startup: 8, active: 5, recovery: 16, hb: { x: 8, y: -48, w: 62, h: 26 }, dmg: 9, base: 380, growth: 520, dirx: 90, diry: -35 },
      up: { startup: 6, active: 6, recovery: 15, hb: { x: -26, y: -102, w: 52, h: 42 }, dmg: 7, base: 340, growth: 460, dirx: 15, diry: -98 },
      down: { startup: 5, active: 3, recovery: 14, hb: { x: 0, y: -14, w: 58, h: 14 }, dmg: 6, base: 280, growth: 260, dirx: 65, diry: -66 },
      special: {
        startup: 9, active: 5, recovery: 18, hb: { x: 20, y: -50, w: 70, h: 16 },
        dmg: 8, base: 330, growth: 400, dirx: 88, diry: -30, lunge: 11,
      },
    },
  },
  {
    // Original character, archetype only: a folkloric vampire-noble silhouette (cape,
    // pale face, red eyes). Not any specific studio's likeness, costume design or name.
    name: "Nightshade",
    runSpeed: 4.0,
    accel: 0.5,
    friction: 0.45,
    airSpeed: 4.2,
    airAccel: 0.4,
    jumpV: 12.8,
    airJumpV: 13.0,
    gravity: 0.52,
    fallMax: 9.5,
    fastFall: 13,
    weight: 100,
    moves: {
      neutral: { startup: 4, active: 3, recovery: 9, hb: { x: 10, y: -50, w: 42, h: 24 }, dmg: 3, base: 160, growth: 45, dirx: 95, diry: -30 },
      forward: { startup: 11, active: 5, recovery: 20, hb: { x: 8, y: -48, w: 64, h: 30 }, dmg: 12, base: 400, growth: 600, dirx: 90, diry: -35 },
      up: { startup: 8, active: 6, recovery: 18, hb: { x: -28, y: -104, w: 56, h: 46 }, dmg: 8, base: 360, growth: 480, dirx: 20, diry: -97 },
      down: { startup: 7, active: 4, recovery: 17, hb: { x: -8, y: -14, w: 70, h: 14 }, dmg: 7, base: 290, growth: 280, dirx: 70, diry: -68 },
      special: {
        startup: 6, active: 8, recovery: 24, hb: { x: 0, y: -50, w: 50, h: 36 },
        dmg: 10, base: 360, growth: 440, dirx: 85, diry: -45, lunge: 16,
      },
    },
  },
];

// ---------- State ----------
export interface Fighter {
  char: number;
  x: number; // FP, feet center
  y: number; // FP, feet
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  jumps: number; // air jumps remaining
  percent: number;
  stocks: number;
  action: number;
  af: number; // frames in current action
  move: number; // 0..4 index into move list for current attack
  hitstun: number;
  invuln: number;
  prev: number; // previous input, for edge detection
  hitLanded: boolean;
  shield: number;
  dropThrough: number;
  cooldown: number;
}

export interface Projectile {
  id: number;
  owner: 0 | 1;
  x: number;
  y: number;
  vx: number;
  life: number;
  char: number;
}

export type GameEvent =
  | { t: "hit"; x: number; y: number; player: number; big: boolean }
  | { t: "block"; x: number; y: number; player: number }
  | { t: "ko"; player: number }
  | { t: "jump"; player: number }
  | { t: "swing"; player: number };

export interface GameState {
  frame: number;
  fighters: [Fighter, Fighter];
  projs: Projectile[];
  nextProj: number;
  suddenDeath: boolean;
  sdStart: number;
  over: boolean;
  winner: -1 | 0 | 1; // -1 with over=true => draw (refund)
  events: GameEvent[];
}

export type Inputs = [number, number];

const MOVE_KEYS = ["neutral", "forward", "up", "down", "special"] as const;
const moveOf = (f: Fighter): Move => CHARACTERS[f.char].moves[MOVE_KEYS[f.move]];

function newFighter(char: number, x: number, facing: 1 | -1, stocks: number): Fighter {
  return {
    char, x: fp(x), y: fp(STAGE.main.top), vx: 0, vy: 0, facing, grounded: true, jumps: 1,
    percent: 0, stocks, action: A.IDLE, af: 0, move: 0, hitstun: 0, invuln: 0,
    prev: 0, hitLanded: false, shield: 300, dropThrough: 0, cooldown: 0,
  };
}

export function createState(chars: [number, number], opts: { stocks?: number } = {}): GameState {
  const stocks = opts.stocks ?? START_STOCKS;
  return {
    frame: 0,
    fighters: [newFighter(chars[0], 520, 1, stocks), newFighter(chars[1], 760, -1, stocks)],
    projs: [],
    nextProj: 1,
    suddenDeath: false,
    sdStart: 0,
    over: false,
    winner: -1,
    events: [],
  };
}

export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s));
}

/** FNV-1a over the canonical JSON (events excluded). Used to detect desyncs / log results. */
export function hashState(s: GameState): string {
  const { events: _e, ...rest } = s;
  const str = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------- Helpers ----------
const pressed = (inp: number, prev: number, bit: number) => (inp & bit) !== 0 && (prev & bit) === 0;
const held = (inp: number, bit: number) => (inp & bit) !== 0;

function approach(v: number, target: number, amt: number): number {
  if (v < target) return Math.min(v + amt, target);
  return Math.max(v - amt, target);
}

interface Rect { l: number; r: number; t: number; b: number }
const overlap = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

function hurtbox(f: Fighter): Rect {
  return { l: f.x - fp(HURT_W / 2), r: f.x + fp(HURT_W / 2), t: f.y - fp(HURT_H), b: f.y };
}

function startAction(f: Fighter, action: number, move = 0) {
  f.action = action;
  f.af = 0;
  f.move = move;
  f.hitLanded = false;
}

// ---------- Per-fighter update ----------
function moveFighter(f: Fighter) {
  const hw = fp(HURT_W / 2);
  const mainRect = STAGE.main;
  const mL = fp(mainRect.left), mR = fp(mainRect.right), mT = fp(mainRect.top), mB = fp(mainRect.bottom);

  // Horizontal
  f.x += f.vx;
  const feet = f.y;
  const head = f.y - fp(HURT_H);
  if (feet > mT && head < mB && f.x + hw > mL && f.x - hw < mR) {
    if (f.vx > 0 || f.x < (mL + mR) / 2) {
      f.x = mL - hw;
    } else {
      f.x = mR + hw;
    }
    f.vx = 0;
  }

  // Vertical
  const prevFeet = f.y;
  f.y += f.vy;
  f.grounded = false;

  if (f.vy >= 0) {
    // main block top
    if (prevFeet <= mT && f.y >= mT && f.x + hw > mL && f.x - hw < mR) {
      f.y = mT; f.vy = 0; f.grounded = true;
    } else if (f.dropThrough === 0) {
      for (const p of STAGE.soft) {
        const t = fp(p.top);
        if (prevFeet <= t && f.y >= t && f.x + hw > fp(p.left) && f.x - hw < fp(p.right)) {
          f.y = t; f.vy = 0; f.grounded = true;
          break;
        }
      }
    }
  } else {
    // bonk head on underside of main block
    const prevHead = prevFeet - fp(HURT_H);
    const newHead = f.y - fp(HURT_H);
    if (prevHead >= mB && newHead < mB && f.x + hw > mL && f.x - hw < mR) {
      f.y = mB + fp(HURT_H);
      f.vy = 0;
    }
  }
  if (f.grounded) f.jumps = 1;
}

function updateFighter(s: GameState, idx: 0 | 1, inp: number) {
  const f = s.fighters[idx];
  const c = CHARACTERS[f.char];
  const prev = f.prev;

  if (f.invuln > 0) f.invuln--;
  if (f.dropThrough > 0) f.dropThrough--;
  if (f.cooldown > 0) f.cooldown--;

  const dir = (held(inp, INPUT.RIGHT) ? 1 : 0) - (held(inp, INPUT.LEFT) ? 1 : 0);
  let gravity = true;

  switch (f.action) {
    case A.HITSTUN: {
      f.hitstun--;
      f.vx = Math.trunc((f.vx * 250) / 256);
      if (f.grounded) f.vx = Math.trunc((f.vx * 230) / 256);
      if (f.hitstun <= 0) startAction(f, A.IDLE);
      break;
    }
    case A.RESPAWN: {
      gravity = false;
      f.vx = 0; f.vy = 0;
      f.af++;
      const acted = (inp & (INPUT.LEFT | INPUT.RIGHT | INPUT.JUMP | INPUT.ATTACK | INPUT.SPECIAL)) !== 0;
      if (f.af >= 120 || (f.af > 30 && acted)) startAction(f, A.IDLE);
      break;
    }
    case A.ATTACK:
    case A.SPECIAL: {
      const m = moveOf(f);
      f.af++;
      if (f.grounded) f.vx = approach(f.vx, 0, fp(c.friction));
      else f.vx = Math.trunc((f.vx * 253) / 256);
      if (m.lunge) {
        if (f.af > m.startup && f.af <= m.startup + m.active) f.vx = f.facing * fp(m.lunge);
        if (f.af === m.startup + m.active + 1) f.vx = Math.trunc(f.vx / 3);
      }
      if (m.projectile && f.af === m.startup) {
        s.projs.push({
          id: s.nextProj++, owner: idx,
          x: f.x + f.facing * fp(30), y: f.y - fp(44),
          vx: f.facing * fp(m.projectile.speed), life: m.projectile.life, char: f.char,
        });
        f.cooldown = m.projectile.cooldown;
      }
      if (f.af >= m.startup + m.active + m.recovery) startAction(f, A.IDLE);
      break;
    }
    case A.SHIELD: {
      f.vx = approach(f.vx, 0, fp(c.friction * 2));
      if (!held(inp, INPUT.SHIELD) || !f.grounded) {
        startAction(f, A.IDLE);
      } else if (pressed(inp, prev, INPUT.LEFT) || pressed(inp, prev, INPUT.RIGHT)) {
        f.facing = pressed(inp, prev, INPUT.RIGHT) ? 1 : -1;
        startAction(f, A.DODGE);
        f.invuln = Math.max(f.invuln, 14);
      } else {
        f.shield = Math.max(0, f.shield - 1);
        if (f.shield === 0) {
          startAction(f, A.HITSTUN);
          f.hitstun = 90; // shield break
          f.vx = 0;
        }
      }
      break;
    }
    case A.DODGE: {
      f.af++;
      f.vx = f.af < 16 ? f.facing * fp(6) : approach(f.vx, 0, fp(1.5));
      if (f.af >= 22) startAction(f, A.IDLE);
      break;
    }
    default: {
      // IDLE: free control
      if (f.shield < 300 && f.action === A.IDLE) f.shield = Math.min(300, f.shield + 1);
      const maxSpeed = f.grounded ? c.runSpeed : c.airSpeed;
      const acc = f.grounded ? c.accel : c.airAccel;
      if (dir !== 0) {
        f.facing = dir > 0 ? 1 : -1;
        f.vx = approach(f.vx, dir * fp(maxSpeed), fp(acc));
      } else if (f.grounded) {
        f.vx = approach(f.vx, 0, fp(c.friction));
      } else {
        f.vx = Math.trunc((f.vx * 251) / 256);
      }

      if (pressed(inp, prev, INPUT.JUMP) || pressed(inp, prev, INPUT.UP)) {
        if (f.grounded) {
          f.vy = -fp(c.jumpV); f.grounded = false; s.events.push({ t: "jump", player: idx });
        } else if (f.jumps > 0) {
          f.jumps--; f.vy = -fp(c.airJumpV); s.events.push({ t: "jump", player: idx });
        }
      }
      if (f.grounded && pressed(inp, prev, INPUT.DOWN)) f.dropThrough = 14;
      if (!f.grounded && held(inp, INPUT.DOWN) && f.vy > 0) f.vy = Math.max(f.vy, fp(c.fastFall));

      if (pressed(inp, prev, INPUT.ATTACK)) {
        const mv = held(inp, INPUT.UP) ? 2 : held(inp, INPUT.DOWN) ? 3 : dir !== 0 ? 1 : 0;
        startAction(f, A.ATTACK, mv);
        s.events.push({ t: "swing", player: idx });
      } else if (pressed(inp, prev, INPUT.SPECIAL) && f.cooldown === 0) {
        startAction(f, A.SPECIAL, 4);
        s.events.push({ t: "swing", player: idx });
      } else if (held(inp, INPUT.SHIELD) && f.grounded && f.shield > 20) {
        startAction(f, A.SHIELD);
      }
    }
  }

  if (gravity && !f.grounded) {
    // never *slow down* a fighter who was launched downward faster than terminal velocity
    f.vy = f.vy >= fp(c.fallMax) ? f.vy : Math.min(f.vy + fp(c.gravity), fp(c.fallMax));
    if (held(inp, INPUT.DOWN) && f.action === A.IDLE && f.vy > 0) f.vy = Math.max(f.vy, fp(c.fastFall));
  }
  if (f.action !== A.RESPAWN) moveFighter(f);
  f.prev = inp;
}

// ---------- Hits ----------
function hitboxRect(f: Fighter, m: Move): Rect {
  const { x, y, w, h } = m.hb;
  const l = f.facing === 1 ? f.x + fp(x) : f.x - fp(x + w);
  const t = f.y + fp(y);
  return { l, r: l + fp(w), t, b: t + fp(h) };
}

function applyHit(
  s: GameState, victimIdx: 0 | 1, attackerFacing: 1 | -1, m: Move, hx: number, hy: number,
) {
  const v = s.fighters[victimIdx];
  const c = CHARACTERS[v.char];
  if (v.action === A.SHIELD && v.invuln === 0) {
    v.shield = Math.max(0, v.shield - m.dmg * 6);
    v.vx = attackerFacing * fp(1.5);
    s.events.push({ t: "block", x: hx, y: hy, player: victimIdx });
    return true;
  }
  v.percent = Math.min(999, v.percent + m.dmg);
  const kb100 = Math.min(2600, Math.trunc(((m.base + Math.trunc((m.growth * v.percent) / 100)) * 100) / c.weight));
  v.vx = Math.trunc((m.dirx * attackerFacing * kb100 * FP) / 10000);
  v.vy = Math.trunc((m.diry * kb100 * FP) / 10000);
  v.grounded = false;
  startAction(v, A.HITSTUN);
  v.hitstun = 8 + Math.trunc(kb100 / 55);
  s.events.push({ t: "hit", x: hx, y: hy, player: victimIdx, big: kb100 > 900 });
  return true;
}

function resolveHits(s: GameState) {
  for (const ai of [0, 1] as const) {
    const a = s.fighters[ai];
    const vi = (1 - ai) as 0 | 1;
    const v = s.fighters[vi];
    if ((a.action !== A.ATTACK && a.action !== A.SPECIAL) || a.hitLanded) continue;
    const m = moveOf(a);
    if (m.projectile) continue;
    if (a.af <= m.startup || a.af > m.startup + m.active) continue;
    if (v.invuln > 0 || v.action === A.DODGE || v.action === A.RESPAWN) continue;
    const hb = hitboxRect(a, m);
    if (overlap(hb, hurtbox(v))) {
      a.hitLanded = true;
      applyHit(s, vi, a.facing, m, (hb.l + hb.r) >> 1, (hb.t + hb.b) >> 1);
    }
  }

  for (let i = s.projs.length - 1; i >= 0; i--) {
    const p = s.projs[i];
    const m = CHARACTERS[p.char].moves.special;
    const pr = m.projectile!;
    const vi = (1 - p.owner) as 0 | 1;
    const v = s.fighters[vi];
    const box: Rect = { l: p.x - fp(pr.w / 2), r: p.x + fp(pr.w / 2), t: p.y - fp(pr.h / 2), b: p.y + fp(pr.h / 2) };
    if (v.invuln === 0 && v.action !== A.DODGE && v.action !== A.RESPAWN && overlap(box, hurtbox(v))) {
      applyHit(s, vi, p.vx >= 0 ? 1 : -1, m, p.x, p.y);
      s.projs.splice(i, 1);
    }
  }
}

function updateProjectiles(s: GameState) {
  for (let i = s.projs.length - 1; i >= 0; i--) {
    const p = s.projs[i];
    p.x += p.vx;
    p.life--;
    const px = p.x / FP;
    if (p.life <= 0 || px < STAGE.blast.left || px > STAGE.blast.right) s.projs.splice(i, 1);
  }
}

// ---------- KO / end of match ----------
function checkKOs(s: GameState) {
  const b = STAGE.blast;
  for (const i of [0, 1] as const) {
    const f = s.fighters[i];
    if (f.stocks <= 0) continue;
    const x = f.x / FP, y = f.y / FP;
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) {
      f.stocks--;
      s.events.push({ t: "ko", player: i });
      f.percent = 0;
      f.vx = 0; f.vy = 0;
      f.shield = 300;
      f.jumps = 1;
      if (f.stocks > 0) {
        f.x = fp(640); f.y = fp(220);
        f.facing = i === 0 ? 1 : -1;
        startAction(f, A.RESPAWN);
        f.invuln = 150;
        f.grounded = false;
      }
    }
  }
}

function checkEnd(s: GameState) {
  const [a, b] = s.fighters;
  if (a.stocks <= 0 || b.stocks <= 0) {
    s.over = true;
    s.winner = a.stocks > 0 ? 0 : b.stocks > 0 ? 1 : -1;
    return;
  }
  if (!s.suddenDeath && s.frame >= MATCH_FRAMES) {
    if (a.stocks !== b.stocks) { s.over = true; s.winner = a.stocks > b.stocks ? 0 : 1; return; }
    if (a.percent !== b.percent) { s.over = true; s.winner = a.percent < b.percent ? 0 : 1; return; }
    // sudden death: one hit decides
    s.suddenDeath = true;
    s.sdStart = s.frame;
    for (const f of s.fighters) { f.stocks = 1; f.percent = 300; }
  } else if (s.suddenDeath && s.frame - s.sdStart >= SUDDEN_DEATH_FRAMES) {
    s.over = true; s.winner = -1; // draw -> escrow refund
  }
}

/** Advance the game by exactly one tick. Mutates and returns `s`. */
export function step(s: GameState, inputs: Inputs): GameState {
  if (s.over) return s;
  s.events = [];
  s.frame++;
  updateFighter(s, 0, inputs[0] | 0);
  updateFighter(s, 1, inputs[1] | 0);
  updateProjectiles(s);
  resolveHits(s);
  checkKOs(s);
  checkEnd(s);
  return s;
}

/** Sanitise untrusted wire input to a valid bitmask. */
export function sanitizeInput(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n | 0 : 0;
  let out = v & 0xff;
  // opposite directions cancel
  if ((out & INPUT.LEFT) && (out & INPUT.RIGHT)) out &= ~(INPUT.LEFT | INPUT.RIGHT);
  if ((out & INPUT.UP) && (out & INPUT.DOWN)) out &= ~(INPUT.UP | INPUT.DOWN);
  return out;
}

export * from "./protocol.ts";
