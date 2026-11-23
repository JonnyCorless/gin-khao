import nacl from "tweetnacl";
import {
  A, CHARACTERS, FP, LOGIN_PREFIX, TICK_RATE, createState, step, type ClientMsg, type GameState, type ServerMsg,
} from "@solanasmash/sim";
import { botInput } from "./ai.ts";
import { readInput } from "./input.ts";
import { Predictor } from "./predict.ts";
import { Renderer } from "./render.ts";
import { sfx } from "./sfx.ts";
import { drawPreview } from "./sprites.ts";
import { connectPhantom, devWallet, type Wallet } from "./wallet.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("game");
const renderer = new Renderer(canvas.getContext("2d")!);
window.addEventListener("keydown", (e) => { if (e.code === "F3") { renderer.debug = !renderer.debug; e.preventDefault(); } });

const WS_URL = new URLSearchParams(location.search).get("server")
  ?? (import.meta.env.VITE_WS_URL as string | undefined)
  ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.port === "5173" || !location.host ? `${location.hostname || "localhost"}:8787` : location.host}`;

type Mode = "lobby" | "practice" | "online";
let mode: Mode = "lobby";
let wallet: Wallet | null = null;
let ws: WebSocket | null = null;
let serverMode: "mock" | "solana" = "mock";
let feeBps = 330;
let chosenChar = 0;
let seat: 0 | 1 = 0;
let predictor: Predictor | null = null;
let practice: { state: GameState; frame: number; me: 0 | 1 } | null = null;
let ping = 0;
let countdownUntil = 0;
let matchInfo: Extract<ServerMsg, { t: "matched" }> | null = null;
let idleState = createState([0, 1]);
let pingTimer: ReturnType<typeof setInterval> | null = null;
let stakeLamports = "10000000";
let lastBeep = -1;
let txPromptOpen = false;

const fmtSol = (lamports: string | bigint) => {
  const n = Number(BigInt(lamports)) / 1e9;
  return n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
};
const show = (id: string, on: boolean) => { $(id).hidden = !on; };
function panel(which: "lobby" | "status" | "result" | "none") {
  show("lobby", which === "lobby"); show("status", which === "status"); show("result", which === "result");
}
function setStatus(title: string, detail = "", actions: { label: string; fn: () => void; primary?: boolean }[] = []) {
  panel("status");
  $("status-title").textContent = title;
  $("status-detail").innerHTML = detail;
  const a = $("status-actions"); a.innerHTML = "";
  for (const x of actions) {
    const b = document.createElement("button"); b.textContent = x.label; if (x.primary) b.className = "primary"; b.onclick = x.fn; a.appendChild(b);
  }
}

// ---------- lobby ----------
CHARACTERS.forEach((_, i) => drawPreview($(`pv${i}`) as HTMLCanvasElement, i));
document.querySelectorAll<HTMLButtonElement>(".char").forEach((b) => {
  b.onclick = () => {
    chosenChar = Number(b.dataset.char);
    document.querySelectorAll(".char").forEach((x) => x.classList.toggle("sel", x === b));
  };
});

async function useWallet(w: Wallet) {
  wallet = w;
  $("wallet-info").hidden = false;
  $("wallet-info").textContent = `${w.kind === "dev" ? "Dev wallet" : "Phantom"}: ${w.pubkey.slice(0, 6)}…${w.pubkey.slice(-6)}`;
  $("wallet-row").hidden = true;
  await connectServer();
}
$<HTMLButtonElement>("btn-phantom").onclick = async () => {
  try { await useWallet(await connectPhantom()); } catch (e) { alert((e as Error).message); }
};
$<HTMLButtonElement>("btn-dev").onclick = () => void useWallet(devWallet());
$<HTMLButtonElement>("btn-queue").onclick = () => {
  if (!ws) return;
  if (serverMode === "solana" && wallet?.kind === "dev") { alert("The dev wallet can't pay on-chain. Connect Phantom (set to devnet) instead."); return; }
  send({ t: "queue", char: chosenChar });
  setStatus("Looking for an opponent…", "You'll be asked to stake once someone is found.", [{ label: "Cancel", fn: () => { send({ t: "leave" }); panel("lobby"); } }]);
};
$<HTMLButtonElement>("btn-practice").onclick = startPractice;
$<HTMLButtonElement>("btn-again").onclick = () => { mode = "lobby"; predictor = null; practice = null; panel("lobby"); show("countdown", false); show("opp-banner", false); };

// ---------- networking ----------
const send = (m: ClientMsg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

async function connectServer() {
  $("net").textContent = "connecting…";
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { $("net").textContent = "connected"; };
  ws.onclose = () => {
    $("net").textContent = "disconnected";
    ws = null;
    if (mode === "online" && wallet) setTimeout(() => void connectServer(), 1000); // auto-rejoin within the 10s grace window
  };
  ws.onerror = () => { $("net").textContent = "server unreachable"; };
  ws.onmessage = (ev) => void onServer(JSON.parse(ev.data) as ServerMsg);
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => send({ t: "ping", ts: performance.now() }), 2000);
}

async function onServer(m: ServerMsg) {
  switch (m.t) {
    case "challenge": {
      serverMode = m.mode; feeBps = m.feeBps; stakeLamports = m.stakeLamports;
      const stakeSol = fmtSol(m.stakeLamports), win = fmtSol(BigInt(m.stakeLamports) * 2n * BigInt(10000 - m.feeBps) / 10000n);
      $("stake-txt").textContent = `${stakeSol} SOL`; $("stake-btn").textContent = `${stakeSol} SOL`;
      $("fee-line").textContent = `Pot ${fmtSol(BigInt(m.stakeLamports) * 2n)} SOL. House cut ${(m.feeBps / 100).toFixed(1)}%. Winner receives ${win} SOL.`;
      $("devnet-banner").textContent = m.mode === "mock" ? "MOCK CHAIN: simulated stakes, no real funds move." : "DEVNET PROTOTYPE: test SOL only. Set your wallet to Devnet.";
      try {
        const sig = await wallet!.signMessage(new TextEncoder().encode(LOGIN_PREFIX + m.nonce));
        send({ t: "auth", pubkey: wallet!.pubkey, signature: btoa(String.fromCharCode(...sig)) });
      } catch { $("net").textContent = "login cancelled"; }
      return;
    }
    case "authed": show("pick", true); return;
    case "queued": return;
    case "matched": {
      matchInfo = m; seat = m.seat; mode = "online";
      setStatus("Opponent found",
        `Stake <b>${fmtSol(m.stakeLamports)} SOL</b> each.<br>Pot ${fmtSol(m.pot)} SOL · house ${(m.feeBps / 100).toFixed(1)}% = ${fmtSol(m.fee)} SOL<br>Winner gets <b class="win">${fmtSol(m.payout)} SOL</b>`);
      return;
    }
    case "tx": {
      if (m.tx == null) { send({ t: "deposited" }); return; } // mock chain
      txPromptOpen = true;
      const label = m.action === "create" ? "Approve your stake in the wallet" : m.action === "join" ? "Approve your stake in the wallet" : "Approve the refund in your wallet";
      setStatus(label, "Funds are held by the escrow program, not by us.", [{
        label: "Open wallet", primary: true, fn: async () => {
          try { const sig = await wallet!.signAndSend(m.tx!); send({ t: "deposited", sig }); txPromptOpen = false; setStatus("Transaction sent", "Waiting for confirmation…"); }
          catch (e) { setStatus("Wallet declined", (e as Error).message, [{ label: "Try again", primary: true, fn: () => void onServer(m) }]); }
        },
      }]);
      return;
    }
    case "status": {
      if (m.phase === "deposit" && txPromptOpen) return; // never replace an open wallet prompt
      if (m.phase !== "deposit") txPromptOpen = false;
      if (m.phase === "deposit" || m.phase === "settling" || m.phase === "countdown") setStatus(m.msg);
      if (m.phase === "playing") panel("none");
      return;
    }
    case "start": {
      mode = "online"; panel("none");
      predictor = new Predictor(m.frame0, seat);
      countdownUntil = performance.now() + m.startsInMs;
      return;
    }
    case "snap": {
      renderer.addEvents(m.events); sfx.events(m.events);
      if (!predictor) predictor = new Predictor(m.state, seat);
      predictor.onSnapshot(m.state, m.ack[seat]);
      return;
    }
    case "opp_status": {
      show("opp-banner", !m.connected);
      $("opp-banner").textContent = `Opponent disconnected. They forfeit in ${Math.round(m.graceMs / 1000)}s`;
      return;
    }
    case "result": {
      const won = m.winner === seat, draw = m.winner === -1;
      panel("result");
      if (won) sfx.win(); else if (!draw) sfx.lose();
      $("result-title").textContent = draw ? "No contest" : won ? "You win!" : "You lose";
      $("result-title").className = draw ? "" : won ? "win" : "lose";
      $("result-detail").innerHTML = `${m.reason}<br>` + (won ? `Payout <b class="win">${fmtSol(m.payout)} SOL</b> (house fee ${fmtSol(m.fee)} SOL)` : draw ? "Stakes refunded in full." : "Stake went to the winner.")
        + (m.sig ? `<br><span class="mono">tx: ${m.sig}</span>` : "");
      predictor = predictor; show("opp-banner", false);
      return;
    }
    case "pong": ping = Math.round(performance.now() - m.ts); return;
    case "error": setStatus("Heads up", m.msg, [{ label: "OK", fn: () => panel("lobby") }]); return;
  }
}

// ---------- practice ----------
function startPractice() {
  mode = "practice"; panel("none");
  const botChar = (chosenChar + 1) % CHARACTERS.length;
  practice = { state: createState([chosenChar, botChar]), frame: 0, me: 0 };
  seat = 0;
}

// ---------- main loop ----------
let last = performance.now(), acc = 0;
const STEP = 1000 / TICK_RATE;
function frame(now: number) {
  acc += Math.min(100, now - last); last = now;
  while (acc >= STEP) {
    acc -= STEP;
    const mine = readInput();
    if (mode === "practice" && practice && !practice.state.over) {
      practice.frame++;
      step(practice.state, [mine, botInput(practice.state, 1, practice.frame)]);
      renderer.addEvents(practice.state.events); sfx.events(practice.state.events);
      if (practice.state.over) {
        panel("result");
        const w = practice.state.winner;
        $("result-title").textContent = w === 0 ? "You win!" : w === 1 ? "Bot wins" : "Draw";
        $("result-title").className = w === 0 ? "win" : "lose";
        $("result-detail").textContent = "Practice match: no stake.";
      }
    } else if (mode === "online" && predictor && now >= countdownUntil) {
      if (!predictor.pred.over) {
        predictor.tick(mine);
        send({ t: "input", input: mine, cf: predictor.cf });
      }
    }
  }
  let s: GameState = idleState;
  if (mode === "practice" && practice) s = practice.state;
  else if (mode === "online" && predictor) s = predictor.pred;
  renderer.draw(s, { seat: mode === "lobby" ? null : seat, names: ["P1", "P2"], ping: mode === "online" ? ping : undefined });

  const cd = $("countdown");
  const left = countdownUntil - now;
  if (mode === "online" && left > 0) { cd.hidden = false; const n = Math.ceil(left / 1000); cd.textContent = String(n); if (n !== lastBeep) { lastBeep = n; sfx.beep(n); } }
  else if (!cd.hidden) { cd.textContent = left > -600 ? "FIGHT!" : ""; if (left < -600) cd.hidden = true; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for debugging / automated tests
const muteBtn = $<HTMLButtonElement>("btn-mute");
const syncMute = () => { muteBtn.textContent = sfx.muted ? "sound off" : "sound on"; };
muteBtn.onclick = () => { sfx.toggle(); syncMute(); };
window.addEventListener("keydown", (e) => { if (e.code === "KeyM") { sfx.toggle(); syncMute(); } });
syncMute();
(window as any).__smash = { get mode() { return mode; }, get state() { return mode === "practice" ? practice?.state : predictor?.pred; }, startPractice };
void A; void FP; void nacl;
