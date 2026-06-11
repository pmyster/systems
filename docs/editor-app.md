# Editor App

## TL;DR

- A standalone creative platform for designing units, characters, and vehicles. Outputs JSON Schematics any game engine with the matching plugin can load.
- **Mesh-first workflow:** players import, generate, or pick a mesh → auto-fill physics voxel interior → paint material zones with a free-color image → rig moving parts → define effects → export.
- **Four-layer unit architecture:** Mesh (visual) → Rig (motion) → Effect layer (beams, shields) → Physics substrate (hidden voxels).
- **Three creation tiers:** Express (5 min, anyone), Craft (30 min, engaged player), Architect (hours, creator/modder).
- **Multi-game plugin architecture:** the core tool is game-agnostic; each game ships a schema plugin. Child of Light is the first plugin.
- Target platform: desktop/tablet. Deep creative tool with no UI compromises.

## Scope

This document owns:
- The Editor App's vision and design
- The mesh-first creation pipeline and four-layer unit architecture
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

### Five design principles

1. **Assembly first, sculpting second.** Start with templates and pre-built parts. Snap them together. See the unit in the battlefield preview immediately. Advanced users go deeper — nobody is forced to model from scratch.
2. **AI handles the hard part.** Type a prompt or drop a photo. The tool generates the mesh, auto-voxelizes the interior, and proposes material zones. The player reviews and refines — they don't build from nothing.
3. **Real-time feedback always.** Every change — voxel fill, material zone, part snap, turret arc — reflects instantly in the battlefield preview. The player never wonders "what does this look like in-game?"
4. **Speed is a feature.** A complete, usable unit in under 5 minutes for a new user. If it takes longer, the tool has failed. Templates, smart defaults, and AI generation exist specifically to hit that bar.
5. **Plugin schema for multiple games.** The core tool is game-agnostic. Schema plugins make it work for any engine.

---

### The four-layer unit architecture

```
Mesh        — visual surface (what players and the game see)
Rig         — moving parts: pivot points, axes, constraint arcs, animation states
Effect layer — beams, shields, translucent fields, cluster munition trees
Physics substrate — hidden voxel grid; auto-filled from mesh interior; drives all derived stats
```

Every layer is optional. A simple ground vehicle uses Mesh + Physics substrate only. A laser cruiser with a rotating shield and a cluster missile launcher uses all four.

---

### Layer 1: Mesh

**Three acquisition sources — all supported:**
1. **Pre-built library** — the game ships templates (tank chassis, mech torso, naval hull, flyer body, walker leg, etc.) Players pick and customize.
2. **Player import** — OBJ, GLB, FBX. Any mesh the player creates or downloads.
3. **AI generation** — text prompt ("heavy tracked assault unit with sloped front armor") or photo input. The tool generates a mesh via AI, previews it, and the player accepts or regenerates.

After acquisition, one button auto-voxelizes the mesh interior into the physics substrate. The mesh remains the visual surface; the voxels are hidden.

---

### Layer 2: Rig (moving parts)

Three motion tiers:

**Passive** — automatic. Wheels spin, tracks cycle, suspension compresses. Derived from chassis class and physics simulation. No authoring required.

**Reactive** — player-defined pivot and constraint. In the editor, clicking a part and designating it as reactive shows:
- A rotation axis visualizer
- Two handles to drag the constraint arc (yaw: left-right sweep; pitch: elevation min/max)
- A live fan/cone showing the sweep range in the preview pane

Examples and their tactical implications:

| Constraint | Design | Implication |
|---|---|---|
| Yaw ±180° | Full-rotation turret | Can engage any direction; slow to rotate |
| Yaw ±60° | Forward arc cannon | Must face the enemy — flankable |
| Yaw ±150° rear | Anti-missile system | Protects rear, blind in front |
| Pitch 45°–80° fixed | Mortar | Arc fire only; cannot engage close targets |
| Pitch 0°–15° | Sniper cannon | Flat trajectory; long range; can't arc |

**Recoil is derived, never authored.** Recoil force = shell mass × muzzle velocity. The physics solver computes platform destabilization automatically from the projectile Schematic. A unit firing its heaviest gun while turning has degraded accuracy. No extra design work required.

**Active** — animation state machine. Player defines states (idle, charging, firing, reloading, open, closed) and the engine triggers transitions. Fire sequences support single shot, salvo, and alternating barrel. Missile launchers define: launch hardpoints (click to place on mesh), linked projectile Schematic, and fire sequence.

---

### Layer 3: Effect layer

**Projectiles — all are Schematics.** Shells, missiles, grenades, and beams each have a JSON Schematic declaring physical inputs. The engine derives kinetic energy, penetration depth, blast radius, and heat signature. No bare gameplay numbers at any level.

**Cluster munitions** use a parent-child Schematic tree:
```
Parent missile
  ├── Flight path
  ├── Split trigger (altitude / proximity / timer)
  ├── Spread pattern (angle, fragment count, direction bias)
  └── Child Schematic (the fragment — lighter, simpler)
        └── Can itself have a split event (recursive)
```
Parent mass = casing + (N × child mass). Children inherit parent velocity then add their spread vector.

**Lasers** are continuous energy-delivery weapons. Physics: power draw (watts) → damage rate (heat per second to target). Beam width determines focus — narrow punches through armor, wide heats surface area. Heat generated in the firing unit is significant (Principle 3: high power, real cost). Range falls off with atmospheric dispersion.

**Shields** are translucent mesh layers with independent physics:
- Energy capacity (HP pool) + power draw (regeneration rate)
- Three shapes: sphere (360°), directional (half-dome, cheaper), conformal (follows unit mesh)
- Visual: Fresnel shader — nearly transparent face-on, opaque at edges, ripple on impact

**Rendering by effect type:**

| Effect | Rendering technique |
|---|---|
| Shields, forcefields | Alpha blend + Fresnel shader |
| Lasers, plasma beams | Additive blending (adds light, never occludes) |
| Glows, engine exhausts | Additive + bloom post-process |

---

### Layer 4: Physics substrate

The hidden voxel grid auto-generated from the mesh interior. Each voxel cell has a material type assigned from the material authoring step. The engine derives all physical stats from cell composition:

- **Mass** = sum of (voxel count × material density) per region
- **Armor distribution** = material type and thickness per surface region
- **Thermal capacity** = sum of material thermal properties
- **Hardpoint positions** = cells marked during rig authoring

The player sees none of this directly. The derived stats panel in the editor shows the outputs live. Writing derived numbers into the Schematic is not permitted (Principle 2).

---

### Material authoring — free-color image overlay

Player paints or photographs a colored image and projects it onto the mesh surface:
1. Import any image (hand-drawn sketch, photo, digital paint)
2. The editor projects it onto the mesh (box projection or UV-fit)
3. AI segments the image into color regions and infers material zones: dark grey → Hull, dark red → Heavy Armor, orange → Fuel Tank, bright blue → Energy System, yellow → Thermal Shielding
4. The inferred zones appear as a color-coded overlay on the mesh
5. Player taps any zone and corrects the assignment if the inference was wrong
6. Confirm — the voxel substrate is re-materialized from the zone map

The image serves two purposes simultaneously: it is the visual texture (the skin) and the physics material map. One authoring step, two outputs.

---

### Multi-game plugin architecture

The core tool is game-agnostic. A schema plugin is a small JSON + code bundle that defines:
- Which physical properties the game engine cares about (Child of Light: mass, thermal capacity, armor; another game might care about different properties)
- What export format the engine expects (Schematic JSON schema, binary, etc.)
- What asset references the renderer needs (mesh path, material atlas, rig skeleton)

Child of Light ships the first plugin. Future projects publish new plugins without modifying the core tool. A player who designs units for Child of Light can switch the active plugin and export the same unit — reskinned and re-schematized — for a different game.

---

### Three-tier creation progression

| Tier | Time | Who | Workflow |
|---|---|---|---|
| **Express** | 5 min | Anyone | Pick template → AI style from text or photo → auto-fill → export |
| **Craft** | 30 min | Engaged player | Import or generate mesh → material paint → part assembly → rig turrets → physics tune → export |
| **Architect** | Hours | Creator / modder | Full mesh authoring → custom parts → effect definition → fine physics → hardpoint declaration → multi-format export |

No player is pushed up a tier. No capability is locked behind a tier. Express users who grow curious discover Craft naturally. The exit ramps are visible and celebrated.

---

### Cross-platform output

The editor produces a unit package: a JSON Schematic (physics + part definitions + rig declarations) + a mesh asset reference + an optional material image. The same package is:
- Loaded by the game engine to build and simulate the unit
- Validated by the marketplace before listing
- Shared via the async-design library
- Salvaged in-match by Scientist units (with the original designer's signature preserved)

### Modder safety

The Editor App is the modder seam. The constitution enforces at export:
- No bare gameplay numbers (only physical inputs)
- Validation against schema at upload
- Equations limited to the additive catalog (Invariance rule)
- Constitution checks before any unit enters PvP

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
| v0.1 | Three-pane shell: voxel sculptor (prototype), attribute form, battlefield preview. Save/load JSON. | **Shipped 2026-05-28** |
| v0.2 | Mesh import pipeline. AI mesh generation. Auto-voxelize. Material image overlay + AI inference. Autosave recovery UI. Panel persistence. | Next |
| v0.3 | Rigging layer: turret pivot + constraint arcs, recoil, animation states. Projectile Schematic authoring. Cluster munition tree. | Planned |
| v0.4 | Effect layer: laser emitter definition, shield generator, translucent rendering. | Planned |
| V1 | Plugin architecture. Multi-game export. Full Architect-tier capability. Marketplace integration ready. | V1 launch |
| V2 | Marketplace live (publish, browse, buy). Real-time collaborative authoring. | V2 launch |

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

- RESOLVED [2026-05-28]: voxel chassis vs mesh-first — **mesh-first with auto-voxelized physics substrate.**
- RESOLVED [2026-05-28]: hardpoint placement — **defined during rig authoring by clicking on the mesh surface.**
- RESOLVED [2026-05-28]: material authoring approach — **free-color image overlay with AI material inference.**
- RESOLVED [2026-05-28]: all-parts-player-sculpted — **confirmed. No locked pre-built parts library.**
- OPEN[2026-05-28]: stock template library scope at v0.2 launch — how many chassis templates ship, and authored by whom? blocks: v0.2 content plan.
- OPEN[2026-05-28]: AI mesh generation provider — Meshy, Tripo, or self-hosted model? blocks: v0.2 implementation.
- OPEN[2026-05-28]: material image projection method — box projection (simple, no UV required) or UV-fit (better wrap, requires UV map)? blocks: v0.2 material authoring.
- OPEN[2026-05-28]: plugin architecture format — JSON manifest + JS module, or fully compiled plugin? blocks: V1 multi-game export.
- OPEN[2026-05-28]: voxel grid resolution for high-detail mesh imports — 16³ current max sufficient, or does mesh-first workflow demand higher resolution? blocks: v0.2 auto-voxelize implementation.

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
