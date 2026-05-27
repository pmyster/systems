# Schematics — the data format

## TL;DR
- A Schematic is a JSON file the engine reads as a rule.
- Every game concept that isn't engine plumbing is a Schematic: units, parts, weapons, structures, AI behaviors, environments, events, tech, factions, resources, enclaves, objectives.
- Schematics are validated by JSON Schemas published in `schemas/`. The engine refuses to load invalid content.
- Schematics reference each other by namespaced string IDs (`reclaimer/unit/scout`).
- Schematics compose: a unit Schematic references a chassis + N parts.
- Schematics hot-reload at edit time during dev; cold-load only in shipped builds.

## Scope
This doc owns the data format and how the engine consumes it. It does NOT own the *content* of any specific Schematic kind — that lives in the system docs (units, physics, economy, tech, ai-behaviors, events).

## Prerequisites
- `docs/glossary.md` — the term "Schematic" and the kinds it spans

---

## Why JSON

- Mature tooling: every IDE, every diff viewer, every text editor reads it.
- Human-readable: a modder can open one in Notepad.
- JSON Schema is standardized; validation is free.
- Cross-platform: Unity parses it; the Editor App (Electron / Tauri) parses it.
- Mod-friendly: no proprietary format to reverse-engineer.

Tradeoffs accepted:
- Larger on disk than a binary format. Mitigated by gzipping the shipped content pack.
- Slightly slower to parse than binary. Mitigated by parsing once at engine boot.
- Comments not natively supported. Mitigated by JSON5 in dev/editor builds, with a stripper that emits strict JSON for ship.

We are NOT using YAML. (Significant whitespace plus mobile editing equals pain.)

---

## Schematic kinds (catalog)

The engine recognizes a finite set of kinds. Each kind has a published schema.

| Kind | What it describes | Authoritative doc |
|---|---|---|
| `unit` | A composable unit: chassis + parts | `docs/units.md` |
| `chassis` | A unit body, hardpoint layout, base stats | `docs/units.md` |
| `part` | A mountable component (weapon, utility, mobility, defense) | `docs/units.md` |
| `weapon` | Weapon stats: damage, range, projectile, fire rate | `docs/units.md` |
| `structure` | A buildable: extractor, factory, defense tower, lab | `docs/units.md`, `docs/economy.md` |
| `environment` | A map's physics state (gravity, atmosphere, season, etc.) | `docs/physics.md` |
| `resource` | A resource definition (Power, Scrap, etc.) | `docs/economy.md` |
| `tech` | A tech node, its prerequisites, its unlocks | `docs/tech.md` |
| `behavior` | A behavior-tree definition for unit AI | `docs/ai-behaviors.md` |
| `archetype` | Faction-level overlay on behavior weights | `docs/ai-behaviors.md`, `docs/factions.md` |
| `event` | A timed/triggered world event (meteor, storm) | `docs/events.md` |
| `faction` | A faction's roster, biases, starting tech | `docs/factions.md` |
| `enclave` | A non-faction pocket-of-leadership template | `docs/campaign.md` |
| `objective` | A win-condition definition (territory hold, etc.) | `docs/prototype-scope.md` |

The catalog is *open in principle* — adding a new kind is a schema publish plus an engine handler — but in practice we keep it tight. Every new kind is a contract added to the engine.

---

## ID system

Every Schematic has an `id` field that is **globally unique** within the loaded content set.

Format: `<namespace>/<kind>/<name>` where namespace is `core`, a faction short name, or `mod-<modid>`.

Examples:
- `core/resource/power`
- `reclaimer/chassis/scout-light`
- `signal/part/weapon/marksman-rifle`
- `mod-acmecorp/unit/giant-walker`

Rules:
- Lowercase ASCII letters, digits, dash, slash. No spaces. No Unicode.
- Stable for the life of the Schematic. Renaming is a hard break.
- Versions are NOT in the ID. Version is a sibling field.

---

## Reference syntax

Schematics reference other Schematics by ID, as a string:

```json
{
  "id": "reclaimer/unit/scout-lite",
  "schema_version": "1.0",
  "chassis": "reclaimer/chassis/scout-light",
  "parts": [
    "reclaimer/part/weapon/light-mg",
    "core/part/utility/radar-basic"
  ]
}
```

The engine resolves references at load time and fails fast if any ID is missing.

---

## Inheritance vs composition

We use **composition** wherever possible and **explicit inheritance** sparingly.

- A `unit` Schematic is composition: `chassis` + `parts`.
- A `chassis` Schematic does NOT extend another chassis. If two chassis share fields, the duplication is acceptable — readability beats DRY in content data.
- One exception: `archetype` Schematics layer ON TOP of a base `behavior` Schematic. That's inheritance by overlay. Documented in `docs/ai-behaviors.md`.

Rationale: inheritance chains in data are debugger pain. Composition is grep-able.

---

## Schema philosophy

- Every Schematic kind has a JSON Schema at `schemas/<kind>.schema.json`.
- Schemas ship with the game build so modders can validate locally.
- The engine validates every Schematic at load time. Validation failure = the Schematic is not loaded; a warning surfaces in dev / logs in ship.
- Schemas describe *structure*, not *balance*. The engine separately runs **content checks** (e.g., "this weapon's range exceeds the chassis's optic range — possibly intentional, but log it").
- A Schematic's `schema_version` is checked against the engine's known versions. Forward-compatibility within a major version; breaking changes require a content migration path.

---

## File layout

```
content/
  core/                   # ships with engine
    resources/
    chassis/
    parts/
    weapons/
    structures/
    environments/
    behaviors/
    events/
  factions/
    reclaimer/
      faction.json
      units/
      parts/
      ...
    bulwark/
    signal/
    cinder-crown/
  mods/
    <modid>/
      manifest.json
      <kind>/*.json
```

Each `.json` file contains **one** Schematic. No arrays of mixed-kind Schematics — one file, one ID.

---

## Hot-reload semantics

In the Editor App and dev builds of the game:
- File-system watchers detect Schematic changes.
- On change: re-validate, re-resolve references, swap the active rule.
- Already-spawned units **keep their current parameters** unless explicitly opted in. (Live-swapping a unit's stats mid-fight is chaos.)
- Newly-spawned units use the new rules.
- Some Schematic kinds (`environment`, `faction`) require a full match restart to apply. The engine surfaces hot vs cold reload per kind in the dev panel.

Shipped builds: cold-load only. Schematics load once at app start.

---

## Validation pipeline

Three layers:

1. **Schema validation** — JSON Schema check. Structural.
2. **Reference resolution** — every referenced ID must exist in the loaded set.
3. **Content checks** — semantic warnings (out-of-range values, deprecated fields, schema-version mismatches). Non-fatal.

A Schematic that fails layer 1 or 2 is rejected. Layer 3 logs but loads.

The Editor App runs all three layers on save, surfacing errors to the user before the file can be shared.

---

## Modding seam

- Modders ship a directory of Schematics, optionally with a `manifest.json` (mod name, version, dependencies, author).
- Mod load order is configurable.
- Mods can override `core/` or faction Schematics by ID. The engine logs every override.
- Mods do **NOT execute code**. The engine remains a rules interpreter — there is no scripting surface in a Schematic. Behavior trees are data, not Lua.

Why no scripting:
- Keeps the trust model simple (a mod can break balance but not crash you).
- Makes multiplayer integrity tractable (everyone validates the same way).
- Forces all "behavior" to flow through published Behavior Tree primitives — which means the Editor App and the in-game AI speak the same language.

---

## Versioning

- Each Schematic has `schema_version` (which schema it expects) and `content_version` (the author's version of the content).
- Engine maintains a version range per schema kind. Out-of-range = rejected.
- Major schema changes ship with content-migration scripts in the engine.

---

## Open questions

- OPEN[2026-05-27]: Strict JSON vs JSON5 in dev. Lean JSON5 in editor + dev game; strict JSON in ship build.
- OPEN[2026-05-27]: Schematic signing / mod marketplace trust. Lean no for v1; revisit when shipping the marketplace.
- OPEN[2026-05-27]: Inheritance overlay for `archetype` — is the format weight-scaling, behavior-tree-replacement, or both? Resolve in `docs/ai-behaviors.md`.
- OPEN[2026-05-27]: Per-Schematic-kind hot-reload policy — which kinds are hot, which are cold? Sketch above is provisional. Resolve as we implement.

## Cross-references
- `docs/glossary.md` — Schematic terminology
- `docs/units.md` — chassis / part / unit Schematic details
- `docs/physics.md` — environment Schematic details
- `docs/economy.md` — resource Schematic details
- `docs/tech.md` — tech Schematic details
- `docs/ai-behaviors.md` — behavior / archetype Schematic details
- `docs/events.md` — event Schematic details
- `docs/factions.md` — faction Schematic details
- `docs/campaign.md` — enclave Schematic details
