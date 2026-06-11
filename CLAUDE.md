# CLAUDE.md — Agent Brief

This file is auto-loaded by every Claude Code agent working in this repo. **Read it. Then read [DESIGN.md](DESIGN.md) before doing any work.**

> **If you are picking this project up fresh** (especially if you're a local Claude Code instance starting on the user's laptop), **read [HANDOFF.md](HANDOFF.md) first.** It carries the full status, the ten constitution principles, the immediate priorities, and the bridge from the cloud session that designed everything. The full decision trail is in [docs/decision-history.md](docs/decision-history.md).

---

## Project

A post-apocalyptic mobile RTS inspired by Supreme Commander and Total Annihilation, built on a data-driven engine (**Schematics**) where every game rule is a JSON file the engine loads at runtime. Target platform: Unity, mobile-first, with a separate desktop/tablet companion editor app.

## Status

**Design phase.** No engine code exists yet. The deliverable for this phase is a documentation suite that captures every system before any line of C# is written.

---

## The non-negotiables

Before you take any action in this repo:

1. **Load [DESIGN.md](DESIGN.md).** It's the master contract. If your action contradicts it, stop and ask.
2. **Load [docs/glossary.md](docs/glossary.md).** Use the canonical names. Do not coin new ones without adding them to the glossary in the same change.
3. **Follow the doc header convention.** Every doc under `docs/` and `DESIGN.md` uses: TL;DR → Scope → Prerequisites → body → Open questions → Cross-references. Match the existing pattern.
4. **Tag open questions; don't invent answers.** When you hit an ambiguity, write `OPEN[YYYY-MM-DD]: <question>` and optionally `blocks: <other doc>`. Do not guess.
5. **Respect boundary contracts.** If two docs could plausibly own a concept, the existing doc that owns it wins. Don't duplicate; link.
6. **Cross-reference by relative path** (`docs/foo.md`) so links work in GitHub UI and in agent context.

---

## Pillars (memorize these)

1. **Terrain matters** — real heightmap, real ballistics, fog of war.
2. **Information warfare as a resource sink** — radar, cloak, jammers, shields cost ongoing Power.
3. **Dig-in & defend rhythm** — tower-defense pacing inside an RTS.
4. **Modular unit editor** — separate companion app, voxel-block construction.
5. **Asynchronous offline PvE** — base persists; Natural Enemy pressures it while player is offline.
6. **Tech-driven AI battles, human commanders** — autonomous AI + elite humans; player is off-map persistent profile.

## Locked decisions

- **Commander** = persistent profile (Clash-style, off-map, can't die in a match).
- **Seasons** = per-map fixed (no mid-match cycling).
- **Housing** = mixed (AI units no, Human-Crewed Elites yes).
- **Architecture** = JSON Schematics with published JSON Schemas, hot-reloadable, modder-friendly.
- **Resources** = accept complexity for depth (up to 10 per map; no UI-driven trimming).
- **Power** = streaming only (rate-based, SupCom-flavor, no battery cap).
- **Tech retrieval** = PvE discovers (risk-and-carry from Ruins); PvP learns (combat-and-capture from enemy units).

## Factions

- **Reclaimer** (player default, *Ex Ruinis Novum*)
- **Bulwark** (defense AI, *Stat Murus*)
- **Signal** (info-war AI, *Videmus Primi*)
- **Cinder Crown** (aggression AI, *Ignis Renatus*)

---

## Where to start by task

- **Editing or adding lore:** read `docs/world.md` and `docs/factions.md`. New names go in `docs/glossary.md`.
- **Adding a system doc:** read `DESIGN.md` + the existing docs in the same tier. Use the header convention. Cross-reference your prerequisites.
- **Writing Schematic content (when those exist):** read `docs/schematics.md` (format), `docs/glossary.md` (TL;DR), the relevant system doc, and the schemas in `schemas/` (when they exist).
- **Engine code:** stop. We aren't there yet. Design phase first.

---

## Repo norms

- Branch: `claude/mobile-rts-game-concept-7LbT0`. All design-phase work goes here.
- PR: #2 on GitHub. Each documentation tier is a commit checkpoint.
- Concept art: `concept/identity/` holds faction badges and the flag (SVG). Reference them from docs as needed.

## When in doubt

Ask. The cost of pausing for a clarification is low; the cost of an invented answer that propagates through five docs is high.
