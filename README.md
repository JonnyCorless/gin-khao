# SolanaSmash

Browser platform fighter where two players each stake **0.01 SOL**, fight a 1v1, and the winner takes the pot minus a **3.3% house cut** (winner gets 0.01934 SOL, house gets 0.00066 SOL). **Devnet prototype**: no real money until the checklist in `docs/PLAN.md` is done.

```
packages/sim        deterministic fighting core (shared by client + server), wire protocol, fee maths
apps/server         Node + ws: matchmaking, 60Hz authoritative sim, settlement, audit log, serves the client
apps/client         Vite + canvas: pixel-art game, wallet connect, client-side prediction, sound, practice bot
programs/escrow     Anchor program: holds both stakes, pays winner, takes the fee, refunds if stuck
scripts/            deploy-devnet.sh (one command), apps/server/scripts/onchain-test.sh (real-validator tests)
```

## Demo it in 2 minutes (no wallet, no chain, no money)

```bash
npm install
npm run build -w @solanasmash/client
npm start                      # http://localhost:8787  (mock chain: stakes are simulated)
```
Open it in two browser windows. In each: **Use dev wallet** → **Stake & find match**. Or **Practice vs bot** for a solo match.
To let others play, put it behind any host that supports WebSockets (see Hosting below) or share your LAN address.

Controls: move `A/D`, jump `W/Space` (x2), fast fall / drop through `S`, attack `J` (+direction for tilts), special `K`, shield `L/Shift` (+left/right to roll), `M` mute, `F3` hitboxes. Gamepads work.
Fighters: **Pounce** (fast cat, dash claw) and **Bork** (heavy dog, throws bones). Damage % builds up; higher % = farther launches; 3 stocks, 5 minutes, sudden death on a tie.

## Real stakes on devnet

Prereqs: Node 22, Rust, Solana CLI (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`), Phantom set to **Devnet**.

```bash
scripts/deploy-devnet.sh       # creates keys in ./keys, deploys, sets fee to 3.3%, funds treasury + authority, writes .env.devnet
npm run build -w @solanasmash/client
set -a; . ./.env.devnet; set +a; npm start
```
It needs ~4 SOL of devnet SOL for the deploy (airdrops, or https://faucet.solana.com; most is refunded if you close the program). **Back up `./keys`** (gitignored): `admin.json` controls the config, `authority.json` settles matches, `treasury.json` receives fees. To use your own fee wallet: `TREASURY=<pubkey> scripts/deploy-devnet.sh`.

Server env: `CHAIN_MODE (mock|solana), RPC_URL, PROGRAM_ID, TREASURY, AUTHORITY_KEYPAIR_FILE | AUTHORITY_SECRET, FEE_BPS (330), STAKE_LAMPORTS (10000000), PORT, ALLOWED_ORIGINS, TRUST_PROXY, MAX_CONNS_PER_IP, DATA_DIR, GRACE_MS, CLIENT_DIR`.
On start in `solana` mode the server **refuses to run** unless the program is deployed, the on-chain config matches your authority + treasury, the treasury holds the rent-exempt minimum and the authority can pay fees. It also **refunds any orphaned active matches** left by a crash.

### Hosting
`Dockerfile` builds one image (server + web client). Any host with WebSocket support works (Fly.io, Render, Railway, a VPS). Set `CHAIN_MODE` and the env above; keep `AUTHORITY_SECRET` in the host's secret store. One instance only (sessions are in memory).

## How a match works

1. Wallet login = signing a server nonce (no passwords).
2. The queue pairs two players. Seat 1 calls `create_match` **naming the opponent** and deposits 0.01 SOL; the program only lets that opponent join, so nobody can front-run and hijack the match. Seat 2 calls `join_match` and deposits. Both stakes sit in a PDA owned by the program. The fee rate (330 bps) is locked at join.
3. 3-2-1, then the **server runs the real game at 60Hz**; clients send inputs only and predict locally. The server's result is the one that counts.
4. `settle` pays **winner = pot − 3.3%, treasury = 3.3%**. A draw (sudden-death timeout) or server fault calls `void_match`: both refunded in full, no fee.
5. Disconnects: 10s to reconnect, then the leaver forfeits (a disconnect before the fight starts refunds both). If the server vanishes, **anyone** can `refund_expired` after 20 minutes; player A can `cancel_match` before the opponent joins. If a deposit lands late after an abort, the server voids it automatically.

The server's signing key can only pick between the two players of a match; the program computes the fee and its destination itself, so a leaked key can't redirect funds (it could still choose winners of in-progress matches: keep it in a secret store and rotate via `update_config`).
Every match's full input log + result is stored in `DATA_DIR` (`replays/<id>.bin`, `results.jsonl`), so any result can be re-derived by replaying inputs through `packages/sim`.

## Tests

```bash
npm test                       # sim (10), mock-chain full flow + matchmaking + limits + Solana encoding (12)
cargo test --manifest-path programs/escrow/Cargo.toml   # fee maths (4)
npm run onchain-test           # builds the program, boots a local validator, runs 13 on-chain tests
```
The on-chain suite covers create/join/cancel/settle/void/timeout refund, attacks (stranger settling, fee redirection, non-player winner, front-running the join, double settle, self-play, dust stake), exact lamport conservation, crash recovery, and the **full server flow in `solana` mode** with keypair bots signing server-built transactions. Its binary uses a 6s timeout (`short-timeout` feature) and goes to a temp dir so it can't be deployed by accident.

## Verified vs not

Verified: everything above, plus **real browsers → real server → real validator** with a wallet provider that signs and submits real transactions: winner net +9,335,000 lamports, loser −10,005,000, treasury +660,000 (= 3.3% of the 0.02 SOL pot; the 5,000 are tx fees). The deploy script was run end to end against a local validator.

Not verified: a **real Phantom extension** (I used a provider that implements the same API), **devnet itself** (local validator only; RPC behaviour/latency may differ), and load beyond a handful of concurrent matches. The escrow program is **unaudited**: get an independent review before it ever holds real value. See `docs/PLAN.md` for risks (legal is the big one).
