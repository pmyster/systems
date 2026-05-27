# Editor App

## TL;DR

- A separate companion application for designing units. Outputs JSON Schematics the game engine loads.
- **Hybrid model:** voxel chassis sculpting + hardpoint-snapped functional parts.
- Target platform for the full app: desktop/tablet (creative tool, not phone).
- A **browser-based prototype editor** ships now (`tools/editor/index.html`) for early unit authoring while the full app is built. Form-based for now; voxel sculpting comes later.

## Scope

This document owns:
- The Editor App's vision and design
- The hybrid voxel-chassis + hardpoint-parts model
- The current prototype editor's scope and workflow
- The phased path from prototype to full app
- The Schematic format the editor produces (formal schemas live in `schemas/`)

It does NOT own:
- The game engine's Schematic loader (that's `docs/architecture.md`)
- The marketplace (that's `docs/monetization.md`)
- The full physics equation catalog (that's `docs/physics.md`)

## Prerequisites

- [DESIGN.md](../DESIGN.md) — the constitutional principles, especially Derived-stat discipline and Money-buys-creativity
- [docs/architecture.md](architecture.md) — the engine's relationship to Schematic content
- [docs/schematics.md](schematics.md) — the Schematic format spec
- [docs/physics.md](physics.md) — the formula catalog that derives stats from physical inputs
- [docs/units.md](units.md) — unit composition rules (when written)
- [schemas/unit.schema.json](../schemas/unit.schema.json) — the formal JSON schema
- [schemas/part.schema.json](../schemas/part.schema.json) — the formal JSON schema for parts

---

## The full Editor App vision

The locked design decision: **hybrid voxel-chassis + hardpoint-snapped parts.**

### Voxel chassis

Players sculpt the *body* of a unit cell by cell. The voxel volume contributes:
- **Visual identity** — silhouette, hand-built feel, the player's design language.
- **Mass** (derived from voxel count × material density).
- **Armor distribution** (per-region thickness).
- **Compatibility tags** (e.g., a hull built with closed-cell voxels qualifies as `vacuum_rated`).
- **Hardpoint placement** — players place hardpoints on their voxel chassis at specific positions.

### Hardpoint-snapped parts

Functional pieces (weapons, sensors, engines, utility modules) mount on engine-defined hardpoints. Each part is itself a Schematic with declared physical properties. The Editor App provides:
- A part library (stock parts + community-created parts when marketplace is live)
- A drag-and-drop interface to attach parts to hardpoints
- Live validation: does this part fit this hardpoint? Does the unit have enough power for all parts running simultaneously?
- Derived-stat preview: as the player adjusts inputs, the engine's formulas compute speed, range, cooldown, etc., and display them live.

### Cross-platform output

The Editor App produces a single JSON file per unit. The same JSON is:
- Loaded by the game engine to build the unit
- Validated by the marketplace before listing
- Shared via the async-design-sharing library
- Salvaged in-match by Scientist units (with the original designer's signature preserved)

### Modder safety

The Editor App is the modder seam. Players who can make a unit can extend the game. The constitution enforces:
- No bare gameplay numbers (only physical inputs)
- Validation against schema at upload
- Equations limited to the additive catalog (per Invariance rule)
- Constitution checks before any unit can enter PvP

---

## The current prototype editor

The full Editor App is a substantial application. While it's being built, players need a way to start authoring units — for the user (project owner) to begin sketching the unit roster, and for early testers to start experimenting.

**The prototype lives at `tools/editor/index.html`** as a single static HTML file. It runs in any modern browser. No installation. No server.

### What the prototype does

- **Form-based unit authoring.** All chassis attributes and part attributes are typed into form fields.
- **Live JSON preview.** The unit Schematic is rendered in real time as you edit. Copy-paste or save to disk.
- **Live derived-stat preview.** Speed, range, weapon cooldown, total power draw, etc. — all derived from your inputs using simplified versions of the engine's equations.
- **Multiple parts per unit.** Add weapons, sensors, defense, utility, communications, mobility-aux. Each in its own form section.
- **Save / Load JSON.** Save your unit to a local file; load it back later. Files are standard JSON conforming to `schemas/unit.schema.json`.
- **Starter units to fork.** `units/starter/` contains pre-made units you can load and modify.

### What the prototype does NOT do (yet)

- **No voxel sculpting.** The chassis is described by attributes (mass, engine, armor), not sculpted. The voxel data field is left blank in the JSON; the full Editor App will populate it later.
- **No visual rendering.** The prototype doesn't show what your unit looks like. It shows what it *does*.
- **No salvage signature workflow.** The `designer` field is manual.
- **No marketplace integration.** The prototype is local-only.
- **No physics simulation.** The derived stats are illustrative; the actual game engine will compute them more precisely.

### Workflow

1. Open `tools/editor/index.html` in a browser.
2. Choose to start fresh (New) or load a starter unit (Load → pick a JSON file from `units/starter/`).
3. Edit chassis attributes. Watch the derived stats update.
4. Add parts. Adjust their attributes. The JSON preview updates live.
5. When the unit is ready, click Save and download the JSON file.
6. Place the file in your local content directory or share it with collaborators.

### Iteration plan

| Phase | Editor capability | Status |
|---|---|---|
| Prototype | Form-based authoring, live JSON, live derived stats | **Shipped now** |
| Alpha | Add part library (browse and add stock parts) | Future |
| Beta | Add voxel chassis sculpting | Future |
| V1 | Full Editor App with hardpoint placement on voxel chassis | Tied to V1 launch |
| V2 | Marketplace integration (publish, browse, buy) | V2 launch |

The prototype's JSON format will evolve into the full app's format. Files created in the prototype today will load in the full app later (per the Invariance rule — old content always works).

---

## Format notes for unit authors

When writing unit Schematics by hand or with the prototype editor, a few principles:

### Physical inputs only

Do not type speed, range, damage, or cooldown directly. Type:
- `mass_kg` (kilograms)
- `engine_kW` (kilowatts)
- `drivetrain_efficiency` (0-1)
- `fuel_capacity_MJ` (megajoules)
- `fuel_consumption_rate_MJs` (megajoules per second at full power)
- `propellant_energy_MJ` per weapon shot
- `projectile_mass_kg` per weapon
- `barrel_thermal_capacity_MJ` per weapon
- `per_shot_heat_MJ` per weapon
- `cooling_rate_MJs` per weapon

The engine derives the gameplay numbers from these.

### Realistic-ish scale

Approximate scales that produce reasonable gameplay numbers:

| Concept | Typical range |
|---|---|
| Light scout vehicle mass | 2,000 - 8,000 kg |
| Medium tank mass | 20,000 - 50,000 kg |
| Heavy walker mass | 80,000 - 200,000 kg |
| Engine for medium tank | 400 - 1,000 kW |
| Light autocannon propellant energy | 0.1 - 1 MJ per shot |
| Heavy cannon propellant energy | 5 - 50 MJ per shot |
| Light projectile mass | 0.05 - 0.5 kg |
| Heavy projectile mass | 5 - 50 kg |
| Light weapon thermal capacity | 10 - 50 MJ |
| Heavy weapon thermal capacity | 200 - 2000 MJ |

These are illustrative; real values depend on what's interesting for the design. The starter units in `units/starter/` give working examples across the range.

### Use real units (SI)

The constitution mandates SI units (kg, m, s, MJ, kW). Do not invent unit systems. The engine's equations operate in SI.

### Salvage Signature

Always include a `designer` field. For stock units this is `STARTER_KIT`. For player-authored units this is the player's call-sign or chosen designer name. The signature carries forward through every derivative or salvaged copy.

### Physics version

Always include `physics_version`. For the prototype today, use `"1.0"`. The invariance rule means a unit authored against version 1.0 will work forever, even when the engine moves to 1.1, 1.2, 2.0.

---

## Open questions

- OPEN[2026-05-27]: voxel grid resolution and per-unit voxel budget for mobile-rendering. blocks: full Editor App.
- OPEN[2026-05-27]: hardpoint placement rules — fully free (any voxel face) or grid-constrained? blocks: full Editor App design.
- OPEN[2026-05-27]: stock part library — how many parts at V1 launch, and authored by whom? blocks: V1 content plan.
- OPEN[2026-05-27]: paint kit interaction with voxel chassis — does the player paint per-voxel or per-region? blocks: cosmetic identity layer.

## Cross-references

- [docs/units.md](units.md) — full unit composition rules (when written)
- [docs/schematics.md](schematics.md) — Schematic format spec
- [docs/physics.md](physics.md) — formula catalog
- [docs/architecture.md](architecture.md) — engine architecture (Module 1: Schematic Loader)
- [docs/monetization.md](monetization.md) — marketplace and creator economy
- [tools/editor/index.html](../tools/editor/index.html) — the prototype editor
- [schemas/unit.schema.json](../schemas/unit.schema.json) — formal Unit schema
- [schemas/part.schema.json](../schemas/part.schema.json) — formal Part schema
- [units/starter/](../units/starter/) — starter unit JSONs
