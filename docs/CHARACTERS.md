# Character system

This is the actual, authoritative design system for SolanaSmash fighters — not vibes. Every
character is built the same way: pick an **archetype template**, rate it on **5 axes**, then hand-author
move data within that envelope. New characters should start here, not from a blank `Character` object.

## The 5 stat axes

Shown to players on the character-select screen as 1–5 bars.

| Axis | Drives |
|---|---|
| **Speed** | run/air speed, how fast attacks start up |
| **Power** | damage and knockback dealt |
| **Weight** | how hard *they* are to launch (higher = survives longer) |
| **Range** | hitbox/hurtbox reach on normals, including projectile uptime |
| **Mobility** | jump height, air control, special-move repositioning (dashes/teleports) |

**Important**: the `rating` field on each `Character` (in `packages/sim/src/index.ts`) is *descriptive*,
not a formula the engine reads. It's a label for players and a consistency guide for designers — the
actual `runSpeed`, `weight`, move `dmg`/`base`/`growth`/`startup` etc. are still hand-tuned and
playtested per character. Think of the rating as "what a reviewer would score this character," written
down so future characters land in a sane, comparable place.

## Archetype templates

| Archetype | Design intent | Current roster |
|---|---|---|
| **Rushdown** | High speed/mobility, low weight/power. Wins by pressure, dies easily if caught. | Pounce, Quillborne |
| **Zoner** | Low speed/mobility, high range/power, usually has a projectile. Wins by spacing. | Bork |
| **Trickster** | Mid stats, mobility-focused signature special (dash, pull, teleport) for positional tricks rather than raw speed or power. | Nightshade, Buccaneer |
| **Heavyweight** | Very low speed/mobility, very high power/weight. Every move is slow and punishable but devastating. | Boulderkin |
| **Duelist** (All-rounder, power lean) | Balanced-to-strong across the board, committed high-risk/high-reward signature move. | Ronin |
| **All-rounder** | Genuinely balanced — the "pick this one first" option. Often has a reliable, low-commitment special. | Mainspring |

## Rough derivation guide (for hand-authoring a new character, not an auto-generator)

Starting points, roughly scaled to the existing roster (`runSpeed` 2.6–5.0, `weight` 85–150):

- **Speed rating 1→5**: `runSpeed` 2.6 → 5.0, `airSpeed` ≈ 0.85×`runSpeed`, `accel` 0.3 → 0.65
- **Mobility 1→5**: `jumpV` 10.5 → 13.5, `gravity` 0.85 → 0.52 (lower = floatier), `fallMax` 13.5 → 9.5
- **Weight 1→5**: the `weight` field, 85 → 150 (higher = harder to launch; see `fee_for`-style knockback math: `kb = base*100/weight`)
- **Power 1→5**: scale each move's `dmg`/`base`/`growth` up together; pair high power with slower `startup`/longer `recovery` — nothing in this roster is both the fastest *and* the hardest-hitting
- **Range 1→5**: hitbox `w`/`h` and `x` offset, or projectile `speed`/`life`/`cooldown` for zoners

Every character still needs: `neutral` (fast, low-reward poke), `forward` (the main damage/kill move),
`up` (anti-air, mostly vertical knockback, `diry` ≈ -97 to -99), `down` (low horizontal poke, `diry` ≈
-66 to -71), and a `special` that's the character's actual identity — a lunge, a projectile, or (per
Buccaneer) a knockback-direction trick. Keep the risk/reward honest: a character with no bad matchup and
no weakness isn't finished yet.

### A known simplification, stated plainly

Buccaneer's "Grapple Hook" special approximates a pull by giving the hit **negative** `dirx` (knockback
toward the attacker instead of away). It is not a true grab/drag mechanic — a real command-grab (hold the
victim, walk them, throw them on release) needs its own state-machine support in `packages/sim`, which is
a separate, larger piece of engine work than reusing the existing hit-knockback pipeline. Don't build a
second one assuming this is already a real grab.

## Current roster

| Name | Archetype | SPD | PWR | WGT | RNG | MOB | Signature special |
|---|---|---|---|---|---|---|---|
| Pounce | Rushdown | 5 | 2 | 2 | 2 | 4 | Dash claw lunge |
| Bork | Zoner | 2 | 4 | 4 | 4 | 2 | Thrown bone projectile |
| Quillborne | Rushdown | 5 | 2 | 1 | 4 | 5 | Long cane-poke lunge |
| Nightshade | Trickster | 3 | 4 | 3 | 3 | 5 | Longest dash in the roster |
| Ronin | Duelist | 4 | 4 | 3 | 4 | 3 | Quick-draw dash-slash — fast startup, huge recovery if it whiffs |
| Buccaneer | Trickster | 3 | 2 | 3 | 3 | 4 | Grapple hook (pulls, doesn't launch — see simplification above) |
| Boulderkin | Heavyweight | 1 | 5 | 5 | 3 | 1 | Seismic Slam — hardest hit and most punishable move in the cast |
| Mainspring | All-rounder | 4 | 3 | 3 | 3 | 4 | Flywheel gear — shortest-cooldown projectile, no big payoff/risk either way |

## IP note

Every fighter here is an **original character riffing on a public-domain archetype** (a folklore
vampire, a Victorian detective, a samurai, a pirate, a stone golem, a clockwork automaton) — original
names, original stats, original 16×16 pixel art, not any existing studio's specific design, costume, or
likeness. That distinction matters: the *archetype* (vampire, detective, samurai...) is centuries-old and
unowned; a *specific company's particular character* built from that archetype is not, regardless of how
generic it looks. Adding a new character means designing a new original take on an archetype, never
reusing an existing franchise's actual character.
