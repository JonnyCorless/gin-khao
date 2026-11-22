# SolanaSmash

Browser platform fighter where two players each stake **$1 of SOL**, fight a 1v1, and the winner takes the pot minus a **3.3% house cut**. **Devnet prototype**: no real money until the checklist in `docs/PLAN.md` is done.

```
packages/sim        deterministic fighting core (shared by client + server) + wire protocol + fee maths
apps/server         Node + ws: matchmaking, 60Hz authoritative sim, settlement, audit log
apps/client         Vite + canvas: pixel-art game, wallet connect, client-side prediction, practice bot
programs/escrow     Anchor program: holds both stakes, pays winner, takes the fee, refunds if stuck
```

## Run it locally (no wallet, no chain needed)

```bash
npm install
npm run dev:server        # mock chain on :8787 (stakes are simulated)
npm run dev:client        # http://localhost:5173
```
Open the client in two browser windows, click **Use dev wallet** in each, **Stake & find match**. Or click **Practice vs bot** for a free solo match.

Controls: move `A/D`, jump `W/Space` (x2), fast fall/drop through `S`, attack `J` (+direction), special `K`, shield `L/Shift` (+left/right to roll). Gamepads work. `F3` shows hitboxes.

```bash
npm test                  # sim determinism/rules, full match flow on the mock chain, Solana encoding
cargo test --manifest-path programs/escrow/Cargo.toml   # fee maths in the program
```

## How a match works

1. Wallet logs in by signing a server nonce (no passwords).
2. Queue pairs two players. The server quotes the stake: **$1 in lamports at the current Pyth SOL/USD price**, locked for the match.
3. Player A calls `create_match` (deposits), player B calls `join_match` (deposits). Funds sit in a PDA owned by the escrow program. The fee rate (330 bps) is snapshotted at join.
4. 3-2-1, then the server runs the real game at 60Hz. Clients send inputs only and predict locally; the server's result is the one that counts.
5. Winner is sent on chain via `settle`: **winner gets pot - 3.3%, treasury gets 3.3%**. Draw (sudden-death timeout) or server fault: `void_match` refunds both in full.
6. Disconnects: 10s to reconnect, otherwise the leaver forfeits. If the server never settles, **anyone** can `refund_expired` after 20 minutes. Player A can `cancel_match` before anyone joins. Funds can't get stuck.

The settlement key can only pick between the two players of a match and the program computes the fee and destination itself, so a leaked key can't redirect funds elsewhere (it could still choose winners of in-progress matches, so keep it in a secrets manager and rotate via `update_config`).

Every match's full input log + result is written to `DATA_DIR` (`replays/<id>.bin`, `results.jsonl`) so any result can be re-derived by replaying inputs through `packages/sim`.

## Devnet deployment (you run this; the sandbox I built it in couldn't reach Solana)

Prereqs: Solana CLI + Anchor 0.31 (`avm install 0.31.1`), a devnet wallet with some test SOL.

```bash
cd programs/escrow
anchor build
anchor keys sync          # writes a real program id into declare_id! and Anchor.toml
anchor build && anchor deploy --provider.cluster devnet

solana-keygen new -o keys/authority.json   # server's settlement key; fund with ~0.1 devnet SOL (it pays settle fees)
solana-keygen new -o keys/admin.json       # can change fee/authority/treasury
# pick a treasury address for the fee, then, from repo root:
ADMIN_KEYPAIR=keys/admin.json AUTHORITY=$(solana-keygen pubkey keys/authority.json) TREASURY=<fee wallet> \
PROGRAM_ID=<id> npx tsx apps/server/scripts/init-config.ts

CHAIN_MODE=solana PROGRAM_ID=<id> TREASURY=<fee wallet> AUTHORITY_SECRET="$(cat keys/authority.json)" npm run dev:server
VITE_WS_URL=ws://localhost:8787 npm run dev:client     # set Phantom to Devnet
```

Price feed: the server quotes $1 via Pyth Hermes (`HERMES_URL`, optional `HERMES_HEADERS` JSON for auth). From the build sandbox the public endpoint returned HTTP 401, so **verify the feed works from your server** or set `FALLBACK_SOL_USD` (in `solana` mode with neither, matchmaking refuses to quote rather than guess).

Server env: `PORT, CHAIN_MODE (mock|solana), RPC_URL, PROGRAM_ID, AUTHORITY_SECRET, TREASURY, FEE_BPS (330), STAKE_USD (1), FALLBACK_SOL_USD, ALLOWED_ORIGINS, DATA_DIR, GRACE_MS`.

## On-chain test (real validator)

```bash
apps/server/scripts/onchain-test.sh   # needs the Solana CLI; builds the program, boots solana-test-validator, runs 11 tests
```
It covers create/join/cancel/settle/void/timeout-refund, attack cases (stranger settling, fee redirection, non-player winner, double settle, self-play, dust stakes), exact lamport conservation, and the **full server flow in `solana` mode** with two keypair bots signing the server-built transactions. The test binary uses a 6s timeout (`short-timeout` feature) and is written to a temp dir so it can't be deployed by accident.

## Honest status

Verified here: deterministic sim (10 tests), full match flow on the mock chain (5 e2e), instruction/account encoding, escrow Rust tests (4), **the SBF program on a real local validator (11 on-chain tests incl. attacks, refunds and a full server+wallet-bot match with exact balances)**, and the client in a real browser.

**Found by the on-chain run**: an empty treasury can't receive the first fee payout (rent-exemption), so the server now runs a startup preflight (program deployed, config matches, treasury/authority funded) and refuses to start otherwise.

**Not verified**: devnet itself (I tested on a local validator; deploy steps above), Phantom signing in a real wallet, and a live price feed (see above). Treat the escrow program as unaudited. Get an independent review before it ever holds real value.
