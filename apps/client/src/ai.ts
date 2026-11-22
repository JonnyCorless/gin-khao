import { INPUT, A, FP, STAGE, type GameState } from "@solanasmash/sim";

/** A very simple practice bot. Deliberately beatable. */
export function botInput(s: GameState, me: 0 | 1, frame: number): number {
  const f = s.fighters[me], o = s.fighters[1 - me];
  const x = f.x / FP, ox = o.x / FP, y = f.y / FP;
  let m = 0;
  const offStage = x < STAGE.main.left + 10 || x > STAGE.main.right - 10 || y > STAGE.main.top + 4;
  if (offStage) {
    m |= x < 640 ? INPUT.RIGHT : INPUT.LEFT;
    if (frame % 14 === 0) m |= INPUT.JUMP;
    return m;
  }
  const dx = ox - x;
  if (Math.abs(dx) > 70) {
    m |= dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
    if (f.char === 1 && Math.abs(dx) > 160 && frame % 90 < 4) m |= INPUT.SPECIAL;
    if (f.char === 0 && Math.abs(dx) > 120 && Math.abs(dx) < 240 && frame % 120 < 3) m |= INPUT.SPECIAL;
  } else if (frame % 24 < 3) {
    m |= INPUT.ATTACK | (dx > 0 ? INPUT.RIGHT : INPUT.LEFT);
  } else if (frame % 60 === 40 && f.action !== A.HITSTUN) {
    m |= INPUT.JUMP;
  }
  return m;
}
