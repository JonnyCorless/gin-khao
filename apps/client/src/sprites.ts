/** Hand-drawn 16x16 pixel fighters, drawn at 4x so one sprite = one 64px hurtbox. */
const PAL: Record<string, string> = {
  o: "#ff9a2e", d: "#c96a10", w: "#fff4e0", k: "#1a1020", p: "#ff7aa8",
  b: "#a8703c", e: "#6e4420",
  t: "#c9a876", g: "#6e6e78", m: "#4a2f1f", // Quillborne: coat tan, hat gray, mustache
  v: "#2a1a33", r: "#c43b3b", // Nightshade: cape violet-black, red accent
};
const CAT = [
  "................",
  "..oo........oo..",
  "..ood......doo..",
  "..oooooooooooo..",
  "..ookooooookoo..",
  "..oooooppooooo..",
  "..oowwwwwwwwoo..",
  "...oooooooooo...",
  "..oooooooooooo..",
  ".oooooooooooooo.",
  ".oowwoooooowwoo.",
  ".oooooooooooooo.",
  "..oooooooooooo..",
  "..oooo....oooo..",
  "..oooo....oooo..",
  "..kkkk....kkkk..",
];
const DOG = [
  "................",
  "..ee........ee..",
  ".eeebbbbbbbbeee.",
  ".eeebbbbbbbbeee.",
  ".eeebkbbbbkbeee.",
  "..ebbbbbbbbbbe..",
  "...bbwwwwwwbb...",
  "...bbwwkkwwbb...",
  "....bbbbbbbb....",
  "..bbbbbbbbbbbb..",
  ".bbbbbbbbbbbbbb.",
  ".bbbbbwwwwbbbbb.",
  "..bbbbbbbbbbbb..",
  "..bbbb....bbbb..",
  "..bbbb....bbbb..",
  "..kkkk....kkkk..",
];
const QUILL = [
  "................",
  "..gg........gg..",
  "..ggt......tgg..",
  "..tttttttttttt..",
  "..tktttttttktt..",
  "..tttttmmttttt..",
  "..ttwwwwwwwwtt..",
  "...tttttttttt...",
  "..tttttttttttt..",
  ".tttttttttttttt.",
  ".ttwwttttttwwtt.",
  ".tttttttttttttt.",
  "..tttttttttttt..",
  "..tttt....tttt..",
  "..tttt....tttt..",
  "..kkkk....kkkk..",
];
const NIGHT = [
  "................",
  "..vv........vv..",
  "..vvr......rvv..",
  "..vvvvvvvvvvvv..",
  "..vrvvvvvvvrvv..",
  "..vvvvvrrvvvvv..",
  "..vvwwwwwwwwvv..",
  "...vvvvvvvvvv...",
  "..vvvvvvvvvvvv..",
  ".vvvvvvvvvvvvvv.",
  ".vvwwvvvvvvwwvv.",
  ".vvvvvvvvvvvvvv.",
  "..vvvvvvvvvvvv..",
  "..vvvv....vvvv..",
  "..vvvv....vvvv..",
  "..kkkk....kkkk..",
];
const SHEETS = [CAT, DOG, QUILL, NIGHT];

const cache = new Map<string, HTMLCanvasElement>();
export function sprite(char: number, flash = false): HTMLCanvasElement {
  const key = `${char}:${flash}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  SHEETS[char].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ".") return;
    g.fillStyle = flash ? "#ffffff" : PAL[ch];
    g.fillRect(x, y, 1, 1);
  }));
  cache.set(key, c);
  return c;
}

export function drawPreview(canvas: HTMLCanvasElement, char: number) {
  const g = canvas.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(sprite(char), 0, 0, canvas.width, canvas.height);
}
