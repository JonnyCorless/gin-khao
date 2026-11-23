# SolanaSmash

Browser platform fighter where two players each stake **0.01 SOL**, fight a 1v1, and the winner takes **the entire pot — no house fee**. The fee is still a supported, configurable field on the escrow (`FEE_BPS`, 0 by default), kept for anyone who later wants a different model, but nothing ships taking a cut. **Devnet prototype**: real-money operation is a real legal question in most jurisdictions, not just an engineering one, and a zero house fee reduces that risk without eliminating it — see `docs/LEGAL.md` before taking this anywhere near mainnet. Eight original characters (none based on existing copyrighted or trademarked IP) built on a formal 5-axis stat system — see `docs/CHARACTERS.md`.

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
8 original fighters on a formal stat system — see `docs/CHARACTERS.md`. Damage % builds up; higher % = farther launches; 3 stocks, 5 minutes, sudden death on a tie. 3 cosmetic skins per character (no gameplay effect), pick one next to the roster.

## Monetization (optional, off by default)

No house fee ships — see "How a match works" below for why, and `docs/LEGAL.md` for the real (partial) legal effect of that choice. If you want revenue, it's kept entirely separate from staked matches: fill in `apps/client/src/community.ts` (`TIP_ADDRESS`, `COMMUNITY_URL` — both blank/hidden until set) for a tip-jar button and a Discord/Patreon link in the lobby. Never wire anything that touches stake size, odds or payout into this — that's just the house fee again under a different name.

## Real stakes on devnet

Prereqs: Node 22, Rust, Solana CLI (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`), Phantom set to **Devnet**.

```bash
scripts/deploy-devnet.sh       # creates keys in ./keys, deploys, fee defaults to 0 (no house cut), writes .env.devnet
npm run build -w @solanasmash/client
set -a; . ./.env.devnet; set +a; npm start
```
It needs ~4 SOL of devnet SOL for the deploy (airdrops, or https://faucet.solana.com; most is refunded if you close the program). **Back up `./keys`** (gitignored): `admin.json` controls the config, `authority.json` settles matches. The escrow program's `Config` always has a treasury field, but at the default 0 bps fee it never receives anything and the script doesn't fund it; pass `FEE_BPS=<n>` (and optionally `TREASURY=<pubkey>`) to `scripts/deploy-devnet.sh` if you ever want a nonzero cut.

Server env: `CHAIN_MODE (mock|solana), RPC_URL, PROGRAM_ID, TREASURY, AUTHORITY_KEYPAIR_FILE | AUTHORITY_SECRET, FEE_BPS (0 — no house cut), STAKE_LAMPORTS (10000000), PORT, ALLOWED_ORIGINS, TRUST_PROXY, MAX_CONNS_PER_IP, DATA_DIR, GRACE_MS, CLIENT_DIR`.
On start in `solana` mode the server **refuses to run** unless the program is deployed, the on-chain config matches your authority + treasury, the treasury holds the rent-exempt minimum and the authority can pay fees. It also **refunds any orphaned active matches** left by a crash.

### Hosting
`Dockerfile` builds one image (server + web client). Any host with WebSocket support works (Fly.io, Render, Railway, a VPS). Set `CHAIN_MODE` and the env above; keep `AUTHORITY_SECRET` in the host's secret store. One instance only (sessions are in memory).

### The fee wallet (treasury) is a normal, visible on-chain address — and by default receives nothing

The shipped default is 0 bps: players keep the entire pot, the platform takes nothing. The fee field still exists on the escrow (it's just a config value, capped at 10%) in case that model ever changes, and it's **not** obscured and can't be: every `settle` call emits a public `MatchSettled` event naming the treasury pubkey, and the destination is a plain `Config` account field anyone can read with `getAccountInfo` or a block explorer (`solana.fm`/`explorer.solana.com`, devnet cluster). Trying to hide it would just mean an address nobody can verify charges whatever it charges, which is worse for players, not better.

If you want the fee to go to a wallet you already hold and recognise (rather than a script-generated one), pass it explicitly and keep its keypair yourself — the deploy script never needs to touch it:
```bash
TREASURY=<your own devnet pubkey> scripts/deploy-devnet.sh
```
`admin.json` (config owner) and `authority.json` (settles matches) are still generated locally in `./keys` and never leave this machine; back them up somewhere safe.

## How a match works

1. Wallet login = signing a server nonce (no passwords).
2. The queue pairs two players. Seat 1 calls `create_match` **naming the opponent** and deposits 0.01 SOL; the program only lets that opponent join, so nobody can front-run and hijack the match. Seat 2 calls `join_match` and deposits. Both stakes sit in a PDA owned by the program. The fee rate (0 bps by default) is locked at join.
3. 3-2-1, then the **server runs the real game at 60Hz**; clients send inputs only and predict locally. The server's result is the one that counts.
4. `settle` pays **winner = the entire pot** (pot minus the configured fee, which is 0 by default — the platform takes nothing). A draw (sudden-death timeout) or server fault calls `void_match`: both refunded in full, no fee either way.
5. Disconnects: 10s to reconnect, then the leaver forfeits (a disconnect before the fight starts refunds both). If the server vanishes, **anyone** can `refund_expired` after 20 minutes; player A can `cancel_match` before the opponent joins. If a deposit lands late after an abort, the server voids it automatically.

The server's signing key can only pick between the two players of a match; the program computes the fee and its destination itself, so a leaked key can't redirect funds (it could still choose winners of in-progress matches: keep it in a secret store and rotate via `update_config`).
Every match's full input log + result is stored in `DATA_DIR` (`replays/<id>.bin`, `results.jsonl`), so any result can be re-derived by replaying inputs through `packages/sim`.

## Tests

```bash
npm test                       # sim (15: determinism, rules, every pairing across all 8 characters) + server (13: mock-chain full flow incl. the zero-fee default, matchmaking, limits, Solana encoding)
cargo test --manifest-path programs/escrow/Cargo.toml   # fee maths (4)
npm run onchain-test           # builds the program, boots a local validator, runs 14 on-chain tests
```
The on-chain suite covers create/join/cancel/settle/void/timeout refund, attacks (stranger settling, fee redirection, non-player winner, front-running the join, double settle, self-play, dust stake), exact lamport conservation, crash recovery, the zero-fee default (preflight doesn't require a funded treasury when no fee is configured), and the **full server flow in `solana` mode** with keypair bots signing server-built transactions. Its binary uses a 6s timeout (`short-timeout` feature) and goes to a temp dir so it can't be deployed by accident.

### Gameplay/UI test (real browser, real DOM — not just logic)

```bash
npx playwright install chromium   # one-time
npm run test:game
```
`scripts/gameplay-test.mjs` builds the client, boots the mock-chain server (with no `FEE_BPS` override — the actual shipped default), and drives **real Chromium pages** through: the character picker without a wallet connected, a full practice match for every character in the roster to a result screen, a full two-browser online mock match through matchmaking → stake → fight → settlement with the winner's screen checked to say "no house fee" and show the full pot, and a phone-width (375px) layout check for horizontal scroll. It fails loudly (non-zero exit, named failing check) on any console/page error or broken flow, and saves screenshots to `scripts/gameplay-test-output/` (gitignored) for a quick look. This is what actually caught the character-picker-behind-a-wallet issue below — the node:test suites never touch a browser, so they couldn't have.

## Verified vs not

Verified: everything above, plus **real browsers → real server → real validator** with a wallet provider that signs and submits real transactions, tested with a 330 bps fee configured (to exercise that still-supported code path): winner net +9,335,000 lamports, loser −10,005,000, treasury +660,000 (= 3.3% of the 0.02 SOL pot; the 5,000 are tx fees). The shipped default is 0 bps — `npm run onchain-test` and `npm run test:game` both also cover that path, where the treasury gets nothing. The deploy script was run end to end against a local validator.

Not verified: a **real Phantom extension** (I used a provider that implements the same API), **devnet itself** (local validator only; RPC behaviour/latency may differ), and load beyond a handful of concurrent matches. The escrow program is **unaudited**: get an independent review before it ever holds real value. See `docs/PLAN.md` for risks (legal is the big one).
