import { computeSplit, type TxAction } from "@solanasmash/sim";
import type { ChainAdapter, OnChainMatch, Settlement } from "./types.ts";

/**
 * In-memory ledger that behaves like the escrow program. `prepareTx` returns null and the client's
 * "deposited" ack is what moves the mock ledger, so the whole flow runs without a wallet or RPC.
 */
export class MockChain implements ChainAdapter {
  readonly mode = "mock" as const;
  matches = new Map<bigint, OnChainMatch>();
  balances = new Map<string, bigint>(); // net lamports won/lost, for assertions
  treasury = 0n;
  log: string[] = [];

  constructor(private feeBps: number) {}

  async prepareTx(action: TxAction, matchId: bigint, player: string, stake: bigint): Promise<string | null> {
    // mock "wallet": apply the effect as soon as the client acks (done via applyDeposit)
    this.pending.set(`${action}:${matchId}`, { player, stake });
    return null;
  }
  private pending = new Map<string, { player: string; stake: bigint }>();

  /** Called when a mock client acks its tx. */
  applyAck(action: TxAction, matchId: bigint) {
    const p = this.pending.get(`${action}:${matchId}`);
    if (!p) return;
    this.pending.delete(`${action}:${matchId}`);
    if (action === "create") {
      this.matches.set(matchId, { matchId, playerA: p.player, playerB: null, stake: p.stake, status: "open", feeBps: 0 });
      this.add(p.player, -p.stake);
    } else if (action === "join") {
      const m = this.matches.get(matchId);
      if (!m || m.status !== "open") return;
      m.playerB = p.player; m.status = "active"; m.feeBps = this.feeBps;
      this.add(p.player, -p.stake);
    } else if (action === "cancel") {
      const m = this.matches.get(matchId);
      if (m && m.status === "open") { this.add(m.playerA, m.stake); this.matches.delete(matchId); }
    }
  }

  async getMatch(matchId: bigint) { return this.matches.get(matchId) ?? null; }

  async settle(matchId: bigint, winner: string): Promise<Settlement> {
    const m = this.matches.get(matchId);
    if (!m || m.status !== "active") throw new Error("mock: not active");
    if (winner !== m.playerA && winner !== m.playerB) throw new Error("mock: invalid winner");
    const { fee, payout } = computeSplit(m.stake, m.feeBps);
    this.add(winner, payout);
    this.treasury += fee;
    this.matches.delete(matchId);
    this.log.push(`settle ${matchId} -> ${winner}`);
    return { sig: `mock-settle-${matchId}`, payout, fee };
  }

  async voidMatch(matchId: bigint): Promise<string> {
    const m = this.matches.get(matchId);
    if (!m || m.status !== "active") throw new Error("mock: not active");
    this.add(m.playerA, m.stake); this.add(m.playerB!, m.stake);
    this.matches.delete(matchId);
    this.log.push(`void ${matchId}`);
    return `mock-void-${matchId}`;
  }

  private add(k: string, d: bigint) { this.balances.set(k, (this.balances.get(k) ?? 0n) + d); }
}
