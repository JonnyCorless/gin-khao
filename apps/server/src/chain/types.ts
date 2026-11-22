import type { TxAction } from "@solanasmash/sim";

export interface OnChainMatch {
  matchId: bigint;
  playerA: string;
  playerB: string; // designated at creation; match is "active" once they have deposited
  stake: bigint;
  status: "open" | "active";
  feeBps: number;
}

export interface Settlement { sig: string; payout: bigint; fee: bigint }

export interface ChainAdapter {
  readonly mode: "mock" | "solana";
  /** Unsigned base64 tx for the player to sign, or null in mock mode (client just acks). */
  prepareTx(action: TxAction, matchId: bigint, player: string, stake: bigint, opponent: string): Promise<string | null>;
  /** Current on-chain state; null if the account doesn't exist (not created, or closed). */
  getMatch(matchId: bigint): Promise<OnChainMatch | null>;
  /** Startup sanity checks; throws with an actionable message if the deployment is misconfigured. */
  preflight?(): Promise<void>;
  /** Void every Active match the server has no live session for (crash recovery). Returns how many. */
  voidAllActive?(): Promise<number>;
  settle(matchId: bigint, winner: string): Promise<Settlement>;
  voidMatch(matchId: bigint): Promise<string>;
}
