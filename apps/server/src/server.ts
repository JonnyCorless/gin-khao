import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { CHARACTERS, encodeMsg, type ClientMsg, type ServerMsg } from "@solanasmash/sim";
import { verifyLogin, newNonce } from "./auth.ts";
import type { ChainAdapter } from "./chain/types.ts";
import { MockChain } from "./chain/mock.ts";
import { SolanaChain } from "./chain/solana.ts";
import { loadConfig, type Config } from "./config.ts";
import { Session, type Client } from "./session.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".map": "application/json",
};

class Conn implements Client {
  alive = true;
  ip = "";
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
  if (chain.voidAllActive) {
    const n = await chain.voidAllActive();
    if (n > 0) console.log(`recovery: voided ${n} orphaned active match(es); both players were refunded`);
  }
  const sessions = new Map<string, Session>(); // pubkey -> live session
  const queue: Conn[] = [];

  const http: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: cfg.mode, queued: queue.length, matches: new Set(sessions.values()).size }));
      return;
    }
    if (!cfg.clientDir) { res.writeHead(404); res.end(); return; }
    // static client (single-service deploy). Path traversal safe: resolved path must stay inside clientDir.
    const root = resolve(cfg.clientDir);
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let file = resolve(join(root, normalize(urlPath === "/" ? "/index.html" : urlPath)));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    readFile(file).catch(() => { file = join(root, "index.html"); return readFile(file); }).then(
      (buf) => { res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" }); res.end(buf); },
      () => { res.writeHead(404); res.end(); },
    );
  });
  const wss = new WebSocketServer({
    server: http, maxPayload: 4096,
    verifyClient: ({ origin }: { origin?: string }) => cfg.allowedOrigins.length === 0 || (!!origin && cfg.allowedOrigins.includes(origin)),
  });

  const dequeue = (c: Conn) => { const i = queue.indexOf(c); if (i >= 0) queue.splice(i, 1); c.queuedChar = null; };

  let matching = false;
  /** Pair queued players. Skips dead sockets and wallets that are already in a match. */
  function tryMatch() {
    if (matching) return; // re-entrancy guard; the loop below drains the queue
    matching = true;
    try {
      for (let guard = 0; guard < 100; guard++) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (!queue[i].alive || sessions.has(queue[i].pubkey!)) queue.splice(i, 1);
        }
        const bi = queue.findIndex((c, idx) => idx > 0 && c.pubkey !== queue[0].pubkey);
        if (queue.length < 2 || bi < 0) return;
        const first = queue.splice(0, 1)[0];
        const second = queue.splice(bi - 1, 1)[0];
        // one wallet may be queued from several tabs: drop the extra entries so it can't be double-booked
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].pubkey === first.pubkey || queue[i].pubkey === second.pubkey) queue.splice(i, 1);
        }
        const [a, b] = Math.random() < 0.5 ? [second, first] : [first, second]; // seat 0 deposits first; randomise who
        const bChar = b.queuedChar ?? (a.queuedChar === 1 ? 0 : 1); // default to a different fighter than A's
        const s = new Session(cfg, chain, cfg.stakeLamports, { client: a, char: a.queuedChar ?? 0 }, { client: b, char: bChar }, (done) => {
          for (const pk of done.pubkeys) if (sessions.get(pk) === done) sessions.delete(pk);
        });
        a.queuedChar = b.queuedChar = null;
        sessions.set(a.pubkey!, s);
        sessions.set(b.pubkey!, s);
        void s.run();
      }
    } finally {
      matching = false;
    }
  }

  const perIp = new Map<string, number>();
  wss.on("connection", (ws, req) => {
    const fwd = cfg.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ip = fwd || req.socket.remoteAddress || "?";
    if ((perIp.get(ip) ?? 0) >= cfg.maxConnsPerIp) { ws.close(1013, "too many connections"); return; }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const c = new Conn(ws);
    c.ip = ip;
    c.send({ t: "challenge", nonce: c.nonce, mode: cfg.mode, feeBps: cfg.feeBps, stakeLamports: cfg.stakeLamports.toString() });
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
          c.queuedChar = Number.isInteger(m.char) && m.char >= 0 && m.char < CHARACTERS.length ? m.char : 0;
          queue.push(c);
          c.send({ t: "queued", waiting: queue.length });
          tryMatch();
          return;
        }
        case "leave": dequeue(c); c.send({ t: "left" }); return;
        case "deposited": c.session?.onDeposited(c.pubkey); return;
        case "input": c.session?.onInput(c.pubkey, m.input, m.cf); return;
      }
    });

    ws.on("close", () => {
      c.alive = false;
      perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
      dequeue(c);
      c.session?.detach(c);
    });
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
