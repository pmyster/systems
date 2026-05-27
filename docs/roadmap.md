# Roadmap

## TL;DR

- **Three macro-phases**: V1 (PvE foundation) → V2 (PvP federation) → V3 (Living World).
- **Twelve milestones**, ~36 months from start to mature V3 platform.
- **V1 ships at month 12-15**; revenue-positive on diegetic ads alone before V2 investment.
- Each milestone has named deliverables and a decision gate that determines whether the next milestone proceeds.
- Timelines are estimates for a small team (2-5 developers + designer + part-time art/audio); actuals will vary.

## Scope

This document owns the development roadmap: phase boundaries, milestone deliverables, decision gates, estimated timelines, and resource needs.

It does NOT own:
- Architecture details — `docs/architecture.md`.
- Feature specifications — system docs (`tech.md`, `units.md`, etc.).
- Revenue model — `docs/monetization.md`.
- Risk register — `docs/risks.md`.

## Prerequisites

- [DESIGN.md](../DESIGN.md) — the constitution and locked decisions
- [docs/architecture.md](architecture.md) — what's being built
- [docs/phasing.md](phasing.md) — V1/V2/V3 scope definitions (future doc)

---

## The three macro-phases

### V1: PvE Foundation

**Goal:** ship a complete, fun, mobile RTS that proves the core loop and generates revenue, before any multiplayer infrastructure investment.

**Features shipped at V1 launch (M5):**
- Solo PvE campaign (Salvage Era / Earth, Phase 1)
- Persistent Commander base
- Editor App for unit creation (Schematic-producing)
- Three-layer tech progression (baseline + salvaged + researched)
- Hall of Conquered (PvE-only)
- Salvage Signature (vs AI factions)
- Cosmetic identity (badges, flags, palettes, paint kits)
- Achievements (PvE subset)
- Offline-PvE pressure (Natural Enemy)
- Four canonical factions
- Diegetic ads (revenue floor)
- Async design sharing (free, browsable)

**Target timeline:** months 0-15.

**Success criteria:** the core loop is fun (validated by playtest); soft-launch retention meets target thresholds; ad revenue at 10K MAU exceeds operating cost.

**Decision gate (end of V1):** proceed to V2 only if V1 is retention-positive and revenue-positive. If V1 fails either, fix V1 before adding PvP.

### V2: PvP Federation

**Goal:** open the world to other players. Build the community layer. Add the creator marketplace.

**Features added in V2 (M6-M9):**
- Lockstep PvP matches (1v1, 2v2, FFA)
- Matchmaking with skill rating
- Cross-player Hall captures (PvP flags)
- Cross-player Salvage Signature propagation
- Clans + alliances (live social systems)
- Creator marketplace (paid designs with safeguards)
- Verified-adult account gating
- Stock-only PvP brackets
- Phase 2 content (Lunar / Ashen Eye + new equations + new chassis)
- AI agent production-time pipeline (content drops)

**Target timeline:** months 15-27.

**Success criteria:** PvP is engaging (validated by retention of PvP-flagged players); cross-player content propagates (Salvage Signature lineages appear); marketplace is healthy (sales and creator earnings).

**Decision gate (end of V2):** proceed to V3 only if community-layer metrics are strong and marketplace economics are working. If V2 stalls, V1+V2 may be sufficient for a long time.

### V3: Living World

**Goal:** turn the world into a co-author. AI agents generate narrative responsive to player activity. The game scales beyond what any team could author.

**Features added in V3 (M10-M12+):**
- AI runtime narrative director
- Production → blended → mature agent pipeline
- Per-cohort responsive content
- Phase 3 content (The Reach / warp gates)
- Phase 4 preview (Constellation / co-op planet-tending)
- Mature ad/marketplace/patronage ecosystem
- Modder economy (V2 modding + V3 monetization for mods)
- Multi-region active-active infrastructure

**Target timeline:** months 27-36+.

**Success criteria:** AI-generated content is quality-comparable to human-authored content; player engagement deepens; the universe feels "alive."

**Decision gate (ongoing):** V3 is more iterative than V2 — capabilities deploy continuously rather than as one launch. Decision gates become "is this feature ready" rather than "is this version ready."

---

## V1 milestones

### M1: Foundation (months 0-3)

**Deliverables:**
- Schematic Loader (Module 1) — JSON parsing, validation, hot-reload
- Equation Evaluator (Module 2) — sandboxed expression evaluator with time/memory caps
- Constants and ~6 core equations (ballistics, drivetrain, thermal-cooling, drag, sensors, structural-load) authored
- Physics Solver (Module 3) — basic single-domain (land), fixed-point math
- One test chassis (basic tank), one test map (Cradle), one test environment Schematic
- Local-only persistence (Module 8) — SQLite save/load
- Engine harness (Unity scene) where a single unit moves under physics commands

**Success criteria:** a tank drives across terrain under derived-from-physics motion; firing a shot resolves via the ballistics equation; the demo is reproducible on every supported platform (determinism passing).

**Decision gate:** if determinism fails across platforms despite fixed-point math, revisit math library or consider a different determinism strategy before adding complexity.

**Resource needs:** 1-2 engineers, 1 designer (Schematic authoring), light art.

### M2: Core Loop (months 3-6)

**Deliverables:**
- Multi-domain physics — add air domain alongside land
- Editor App MVP — chassis sculpting + 5 part types (basic weapon, basic engine, basic armor, basic sensor, basic battery)
- Behavior Runtime (Module 4) — 3 stances (Hold, Patrol, Attack-Move)
- World Simulator (Module 5) — match-loop orchestration
- Single faction (Reclaimer) with starter units and starter base
- AI invader scenario — basic Bulwark or Cinder Crown attacks the player's base
- Basic UI (Module 10) — mobile touch, command issuance
- Basic Rendering (Module 9) — voxel chassis + hardpoint part display

**Success criteria:** player can build a small base, design a unit in the Editor, deploy it, and survive a scripted AI invasion. Match feels like the design intent.

**Decision gate:** is the core loop fun (internal playtest)? If no, iterate on Schematic content and physics tuning before adding scope.

**Resource needs:** 2-3 engineers, 1 designer, 1 artist (part-time), 1 UX (part-time).

### M3: Content Depth (months 6-9)

**Deliverables:**
- All four canonical factions with distinct unit rosters and starter tech
- Tech progression layers: baseline + salvaged (research postponed to M4)
- Resource economy — Power, Scrap, Alloy, Fuel
- Hall of Conquered (PvE-only) — first version
- Salvage Signature mechanic (vs AI)
- Cosmetic identity (palette + flag upload, recolor hooks working)
- Editor App polish — more part types, validation feedback
- More environments (Cradle variants for season)

**Success criteria:** a full campaign chapter is playable. Faction differences are felt. Tech progression is meaningful. Cosmetic identity works end-to-end.

**Decision gate:** is the content depth pulling players into long sessions? Length of average session is the key metric.

**Resource needs:** 2-3 engineers, 1-2 designers, 1-2 artists, 1 UX.

### M4: V1 Polish (months 9-12)

**Deliverables:**
- Achievement system (PvE subset)
- Offline-PvE pressure (Natural Enemy events during offline)
- Researched-tier tech (third layer of progression)
- Editor App polish — paint kit interface
- Cosmetic identity (paint kits, squadron markings)
- Localization framework — UI strings + Schematic text fields support multi-language
- Tutorial / onboarding — the most critical design pass; progressive complexity revelation
- Closed beta launch with ~500-1000 invited players
- Analytics, crash reporting integrated

**Success criteria:** closed beta retention curves match or exceed targets. Tutorial completion rate is high. No game-breaking bugs in the deterministic simulation.

**Decision gate:** are beta players sticking? Are they getting through the onboarding ramp? If retention is poor at any specific point, that point gets a dedicated design pass before public launch.

**Resource needs:** 3-4 engineers, 2 designers, 2 artists, 1 UX, 1 community (part-time for beta).

### M5: V1 Launch (months 12-15)

**Deliverables:**
- Diegetic ads integrated and selling (fictional analogues first; real-brand pipeline ready but stocked with placeholders)
- Account service + cloud backup
- Async design sharing (free-only, paid marketplace OFF until safeguards complete)
- Multi-region CDN (2-3 regions)
- App store presence (iOS, Android, possibly web build)
- Community moderation tools (visibility-tiered approval queue for uploads)
- Public soft launch in 1-3 regions
- Press / marketing assets

**Success criteria:** public launch with stable infrastructure. Ad revenue ramps. Retention holds from beta levels.

**Decision gate:** if soft launch reveals issues, hold geographic expansion until stable. Don't push to global launch with shaky retention.

**Resource needs:** 3-5 engineers, 2 designers, 2 artists, 1 UX, 1 community, 1 BD (ad sales, part-time).

---

## V2 milestones

### M6: PvP Foundation (months 15-18)

**Deliverables:**
- Network Sync module (Module 7) implementation — lockstep relay
- Match model formalization (`docs/matches.md`) — participant roster + objective Schematic
- Determinism testing across all supported platforms (CI gates determinism daily)
- Anti-cheat foundation — divergent-simulation detection, signed Schematics enforced for PvP
- Stock-only PvP brackets (V1 of the bracket — limited match types)
- First 1v1 PvP matches in production

**Success criteria:** lockstep PvP is bit-deterministic in production. 1v1 PvP feels fair and fun. Anti-cheat catches obvious cheats.

**Decision gate:** if determinism fails in production, swap Network Sync to server-authoritative deltas before proceeding. The seam is there; use it.

**Resource needs:** 4-5 engineers (includes networking specialist), 2 designers, 2 artists, 1 UX, 1 community, 1 BD.

### M7: Community Layer (months 18-21)

**Deliverables:**
- Clans + alliances (live social systems)
- Cross-player Hall captures (PvP flags)
- Cross-player Salvage Signature propagation (in-match)
- Async design sharing extended to paid marketplace
- Verified-adult account gating
- Ten marketplace safeguards implemented
- First marketplace transactions

**Success criteria:** clans form and persist. PvP flags appear in Halls with proper attribution. Marketplace processes its first real-money transactions cleanly. Refunds work.

**Decision gate:** if the marketplace introduces fairness complaints, slow it before scaling. The safeguards must work in production, not just in design.

**Resource needs:** 4-5 engineers, 2 designers, 2 artists, 1 UX, 1-2 community (moderation queue scales), 1 BD, 1 legal (part-time for marketplace).

### M8: PvP Scale (months 21-24)

**Deliverables:**
- Matchmaking with skill rating
- Phase 2 content (Lunar / Ashen Eye environment + new equations like orbital-mechanics + new chassis classes like low-g + vacuum-rated)
- AI agent production-time pipeline operational (content drops monthly)
- More PvP match types (2v2, FFA, scenario)
- Tournament infrastructure (light first version)

**Success criteria:** matchmaking produces balanced matches at retention thresholds. Phase 2 content reaches players smoothly via additive Schematic updates. Production-time AI generates content that passes review.

**Decision gate:** if AI-generated content quality is below human-authored, slow the AI pipeline and improve quality gates. Better no AI content than bad AI content.

**Resource needs:** 5-6 engineers (includes AI/ML specialist), 2-3 designers, 2-3 artists, 1 UX, 2 community, 1 BD.

### M9: V2 Polish (months 24-27)

**Deliverables:**
- Tournaments / seasonal events (with no FOMO mechanics — opt-in challenges, not time-limited exclusives)
- Real-brand diegetic ad pipeline operational (first real-brand placements)
- Refinement based on production telemetry
- Investment in moderation infrastructure (queue scales with playerbase)
- Public V2 launch with PvP available

**Success criteria:** V2 platform is stable. Real-brand ads generate revenue meaningfully. PvP retention is healthy.

**Decision gate:** V2 must be self-sustaining (revenue > costs) before V3 investment. The V3 phase is expensive and shouldn't be funded by debt.

**Resource needs:** 5-7 engineers, 2-3 designers, 2-3 artists, 1 UX, 2-3 community, 2 BD.

---

## V3 milestones

### M10: Living World Foundation (months 27-30)

**Deliverables:**
- Agent Runtime module (Module 11) introduced
- Quality-gate agent operational against constitution
- Continuity agent maintaining lore consistency
- Production-time → blended pipeline (some content auto-deployed without human review for low-risk categories)
- Server Persistence aggregation hook implemented
- First AI-authored PvE invasion arcs hit live world

**Success criteria:** AI-authored content lands in production at quality comparable to human-authored. Players engage with AI content at comparable rates.

**Decision gate:** if AI quality erodes player trust, pull back to production-time-only mode. The seam is there.

**Resource needs:** 5-7 engineers (AI/ML specialist required), 2-3 designers, 2-3 artists, 1 UX, 2-3 community, 2 BD, 1 ML ops.

### M11: Living World Scale (months 30-33)

**Deliverables:**
- Runtime narrative director (responding in near-real-time to game events)
- Per-player / per-cohort responsive content
- Phase 3 content (The Reach — warp gates + interstellar logistics + new equations)
- Cross-player ad / sponsorship at the clan level
- Modder content monetization (mods can be sold via marketplace with same safeguards)

**Success criteria:** narrative responds to player actions in observable, satisfying ways. Players talk about "their story" emerging. Phase 3 content lands without engine refactor.

**Decision gate:** runtime AI cost vs revenue must balance. If cost runs ahead of revenue, throttle generation rate.

**Resource needs:** 5-7 engineers, 2-3 designers, 2-3 artists, 1 UX, 2-3 community, 2 BD, 1-2 ML ops.

### M12: Mature Platform (months 33-36+)

**Deliverables:**
- Phase 4 preview (Constellation / co-op planet-tending)
- Mature ad/marketplace/patronage ecosystem
- Multi-region active-active infrastructure
- Full modder economy (sell mods, earn rev share)
- Investment in community tools (clan management, alliance tools, mod tools)
- Open the architecture for third-party content partnerships

**Success criteria:** platform is mature; community is self-sustaining; revenue diversified across ads, marketplace, patronage, and potentially partnerships.

**Decision gate:** ongoing — V3 is iterative. Each new capability gets a small decision: ship now, ship later, don't ship.

**Resource needs:** 7-10 engineers, 3-4 designers, 3-4 artists, 2 UX, 3-4 community, 2-3 BD, 2 ML ops, 1 legal (full-time).

---

## Decision gates summary

| Gate | When | Decision | Criteria |
|---|---|---|---|
| **G1: Determinism** | End of M1 | Proceed with lockstep approach? | Fixed-point math achieves bit-determinism on all supported platforms |
| **G2: Core loop** | End of M2 | Is the loop fun? | Internal playtest validation |
| **G3: Content depth** | End of M3 | Are sessions long enough? | Average session length meets target |
| **G4: Onboarding** | End of M4 | Are beta players sticking? | Retention curves match targets |
| **G5: V1 viability** | End of M5 | Proceed to V2? | Soft launch retention + revenue thresholds |
| **G6: Lockstep prod** | End of M6 | Is determinism working in production? | Daily determinism CI passes |
| **G7: Community viability** | End of M7 | Is the community layer working? | Clans persisting, marketplace clean |
| **G8: PvP scale** | End of M8 | Is matchmaking healthy? | Match quality + AI content quality |
| **G9: V2 viability** | End of M9 | Proceed to V3? | V2 self-sustaining (revenue > costs) |
| **G10: AI quality** | Ongoing | Is AI content production-quality? | Player engagement on AI content matches human-authored |
| **G11: AI economics** | Ongoing | Are AI costs sustainable? | Cost per generation < revenue per match |

---

## Estimated timelines

| Phase | Months | Cumulative |
|---|---|---|
| M1 Foundation | 0-3 | 3 |
| M2 Core Loop | 3-6 | 6 |
| M3 Content Depth | 6-9 | 9 |
| M4 V1 Polish | 9-12 | 12 |
| M5 V1 Launch | 12-15 | **15 (V1 ships)** |
| M6 PvP Foundation | 15-18 | 18 |
| M7 Community Layer | 18-21 | 21 |
| M8 PvP Scale | 21-24 | 24 |
| M9 V2 Polish | 24-27 | **27 (V2 ships)** |
| M10 Living World Foundation | 27-30 | 30 |
| M11 Living World Scale | 30-33 | 33 |
| M12 Mature Platform | 33-36 | **36 (V3 mature)** |

**Caveats:** these are *estimates for a small focused team*. Actual timelines depend on team size, funding, and unknown unknowns. Mobile RTS dev is historically slower than these estimates would suggest; budget 1.5-2x for buffer.

---

## Resource needs per phase (typical)

| Phase | Engineers | Designers | Artists | UX | Community | BD | Specialist |
|---|---|---|---|---|---|---|---|
| M1-M2 | 1-3 | 1 | 1 (part) | 0-1 | 0 | 0 | 0 |
| M3-M5 | 2-5 | 1-2 | 1-2 | 1 | 0-1 | 0-1 | 0 |
| M6-M9 | 4-7 | 2-3 | 2-3 | 1 | 1-3 | 1-2 | 1 (networking) |
| M10-M12 | 5-10 | 2-4 | 2-4 | 1-2 | 2-4 | 2-3 | 1-2 (ML/ops) |

Total team size at M12 maturity: ~25-35 people. At M5 launch: ~8-12 people.

---

## Bootstrap-friendly notes

- **V1 is solo-feasible.** A small dedicated team (or even a solo developer with contractor support) can ship V1 in 12-18 months evenings + weekends pace.
- **V2 needs investment.** Network infrastructure, anti-cheat, and the marketplace require professional ops. Most likely funded by V1 revenue or seed investment between M5 and M6.
- **V3 needs scale.** AI inference costs, infrastructure for live-world state, and the moderation team for community-scale content all want institutional backing.

The phasing means V1 can be built and shipped before significant external capital is required. V1 revenue then proves the model before V2 investment. V2 revenue proves the marketplace before V3 investment. **Each phase pays for the next.**

---

## Open questions

- OPEN[2026-05-27]: target platforms for V1 (iOS only, Android only, both, web included?). Recommendation: iOS + Android at launch, web build as M5 stretch goal. blocks: M5 launch plan.
- OPEN[2026-05-27]: closed beta size and recruitment strategy (M4). blocks: M4 detailed plan.
- OPEN[2026-05-27]: which regions for V1 soft launch (M5)? Smaller English-speaking markets typical; potentially Canada or Australia first. blocks: M5 detailed plan.
- OPEN[2026-05-27]: tournament format and seasonal cadence (M9). blocks: M9 detailed plan.
- OPEN[2026-05-27]: AI provider selection for V3 agents (M10). Defer until M9 ends.

## Cross-references

- [DESIGN.md](../DESIGN.md) — design constitution
- [docs/architecture.md](architecture.md) — what's being built (module-level detail)
- [docs/phasing.md](phasing.md) — V1/V2/V3 scope definitions (future doc)
- [docs/infrastructure.md](infrastructure.md) — server-side infrastructure aligned to phases
- [docs/monetization.md](monetization.md) — revenue model details
- [docs/risks.md](risks.md) — risk register that informs decision gates
- [docs/prototype-scope.md](prototype-scope.md) — M1-M2 detail (future doc)
- [pitch/PITCH.md](../pitch/PITCH.md) — external business view
