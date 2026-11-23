# SolanaSmash plan and decision log

## Decisions (from the planning Q&A)

| Topic | Decision | Alternatives considered |
|---|---|---|
| Format | 1v1 first; settlement is pairwise now, N-player later | FFA, 2v2 (payout + netcode complexity) |
| Custody | On-chain Anchor escrow, stake held in match PDA | custodial balance (legal/security risk), per-match wallets (server holds keys) |
| Legality | **Devnet/testnet only** until proven fun and legally cleared | geo-block global launch |
| Stack | TypeScript, canvas, pixel art, original characters (no Nintendo IP) | Phaser, Godot, 3D |
| Netcode | Server-authoritative 60Hz + client prediction/reconciliation | P2P rollback + server verification (best feel, much harder), trust-the-clients (cheatable) |
| Stake pricing | **Fixed 0.01 SOL each** (changed from "$1 via Pyth": Pyth's public endpoint returned 401, and a live price adds an outage/manipulation surface for no gameplay benefit). `STAKE_LAMPORTS` is configurable | $1 via oracle, USDC |
| Accounts | Wallet-only login (signed nonce), instant queue | profiles/ELO, lobby, link duels |
| Disconnects | 10s grace then forfeit; countdown-phase disconnect refunds | refund-always (exploitable) |
| Combat | Damage %, knockback scaling by weight, stocks, shield + roll, double jump, drop-through, sudden death | simplified / HP bar |
| Content | 8 original characters on a formal 5-axis stat system (Speed/Power/Weight/Range/Mobility) + archetype templates (Rushdown/Zoner/Trickster/Heavyweight/Duelist/All-rounder) — see `docs/CHARACTERS.md`. 1 stage, 3 stocks, 5 min. Archetypes only: original names, original pixel art, no existing studio's character design, costume or likeness. A request for actual recognisable copyrighted characters was declined — that's a trademark/copyright problem a disclaimer doesn't fix | mirror match, 2-character roster |
| Input | Keyboard + gamepad; input abstraction ready for touch | |
| Escrow flow | A creates+deposits **naming B** (program only lets B join: no front-running), B joins+deposits; A can cancel; timeout refund; server voids late/orphaned matches and recovers after crashes | atomic co-signed deposit, pre-funded vault |
| Result signing | Single server authority key, program-enforced payout destinations; void for draws | multisig, co-signed results |
| Fee | 330 bps in a config PDA, hard cap 10%, snapshotted at join | hard-coded |
| Repo | npm workspaces monorepo (pnpm wasn't needed) | |

## Architecture notes

- **Determinism**: integer fixed-point (256/px), no trig/random/time. `step(state, inputs)` is pure. Tests assert identical hashes across replays and cloned continuation.
- **Prediction**: client tags every input with a frame counter `cf`; server acks the latest `cf` applied per seat inside each snapshot (30Hz). Client rewinds to the snapshot and replays unacked local inputs; opponent uses last known input.
- **Money maths** (`computeSplit`, Rust `fee_for`): `fee = floor(pot*bps/10000)`, rounding favours the winner. At 0.01 SOL each: pot 0.02, fee 0.00066, payout 0.01934.
- **Audit trail**: input log per match + `results.jsonl` with final state hash.

## Risks / open items before any real money

1. **Legal** (biggest): real-money skill gaming is restricted or licensed in many jurisdictions (e.g. many US states, UK, much of the EU). Needs counsel, geo-blocking, age/KYC decisions, ToS. Not legal advice — see `docs/LEGAL.md` for the longer version and the realistic paths. Pushback on "you're being too cautious" doesn't change the underlying regulatory analysis; it's not something either of us can determine from here.
2. **Escrow audit**: unaudited program; needs integration tests (Anchor/bankrun) and external review. Specific areas: lamport accounting on close, duplicate-account passing, rent handling.
3. **Cheating**: authoritative server removes state hacking; remaining threats are input automation (macros/bots), collusion/win-trading between two wallets (costs only the 3.3% fee, but matters if rewards are added), and multi-accounting. Mitigations: input-pattern heuristics, rate limits per wallet, ELO matchmaking, replay review.
4. **Server key**: single hot authority key. Rotate through `update_config`; move to KMS/multisig before mainnet. Cap matches/stakes at start.
5. **Latency/fairness**: server in one region favours nearby players. Add regional servers, ping caps in matchmaking, input-delay equalisation.
6. **Availability**: if the server is down mid-match, funds return only after 20 minutes via `refund_expired`. Consider shorter timeouts + a keeper bot.
7. **Single-process server**: sessions are in memory; a restart voids in-flight matches (they refund via timeout). Persist session state before scale-out.
8. **Dollar value drifts**: the stake is fixed in SOL, so its USD value moves with the market. Fine for a prototype; revisit (USDC or an oracle) before launch.
9. **IP**: all four fighters are original designs, not existing studios' characters. Keep it that way — "royalty-free but recognisable" is a contradiction for anything actually recognisable; if it's instantly identifiable it's owned, licence or no licence.
10. **Fee transparency**: the treasury address is a public on-chain account, emitted in every `MatchSettled` event and readable by anyone. Don't try to obscure it — an unverifiable fee destination is worse for trust, not better, and doesn't change the legal analysis in item 1.

## Roadmap

1. (done) Deterministic sim, mock-chain full flow, playable client, escrow program, real-validator test suite, deploy script, Docker.
2. Deploy to devnet with `scripts/deploy-devnet.sh`, playtest with real Phantom.
3. Fun pass: balance, hitstop, ledge grab, more moves, more stages, sprite animation frames. Roster is now 8 original characters on the formal stat/archetype system (`docs/CHARACTERS.md`); more can follow the same archetype-not-IP approach.
4. Matchmaking: ELO, rematch, private challenge links, spectate.
5. Hardening: anti-automation, replay verifier service, monitoring, regional servers, persistence.
6. Legal review → decide on mainnet, USDC option, multisig, audit.
7. FFA: N-player settlement (the program's winner-pays model extends to placement splits).

## Audit log (what review found and fixed)

- Empty treasury can't receive the first fee payout (rent-exempt minimum): startup preflight + funded by the deploy script.
- Anyone could join an open match before the intended opponent (griefing): opponent is now pinned at creation.
- A wallet-prompt was replaced by a status line on the client (invisible to real-wallet users, hidden by the mock): ordering fixed server-side and guarded client-side.
- One wallet queued from two tabs could be double-booked; dead sockets could be matched: matchmaker now skips both.
- Late deposits after an abort / crash mid-match could orphan funds until the 20-minute timeout: reaper + startup recovery void them.
- Per-IP connection cap, payload cap, origin allow-list, per-socket message rate limit.
- Client leaked a ping timer on every reconnect: fixed.
- Matchmaking, practice mode and the bot assumed exactly 2 characters by index (`1 - char`); generalised for the 4-character roster.
- Devnet deploy: this sandbox's shared IP had already exhausted the public devnet faucet's rate limit when I tried to deploy live, so the deploy itself is still pending real devnet SOL (see the session's final message for the exact unblock). Verified instead against a local validator with the same deploy script, same program, same config flow — only the source of SOL differs.
- **UX review** (driven with Playwright against a real browser, not just read from the code): the character picker and "Practice vs bot" required connecting a wallet first, even though practice mode needs no wallet or stake — directly in the way of testing gameplay solo before a friend joins. Reworked the lobby: the picker and practice button are now always usable; wallet connection is only needed for the "stake & find match" flow, under a "play for stakes" divider. Selection persists across connecting a wallet and across playing a match. Also widened the body background (a dark radial gradient instead of flat black) so tall/portrait viewports (tablets) don't show large empty bars above and below the fixed 16:9 canvas.
- Added `scripts/gameplay-test.mjs` (`npm run test:game`): a repeatable, real-browser regression check — this is what caught the wallet-gated-picker issue above, since the existing `node:test` suites never render the DOM. Covers the cold lobby, a practice match for every character, a full two-browser mock online match with the displayed house fee checked against the exact 3.3%, and a phone-width layout check, all asserted against console/page errors.
- **Roster expanded to 8** on a new formal 5-axis stat system + archetype templates (`docs/CHARACTERS.md`): Ronin (Duelist), Buccaneer (Trickster), Boulderkin (Heavyweight), Mainspring (All-rounder), alongside the original 4. Matchmaking, the practice bot and the character picker were generalised off hard-coded counts.
- **Real engine bug found while testing the new roster, not a test artifact**: pressing Attack+Up on the same input frame (entirely normal for a real player) both started the up-attack *and* triggered a jump, since Up is dual-purpose (jump, or "aim this attack upward") and the jump-check ran unconditionally before the attack-direction check. Every up-attack in the game was silently mis-executed whenever Up and Attack landed on the same frame. Fixed: Up only triggers a jump when Attack isn't also freshly pressed that frame; the dedicated Jump button is unaffected. Locked in with a dedicated regression test, independent of the roster-pairing test that surfaced it.
- Buccaneer's "Grapple Hook" is a stated simplification (reversed knockback direction, not a true grab/drag state machine) — see `docs/CHARACTERS.md` for why, so nobody assumes a real command-grab already exists to build on.
