import { randomBytes } from "node:crypto";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createState, step, hashState, sanitizeInput, computeSplit, encodeMsg,
  type GameEvent, type GameState, type Phase, type ServerMsg, type TxAction,
} from "@solanasmash/sim";
import type { ChainAdapter } from "./chain/types.ts";
import type { MockChain } from "./chain/mock.ts";
import type { Config } from "./config.ts";
import type { Quote } from "./price.ts";

export interface Client {
  send(m: ServerMsg): void;
  pubkey: string | null;
  session: Session | null;
}

interface Seat {
  pubkey: string;
  char: number;
  client: Client | null;
  input: number;
  cf: number;
  graceTimer: NodeJS.Timeout | null;
  pendingTx: ServerMsg | null;
  ack: (() => void) | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Session {
  readonly matchId: bigint;
  phase: Phase = "deposit";
  state: GameState;
  private seats: [Seat, Seat];
  private inputLog: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private ended = false;
  private forfeit: 0 | 1 | null = null; // seat that forfeited
  private pendingEvents: GameEvent[] = [];

  constructor(
    private cfg: Config, private chain: ChainAdapter, private quote: Quote,
    a: { client: Client; char: number }, b: { client: Client; char: number },
    private onEnd: (s: Session) => void,
  ) {
    this.matchId = randomBytes(8).readBigUInt64BE();
    const mk = (p: { client: Client; char: number }): Seat => ({
      pubkey: p.client.pubkey!, char: p.char, client: p.client, input: 0, cf: 0, graceTimer: null, pendingTx: null, ack: null,
    });
    this.seats = [mk(a), mk(b)];
    this.state = createState([a.char, b.char], { stocks: cfg.startStocks });
    a.client.session = this; b.client.session = this;
  }

  get pubkeys() { return [this.seats[0].pubkey, this.seats[1].pubkey]; }
  seatOf(pubkey: string): 0 | 1 | -1 { return this.seats[0].pubkey === pubkey ? 0 : this.seats[1].pubkey === pubkey ? 1 : -1; }

  private send(seat: 0 | 1, m: ServerMsg) { this.seats[seat].client?.send(m); }
  private both(m: ServerMsg) { this.send(0, m); this.send(1, m); }
  private status(phase: Phase, msg: string) { this.phase = phase; this.both({ t: "status", phase, msg }); }

  private matchedMsg(seat: 0 | 1): ServerMsg {
    const split = computeSplit(this.quote.lamports, this.cfg.feeBps);
    return {
      t: "matched", matchId: this.matchId.toString(), seat, opponent: this.seats[1 - seat].pubkey,
      chars: [this.seats[0].char, this.seats[1].char], stakeLamports: this.quote.lamports.toString(),
      solUsd: this.quote.solUsd, feeBps: this.cfg.feeBps,
      pot: split.pot.toString(), fee: split.fee.toString(), payout: split.payout.toString(),
    };
  }

  // ---- lifecycle ----

  async run() {
    try {
      this.send(0, this.matchedMsg(0));
      this.send(1, this.matchedMsg(1));

      // 1. player A creates the match on chain, 2. player B joins
      const okA = await this.awaitDeposit(0, "create", (m) => m != null && m.status === "open" && m.playerA === this.seats[0].pubkey && m.stake === this.quote.lamports);
      if (!okA) return this.abort("Opponent didn't deposit in time. Nothing was charged.");
      const okB = await this.awaitDeposit(1, "join", (m) => m != null && m.status === "active" && m.playerB === this.seats[1].pubkey);
      if (!okB) {
        const tx = await this.chain.prepareTx("cancel", this.matchId, this.seats[0].pubkey, this.quote.lamports).catch(() => null);
        this.setPending(0, { t: "tx", action: "cancel", tx });
        return this.abort("Opponent didn't deposit in time. Cancel your match to get your stake back.");
      }

      // 3. both stakes are locked on chain: countdown, then fight
      this.status("countdown", "Both stakes locked. Get ready!");
      this.both({ t: "start", startsInMs: this.cfg.countdownMs, frame0: this.state });
      await sleep(this.cfg.countdownMs);
      if (this.ended) return;
      this.status("playing", "Fight!");
      this.startLoop();
    } catch (e) {
      console.error("session error", this.matchId, e);
      this.abort("Server error. If you deposited, your stake is safe and can be refunded.");
    }
  }

  private setPending(seat: 0 | 1, m: ServerMsg) {
    this.seats[seat].pendingTx = m;
    this.send(seat, m);
  }

  private async awaitDeposit(seat: 0 | 1, action: TxAction, ok: (m: Awaited<ReturnType<ChainAdapter["getMatch"]>>) => boolean): Promise<boolean> {
    const s = this.seats[seat];
    const tx = await this.chain.prepareTx(action, this.matchId, s.pubkey, this.quote.lamports);
    this.setPending(seat, { t: "tx", action, tx });
    this.status("deposit", seat === 0 ? "Waiting for player 1 to stake…" : "Waiting for player 2 to stake…");
    const deadline = Date.now() + this.cfg.depositTimeoutMs;
    while (Date.now() < deadline && !this.ended) {
      const m = await this.chain.getMatch(this.matchId).catch(() => null);
      if (ok(m)) { s.pendingTx = null; return true; }
      await Promise.race([sleep(1000), new Promise<void>((r) => (s.ack = r))]);
    }
    return false;
  }

  /** Client says it submitted its tx. In mock mode this *is* the deposit. */
  onDeposited(pubkey: string) {
    const seat = this.seatOf(pubkey);
    if (seat < 0) return;
    const s = this.seats[seat as 0 | 1];
    const pend = s.pendingTx;
    if (pend && pend.t === "tx" && this.chain.mode === "mock") (this.chain as MockChain).applyAck(pend.action, this.matchId);
    s.ack?.();
    s.ack = null;
  }

  onInput(pubkey: string, input: unknown, cf: unknown) {
    const seat = this.seatOf(pubkey);
    if (seat < 0) return;
    const s = this.seats[seat as 0 | 1];
    s.input = sanitizeInput(input);
    if (typeof cf === "number" && Number.isSafeInteger(cf) && cf > s.cf) s.cf = cf;
  }

  private snap(): ServerMsg {
    const events = this.pendingEvents; this.pendingEvents = [];
    return { t: "snap", frame: this.state.frame, state: this.state, ack: [this.seats[0].cf, this.seats[1].cf], events };
  }

  // ---- connection handling ----

  detach(client: Client) {
    const seat = this.seatOf(client.pubkey ?? "");
    if (seat < 0 || this.ended) return;
    const s = this.seats[seat as 0 | 1];
    if (s.client !== client) return;
    s.client = null; s.input = 0;
    if (this.phase === "countdown" || this.phase === "playing") {
      this.send((1 - seat) as 0 | 1, { t: "opp_status", connected: false, graceMs: this.cfg.graceMs });
      s.graceTimer = setTimeout(() => this.onGraceExpired(seat as 0 | 1), this.cfg.graceMs);
    }
  }

  attach(client: Client) {
    const seat = this.seatOf(client.pubkey ?? "");
    if (seat < 0) return;
    const s = this.seats[seat as 0 | 1];
    s.client?.session === this && s.client !== client && (s.client.session = null);
    s.client = client; client.session = this;
    if (s.graceTimer) { clearTimeout(s.graceTimer); s.graceTimer = null; }
    client.send(this.matchedMsg(seat as 0 | 1));
    client.send({ t: "status", phase: this.phase, msg: "Reconnected" });
    if (s.pendingTx) client.send(s.pendingTx);
    if (this.phase === "playing" || this.phase === "countdown") {
      client.send({ t: "start", startsInMs: 0, frame0: this.state });
      this.send((1 - seat) as 0 | 1, { t: "opp_status", connected: true, graceMs: 0 });
    }
  }

  private onGraceExpired(seat: 0 | 1) {
    if (this.ended) return;
    this.forfeit = seat;
    if (this.phase === "countdown") {
      // never started: nobody fought, refund both rather than award a free win
      this.finish(-1, "disconnect before the fight started");
    } else {
      this.finish(((1 - seat) as 0 | 1), `player ${seat + 1} disconnected and forfeited`);
    }
  }

  // ---- game loop ----

  private startLoop() {
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += now - last; last = now;
      let n = 0;
      while (acc >= this.cfg.tickMs && n < 10 && !this.state.over) {
        acc -= this.cfg.tickMs; n++;
        const i0 = this.seats[0].input, i1 = this.seats[1].input;
        this.inputLog.push(i0, i1);
        step(this.state, [i0, i1]);
        this.pendingEvents.push(...this.state.events);
        if (this.state.frame % 2 === 0 || this.state.over) this.both(this.snap());
      }
      if (n === 10) acc = 0; // don't spiral if the event loop stalls
      if (this.state.over) this.finish(this.state.winner, this.state.winner === -1 ? "draw" : "knockout");
    }, 4);
  }

  private abort(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.status("done", reason);
    this.both({ t: "result", winner: -1, reason, payout: "0", fee: "0", sig: null });
    this.cleanup();
  }

  private async finish(winner: -1 | 0 | 1, reason: string) {
    if (this.ended) return;
    this.ended = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.status("settling", "Settling on chain…");
    this.both(this.snap());

    let sig: string | null = null, payout = 0n, fee = 0n, failed = false;
    for (let attempt = 0; attempt < 4 && sig == null; attempt++) {
      try {
        if (winner === -1) {
          sig = await this.chain.voidMatch(this.matchId);
        } else {
          const r = await this.chain.settle(this.matchId, this.seats[winner].pubkey);
          sig = r.sig; payout = r.payout; fee = r.fee;
        }
      } catch (e) {
        console.error(`settle attempt ${attempt} failed`, this.matchId, (e as Error).message);
        await sleep(500 * 2 ** attempt);
      }
    }
    if (sig == null) failed = true;

    this.record(winner, reason, sig, failed);
    const msg = failed
      ? `${reason}. Settlement is delayed; your stake is safe and refundable on chain after 20 minutes.`
      : reason;
    this.status("done", msg);
    this.both({ t: "result", winner, reason: msg, payout: payout.toString(), fee: fee.toString(), sig });
    this.cleanup();
  }

  /** Audit trail: every match's full input log can be replayed through the sim to re-derive the result. */
  private record(winner: number, reason: string, sig: string | null, failed: boolean) {
    try {
      mkdirSync(join(this.cfg.dataDir, "replays"), { recursive: true });
      const bytes = Buffer.from(Uint8Array.from(this.inputLog));
      writeFileSync(join(this.cfg.dataDir, "replays", `${this.matchId}.bin`), bytes);
      appendFileSync(join(this.cfg.dataDir, "results.jsonl"), JSON.stringify({
        matchId: this.matchId.toString(), players: this.pubkeys, chars: [this.seats[0].char, this.seats[1].char],
        stake: this.quote.lamports.toString(), feeBps: this.cfg.feeBps, winner, reason, frames: this.state.frame,
        stateHash: hashState(this.state), sig, settlementFailed: failed, at: new Date().toISOString(),
      }) + "\n");
    } catch (e) {
      console.error("could not write audit log", e);
    }
  }

  private cleanup() {
    if (this.timer) clearInterval(this.timer);
    for (const s of this.seats) {
      if (s.graceTimer) clearTimeout(s.graceTimer);
      if (s.client) s.client.session = null;
      s.ack?.();
    }
    this.onEnd(this);
  }
}
