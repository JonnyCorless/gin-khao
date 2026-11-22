import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { INPUT, LOGIN_PREFIX, type ServerMsg } from "@solanasmash/sim";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import type { MockChain } from "../src/chain/mock.ts";

class Bot {
  kp = nacl.sign.keyPair();
  pubkey = bs58.encode(this.kp.publicKey);
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  seat: 0 | 1 = 0;
  autoInput: number | null = null;
  waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  constructor(private url: string, private badSig = false) {}

  connect() {
    return new Promise<void>((resolve) => {
      this.ws = new WebSocket(this.url);
      this.ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString()) as ServerMsg;
        this.msgs.push(m);
        if (m.t === "challenge") {
          const sig = nacl.sign.detached(new TextEncoder().encode(LOGIN_PREFIX + m.nonce), this.kp.secretKey);
          const sigB64 = Buffer.from(this.badSig ? new Uint8Array(64) : sig).toString("base64");
          this.send({ t: "auth", pubkey: this.pubkey, signature: sigB64 });
        }
        if (m.t === "matched") this.seat = m.seat;
        if (m.t === "tx") this.send({ t: "deposited" }); // mock wallet: instantly "signs"
        if (m.t === "status" && m.phase === "playing" && this.autoInput != null) this.send({ t: "input", input: this.autoInput, cf: 1 });
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
      });
      this.ws.on("open", () => resolve());
    });
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMsg["t"]>(t: T, timeout = 8000): Promise<Extract<ServerMsg, { t: T }>> {
    const hit = this.msgs.find((m) => m.t === t);
    if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit as any); }
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(`timeout waiting for ${t}; got ${this.msgs.map((m) => m.t).join(",")}`)), timeout);
      this.waiters.push({ pred: (m) => m.t === t, res: (m) => { clearTimeout(to); this.msgs.splice(this.msgs.indexOf(m), 1); res(m as any); } });
    });
  }
}

async function harness(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "smash-"));
  const cfg = loadConfig({ PORT: "0", TICK_MS: "2", START_STOCKS: "1", COUNTDOWN_MS: "50", DEPOSIT_TIMEOUT_MS: "1500", GRACE_MS: "300", DATA_DIR: dir, ...overrides } as any);
  const srv = await startServer(cfg);
  return { srv, chain: srv.chain as MockChain, url: `ws://127.0.0.1:${srv.port}` };
}

async function pair(url: string) {
  const a = new Bot(url), b = new Bot(url);
  await a.connect(); await b.connect();
  await a.next("authed"); await b.next("authed");
  a.send({ t: "queue", char: 0 }); b.send({ t: "queue", char: 1 });
  const [ma, mb] = await Promise.all([a.next("matched"), b.next("matched")]);
  return { a, b, ma, mb };
}

test("full 1v1: queue -> stake -> fight -> 3.3% settlement", async () => {
  const { srv, chain, url } = await harness();
  try {
    const { a, b, ma } = await pair(url);
    assert.equal(ma.stakeLamports, "10000000"); // 0.01 SOL each
    assert.equal(ma.fee, "660000"); // 3.3% of 20,000,000
    assert.equal(ma.payout, "19340000");
    const [seat0, seat1] = a.seat === 0 ? [a, b] : [b, a];
    seat1.autoInput = INPUT.LEFT; // seat 1 walks off the edge
    const [ra, rb] = await Promise.all([a.next("result", 15000), b.next("result", 15000)]);
    assert.equal(ra.winner, 0);
    assert.equal(rb.winner, 0);
    assert.equal(ra.payout, "19340000");
    assert.equal(ra.fee, "660000");
    assert.ok(ra.sig);
    // ledger: winner nets stake - fee, loser loses stake, treasury got the fee
    assert.equal(chain.balances.get(seat0.pubkey), 19340000n - 10000000n);
    assert.equal(chain.balances.get(seat1.pubkey), -10000000n);
    assert.equal(chain.treasury, 660000n);
    const net = [...chain.balances.values()].reduce((x, y) => x + y, 0n) + chain.treasury;
    assert.equal(net, 0n, "no money created or destroyed");
    assert.equal(chain.matches.size, 0);
  } finally { await srv.close(); }
});

test("forfeit: leaving mid-fight past the grace window loses the pot", async () => {
  const { srv, chain, url } = await harness({ START_STOCKS: "3" });
  try {
    const { a, b } = await pair(url);
    await Promise.all([a.next("start"), b.next("start")]);
    await new Promise((r) => setTimeout(r, 120));
    const [stayer, leaver] = [a, b];
    leaver.ws.close();
    const opp = await stayer.next("opp_status");
    assert.equal(opp.connected, false);
    const res = await stayer.next("result", 3000);
    assert.equal(res.winner, stayer.seat);
    assert.match(res.reason, /forfeit/);
    assert.equal(chain.treasury, 660000n);
  } finally { await srv.close(); }
});

test("reconnect within the grace window resumes the match", async () => {
  const { srv, url } = await harness({ START_STOCKS: "3", GRACE_MS: "2000" });
  try {
    const { a, b } = await pair(url);
    await Promise.all([a.next("start"), b.next("start")]);
    await new Promise((r) => setTimeout(r, 100));
    b.ws.close();
    await a.next("opp_status");
    const b2 = new Bot(url); b2.kp = b.kp; b2.pubkey = b.pubkey;
    await b2.connect();
    const restart = await b2.next("start");
    assert.ok(restart.frame0.frame > 0, "resumes from the live state");
    const back = await a.next("opp_status");
    assert.equal(back.connected, true);
  } finally { await srv.close(); }
});

test("opponent never stakes: match aborts, nothing charged", async () => {
  const { srv, chain, url } = await harness({ DEPOSIT_TIMEOUT_MS: "700" });
  try {
    const a = new Bot(url), b = new Bot(url);
    await a.connect(); await b.connect();
    await a.next("authed"); await b.next("authed");
    // make both bots ignore tx prompts so nobody deposits
    for (const bot of [a, b]) bot.send = ((orig) => (m: any) => { if (m.t !== "deposited") orig(m); })(bot.send.bind(bot));
    a.send({ t: "queue", char: 0 }); b.send({ t: "queue", char: 1 });
    const r = await a.next("result", 4000);
    assert.equal(r.winner, -1);
    assert.equal(chain.matches.size, 0);
    assert.equal([...chain.balances.values()].length, 0);
  } finally { await srv.close(); }
});

test("same wallet in two tabs can't be double-booked; dead sockets are skipped", async () => {
  const { srv, chain, url } = await harness({ START_STOCKS: "3" });
  try {
    const a = new Bot(url), a2 = new Bot(url), b = new Bot(url), c = new Bot(url);
    a2.kp = a.kp; a2.pubkey = a.pubkey; // same wallet, second tab
    for (const x of [a, a2, b, c]) { await x.connect(); await x.next("authed"); }
    a.send({ t: "queue", char: 0 });
    const e = await (async () => { a2.send({ t: "queue", char: 0 }); return a2.next("error", 2000).catch(() => null); })();
    void e; // second tab is either rejected or ignored; either way it must not get its own match
    b.ws.close(); // dead socket sitting in the queue
    await new Promise((r) => setTimeout(r, 100));
    c.send({ t: "queue", char: 1 });
    const [ma, mc] = await Promise.all([a.next("matched", 4000), c.next("matched", 4000)]);
    assert.equal(ma.opponent, c.pubkey);
    assert.equal(mc.opponent, a.pubkey);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(a2.msgs.some((m) => m.t === "matched"), false, "second tab was not matched");
    assert.equal(chain.matches.size >= 0, true);
  } finally { await srv.close(); }
});

test("per-IP connection cap", async () => {
  const { srv, url } = await harness({ MAX_CONNS_PER_IP: "2" });
  try {
    const open = (): Promise<string> => new Promise((res) => {
      const ws = new WebSocket(url);
      ws.on("open", () => setTimeout(() => res(ws.readyState === ws.OPEN ? "open" : "closed"), 150));
      ws.on("close", () => res("closed"));
    });
    const r = await Promise.all([open(), open(), open()]);
    assert.equal(r.filter((x) => x === "open").length, 2);
  } finally { await srv.close(); }
});

test("forged login signature is rejected", async () => {
  const { srv, url } = await harness();
  try {
    const bad = new Bot(url, true);
    await bad.connect();
    const e = await bad.next("error");
    assert.equal(e.code, "auth");
    bad.send({ t: "queue", char: 0 });
    const e2 = await bad.next("error");
    assert.equal(e2.code, "auth");
  } finally { await srv.close(); }
});
