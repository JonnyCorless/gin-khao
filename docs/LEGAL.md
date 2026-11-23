# Running SolanaSmash for real money: what it would actually take

Not legal advice. I'm not a lawyer and this isn't a substitute for one. This is an honest summary of why "two players stake real value, one wins the pot" is a regulated activity in most places, and what the realistic paths are if you want to run it for real stakes rather than devnet test SOL.

## Why this is a legal question at all

A game where (a) a player pays something of value to enter, (b) the outcome determines who gets a payout, and (c) the operator takes a cut, matches the common three-part test regulators use for **gambling**: consideration, chance/skill-based prize, and reward. Being skill-based (like chess or poker for stakes) does not automatically exempt it — several major jurisdictions regulate or restrict skill-stake games specifically because the "it's skill, not luck" argument is the first thing every unlicensed operator has tried:

- **UK**: the Gambling Commission's remote gambling regime applies to betting and gaming regardless of the skill/chance mix in many categories; operating without a licence (or targeting UK consumers without one) is a criminal offence under the Gambling Act 2005.
- **US**: this is state-by-state, not federal-only. A handful of states explicitly carve out "games of skill" for cash prizes; many others do not, and several (e.g. Washington, Montana on certain forms) take a notably strict view. Federal law (UIGEA, the Wire Act) mainly targets payment processing for unlawful internet gambling, which turns on the underlying state-law question.
- **EU/elsewhere**: typically licence-per-country, not one EU-wide pass.
- **Crypto doesn't change the analysis.** Regulators treat "stake crypto, winner takes the pot, house takes a cut" the same as cash wagering; several enforcement actions have specifically targeted crypto skill-games and esports-wagering apps on this basis.

None of this means it's definitely illegal everywhere, or that nobody successfully runs games like this — it means the answer depends on exactly where your players are, how the game is structured, and whether you hold the applicable licence, and getting that answer requires a lawyer who covers gambling/gaming law in your target jurisdictions, not a guess from either of us.

## What changes the analysis (ask a lawyer about these specifically)

- **Peer-to-peer vs. house-banked**: this design is peer-to-peer (players' stakes form the pot; the house only takes a service fee, never risks its own capital against a player). Some jurisdictions treat that more like an entry-fee tournament than banked gambling — this is one of the stronger arguments in your favour, and also one a lawyer needs to confirm actually holds in your target markets.
- **Stake size and framing**: "$1 tournament entry fee, winner-take-most prize pool" reads differently to some regulators than "wager." The 3.3% "house cut" framing is closer to a rake, which is itself a regulated thing in several places (e.g. US poker rake rules).
- **Jurisdiction of players, not just of you**: geo-blocking isn't a formality — it's usually the actual compliance mechanism (IP geolocation, sometimes device/SIM checks), and getting it wrong is what turns a grey area into enforcement exposure.
- **KYC/AML**: real-money wagering platforms are frequently subject to anti-money-laundering obligations (identity verification, transaction monitoring, suspicious-activity reporting) independent of the gambling licence itself.
- **Age verification**: essentially universal requirement for real-money wagering.
- **Consumer funds**: several licensing regimes require player funds to be held separately from operating funds (safeguarding), which the on-chain escrow design arguably satisfies better than a custodial balance would — still a question for counsel, not an assumption.

## Realistic paths, roughly in order of effort

1. **Devnet / testnet indefinitely** (what's built and working now): zero legal exposure, full gameplay and escrow mechanics, stakes are worthless test tokens. This is the only path that needs no lawyer.
2. **Skill-game license review for a specific, narrow launch**: pick one jurisdiction where you and all players are physically located, hire counsel there, and ask the specific question ("does a peer-to-peer stake-matching platform like this need a licence here, and if so which one"). Could be anywhere from "you're fine as structured" to "you need a licence" to "don't."
3. **Full gambling/gaming licence** (Malta, Isle of Man, Curaçao, a US tribal or state licence, etc.): this is the path actual real-money skill-game and esports-wagering platforms take. Materially more expensive and slower than anything in this repo — months, real legal fees, ongoing compliance obligations (reporting, audits, responsible-gambling tooling).
4. **Convert it to something that isn't wagering**: e.g. sponsored prize pools with no entry fee, or play-money/leaderboard with separate unrelated prizes, or an explicitly licensed esports tournament structure. Changes the product, but removes the core legal question rather than trying to engineer around it.

## What I won't help with, and why

I won't help obscure who collects the house fee, and I won't add real, recognisable copyrighted characters. Both of those read as building for deniability or infringement rather than for a legitimate product, and neither makes the underlying legal question go away — they just make it worse if anyone ever looks. A platform designed to be inspected and licensed is in a materially different (and better) position than one designed to be hard to trace.

## What's actually ready right now

Full gameplay, escrow, settlement, and payout logic — tested end to end against a real Solana validator — running on **devnet with test SOL**. That's the whole product, just with stakes that have no real-world value. It's the right way to playtest with a friend tonight without any of the above being a live question yet.
