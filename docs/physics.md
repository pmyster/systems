# Physics — environments and variables

## TL;DR
- Each map's environment is a Schematic — a JSON file with steady-state physics variables.
- Six launch environments: Cradle (Earth), Ashen Eye (Moon), Rustflats (Mars), The Drift (asteroid), Cryomantle (ice moon), The Wheel (rotating habitat).
- Variables: gravity, atmosphere, traction, thermal, radiation, day/night, magnetic field, season, available resources, required compatibility tags.
- Units carry compatibility tags (`vacuum-rated`, `low-g-stable`, etc.) checked against the environment.
- Steady-state lives here. Time-varying perturbations (storms, meteors, dust devils) live in `docs/events.md`.

## Scope
Owns environment-as-Schematic, the physics variable list, the six-environment launch catalog, and the compatibility-tag system. Does NOT own time-varying events (those are `docs/events.md`); does NOT own ballistics math (engine concern, deferred until prototype).

## Prerequisites
- `docs/schematics.md` — the data format
- `docs/glossary.md` — environment names

---

## Environment-as-Schematic

A map references an `environment` Schematic by ID. Map authoring is then "geometry + Schematic reference" — not "geometry plus fifty physics variables to tune".

Multiple maps can share an environment file (`cradle-winter-arroyo`, `cradle-winter-ridge`, …). Seasonal variants are different environment files (`cradle-summer`, `cradle-winter`, `cradle-monsoon`). Locked decision: seasons are per-map, not in-match cycling. (See `DESIGN.md`.)

---

## Variable list

Every environment Schematic defines these. Unspecified = engine default.

| Variable | Type / range | Affects |
|---|---|---|
| `gravity` | m/s² (float) | Ballistic arcs, jump height, unit stability |
| `atmosphere.density` | kg/m³ (float, 0 = vacuum) | Projectile drag, hover viability, air units, sound propagation |
| `atmosphere.composition` | tag set (`co2`, `o2`, `n2`, …) | Combustion / plasma weapons that need oxidizer |
| `atmosphere.pressure` | kPa (float) | Hull-breach mechanics, life-support drain |
| `traction.base` | float 0–1 | Ground-unit acceleration / turn-rate baseline |
| `traction.modifiers` | per-tile overrides (sand, mud, ice, …) | Local traction variance |
| `thermal.range` | [min, max] °C | Unit thermal tolerance, cooling-system load |
| `thermal.cycle` | period (s) and amplitude | Day/night swing, seasonal swing |
| `radiation` | μSv/h baseline (float) | Crew health, electronic interference |
| `magnetic_field` | strength + orientation | Compass-based weapons, some radar types |
| `daylight.cycle` | period (s) | Vision, solar power, stealth viability |
| `daylight.brightness` | function over cycle | LOS modifier across the cycle |
| `season` | enum string | Maps to per-faction modifier lookup |
| `available_resources` | list of resource IDs | Which environment-locked resources exist |
| `compatibility_required` | tag set | Tags units must have to operate without penalty |

---

## The six environments (launch catalog)

### Cradle (Earth)
| Field | Value |
|---|---|
| `gravity` | 9.8 |
| `atmosphere.density` | 1.225 (sea level) |
| `atmosphere.composition` | `[n2, o2]` |
| `thermal.range` | [-30, +40] (season-dependent) |
| `daylight.cycle` | 1440 s (24-min in-game day) |
| `available_resources` | Power, Scrap, Alloy, Fuel, Tech Fragment, Exotic Matter, Biomass |
| `compatibility_required` | `[]` (default — works for everything) |

The forgiving environment. Everything works here. New players start here.

### Ashen Eye (Moon)
| Field | Value |
|---|---|
| `gravity` | 1.62 |
| `atmosphere.density` | 0 (vacuum) |
| `thermal.range` | [-180, +120] |
| `daylight.cycle` | compressed; see open question |
| `available_resources` | Power, Scrap, Alloy, Fuel, Tech Fragment, Exotic Matter, Helium-3 |
| `compatibility_required` | `[vacuum-rated, low-g-stable, thermal-extreme]` |

First off-world environment. Ground units leap further; aircraft don't work; vehicles need vacuum-rated hulls and thermal-extreme cooling. He-3 is the prize.

### Rustflats (Mars)
| Field | Value |
|---|---|
| `gravity` | 3.71 |
| `atmosphere.density` | 0.020 |
| `atmosphere.composition` | `[co2]` |
| `thermal.range` | [-140, +20] |
| `daylight.cycle` | 1480 s (one sol) |
| `available_resources` | Power, Scrap, Alloy, Fuel, Tech Fragment, Exotic Matter, Water-Ice, Rare Earths |
| `compatibility_required` | `[low-g-stable, dust-sealed]` |

Atmosphere exists but is thin and CO₂-rich. Most combustion weapons need their own oxidizer. Dust storms (event perturbation) are the signature hazard.

### The Drift (Asteroid / microgravity)
| Field | Value |
|---|---|
| `gravity` | 0.001 (effectively zero) |
| `atmosphere.density` | 0 |
| `thermal.range` | [-200, +60] |
| `daylight.cycle` | 0 (rotational, constant sun-side / shadow-side) |
| `available_resources` | Power, Scrap, Alloy, Fuel, Tech Fragment, Exotic Matter, Rare Earths |
| `compatibility_required` | `[vacuum-rated, microgravity-stable]` |

Physics is the dominant constraint. No walking. Everything is thruster-based. Cover comes from the asteroid's geometry — and asteroid pieces can be detached and used as kinetic projectiles.

### Cryomantle (Ice moon)
| Field | Value |
|---|---|
| `gravity` | 1.3 |
| `atmosphere.density` | 0.001 (thin) |
| `thermal.range` | [-180, -100] |
| `radiation` | 200 μSv/h (Jovian-class) |
| `available_resources` | Power, Scrap, Alloy, Fuel, Tech Fragment, Exotic Matter, Water-Ice |
| `compatibility_required` | `[vacuum-rated, cryo-rated, rad-hardened]` |

The hostile-environment showcase. Crew-grade rad shielding is non-optional. The sub-ice ocean implied in the fiction is a future content seam.

### The Wheel (Rotating habitat)
| Field | Value |
|---|---|
| `gravity` | 9.8 (centrifugal — gradient from hub to rim) |
| `atmosphere.density` | 1.0 (sealed, pressurized) |
| `atmosphere.pressure` | 100 kPa |
| `thermal.range` | [+15, +25] (climate-controlled) |
| `daylight.cycle` | 1440 s (artificial) |
| `available_resources` | Power, Scrap, Alloy, Fuel, Tech Fragment (limited — habitat economy) |
| `compatibility_required` | `[]` (Earth-like inside) |

**Breach mechanics:** if a hull section is destroyed, that section vents to vacuum and behaves locally like The Drift until sealed. Players who don't think about hull integrity lose entire wings of their base.

---

## Compatibility tags

A unit's chassis + parts contribute a set of compatibility tags. The unit operates *natively* when its tag set is a superset of the environment's `compatibility_required`.

When tags are missing, the engine applies penalties declared on the chassis Schematic:

- `penalty.speed: 0.5` — half speed in missing-tag environment
- `penalty.health_drain: 1.0` — 1 HP/sec drain
- `penalty.weapon_jam: 0.2` — 20% chance per shot to fail
- `forbidden_in: [vacuum]` — cannot be deployed at all (engine refuses the order)

This means a Cradle-built Reclaimer scout can be force-deployed to the Ashen Eye, but it will overheat, leak air, and die. Or the player can build a vacuum-rated variant in the Editor App. **The Editor App is the answer to the compatibility-tag system.**

The launch tag set:

`vacuum-rated`, `low-g-stable`, `microgravity-stable`, `thermal-extreme`, `cryo-rated`, `dust-sealed`, `rad-hardened`, `corrosion-resistant`, `amphibious`, `submersible`, `aerial-capable`.

The taxonomy is open — modders add tags via Schematic — but new tags must be referenced by at least one environment to be meaningful.

---

## Steady-state vs perturbation

This doc owns *steady state*: the variables above are what an environment is *normally*.

**Perturbations** (dust storms, hurricanes, meteor showers, day/night transitions within a cycle, season shifts on the rare cycling map) modify these variables on a timeline. The Event Director (`docs/events.md`) owns perturbations.

**Boundary contract:** if a value can be plotted on a timeline within a single match, it belongs in `events.md`. If it's constant for the duration of a match, it belongs here.

---

## Open questions

- OPEN[2026-05-27]: Ashen Eye day/night cycle compression — a real 29.5-day month would mean entire matches in shadow. Lean compressed to ~40 minutes in-game. Resolve before authoring lunar maps.
- OPEN[2026-05-27]: The Wheel's centrifugal-gravity gradient (hub vs rim) — is it a per-tile gravity override or just flavor? If real, it affects ballistics. Resolve when authoring The Wheel maps.
- OPEN[2026-05-27]: Magnetic field and radiation are flavor in v1 (not driving mechanics). Lock them as variables now; activate when content needs them.
- OPEN[2026-05-27]: Should compatibility tags be additive (chassis + each part) or chassis-only (parts can only *reduce*)? Lean additive — lets the Editor App promote a "civilian" chassis to vacuum-rated by swapping the cockpit part. Resolve in `docs/units.md`.

## Cross-references
- `docs/schematics.md` — environment Schematic format
- `docs/events.md` — time-varying perturbations
- `docs/economy.md` — environment-locked resources
- `docs/units.md` — chassis / part compatibility tags
- `docs/world.md` — in-fiction lore of the environments
