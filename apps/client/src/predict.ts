import { cloneState, step, type GameState, type GameEvent } from "@solanasmash/sim";

/**
 * Client-side prediction with server reconciliation.
 * The server is authoritative. We apply our own input immediately, and when a snapshot arrives we
 * rewind to it and replay the local inputs the server hasn't seen yet (cf > ack).
 * The opponent is simulated with their last known input.
 */
export class Predictor {
  pred: GameState;
  cf = 0;
  private hist: number[] = [0];
  constructor(initial: GameState, private seat: 0 | 1) { this.pred = cloneState(initial); }

  /** Advance one local frame with our input. */
  tick(input: number): GameState {
    this.cf++;
    this.hist[this.cf] = input;
    if (this.hist.length > 600) { /* history is sparse-indexed; trim by dropping old keys */ delete this.hist[this.cf - 500]; }
    this.stepWith(this.pred, input);
    return this.pred;
  }

  private stepWith(s: GameState, mine: number) {
    const opp = (1 - this.seat) as 0 | 1;
    const theirs = s.fighters[opp].prev;
    step(s, this.seat === 0 ? [mine, theirs] : [theirs, mine]);
  }

  onSnapshot(state: GameState, ack: number) {
    const base = cloneState(state);
    const lead = Math.max(0, Math.min(30, this.cf - ack));
    for (let k = ack + 1; k <= ack + lead && !base.over; k++) this.stepWith(base, this.hist[k] ?? this.hist[k - 1] ?? 0);
    this.pred = base;
  }
}

export type { GameEvent };
