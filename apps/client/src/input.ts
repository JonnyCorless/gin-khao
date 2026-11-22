import { INPUT } from "@solanasmash/sim";

const KEYS: Record<string, number> = {
  KeyA: INPUT.LEFT, ArrowLeft: INPUT.LEFT,
  KeyD: INPUT.RIGHT, ArrowRight: INPUT.RIGHT,
  KeyW: INPUT.UP, ArrowUp: INPUT.UP,
  KeyS: INPUT.DOWN, ArrowDown: INPUT.DOWN,
  Space: INPUT.JUMP,
  KeyJ: INPUT.ATTACK, KeyZ: INPUT.ATTACK,
  KeyK: INPUT.SPECIAL, KeyX: INPUT.SPECIAL,
  KeyL: INPUT.SHIELD, KeyC: INPUT.SHIELD, ShiftLeft: INPUT.SHIELD, ShiftRight: INPUT.SHIELD,
};

let keyMask = 0;
const down = new Set<string>();
const rebuild = () => { keyMask = 0; for (const c of down) keyMask |= KEYS[c] ?? 0; };

window.addEventListener("keydown", (e) => {
  if (!(e.code in KEYS)) return;
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  e.preventDefault(); down.add(e.code); rebuild();
});
window.addEventListener("keyup", (e) => { if (e.code in KEYS) { down.delete(e.code); rebuild(); } });
window.addEventListener("blur", () => { down.clear(); rebuild(); });

function padMask(): number {
  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (!pad) return 0;
  let m = 0;
  const [lx, ly] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
  if (lx < -0.4) m |= INPUT.LEFT;
  if (lx > 0.4) m |= INPUT.RIGHT;
  if (ly < -0.6) m |= INPUT.UP;
  if (ly > 0.5) m |= INPUT.DOWN;
  const b = (i: number) => !!pad.buttons[i]?.pressed;
  if (b(14)) m |= INPUT.LEFT; if (b(15)) m |= INPUT.RIGHT; if (b(12)) m |= INPUT.UP; if (b(13)) m |= INPUT.DOWN;
  if (b(0) || b(1)) m |= INPUT.JUMP;
  if (b(2)) m |= INPUT.ATTACK;
  if (b(3)) m |= INPUT.SPECIAL;
  if (b(4) || b(5) || b(6) || b(7)) m |= INPUT.SHIELD;
  return m;
}

export function readInput(): number {
  let m = keyMask | padMask();
  if ((m & INPUT.LEFT) && (m & INPUT.RIGHT)) m &= ~(INPUT.LEFT | INPUT.RIGHT);
  return m;
}
