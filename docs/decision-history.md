# Mobile RTS Game — Design Documentation Plan

## Context

This is a brand-new project on branch `claude/mobile-rts-game-concept-7LbT0`. The user is designing a post-apocalyptic mobile RTS inspired by Supreme Commander and Total Annihilation, built around a data-driven engine (TA's FBI/COB lineage) where every rule is content. Target: Unity, prototype first, single-player skirmish; eventual multiplayer; companion editor app on desktop/tablet.

The user has explicitly directed: **design every aspect before any engine code.** The deliverable for this phase is a complete documentation suite that captures every system design decision and serves as the brief for the multi-agent development that follows. Once the docs are locked, an agent army (with me as gatekeeper) can write Schematic content and prototype code in parallel without drifting from the design.

This plan defines which docs to write, in what order, with what content. It does NOT write the docs themselves — that's the next phase, post plan-approval.

---

## Locked decisions (the contract)

These have been resolved over conversation and via Phase 3 questions. All subsequent docs must respect them.

### Game pillars
1. **Terrain matters** — heightmap, real ballistic physics, LOS blocked by mountains/valleys, fog of war + per-unit vision.
2. **Information warfare as a resource sink** — radar, jammers, cloak, counter-cloak, shields with depleting energy pools.
3. **Dig-in & defend rhythm** — favorable terrain, tower-defense pacing inside an RTS shell, unit stances (hold/patrol/attack-move/fire-at-will).
4. **Modular unit editor** — separate companion app (desktop/tablet) with voxel-block construction. Outputs Schematic files the game loads.
5. **Asynchronous offline PvE** — player's base persists in the world. When online: expand and raid. When offline: a "natural enemy" (storms, scavenger swarms, mutated wildlife) pressures the base; defenses, stances, and patrols earn their keep.
6. **Tech-driven AI battles, human commanders** — most units are autonomous; humans are strategic commanders, not direct combatants.

### Setting
Post-apocalyptic future. Justifies any tech (laser cannons, mechs, exotic matter) as "recovered from the world that fell." Art direction: rust, scrap, reclaimed tech, hand-painted hazard stripes.

### Factions (badges already in `concept/identity/`)
- **Reclaimer** — player default. Economy/expansion. Rebuilders.
- **Bulwark** — defense AI archetype. Fortify, ride out the storm.
- **Signal** — info-war AI archetype. See first, hit last.
- **Cinder Crown** — aggression AI archetype. Raid and burn.

### Architecture
**Schematics** = JSON files with published JSON Schemas. Every unit, part, structure, weapon, AI behavior, physics rule, environment, event, and tech is a Schematic loaded at runtime. Engine is a rules interpreter. Editor app outputs Schematics. Modding = trading Schematic files.

### Resolved open questions (Phase 3)
- **Commander model:** Persistent profile (Clash-style). Player's account-avatar persists between matches. Off-map strategist. No ACU-death loss condition (legal distance from SupCom ✓). Per-match win conditions are territory/objective/structure-based.
- **Seasons:** Per-map fixed. Each map's environment Schematic locks its season. Variety via more maps, not in-match cycling.
- **Housing:** Mixed. Autonomous AI units (drones, turrets, auto-tanks) need no housing. Human-crewed elites (commandos, pilots, engineers) require barracks. Reinforces the AI-mass vs human-elite strategic tension.

### Systems still to be designed in the docs
- Physics environment catalog and variables
- Resource hierarchy and extraction logic
- Three-layer tech progression (baseline / salvaged / researched)
- Unit composition model (chassis + hardpoints, part categories)
- AI behaviors (stances, faction archetypes)
- World events (meteors with exotic material, tornadoes, hurricanes/typhoons)
- Offline PvE pressure scaling
- Mobile + editor app UX
- Multiplayer constraints (stub, deferred but anchored)
- Prototype scope (4–8 weeks)

---

## Documentation structure

15 files total. Root holds the contract; `docs/` holds the details.

```
/
├── README.md                    # expand existing minimal stub
├── CLAUDE.md                    # auto-loaded agent brief
├── DESIGN.md                    # master contract
├── concept/identity/            # exists — badges and flag
└── docs/
    ├── glossary.md              # canonical terms
    ├── world.md                 # setting/fiction frame
    ├── factions.md              # four factions in detail
    ├── schematics.md            # data format spec (load-bearing)
    ├── physics.md               # environments and variables
    ├── economy.md               # resources and extraction
    ├── tech.md                  # three-layer progression
    ├── units.md                 # modular composition, parts
    ├── ai-behaviors.md          # stances, archetypes, trees
    ├── events.md                # meteors, weather, director
    ├── humans.md                # housing, commander, population
    ├── ui-ux.md                 # mobile + editor app UX
    ├── offline-pve.md           # natural enemy, persistence
    ├── multiplayer.md           # stub, constraints only
    └── prototype-scope.md       # cross-cut, written last
```

---

## Writing order (dependency-correct)

### Tier 1 — Identity & contract
Lock vocabulary and fiction frame before any system design.

1. `docs/glossary.md` — every proper noun used in conversation, with one-line glosses. Skeleton first; grows as other docs are written.
2. `docs/world.md` — the post-apocalyptic premise. Why factions exist, what the ruins are, where salvaged tech comes from, the natural-enemy lore frame.
3. `docs/factions.md` — the four factions' identities, mottos, aesthetics, gameplay archetype hints (mechanics live in `ai-behaviors.md`).
4. `DESIGN.md` — master contract. Pillars, locked decisions, prototype scope summary, navigation index. Written after world/factions exist to reference them.
5. `CLAUDE.md` — agent auto-loaded brief. Curated digest of DESIGN.md tuned for narrow agents. Written last in Tier 1 to avoid rewrite churn.

### Tier 2 — Load-bearing systems
Everything downstream references these.

6. `docs/schematics.md` — **the single most load-bearing technical doc.** Format choice (JSON), schema philosophy, composition rules, ID/reference syntax, inheritance, hot-reload semantics, validation, modding seam. Must lock before any doc that contains example Schematics.
7. `docs/physics.md` — environment-as-Schematic. Variable list (gravity, atmosphere, traction, thermal, radiation, day/night, magnetic field). Environment catalog (Earth/Moon/Mars/asteroid/ice-moon/rotating-habitat). Unit compatibility tag system.
8. `docs/economy.md` — three-tier resource taxonomy (Power+Scrap → Alloy+Fuel → Tech Fragments+Exotic Matter), environment-locked resources, finite deposits, power-scaled extraction, environment-modified output.

### Tier 3 — Content systems
Parallelizable once Tier 2 is locked.

9. `docs/tech.md` — three-layer progression (baseline / salvaged / researched). Tech categories including the data-only "software tech" category. Lab structures, research time, salvage retrieval (physical, with risk).
10. `docs/units.md` — modular composition model. Chassis classes, hardpoint layout, part categories (weapons, utility, mobility, defense). Cross-references parts to tech gates and resource costs.
11. `docs/ai-behaviors.md` — stances, behavior-tree-as-Schematic, faction archetypes (Bulwark weights, Signal weights, Cinder weights, Reclaimer weights), patrol/guard/ambush logic.
12. `docs/events.md` — event director, meteor showers (exotic material drops), tornadoes, hurricanes/typhoons, seasonal hazards. Events are time-varying perturbations on physics variables; physics doc owns steady state, this doc owns perturbations.
13. `docs/humans.md` — commander as persistent profile (Clash-style), barracks/housing for human-crewed elites (mixed model), elite unit roster, population mechanics for humans only.

### Tier 4 — Experience & cross-cut
Written after Tier 3 systems are stable.

14. `docs/ui-ux.md` — mobile RTS UX (touch gestures, two-thumb command language, strategic zoom), info-war HUD (radar/jammers/cloak status), editor app UX (block placement, hardpoint snapping, schema validation feedback).
15. `docs/offline-pve.md` — online/offline state machine, pressure scaling with offline duration, natural-enemy event invocation, base persistence model, what's preserved vs reset across sessions.
16. `docs/multiplayer.md` — **stub only.** Anchors constraints: Schematic trust model (custom units in MP), lockstep vs server-authoritative, persistence implications for async PvP. Deferred but documented.
17. `docs/prototype-scope.md` — what from each system makes the 4–8 week prototype, what's explicitly deferred, success criteria for "is the core loop fun?"

---

## Per-doc header convention

Every doc under `docs/` and `DESIGN.md` uses this header structure so narrow agents can skip what they don't need:

```markdown
# <Title>

## TL;DR
<3–6 bullets. Skim-only summary.>

## Scope
<What this doc owns. What it does NOT own. Where the adjacent concerns live.>

## Prerequisites
<Other docs to load first, with one-line gloss each.>

## <body sections>

## Open questions
<Unresolved decisions, tagged `OPEN[YYYY-MM-DD]: <text>` and optionally `blocks: <doc>`.>

## Cross-references
<Outbound links to other docs, one-line gloss each.>
```

**Rationale:** an agent doing "write 10 weapon Schematics" loads `CLAUDE.md` (auto) + `glossary.md` TL;DR + full `schematics.md` + `units.md` TL;DR/weapons section + `economy.md` TL;DR + `physics.md` TL;DR. ~5 TL;DRs + 1.5 full docs. Tractable.

---

## Drift-prevention rules (codified in CLAUDE.md)

- **Glossary is authoritative.** New proper nouns added to any doc must also be added to `docs/glossary.md`.
- **Cross-references use relative paths** (`docs/foo.md`) so links work in GitHub UI and agent context.
- **Schematic examples in docs are illustrative.** Authoritative schemas will live in a future `schemas/` directory; docs reference but don't replicate them.
- **Open questions are flagged, not invented.** When a doc hits an ambiguity, it tags `OPEN[date]:` rather than guessing.
- **Boundary discipline.** If two docs could plausibly own a concept, the writer picks one and the other links to it. No duplication.

### Known boundary contracts
- `tech.md` owns progression rules; `units.md` owns part composition. Tech references part IDs; parts list lives only in units.
- `physics.md` owns steady-state environment; `events.md` owns time-varying perturbations.
- `factions.md` owns identity/lore; `ai-behaviors.md` owns mechanics (archetype weights, tree shapes).
- `events.md` owns the event catalog and director; `offline-pve.md` owns the online/offline state machine that invokes the director.
- `humans.md` owns the persistent-profile commander and human-elite barracks; `units.md` owns autonomous-AI unit chassis (no overlap because commander is off-map).

---

## Open questions that defer to during-writing

These don't block the plan but must be resolved while writing the cited doc:

- **OPEN: resource count.** Proposed 4 universal + 2 strategic + up to 4 env-locked = up to 10. Mobile UI may force trim. Resolve in `economy.md`.
- **OPEN: tech retrieval risk.** Tech Fragments as physical items (scout-carried, lost on death) vs counter ticks (safer). Lean physical. Resolve in `tech.md`.
- **OPEN: power model.** Streaming-only vs streaming + battery cap. Lean streaming + cap. Resolve in `economy.md`.
- **OPEN: editor app block model.** Pure voxel grid (max creativity, hardest to balance/mobile-render) vs hardpoint-snapped blocks (constrained creativity, easier to ship). Resolve in `units.md` and `ui-ux.md`.
- **OPEN: per-match win condition.** Territory-hold vs core-structure destruction vs hybrid. Resolve in `DESIGN.md`.
- **OPEN: meteor frequency and predictability.** Random, scheduled, or director-driven. Resolve in `events.md`.

---

## Critical files

To be created (in writing order, all under `/home/user/systems/`):

| Order | Path | Tier |
|---|---|---|
| 1 | `docs/glossary.md` | 1 |
| 2 | `docs/world.md` | 1 |
| 3 | `docs/factions.md` | 1 |
| 4 | `DESIGN.md` | 1 |
| 5 | `CLAUDE.md` | 1 |
| 6 | `docs/schematics.md` | 2 |
| 7 | `docs/physics.md` | 2 |
| 8 | `docs/economy.md` | 2 |
| 9 | `docs/tech.md` | 3 |
| 10 | `docs/units.md` | 3 |
| 11 | `docs/ai-behaviors.md` | 3 |
| 12 | `docs/events.md` | 3 |
| 13 | `docs/humans.md` | 3 |
| 14 | `docs/ui-ux.md` | 4 |
| 15 | `docs/offline-pve.md` | 4 |
| 16 | `docs/multiplayer.md` | 4 |
| 17 | `docs/prototype-scope.md` | 4 |

To be modified:
- `/home/user/systems/README.md` — expand from current minimal stub. Pitch, status (design phase), navigation map to all docs.

---

## Verification

Design phase is complete when:

1. All 17 docs exist on the branch.
2. Every `OPEN[…]` tag in any doc is either resolved or explicitly deferred to post-prototype.
3. `glossary.md` contains every proper noun referenced in any other doc (grep check).
4. Every doc has the standard header (TL;DR / Scope / Prerequisites / Open questions / Cross-references).
5. `prototype-scope.md` lists a concrete 4–8 week build with measurable "is it fun?" success criteria.
6. The PR diff is reviewed end-to-end by the user; they sign off that the design captured matches their intent.
7. A clean read of `CLAUDE.md` + `DESIGN.md` + `docs/prototype-scope.md` (the minimum context an engine-implementation agent would load) is sufficient to brief a new agent on what to build first.

When all seven hold, the next phase (Unity project scaffold + first Schematic schemas + prototype implementation) can begin.

---

## Execution model after plan approval

1. I write docs in tiered order. Each tier is its own commit (or set of commits) on the same branch, pushed and visible in PR #2.
2. I write Tier 1 sequentially (each doc cites the previous), then sub-tiers within Tier 2/3 in parallel where the dependency graph allows.
3. The user reviews PR #2 incrementally. Each tier's commits are a natural checkpoint.
4. Open questions that surface during writing are tagged in the relevant doc and surfaced in our chat so the user can resolve them.
5. When verification criteria hold, we close the design phase and open a new branch for engine work.

---

# Tier 3 Execution Plan (current phase)

## Context

Tier 1 (identity & contract — 5 docs) and Tier 2 (load-bearing systems — 3 docs) are committed (`b1e2e09`, `4893e32`, `36f2980`). The branch and working tree are clean. We are now opening Tier 3: the **content-system docs** that describe what the engine's content actually consists of (tech, units, AI behaviors, world events, humans, and the campaign arc).

Three open questions that previously blocked Tier 3 docs have just been resolved in chat. They need to be absorbed into the contract layer before Tier 3 is written, because the new locks shape multiple downstream docs.

## Newly locked decisions

1. **Editor App block model = hybrid (voxel chassis + hardpoint parts).** Players sculpt a voxel body for the *chassis* (silhouette, mass, armor); functional pieces (weapons, sensors, engines, utility) snap to engine-defined *hardpoints*. A unit Schematic is `chassis (voxel data) + parts (hardpoint refs)`. Owners: `docs/units.md`, `docs/ui-ux.md`.
2. **Tech model = faction-locked trees + Scientist salvage override.** Each faction has its own tech tree; tech does not cross faction lines by default. A new **Scientist** unit class can salvage **Salvageable Debris** from defeated enemy units — including custom Editor-App units fielded by other players — and produce a **Tech Copy** (often a degraded variant). Salvage is probabilistic. Owners: `docs/tech.md`, `docs/units.md`.
3. **Meteor scheduling = random within bounds.** Each map's environment Schematic declares min/max gap between Meteor Showers and a per-tick probability; the engine rolls. Owners: `docs/events.md`.

## Pre-Tier-3 edits (contract layer)

Before writing the Tier 3 docs, three contract files need short updates so the new locks are surfaced where downstream agents will see them. These edits were attempted before plan mode activated and need to be re-applied.

- **`DESIGN.md`**:
  - Insert three new "Locked design decisions" subsections (tech model, editor block model, meteor scheduling) into the existing locked-decisions section.
  - Remove the three corresponding entries from the "Open questions index": `editor app block model`, `meteor frequency`, `faction-locked tech vs universal`.
- **`CLAUDE.md`**:
  - Append three bullets to the "Locked decisions" list: tech model, editor app, meteor scheduling.
- **`docs/glossary.md`**:
  - Units & combat table: add `Scientist`.
  - Units & combat table: add `Voxel Chassis` (distinguishes the editor-output chassis from a chassis Schematic in general).
  - Tech table: add `Salvageable Debris`, `Tech Copy`. Adjust the existing `Salvaged Tech` gloss to clarify it's the PvE flavor (physical Fragments from Ruins), distinct from the PvP/Scientist flavor (Tech Copies from debris).

## Tier 3 docs to write (6)

All under `/home/user/systems/docs/`. Each follows the standard header (TL;DR / Scope / Prerequisites / body / Open questions / Cross-references).

| # | File | What it owns |
|---|---|---|
| 1 | `tech.md` | Three-layer progression (baseline / salvaged / researched). Faction-locked trees; per-faction signature lines. The Scientist salvage mechanic (probabilistic Tech Copies, with variant degradation). Software Tech category. Lab structures, research pacing, Tech Fragment / Exotic Matter sinks. |
| 2 | `units.md` | Modular composition model: chassis classes (autonomous AI vs Human-Crewed Elite), hybrid voxel-chassis + hardpoint-part rules, part categories (weapons, mobility, defense, utility, sensor), compatibility tags, the Scientist class definition, salvage interaction surface (what a Scientist unit *does* on the battlefield). |
| 3 | `ai-behaviors.md` | Stances (Hold / Patrol / Attack-Move / Fire-at-Will / Guard), behavior trees as Schematics, per-faction archetype overlays (Bulwark / Signal / Cinder Crown / Reclaimer weights), patrol/guard/ambush patterns, target selection. |
| 4 | `events.md` | Event director, time-varying perturbations over physics steady-state. Meteor Showers (random within bounds, drops exotic material), tornadoes, hurricanes/typhoons, dust storms, seasonal hazards. Natural Enemy invocation surface (events.md schedules; offline-pve.md owns the state machine). |
| 5 | `humans.md` | Commander as persistent profile (rank, reputation, library, designs). Barracks and Human-Crewed Elite roster. Human population mechanics (training cost, recovery to Barracks after a match). What persists vs resets across matches. |
| 6 | `campaign.md` | Four-phase arc (Earth → Moon → Reach → Constellation), per-phase content beats, content-vs-engine boundary so future phases are content. Enclave karma mechanics (formal model, with open questions tagged where not yet decided). |

## Boundary contracts within Tier 3

To prevent the docs from stepping on each other:

- `tech.md` owns progression rules; `units.md` owns part composition. `tech.md` references part IDs; the parts list lives only in `units.md`.
- `physics.md` (already written) owns steady-state environment; `events.md` owns time-varying perturbations on the same variables.
- `factions.md` (already written) owns identity & lore; `ai-behaviors.md` owns mechanics (archetype weights, tree shapes); `tech.md` owns the per-faction tech-tree shapes (referenced from `factions.md`).
- `events.md` owns the event catalog and director; `offline-pve.md` (Tier 4) will own the online/offline state machine that invokes the director.
- `humans.md` owns the persistent-profile commander and human-elite barracks; `units.md` owns autonomous-AI unit chassis. Overlap is intentional and limited to elite-class definition: `units.md` defines the chassis/part rules; `humans.md` describes the elite roster and barracks economy.
- `campaign.md` owns the multi-phase arc and enclave karma; per-phase resources/environments/units are content references back into `economy.md`, `physics.md`, `tech.md`, `units.md`.

## Critical files

To be created:

- `docs/tech.md`
- `docs/units.md`
- `docs/ai-behaviors.md`
- `docs/events.md`
- `docs/humans.md`
- `docs/campaign.md`

To be modified (pre-Tier-3 absorption of new locks):

- `DESIGN.md` — locked-decisions and open-questions-index edits
- `CLAUDE.md` — locked-decisions bullets
- `docs/glossary.md` — Units & combat and Tech tables

## Execution order

1. Apply contract-layer edits to `DESIGN.md`, `CLAUDE.md`, `docs/glossary.md`.
2. Write `tech.md` and `units.md` first (they cross-reference each other and define the new vocabulary the other Tier 3 docs need). Drafted in one pass with consistent shared terms.
3. Write `ai-behaviors.md`, `events.md`, `humans.md`, `campaign.md` in a second pass (each depends on tech/units vocabulary but is otherwise independent of the others).
4. Two commits:
   - **Tier 3a**: contract edits + `tech.md` + `units.md` ("absorb editor/tech/meteor locks; add tech and units docs").
   - **Tier 3b**: the remaining four docs ("add ai-behaviors, events, humans, campaign docs").
5. Push the branch and (if PR #2 doesn't already exist) open it as a draft.

## Open questions I expect to surface during writing

These don't block the plan; they get tagged with `OPEN[2026-05-27]:` in the relevant doc and surfaced in chat at the end of Tier 3.

- `units.md`: experimental unit count per faction; weight-class boundaries (light/medium/heavy/experimental); voxel-grid resolution and per-unit voxel budget for mobile-render.
- `units.md` (aircraft logistics — newly added in chat): aircraft must burn Fuel and operate inside the radius of an airbase / carrier / refuel tanker. Open: does the rule apply to fixed-wing only or also rotary/VTOL/light drones; out-of-fuel behavior (crash vs glide vs auto-RTB on reserve). Carrier chassis = mobile airbase. Updates also needed: `economy.md` (Fuel as per-tick aircraft sink) and `DESIGN.md` (air-power-as-logistics-game as a pillar-adjacent gameplay axis).
- `units.md` + `ui-ux.md` (strike-mission math — extension of above): bombing-range = (fuel ÷ burn) × speed ÷ 2 − loiter reserve − ordnance weight penalty. Heavy bombers carry more payload but burn more, so effective strike radius is *shorter* than light strike fighters. HUD must preview "can this squadron hit target X with loadout Y and RTB?" so one-way strikes are a deliberate choice, not an accident. The three resulting strategic choices: long-range/light-payload bombers, forward airbase/carrier push, or committed one-way runs.
- **Unified energy model — newly added in chat. Major addition; lands across multiple docs.**
  - **Ground vehicles** obey the same fuel/range rule as aircraft (operate inside carrier/depot network). `units.md`.
  - **Fusion robotech walkers** — carry their own reactor, infinite operating range. **When destroyed, cause a small nuclear blast.** Liability near friendly assets; weapon when suicide-rushed. `units.md`, `physics.md` (blast model).
  - **Scuttle action** — any unit can self-destruct. Two modes: (a) **tech-denial scuttle** leaves no Salvageable Debris, the natural counter to the Scientist salvage mechanic from `tech.md`; (b) **damage scuttle** detonates for area damage (fusion walkers do mini-nukes, others do smaller booms). Creates a real strategic question: accept the salvage leak or accept the unit loss. `units.md` (action), `tech.md` (salvage-denial interaction).
  - **Mobile info-war battery model** — cloak, mobile shields, jammers can run on either streaming Power or a local battery with finite capacity and solar recharge. **Partial-charge gives partial activation** (lean: linear payoff — 30% charge = 30% duration). Forces timing discipline. `units.md` (battery part stats), `economy.md` (battery vs streaming distinction).
  - **Solar irradiance** as an environment variable — recharge rate depends on planet/season. `physics.md`.
  - **Tech tree implication** — energy-source progression (battery → fuel cell → fusion) is its own branch. `tech.md`.
  - **DESIGN.md** gains a short pillar-refinement note: Power has *base* (streaming) and *unit* (battery + solar) flavors; their interaction is gameplay.
  - **Questions to surface when resuming Tier 3a**: (1) can every unit scuttle, or only some (default: every unit, but tech-denial only matters for units carrying salvageable tech); (2) fusion-walker nuclear death — always-on combat-death-nukes, or controllable safe-shutdown vs combat-death distinction (default: combat death always nukes, safe shutdown silent); (3) partial-charge payoff curve — linear / threshold / step (default: linear).
  - **Resolved in chat**: (1) **scuttle is higher-tier only** — T2+ units (experimental, Human-Crewed Elites, units carrying Salvaged/Researched parts) only; lower-tier mass units just die. (2) **Fusion cooling** — fusion walkers run indefinitely on low-output ops but accumulate heat under load; hitting the cap forces a vent/cool-down window (immobile or disarmed). Combat damage to the reactor accelerates heat-up and increases nuclear-death failure risk. Implication: walker is high-uptime, not invulnerable; sustained swarm pressure is a viable counter. (3) **Partial-charge payoff is linear** (30% charge = 30% duration).
  - **New design tenet — bigger than fusion** ("every high power has a weakness; entails logic"): every strong capability must entail a logical drawback. To be written into `DESIGN.md` as a named design tenet and referenced in `units.md`, `ai-behaviors.md`, and `tech.md` wherever a strong capability is introduced. Examples already in the design: heavy bomber → short strike radius; cloak → battery drain + no-fire-while-cloaked (TBC); shield → continuous Power drain + depletion under fire; long-range artillery → low ROF + close-range dead zone + no self-LOS; carrier → slow + lightly armored.
- **Six operating domains — newly added in chat. Major scope expansion; lands across units.md, physics.md, economy.md, tech.md, events.md.**
  - **Land** — heightmap + traction; battery/fuel/fusion energy; visual + radar detection; weakness LOS-blocked + slow to reposition.
  - **Sea** — bathymetry + coastline; ports + tenders refuel; surface ships seen by radar, subs by sonar; chokes at straits, tied to navigable water.
  - **Air** — 3D + altitude bands; carriers = mobile airbases; fuel-weight bound; landing-vulnerable. Already covered above.
  - **Subterranean** — substrate hardness gates where tunneling is possible; fuel + structural cooling; hidden from surface vision, revealed by seismic sensors; slow, surface-vulnerable, can be collapsed.
  - **Walking (mech / fusion)** — all-terrain incl. steep slopes; fusion with heat management (see above); thermal-bright, heat-cycle vent windows are the killing window.
  - **Orbital** — satellites have a ground-track footprint that sweeps over time (not omnipresent); massive launch Fuel + station-keeping Power; sees through fog-of-war within footprint; killable by ASAT; orbital debris hazard.
  - **Weapon-system layer**: direct-fire (LOS, fast cooldown), indirect/artillery (arc + spotter + dead zone), missiles as autonomous units (cruise vs ballistic vs tactical; interceptable), turrets (stationary, cooldown-dancing), beam weapons (instant hit + huge Power draw + weather attenuation), orbital strike (footprint-gated, jammable, long cooldown).
  - **Detection / counter-detection**: vision / radar / sonar / seismic / thermal / orbital; counters: cloak / stealth shape / depth / composite-thermal-lining / satellite-window timing. Every sensor has a counter has a counter-counter — this *is* the info-war pillar realized.
  - **`units.md` chassis classes** must enumerate all six domains; **`physics.md`** must declare per-domain environment variables (bathymetry, substrate hardness, solar irradiance, orbital ground-track model); **`economy.md`** must declare per-domain refuel/launch sinks; **`tech.md`** must gate each domain unlock; **`events.md`** must cover per-domain hazards (storms for sea/air, earthquakes for subterranean, debris-cascade for orbital).
  - **Scope decision for `docs/prototype-scope.md` (Tier 4 — not blocking Tier 3, but flag in Tier 3 docs)**: **all six domains designed in docs, prototype builds a defensible subset.** Recommendation: prototype = **land + air**. Sea / subterranean / orbital are content for post-MVP. The Schematic architecture must not foreclose any domain so post-MVP additions are content work, not engine work. Decision to confirm with user when we open Tier 4.
- **Derived-stat discipline — newly added in chat. Load-bearing architectural commitment; touches every Tier 2/3 doc.**
  - **Rule:** every gameplay number (speed, range, cooldown, ROF, accuracy) is *derived* from physical inputs (mass, energy, thermal capacity, terrain). Schematics state physical inputs + tuning coefficients; engine computes outputs.
  - **Worked examples that lock the philosophy:**
    - Heavy installation gun: `range = f(barrel length, propellant energy, elevation, drag)`; `cooldown = thermal_capacity / (per_shot_heat − cooling_rate)`. Range up ⇒ heat up ⇒ cooldown up. Automatic tradeoff.
    - Energy spine choice is gameplay: grid-tethered streaming = infinite shots but grid burst-dip on fire; self-contained battery = finite shots between recharge, no grid impact, deployable anywhere. **Same gun, two different units depending on energy choice.**
    - Mobile gun shares energy budget with engine — driving and firing compete for the same battery. Stationary-vs-mobile is an ongoing choice, not a chassis property.
    - Mobility: `speed ≈ engine_kW × terrain_traction × drivetrain_eff / f(mass)` (sub-linear mass exponent). Heavy walker on mud loses to light tank; same walker on rocks wins. Terrain matters becomes computational.
    - Compatibility tags (`tracked` / `wheeled` / `legged` / `tunneling` / `displacement-hull` / `vacuum-rated`) gate where a chassis can go at all; formulas modulate *how well*.
  - **Why this is load-bearing — connects to everything already locked:**
    - "Every high power has a weakness" is *enforced* by physics, not by designer discipline.
    - Editor App balance: players input physical properties, broken units would have to violate conservation of energy.
    - Salvage Tech Copy "degraded variant" stops being arbitrary % nerfs; becomes worse thermal capacity / lossier drivetrain / etc.
    - Terrain-matters pillar: gets real teeth — slope geometry actually constrains where artillery can reach a firing position in time.
    - Tech progression: research outputs are *physical* improvements (better material thermal capacity, higher energy density), not flat damage bonuses.
  - **Doc impact:**
    - `DESIGN.md` — new named tenet **Derived-stat discipline**, paired with **Every high power has a weakness** as the design constitution.
    - `docs/schematics.md` — **patch needed (Tier 2 doc, already written)**: a Schematic's stat fields are physical inputs + tuning coefficients, never bare gameplay numbers. Add a `formulas/` directory concept for named derivation Schematics. Engine has a public catalog of derivation formulas.
    - `docs/physics.md` — **patch needed (Tier 2 doc, already written)**: add formula catalog (ballistics, thermal cooling, drivetrain, atmospheric drag, terrain friction tables).
    - `docs/units.md` — every chassis class documented as input-properties + derived-stats, with at least one worked example per chassis.
    - `docs/tech.md` — research nodes output physical improvements, not flat bonuses.
  - **Question to put in front of user when resuming Tier 3a — physics fidelity:**
    1. *Real-ish formulas, simplified coefficients* — real units (kg, MJ, MJ/s), hand-tuned per-terrain multipliers, real ballistic arcs, cooling = heat/time. **Coherent + tractable on mobile + ~80% of the feel. Recommendation.**
    2. *Full real-physics simulation* — true drag tensors, thermal ODEs. Beautiful, expensive, infeasible on phone.
    3. *Abstract bands* — {light, medium, heavy} buckets. Mobile-friendly, loses depth, undermines the Editor-App promise.
  - **Implication for already-written Tier 2 docs**: `schematics.md` and `physics.md` need patch commits before Tier 3 docs can cleanly reference the formula model. Sequence becomes: Tier 3a contract edits → Tier 2 patches (schematics + physics) → tech.md + units.md → Tier 3b.
- **Physics constitution: four-layer rule — newly added in chat. Locks the engine's bedrock.**
  - **The architecture:** four ordered layers, higher layers may only consume from layers below, enforced topologically at load time.
    - **Layer 0 — Constants:** universal (g, σ, specific heats, atmospheric density, c_sound) + game-tuned coefficients (mass exponent for drivetrain, armor-to-mass, sim tick rate). Small, mostly immutable.
    - **Layer 1 — Equations:** each formula is a named Schematic with declared inputs, outputs, tuning coefficients. Catalog includes ballistics, thermal-cooling, drivetrain, sensors, drag, atmospheric attenuation. Equations consume from Constants only.
    - **Layer 2 — World variables (environments):** per-map Schematics declaring values for gravity, atmosphere density, solar irradiance, substrate hardness, ambient temperature. Already exists in `physics.md`. Consumes from Constants.
    - **Layer 3 — Models (units / weapons / structures):** declare physical inputs only (mass, engine_kW, barrel_thermal_capacity, propellant_energy_per_shot). No bare gameplay numbers (no damage / speed / range). Engine combines model + environment + equations to derive output.
  - **Worked example locked in chat:** heavy tank firing across a ridge — ballistics equation consumes gun model inputs + environment (gravity, drag) + constants; resolves trajectory; terrain (Layer 2) blocks. Same gun fired on Ashen Eye (g=1.6, vacuum) → different trajectory → clears the ridge. **Same model, different environment, different outcome — the four-layer architecture makes this trivial.**
  - **New named design tenet for `DESIGN.md`:** **Physics constitution: four-layer rule.** Sits alongside **Derived-stat discipline** and **Every high power has a weakness** as the engine's design constitution.
  - **Doc impact (revises and extends prior plan):**
    - `DESIGN.md` — name the three tenets together as the constitution.
    - `docs/physics.md` (Tier 2 patch — ~doubles the doc): add Constants section, Equations catalog with input/output signatures, Layer-interaction section, worked-shot example.
    - `docs/schematics.md` (Tier 2 patch): add `constant`, `equation`, `formula` as first-class Schematic kinds. Document the strict load-order rule (Constants → Equations → Environments → Models).
    - `docs/units.md` (Tier 3): all chassis documented in physical inputs only.
    - `docs/tech.md` (Tier 3): research outputs modify physical properties; never flat bonuses.
    - Eventually `schemas/` directory: real JSON Schemas per Schematic kind. Out of scope for design phase but documented.
  - **Implementation question to tag `OPEN[2026-05-27]:` in `schematics.md`:** how are equations *expressed* in Schematics?
    1. JSON expression strings parsed by a sandboxed evaluator (`"output_velocity": "sqrt(2 * propellant_energy / projectile_mass)"`). **Recommendation** — modder-friendly, bounded perf.
    2. Small structured DSL — more constrained, harder to author.
    3. Hard-coded C# with named formulas — fastest but locks modders out of equation changes.
  - **Revised Tier 3a sequence** (supersedes earlier sequence):
    1. Contract-layer edits to `DESIGN.md` / `CLAUDE.md` / `docs/glossary.md` (absorb the three earlier locks PLUS the three new tenets: Derived-stat discipline, Every-high-power-has-a-weakness, Physics constitution four-layer rule).
    2. **Tier 2 patches** to `docs/schematics.md` (add constant/equation Schematic kinds + load order) and `docs/physics.md` (add Constants section + Equations catalog + Layer-interaction + worked example).
    3. Write `docs/tech.md` and `docs/units.md` referencing the now-patched Tier 2 docs and the new tenets.
    4. Commit Tier 3a (contract edits + Tier 2 patches + tech.md + units.md).
    5. Tier 3b unchanged: `docs/ai-behaviors.md`, `docs/events.md`, `docs/humans.md`, `docs/campaign.md`.
- **Customization surface — newly added in chat. Spans `docs/ui-ux.md` (Tier 4), `docs/schematics.md` patch, `docs/glossary.md`, `DESIGN.md`, eventually `schemas/`.**
  - **Five tiers of customization (clustered by the kind of identity each builds):**
    - **Tier A — Identity & cosmetics:** personal sub-badge layered on faction badge; uploadable personal flag (flies on HQ, transport, captured points); team-color palette (primary / secondary / accent); commander portrait + call-sign; per-Schematic squadron markings; wear & weathering style; audio identity (voice, horn, march); base banner above HQ.
    - **Tier B — Functional content (the Editor-App promise):** unit Schematics (locked); base templates / blueprints (save turtle layout, redeploy); per-Schematic paint kits via Tier-A palette hooks (Warhammer-painter loop); unit naming with persistence — surviving Human-Crewed Elites become legends; control-group presets; behavior-tree edits (power-user creative).
    - **Tier C — Social / multiplayer identity:** clan flag + colors layered with personal; shared design library across clan with attribution; host badge on post-match screen; signal flares / emotes mid-match.
    - **Tier D — Modding seam:** custom equations (per Physics Constitution); custom environments; custom events; custom enclaves; sound / music packs.
    - **Tier E — Per-match flavor:** operation name + motto on loading screen; pre-match propaganda blurb (faction newspaper); loadout names ("Rolling Thunder Doctrine" not "Build Order #4").
  - **Compelling-because-it's-rare beats (player attachment drivers):** trophy room (Tech Copies salvaged, rare Schematics from Ruins, hardest battles); notable-battle replays; **Salvage Signature — when *your* Scientist produces a Tech Copy, the variant carries your badge; subsequent players who salvage *your* variant see a chain of ownership. Custom units develop a paper trail across the playerbase.**
  - **Cosmetic identity layer — technical spec (locked unless objected):**
    - **Formats:** SVG preferred (vector, recolorable, modder-friendly, already the format in `concept/identity/`); PNG fallback for non-SVG authors but discouraged because raster doesn't recolor cleanly.
    - **Size caps:** badge 50 KB SVG / 100 KB PNG / 256×256 raster, must render legibly at 32×32 army-icon size. Flag 100 KB SVG / 200 KB PNG / 512×768 raster, 2:3 aspect (real-flag proportions). Palette <1 KB JSON. Paint kit 50 KB total.
    - **Recolor hooks via SVG classes:** `team-primary` / `team-secondary` / `team-accent` are recolored at render time per the active player palette; `fixed` is never recolored. One uploaded asset renders correctly for any team palette.
    - **Validation rules at upload (enforced mechanically):** reject if exceeds size cap, contains `<script>` / `<foreignObject>` / remote `xlink:href` / embedded raster >100 KB; reject if >~200 path elements (likely a vectorized photo); reject if transparent regions overlap team-color zones (looks broken when recolored). Clear error message tells the player what to fix.
  - **Content moderation — open question to resolve in `docs/ui-ux.md` (or `docs/multiplayer.md`) when those are written:**
    1. *Pre-approved templates only* — safest, loses creative-upload joy.
    2. *Open uploads with automated + community moderation* — fast to ship, requires staffing the report queue.
    3. *Open uploads, visibility-tiered* — always renders to self; renders to clan/friends; public-matchmaking visibility requires a low-friction approval step. **Recommendation.** Respects creative wish + keeps public surfaces moderated + scales (solo PvE never enters queue).
  - **Doc impact:**
    - `docs/ui-ux.md` (Tier 4) — full owner of cosmetic identity: upload UI, format constraints, recolor hooks, validation feedback, moderation flow, palette editor, paint kit interface.
    - `docs/schematics.md` (Tier 2 patch — already planned, append) — add `badge`, `flag`, `palette`, `paint-kit`, `squadron-marking` as Schematic kinds.
    - `docs/glossary.md` — add Badge (personal sub-badge), Flag (uploaded banner), Palette, Paint Kit, Squadron Marking, Salvage Signature.
    - `DESIGN.md` — short pillar-adjacent paragraph **"Identity is content"** — alongside the unit Editor, players bring their own visual language; the engine accepts, validates, recolors.
    - Eventually `schemas/badge.schema.json`, `schemas/flag.schema.json`, etc.
- **Long-view legacy & invariance — newly added in chat. The vision lock for endgame and durability.**
  - **Invariance: amend, never alter — new named tenet (fourth in the constitution).** Layer 0 Constants and Layer 1 Equations of the physics constitution are **additive only**. New equations can be introduced (warp travel, exotic matter, new sensors). New constant values can be added (new substrates, atmospheres, propellants). Existing equations and existing values **cannot be retroactively changed**.
    - **Implementation form:** every Schematic carries a `physics_version` field. The engine maintains a registry of all historical versions. Schematics resolve against the version they declare. New content uses current version; old content keeps working under its original version. Versions accumulate.
    - **Why this matters:** units built Year 1 still work in Year 5; replays stay valid across years; PvP balance can't be silently retuned; modder content has a stable floor. This is the feature that lets the game live for ten years.
    - **Doc:** `DESIGN.md` (named tenet), `docs/schematics.md` Tier 2 patch (versioning section + `physics_version` field + version-registry concept).
  - **Endless scope — new named design goal (fifth in the constitution).** Every new system gets measured against: does it cap, or does it open further? Rules out: hard library/hall caps, linear content lists with endings, achievements that complete and stop mattering, scale ceilings. Rewards: procedural/emergent systems, player content as renewable resource, stories as the unit of memorable content.
    - **Doc:** `DESIGN.md` named goal at the top of the design constitution.
  - **Hall of Conquered Flags — concrete legacy mechanic.** When you defeat an opponent (PvP player, campaign faction, hostile enclave), their flag clones into your account's hall. Carries metadata: opponent call-sign, map, date, score, replay-clip thumbnail. Display layers: account profile (hall view), in-base banners during matches (intimidation), post-match summary. **Captured PvP flags are the *actual SVGs* the opponent uploaded** — meaningful because of the customization layer. Connects to Salvage Signature: hall holds both captured flags and salvaged-with-attribution Tech Copies, a unified legacy system.
  - **Battle Highlights — auto-curated replay clips (30s–2min).** Engine identifies pivotal moments (commander/experimental death, major Tech-Copy salvage, scuttle on high-value target, one-way bomber strike connects, orbital strike in window, defensive line break/hold, player-pressed "clip that"). Indexed by player/match/tag/faction. Shareable. The artifact format that becomes community lore.
  - **Achievements that unlock content (not stickers).** Principle: an achievement is meaningful only if it changes what you can do or how you're seen. Examples: Mud Warrior (10 PvP land-only wins → unique tracked chassis blueprint); Master Salvager (Tech-Copy from each canonical faction → Salvaged Composite tech tier); Hold the Line (20 successful offline-PvE defenses → bunker variants); Designer of Note (a player's Editor-App unit wins 100 matches in others' hands → Veteran marking + designer badge in the unit's info card across the playerbase); First to the Reach (account opens a warp gate → call-sign prefix + hall section for off-world conquests).
  - **Five-Scale progression — axis layered on campaign phases.** Scale ≠ phase. Phases are content beats (Earth → Moon → Reach → Constellation); Scale is operational reach.
    - **Scale 1 Survivor:** one base, one map, one match. The prototype loop.
    - **Scale 2 Settler:** persistent base across matches. Offline-PvE bridges sessions.
    - **Scale 3 Power:** multiple bases on multiple maps. Territory, supply lines, regional reputation.
    - **Scale 4 Civilization:** a planet under your influence. Allegiance networks, succession, larger economy.
    - **Scale 5 Conqueror:** multi-world holdings. Warp logistics, interstellar comms delay, Constellation co-op.
    - Each scale opens new mechanics without breaking earlier ones (invariance applies).
    - **Doc:** `docs/campaign.md` (Tier 3) gains the five-scale model alongside the four-phase arc.
  - **"Engines evolve through the universe" — campaign as engine-capability unlock model.** Each campaign phase is a content expansion using the same engine: Phase 1 = land + air + conventional; Phase 2 = orbital + low-g + vacuum-rated; Phase 3 = warp + interstellar logistics; Phase 4 = co-op planet-tending. New equations + new environments + new chassis = new content, not engine work. Invariance guarantee makes Phase-N additions safe for Phase-1 content.
  - **Doc impact (full):**
    - `DESIGN.md` — five named tenets/goals (Physics Constitution / Derived-stat discipline / Every-high-power-has-a-weakness / Invariance: amend never alter / Endless scope).
    - `docs/schematics.md` (Tier 2 patch) — `physics_version` field, version registry, additive-only rule.
    - `docs/humans.md` (Tier 3) — Commander profile gains: Trophy Hall (captured flags), Battle Highlights archive, Achievements ledger, Salvage Signature lineage. The Commander becomes a real *character* with a history.
    - `docs/campaign.md` (Tier 3) — five-Scale model layered on four-phase arc; per-phase engine-capability unlocks.
    - `docs/ui-ux.md` (Tier 4) — Hall view, highlight playback, achievements panel.
    - `docs/multiplayer.md` (Tier 4) — PvP flag-capture mechanics + moderation interaction (captured opposing badges still need to be safe to display in your own hall).
    - `docs/glossary.md` — add Hall of Conquered Flags, Battle Highlight, Achievement, Scale (with five levels), Physics Version, Invariance.
- **Hall-as-library + magic + porous PvP/PvE — newly added in chat. Closes the long-view loop.**
  - **Hall of Conquered = living tech library (extends earlier Hall mechanic to be a meta-progression engine):**
    - **Surveyed:** defeated party's Schematics visible in your Hall as research-able entries; full spec readable, not yet buildable.
    - **Mimicked:** buildable as a *degraded variant* (Salvage Signature mechanic at meta scale, mild degradation since no time pressure). Variant carries dual attribution (original designer + "via your conquest").
    - **Mastered:** buildable at full fidelity. Requires three independent triggers — encountered + in-match-salvaged + lab-researched. Rare; earned.
    - **PvE *and* PvP** both contribute to Hall library (user confirmed). PvE invading scenarios become the canonical introduction vector for new exotic content.
  - **New named principle: Magic is unfamiliar physics (sixth in the design constitution).** Nothing in the engine violates the physics constitution; what looks like magic is narrative dressing on equations the player doesn't fully understand. A psionic blast Schematic declares physical inputs (`psionic_charge_capacity`, `focus_crystal_alignment`, `exotic_matter_throughput`) and resolves through an equation (`equations/psionic-emission.json`). The equation is a new amendment, the inputs cost real resources, the narrative tells the player it's magic. Preserves invariance, derived-stat discipline, Editor-App balance, modder safety. Enables narrative magic, asymmetric capabilities (cost-balanced), visual signature without rule violation.
  - **Evolution-able Schematics (concrete mechanism):**
    - Schematic declares an `evolution` block: list of `{ trigger: <condition Schematic>, successor: <schematic_ref> }`.
    - When trigger condition is met on a specific unit instance, engine swaps its Schematic reference to successor **while preserving identity** — name, history, badge, Hall provenance, scars.
    - Branching evolution: different triggers reach different successors. Players develop signature lineages.
    - Implementation: Schematic inheritance + trigger Schematics + identity preservation. Content, not engine work.
    - Use cases: walker named "Patience" gains capabilities through phases; bio-tech that grows; Pokémon-evolution for war machines.
  - **Porous PvP/PvE — architectural unification:**
    - **A match = world-state instance + participant roster + objective Schematic.** Participants are Commanders (persistent profiles). Each Commander is AI-driven (behavior-tree Schematics) or human-driven (player input). Engine does not distinguish.
    - Scenarios all derive from the same model: PvE campaign mission = mostly-AI roster + scenario objective; PvP ranked = all-human + competitive; PvE invasion of offline base = AI invader + your defenses (co-op if friends join); PvP raid on campaign world = human invader on another human's persistent session; FFA = N humans + last-standing objective.
    - Content cadence: new exotic tech enters via PvE invasion scenarios; conquering players add to Hall library; PvP meta evolves narratively not by patch.
  - **Tier 4 doc reorganization triggered by the unification:**
    - **New: `docs/matches.md`** (replaces or sits above the previous `multiplayer.md` + `offline-pve.md` split). Owns participant-roster + objective Schematic + match-as-world-state-instance.
    - `docs/multiplayer.md` and `docs/offline-pve.md` become scenario documents *under* `docs/matches.md` — they describe particular configurations (all-human + competitive, AI-invader + offline-defender) rather than separate systems.
    - Tier 4 doc list updates: was `ui-ux.md / offline-pve.md / multiplayer.md / prototype-scope.md`; becomes `ui-ux.md / matches.md / offline-pve.md / multiplayer.md / prototype-scope.md` (matches.md as the load-bearing one written first in Tier 4).
  - **Doc impact summary (this beat):**
    - `DESIGN.md` — sixth named principle: **Magic is unfamiliar physics**. Constitution now has six entries.
    - `docs/schematics.md` (Tier 2 patch — append): `evolution` block; Schematic inheritance for predecessor-successor relationships; additive equation-catalog amendment as the path for new physics.
    - `docs/tech.md` (Tier 3): three-tier mastery model (Surveyed / Mimicked / Mastered); meta-progression vs in-match progression distinction; "Magic is unfamiliar physics" framing for exotic tech categories.
    - `docs/humans.md` (Tier 3): Hall gains the three-tier library mechanism; Commander profile shows library size + mastery counts.
    - `docs/campaign.md` (Tier 3): PvE invading scenarios as the content cadence vehicle; new exotic tech enters via narrative content.
    - `docs/matches.md` (Tier 4, NEW): the unified match model.
    - `docs/multiplayer.md`, `docs/offline-pve.md` (Tier 4): become scenario-config docs under matches.md.
    - `docs/glossary.md` — add Surveyed, Mimicked, Mastered, Evolution (Schematic trigger), Match (formal definition), Objective Schematic, Magic (defined as unfamiliar-physics narrative), Hall-as-library (extending Hall of Conquered Flags).
- **The agent layer / living world — newly added in chat. The production model that makes "endless scope" achievable.**
  - **Architectural luck:** the Schematic-as-content choice we made on day one quietly enabled this. AI agents produce JSON Schematics; engine doesn't care about author. No engine refactor needed — this is a *property we already have*, not a feature to add.
  - **Two layers of agent work:**
    - **Production-time agents (dev pipeline — practical near-term):**
      - *World observer agent* — reads live game state across playerbase; identifies narrative-interesting situations (rising clans, contested territories, tech proliferation, vacuum-of-power moments).
      - *Scenario writer agent* — drafts PvE invasion arcs, faction shifts, threat awakenings responsive to observer findings.
      - *Content generator agent* — produces concrete Schematics: factions, named-character behavior trees, missions, dialogue, environment perturbations, exotic-tech equations (per Magic-is-unfamiliar-physics).
      - *Quality gate agent* — validates against the design constitution (invariance, derived-stat discipline, weakness-on-power, balance, difficulty). **Constitution is the contract the agent must honor.**
      - *Continuity agent* — maintains evolving lore; cross-references existing factions/characters/events; prevents drift over years.
      - *Human review gate* — team approves before deployment, especially early.
    - **Runtime agents (live director — graduate to this post-V1):**
      - Agents act on the live world, generating narrative responsive to events in near-real-time.
      - Named opponents, follow-up invasions, AI-authored enclaves opposing specific clans, post-match chronicles entering Halls as trophy context.
      - Events.md Event Director becomes thin orchestration over runtime-agent decisions; catalog provides *kinds* of events, agent picks *which makes a story now*.
      - Expensive, latency-sensitive, quality-risky. The version that fully delivers "endless scope."
  - **Architectural validation (this message retroactively justifies earlier decisions):**
    - Schematics-as-JSON-content → agents produce JSON.
    - Physics constitution + invariance → agents must produce amendments, not alterations. Same constraint as modders.
    - Behavior trees as Schematics → agents can write AI behavior; no code path for "scripted boss" vs "regular AI."
    - Magic-is-unfamiliar-physics → agents introducing new capabilities extend equation catalog; constitution stays clean.
    - Match-as-roster+objective-Schematic → agents can write new objective Schematics; new match types are content.
    - **None of this is retrofit; all of it is design-coherent.**
  - **PvP/PvE collapse — sharpened:** they aren't separate because agents are continuously authoring PvE content into the same world players are playing PvP in. Generated enclaves watching/aligning; ancient threats stirring in contested territory; named antagonists remembering players from prior matches; PvE "weather" responsive to PvP outcomes (losing players find allies; dominant players find resistance). All one world.
  - **Doc impact:**
    - **New doc: `docs/agents.md`** (or `docs/living-world.md`, name TBD). Tier 5 (new tier) or end of Tier 4. Owns: production-time pipeline, runtime director, quality-gate-against-constitution rules, human-review gates, content cadence.
    - `DESIGN.md` — short pillar-adjacent note: **"The world is a co-author."** Players create units; AI agents create narrative; humans curate; universe grows from the interaction.
    - `docs/events.md` (Tier 3) — written knowing Event Director can be Schematic-catalog OR runtime-agent decision surface; architect for both.
    - `docs/matches.md` (Tier 4) — written knowing objective Schematics can be agent-generated.
    - `docs/schematics.md` (Tier 2 patch — append): AI-authored Schematics flow through same load/validate/version path; nothing special.
    - `docs/multiplayer.md` (Tier 4) — explicit: AI-generated PvE content runs inside PvP matches; world is shared.
    - `docs/glossary.md` — add Narrative Agent, Production-Time Agent, Runtime Director, Quality Gate, Continuity Agent, Living World.
  - **Open questions to resolve in `docs/agents.md`:**
    1. *When in development do we start?* Recommendation: production-time agents become realistic late-prototype / early-V1. Runtime director post-V1, possibly V2. Architecture must not foreclose runtime.
    2. *Human/agent ratio at launch?* Recommendation: blended (agent drafts → human curates → ships) for the first year; relax as the pipeline earns trust.
    3. *Visibility to players?* Are agents part of the fiction (a "Watcher" entity in-world) or invisible (world just feels alive)? Both work; different design implications.
- **PvP toggle / community / monetization — newly added in chat. Locks two more constitution-level principles and the revenue model.**
  - **PvP toggle, PvE always-on:**
    - **Model:** PvE is the world (storms, world destruction, scavenger swarms, AI-generated invasions); PvP is opt-in within the world. (PvP-off + PvE-off does not exist.)
    - **Sanctuary rules (hard, not soft):** PvP-off player's territory is inviolable to other players. Period. Trust commitment that makes the toggle real.
    - **PvP-off players still in the world:** generated narrative agents notice neutrality, factions take note, refugees flow, traders prefer their roads. Engaged but unattacked.
    - **Commitment windows:** flagging PvP on/off commits for a meaningful period (7–30 in-world days). Prevents gaming the toggle.
    - **Hall implications:** PvP-off players build PvE-flavored Halls (conquered enclaves / factions / invasion antagonists). Rich enough.
    - **Doc:** lives in `docs/matches.md` (Tier 4) as a property of the participant in the match-roster model.
  - **New named principle: "Community is the long game" (seventh in the constitution).** Single-player experiences end when content runs out; community-driven experiences end when the community dissolves. Every system already designed (Editor App, Salvage Signature, Hall of Conquered, Achievements, AI agents) is valuable in direct proportion to how many other players interact with it.
  - **Faction triple-nesting (extension of the canonical four):**
    - **Canonical factions** (Reclaimer / Bulwark / Signal / Cinder Crown) — identity baseline; player picks one. Locked.
    - **Player-founded clans (sub-factions inside canonical)** — own flag, name, leadership, design library, internal economy. Multiple clans coexist within one canonical faction.
    - **Alliances (cross-faction)** — temporary or persistent agreements between clans, intra-canonical or cross-canonical. Allows large-scale coordination without forcing canonical faction monoliths.
    - AI narrative agents observe clan dynamics — rising clans get challenge content; declining get recruitment narrative; rivalries become PvE invasion arcs.
    - **Doc:** `docs/factions.md` (Tier 1 patch) — extend with clan + alliance model.
  - **New named principle (most non-negotiable): "Skill, not wallet" (eighth in the constitution).**
    - **Rule, stated absolutely:** money buys nothing that affects gameplay. Not units. Not tech. Not Schematics. Not faction standing. Not match outcomes. Not progression speed. Not Hall content. Not achievements. **Nothing.** Time, effort, and skill are the only currencies that buy gameplay outcomes.
    - **Not "we'll try not to" / not "only cosmetic advantage" / NOTHING.** This is the rule the constitution exists to protect against later commercial pressure.
    - **Origin signal:** user has personal scar tissue from a previous P2W game ("still mad about it"). That feeling is the design target — what we're designing *against*.
  - **Revenue model: diegetic ads as world texture.**
    - **The fit:** post-apocalyptic frame is *perfect* — pre-Fall corporate signage IS world texture. Faded billboards on ruins, holograms still flickering, drink-machine logos in abandoned malls.
    - **Two flavors:**
      - *Real brands (paid placements)* — Coke, Pepsi, Toyota, etc. Revenue. Brands that won't allow dystopian context are out; irony-positive brands lean in.
      - *Fictional analogues (full creative control)* — Atomic Cola, Sunset Sarsaparilla. Lower revenue, total aesthetic freedom; useful where real brands won't go.
    - **Hard rules for ad placement (preserve "respectful not predatory"):**
      - **Diegetic only** — ads appear *in the world* (billboards, holograms, signs, painted walls). Never UI overlays, pop-ups, mid-match interruptions, unskippable reels.
      - **Atmospheric not promotional** — ruined sign reads as post-Fall texture, not "this is sponsored."
      - **No interaction required** — players never engage with ads to progress. No watch-ad-for-resources. No bonus-for-clicking.
      - **Density caps** — per-map placement budget. Ruined cities have many; Lunar regolith has none (or maybe some — lore hook).
      - **Opt-out exists, free** — toggle "minimal ads" at no cost; some default scenery replaces brand assets. Most won't toggle; player trust preserved.
  - **Optional revenue layers (user to decide):**
    - **Cosmetic-only purchases** — standard F2P-cosmetic model. *Recommendation: skip entirely* given the "still mad" signal — even cosmetic differentiation can imply inequality. Pure-ads is cleanest commitment.
    - **Patronage / supporter tier** — voluntary donation (Patreon-style) with **zero in-game benefit**. Aligns with skill-not-wallet because patrons aren't *buying* anything; they're funding. Recommended.
    - **Ad-removal one-time purchase** — small one-off ("clean world" license) removes diegetic ad layer; no gameplay change. Some players pay to keep the world ad-free. Recommended.
  - **Default recommendation:** diegetic ads as core revenue + optional patronage + optional ad-removal. **No cosmetic purchases.** Cleanest F2P message: "we make money from the world's texture, not from selling you advantages or status. You and the player next to you are absolutely equal." Flagged to user for explicit yes/no before `monetization.md` is written.
  - **Doc impact:**
    - `DESIGN.md` — constitution grows to eight named principles: 1. Physics constitution / 2. Derived-stat discipline / 3. Every-high-power-has-a-weakness / 4. Invariance / 5. Endless scope / 6. Magic-is-unfamiliar-physics / 7. Community-is-the-long-game / 8. Skill-not-wallet.
    - `docs/matches.md` (Tier 4, new) — PvP toggle as participant property, sanctuary rules, commitment windows.
    - `docs/factions.md` (Tier 1 patch) — clan + alliance model nested under canonical factions.
    - **New: `docs/monetization.md`** (Tier 4 or 5) — ad-driven revenue, skill-not-wallet enforcement, brand-placement guidelines, diegetic-ad placement budget, opt-out mechanics, patronage layer.
    - `docs/world.md` (Tier 1 patch) — pre-Fall corporate signage as world texture; lore basis for diegetic ads.
    - `docs/ui-ux.md` (Tier 4) — PvP-toggle UI, faction/clan/alliance panels, diegetic-ad system at the rendering layer.
    - `docs/glossary.md` — add Sanctuary, Clan, Alliance, Diegetic Ad, Skill-not-wallet, Community Layer, Patronage Tier.
- **Infrastructure / network model — newly added in chat. Locks the "network-frugal by design" architecture and its cost ladder.**
  - **Core insight:** the architecture we've already designed (Schematic determinism + offline PvE + physics constitution invariance + match-as-world-state-instance) naturally minimizes network use. Lockstep PvP becomes possible because physics is deterministic. Solo PvE is zero-network because everything runs locally. Content syncs are JSON deltas because invariance is additive-only.
  - **Per-player network budget (designed-for, not measured):** ~100 MB / active player / month. Solo PvE = 0 during play. PvP match = 1–5 kbps (lockstep inputs only). Session-boundary sync = a few MB.
  - **Five server service classes (scale independently):**
    1. *Matchmaking + lockstep relay* — WebSocket/UDP, lightweight, ~$1–3K/month at 100K MAU.
    2. *Persistent world state* — PostgreSQL + S3-equivalent; ~10 MB / player; ~$1–3K/month at 100K MAU.
    3. *Content distribution (CDN)* — Schematic deltas, not packs; ~$500–2K/month at 100K MAU.
    4. *AI agent infrastructure* — production-time batch (negligible) + runtime hot inference (post-V1, the largest variable cost, $5–50K/month at scale). Mitigation: cache, cohort-share, throttle.
    5. *Analytics / observability* — standard SaaS, ~$500–2K/month.
  - **Networking topology — lockstep PvP + server-authoritative meta-state:**
    - In-match: clients exchange inputs only; each simulates locally; deterministic Schematics+physics guarantee identical outcomes.
    - Between matches: server-authoritative for persistent layer (Halls, library, achievements) — strong anti-cheat where it matters.
    - AI agents server-side; push generated content to relevant cohorts at session boundaries.
  - **Regional distribution:** Phase 1 = 2–3 regions (NA-east, EU-west, Asia); Phase 2 = 5–7 regions; Phase 3 = active-active for redundancy + data residency.
  - **Cost ladder:**
    - Closed beta 1K MAU: <$500/mo.
    - Soft launch 10K: $1–3K/mo.
    - Public launch 100K: $10–30K/mo.
    - Growth 1M: $50–150K/mo.
    - Mature 10M: $200K–1M/mo.
    - At 100K MAU, ad revenue ($0.50–$5 per MAU/mo) covers infra with comfortable margin.
  - **Specific design commitments that drive network use down (lock now, don't paint into corner):**
    1. All in-match state deterministically derivable from Schematics + inputs. Seeded PRNG; no uncoordinated randomness.
    2. Schematic deltas, not full packages. Per invariance: old Schematics never change → deltas are pure additions.
    3. Player-authored content syncs as Schematic JSON + recolor-class SVGs, not binaries.
    4. AI-generated content server-cached and cohort-distributed; generation cost amortized.
    5. Offline-first session model — most session work offline-capable; only real-time PvP needs connectivity.
    6. No always-on persistent connection; phone doesn't bleed background data.
    7. Bandwidth budget (~100 MB / player / month) is a design constraint, not a measurement.
  - **Doc impact:**
    - **New doc: `docs/infrastructure.md`** (Tier 5, or end of Tier 4). Owns client/server architecture, regional distribution, scaling tiers, cost model, bandwidth budgets, lockstep design, sync model.
    - `DESIGN.md` — short pillar-adjacent paragraph: **"Network-frugal by design."** Infrastructure choice flows from architecture choices already locked.
    - `docs/schematics.md` (Tier 2 patch — append): explicit determinism contract (seeded PRNG, no non-deterministic side effects, additive-only versions).
    - `docs/matches.md` (Tier 4) — explicit lockstep model + client/server trust boundaries.
    - `docs/glossary.md` — add Lockstep, Session Boundary Sync, Bandwidth Budget, Region, Determinism Contract.
- **Risks register + modular engine architecture — newly added in chat. Locks ninth constitution principle and the risk-management discipline.**
  - **Concerns register (new `docs/risks.md` — Tier 5 living document):**
    1. *Lockstep determinism is hard.* IEEE-754 floating-point drift across platforms desyncs identical simulations. Mitigation: fixed-point math layer for physics; deliberate implementation discipline; planned in Network-sync module so it can be swapped if needed.
    2. *Mobile performance vs physics ambition.* 200-unit realistic sim on mid-range phone at 30+fps is possible but not free. Mitigation: early performance budget; LOD physics; distance-based fidelity; prototype with realistic load before locking design.
    3. *Schematic format must be right from v1.* Invariance applies to format too. Mitigation: prototype ~12 realistic Schematics across all domains during design phase; freeze format before engine phase.
    4. *AI content quality risk.* Boring/repetitive/off-tone/lore-contradicting AI content sours communities fast. Mitigation: quality-gate agent + human review gate; standard is "genuinely good" not "validated"; ship-nothing-this-week is acceptable.
    5. *Onboarding for extremely deep game = single highest existential risk.* Six domains, eight (now nine) constitution principles, mobile-first, schematics-everywhere. Mitigation: dedicated tutorial/onboarding design pass; progressive complexity revelation; first session is one base / three units / one resource; unfold over many sessions.
    6. *Modder safety, both technical and policy.* Sandboxed equation evaluator with time/memory caps; PvP allows only signed/approved Schematics; offline play permits anything.
    7. *Storage scaling for accumulated content.* Tiered storage (hot active / cold archive); data-retention policy.
    8. *Bandwidth in poor markets.* Aggressive WiFi-only sync option; "data saver" mode; offline-first emphasized.
    9. *Battery drain on long sessions.* Early measurement; "low-power mode" with reduced simulation fidelity.
    10. *Localization at AI-generation scale.* Hybrid strategy (generate-then-translate + per-language for high-value content + runtime translation as fallback). Needs real plan before launch.
    11. *Brand-sales infrastructure is a business function.* Ad-network relationships, placement targeting, brand-safety controls; hiring problem when we get there.
    12. *Moderation cost.* Plan ~1 moderator per ~5K MAU in public-visible band as starting estimate.
    13. *Legal surface area is wide.* IP infringement on uploads; real-brand licensing; AI-content copyright/defamation; data-protection (GDPR/CCPA/COPPA). Lawyer review before public launch.
    14. *PvP fairness with hyper-optimized custom units.* Matchmaking by skill + average tech sophistication; stock-units-only brackets; salvage-driven catch-up vectors.
  - **New named principle: "Engine is a federation of modules, not a monolith" (ninth in the constitution).**
    - **Rule:** the engine is a small set of well-bounded modules communicating through stable interfaces. Bugs and pivots are local; rewrites are localized.
    - **Architectural insurance:** we don't know what won't work yet; we know something won't, and we want the cost of fixing it to be small.
  - **The eleven engine modules (each replaceable behind a stable interface):**
    1. *Schematic loader / validator* — JSON parsing, schema validation, reference resolution, versioning, hot-reload. Depends on nothing.
    2. *Equation evaluator* — runs formulas, sandboxed. Depends on Schematic loader + Constants.
    3. *Physics solver* — applies equation evaluator to models + environment; outputs trajectories, heat, motion.
    4. *Behavior runtime* — executes behavior trees; manages stances, targeting, formations.
    5. *World simulator* — the match loop; orchestrates tick (events → AI → physics → resolve → sync). Most central; expect most stable.
    6. *Event director* — schedules and fires world events; consumes catalog or runtime-agent decisions.
    7. *Network sync* — lockstep relay (in-match) + session-boundary sync. **Most important module to keep swappable** (lockstep→server-authoritative fallback path).
    8. *Persistence layer* — local save, server sync, Hall/library/achievements.
    9. *Rendering pipeline* — sim state → visuals, read-only consumer. Platform-specific (Unity/custom/web).
    10. *UI / input* — touch input, HUD, menus, Editor App. Platform-specific.
    11. *Agent runtime* (post-V1) — calls AI services, validates against constitution, deploys generated Schematics.
  - **Module-boundary rules:**
    1. Higher modules depend on lower; never reverse. Strict topological order.
    2. Modules talk only through declared interfaces.
    3. Each module has its own test suite; integration tests cover boundaries.
    4. Each module's implementation is swappable; multiple implementations behind one interface, selected by config.
    5. Inter-module data is read-only or copy-on-write.
    6. Modules version their interfaces; mirrors Schematic invariance at the code level.
  - **What this protects us from (concrete pivot scenarios):**
    - Lockstep fails on mobile → swap Network sync to server-authoritative deltas; physics/AI/sim untouched.
    - Unity turns out wrong → swap Rendering; sim is pure compute, no Unity dep.
    - AI agents too expensive → swap Agent runtime to production-only mode.
    - JSON parsing too slow → swap Schematic loader to binary format; everything above unchanged.
    - Behavior trees wrong representation → swap Behavior runtime to utility-AI or GOAP.
    - Equation evaluator can't meet perf → swap to compiled-graph at load time.
  - **Doc impact:**
    - `DESIGN.md` — ninth named principle: **Engine is a federation of modules**. Constitution now: 1. Physics constitution / 2. Derived-stat discipline / 3. Every-high-power-has-a-weakness / 4. Invariance / 5. Endless scope / 6. Magic-is-unfamiliar-physics / 7. Community-is-the-long-game / 8. Skill-not-wallet / 9. Engine-is-a-federation-of-modules.
    - **New doc: `docs/engine-architecture.md`** (Tier 5, or merged with infrastructure.md) — the eleven modules, responsibilities, interfaces, dependency rules.
    - **New doc: `docs/risks.md`** (Tier 5, living document) — full risk register; each risk has name, severity, mitigation, owner, status; updated as risks resolve or emerge.
    - `docs/schematics.md` (Tier 2 patch — append): note Schematic loader is a discrete module with stable interface.
    - `docs/infrastructure.md` (Tier 5) — references module boundaries as basis for service-class scaling.
    - `docs/glossary.md` — add Module, Module Interface, Module Boundary, Engine Federation.
- **Phased shipping (V1 PvE → V2 PvP → V3 Living World) — newly added in chat. Locks the phasing rule and the V1 scope.**
  - **New named principle (tenth entry): "Build for now; design for later. Every V1 system ships with a documented extension seam for its V2/V3 capabilities."** Also stated as: **Phased shipping with named seams.** The architecture is full-fidelity from day one; only the deployed surface area is reduced.
  - **V1 scope (PvE-only):**
    - Solo PvE campaign (Phase 1: Salvage Era / Earth).
    - Persistent base (single, per player).
    - Editor App (full unit creation).
    - Offline-PvE pressure / Natural Enemy.
    - Three-layer tech progression.
    - Hall of Conquered (PvE flags only).
    - Salvage Signature (vs AI factions).
    - Cosmetic identity (badges, flags, palettes — local + cloud backup).
    - Achievements (PvE subset).
    - Commander persistence + cloud backup.
    - Canonical factions (the four).
    - Diegetic ads (revenue starts here).
    - **Recommended for V1 (subject to user yes/no): async design sharing** — players upload Editor-App units; others download for offline use. Cheap (CDN-only), seeds community pre-PvP, validates cross-player content pipeline before V2.
  - **V2 scope (add to V1):** lockstep PvP, real-time matchmaking, cross-player Hall captures, cross-player Salvage Signature propagation, live clans/alliances, Phase 2 content (Lunar / Ashen Eye).
  - **V3 scope (add to V2):** AI runtime narrative agents (Living World), living-world global state, Phase 3+ content (Reach, Constellation).
  - **Extension seams (V1 elements that keep V2/V3 from being rewrites):**
    - *Lockstep PvP* → V1 Network Sync module has `local-only` implementation; V2 swaps to lockstep relay; World Sim unchanged.
    - *Matchmaking* → V1 fills participant-roster with AI; V2 fills empty slots with humans; Match model unchanged.
    - *Cross-player content* → V1 Schematic Loader handles any Schematic, loads only local; V2 loads from shared library; loader unchanged.
    - *Clans / alliances* → V1 leaves `parent_faction` null in Faction Schematic; V2 populates.
    - *Runtime AI agents* → V1 Event Director's `external_director` interface is "catalog-only"; V3 swaps to "catalog-or-agent."
    - *Living-world state* → V1 Server Persistence has unimplemented `aggregation` hook; V3 adds service.
    - *PvP Hall captures* → V1 Hall record format already has opponent-Commander metadata fields; V2 adds player defeats using same format.
    - *PvP-toggle sanctuary* → V1 Match has `pvp_open: bool` per Commander, hardcoded true (no PvP exists); V2 honors flag.
    - *Phase 2/3 content* → New environments + new equations + new chassis are pure content; engine handles without modification (the whole reason for the physics constitution).
    - *Real-brand ads* → V1 ships ad-content Schematic format using fictional analogues; V2 adds real-brand pipeline behind same interface.
  - **V1 infrastructure (10K MAU): ~$1–2K/month.** CDN ($200–500) + account/backup ($300–800) + crash/analytics ($200–500) + ad delivery ($200–500). No matchmaking, no relays, no multiplayer state, no AI inference servers, no multi-region. Ad revenue at 10K MAU yields $5–50K/month → V1 is comfortably profitable before V2 investment.
  - **V2 incremental cost:** ~$5–15K/month at 50K MAU (matchmaking + relay + meta-state). Funded by V1 revenue.
  - **V3 incremental cost:** ~$5–50K/month depending on agent use; mitigated by cache/cohort-share/throttle.
  - **Open question to confirm with user before writing `docs/phasing.md`:**
    - Async design sharing in V1: yes or no? **Recommendation: yes** — shallowest social feature, near-zero cost, seeds community pre-PvP, validates cross-player content pipeline. Failure mode if no: Editor App produces designs only the author can use; engagement with Editor stays low until V2; delays community formation.
  - **Doc impact:**
    - `DESIGN.md` — tenth named entry: **Phased shipping with named seams.** Distinct from the nine principles (it's a delivery rule, not a design tenet, but lives in the constitution alongside them).
    - **New doc: `docs/phasing.md`** (Tier 5) — V1/V2/V3 scope, the seams matrix, cost ladder, expected progression timing. Living document.
    - `docs/prototype-scope.md` (Tier 4) — re-anchored as the V1 specification specifically; not a temporary prototype but the actual V1 ship.
    - `docs/matches.md` (Tier 4) — explicit: V1 implementation has roster-of-AI + player; multiplayer is V2.
    - `docs/multiplayer.md` (Tier 4) — V2 architecture spec, not V1 feature work.
    - `docs/infrastructure.md` (Tier 5) — V1 vs V2 vs V3 infrastructure tiers explicit.
    - `docs/engine-architecture.md` (Tier 5) — module-by-module V1 implementation vs V2/V3 swap path documented.
    - `docs/glossary.md` — add V1 / V2 / V3 (with what each ships), Extension Seam, Async Design Sharing, Phased Shipping.
- **Creator marketplace + monetization-principle refinement — newly added in chat. Refines the eighth constitution principle.**
  - **The tension surfaced by user:** original "Skill, not wallet" principle (eighth) was reactive to a past P2W trauma. Real trauma was the *combination* of forced PvP + wealth-asymmetric PvP + lost-progress. We've already eliminated forced PvP (toggle + sanctuary) and lost-progress (invariance rule). Money-in-the-game alone doesn't reconstruct that trauma if the other safeguards hold.
  - **Refined eighth principle:** **"Money buys creativity or time, never power."** Players sell creative work to other players; platform takes small fee. No purchasable advantage exists that a self-built or earned alternative cannot match. All competitive surfaces have stock-only modes. Time and money interchangeable. No FOMO. No limited-time exclusives. Marketplace gates behind verified adulthood.
  - **Marketplace model — creator economy, not company store:**
    - Players sell Editor-App-built unit designs to other players.
    - Pricing: $0.25 single unit / $1.00 pack of 5 / $1.00 premium experimental.
    - Platform fee: ~$0.02 per $0.25 unit = 8%. Creator-generous (vs Roblox 75%, Steam 30%, Apple/Google 30%). Closer to Stripe pure-payment processing than to content-store.
    - Revenue ladder: 100K MAU × 10% engagement × 5 units/year = ~$25K/year; 1M MAU same ratios = ~$250K/year; 10M MAU = ~$2.5M/year.
    - Marketplace is *additive* to diegetic ads, not replacing them.
  - **Ten hard safeguards (architectural rules, not soft promises):**
    1. Every purchasable design has free competitive counterparts. No paid-only strategic options.
    2. Every purchasable design is earnable through play (Scientist salvage + achievement-unlock paths). Time substitutes for money everywhere. Target equivalence: 5–20 hours per design.
    3. Stock-only PvP brackets as first-class modes. "Pure skill" competition lives there. No purchased content allowed.
    4. Per-match design cap (proposed range 8–12). Buying 100 designs grows library not in-match toolbox.
    5. No FOMO mechanics, ever. No limited-time, no daily-deal pressure. Evergreen designs.
    6. Marketplace defaults off until verified adulthood. V1 ships opt-in for verified-adult accounts. Minors play full game without marketplace exposure.
    7. Quality gates apply to submissions (same constitution validation as modders). No physics violations. No degenerate strategies. Curation removes meta-warping designs.
    8. Purchased designs salvageable in-match (per Scientist), but salvaged variants degraded + carry original creator attribution. Purchase = full fidelity + attribution. Salvage = working variant + still attribution. Both paths preserve creator credit.
    9. Refunds exist. Window (e.g., 14 days unless used in N matches). Treat creators and buyers as commercial parties.
    10. Transparency. Every purchased design displays: creator name + signature, creation date, sales count, rating, "playtime equivalent" alternate earn path.
  - **Two parameters to dial in `docs/monetization.md`:**
    - Per-match unit-design cap (proposed 8–12; pending playtest)
    - Earn-path time equivalence per design (proposed 5–20h range; pending playtest)
  - **Doc impact:**
    - `DESIGN.md` — eighth principle refined to **"Money buys creativity or time, never power"** with the ten safeguards summarized.
    - `docs/monetization.md` (Tier 4/5) — now owns: ad revenue model + creator marketplace model + ten safeguards + per-match cap + earn-path parameters.
    - `docs/units.md` (Tier 3) — Editor App outputs can be marked "marketplace-listable" (creator opt-in); attribution attaches to Schematic.
    - `docs/tech.md` (Tier 3) — Salvage Signature interaction with purchased designs (salvage works as before, attribution survives, variants degraded).
    - `docs/matches.md` (Tier 4) — stock-only PvP bracket as first-class match-type.
    - `docs/phasing.md` (Tier 5) — marketplace launchable in V1+ (early V1 once safeguards implemented). Async design sharing (V1) launches free-only initially; paid marketplace activates when safeguard infrastructure ready.
    - `docs/glossary.md` — add Marketplace Design, Creator Fee, Stock-Only Bracket, Earn-Path Equivalent, Verified-Adult Account, Creator Economy.
- **Age of Origins anti-pattern lock — user provided the canonical example to design against.**
  - **User's actual prior trauma was Age of Origins** ($5–100 packs, mobile strategy MMO). The prices were the *output* of an exploitative pattern stack, not the cause. The patterns drove the prices because they manufactured the desperation that justified them.
  - **Twelve forbidden mechanics (named anti-patterns from Age of Origins / similar games — we will not implement these even under commercial pressure):**
    1. No time-skip currency. Progress always play-based. No paid acceleration of construction/research/healing/training waits.
    2. No resource purchases. No "buy 1000 gold" / "buy 50 Tech Fragments." Resources earned in-game.
    3. No subscription tiers. No VIP recurring spend.
    4. No price ladders / pack escalations. Single small price per item. No "bigger pack, more saving."
    5. No FOMO / limited-time exclusives. All marketplace content evergreen.
    6. No lootboxes / random-result purchases.
    7. No manufactured scarcity. Infinite supply of all designs.
    8. No spending milestones / VIP rewards.
    9. No pay-to-resurrect / pay-to-protect.
    10. No paid advantage in matchmaking.
    11. No advertising of purchase as path to victory. Marketing emphasizes creator economy.
    12. No spending-based ranks / leaderboards.
  - **Refined eighth principle (final form for `DESIGN.md`):**
    > **8. Money buys creativity or time, never power.** Players sell creative work to other players; platform takes a small fee. Every purchasable design has free counterparts and earn-paths. All competitive surfaces have stock-only modes. Marketplace gates behind verified adulthood. **Forbidden mechanics:** time-skip currency, resource purchases, subscriptions, price ladders, FOMO, lootboxes, manufactured scarcity, spending milestones, pay-to-resurrect/protect, paid matchmaking advantage, spending-based leaderboards. Marketing emphasizes creator economy, not pay-to-win.
  - **Why this matters architecturally:** the principle's strength isn't forbidding money; it's forbidding *the patterns that turn money into desperation*. With these mechanics structurally absent, no commercial pressure can recreate the Age-of-Origins pattern even if someone wanted to. **Our 25¢ pricing isn't just "cheaper than Age of Origins" — it's structurally incapable of becoming Age of Origins because none of the desperation-manufacturing mechanics exist.**
  - **Doc impact:**
    - `DESIGN.md` — eighth principle's final form includes the forbidden mechanics list.
    - `docs/monetization.md` (Tier 4/5) — "Forbidden Mechanics" section with full enumeration; framed as commitments to the player, not internal preferences.
    - `docs/glossary.md` — add Forbidden Mechanics, Time-Skip Currency, Manufactured Scarcity, Pattern Stack (as anti-pattern reference).
- **Premium model reversal — newly added in chat. F2P → free demo + $2.99 paid game.**
  - **User self-corrected:** "when I said play for free, I spoke before I thought." Revised model: free demo (1-2 PvE skirmishes that must hook) + $2.99 one-time purchase unlocks full PvE game. V2 PvP and V3 Living World ship as **free upgrades to V1 buyers** (not separate SKUs).
  - **Does not break Principle 8.** Buying the game is buying *access*, not *power*. Every buyer plays by the same rules. Structurally identical to buying Settlers of Catan or a console game — the oldest, most-respected revenue model in gaming. If anything *more* protective than F2P: no tier disparity, no whale/minnow stratification, everyone equal once inside.
  - **The $2.99 is a commitment mechanism, not just revenue.** Endowment effect activates: paid players engage longer, tolerate small issues, recommend to friends, form communities. The studio earns a direct relationship with each buyer + a clear obligation to ship future content. **V2 PvP / V3 Living World ship into an *invested* base, not into an attrition curve.** This is the foundation of the V2/V3 investment case — each phase ships into a community ready for it.
  - **Why $2.99 specifically:** any payment threshold triggers the endowment effect (payment is psychologically binary). $2.99 maximizes conversion (impulse-buy zone) while still being a payment. Below $1 feels "junk app"; above $5 needs more justification at the demo stage.
  - **Revised hook design (most marketing-critical content in the project):** 1-2 demo skirmishes that land the core loop (terrain, physics, units), hint at depth (Editor App, Hall), tell a piece of the story (the Fall, the player's awakening), end on want (cliffhanger toward the larger world). Deserves its own design pass + doc (`docs/demo.md`). Conversion target: 30% S1 completion × 50% S2 completion × 30% buy = ~4.5% demo-to-buy.
  - **Final monetization model (user clarified: ads are the bread-and-butter, not demo-only):**
    - **Stream 1: Premium one-time purchase ($2.99)** — entry fee + commitment mechanism. One-time per buyer. ~$94K per million demos at target conversion. Drives the initial relationship.
    - **Stream 2: Diegetic in-world ads — bread-and-butter ongoing revenue.** Active in BOTH demo and paid game. Scales with MAU, not new acquisitions. Conservative projection $1.50/MAU/month: $150K/month at 100K MAU; $1.5M/month at 1M MAU. **This is the engine that funds V2 PvP development and V3 Living World infrastructure.** Each phase ships into a revenue base that covers next-phase costs many times over.
    - **Stream 3: Creator marketplace (V2+, ~8% platform fee).** Secondary. Scales with engagement: $25K/year at 100K MAU; $360K/year at 1M MAU; $4.8M+ at 10M.
    - **Stream 4: Optional patronage (V2+).** Voluntary; modest. ~1-3% of MAU at $3-10/month.
    - All twelve forbidden mechanics still apply unchanged.
  - **Why ads work in the paid game:** they're diegetic — world texture, not interruption. A faded Coke billboard on a ruined highway IS the post-apocalyptic aesthetic. Removing them would make the world feel less real. They serve double duty: aesthetic for player + revenue from advertiser. Unlike F2P ad mechanics that extract value from players (interruptions, rewarded video), these ads exist *in* the world and players never have to engage with them.
  - **Optional ad-removal purchase ($2-5)** as a clean-world license for ad-averse players. Doesn't change game; doesn't violate forbidden mechanics. Provides revenue from ad-averse segment.
  - **Infrastructure:** V1 ~$0.7-2K/mo at 10K MAU (slightly higher than the no-ads version due to ad-serving CDN, still very low). V2 ~$10-30K/mo at 100K MAU. V3 ~$50-150K/mo at 1M MAU. At every phase, ad revenue alone covers next-phase infrastructure many times over.
  - **The bootstrap economics:** V1 sales fund V1 ops + V2 dev. V2 ad revenue funds V2 ops + V3 dev. V3 ad revenue funds V3 ops + ongoing development. **External investment, if taken, accelerates timelines rather than enables them.**
  - **Docs written this turn:**
    - **`docs/monetization.md`** (new, comprehensive internal doc) — full revenue model, ad-serving infrastructure, brand-sales operations, marketplace economics with ten safeguards, twelve forbidden mechanics with explicit rationale, revenue projections by phase, open questions.
    - `pitch/PITCH.md` (updated) — executive summary, Stream 2 framing, phased rollout table reflect the ongoing-ads model.
  - **Doc impact still pending:**
    - `DESIGN.md` — Principle 8 wording unchanged; needs the forbidden mechanics list added explicitly (currently in plan file only).
    - `docs/roadmap.md` — M5 already updated; revenue projections in other milestones reflect new model approximately but could be refined.
    - `docs/glossary.md` — add Bread-and-Butter Revenue, Commitment Mechanism, Diegetic Ad (formal definition), Ad-Removal License.
  - **Doc impact:**
    - `pitch/PITCH.md` — **updated this turn**: executive summary, revenue model, phased rollout table reflect the new premium model.
    - `docs/monetization.md` (future) — fully written against the new model when authored. Forbidden-mechanics list unchanged.
    - `DESIGN.md` Principle 8 — wording unchanged; surrounding business context shifts.
    - `docs/roadmap.md` — M5 launches as paid game; revenue thresholds reflect sales-based model. **Needs small update.**
    - **New doc: `docs/demo.md`** — owns the 1-2 skirmish hook design with conversion targets and beat-by-beat structure. Probably a late-V1 milestone deliverable.
    - `docs/glossary.md` — add Free Demo, Premium One-Time Purchase, Commitment Mechanism.
- `tech.md`: Scientist salvage probability table; degradation rules for the "variant" copy (which properties degrade, by how much); whether multiple salvages stack into a cleaner copy.
- `events.md`: Natural Enemy presentation — fifth faction visual vs nameless environmental.
- `campaign.md`: enclave karma formal model (already an existing OPEN); Phase 4 Constellation co-op planet-tending (already an existing OPEN).

## Verification

Tier 3 is complete when:

1. All 6 new docs exist on `claude/mobile-rts-game-concept-7LbT0` and are linked from `DESIGN.md`'s Tier-3 navigation block.
2. `docs/glossary.md` contains every proper noun introduced in the new docs (Scientist, Voxel Chassis, Salvageable Debris, Tech Copy, plus any new event/elite/karma terms).
3. `DESIGN.md` and `CLAUDE.md` no longer list the three resolved questions in their open-questions sections.
4. Every new doc has the standard header (TL;DR / Scope / Prerequisites / Open questions / Cross-references).
5. Cross-doc references all use relative paths (`docs/foo.md`) — quick grep check before push.
6. Branch is pushed; PR #2 visible with Tier 3 commits as a clear checkpoint for review.

When these hold, Tier 4 (ui-ux, offline-pve, multiplayer stub, prototype-scope) is unblocked.
