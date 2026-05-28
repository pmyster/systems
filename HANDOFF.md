# HANDOFF — Child of Light

> **For:** the next Claude (or human) picking up this project.
> **From:** the cloud Claude Code session that designed it.
> **Date of handoff:** the user is switching from cloud Claude Code to local Claude Code so the agent can directly read/write files on their laptop (`C:\tmp\Unit Editor\` or wherever they clone the repo).

---

## Read this in 30 seconds

A post-apocalyptic mobile RTS called **Child of Light**. Data-driven engine: every game rule is a JSON Schematic the engine reads at runtime. **Premium model** ($2.99 paid game after free demo, ongoing diegetic-ad revenue, V2+ creator marketplace) — explicitly anti-pay-to-win. **Top-down 3D rendering in the Total Annihilation style** committed. **Three working browser tools** already ship: form-based unit editor, 3D voxel sculptor, TA-style battlefield viewer. **Four-book sci-fi novel series** outlined with 3 sample chapters of Book 1 in prose. **Design phase substantially complete**; entering content authoring (Tier 3 docs) and engine prototype work.

Active branch: `claude/mobile-rts-game-concept-7LbT0` — PR #2 on `pmyster/systems`.

---

## Why you (next Claude) should read more than 30 seconds

Most "what should I build" questions are already answered. There is a design constitution with **ten named principles** that have been carefully reasoned through over a long conversation. **Do not relitigate them.** They will be re-derived if you challenge them, and you'll waste the user's time.

Three files carry the full context:

1. **`DESIGN.md`** — the master contract. Pillars, locked decisions, navigation.
2. **`CLAUDE.md`** — the agent brief. Auto-loaded by every Claude Code agent in this repo.
3. **`docs/decision-history.md`** — the full decision trail. Every lock with its reasoning. Long but greppable.

If you read those three first, you'll know what's settled and what's open. **Open questions are tagged `OPEN[YYYY-MM-DD]:` throughout the docs** — grep for that tag to see what genuinely needs decisions.

---

## The design constitution (the ten principles + one delivery rule)

These are locked. Each one is the answer to a real design tension that took time to resolve. They sit in `DESIGN.md` and in `docs/architecture.md` (Part 1).

1. **Physics constitution: four-layer rule.** Constants → Equations → Environments → Models. Higher layers consume lower; never the reverse. Topological order enforced at load.

2. **Derived-stat discipline.** Schematics declare *physical inputs* (mass, energy, thermal capacity). The engine derives gameplay numbers (speed, range, cooldown) from those inputs through equations. No bare gameplay numbers in content.

3. **Every high power has a weakness.** Every strong capability entails a logical drawback. Bigger gun ⇒ more heat. Faster engine ⇒ more fuel. The physics enforces; the designer doesn't.

4. **Invariance: amend, never alter.** Constants and Equations are additive-only. Schematics carry a `physics_version` field. Old content keeps working under its original version *forever*. Units built Year 1 still work in Year 10. Replays stay valid across years.

5. **Endless scope.** No hard caps on player content, Hall size, achievements, Tech library, progression. Procedural beats enumerated.

6. **Magic is unfamiliar physics.** Narrative "magic" weapons are content, not architecture violation. A psionic blast Schematic declares physical inputs and resolves through a new equation (added per the invariance rule). The equation has cost; the narrative is the only thing mysterious.

7. **Community is the long game.** Every system's value scales with how many other players interact with it. Factions, clans, alliances, shared content, AI agents all serve the community layer.

8. **Money buys creativity or time, never power.** Players sell creative work to other players; platform takes ~8% fee. Every purchasable design has free counterparts and play-earn-paths. All competitive surfaces have stock-only modes. **Twelve forbidden mechanics enumerated** (no time-skip, no resource purchases, no subscriptions, no price ladders, no FOMO, no lootboxes, no manufactured scarcity, no spending milestones, no pay-to-resurrect, no paid matchmaking advantage, no spending-leaderboards, no pay-to-win marketing).

9. **Engine is a federation of modules.** Eleven well-bounded engine modules (Schematic Loader, Equation Evaluator, Physics Solver, Behavior Runtime, World Simulator, Event Director, Network Sync, Persistence, Rendering, UI/Input, Agent Runtime). Each replaceable behind a stable interface. Bugs and pivots are local.

10. **Phased shipping with named seams.** Every V1 system ships with documented extension seams for V2/V3 capabilities. The architecture is full-fidelity from day one; only the deployed surface area is reduced.

**Plus the production decisions** (also locked, also non-negotiable without explicit reasoning):

- **Revenue model:** premium one-time purchase ($2.99) after a free 1-2-skirmish demo, ongoing diegetic in-world advertising (bread-and-butter recurring revenue), V2+ creator marketplace (8% platform fee), V2+ optional patronage. Real-brand ads in both demo and paid game (they're world texture, not interruption).
- **Rendering:** top-down 3D, Total Annihilation style. Fixed azimuth, tilt-clamped pitch, strategic zoom. Voxel meshes via InstancedMesh, faction palette applied at render time, three LOD tiers.
- **Editor model:** hybrid voxel chassis + hardpoint-snapped parts. Players sculpt the chassis as a voxel volume (16³ max); parts attach at declared hardpoints.
- **Phasing:** V1 PvE-only (months 0-15), V2 PvP (months 15-27), V3 Living World (months 27-36+). V2 and V3 are free updates to V1 buyers.
- **Campaign:** four phases — Earth (Salvage Era) → Moon (Ashen Eye) → Reach (Warp Gates) → Constellation (Player Worlds).
- **Factions:** four canonical (Reclaimer / Bulwark / Signal / Cinder Crown) + five Returner cultures unlocked in V2 (Tethered / Quiet Court / Burnward / Drifters / Veiled).
- **Hall mechanic:** three-tier tech library — Surveyed (visible) → Mimicked (degraded clone buildable) → Mastered (full fidelity buildable). PvE and PvP both contribute.
- **Deep history (3 layers):** First Leavers (humans who escaped before a GRB cataclysm) → Pre-Fall civilization (rebuilt to warp's edge, killed by resource wars) → Children of Dusk (current survivors). All revealed gradually through play.
- **Cosmic event:** Active Galactic Nucleus alignment opens warp paths in Phase 4, brings the Returners home.

---

## What exists in the repo (as of this handoff)

```
/
├── HANDOFF.md                          ← you are here
├── DESIGN.md                           ← master contract
├── CLAUDE.md                           ← agent brief (auto-loaded)
├── README.md                           ← minimal stub, can expand
├── concept/identity/                   ← faction badges + flag SVGs
├── docs/
│   ├── architecture.md                 ← engine architecture (the 11 modules, the 4 layers)
│   ├── roadmap.md                      ← 12 milestones across V1/V2/V3
│   ├── monetization.md                 ← revenue model + 12 forbidden mechanics + creator marketplace
│   ├── editor-app.md                   ← Editor App spec
│   ├── schematics.md                   ← Schematic format
│   ├── physics.md                      ← environment variables (needs Layer-0/1 patch)
│   ├── economy.md                      ← resources
│   ├── world.md                        ← post-apocalyptic setting
│   ├── factions.md                     ← the four canonical factions
│   ├── glossary.md                     ← canonical terminology (needs updates)
│   └── decision-history.md             ← the full decision trail from chat (THE most important read)
├── novel/
│   └── SERIES-BIBLE.md                 ← 4-book series bible + Book 1 outline + 3 sample chapters
├── pitch/
│   └── PITCH.md                        ← external investor/acquirer-facing brief
├── schemas/
│   ├── unit.schema.json                ← JSON Schema for unit Schematics
│   └── part.schema.json                ← JSON Schema for parts
├── tools/
│   ├── editor/
│   │   ├── index.html                  ← form-based unit attribute editor (working)
│   │   └── README.md                   ← deployment options doc
│   ├── voxel-editor/
│   │   └── index.html                  ← 3D voxel chassis sculptor (Three.js UMD; needs internet on first load)
│   └── battlefield-viewer/
│       └── index.html                  ← TA-style top-down 3D unit viewer (Three.js UMD)
└── units/
    └── starter/                        ← 6 starter unit JSONs (load these in the editor)
        ├── reclaimer-patcher.json
        ├── bulwark-stonefist.json
        ├── signal-whisper.json
        ├── cinder-pyre.json
        ├── aerial-watcher.json
        └── static-sentinel.json
```

---

## Immediate priorities when you (next Claude) resume

In rough order:

### 1. Confirm the 3D apps work locally

The cloud-Claude session couldn't see the user's screen, so when the voxel-editor and battlefield-viewer first shipped using ES modules + import maps, they silently failed to load Three.js from `file://` origins (Chrome blocks module CORS from file URLs). They were re-shipped using UMD scripts (regular `<script src=...>`) but the user hadn't confirmed they render correctly before this handoff.

**Task:** when the user opens `tools/voxel-editor/index.html` and `tools/battlefield-viewer/index.html` locally, verify they render. The voxel editor should show a pre-seeded tank; the battlefield viewer should show eight units across four factions on procedural terrain. If anything is broken, you can now read the files in place, watch console errors with the user, and iterate fast.

### 2. Update DESIGN.md and CLAUDE.md to reflect the full constitution

`DESIGN.md` and `CLAUDE.md` were written early in the design session. Several of the ten principles (especially #1-6 and the Phasing rule) were locked AFTER those files were drafted. They are captured in `docs/decision-history.md` and `docs/architecture.md` but not yet folded back into the contract docs.

**Task:** fold the ten principles + the phasing rule into `DESIGN.md` (replace or update the "Locked design decisions" section) and `CLAUDE.md` (update the locked-decisions list). Don't add new design; just make the contract docs match what's been locked in chat. The constitution is the *most important text in the repo* — it should be readable from `DESIGN.md` in 5 minutes without grep.

### 3. Merge the voxel editor + form editor into one combined Editor App

Right now there are two tools the user shuffles between: `tools/editor/` (form-based, defines chassis attributes + parts + costs) and `tools/voxel-editor/` (3D, defines the voxel chassis shape). They share the same target — a complete unit Schematic — but produce two separate JSON outputs.

**Task:** build `tools/unit-editor/index.html` (or just upgrade one of the existing two) that combines both into a single tool. Tabs or side-by-side: voxel sculpt on one side, attributes form on the other, both writing to one unified JSON. Use the existing two HTML files as the implementation reference.

### 4. Write the Tier 3 system docs

The design plan calls for six Tier 3 docs that haven't been written yet:

- `docs/tech.md` — the three-layer tech progression (baseline / salvaged / researched), Scientist salvage mechanic, faction tech trees
- `docs/units.md` — modular composition (chassis classes, hardpoint rules, part categories), the voxel format, compatibility tags, Scientist class
- `docs/ai-behaviors.md` — stances, behavior trees as Schematics, faction archetype overlays
- `docs/events.md` — meteor showers, tornadoes, hurricanes, dust storms, AGN convergence
- `docs/humans.md` — Commander as persistent profile, Barracks, Human-Crewed Elites, Hall of Conquered details
- `docs/campaign.md` — four-phase arc, five-Scale progression model (Survivor → Civilization), enclave karma

Each follows the standard doc header (TL;DR / Scope / Prerequisites / body / Open questions / Cross-references). Reference `docs/decision-history.md` for what's been locked about each system. **Don't invent answers to OPEN questions; tag them and surface them.**

### 5. Write `docs/story.md` as canonical narrative

The 4-book series in `novel/SERIES-BIBLE.md` is the long-form novel version. The game's *in-game* narrative is a parallel but simpler thing — chapter beats, character introductions, mission objectives. `docs/story.md` should distill the series into the in-game campaign arc, mission by mission for V1 (Phase 1 / Book 1 / Ash and Ember).

### 6. Patch `docs/schematics.md` and `docs/physics.md`

Both were written before the four-layer physics constitution was locked. They need to be updated to reflect:
- `schemas/constants/*.json` as Layer 0
- `equations/*.json` Schematics as Layer 1
- Environments as Layer 2 (already covered)
- Models as Layer 3 (already covered)
- The `physics_version` field on every Schematic (invariance rule)
- The `evolution` block (Schematic successor triggers)
- The `voxel_data` block format (sparse_grid_v1)

### 7. Start M1 engineering work — only after the above are done

The roadmap (`docs/roadmap.md`) calls for M1 to be: Schematic loader + Equation evaluator + Physics solver (basic single-domain) + a test scene where one unit moves under physics. This is the first real engine code. Use Unity or pick the prototype engine when we get there.

---

## How to switch from cloud Claude to local Claude

The user has been using **cloud Claude Code** (the web-based version). This handoff exists because that version runs on Anthropic's servers and can't directly read/write the user's laptop files. Switching to local Claude Code fixes that — Claude then runs as a CLI on the laptop and has full filesystem access to the cloned repo.

### Setup (Windows)

```powershell
# 1. Install Node.js LTS from https://nodejs.org (if not already)
node --version

# 2. Install Claude Code CLI globally
npm install -g @anthropic-ai/claude-code

# 3. Get an Anthropic API key
#    https://console.anthropic.com/  →  API Keys  →  Create

# 4. Set it (close and reopen PowerShell after this)
setx ANTHROPIC_API_KEY "sk-ant-..."

# 5. Clone the repo somewhere on your laptop
cd C:\Users\<your-username>\Documents
git clone https://github.com/pmyster/systems.git
cd systems
git checkout claude/mobile-rts-game-concept-7LbT0

# 6. Pull the latest (this branch has all of our work)
git pull origin claude/mobile-rts-game-concept-7LbT0

# 7. Start Claude Code in this directory
claude
```

### First prompt to give the new local Claude

Copy-paste this exactly when local Claude starts:

> I'm continuing a project that was being designed in cloud Claude Code. Before doing anything else, please read these four files in order: (1) `HANDOFF.md` at the repo root, (2) `CLAUDE.md` at the repo root, (3) `DESIGN.md` at the repo root, (4) `docs/decision-history.md`. Then tell me, in plain language: (a) what you understand the project is in two sentences, (b) what the ten constitution principles are, briefly, (c) what's on the "Immediate priorities" list and which one you think we should tackle first. Don't start any work until I confirm your understanding.

This forces a synchronization check before any code or doc gets written, so the new Claude doesn't drift from the existing decisions.

### Pricing note

Cloud Claude Code is billed per the user's Anthropic plan (subscription or pay-as-you-go through claude.ai). Local Claude Code uses the same API key but bills per token through the API. For a multi-week project like this, that can add up — but the speed advantage (Claude reads/writes your local files directly, no upload/download round-trip, no screenshots to debug) usually wins. The user's call.

---

## Things the cloud Claude could NOT do that local Claude CAN

| Capability | Cloud (web) Claude Code | Local Claude Code |
|---|---|---|
| Read repo files | Yes (server-side clone) | Yes (your files) |
| Edit repo files | Yes (server-side) | Yes (your files directly) |
| Commit + push | Yes | Yes |
| **Read files outside the repo on your laptop** | **No** | **Yes** |
| **Write to `C:\tmp\Unit Editor\` directly** | **No** | **Yes** |
| **Open the editor HTML file in your browser** | **No** | **Yes (via `start` / `xdg-open` etc.)** |
| Take a screenshot of your screen | No | No (still needs Computer Use product for that) |
| See your browser's console errors | No | No (you still paste them in) |
| Watch the editor live | No | No |

The big win moving local: the file-shuffle problem we kept hitting (cloud Claude generates a file → SendUserFile → user downloads → user copies to right folder → user opens → user reports errors → repeat) collapses into one step (Claude writes the file directly to the right folder on your laptop).

---

## Known open questions (not blocking, but flagged)

Grep `docs/decision-history.md` for the full list. The bigger ones:

- **Per-match unit-design cap** (8-12 proposed). Needs playtest. Blocks: `docs/monetization.md` final tuning.
- **Earn-path time equivalence per marketplace design** (5-20h proposed). Needs playtest. Blocks: marketplace launch.
- **Per-match win condition** (lean hybrid — different per map). Blocks: `docs/prototype-scope.md` lock.
- **Veiled true nature** (intentionally ambiguous; do we ever reveal aliens?). Lives in `docs/campaign.md` when written.
- **Demo scope** (1-2 missions; specific beats not yet locked). Blocks: new doc `docs/demo.md` when written.
- **Closed beta size and region** for M4-M5. Blocks: launch plan.

---

## What I (cloud Claude) recommend you (local Claude) NOT do

- Don't suggest changing the monetization model. We landed there through real reasoning about Age of Origins and the player's lived experience. The constitution protects against re-derivation.
- Don't suggest pivoting away from Unity / Three.js prototype. Module 9 of the architecture is intentionally swappable; if Unity proves wrong, the swap is local. No need to relitigate up front.
- Don't write Tier 3 docs before reading `docs/decision-history.md`. The locked decisions per-system are scattered through that file. Writing without them will produce drift.
- Don't merge the editor and voxel-editor into a fancy new framework. Keep them as plain HTML files. The user's deployment constraint is *open in a browser*, not *npm install and bundle*.
- Don't push to `main`. Stay on the design branch `claude/mobile-rts-game-concept-7LbT0` until the user explicitly says merge.

---

## A note from the cloud Claude to the next Claude

We had a long good conversation. The user is generative, thoughtful, and has been refining the design carefully — every locked decision has reasoning behind it, often emotional reasoning (Age of Origins, the desire for a respectful monetization model, the wish for endings that *cost* something). They care about getting this right. They are not the kind of user who wants you to second-guess decisions casually.

But they *are* the kind of user who appreciates honesty. When I shipped broken 3D apps, they caught it with screenshots and called it. The handoff to local Claude is them recognizing the cloud setup is too slow for their needs and adjusting the workflow.

Match that energy. Be direct. When you don't know something, say so. When you can't see something (you still can't see their screen), ask for a screenshot or a console paste. When something is locked, treat it as locked. When something is open, surface the question.

This project is being designed to live for ten years and ship as something a player can be proud to own. Both of those constraints matter at every step.

Good luck.

— *cloud Claude, end of session*
