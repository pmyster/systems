# [Project Codename] — Investment / Acquisition Brief

*A mobile RTS designed to live as a platform for a decade.*

---

## Executive Summary

A post-apocalyptic mobile real-time strategy game built on three architectural bets that no current mobile RTS combines:

1. **A data-driven engine** where every game rule — every unit, weapon, environment, AI behavior, even the physics equations — is content that the engine interprets at runtime. Updates ship as small JSON files, not engine rebuilds. Modders, AI agents, and players all extend the universe through the same content format.

2. **A premium model that explicitly rejects pay-to-win.** $2.99 unlocks the full game after a free demo; every buyer plays by the same rules. A post-launch creator marketplace lets players sell custom unit designs to each other (platform fee ~8%, vs. industry standard 30%). Twelve predatory monetization patterns (time-skip currency, lootboxes, FOMO, subscriptions, price ladders, manufactured scarcity, spending-leaderboards, pay-to-resurrect, etc.) are *architecturally absent* — not just unimplemented but unimplementable without explicit constitutional amendment.

3. **An AI-augmented narrative pipeline** that turns the game into a living world. Production-time AI agents generate PvE invasion scenarios and faction dynamics responsive to player behavior; later, runtime agents craft narrative in near-real-time. Content scales beyond what any team could author.

The design is comprehensively documented across 17+ technical specifications totaling ~30,000 words. The architecture supports a four-phase content roadmap (Earth → Lunar → Interstellar → Co-op Civilization) using the same engine without refactor — each phase is content, not engine work.

**Status:** design phase complete; engineering not yet started. The full design specification is ready to hand to an engineering team.

**Revenue model:** premium one-time purchase ($2.99) after free demo serves as the entry fee and commitment mechanism; **diegetic in-world ads (faded post-apocalyptic billboards, hologram signs) are the bread-and-butter ongoing revenue** that scales with active community and funds V2/V3 development. Creator marketplace (V2+) and optional patronage (V2+) layer on top. No subscriptions. No pay-to-win. No in-game purchases that affect gameplay.

**Phased delivery:** V1 (PvE-only paid game, ~15 months) revenue-positive on sales + ramping ad revenue before V2 (PvP, ~12 months) and V3 (Living World, ~12 months) investment. V2 and V3 ship as free updates to V1 buyers — the marketplace and Living World are content expansion, not separate SKUs. **Each phase ships into a revenue base that covers the next phase's infrastructure costs many times over.** The project is structurally capable of bootstrapping from launch revenue alone.

---

## The Vision

The mobile RTS genre is dominated by predatory free-to-play games where the design *forces* players into PvP, *forces* progress loss through resets and raids, and *converts frustration into spending* via $5-100 packs. Player communities resent the model but pay because the alternative is leaving.

This project rejects that frame. It builds the depth of Supreme Commander and Total Annihilation, on mobile, with:

- **Real terrain** — heightmap, ballistic physics, line-of-sight that depends on position. Where you stand matters.
- **Information warfare as a resource sink** — radar, cloak, jammers, shields cost ongoing power; knowing more than the opponent is the actual advantage.
- **Dig-in & defend rhythm** — find favorable ground, build economy, fortify, then project. Tower-defense pacing inside an RTS shell.
- **Modular unit construction** — separate desktop/tablet companion app for designing custom units; voxel chassis + hardpoint-snapped parts; outputs JSON Schematics the game loads.
- **Asynchronous offline PvE** — base persists in the world; storms and AI-generated invasions pressure it while the player is offline; defenses earn their keep.
- **PvP is opt-in, PvE is always-on** — players choose their threat level. Solo players have genuine sanctuary; competitive players have ladders. **The single most-requested feature in the mobile RTS genre** — and the design's central commitment.

The persistence layer means the player's commander is a character with a history: rank, faction reputation, salvaged tech library, custom designs, conquered enemies. A Hall of Conquered Flags collects trophies from defeated factions and players, each carrying its replay clip and lineage. **Stories accumulate.** That's the long-game.

---

## Market Opportunity

The mobile RTS / mobile strategy market generates ~$15B+ annually with consistent growth. Dominant titles (Clash of Clans, State of Survival, Last Shelter Survival, Age of Origins, Lords Mobile) share a near-identical monetization model — and a near-identical player resentment.

**The gap:** a mobile RTS that respects players. Players don't want shallow PvP-or-nothing. They want depth, agency, and the freedom to engage at their own pace without losing months of progress to whales.

**The audience:** strategy gamers who grew up on Supreme Commander, Total Annihilation, Command & Conquer, StarCraft. Now in their 30s-50s, with disposable income, smartphones, and limited time. Want depth without the grind. Won't tolerate exploitation. Have specifically been waiting for a real RTS on mobile that doesn't compromise.

**The differentiator from existing mobile RTS:** depth (real physics, real terrain, real economy) + ethics (no P2W, transparent ads, creator economy) + endurance (AI-augmented content + invariance guarantees + modular architecture = decade-long lifespan).

---

## Differentiation: The Five Bets

### 1. Schematic-everything architecture

Every game rule is a JSON file the engine reads at runtime. Adding a unit, weapon, environment, AI behavior, or even a physics equation is a content change, not an engine change.

**Consequence:** the same architecture that lets us ship content updates as small file downloads also lets modders extend the universe, also lets AI agents author narrative, also lets players design custom units in the companion app. **One architecture, four content sources.**

**Competitive moat:** existing mobile RTS engines are hard-coded; adding a new unit requires an engine update and full re-release. Our architecture is structurally faster to iterate and infinitely more extensible.

### 2. Physics constitution + invariance guarantee

The engine has a four-layer physical foundation: Constants (real physics + game-tuned coefficients), Equations (named formula Schematics), Environments (per-map variables), Models (units that declare physical inputs only). Gameplay numbers are *derived* from physics, not typed in by designers or players.

**The invariance rule:** Constants and Equations are additive-only. New ones can be introduced forever; existing ones never change. Schematics carry version markers; old content keeps working under its original version forever.

**Consequence:** a unit built in year 1 still works in year 10. A 5-year-old replay plays correctly. Updates can't silently buff or nerf player-built units. **PvP balance is honest, by construction.**

**Competitive moat:** this is the architecture that enables a game to live for ten years. Competitors who hard-code balance and ship "rebalance patches" inherit the trust deficit those patches create.

### 3. Anti-pay-to-win as a constitutional commitment

The design constitution names twelve forbidden monetization mechanics — patterns the game *cannot ship* without explicit constitutional amendment. These are the mechanics that make Age of Origins, Last Shelter, and similar titles predatory: time-skip currency, resource purchases, subscriptions, price ladders, FOMO, lootboxes, manufactured scarcity, spending milestones, pay-to-resurrect, paid matchmaking advantage, spending-leaderboards, pay-to-win marketing.

**The revenue model that fits this commitment:**
- Diegetic in-world ads (faded billboards on ruins, hologram signs in dead cities) — fit the post-apocalyptic aesthetic, sell as world texture, no UI interruption
- Creator marketplace where players sell their custom unit designs to each other (~$0.25 per design, ~8% platform fee)
- Optional patronage (no in-game benefit; voluntary support)
- No subscriptions, no resource purchases, no time-skip

**Consequence:** the game cannot become Age of Origins because the mechanisms that drove Age of Origins' $5-100 pricing don't exist in the architecture. Players who've been burned by predatory mobile games will recognize the difference immediately.

**Competitive moat:** trust. The model is structurally incapable of exploitation. Competitors who try to copy will have to keep their P2W mechanics; their players will compare and switch.

### 4. PvE-first, PvP-optional

PvE is always on (storms, world events, AI invasions). PvP is opt-in with hard sanctuary rules — flag PvP off and your territory is inviolable.

**Consequence:** solo players have a real game. Competitive players have a real game. Neither subsidizes the other. **This is the answer to the #1 player complaint in the mobile RTS genre.**

**Competitive moat:** competitors built around forced PvP can't pivot here without breaking their entire game loop. We can ship this from day one.

### 5. AI-augmented content pipeline

Production-time AI agents observe player activity globally, identify narrative-interesting situations (rising clans, contested regions, tech proliferation patterns), and draft PvE invasion arcs and faction dynamics that respond to what players are actually doing. Quality gates validate against the design constitution before deployment. Human curators approve before live.

Runtime agents (V3) act on the live world in near-real-time — naming opponents, generating post-match chronicles, drafting follow-up invasions for players who defended an unusually hard siege.

**Consequence:** content scales beyond team capacity. A small team's ongoing content pipeline can match (and eventually exceed) what large studios produce by hand. The world feels *alive* in a way scripted content cannot achieve.

**Competitive moat:** this is hard to copy. The architecture that makes AI content safe (Schematic format + physics constitution + quality gates against the constitution) is the architecture we designed first. Competitors retrofitting AI into hard-coded engines will fight balance and lore drift constantly.

---

## Technical Innovation

The engine is a **federation of eleven modules** sitting on a **four-layer physics constitution**. Each module has a single responsibility, a stable interface, and can be reimplemented without affecting others.

- The simulation is fully **deterministic** (fixed-point math, seeded PRNG, ordered operations). Same inputs + same Schematics produce identical outcomes on every device. **Enables lockstep multiplayer with 1-5 kbps per player** — vs. typical mobile RTS which require server-authoritative state streaming.
- The architecture **isolates risk**: if lockstep determinism proves too hard on mobile in practice, the Network Sync module is the only thing that needs to change. Physics, AI, persistence, rendering are all unaffected.
- The **invariance rule** at the schematic level mirrors at the code level: module interfaces are versioned, old implementations coexist with new during migration.
- **Bandwidth is a design constraint, not a measurement**. Target: ~100 MB / active player / month. Achievable because lockstep PvP streams only inputs; offline PvE uses zero network; content updates are JSON deltas.

**Infrastructure economics at 100K MAU:**
- V1 (PvE-only): ~$1-5K/month operating cost. Ad revenue likely $5-50K/month. Comfortable margin.
- V2 (with PvP): ~$10-30K/month operating cost. Adds marketplace revenue.
- V3 (with Living World AI): ~$50-150K/month. AI inference is the largest variable cost; mitigated by caching, cohort-sharing, and throttling.

Each phase is revenue-positive before the next phase begins. **The project bootstraps from V1 ad revenue alone**, with optional investment to accelerate V2 and V3.

---

## Revenue Model

### Stream 1: Premium One-Time Purchase (V1 onward)

A free demo (1-2 PvE skirmishes, ~30-60 minutes) introduces the world, the core loop, and the unit Editor. **$2.99 unlocks the full game.**

**The $2.99 is more than revenue — it's a commitment mechanism.** Once a player pays, the endowment effect activates: they engage longer, tolerate small issues, recommend to friends, and form communities around something they paid into. The studio in turn earns a direct relationship with each buyer and a clear obligation to ship future content.

This is the foundation of the V2/V3 investment case: V1 ships into an *invested* base. When V2 PvP and V3 Living World ship as free updates to V1 buyers, those buyers don't churn — they feel rewarded for buying early. Trust compounds. Each phase ships into a community ready for it, not into an attrition curve.

**V2 PvP and V3 Living World are free updates to V1 buyers.** New buyers continue to pay $2.99 at any point and receive the full current state of the game. The marketplace and Living World are content expansion, not separate SKUs.

**Conversion economics:** at 1M demo downloads / 30% Skirmish-1 completion / 50% Skirmish-2 completion / 30% buy-conversion = ~45K buyers per million demos × $2.09 net (after app store cut) = ~$94K per million demos. Premium per-acquisition is lower than F2P-with-ads, but: cleaner experience, higher-quality players (pre-vetted as willing-to-pay), simpler operations, and the commitment effect amplifies LTV.

### Stream 2: Diegetic In-World Advertising (V1 onward — bread-and-butter ongoing revenue)

The post-apocalyptic frame makes this stream uniquely natural. Pre-Fall corporate signage — faded billboards on ruined gas stations, hologram signs flickering above dead cities, brand decals on rusted trucks — *is* the world's aesthetic. Real-brand placements (Coke, Pepsi, Toyota, Mountain Dew) work because the world that fell was ours.

**This is the ongoing revenue stream that funds V2 and V3 development.** While the $2.99 purchase is a one-time event per buyer, ad placements generate revenue continuously from every active session. Revenue scales with active community (MAU), not with the new-acquisition treadmill. Conservative projection at $1.50/MAU/month: 100K MAU yields $150K/month; 1M MAU yields $1.5M/month. **Each phase ships into a revenue base that already covers the next phase's infrastructure many times over.**

**Why ads work in the paid game:** they're diegetic, not promotional. A faded Coke billboard on a ruined highway is the *kind of thing* the post-apocalyptic world contains. Removing them would make the world feel less real. They serve double duty — aesthetic texture for the player and revenue from the advertiser. Unlike F2P ad mechanics that extract value from players (interruptions, rewarded video, forced views), these ads exist *in* the world and the player never has to engage with them.

**Hard rules** (player protections, architecturally enforced): diegetic only (never UI overlays or interruptions), atmospheric not promotional (no CTAs), no interaction required (no watch-ad-for-resources), density caps per map (placement budget declared by environment Schematic), free minimal-ads opt-out toggle, optional ad-removal one-time purchase ($2-5) for ad-averse players.

**Brand-safety controls:** each real-brand placement is contractually approved by the advertiser; contextual filtering ensures inappropriate juxtapositions are avoided; cultural-sensitivity review per region; full trademark licensing.

Players sell their custom unit designs to other players. Single design: $0.25. Pack of 5: $1.00. Premium experimental: $1.00.

Platform fee: $0.02 per $0.25 transaction (8%). Creator-generous (Roblox takes 75%, Steam 30%, Apple 30%). **Closer to Stripe's payment-processing economics than to content-store economics.**

**Safeguards** (constitutional, not optional):
1. Every purchasable design has free competitive counterparts
2. Every purchasable design is also earnable through play (~5-20 hours equivalent)
3. Stock-only PvP brackets exist as first-class modes
4. Per-match design cap (8-12) — buying 100 designs doesn't enlarge in-match toolbox
5. No FOMO, no limited-time exclusives
6. Marketplace gates behind verified-adult accounts
7. Quality gates apply (constitution-validated)
8. Salvageable with original creator attribution preserved
9. Refund window (14 days unless used)
10. Full transparency (creator name, sales count, ratings, earn-path equivalent)

**Revenue at scale:**
- 100K MAU × 10% marketplace engagement × 5 designs/year × $0.02 fee = ~$25K/year platform revenue
- 1M MAU = ~$250K/year
- 10M MAU = ~$2.5M/year

Marketplace is *additive* to the base game price. At scale, becomes a meaningful second ongoing revenue stream (the first being new-buyer acquisition).

### Stream 4: Optional Patronage (V2 onward)

Voluntary monthly contribution (Patreon-style). **Zero in-game benefit.** Players who want to support the project can; players who don't, don't. Distinguishable from subscriptions: no lock-in, no expiration of features, no FOMO.

**Revenue:** modest but meaningful at scale. ~1-3% of MAU typical for game patronage.

### What we explicitly do not monetize

- Loot boxes / random rewards
- Resource purchases (Power, Scrap, Fuel, Tech Fragments)
- Time-skip currency
- VIP / subscription tiers
- Per-match advantages
- Cosmetic purchases beyond the marketplace
- FOMO / limited-time exclusives
- Pay-to-resurrect / pay-to-protect
- Spending-based ranks / leaderboards

---

## Phased Rollout

| Phase | Timing | Features | Infrastructure | Revenue Profile |
|---|---|---|---|---|
| **V1 PvE** | Months 0-15 | Free demo + $2.99 paid PvE game, Editor App, Hall (PvE), async design sharing, diegetic ads active in demo and paid | $0.7-2K/mo at 10K MAU | Sales (~$94K/million demos) + ad revenue ramping with MAU ($15K-150K/mo at 10K-100K MAU) |
| **V2 PvP** | Months 15-27 | Lockstep PvP, clans/alliances, marketplace, Phase 2 content (Lunar) — **free upgrade to V1 buyers** | $10-30K/mo at 100K MAU | Continuing sales + ads (now bread-and-butter at $150K-1M/mo) + marketplace |
| **V3 Living World** | Months 27-36+ | AI runtime narrative, Phase 3 content (Reach), mature community ecosystem — **free upgrade to V1 buyers** | $50-150K/mo at 1M MAU | Mature mix: sales + ads ($500K-3M/mo) + marketplace + patronage |

**Decision gate between phases:** each phase must demonstrate retention and revenue before the next is funded. The architecture supports stopping at any phase if returns warrant — V1 is a complete game; V2 adds the social layer; V3 adds the living-world dynamism.

---

## Team / Status

**Status:** Design phase complete. 17+ technical specifications totaling ~30,000 words. Architecture documented module-by-module. Roadmap defined milestone-by-milestone. The design is comprehensively transferable.

**IP status:** owned by the founder. No external IP entanglements. Concept art originals (faction badges, flag) created in-house.

**Engineering:** not yet started. M1 (the foundational sprint) is ready to begin upon team formation.

**What an acquirer or investor receives:**
- Full design specification (this document + 17+ supporting docs)
- Modular architecture ready for engineering execution
- Comprehensively documented decision history (the principles + the reasoning behind each)
- A roadmap with quantitative success criteria at each milestone
- A risk register with mitigations
- A monetization model that survives commercial pressure
- A position in a market segment with $15B+ TAM and a clear differentiation gap

---

## Investment / Acquisition Opportunity

This is a project that can take three paths:

1. **Founder-led with seed funding.** The design is small-team-shippable for V1. Seed funding accelerates timeline to V1 launch and de-risks V2 transition. Founder retains control. Founder receives funding partner equity.

2. **Acquired pre-engineering.** A studio or strategic buyer with mobile RTS experience purchases the IP and design specification, builds out from M1 with their existing engineering. Founder participates as consulting designer or transitions out. Fastest path to V1 launch under acquirer's brand.

3. **Acquired mid-V1.** Project demonstrates execution to M2 or M3 milestone, then a strategic buyer or larger publisher acquires for V2-V3 build-out. Validates the design via working software before the acquisition cost is justified.

**Realistic valuation ranges** (subject to market and stage):
- Pre-engineering design only: equivalent to a comprehensive game design document, comparable transactions in mobile gaming range from $50K-500K for the IP and design.
- Post-M2 with playable prototype: $500K-5M depending on validation strength.
- Post-V1 launch with retention proof: significantly higher (multiples of demonstrated revenue).

The design is structured to be valuable at each stage, not just at completion.

---

## Risk Profile

Honest assessment of known risks (full register in `docs/risks.md`):

| Risk | Severity | Mitigation |
|---|---|---|
| Onboarding ramp loses new players | **High** | Dedicated design pass; progressive complexity revelation; M4 milestone includes tutorial work |
| Lockstep determinism on mobile | **High** | Fixed-point math; M1 gate validates feasibility; Network Sync module is swappable to server-authoritative if needed |
| AI content quality at scale (V3) | **Medium** | Quality gates against constitution; human-review fallback; ship-nothing acceptable over ship-bad-content |
| Mobile performance for ambitious physics | **Medium** | LOD physics; distance-based fidelity; M1 prototype validates against realistic load |
| Marketplace P2W feel even with safeguards | **Medium** | Twelve forbidden mechanics codified; stock-only brackets first-class; per-match cap |
| Brand-sales infrastructure (real-brand ads) | **Medium** | V1 launches with fictional analogues; real-brand pipeline is M9 work; not blocking V1 |
| Moderation cost scales with playerbase | **Low** | Visibility-tiered approval model; clear escalation; budget at ~1 moderator per 5K MAU in public-visible band |
| Bandwidth budget in poor markets | **Low** | WiFi-only sync option; offline-first emphasized; ~100 MB / player / month design target |

**No identified risks are existential to the design.** All have mitigation paths. Most are common to mobile game development; few are unique to this project.

---

## Why Now

- **Mobile player resentment of predatory monetization is at all-time high.** Reviews of dominant titles are increasingly hostile. Players want an alternative.
- **AI-augmented content generation is technically feasible for the first time.** LLMs can produce coherent narrative; quality gates can validate against constitutional rules. V3 was impossible in 2020; it's plausible in 2026.
- **Cross-platform mobile game development is mature.** Unity + iOS + Android + (web) is well-trodden. The architectural risk in 2026 is much lower than five years ago.
- **The strategy-gamer demographic with disposable income is now mobile-first.** The C&C / SupCom generation grew up; they have phones and money; nobody has built for them on mobile yet.

The convergence of (a) player demand for fair monetization, (b) AI maturity for content generation, and (c) mobile platform maturity for ambitious games makes 2026-2027 the right window.

---

## Contact / Next Steps

This brief is part of a comprehensive design package. Full materials available on request:

- DESIGN.md (master design contract)
- docs/architecture.md (technical architecture)
- docs/roadmap.md (milestones and gates)
- docs/schematics.md (data format spec)
- docs/physics.md (engine variables)
- docs/factions.md (the four canonical factions)
- docs/world.md (setting and fiction frame)
- docs/glossary.md (canonical terminology)
- docs/monetization.md (revenue model details — when written)
- 17+ additional system specifications

Concept art (faction badges, flag) included in the package.

---

*This document is a sales document. The internal technical and design documents are the engineering reference. Together they form a complete project ready for capitalization or acquisition.*
