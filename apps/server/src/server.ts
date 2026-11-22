import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { encodeMsg, type ClientMsg, type ServerMsg } from "@solanasmash/sim";
import { verifyLogin, newNonce } from "./auth.ts";
import type { ChainAdapter } from "./chain/types.ts";
import { MockChain } from "./chain/mock.ts";
import { SolanaChain } from "./chain/solana.ts";
import { loadConfig, type Config } from "./config.ts";
import { quoteStake } from "./price.ts";
import { Session, type Client } from "./session.ts";

class Conn implements Client {
  nonce = newNonce();
  pubkey: string | null = null;
  session: Session | null = null;
  queuedChar: number | null = null;
  msgs = 0;
  constructor(public ws: WebSocket) {}
  send(m: ServerMsg) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(encodeMsg(m)); }
}

export function makeChain(cfg: Config): ChainAdapter {
  if (cfg.mode === "mock") return new MockChain(cfg.feeBps);
  if (!cfg.authoritySecret || !cfg.treasury) throw new Error("AUTHORITY_SECRET and TREASURY are required in solana mode");
  return new SolanaChain(cfg.rpcUrl, cfg.programId, cfg.authoritySecret, cfg.treasury);
}

export async function startServer(cfg: Config = loadConfig(), chain: ChainAdapter = makeChain(cfg)) {
  await chain.preflight?.();
  const sessions = new Map<string, Session>(); // pubkey -> live session
  const queue: Conn[] = [];

  const http: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: cfg.mode, queued: queue.length, matches: new Set(sessions.values()).size }));
    } else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({
    server: http, maxPayload: 4096,
    verifyClient: ({ origin }: { origin?: string }) => cfg.allowedOrigins.length === 0 || (!!origin && cfg.allowedOrigins.includes(origin)),
  });

  const dequeue = (c: Conn) => { const i = queue.indexOf(c); if (i >= 0) queue.splice(i, 1); c.queuedChar = null; };

  async function tryMatch() {
    while (queue.length >= 2) {
      const i = queue.findIndex((c, idx) => idx > 0 && c.pubkey !== queue[0].pubkey);
      if (i < 0) return;
      let [a] = queue.splice(0, 1);
      let [b] = queue.splice(i - 1, 1);
      if (Math.random() < 0.5) [a, b] = [b, a]; // seat 0 deposits first; randomise who that is
      try {
        const quote = await quoteStake(cfg.stakeUsd, cfg.fallbackSolUsd);
        const s = new Session(cfg, chain, quote, { client: a, char: a.queuedChar ?? 0 }, { client: b, char: b.queuedChar ?? 1 }, (done) => {
          for (const pk of done.pubkeys) if (sessions.get(pk) === done) sessions.delete(pk);
        });
        a.queuedChar = b.queuedChar = null;
        sessions.set(a.pubkey!, s); sessions.set(b.pubkey!, s);
        void s.run();
      } catch (e) {
        for (const c of [a, b]) { c.queuedChar = null; c.send({ t: "error", code: "quote", msg: "Couldn't price the stake right now. Try again shortly." }); }
        console.error("quote failed", e);
      }
    }
  }

  wss.on("connection", (ws) => {
    const c = new Conn(ws);
    c.send({ t: "challenge", nonce: c.nonce, mode: cfg.mode, feeBps: cfg.feeBps });
    let windowStart = Date.now();

    ws.on("message", (raw) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; c.msgs = 0; }
      if (++c.msgs > 240) { ws.close(1008, "rate limit"); return; }

      let m: ClientMsg;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== "object") return;

      if (m.t === "ping") { c.send({ t: "pong", ts: Number(m.ts) || 0 }); return; }

      if (m.t === "auth") {
        if (c.pubkey) return;
        const pk = typeof m.pubkey === "string" && typeof m.signature === "string" ? verifyLogin(m.pubkey, m.signature, c.nonce) : null;
        if (!pk) { c.send({ t: "error", code: "auth", msg: "Signature check failed" }); return; }
        c.pubkey = pk;
        c.send({ t: "authed", pubkey: pk });
        const live = sessions.get(pk);
        if (live) live.attach(c); // reconnect into a running match
        return;
      }
      if (!c.pubkey) { c.send({ t: "error", code: "auth", msg: "Not logged in" }); return; }

      switch (m.t) {
        case "queue": {
          if (c.session || sessions.has(c.pubkey)) { c.send({ t: "error", code: "busy", msg: "You're already in a match" }); return; }
          if (queue.includes(c)) return;
          c.queuedChar = m.char === 1 ? 1 : 0;
          queue.push(c);
          c.send({ t: "queued", waiting: queue.length });
          void tryMatch();
          return;
        }
        case "leave": dequeue(c); c.send({ t: "left" }); return;
        case "deposited": c.session?.onDeposited(c.pubkey); return;
        case "input": c.session?.onInput(c.pubkey, m.input, m.cf); return;
      }
    });

    ws.on("close", () => { dequeue(c); c.session?.detach(c); });
    ws.on("error", () => ws.close());
  });

  return new Promise<{ http: Server; chain: ChainAdapter; port: number; close: () => Promise<void> }>((resolve) => {
    http.listen(cfg.port, () => {
      const port = (http.address() as any).port as number;
      resolve({
        http, chain, port,
        close: () => new Promise<void>((r) => { for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(() => r()); }),
      });
    });
  });
}
