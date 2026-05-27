# World

## TL;DR
- Post-apocalyptic future, on and beyond Earth.
- An unspecified Fall ended the prior civilization decades ago. Survivors fragmented into factions.
- The Ruins hold pre-Fall technology — engineering blueprints, weapon designs, AI shards. Recovering them is the engine of progress.
- A Natural Enemy fills the void where civilization withdrew. Survivors don't just fight each other; they fight the world.
- Meteors drop Exotic Matter of unknown origin. Implies — but doesn't confirm — that something else is out there.

## Scope
This doc owns the fiction: setting, premise, history, lore, the in-world reasons every system exists. It does NOT own mechanics. Mechanics live in `docs/factions.md`, `docs/economy.md`, `docs/tech.md`, `docs/events.md`, and the rest of the systems docs.

## Prerequisites
- `docs/glossary.md` — canonical names for places, factions, and resources.

---

## The Fall

Civilization didn't fall all at once. It frayed.

Humans had been ravaging the environment for centuries — atmosphere, oceans, soil. When the first habitable belts narrowed, governments started fighting *the Wars* — not over ideology, but over *livable land*. The Wars went on long enough that everyone lost.

The Fall is not a single event. It is the name for the end of those wars and everything that followed — collapse of governments, breakdown of supply chains, fragmentation of populations, and the slow rise of the survivors who would name themselves the **Children of Dusk**.

What the Fall left behind:

- **The Ruins** — engineering archives, factory complexes, weapon caches, AI shards, half-built megastructures. Most are radioactive, derelict, or contested.
- **Off-world colonies** — settlements that had already left Earth and survived intact (Moon, Mars, asteroid belt, ice moons, one rotating habitat called The Wheel). They are isolated and resource-starved.
- **Wreckage** — debris fields, crashed orbital infrastructure, drowned cities. The primary source of Scrap.
- **A void** where institutions and ecosystems used to be — filled now by storms, scavenger AI, and mutated fauna. The Natural Enemy.

## The Children of Dusk

"Children of Dusk" is what the survivors call themselves. The name is half-elegiac, half-defiant — *Dusk* is the long fading of the world they were born into; *Children* is who they are now.

All governments collapsed. What's left are **pockets of leadership** — local strongmen, rebuilt city-states, technocratic enclaves, salvage cartels, agricultural collectives. Some are honorable. Some are predatory. Most are *contingent*: they will trade with you if you trade fairly, fight you if you hoard or threaten, and disappear if pressured too hard by the Natural Enemy.

The four factions (Reclaimer, Bulwark, Signal, Cinder Crown) are the largest and most organized — the ones that have stabilized enough to be ideologies. But the world is full of smaller enclaves who haven't picked a thesis yet, and the player encounters them constantly.

**Whether an enclave helps or hurts the player is determined by the player's behavior, not by faction loyalty.** Share resources; they become allies. Hoard everything; they become hostile. The world *responds* to who you are.

Detail: `docs/campaign.md` (the enclave karma system).

## The Salvage Era (the present)

Decades after the Fall. Survivor enclaves have rebuilt enough to mine, forge, and field automated forces. None has rebuilt enough to dominate. The world is a patchwork of factions raiding Ruins, fortifying ground, and probing each other's perimeters.

The defining fact of the era: **knowledge is recovered, not invented.** Reclaimers are not building new tech from first principles; they are restoring tech the world already had. This is why the tech tree is salvage-driven, not paid-for. A faction's strength is measured in how much of the lost world it has *remembered*.

## The Natural Enemy

When civilization withdrew, things filled the spaces. Some are weather (storms that never stop, hurricanes that walk for weeks). Some are biological (mutated fauna pack-hunting around Ruins). Some are mechanical (rogue automation from pre-Fall facilities running on undefined directives, raiding for parts).

The Natural Enemy is **not a faction.** It does not negotiate. It does not have territory. It pressures everyone equally — and most of all, it pressures the unattended. A base left undefended will be ground down. This is the fiction that grounds the offline-PvE pillar.

## The Meteors

Roughly once per match cycle, a meteor shower passes overhead. It drops Exotic Matter — a class of substance no pre-Fall record explains. Nobody knows where it comes from. Theories range from "the same event that caused the Fall is ongoing" to "something out there is sending them" to "the universe just does this sometimes."

The Reclaimers study them. The Bulwark stockpiles them. The Signal triangulates their trajectories. The Cinder Crown weaponizes them. None has answers.

This is the seam where future content — aliens, deeper mysteries, narrative campaigns — can enter without retcon. The world *already implies* there's something more.

## Why factions formed

Every faction is a *thesis about how to survive the Fall*. The thesis explains the playstyle.

- **Reclaimer** — *Restore what was. The world was good. Rebuild it.* They are the closest to the pre-Fall mainstream. Generalist, balanced, expansionist.
- **Bulwark** — *Hold what you have. The world is hostile. Survive it.* They believe the Fall proved you can't trust anything you don't fortify. Defensive, slow, hard to kill.
- **Signal** — *Knowledge is the only edge. The world is opaque. See it.* They believe the Fall caught everyone blind. Information-obsessed. Sees first, hits last.
- **Cinder Crown** — *The world burned us. Now we burn back.* They believe the Fall was an injustice. Aggressive, raid-focused, scornful of defense.

These are not just gameplay archetypes — they're *worldviews colliding on a wrecked planet*.

## Why we're on multiple worlds

Off-world colonies that existed before the Fall survived because they were already self-sufficient. They are now isolated and contested. Each environment (Cradle, Ashen Eye, Rustflats, The Drift, Cryomantle, The Wheel) presents its own resources, hazards, and strategic flavor.

A faction that masters the Cradle may flounder on the Ashen Eye. This is intentional — the game rewards *map literacy* as much as army composition. A player whose army was perfect on Mars may need to rebuild for a vacuum-fight on the Moon.

## The shape of a match

In-fiction, a "match" is a contested action — two or more factions converging on a region (a ruin, a deposit, a chokepoint) to settle who controls it. Commanders coordinate forces remotely; their bases continue to operate during and after the engagement.

A match is *one chapter*, not the whole war. The Commander's career is the war.

## The Long View — campaign arc

The Commander's career is a story in phases. Each phase opens new content, environments, and threats. The early phases are Earth survival; the later phases are stellar ambition.

1. **The Salvage Era — Earth.** Where we start. Survive the Cradle, raid the Ruins, fight or befriend the local enclaves. Recover enough tech to leave a single planet.
2. **Lunar Colonization — The Ashen Eye.** First permanent off-world expansion. Vacuum operations, low-g logistics, He-3 extraction. New unit compatibility constraints, new enclaves who've been there longer.
3. **The Reach — Warp Gates.** Restoring or building gates to other solar systems. Long-term project requiring massive Exotic Matter stockpiles. Opens the multi-system map.
4. **The Constellation — Player Worlds.** Speculative. Each player builds and tends their own planet, grouped with other players in the same solar system. Cooperative defense, contested trade routes, the metagame as collective storytelling.

Each phase is *aspirational from where we sit*. The prototype scopes only Phase 1. But the architecture must not foreclose the later phases. A Schematic-driven engine, environment-as-data, and a modular unit editor are all the right architectural choices for a campaign that grows from one planet to many.

Detail: `docs/campaign.md`.

## Open questions

- OPEN[2026-05-27]: How long ago was the Fall? "Decades" feels right; staying vague for now. Resolve only if campaign narrative requires precision.
- OPEN[2026-05-27]: The Wars are stated as the proximate cause of the Fall, but should there be a *specific* catalyst — a final atrocity, a runaway weapon, an ecological tipping point — or remain abstracted as "the Wars went on too long"? Lean abstracted. Mystery is a hook.
- OPEN[2026-05-27]: Phase 4 (The Constellation) — co-op player-tended worlds. Scope and shape entirely speculative. Resolve in `docs/campaign.md` if/when we reach that phase.
- OPEN[2026-05-27]: Enclave karma model — what player actions count as "sharing" vs "hoarding"? Resource flow over time? Threshold-based? Resolve in `docs/campaign.md`.

## Cross-references
- `docs/factions.md` — the four major factions
- `docs/campaign.md` — the campaign arc and enclave karma
- `docs/physics.md` — the environment catalog
- `docs/economy.md` — Scrap, Exotic Matter, and other in-fiction resources
- `docs/tech.md` — the salvage-driven tech model
- `docs/events.md` — the Meteor Shower as a world event
- `docs/offline-pve.md` — the Natural Enemy as a mechanic
- `docs/humans.md` — the Commander as a persistent profile
