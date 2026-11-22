import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { computeSplit } from "@solanasmash/sim";
import { ixInitialize, disc, decodeMatch, u64le, matchPda, configPda, ixCreate, ixSettle } from "../src/chain/solana.ts";

const PROGRAM = new PublicKey("3WPvDvnKhi4gKCJreiGGFDX4XTJSKp6yzrCZmL1itRWd");

test("anchor discriminator matches the well-known value for `initialize`", () => {
  assert.equal(disc("initialize").toString("hex"), "afaf6d1f0d989bed");
});

test("decodeMatch parses the exact layout of the Rust GameMatch account", () => {
  const a = PublicKey.unique(), b = PublicKey.unique();
  const buf = Buffer.alloc(8 + 8 + 32 + 32 + 8 + 1 + 8 + 8 + 2 + 1);
  let o = 8;
  buf.writeBigUInt64LE(42n, o); o += 8;
  a.toBuffer().copy(buf, o); o += 32;
  b.toBuffer().copy(buf, o); o += 32;
  buf.writeBigUInt64LE(10_000_000n, o); o += 8;
  buf.writeUInt8(1, o); o += 1;
  o += 16;
  buf.writeUInt16LE(330, o);
  const m = decodeMatch(buf);
  assert.deepEqual(m, { matchId: 42n, playerA: a.toBase58(), playerB: b.toBase58(), stake: 10_000_000n, status: "active", feeBps: 330 });
  buf.writeUInt8(0, 8 + 8 + 64 + 8); // status = open: playerB is the designated opponent, not null
  const open = decodeMatch(buf);
  assert.equal(open.status, "open");
  assert.equal(open.playerB, b.toBase58());
});

test("instruction account order matches the Anchor structs", () => {
  const a = PublicKey.unique(), b = PublicKey.unique(), t = PublicKey.unique(), auth = PublicKey.unique();
  const opp = PublicKey.unique();
  const c = ixCreate(PROGRAM, 7n, a, 123n, opp);
  assert.deepEqual(c.keys.map((k) => [k.isSigner, k.isWritable]), [[false, false], [false, true], [true, true], [false, false]]);
  assert.equal(c.keys[1].pubkey.toBase58(), matchPda(PROGRAM, 7n).toBase58());
  assert.equal(c.keys[0].pubkey.toBase58(), configPda(PROGRAM).toBase58());
  assert.equal(c.data.length, 8 + 8 + 8 + 32);
  assert.equal(c.data.subarray(24).toString("hex"), opp.toBuffer().toString("hex"));
  assert.equal(c.data.subarray(8, 16).toString("hex"), u64le(7n).toString("hex"));
  const s = ixSettle(PROGRAM, 7n, auth, a, b, t, b);
  assert.equal(s.keys.length, 6);
  assert.equal(s.keys[2].isSigner, true);
  assert.equal(s.data.subarray(8).toString("hex"), b.toBuffer().toString("hex"));
});

test("3.3% split is exact and conserves lamports", () => {
  for (const stake of [1n, 10_000_000n, 1_000_000_000n, 123_456_789n]) {
    const { pot, fee, payout } = computeSplit(stake, 330);
    assert.equal(fee + payout, pot);
    assert.ok(fee * 10_000n <= pot * 330n && (fee + 1n) * 10_000n > pot * 330n, "floor(pot*330/10000)");
  }
  assert.equal(computeSplit(10_000_000n, 330).fee, 660_000n);
  assert.equal(computeSplit(10_000_000n, 330).payout, 19_340_000n);
});

test("initialize instruction: 8 + 32 + 32 + 2 + 8 bytes, fee 330 bps little-endian", () => {
  const [a, au, t] = [PublicKey.unique(), PublicKey.unique(), PublicKey.unique()];
  const ix = ixInitialize(PROGRAM, a, au, t, 330, 1000n);
  assert.equal(ix.data.length, 8 + 32 + 32 + 2 + 8);
  assert.equal(ix.data.readUInt16LE(8 + 64), 330);
  assert.equal(ix.data.readBigUInt64LE(8 + 66), 1000n);
});
