/**
 * One-time: create the escrow Config account on devnet.
 *   ADMIN_KEYPAIR=keys/admin.json AUTHORITY=<server pubkey> TREASURY=<fee wallet pubkey> \
 *   RPC_URL=https://api.devnet.solana.com PROGRAM_ID=<deployed id> npx tsx apps/server/scripts/init-config.ts
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { ixInitialize } from "../src/chain/solana.ts";

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
if (!rpc.includes("devnet") && !rpc.includes("localhost") && !rpc.includes("127.0.0.1") && process.env.I_UNDERSTAND_MAINNET !== "yes") {
  throw new Error("Refusing to run against a non-devnet RPC. Set I_UNDERSTAND_MAINNET=yes if you really mean it.");
}
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(need("ADMIN_KEYPAIR"), "utf8"))));
const programId = new PublicKey(need("PROGRAM_ID"));
const feeBps = Number(process.env.FEE_BPS ?? 0); // no house cut by default
const minStake = BigInt(process.env.MIN_STAKE_LAMPORTS ?? 1_000_000); // 0.001 SOL floor

const ix = ixInitialize(programId, admin.publicKey, new PublicKey(need("AUTHORITY")), new PublicKey(need("TREASURY")), feeBps, minStake);
const sig = await sendAndConfirmTransaction(new Connection(rpc, "confirmed"), new Transaction().add(ix), [admin]);
console.log(`config initialised (fee ${feeBps / 100}%) tx: ${sig}`);
