import { createHash } from "node:crypto";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { computeSplit, type TxAction } from "@solanasmash/sim";
import type { ChainAdapter, OnChainMatch, Settlement } from "./types.ts";

// ---- pure encoding helpers (unit-tested offline; they must mirror programs/escrow/src/lib.rs) ----

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
    matchId, playerA: a.toBase58(), playerB: b.equals(PublicKey.default) ? null : b.toBase58(),
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

export function ixCreate(programId: PublicKey, matchId: bigint, playerA: PublicKey, stake: bigint) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: configPda(programId), isSigner: false, isWritable: false },
      { pubkey: matchPda(programId, matchId), isSigner: false, isWritable: true },
      { pubkey: playerA, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("create_match"), u64le(matchId), u64le(stake)]),
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

  get authorityPubkey() { return this.authority.publicKey.toBase58(); }

  async prepareTx(action: TxAction, matchId: bigint, player: string, stake: bigint): Promise<string> {
    const pk = new PublicKey(player);
    const ix = action === "create" ? ixCreate(this.programId, matchId, pk, stake)
      : action === "join" ? ixJoin(this.programId, matchId, pk)
      : ixCancel(this.programId, matchId, pk);
    const { blockhash } = await this.conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: pk, recentBlockhash: blockhash }).add(ix);
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
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
