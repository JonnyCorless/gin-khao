/** Wire protocol shared by client and server, plus the money maths. */
import type { GameEvent, GameState } from "./index.ts";

export const LOGIN_PREFIX = "SolanaSmash login\nnonce:";
export const DEFAULT_FEE_BPS = 330; // 3.3 %
export const DISCONNECT_GRACE_MS = 10_000;

/** Mirrors `fee_for` in programs/escrow. Winner gets pot - fee; rounding favours the winner. */
export function computeSplit(stakeLamports: bigint, feeBps: number): { pot: bigint; fee: bigint; payout: bigint } {
  const pot = stakeLamports * 2n;
  const fee = (pot * BigInt(feeBps)) / 10_000n;
  return { pot, fee, payout: pot - fee };
}

export type ChainMode = "mock" | "solana";
export type Phase = "idle" | "queued" | "deposit" | "countdown" | "playing" | "settling" | "done";

export type ClientMsg =
  | { t: "auth"; pubkey: string; signature: string } // signature = base64 ed25519 over LOGIN_PREFIX+nonce
  | { t: "queue"; char: number }
  | { t: "leave" }
  | { t: "deposited"; sig?: string } // wallet says it submitted the deposit tx (server verifies on chain)
  | { t: "input"; input: number; cf: number } // cf = client frame counter, echoed back as an ack
  | { t: "ping"; ts: number };

export type TxAction = "create" | "join" | "cancel";

export type ServerMsg =
  | { t: "challenge"; nonce: string; mode: ChainMode; feeBps: number }
  | { t: "authed"; pubkey: string }
  | { t: "queued"; waiting: number }
  | { t: "left" }
  | {
      t: "matched"; matchId: string; seat: 0 | 1; opponent: string; chars: [number, number];
      stakeLamports: string; solUsd: number; feeBps: number; pot: string; fee: string; payout: string;
    }
  | { t: "tx"; action: TxAction; tx: string | null } // base64 unsigned tx; null in mock mode
  | { t: "status"; phase: Phase; msg: string }
  | { t: "start"; startsInMs: number; frame0: GameState }
  | { t: "snap"; frame: number; state: GameState; ack: [number, number]; events: GameEvent[] }
  | { t: "opp_status"; connected: boolean; graceMs: number }
  | { t: "result"; winner: -1 | 0 | 1; reason: string; payout: string; fee: string; sig: string | null }
  | { t: "pong"; ts: number }
  | { t: "error"; code: string; msg: string };

export function encodeMsg(m: ServerMsg | ClientMsg): string {
  return JSON.stringify(m);
}
