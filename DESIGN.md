# Mobile RTS — Master Design Contract

## TL;DR
- Post-apocalyptic mobile RTS inspired by Supreme Commander and Total Annihilation.
- Data-driven engine: every rule is a Schematic file the engine reads at runtime.
- Six pillars: terrain, info war, dig-in rhythm, modular units (via companion app), async offline PvE, tech-driven AI battles with human commanders.
- Four factions; player-default is the Reclaimer; the other three are AI skirmish archetypes.
- Persistent commander profile (Clash-style). Per-map fixed seasons. Mixed AI/human housing model.
- Prototype scope: 4–8 weeks evening dev to validate the core loop is fun.

## Scope
This is the master contract. Every other doc is downstream. If two docs disagree, this one wins. If a system isn't named here, it doesn't exist yet.

## Prerequisites
- `docs/glossary.md` — canonical terms
- `docs/world.md` — the fiction frame
- `docs/factions.md` — the four factions

---

## The pillars

### 1. Terrain matters
- Heightmap is a real actor: ridges, valleys, chokepoints, dead ground.
- Real ballistic physics — projectiles arc; mountains block direct fire; artillery clears them.
- Per-unit vision + radar contribution = fog of war that *cares about position*.
- A ridge with a Signal scout on it is worth more than the ridge with no scout.

### 2. Information warfare as a resource sink
- Radar, jammers, cloak, counter-cloak — all cost ongoing Power.
- Shields deplete; they don't refund unspent capacity. Trade economy for survivability *continuously*.
- Knowing more than the enemy is the actual advantage. Firepower is the conversion.

### 3. Dig-in & defend rhythm
- The fun is finding favorable ground, building economy, fortifying, then projecting.
- Tower-defense pacing inside an RTS shell.
- Stances (Hold / Patrol / Attack-Move / Fire-at-Will / Guard) let a thumb run an army.

### 4. Modular unit editor — separate companion app
- Voxel/block-based unit construction. Specific block model: see open question (`docs/units.md`).
- Desktop or tablet app, not the phone. Deep creative tool with no UI compromises.
- Outputs Schematic files the game loads. Cloud-synced. Optional marketplace.
- This is *the* differentiation hook: viral creativity, community content, longevity.

### 5. Asynchronous offline PvE
- The Commander's base persists in the world.
- Online: expand, scout, raid.
- Offline: the Natural Enemy probes your perimeter. Your defenses, stances, and patrols earn their keep without you.
- Nobody has built this for a real RTS at SupCom's depth. We are.

### 6. Tech-driven AI battles, human commanders
- Most units are autonomous (drones, turrets, auto-tanks) — they need no housing.
- A small elite roster is human-crewed (commandos, pilots, engineers) — requires Barracks.
- The player is a Commander: persistent profile, off-map strategist, not a unit. Cannot die in a match.
- "Most battles are AI-driven; humans command" — the player issues strategic intent, the army executes.

---

## Setting
Post-apocalyptic future. The Fall ended the prior civilization. Survivors rebuild from the Ruins. Detailed in `docs/world.md`.

## Factions
Four, each a thesis about surviving the Fall.

| Faction | Motto | Role | Detail |
|---|---|---|---|
| Reclaimer | *Ex Ruinis Novum* | Player default; balanced | `docs/factions.md` |
| Bulwark | *Stat Murus* | Defense AI | `docs/factions.md` |
| Signal | *Videmus Primi* | Info-war AI | `docs/factions.md` |
| Cinder Crown | *Ignis Renatus* | Aggression AI | `docs/factions.md` |

---

## Architecture: Schematics

Every rule is content.

- **Schematics** are JSON files validated by published JSON Schemas.
- The engine is a rules interpreter. Adding a unit, weapon, AI, event, physics environment, or tech is a JSON file change — not engine code.
- The companion editor app and the in-game engine both speak Schematic. The format *is* the contract.
- Modding = trading Schematic files. The format design today determines whether the game has a 10-year community.

Full spec: `docs/schematics.md`.

---

## Locked design decisions

### Commander model: persistent profile (Clash-style)
The player's commander is an account-avatar. Persists between matches. Off-map. Issues strategic orders. Cannot be killed. The per-match win condition is *not* commander-death.

**Why:** enables the offline-PvE pillar (base persists), removes the SupCom ACU legal-distance concern, fits "humans command, AI fights."

### Seasons: per-map fixed
Each map's environment Schematic locks its season. "Cradle, Winter" and "Cradle, Summer" are different maps with different environment files. Variety comes from more maps, not in-match cycling.

**Why:** keeps the engine simple, keeps balance tractable, ships more variety faster. Mid-match seasonal cycles can be added later as a special "endurance" map type if demand justifies it.

### Housing: mixed AI/human model
- **AI units** (drones, turrets, auto-tanks) — no housing required.
- **Human-Crewed Elites** (commandos, pilots, engineers) — require Barracks.

**Why:** reinforces the "tech-driven AI battles, human commanders" pillar. Creates a strategic tension between AI mass and human elite. Prevents the "humans without homes" absurdity without making housing a tax on every unit.

### Resource model: accept complexity for depth
Up to 10 resources on a map (4 universal + 2 strategic + up to 4 environment-locked). No trimming for mobile UI. The HUD is designed to handle the depth, not the other way around. Mobile players are smarter than mobile UI defaults assume; the design respects that.

Detail: `docs/economy.md`.

### Power model: streaming only
Pure SupCom-flavor. Power has a rate (income/sec − drain/sec), not a stockpile. The HUD shows rate. Players learn to read the rate; there is no buffer for spikes. This is the demanding option — and it is the signature.

Detail: `docs/economy.md`.

### Tech retrieval: split between PvE and PvP

- **PvE: discovered.** Tech is found in the Ruins. Scouts and engineers physically retrieve Tech Fragments and carry them back to a lab. If the carrier dies, the carry is lost. Risk creates story.
- **PvP: learned.** Engaging enemy units exposes you to their tech. Destroying or capturing units running unfamiliar tech grants you (partial) access to its Schematic. Rewards aggression and gives a catch-up vector for the behind player.

The split means PvE rewards *exploration*; PvP rewards *engagement*. You cannot turtle to full tech in PvP — you have to fight to learn. You cannot rush to full tech in PvE — you have to risk to discover.

Detail: `docs/tech.md`.

### Per-match win conditions
OPEN[2026-05-27]: Choose between (a) territory hold (control N capture points for T seconds), (b) core-structure destruction (destroy the enemy's primary refinery or HQ), or (c) hybrid (a different objective per map, drawn from a catalog).

Lean **hybrid** — variety across maps, replayability, naturally encourages different builds.

Must be resolved before `docs/prototype-scope.md`. blocks: docs/prototype-scope.md

### Meta progression
The Commander persists; therefore so does:

- Commander rank
- Faction reputation
- Salvaged Tech Library
- Stockpiled Schematic designs (from the Editor App)

What does NOT persist:

- Per-match resources
- Per-match units (except Human-Crewed Elites returning to Barracks)
- Per-match terrain alterations (except on persistent-base maps)

Detail: `docs/humans.md`, `docs/offline-pve.md`.

---

## Prototype scope (summary)

Detail: `docs/prototype-scope.md`.

4–8 weeks of evening development, single-player only, one map, three units, two structures. Validates the core loop:

- Find ridge, plant artillery behind it.
- Scout with fast unit to spot for it.
- Watch shields buckle as you push.
- Decide if it's *fun*.

If yes, we invest in the Editor App, full AI opponents, and the offline-PvE system.
If no, we know early.

---

## The Long View — campaign arc

The persistent Commander implies a career. The career has phases. Each phase opens content (environments, units, threats) without rewriting the engine.

1. **The Salvage Era — Earth.** Phase 1. Where the prototype lives.
2. **Lunar Colonization — The Ashen Eye.** Phase 2. First permanent off-world expansion.
3. **The Reach — Warp Gates.** Phase 3. Restoring/building gates to other systems.
4. **The Constellation — Player Worlds.** Phase 4, speculative. Co-op player-tended planets in shared systems.

The architecture must not foreclose any phase. Schematic-driven content, environment-as-data, and the modular unit editor are all built so that a Moon expansion is *content*, not engine work.

**Enclave karma (the PvE flavor of "social dynamics").** Outside the four major factions, the world is full of smaller enclaves. They respond to player behavior: share resources and they ally; hoard or threaten and they go hostile. The karma is the meta-loop that ties resource decisions to PvE storyline.

Detail: `docs/campaign.md`.

---

## Open questions index

Pulled from across all docs for visibility. Each is OWNED by its detail doc.

- OPEN: per-match win condition — **`DESIGN.md`** (this doc — resolve before prototype)
- OPEN: editor app block model (pure voxel vs hardpoint-snapped) — `docs/units.md`, `docs/ui-ux.md`
- OPEN: meteor frequency and predictability — `docs/events.md`
- OPEN: experimental units per faction — `docs/units.md`
- OPEN: faction-locked tech vs universal — `docs/tech.md`
- OPEN: Natural Enemy presentation (fifth faction?) — `docs/events.md`, `docs/offline-pve.md`
- OPEN: enclave karma model — `docs/campaign.md`
- OPEN: Phase 4 (Constellation) co-op planet-tending — `docs/campaign.md`

---

## Doc navigation

### Tier 1 — identity & contract
- [README.md](README.md) — project landing
- [CLAUDE.md](CLAUDE.md) — agent auto-load brief
- [DESIGN.md](DESIGN.md) — this doc
- [docs/glossary.md](docs/glossary.md) — terminology
- [docs/world.md](docs/world.md) — fiction frame
- [docs/factions.md](docs/factions.md) — the four factions

### Tier 2 — load-bearing systems
- [docs/schematics.md](docs/schematics.md) — data architecture
- [docs/physics.md](docs/physics.md) — environments and variables
- [docs/economy.md](docs/economy.md) — resources

### Tier 3 — content systems
- [docs/tech.md](docs/tech.md)
- [docs/units.md](docs/units.md)
- [docs/ai-behaviors.md](docs/ai-behaviors.md)
- [docs/events.md](docs/events.md)
- [docs/humans.md](docs/humans.md)
- [docs/campaign.md](docs/campaign.md) — campaign arc, enclave karma

### Tier 4 — experience
- [docs/ui-ux.md](docs/ui-ux.md)
- [docs/offline-pve.md](docs/offline-pve.md)
- [docs/multiplayer.md](docs/multiplayer.md) — stub
- [docs/prototype-scope.md](docs/prototype-scope.md)

## Cross-references
All other docs trace back here.
