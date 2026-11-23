import test from "node:test";
import assert from "node:assert/strict";
import { createState, step, hashState, cloneState, CHARACTERS, INPUT, A, FP, STAGE, MATCH_FRAMES, sanitizeInput, type Inputs } from "../src/index.ts";

// tiny deterministic PRNG just for generating test inputs
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function run(seed: number, frames: number, chars: [number, number] = [0, 1]) {
  const r = lcg(seed);
  const s = createState(chars);
  const log: Inputs[] = [];
  for (let i = 0; i < frames && !s.over; i++) {
    const inp: Inputs = [Math.floor(r() * 256), Math.floor(r() * 256)];
    log.push(inp);
    step(s, inp);
  }
  return { s, log };
}

test("same inputs => identical state hash (determinism)", () => {
  for (const seed of [1, 2, 3, 42]) {
    const a = run(seed, 4000);
    const b = createState([0, 1]);
    for (const inp of a.log) step(b, inp);
    assert.equal(hashState(a.s), hashState(b));
  }
});

test("state clone continues identically (needed for client prediction)", () => {
  const { s } = run(7, 500);
  const c = cloneState(s);
  const r = lcg(99);
  for (let i = 0; i < 500; i++) {
    const inp: Inputs = [Math.floor(r() * 256), Math.floor(r() * 256)];
    step(s, inp); step(c, inp);
  }
  assert.equal(hashState(s), hashState(c));
});

test("fighters start standing on the stage", () => {
  const s = createState([0, 1]);
  step(s, [0, 0]);
  for (const f of s.fighters) {
    assert.equal(f.grounded, true);
    assert.equal(f.y, STAGE.main.top * FP);
  }
});

test("jump + double jump, third jump refused", () => {
  const s = createState([0, 1]);
  let y0 = s.fighters[0].y;
  step(s, [INPUT.JUMP, 0]);
  assert.ok(s.fighters[0].vy < 0);
  for (let i = 0; i < 5; i++) step(s, [0, 0]);
  step(s, [INPUT.JUMP, 0]);
  assert.equal(s.fighters[0].jumps, 0);
  const vy = s.fighters[0].vy;
  step(s, [0, 0]);
  step(s, [INPUT.JUMP, 0]);
  assert.ok(s.fighters[0].vy > vy - 1, "no third jump");
  assert.ok(s.fighters[0].y < y0);
});

test("a hit adds damage and launches the victim; more damage => farther", () => {
  const trial = (pct: number) => {
    const s = createState([0, 0]);
    s.fighters[0].x = 500 * FP; s.fighters[1].x = 530 * FP; s.fighters[1].percent = pct;
    s.fighters[0].facing = 1;
    step(s, [INPUT.ATTACK | INPUT.RIGHT, 0]);
    for (let i = 0; i < 20 && s.fighters[1].action !== A.HITSTUN; i++) step(s, [INPUT.RIGHT, 0]);
    assert.equal(s.fighters[1].action, A.HITSTUN);
    return s.fighters[1];
  };
  const lo = trial(0), hi = trial(150);
  assert.ok(lo.percent > 0);
  assert.ok(hi.vx > lo.vx);
});

test("shield blocks damage", () => {
  const s = createState([0, 0]);
  s.fighters[0].x = 500 * FP; s.fighters[1].x = 530 * FP;
  step(s, [0, INPUT.SHIELD]);
  assert.equal(s.fighters[1].action, A.SHIELD);
  step(s, [INPUT.ATTACK, INPUT.SHIELD]);
  for (let i = 0; i < 15; i++) step(s, [0, INPUT.SHIELD]);
  assert.equal(s.fighters[1].percent, 0);
});

test("falling off the stage costs a stock; losing all ends the match", () => {
  const s = createState([0, 1]);
  s.fighters[1].x = 100 * FP; s.fighters[1].y = 400 * FP; // off stage left
  for (let i = 0; i < 400 && s.fighters[1].stocks === 3; i++) step(s, [0, 0]);
  assert.equal(s.fighters[1].stocks, 2);
  for (const n of [2, 1]) {
    s.fighters[1].x = 100 * FP; s.fighters[1].y = 400 * FP; s.fighters[1].vy = 0;
    s.fighters[1].action = A.IDLE; s.fighters[1].invuln = 0;
    for (let i = 0; i < 400 && s.fighters[1].stocks === n; i++) step(s, [0, 0]);
  }
  assert.equal(s.over, true);
  assert.equal(s.winner, 0);
});

test("timeout: more stocks wins, then lower percent, then sudden death", () => {
  let s = createState([0, 1]);
  s.frame = MATCH_FRAMES - 1; s.fighters[0].stocks = 2;
  step(s, [0, 0]);
  assert.equal(s.winner, 1);

  s = createState([0, 1]);
  s.frame = MATCH_FRAMES - 1; s.fighters[0].percent = 50; s.fighters[1].percent = 20;
  step(s, [0, 0]);
  assert.equal(s.winner, 1);

  s = createState([0, 1]);
  s.frame = MATCH_FRAMES - 1;
  step(s, [0, 0]);
  assert.equal(s.over, false);
  assert.equal(s.suddenDeath, true);
  assert.equal(s.fighters[0].percent, 300);
});

test("sanitizeInput clamps garbage and cancels opposite directions", () => {
  assert.equal(sanitizeInput("x"), 0);
  assert.equal(sanitizeInput(NaN), 0);
  assert.equal(sanitizeInput(0xffff), sanitizeInput(0xff));
  assert.equal(sanitizeInput(INPUT.LEFT | INPUT.RIGHT), 0);
});

test("random matches terminate without NaN/Infinity", () => {
  for (const seed of [11, 12, 13]) {
    const { s } = run(seed, MATCH_FRAMES * 2);
    for (const f of s.fighters) for (const k of ["x", "y", "vx", "vy"] as const) assert.ok(Number.isFinite(f[k]));
  }
});

test("every character pairing in the roster plays a full match cleanly (determinism + no NaN)", () => {
  assert.equal(CHARACTERS.length, 4);
  for (let a = 0; a < CHARACTERS.length; a++) {
    for (let b = 0; b < CHARACTERS.length; b++) {
      const seed = a * 10 + b + 1;
      const { s, log } = run(seed, 2500, [a, b]);
      for (const f of s.fighters) for (const k of ["x", "y", "vx", "vy"] as const) assert.ok(Number.isFinite(f[k]), `char ${a} vs ${b}: ${k}`);
      const replay = createState([a, b]);
      for (const inp of log) step(replay, inp);
      assert.equal(hashState(s), hashState(replay), `char ${a} vs ${b} is deterministic`);
    }
  }
});

test("new fighters land a hit, including the non-projectile special (disjointed hitbox)", () => {
  for (const [atk, def] of [[2, 3], [3, 2]] as const) {
    const s = createState([atk, def]);
    s.fighters[0].x = 500 * FP; s.fighters[1].x = 530 * FP; s.fighters[0].facing = 1;
    step(s, [INPUT.SPECIAL | INPUT.RIGHT, 0]);
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) { step(s, [INPUT.RIGHT, 0]); hit = s.fighters[1].action === A.HITSTUN; }
    assert.ok(hit, `char ${atk}'s special should hit char ${def}`);
  }
});
