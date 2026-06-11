# Factions

## TL;DR
- Four factions: Reclaimer, Bulwark, Signal, Cinder Crown.
- Each is a worldview about surviving the Fall, expressed as a playstyle.
- Reclaimer is the player-default; the other three are skirmish AI archetypes that teach different gameplay pillars.
- Badges already exist in `concept/identity/`.

## Scope
This doc owns faction identity, lore, aesthetics, and *strategic archetype*. It does NOT own AI behavior trees or weights — those live in `docs/ai-behaviors.md`. It does NOT own faction-specific units or parts — those live in `docs/units.md`.

## Prerequisites
- `docs/glossary.md` — faction names and mottos
- `docs/world.md` — why factions exist

---

## The Reclaimer

| Field | Value |
|---|---|
| **Motto** | *Ex Ruinis Novum* — From ruins, the new |
| **Badge** | [concept/identity/badge.svg](../concept/identity/badge.svg) |
| **Flag** | [concept/identity/flag.svg](../concept/identity/flag.svg) |
| **Thesis** | Restore what was. The world was good. Rebuild it. |
| **Player role** | Default faction. Tutorial-friendly. |
| **AI archetype** | Balanced expansionist |

### Identity
The closest thing to the pre-Fall mainstream. Pragmatic engineers and salvage crews. They see the Fall as a wound to be healed, not a moral lesson. Most baseline tech still works; what's been lost is *organization*, and the Reclaimers' answer is to provide it.

### Aesthetic
Rust orange and slate. Hazard-yellow accents. Hand-painted hazard stripes on every panel. Salvaged plating welded over older salvaged plating. Functional, layered, lived-in.

### Strategic flavor
- Strong economy and expansion.
- Versatile unit roster — no extreme strengths, no extreme weaknesses.
- Tech recovery is slightly faster: they remember more of the pre-Fall world.
- The faction a new player should be encouraged to start with — every other faction is read through the Reclaimer baseline.

---

## The Bulwark

| Field | Value |
|---|---|
| **Motto** | *Stat Murus* — The wall stands |
| **Badge** | [concept/identity/badge-bulwark.svg](../concept/identity/badge-bulwark.svg) |
| **Thesis** | Hold what you have. The world is hostile. Survive it. |
| **Player role** | Defensive playstyle. Late-game powerhouse. |
| **AI archetype** | Turtle — fortify, project from cover |

### Identity
Survivors of a Fall who blame *trust* for the collapse. They will not extend further than they can defend. Every Bulwark outpost is a small fortress. Their engineers are stonemasons in spirit; their commanders dig trenches before they look for the enemy.

### Aesthetic
Gunmetal grey, dark red, bone white. Riveted plates, crossed I-beams, hexagonal frontal bunkers. Heavy silhouettes. Visible welds and reinforcement.

### Strategic flavor
- Slow expansion, dense defenses.
- High-armor units, point-defense, layered shields.
- Weak in early aggression; devastating to engage on their ground.
- Teaches the player: *how do I crack an entrenched position?*

---

## The Signal

| Field | Value |
|---|---|
| **Motto** | *Videmus Primi* — We see first |
| **Badge** | [concept/identity/badge-signal.svg](../concept/identity/badge-signal.svg) |
| **Thesis** | Knowledge is the only edge. The world is opaque. See it. |
| **Player role** | Information-warfare playstyle. |
| **AI archetype** | Recon-and-strike — scout, jam, sniper-strike |

### Identity
Survivors who believe the Fall caught everyone blind. They obsess over intelligence: radar, signals, decryption, triangulation. They build less and watch more. When they strike, they have already won the engagement in advance.

### Aesthetic
Phosphor-green CRT readouts. Antenna arrays. Optic cables exposed and bundled. Matte black with green status lights. Cleaner silhouettes than the other factions — minimalism as discipline.

### Strategic flavor
- Cheap, fast scouts. Best radar range. Best cloak. Best jammers.
- Glass-cannon strike units that rely on first-shot advantage.
- Weak in slugfests; lethal when they choose the engagement.
- Teaches the player: *counter-intel matters — jam their radar, hunt their scouts.*

---

## The Cinder Crown

| Field | Value |
|---|---|
| **Motto** | *Ignis Renatus* — Fire reborn |
| **Badge** | [concept/identity/badge-cinder.svg](../concept/identity/badge-cinder.svg) |
| **Thesis** | The world burned us. Now we burn back. |
| **Player role** | Aggressive raid playstyle. |
| **AI archetype** | Rush-and-harass — fast, hot, relentless |

### Identity
Survivors who saw the Fall as an injustice that has not yet been paid for. They do not build defenses; they build *fires*. Their bases are forward camps. Their economy is raid-funded. They believe the only secure perimeter is one beyond the smoke.

### Aesthetic
Ash-black and ember-red. Broken-spire skylines as iconography. Visible heat-glow on weapons. Smoke streaks. Crude welds — speed over polish.

### Strategic flavor
- Fastest units. Cheapest production. Incendiary and explosive weapons.
- Almost no defenses by design.
- Falters in long matches against entrenched opponents.
- Teaches the player: *defend your perimeter and respond to pressure under timing.*

---

## How the four factions teach the game

The four factions are not just lore — they are a curriculum. In skirmish, the player faces them in roughly this order:

1. **Cinder Crown** first — teaches base defense and reaction under timing pressure.
2. **Bulwark** next — teaches offense, breakthrough, and patience against fortified positions.
3. **Signal** — teaches counter-intel and choosing engagements.
4. **Three-way / four-way mixed** — teaches faction-reading and adaptation.

Mechanics behind these archetypes live in `docs/ai-behaviors.md`.

## Open questions

- OPEN[2026-05-27]: Should each faction have a signature *experimental* unit (one map-defining T3 unit per faction)? Lean yes; resolve in `docs/units.md`. blocks: docs/units.md
- OPEN[2026-05-27]: Faction-locked tech vs all-tech-available-to-all. Lean each faction has a small bias (Reclaimer +economy, Bulwark +defense, Signal +sensors, Cinder Crown +weapons) but most tech is universal. Resolve in `docs/tech.md`. blocks: docs/tech.md
- OPEN[2026-05-27]: Should the Natural Enemy be presentable as a "fifth faction" for art/UI purposes (even though it has no commander and no diplomacy)? Possibly. Resolve in `docs/events.md` and `docs/offline-pve.md`.

## Cross-references
- `docs/world.md` — the Fall and why factions exist
- `docs/ai-behaviors.md` — the actual behavior-tree weights per faction
- `docs/units.md` — faction-flavored units and parts
- `docs/tech.md` — faction tech biases
- `concept/identity/` — badges and flag
