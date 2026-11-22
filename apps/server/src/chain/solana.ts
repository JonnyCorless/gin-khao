import { createHash } from "node:crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { computeSplit, type TxAction } from "@solanasmash/sim";
import type { ChainAdapter, OnChainMatch, Settlement } from "./types.ts";

// ---- pure encoding helpers (unit-tested offline; they must mirror programs/escrow/src/lib.rs) ----

/** GameMatch account size: 8 disc + 8 + 32 + 32 + 8 + 1 + 8 + 8 + 2 + 1. Keep in sync with lib.rs. */
export const GAME_MATCH_SIZE = 108;

export const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

export const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

export function configPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}
export function matchPda(programId: PublicKey, matchId: bigint) {
  return PublicKey.findProgramAddressSync([Buffer.from("match"), u64le(matchId)], programId)[0];
}

/** Decode the GameMatch account (8-byte discriminator then borsh fields). */
export function decodeMatch(data: Buffer): OnChainMatch {
  let o = 8;
  const matchId = data.readBigUInt64LE(o); o += 8;
  const a = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const b = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const stake = data.readBigUInt64LE(o); o += 8;
  const status = data.readUInt8(o); o += 1;
  o += 16; // created_at, started_at
  const feeBps = data.readUInt16LE(o);
  return {
    matchId, playerA: a.toBase58(), playerB: b.toBase58(),
    stake, status: status === 0 ? "open" : "active", feeBps,
  };
}

export function ixInitialize(programId: PublicKey, admin: PublicKey, authority: PublicKey, treasury: PublicKey, feeBps: number, minStake: bigint) {
  const fee = Buffer.alloc(2); fee.writeUInt16LE(feeBps);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("initialize"), authority.toBuffer(), treasury.toBuffer(), fee, u64le(minStake)]),
  });
}

export function ixCreate(programId: PublicKey, matchId: bigint, playerA: PublicKey, stake: bigint, opponent: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: playerA, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("create_match"), u64le(matchId), u64le(stake), opponent.toBuffer()]),
  });
}
export function ixJoin(programId: PublicKey, matchId: bigint, playerB: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: playerB, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc("join_match"),
  });
}
export function ixCancel(programId: PublicKey, matchId: bigint, playerA: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: playerA, isSigner: true, isWritable: true },
    ],
    data: disc("cancel_match"),
  });
}
export function ixSettle(
  programId: PublicKey, matchId: bigint, authority: PublicKey, a: PublicKey, b: PublicKey, treasury: PublicKey, winner: PublicKey,
) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: a, isSigner: false, isWritable: true },
      { pubkey: b, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([disc("settle"), winner.toBuffer()]),
  });
}
export function ixRefundExpired(programId: PublicKey, matchId: bigint, caller: PublicKey, a: PublicKey, b: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: caller, isSigner: true, isWritable: false },
      { pubkey: a, isSigner: false, isWritable: true },
      { pubkey: b, isSigner: false, isWritable: true },
    ],
    data: disc("refund_expired"),
  });
}

export function ixVoid(programId: PublicKey, matchId: bigint, authority: PublicKey, a: PublicKey, b: PublicKey) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: a, isSigner: false, isWritable: true },
      { pubkey: b, isSigner: false, isWritable: true },
    ],
    data: disc("void_match"),
  });
}

// ---- adapter ----

export class SolanaChain implements ChainAdapter {
  readonly mode = "solana" as const;
  private conn: Connection;
  private programId: PublicKey;
  private authority: Keypair;
  private treasury: PublicKey;

  constructor(rpcUrl: string, programId: string, authoritySecret: string, treasury: string) {
    this.conn = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(authoritySecret)));
    this.treasury = new PublicKey(treasury);
  }

  async preflight(): Promise<void> {
    const prog = await this.conn.getAccountInfo(this.programId);
    if (!prog?.executable) throw new Error(`program ${this.programId.toBase58()} is not deployed (or not executable) on this cluster`);
    const cfg = await this.conn.getAccountInfo(configPda(this.programId));
    if (!cfg) throw new Error("escrow Config account missing: run apps/server/scripts/init-config.ts first");
    // Config layout: 8 disc, admin, authority, treasury, fee_bps u16, min_stake u64
    const authority = new PublicKey(cfg.data.subarray(8 + 32, 8 + 64));
    const treasury = new PublicKey(cfg.data.subarray(8 + 64, 8 + 96));
    if (!authority.equals(this.authority.publicKey)) throw new Error(`AUTHORITY_SECRET (${this.authorityPubkey}) is not the on-chain authority (${authority.toBase58()})`);
    if (!treasury.equals(this.treasury)) throw new Error(`TREASURY env (${this.treasury.toBase58()}) differs from on-chain treasury (${treasury.toBase58()})`);
    // A system account must stay rent-exempt, so the very first fee payout to an empty treasury would fail.
    const rent = await this.conn.getMinimumBalanceForRentExemption(0);
    const tBal = await this.conn.getBalance(this.treasury);
    if (tBal < rent) throw new Error(`treasury ${this.treasury.toBase58()} holds ${tBal} lamports; send it at least ${rent} so fee payouts don't fail rent checks`);
    const aBal = await this.conn.getBalance(this.authority.publicKey);
    if (aBal < 5_000_000) throw new Error(`authority ${this.authorityPubkey} needs SOL to pay settlement fees (has ${aBal} lamports)`);
  }

  get authorityPubkey() { return this.authority.publicKey.toBase58(); }

  async prepareTx(action: TxAction, matchId: bigint, player: string, stake: bigint, opponent: string): Promise<string> {
    const pk = new PublicKey(player);
    const ix = action === "create" ? ixCreate(this.programId, matchId, pk, stake, new PublicKey(opponent))
      : action === "join" ? ixJoin(this.programId, matchId, pk)
      : ixCancel(this.programId, matchId, pk);
    const { blockhash } = await this.conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: pk, recentBlockhash: blockhash }).add(ix);
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  }

  /** Crash recovery: sessions live in memory, so on startup any Active match is orphaned. Refund them all. */
  async voidAllActive(): Promise<number> {
    const accts = await this.conn.getProgramAccounts(this.programId, { commitment: "confirmed", filters: [{ dataSize: GAME_MATCH_SIZE }] });
    let n = 0;
    for (const { account } of accts) {
      const m = decodeMatch(account.data as Buffer);
      if (m.status !== "active") continue;
      try { await this.voidMatch(m.matchId); n++; } catch (e) { console.error("recovery: could not void", m.matchId, (e as Error).message); }
    }
    return n;
  }

  async getMatch(matchId: bigint): Promise<OnChainMatch | null> {
    const info = await this.conn.getAccountInfo(matchPda(this.programId, matchId), "confirmed");
    if (!info || !info.owner.equals(this.programId)) return null;
    return decodeMatch(info.data as Buffer);
  }

  async settle(matchId: bigint, winner: string): Promise<Settlement> {
    const m = await this.getMatch(matchId);
    if (!m || m.status !== "active" || !m.playerB) throw new Error("match not active on chain");
    if (winner !== m.playerA && winner !== m.playerB) throw new Error("winner is not a player");
    const ix = ixSettle(this.programId, matchId, this.authority.publicKey, new PublicKey(m.playerA), new PublicKey(m.playerB), this.treasury, new PublicKey(winner));
    const sig = await sendAndConfirmTransaction(this.conn, new Transaction().add(ix), [this.authority], { commitment: "confirmed" });
    const { fee, payout } = computeSplit(m.stake, m.feeBps);
    return { sig, payout, fee };
  }

  async voidMatch(matchId: bigint): Promise<string> {
    const m = await this.getMatch(matchId);
    if (!m || m.status !== "active" || !m.playerB) throw new Error("match not active on chain");
    const ix = ixVoid(this.programId, matchId, this.authority.publicKey, new PublicKey(m.playerA), new PublicKey(m.playerB));
    return sendAndConfirmTransaction(this.conn, new Transaction().add(ix), [this.authority], { commitment: "confirmed" });
  }
}
