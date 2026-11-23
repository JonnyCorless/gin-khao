import { CHARACTERS, INPUT, A, FP, STAGE, type GameState } from "@solanasmash/sim";

/** A very simple practice bot. Deliberately beatable. Works for any character in the roster. */
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
  const hasProjectile = !!CHARACTERS[f.char].moves.special.projectile;
  if (Math.abs(dx) > 70) {
    m |= dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
    const specialRange = hasProjectile ? Math.abs(dx) > 160 : Math.abs(dx) > 100 && Math.abs(dx) < 260;
    if (specialRange && frame % (hasProjectile ? 90 : 110) < 3) m |= INPUT.SPECIAL;
  } else if (frame % 24 < 3) {
    m |= INPUT.ATTACK | (dx > 0 ? INPUT.RIGHT : INPUT.LEFT);
  } else if (frame % 60 === 40 && f.action !== A.HITSTUN) {
    m |= INPUT.JUMP;
  }
  return m;
}
