import {
  A, CHARACTERS, FP, HURT_H, HURT_W, MATCH_FRAMES, STAGE, TICK_RATE, type GameEvent, type GameState, type Fighter,
} from "@solanasmash/sim";
import { sprite } from "./sprites.ts";

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }

const TAG = ["#ff5470", "#4cc3ff"];
const px = (v: number) => v / FP;

export class Renderer {
  private particles: Particle[] = [];
  private shake = 0;
  debug = false;
  /** The local player's chosen cosmetic skin for their own fighter. Opponents always render with
   * skin 0 — skin choice isn't sent over the wire (see docs/CHARACTERS.md: purely cosmetic, no
   * protocol change needed). */
  mySkin = 0;
  private stars: [number, number, number][] = [];

  constructor(private ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = false;
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) this.stars.push([r() * 1280, r() * 520, 1 + Math.floor(r() * 2)]);
  }

  addEvents(events: GameEvent[]) {
    for (const e of events) {
      if (e.t === "hit") {
        this.burst(px(e.x), px(e.y), e.big ? 26 : 12, e.big ? "#ffd23f" : "#ffffff", e.big ? 9 : 5);
        this.shake = Math.max(this.shake, e.big ? 14 : 5);
      } else if (e.t === "block") this.burst(px(e.x), px(e.y), 8, "#4cc3ff", 4);
      else if (e.t === "ko") this.shake = 24;
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + i * 0.37;
      const s = speed * (0.4 + ((i * 7) % 10) / 10);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 22, max: 22, color, size: 4 });
    }
  }

  draw(s: GameState, o: { seat: number | null; names: [string, string]; ping?: number }) {
    const g = this.ctx;
    g.save();
    g.clearRect(0, 0, 1280, 720);
    if (this.shake > 0.5) { g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake); this.shake *= 0.85; }
    this.background(s.frame);
    this.stage();
    for (const p of s.projs) this.projectile(p.x, p.y, s.frame);
    s.fighters.forEach((f, i) => this.fighter(f, i, s, o.seat === i));
    this.updateParticles();
    g.restore();
    this.hud(s, o);
  }

  private background(frame: number) {
    const g = this.ctx;
    const grad = g.createLinearGradient(0, 0, 0, 720);
    grad.addColorStop(0, "#0a0a1f"); grad.addColorStop(0.6, "#25134a"); grad.addColorStop(1, "#3a1a5a");
    g.fillStyle = grad; g.fillRect(-40, -40, 1360, 800);
    g.fillStyle = "#fff";
    for (const [x, y, s] of this.stars) { g.globalAlpha = 0.4 + 0.4 * Math.sin((frame + x) / 40); g.fillRect(x, y, s, s); }
    g.globalAlpha = 1;
    // distant "sun"
    g.fillStyle = "#9945ff22"; g.beginPath(); g.arc(640, 330, 220, 0, 7); g.fill();
    g.fillStyle = "#14f19522"; g.beginPath(); g.arc(640, 330, 140, 0, 7); g.fill();
  }

  private stage() {
    const g = this.ctx, m = STAGE.main;
    g.fillStyle = "#4a2d5e"; g.fillRect(m.left, m.top, m.right - m.left, m.bottom - m.top);
    g.fillStyle = "#3a2250";
    for (let x = m.left; x < m.right; x += 32) for (let y = m.top + 16; y < m.bottom; y += 32) g.fillRect(x + ((y / 32) % 2) * 16, y, 14, 6);
    g.fillStyle = "#14f195"; g.fillRect(m.left, m.top, m.right - m.left, 10);
    g.fillStyle = "#0fb874"; g.fillRect(m.left, m.top + 10, m.right - m.left, 4);
    for (const p of STAGE.soft) {
      g.fillStyle = "#9945ff"; g.fillRect(p.left, p.top, p.right - p.left, 10);
      g.fillStyle = "#6b2fc0"; g.fillRect(p.left, p.top + 10, p.right - p.left, 4);
    }
    if (this.debug) {
      g.strokeStyle = "#ff547088"; g.setLineDash([8, 8]);
      const b = STAGE.blast; g.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top); g.setLineDash([]);
    }
  }

  private projectile(x: number, y: number, frame: number) {
    const g = this.ctx;
    g.save(); g.translate(px(x), px(y)); g.rotate(frame * 0.3);
    g.fillStyle = "#fff4e0"; g.fillRect(-12, -3, 24, 6); g.fillRect(-14, -6, 6, 12); g.fillRect(8, -6, 6, 12);
    g.restore();
  }

  private fighter(f: Fighter, i: number, s: GameState, isMe: boolean) {
    const g = this.ctx;
    if (f.stocks <= 0) return;
    const x = px(f.x), y = px(f.y);
    const c = CHARACTERS[f.char];
    const blink = f.invuln > 0 && f.action !== A.DODGE && f.action !== A.SHIELD && s.frame % 6 < 3;
    if (blink) { this.tag(x, y, i, isMe); return; }

    g.save();
    g.translate(x, y);
    if (f.action === A.DODGE) g.globalAlpha = 0.45;
    const stretch = Math.max(-0.12, Math.min(0.15, f.vy / FP / 90));
    g.scale(f.facing * (1 - stretch / 2), 1 + stretch);
    if (f.action === A.HITSTUN) g.rotate(f.facing * -0.15 * Math.min(1, f.hitstun / 12));
    const bob = f.action === A.IDLE && f.grounded && Math.abs(f.vx) > 64 ? Math.sin(s.frame / 2) * 2 : 0;
    const flash = f.action === A.HITSTUN && f.af < 3;
    g.drawImage(sprite(f.char, flash, isMe ? this.mySkin : 0), -32, -64 + bob, 64, 64);
    g.restore();

    // attack swoosh
    if (f.action === A.ATTACK || f.action === A.SPECIAL) {
      const m = [c.moves.neutral, c.moves.forward, c.moves.up, c.moves.down, c.moves.special][f.move];
      if (!m.projectile && f.af > m.startup && f.af <= m.startup + m.active) {
        const hx = f.facing === 1 ? x + m.hb.x : x - m.hb.x - m.hb.w;
        g.fillStyle = "#ffffffaa"; g.fillRect(hx, y + m.hb.y, m.hb.w, m.hb.h);
        g.strokeStyle = TAG[i]; g.lineWidth = 3; g.strokeRect(hx, y + m.hb.y, m.hb.w, m.hb.h);
      }
    }
    if (f.action === A.SHIELD) {
      const r = 28 + 22 * (f.shield / 300);
      g.fillStyle = (i === 0 ? "#ff547033" : "#4cc3ff33"); g.strokeStyle = TAG[i];
      g.lineWidth = 2; g.beginPath(); g.arc(x, y - 32, r, 0, 7); g.fill(); g.stroke();
    }
    if (this.debug) { g.strokeStyle = "#0f0"; g.strokeRect(x - HURT_W / 2, y - HURT_H, HURT_W, HURT_H); }
    this.tag(x, y, i, isMe);
  }

  private tag(x: number, y: number, i: number, isMe: boolean) {
    const g = this.ctx;
    g.fillStyle = TAG[i];
    g.beginPath(); g.moveTo(x - 8, y - 92); g.lineTo(x + 8, y - 92); g.lineTo(x, y - 80); g.fill();
    if (isMe) { g.font = "bold 13px system-ui"; g.textAlign = "center"; g.fillStyle = "#fff"; g.fillText("YOU", x, y - 98); }
  }

  private updateParticles() {
    const g = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      g.globalAlpha = p.life / p.max; g.fillStyle = p.color; g.fillRect(p.x, p.y, p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  private hud(s: GameState, o: { seat: number | null; names: [string, string]; ping?: number }) {
    const g = this.ctx;
    const left = s.suddenDeath ? 0 : Math.max(0, MATCH_FRAMES - s.frame);
    const secs = Math.ceil(left / TICK_RATE);
    g.textAlign = "center"; g.fillStyle = "#fff"; g.font = "bold 34px system-ui";
    g.fillText(s.suddenDeath ? "SUDDEN DEATH" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, 640, 44);
    s.fighters.forEach((f, i) => {
      const x = i === 0 ? 260 : 1020, y = 650;
      g.fillStyle = "#000a"; g.fillRect(x - 120, y - 56, 240, 84);
      g.strokeStyle = TAG[i]; g.lineWidth = 3; g.strokeRect(x - 120, y - 56, 240, 84);
      const t = Math.min(1, f.percent / 150);
      g.fillStyle = `rgb(255,${Math.round(255 - 200 * t)},${Math.round(255 - 200 * t)})`;
      g.font = "bold 44px system-ui"; g.textAlign = "center";
      g.fillText(`${f.percent}%`, x + 20, y - 6);
      g.font = "13px system-ui"; g.fillStyle = "#cfcaf0"; g.textAlign = "left";
      g.fillText(`${CHARACTERS[f.char].name}${o.seat === i ? " (you)" : ""}`, x - 110, y - 38);
      for (let k = 0; k < f.stocks; k++) { g.fillStyle = TAG[i]; g.fillRect(x - 110 + k * 18, y + 6, 12, 12); }
      g.drawImage(sprite(f.char, false, o.seat === i ? this.mySkin : 0), x - 112, y - 34, 32, 32);
    });
    g.fillStyle = "#9a96b8"; g.font = "12px system-ui"; g.textAlign = "right";
    if (o.ping != null) g.fillText(`${o.ping} ms`, 1270, 710);
  }
}
