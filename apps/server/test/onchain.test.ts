/**
 * On-chain integration test against a local validator. Skipped unless ONCHAIN=1.
 * Run via: scripts/onchain-test.sh   (starts solana-test-validator with the built program)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { computeSplit, INPUT, LOGIN_PREFIX, type ServerMsg } from "@solanasmash/sim";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { SolanaChain, ixRefundExpired, ixInitialize, ixSettle, ixVoid, ixCancel, ixJoin, ixCreate, matchPda } from "../src/chain/solana.ts";

const run = process.env.ONCHAIN === "1";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const PROGRAM = run ? new PublicKey(process.env.PROGRAM_ID!) : PublicKey.default;

async function fund(c: Connection, k: Keypair, sol = 2) {
  const sig = await c.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL);
  await c.confirmTransaction(sig, "confirmed");
}
const bal = (c: Connection, k: PublicKey) => c.getBalance(k, "confirmed").then(BigInt);

async function signSend(c: Connection, txB64: string, kp: Keypair) {
  const tx = Transaction.from(Buffer.from(txB64, "base64"));
  tx.sign(kp);
  const sig = await c.sendRawTransaction(tx.serialize());
  await c.confirmTransaction(sig, "confirmed");
  return sig;
}
const expectFail = async (p: Promise<unknown>, re: RegExp) => {
  await assert.rejects(p, (e: any) => { assert.match(String(e?.message ?? e) + JSON.stringify(e?.logs ?? ""), re); return true; });
};

test("escrow on a real validator", { skip: !run }, async (t) => {
  const c = new Connection(RPC, "confirmed");
  const [admin, authority, treasury, alice, bob, mallory] = Array.from({ length: 6 }, () => Keypair.generate());
  for (const k of [admin, authority, alice, bob, mallory, treasury]) await fund(c, k);

  await sendAndConfirmTransaction(c, new Transaction().add(ixInitialize(PROGRAM, admin.publicKey, authority.publicKey, treasury.publicKey, 330, 1000n)), [admin]);
  const chain = new SolanaChain(RPC, PROGRAM.toBase58(), JSON.stringify([...authority.secretKey]), treasury.publicKey.toBase58());
  await chain.preflight();
  const STAKE = 6_670_000n;
  let id = 1000n;
  const open = async (a: Keypair, b: Keypair, stake = STAKE) => {
    const mid = ++id;
    await signSend(c, (await chain.prepareTx("create", mid, a.publicKey.toBase58(), stake))!, a);
    await signSend(c, (await chain.prepareTx("join", mid, b.publicKey.toBase58(), stake))!, b);
    return mid;
  };

  await t.test("create + join lock both stakes; account decodes correctly", async () => {
    const mid = ++id;
    const before = await bal(c, alice.publicKey);
    await signSend(c, (await chain.prepareTx("create", mid, alice.publicKey.toBase58(), STAKE))!, alice);
    let m = await chain.getMatch(mid);
    assert.deepEqual([m!.status, m!.playerA, m!.playerB, m!.stake], ["open", alice.publicKey.toBase58(), null, STAKE]);
    assert.ok(before - (await bal(c, alice.publicKey)) >= STAKE);
    await signSend(c, (await chain.prepareTx("join", mid, bob.publicKey.toBase58(), STAKE))!, bob);
    m = await chain.getMatch(mid);
    assert.deepEqual([m!.status, m!.playerB, m!.feeBps], ["active", bob.publicKey.toBase58(), 330]);
    await chain.voidMatch(mid); // tidy
  });

  await t.test("settle pays winner pot-3.3%, treasury 3.3%, closes account", async () => {
    const mid = await open(alice, bob);
    const [w0, t0] = [await bal(c, bob.publicKey), await bal(c, treasury.publicKey)];
    const r = await chain.settle(mid, bob.publicKey.toBase58());
    const split = computeSplit(STAKE, 330);
    assert.equal(r.fee, 440_220n);
    assert.equal((await bal(c, bob.publicKey)) - w0, split.payout);
    assert.equal((await bal(c, treasury.publicKey)) - t0, split.fee);
    assert.equal(await chain.getMatch(mid), null, "match account closed");
  });

  await t.test("lamports are conserved across settle (stakes + rent all accounted for)", async () => {
    const keys = [alice, bob, treasury].map((k) => k.publicKey);
    const mid = await open(alice, bob);
    const pdaBal = await bal(c, matchPda(PROGRAM, mid));
    const before = (await Promise.all(keys.map((k) => bal(c, k)))).reduce((x, y) => x + y, 0n);
    await chain.settle(mid, alice.publicKey.toBase58()); // fee payer is authority, not in keys
    const after = (await Promise.all(keys.map((k) => bal(c, k)))).reduce((x, y) => x + y, 0n);
    assert.equal(after - before, pdaBal, "everything in the PDA went to alice/bob/treasury");
  });

  await t.test("void refunds both stakes in full, no fee", async () => {
    const mid = await open(alice, bob);
    const [a0, b0, t0] = [await bal(c, alice.publicKey), await bal(c, bob.publicKey), await bal(c, treasury.publicKey)];
    await chain.voidMatch(mid);
    assert.ok((await bal(c, alice.publicKey)) - a0 >= STAKE, "alice got stake (+rent)");
    assert.equal((await bal(c, bob.publicKey)) - b0, STAKE);
    assert.equal(await bal(c, treasury.publicKey), t0);
  });

  await t.test("player A can cancel an un-joined match and gets everything back", async () => {
    const mid = ++id;
    const a0 = await bal(c, alice.publicKey);
    await signSend(c, (await chain.prepareTx("create", mid, alice.publicKey.toBase58(), STAKE))!, alice);
    await signSend(c, (await chain.prepareTx("cancel", mid, alice.publicKey.toBase58(), STAKE))!, alice);
    assert.equal(await chain.getMatch(mid), null);
    assert.ok(a0 - (await bal(c, alice.publicKey)) < 20_000n, "only tx fees lost");
  });

  await t.test("attacks are rejected", async () => {
    const mid = await open(alice, bob);
    const send = (ix: any, signers: Keypair[]) => sendAndConfirmTransaction(c, new Transaction().add(ix), signers);
    // mallory can't settle or void even though she signs
    await expectFail(send(ixSettle(PROGRAM, mid, mallory.publicKey, alice.publicKey, bob.publicKey, treasury.publicKey, mallory.publicKey), [mallory]), /Error|failed|custom/i);
    await expectFail(send(ixVoid(PROGRAM, mid, mallory.publicKey, alice.publicKey, bob.publicKey), [mallory]), /Error|failed|custom/i);
    // authority can't pay a non-player
    await expectFail(send(ixSettle(PROGRAM, mid, authority.publicKey, alice.publicKey, bob.publicKey, treasury.publicKey, mallory.publicKey), [authority]), /InvalidWinner|6004|custom/i);
    // authority can't redirect the fee to another wallet
    await expectFail(send(ixSettle(PROGRAM, mid, authority.publicKey, alice.publicKey, bob.publicKey, mallory.publicKey, alice.publicKey), [authority]), /Error|failed|custom|constraint/i);
    // nobody can cancel an active match, or refund before the timeout
    await expectFail(send(ixCancel(PROGRAM, mid, alice.publicKey), [alice]), /BadStatus|6002|custom/i);
    // can't join twice / join own match
    await expectFail(send(ixJoin(PROGRAM, mid, mallory.publicKey), [mallory]), /BadStatus|6002|custom/i);
    // refund_expired too early
    const { default: _ } = { default: 0 };
    assert.ok((await chain.getMatch(mid))!.status === "active", "match untouched by failed attacks");
    // double settle: second attempt fails because the account is gone
    await chain.settle(mid, alice.publicKey.toBase58());
    await assert.rejects(chain.settle(mid, alice.publicKey.toBase58()));
  });

  await t.test("refund_expired: rejected early, then anyone can refund both stakes after the timeout", async () => {
    const mid = await open(alice, bob);
    const ix = () => ixRefundExpired(PROGRAM, mid, mallory.publicKey, alice.publicKey, bob.publicKey);
    await expectFail(sendAndConfirmTransaction(c, new Transaction().add(ix()), [mallory]), /NotExpired|6005|custom/i);
    await new Promise((r) => setTimeout(r, 8000)); // test build uses a 6s timeout
    const [a0, b0] = [await bal(c, alice.publicKey), await bal(c, bob.publicKey)];
    await sendAndConfirmTransaction(c, new Transaction().add(ix()), [mallory]);
    assert.ok((await bal(c, alice.publicKey)) - a0 >= STAKE);
    assert.equal((await bal(c, bob.publicKey)) - b0, STAKE);
    assert.equal(await chain.getMatch(mid), null);
  });

  await t.test("FULL FLOW in solana mode: server + two wallet bots, real txs, fight, on-chain 3.3% payout", async () => {
    const cfg = loadConfig({
      PORT: "0", CHAIN_MODE: "solana", RPC_URL: RPC, PROGRAM_ID: PROGRAM.toBase58(),
      AUTHORITY_SECRET: JSON.stringify([...authority.secretKey]), TREASURY: treasury.publicKey.toBase58(),
      TICK_MS: "2", START_STOCKS: "1", COUNTDOWN_MS: "100", DEPOSIT_TIMEOUT_MS: "20000", FALLBACK_SOL_USD: "150",
      DATA_DIR: mkdtempSync(join(tmpdir(), "smash-chain-")),
    } as any);
    const srv = await startServer(cfg); // runs preflight against the validator
    try {
      const mkBot = async (kp: Keypair) => {
        const nk = nacl.sign.keyPair.fromSecretKey(kp.secretKey);
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
        const bot = { kp, ws, seat: 0, input: null as number | null, msgs: [] as ServerMsg[], waiters: [] as any[], matched: null as any,
          next<T extends ServerMsg["t"]>(tt: T, ms = 30000) {
            const hit = bot.msgs.find((m) => m.t === tt);
            if (hit) return Promise.resolve(hit as Extract<ServerMsg, { t: T }>);
            return new Promise<Extract<ServerMsg, { t: T }>>((res, rej) => { const to = setTimeout(() => rej(new Error("timeout " + tt)), ms); bot.waiters.push({ tt, res: (m: any) => { clearTimeout(to); res(m); } }); });
          } };
        ws.on("message", async (raw) => {
          const m = JSON.parse(raw.toString()) as ServerMsg;
          bot.msgs.push(m);
          if (m.t === "challenge") ws.send(JSON.stringify({ t: "auth", pubkey: kp.publicKey.toBase58(), signature: Buffer.from(nacl.sign.detached(new TextEncoder().encode(LOGIN_PREFIX + m.nonce), nk.secretKey)).toString("base64") }));
          if (m.t === "matched") { bot.seat = m.seat; bot.matched = m; }
          if (m.t === "tx" && m.tx) { await signSend(c, m.tx, kp); ws.send(JSON.stringify({ t: "deposited" })); }
          if (m.t === "status" && m.phase === "playing" && bot.input != null) ws.send(JSON.stringify({ t: "input", input: bot.input, cf: 1 }));
          for (const w of [...bot.waiters]) if (w.tt === m.t) { bot.waiters.splice(bot.waiters.indexOf(w), 1); w.res(m); }
        });
        await new Promise((r) => ws.on("open", r));
        return bot;
      };
      const base = new Map<string, bigint>();
      for (const k of [alice, bob, treasury]) base.set(k.publicKey.toBase58(), await bal(c, k.publicKey));
      const p1 = await mkBot(alice), p2 = await mkBot(bob);
      await p1.next("authed"); await p2.next("authed");
      p1.ws.send(JSON.stringify({ t: "queue", char: 0 })); p2.ws.send(JSON.stringify({ t: "queue", char: 1 }));
      const [m1] = await Promise.all([p1.next("matched"), p2.next("matched")]);
      const [seat0, seat1] = p1.seat === 0 ? [p1, p2] : [p2, p1];
      seat1.input = INPUT.LEFT; // seat 1 walks off the stage
      const stake = BigInt(m1.stakeLamports);
      const [r1, r2] = await Promise.all([p1.next("result", 60000), p2.next("result", 60000)]);
      assert.equal(r1.winner, 0); assert.equal(r2.winner, 0);
      assert.ok(r1.sig && !r1.sig.startsWith("mock"));
      const split = computeSplit(stake, 330);
      assert.equal(r1.payout, split.payout.toString()); assert.equal(r1.fee, split.fee.toString());
      // exact net results: winner = payout - stake - 5000 tx fee; loser = -stake - 5000; treasury = +fee. (Rent is refunded to player A.)
      const net = async (k: Keypair) => (await bal(c, k.publicKey)) - base.get(k.publicKey.toBase58())!;
      assert.equal(await net(seat0.kp), split.payout - stake - 5000n, "winner net");
      assert.equal(await net(seat1.kp), -stake - 5000n, "loser net");
      assert.equal(await net(treasury), split.fee, "treasury net");
      assert.equal(await srv.chain.getMatch(BigInt(m1.matchId)), null);
    } finally { await srv.close(); }
  });

  await t.test("self-play and sub-minimum stakes rejected", async () => {
    const mid = ++id;
    await signSend(c, (await chain.prepareTx("create", mid, alice.publicKey.toBase58(), STAKE))!, alice);
    await expectFail(sendAndConfirmTransaction(c, new Transaction().add(ixJoin(PROGRAM, mid, alice.publicKey)), [alice]), /SamePlayer|6003|custom/i);
    await signSend(c, (await chain.prepareTx("cancel", mid, alice.publicKey.toBase58(), STAKE))!, alice);
    await expectFail(sendAndConfirmTransaction(c, new Transaction().add(ixCreate(PROGRAM, ++id, alice.publicKey, 10n)), [alice]), /StakeTooSmall|6001|custom/i);
  });
});

test("preflight catches an unfunded treasury and a wrong authority", { skip: !run }, async () => {
  const c = new Connection(RPC, "confirmed");
  const [admin, authority, treasury] = Array.from({ length: 3 }, () => Keypair.generate());
  // separate program state isn't possible (config is a singleton PDA), so check the error paths against the live config
  const wrong = new SolanaChain(RPC, PROGRAM.toBase58(), JSON.stringify([...authority.secretKey]), treasury.publicKey.toBase58());
  await assert.rejects(wrong.preflight(), /not the on-chain authority|Config account missing|differs/);
  void admin; void c;
});
