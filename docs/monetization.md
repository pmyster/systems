# Monetization

## TL;DR

- **$2.99 premium one-time purchase** (after free demo) is the entry fee and commitment mechanism — one-time per buyer.
- **Diegetic in-world advertising is the bread-and-butter ongoing revenue.** Scales with monthly active users (MAU), not with new-buyer acquisition. Funds V2 and V3 development.
- **Creator marketplace** (V2+, ~8% platform fee on player-to-player transactions) + **optional patronage** (V2+) are supplementary streams.
- **Twelve forbidden mechanics** are constitutionally absent — not just unimplemented but structurally impossible without an explicit constitutional amendment.
- Revenue model is structurally incapable of Age-of-Origins-style exploitation because the mechanisms that drove that exploitation don't exist in the architecture.

## Scope

This document owns:
- The full revenue model and pricing decisions
- The economics of each stream and their interactions
- Ad-serving infrastructure design
- Brand-sales operations model
- Marketplace economics and the ten safeguards
- Patronage tier design
- The twelve forbidden mechanics with explicit rationale
- Revenue projections by phase
- Decision points and open questions

Does NOT own:
- Payment processing technical implementation (engineering scope)
- Legal frameworks (brand contracts, GDPR, COPPA — `docs/risks.md` flags; full legal review pre-launch)
- Specific brand partnership negotiations (BD scope, operational)
- App store fee structures (handled by store; ~30% to Apple/Google standard)

## Prerequisites

- [DESIGN.md](../DESIGN.md) — Principle 8 (Money buys creativity or time, never power) and the twelve forbidden mechanics
- [docs/architecture.md](architecture.md) — the engine that delivers ad content as Schematics
- [docs/roadmap.md](roadmap.md) — phases that this revenue model funds
- [pitch/PITCH.md](../pitch/PITCH.md) — external statement of this model

---

## The revenue ladder

Four streams, layered by phase. The earlier streams are designed to fund the later ones; no stream is load-bearing alone.

| Stream | Active in | Revenue type | Scales with | Role |
|---|---|---|---|---|
| 1. Premium purchase | V1 onward | One-time, $2.99 | New buyers | Entry fee + commitment mechanism |
| 2. Diegetic ads | V1 onward | Recurring | MAU + engagement | **Bread-and-butter ongoing revenue** |
| 3. Creator marketplace | V2 onward | Per-transaction, ~8% fee | Active community + creator output | Secondary; grows with marketplace activity |
| 4. Optional patronage | V2 onward | Recurring, voluntary | Player goodwill | Supplemental; modest but meaningful |

The forbidden mechanics list (twelve patterns) is the negative space — what these four streams explicitly do NOT do.

---

## Stream 1: Premium One-Time Purchase ($2.99)

### The model

After a free demo (1-2 PvE skirmishes, ~30-60 minutes of play designed to hook), the player encounters the paywall: $2.99 unlocks the full game. One-time. No subscription. V2 PvP and V3 Living World ship as free updates to V1 buyers.

### Why $2.99

Any payment threshold triggers the endowment effect (the psychological commitment is binary, not proportional). $2.99 is the sweet spot:

- Low enough to be an **impulse buy** — the threshold below which "let me think about it" becomes "sure, why not."
- High enough to feel **real** — not "junk app" territory (~$0.99) where players don't take it seriously.
- Below $5 — where the "is this worth it?" hesitation kicks in and conversion drops sharply.
- Industry-standard for premium indie mobile games (Stardew Valley, Minecraft Pocket, etc. cluster in this range).

### The commitment mechanism

This is the architectural insight that justifies the price beyond the immediate revenue: **paying creates a player who is invested in the game's success.**

Once a player has paid, the endowment effect activates:
- They play longer (sunk-cost engagement).
- They tolerate small issues that would chase a free player away.
- They recommend the game to friends — with the honest pitch "you pay once, no microtransaction garbage."
- They invest in their own progression (Halls, designs, salvaged tech, faction reputation) because they paid to be there.
- They engage with community features (clans, marketplace, alliances) because they're committed to a community of fellow buyers.

The studio side of this commitment matters too:
- We have a direct relationship with each buyer. They bought us; we owe them.
- We have a clean, defensible metric (sales) that proves market fit.
- We have an obligation to ship future content, which forces discipline.
- When V2 and V3 ship as free updates, buyers don't churn — they feel rewarded for buying early.

**This is the foundation of the V2/V3 investment case.** Each phase ships into an *invested community*, not into an attrition curve.

### Conversion economics

Target funnel for the free demo → paid game conversion:

| Stage | Target conversion | Per million demo downloads |
|---|---|---|
| Demo downloads | 100% (baseline) | 1,000,000 |
| Skirmish 1 completion | 30% | 300,000 |
| Skirmish 2 completion | 50% of S1 | 150,000 |
| Buy after S2 | 30% of S2 | 45,000 buyers |

Net revenue per buyer (after app store 30% fee): $2.09.
Net revenue per million demos: ~$94K (one-time).

Industry benchmarks for premium mobile games suggest 1-5% demo-to-buy conversion. We target 4.5% because the hook is designed to convert (see `docs/demo.md` when written).

### The hook (where conversion is won or lost)

The 1-2 free skirmishes are the most marketing-critical content in the project. They must:

1. **Land the core loop** — terrain, physics, units, the "oh, this is *real*" moment.
2. **Hint at depth** — Editor App glimpse, Hall placeholder, mention of factions.
3. **Tell a piece of the story** — the Fall, the player's awakening, why they matter.
4. **End on want** — cliffhanger or revelation demanding continuation.

If the demo fails, no other revenue stream rescues the project. If the demo succeeds, every other stream builds on it. **`docs/demo.md` will own the beat-by-beat design.**

### Pricing future-proofing

- **Existing buyers always get V2 and V3 free.** No "now pay again for multiplayer." Buyers feel rewarded for buying early.
- **New-buyer pricing can adjust upward** as content grows. A buyer in Year 3 might pay $4.99 because they're getting V1+V2+V3 day one. Day-1 buyers paid $2.99 for the privilege of being early; that's the bargain.
- **Bundle pricing:** a "Founder's Edition" at $4.99 in Year 1 could include early access, a Founder's badge for the Hall, and patronage credits. Cosmetic-only differentiation; no gameplay advantage. Optional revenue boost without violating Principle 8.

### Platform mechanics

- **App store payment processing:** Apple/Google handle the transaction; we receive ~$2.09 of $2.99 (after standard 30% fee).
- **Cross-device entitlement:** purchase tied to account, not device. iOS purchase enables Android play if account is linked.
- **Refund policy:** match app store standards (usually 14 days). For marketplace transactions, our own refund window applies (see Stream 3).

---

## Stream 2: Diegetic In-World Advertising

### The model

The post-apocalyptic frame makes this stream uniquely natural. Pre-Fall corporate signage — faded billboards on ruined gas stations, hologram signs flickering above dead cities, brand decals on rusted trucks, drink-machine logos in abandoned malls — *is* the world's aesthetic. Real-brand placements work because the world that fell was ours.

**This is bread-and-butter ongoing revenue.** While the $2.99 purchase is a one-time event per buyer, ad placements generate revenue continuously from every active session, in both the free demo and the paid game.

### Why ads work in the paid game

The standard objection — "I paid; why are there still ads?" — doesn't apply here because:

1. **The ads are diegetic.** They're part of the world's visual fabric, not a UI overlay. A faded Coke billboard on a ruined highway is the *kind of thing the post-apocalyptic world contains*. Removing them would make the world feel less real, not more.
2. **They're not promotional.** No "click to learn more." No "watch this ad to continue." No interrupt mechanics. The ads exist *in* the world; they don't interrupt gameplay.
3. **They serve double duty.** They're aesthetic texture *and* revenue. Most monetization mechanics extract value from the player; these add value (atmosphere) while extracting value (revenue) from the *advertiser*. The relationship is healthier.
4. **The framing is honest.** The pitch to players is: "Your $2.99 buys the game; the brands you see on the ruins help pay for ongoing development and new content." That's a deal players can accept.

### Two flavors of placement

**Real-brand placements** (paid by the brand):
- Real corporations — Coke, Pepsi, Toyota, Mountain Dew, Tabasco, etc.
- Generate ad revenue. Negotiated as long-term placement deals or via mobile-game ad networks specializing in in-world placement.
- Subject to brand sensitivity rules: brands sensitive to dystopian context are excluded. Some lean in (irony-positive brands like Mountain Dew, Tabasco, Cracker Barrel).
- Allocated to higher-traffic / higher-visibility map areas.

**Fictional analogues** (no monetization):
- Atomic Cola, Sunset Sarsaparilla, Reclaimer Salvage Co., DeepCore Mining, etc.
- Fill space where real brands won't go (sensitive lore moments, specific factional aesthetics, modder-uploaded environments).
- Maintain the post-apocalyptic aesthetic regardless of ad-sales pipeline status.
- Useful as a launch buffer (V1 launches with mostly fictional placements; real-brand inventory builds over time).

### Hard rules (player protections)

Encoded as architectural constraints, not soft promises:

1. **Diegetic only.** Ads appear *in* the world — billboards, holograms, signs, painted walls. Never as UI overlays, pop-ups, mid-match interruptions, or unskippable video reels.
2. **Atmospheric, not promotional.** A faded Coke sign reads as post-Fall texture, not "this is sponsored." No "watch ad to learn more" prompts. No CTAs.
3. **No interaction required.** Players never have to engage with an ad to progress, claim rewards, or do anything. No "watch ad for resources." No "tap to skip ad." No bonus-for-clicking.
4. **Density caps.** Each map's environment Schematic declares an ad-placement budget. Ruined cities have many; Lunar regolith plains have few or none. Player never feels saturated.
5. **Free opt-out exists.** A "minimal ads" toggle replaces brand assets with default scenery at no cost. Few players will toggle, but the option preserves trust.
6. **Optional ad-removal purchase.** A one-time $2-5 upcharge can remove all ads for that player ("clean world" license). Cosmetic only; no gameplay change. Provides revenue from ad-averse players without changing the game for them.

### Brand-safety controls

The post-apocalyptic context is sensitive territory for some brands. Controls:

- **Brand approval per placement.** Each real-brand placement is contractually approved by the advertiser for specific contexts.
- **Contextual filtering.** Algorithm + human review ensures specific brand assets don't appear in inappropriate contexts (e.g., violent scenes, child-targeted moments).
- **Cultural-sensitivity review.** Localized ad inventory respects regional norms. Some brands available in some regions; not all.
- **Trademark licensing.** All real-brand placements require licensing agreements with proper rights holders.

### Ad-serving infrastructure

Ad placements are Schematics. The architecture:

```
┌────────────────────────────────────────────────────────────┐
│ Ad Schematic                                                │
│   - placement_id (where in world)                           │
│   - asset_id (which SVG/texture)                            │
│   - validity_window (start/end dates of contract)           │
│   - target_regions (geo-restricted if needed)               │
│   - sensitivity_flags (contexts where it can/can't appear)  │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ Ad Server (server-side)                                     │
│   - Maintains current inventory                             │
│   - Pushes ad-content to clients at session boundaries      │
│   - Reports impressions back for billing                    │
│   - Handles brand-sensitivity filtering                     │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ Client                                                       │
│   - Renders ads as world texture (Rendering pipeline)       │
│   - Reports impressions back at session end                 │
│   - Respects opt-out / minimal-ads toggle                   │
└────────────────────────────────────────────────────────────┘
```

**Key design choices:**
- Ads delivered via CDN (cheap; same infrastructure as Schematic delivery).
- Impression reporting batched at session end (no per-second telemetry).
- Anonymized impression data (no individual tracking; aggregate counts only).
- Privacy-respecting by default (GDPR/CCPA-compatible without consent forms; CPRA-compliant; COPPA-respecting for under-13 accounts via no-tracking mode).

### Brand-sales operations

A real-brand ad revenue stream requires sales infrastructure. This is a real business function that ramps with the playerbase.

**Phase 1 (V1 launch, ~10K-100K MAU):**
- Self-serve ad placements via mobile-game ad networks (InMobi, Vungle, ironSource, etc.) — but only the diegetic-friendly inventory; no interstitials, no rewarded video.
- Direct partnerships with 2-5 launch brands for marquee placements.
- Part-time BD person handles relationships.

**Phase 2 (V2, ~100K-500K MAU):**
- Dedicated BD person. 10-20 direct brand partnerships.
- Custom ad inventory tools: brand portals to manage their own placements.
- Real-time inventory dashboards.

**Phase 3 (V3, 500K+ MAU):**
- BD team (2-4 people). Strategic partnerships with major brands.
- Sponsorship integrations: branded factions, branded events, branded maps. All optional, all diegetic-only.

### Revenue economics

Mobile game ad revenue benchmarks for premium games with diegetic placements:

- **eCPM** (effective cost per thousand impressions): $1-10 for standard diegetic placements; $5-20 for marquee high-traffic positions.
- **RPM** (revenue per thousand player-sessions): $0.50-3.
- **ARPDAU** (average revenue per daily active user): $0.05-0.20.
- **ARPMAU** (per monthly active user): $1-3 typical; $3-5 at high engagement and full inventory.

Conservative projection at $1.50/MAU/month:

| MAU | Monthly ad revenue | Annual |
|---|---|---|
| 10K | $15K | $180K |
| 100K | $150K | $1.8M |
| 500K | $750K | $9M |
| 1M | $1.5M | $18M |

**This is the engine that funds V2 PvP development (the ~$10-30K/month V2 infrastructure cost at 100K MAU is dwarfed by $150K/month ad revenue) and V3 Living World infrastructure (~$50-150K/month V3 costs at 1M MAU vs. $1.5M/month revenue).**

Each phase ships into a revenue base that already covers the next phase's costs many times over.

---

## Stream 3: Creator Marketplace (V2 onward)

### The model

Players sell their Editor-App-built unit designs to other players. The platform takes a small fee.

Pricing:
- Single unit design: $0.25
- Pack of 5 unit designs: $1.00
- Premium experimental design: $1.00

Platform fee: $0.02 per $0.25 transaction (~8%). Creator receives $0.23.

**This is creator-generous** (vs Roblox 75% take, Steam 30%, Apple 30%). Closer to Stripe's pure-payment-processing economics than to content-store economics. Creators are motivated to sell here.

### The ten safeguards (architectural rules)

These are not soft promises. They are encoded as architectural constraints that the engine enforces:

1. **Every purchasable design has free competitive counterparts.** For every functional role a purchased unit serves, the game's stock library includes a competitive free unit. No paid-only strategic options.

2. **Every purchasable design is also earnable through play.** The Scientist salvage mechanic (in `docs/tech.md`) provides one path; specific achievements unlock specific purchased designs as alternates. **Time can substitute for money everywhere.** Target equivalence: ~5-20 hours of focused play per design.

3. **Stock-only PvP brackets exist as first-class modes.** "Pure skill" PvP uses only baseline + self-designed units. No purchased content allowed. Players who want a level playing field always have one.

4. **Per-match design cap.** A player can field at most N unique unit designs per match (proposed 8-12 — to be tuned in playtest). Buying 100 designs gives a bigger library, not a bigger in-match toolbox.

5. **No FOMO mechanics, ever.** No limited-time exclusives. No daily-deal pressure. No artificial scarcity. Every design is evergreen.

6. **Marketplace defaults off until age-confirmed.** V1 and early V2 ship marketplace as opt-in for verified-adult accounts only. Minors play the full game without marketplace exposure. Parental-controlled spending caps for younger accounts.

7. **Quality gates apply to submissions.** The same constitution-validation that protects against modder breakage applies to marketplace submissions. No physics violations. No degenerate strategies. Curation removes meta-warping designs.

8. **Salvageable, with attribution preserved.** Purchased designs can be salvaged in-match by Scientists — but salvaged variants are degraded (per existing Salvage Signature mechanic) and don't carry the original creator's signature for resale. Purchase = full fidelity + attribution. Salvage = working variant + still attribution. Both paths preserve creator credit.

9. **Refunds exist.** 14-day refund window unless the design has been used in 5+ matches. Treat creators and buyers as commercial parties with the rights commercial parties expect.

10. **Transparency.** Every purchased design displays: creator name + signature, creation date, sales count, average rating, "playtime equivalent" (the alternate earn path). Buyer knows what they're getting and why.

### Marketplace operations

**Revenue at scale:**

| MAU | Marketplace engagement | Designs sold/year/buyer | Annual platform revenue |
|---|---|---|---|
| 100K | 10% | 5 | $25K |
| 500K | 12% | 5 | $150K |
| 1M | 15% | 6 | $360K |
| 10M | 15% | 8 | $4.8M |

**Operationally:**

- Creator dashboards: track sales, ratings, royalty payments.
- Payment processing: standard payment processor (Stripe-like). Creators paid out monthly.
- Tax handling: creators receive 1099/equivalents for tax-reporting purposes (US) or relevant local equivalents.
- Anti-abuse: pattern detection for fake-account sales, bot-driven inflation, copyright infringement.

### Marketplace + ads interaction

Marketplace revenue and ad revenue compound: marketplace players are *more engaged* than average, and engaged players see more ads. A vibrant marketplace amplifies ad revenue rather than competing with it.

This is structurally different from F2P games where loot boxes and ads compete for player wallet. Here, marketplace transactions are between players (we take only 8%), and ad revenue comes from brands (we take 100% of negotiated rates). No conflict.

---

## Stream 4: Optional Patronage (V2 onward)

### The model

Voluntary monthly contribution (Patreon-style). Players who want to support the project can. **Zero in-game benefit.**

- **Not a subscription.** No lock-in. No feature loss when stopped. No exclusive content.
- **Not a tier system.** Don't divide patrons into "gold/silver/bronze." Treat them all the same.
- **Distinguishable from a Founder's Edition.** Founder's Edition is a one-time upgrade with cosmetic perks (Hall badge); patronage is ongoing voluntary support with no perks.

### Why this works (and doesn't violate Principle 8)

The principle is "Money buys creativity or time, never power." Patronage buys neither creativity nor time nor power — it's voluntary support of the project's continued existence. Some players want to fund the game because they believe in it; the engine supports them doing so.

The key constraint: **patronage doesn't unlock anything that's not also accessible by free or paid players.** No exclusive cosmetics. No private maps. No early access. No "patrons can do X." The only difference between a patron and a non-patron is that the patron has decided to fund development.

### Revenue scale

Modest but meaningful. Game patronage typical engagement: 1-3% of MAU contributing $3-10/month.

At 100K MAU: ~$5K-30K/month.
At 1M MAU: ~$50K-300K/month.

Patronage is small relative to ad revenue at scale but adds resilience and demonstrates community goodwill.

---

## The Twelve Forbidden Mechanics

These are the mechanics that would convert this game from "respectful premium with ads" into "Age of Origins-style predatory." They are constitutionally absent — the engine has no primitive to implement them. Adding any of them would require an explicit constitutional amendment with documented reasoning.

The list, with explicit rationale for each:

### 1. No time-skip currency

**What it is:** in Age of Origins / Lords Mobile / similar, you can pay to skip waits (construction, research, training, healing). The waits exist *because* the currency exists; remove the currency, the waits become meaningless or removable.

**Why we forbid it:** time-skip is the most predatory pattern in mobile gaming. It manufactures frustration (the wait) then sells the relief. Players who don't pay feel frustrated; players who do pay feel exploited.

**Our position:** all progress is play-based. No paid acceleration. No "instant completion" tokens. Building, researching, healing, training all complete at their natural pace.

### 2. No resource purchases

**What it is:** "Buy 1000 Gold." "Buy 50 Tech Fragments." "Buy 200 Energy."

**Why we forbid it:** resources are the in-game economy. Selling them directly bypasses the gameplay loop entirely.

**Our position:** resources are earned in-game. Period. Power, Scrap, Alloy, Fuel, Tech Fragments, Exotic Matter, and all map-specific resources are play-only.

### 3. No subscription tiers

**What it is:** monthly fees that grant ongoing benefits. VIP tiers with progressive perks.

**Why we forbid it:** subscriptions create lock-in pressure. Players keep paying because stopping would mean *losing* what they had. This is a hostage-style monetization.

**Our position:** purchases are one-time. Patronage exists but provides no in-game benefit; stopping patronage doesn't lose anything in-game.

### 4. No price ladders / pack escalations

**What it is:** $5 / $20 / $50 / $100 packs designed to upsell players to higher tiers through "value" (bigger pack, more per dollar).

**Why we forbid it:** price ladders normalize spending more. The $100 pack only seems reasonable because the $5 pack exists.

**Our position:** flat pricing on everything. $2.99 for the game. $0.25 for a marketplace design. $1.00 for a pack of 5 marketplace designs (same per-design price; the pack is convenience, not discount escalation).

### 5. No FOMO / limited-time exclusives

**What it is:** "This pack expires in 23 hours." "Limited-edition skin only available this weekend."

**Why we forbid it:** FOMO is the predatory pattern. It manufactures urgency to bypass deliberation.

**Our position:** all marketplace content is evergreen. Seasonal events exist as opt-in challenges with no time-limited exclusive rewards. No "buy before midnight" pressure.

### 6. No lootboxes / random-result purchases

**What it is:** pay $X for a randomized reward. Gambling psychology applied to in-game items.

**Why we forbid it:** lootboxes have been regulated in multiple jurisdictions as gambling. They're psychologically exploitative. They're banned for minors in several countries.

**Our position:** every purchase shows exactly what you're getting. The marketplace lists each design with its full specs. No mystery boxes. No "chance to get rare drop."

### 7. No manufactured scarcity

**What it is:** "Only 100 of these will exist." "Limited quantity."

**Why we forbid it:** scarcity drives panic-buying.

**Our position:** marketplace designs are infinite supply. Cosmetics are infinite supply. No artificial limits.

### 8. No spending milestones / VIP rewards

**What it is:** "Spend $500 this month to unlock the Diamond Tier."

**Why we forbid it:** spending milestones create perverse incentives to spend.

**Our position:** money doesn't unlock cumulative achievements. Every dollar buys what's labeled; no compound rewards for spending more.

### 9. No pay-to-resurrect / pay-to-protect

**What it is:** "Your unit died. Pay $X to revive it." "Pay $X to shield your base for 24 hours."

**Why we forbid it:** consequences are part of gameplay. Selling out of consequences destroys the game's tension.

**Our position:** consequences are play-based. Scuttle is a choice. Defense is a choice. No money buys out of consequences.

### 10. No paid matchmaking advantage

**What it is:** "Pay $X for premium matchmaking" — i.e., easier opponents.

**Why we forbid it:** rigged matchmaking against non-paying players is the deepest exploit.

**Our position:** matchmaking is skill-based, not spend-based. Stock-only brackets exist for pure-skill competition.

### 11. No spending-based ranks / leaderboards

**What it is:** "Top spenders this season" leaderboards that publicize and incentivize spending.

**Why we forbid it:** publicizing spending creates whales, normalizes excess, and shames non-spenders.

**Our position:** leaderboards exist for skill (win rates, achievements). Not for spending. Spending is private.

### 12. No advertising of purchase as path to victory

**What it is:** "Get ahead — buy the Premium Pack today!" Marketing that frames purchases as competitive advantage.

**Why we forbid it:** marketing language shapes the community's expectations. If we sell power, we attract players who want bought power.

**Our position:** marketing emphasizes the creator economy, the depth of design, the anti-P2W positioning. Never "buy to win."

---

## Revenue projections by phase

Conservative estimates. Actual revenue depends on engagement, conversion, retention, ad inventory quality, and brand-partnership pipeline.

### V1 launch (months 12-15, target ~10-50K MAU)

| Stream | Monthly | Notes |
|---|---|---|
| Premium purchases | $20K-100K (varies with demo conversion ramp) | Strongest at launch; declines as the early-adopter wave passes |
| Diegetic ads | $5K-50K | Limited inventory at launch; ramps as brand pipeline operates |
| Marketplace | $0 | Not yet active |
| Patronage | $0 | Not yet active |
| **Total** | **~$25K-150K/month** | |
| **vs. V1 infrastructure ($0.7-2K/mo)** | **Massively positive** | |

### V2 launch (months 24-27, target ~100K-500K MAU)

| Stream | Monthly | Notes |
|---|---|---|
| Premium purchases | $10K-50K | New buyer acquisition continues; old buyers grandfathered to V2 free |
| Diegetic ads | $100K-1M | **Primary revenue stream** at this scale |
| Marketplace | $5K-50K | Beginning to mature |
| Patronage | $3K-30K | |
| **Total** | **~$120K-1.1M/month** | |
| **vs. V2 infrastructure ($10-30K/mo)** | **Funds V3 development** | |

### V3 launch (months 33-36, target ~500K-1M+ MAU)

| Stream | Monthly | Notes |
|---|---|---|
| Premium purchases | $20K-100K | Mature acquisition; price may increase for new buyers |
| Diegetic ads | $500K-3M | **Bread-and-butter at scale** |
| Marketplace | $30K-300K | Mature creator economy |
| Patronage | $25K-300K | Mature community contribution |
| **Total** | **~$575K-3.7M/month** | |
| **vs. V3 infrastructure ($50-150K/mo)** | **Sustainably profitable platform** | |

### Key observation

**At every phase, the *next* phase's infrastructure cost is covered many times over by the *current* phase's revenue.** No phase requires external capital for the next phase's investment. The model bootstraps:

- V1 sales fund V1 operating costs and V2 development.
- V2 ad revenue funds V2 operating costs and V3 development.
- V3 ad revenue funds V3 operating costs and ongoing platform development.

External investment, if taken, accelerates timelines rather than enables them. The project is structurally capable of bootstrapping from V1 sales alone, with V2 launching from V1 revenue and V3 from V2.

---

## Open questions

- OPEN[2026-05-27]: optional ad-removal purchase ($2-5 for "clean world") — yes or no? Recommendation: yes, as a low-effort opt-out option for ad-averse players. Doesn't change game; doesn't violate any forbidden mechanics. blocks: M5 launch plan.
- OPEN[2026-05-27]: per-match design cap (8-12 proposed). Pending playtest. blocks: marketplace launch (M7).
- OPEN[2026-05-27]: marketplace earn-path time equivalence (5-20h proposed). Pending playtest. blocks: marketplace launch (M7).
- OPEN[2026-05-27]: Founder's Edition pricing ($4.99 proposed). Optional Year-1 launch bundle with cosmetic badge. blocks: M5 launch plan.
- OPEN[2026-05-27]: ad-revenue per MAU at scale ($1-3/MAU/month proposed). Highly dependent on brand-sales pipeline operations. Refine after first 6 months of ad operations.
- OPEN[2026-05-27]: brand-safety review process. Will need legal + brand-partner review pipeline established before real-brand inventory operates at scale. blocks: M5 launch plan.
- OPEN[2026-05-27]: regional pricing — should $2.99 vary by purchasing-power-parity? App stores support this; lower price in lower-PPP markets accelerates acquisition. Recommendation: yes, follow app store regional pricing standards.

## Cross-references

- [DESIGN.md](../DESIGN.md) — Principle 8 and the forbidden mechanics in constitutional form
- [docs/architecture.md](architecture.md) — engine modules that deliver this revenue model
- [docs/roadmap.md](roadmap.md) — phases this model funds
- [docs/demo.md](demo.md) — the hook design (future doc); critical for Stream 1 conversion
- [docs/marketplace.md](marketplace.md) — marketplace operational details (future doc)
- [docs/risks.md](risks.md) — risks relevant to this model (brand sales infrastructure, moderation cost, legal surface)
- [pitch/PITCH.md](../pitch/PITCH.md) — external version of this model, suitable for investor/acquirer review
