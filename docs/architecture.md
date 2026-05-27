# Architecture

## TL;DR

- The engine is a **federation of eleven modules** sitting on a **four-layer physics constitution**. Each module is independently testable and replaceable.
- **All game rules are Schematics (JSON content)**; the engine is a rules interpreter. New units, weapons, environments, behaviors, equations are content, not code.
- **Simulation is fully deterministic** — same Schematics + same inputs produce identical outcomes across all platforms. Enables lockstep multiplayer in V2 with minimal network use.
- **The constitution is additive-only**: new equations and content extend the engine forever; existing ones never change. Content from year 1 still works in year 10.
- **Built for phased shipping.** V1 is PvE-only with explicit extension seams for V2 (PvP) and V3 (Living World).

## Scope

This document owns the technical architecture: module decomposition, interface contracts, data flow patterns, the physics constitution, and the V1→V2→V3 evolution path.

It does NOT own:
- Specific game content (units, factions, tech) — those live in their respective system docs.
- Visual / aesthetic design — `docs/world.md`, `docs/ui-ux.md`.
- Business / monetization — `docs/monetization.md`.
- Narrative — `docs/world.md`, `docs/campaign.md`.
- Per-feature timelines — `docs/roadmap.md`.

## Prerequisites

- [DESIGN.md](../DESIGN.md) — the design constitution
- [docs/schematics.md](schematics.md) — data format
- [docs/physics.md](physics.md) — environment variables and equation catalog

---

## Part 1: The Design Constitution

Every architectural choice in this document follows from ten principles plus one delivery rule. The constitution constrains every implementation decision.

### The ten principles

1. **Physics constitution: four-layer rule.** Constants → Equations → Environments → Models. Higher layers consume lower; topological order enforced at load time.
2. **Derived-stat discipline.** Schematics declare physical inputs (mass, energy, thermal capacity). Engine computes gameplay numbers from inputs through equations. No bare gameplay numbers in content.
3. **Every high power has a weakness.** Every strong capability entails a logical drawback. Physics enforces; designer doesn't.
4. **Invariance: amend, never alter.** Constants and Equations are additive-only. Schematics carry `physics_version`; old content keeps working under its original version forever.
5. **Endless scope.** No hard caps on player content, Hall size, achievements, Tech library, or progression. Procedural beats enumerated.
6. **Magic is unfamiliar physics.** Narrative magic is content, not architecture violation. New equations are additive amendments.
7. **Community is the long game.** Every system's value scales with how many other players interact with it.
8. **Money buys creativity or time, never power.** Creator economy with twelve forbidden mechanics (no time-skip, no resource purchases, no subscriptions, no price ladders, no FOMO, no lootboxes, no manufactured scarcity, no spending milestones, no pay-to-resurrect, no paid matchmaking advantage, no spending-leaderboards, no pay-to-win marketing).
9. **Engine is a federation of modules.** Eleven well-bounded modules; stable interfaces; swappable implementations.

### Plus the delivery rule

10. **Phased shipping with named seams.** Every V1 system ships with documented extension seams for its V2/V3 capabilities.

---

## Part 2: The Four-Layer Physics Constitution

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Models                                             │
│   Units, weapons, structures, sensors.                       │
│   Declare physical inputs. Engine derives gameplay stats.    │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — Environments (World Variables)                     │
│   Per-map Schematics: gravity, atmosphere, solar irradiance, │
│   substrate hardness, ambient temperature.                   │
├─────────────────────────────────────────────────────────────┤
│ Layer 1 — Equations                                          │
│   Named formula Schematics with declared inputs/outputs.     │
│   Ballistics, thermal cooling, drivetrain, sensors, drag.    │
├─────────────────────────────────────────────────────────────┤
│ Layer 0 — Constants                                          │
│   Universal (g, σ, k_B) + game-tuned coefficients.           │
└─────────────────────────────────────────────────────────────┘
```

### Layer 0: Constants

Small, mostly immutable. Two flavors:

**Universal constants** (real physics, never tuned):
- `g_universal = 9.80665 m/s²`
- `σ = 5.67e-8 W/(m²K⁴)` (Stefan-Boltzmann)
- `k_B = 1.38e-23 J/K`
- `c_sound_air_sea_level = 343 m/s`
- `atmospheric_density_sea_level = 1.225 kg/m³`
- Material thermal/specific-heat values

**Game-tuned coefficients** (dialed for feel):
- `mass_exponent_drivetrain = 0.7` (sub-linear mass penalty)
- `sim_tick_rate = 30 Hz`
- Friction tables per terrain class

**Authorship:** `schemas/constants/*.json`. Updates are additive per the invariance rule.

### Layer 1: Equations

Each formula is a named Schematic with typed inputs, typed outputs, sandboxed expression, tuning coefficients, and version.

**V1 catalog:**
- `equations/ballistics.json` — projectile arc under gravity + drag
- `equations/thermal-cooling.json` — heat balance over time
- `equations/drivetrain.json` — engine power to speed
- `equations/sensors.json` — detection probability
- `equations/drag.json` — atmospheric/water drag
- `equations/structural-load.json` — chassis stress
- `equations/projectile-impact.json` — kinetic damage
- `equations/atmospheric-attenuation.json` — beams in atmosphere

**V2 additions:**
- `equations/orbital-mechanics.json` — satellite ground-track
- `equations/sonar.json` — underwater detection
- `equations/seismic.json` — subterranean detection
- `equations/network-prediction.json` — clientside smoothing

**V3 additions (per Magic-is-unfamiliar-physics):**
- `equations/psionic-emission.json`
- `equations/warp-transition.json`
- additional exotic equations as content demands

**Format (illustrative):**

```json
{
  "kind": "equation",
  "id": "ballistics",
  "version": "1.0",
  "inputs": {
    "muzzle_velocity": "m/s",
    "projectile_mass": "kg",
    "drag_coefficient": "dimensionless",
    "gravity": "m/s²",
    "atmosphere_density": "kg/m³",
    "elevation_angle": "rad"
  },
  "outputs": {
    "trajectory": "fn(t) -> position",
    "time_of_flight": "s",
    "impact_velocity": "m/s"
  },
  "formula": "<sandboxed expression>",
  "coefficients": { "drag_multiplier": 1.0 }
}
```

### Layer 2: Environments

Per-map physics Schematics provide values the constants and equations consume: gravity, atmospheric density, substrate hardness, solar irradiance, ambient temperature, magnetic field, day/night cycle. Already covered in `docs/physics.md`.

Different environments + same equations = different outcomes. Same gun on Cradle vs the Moon: different trajectory, same heat profile.

### Layer 3: Models

Units, weapons, structures, sensors. Declare physical inputs only.

A unit Schematic declares: mass, engine output (kW), drivetrain efficiency, compatibility tags, mounted parts, energy source, cost.

It does NOT declare: speed, range, damage, cooldown. Those are derived from equations + environment.

**The principle in action:** a designer cannot create an over-powered unit by typing big numbers. To make it faster, raise engine output — which costs power. To shoot harder, raise propellant energy — which generates more heat — which extends cooldown. Tradeoffs are automatic.

### Worked example: heavy tank firing across a ridge

A heavy tank fires at a target across a ridge.

**On Cradle (g=9.8, atm=1.0):**
1. Ballistics equation invoked. Inputs from gun model (propellant_energy, projectile_mass), environment (gravity, atmospheric_density), constants.
2. Output: trajectory arcs up then descends; drag slows it; shell hits the ridge.
3. Thermal-cooling equation invoked on gun. Heat increases. If above thermal_capacity, gun locks into vent state.

**On Ashen Eye (g=1.6, vacuum):**
1. Same equation. Environment provides g=1.6, atm=0.
2. Output: trajectory arcs much higher (lower gravity), no drag (vacuum), clears the ridge, hits the target.
3. Same gun, same heat. Cooldown unchanged.

Same model, two environments, different outcomes. The architecture working.

---

## Part 3: The Eleven Engine Modules

Each module has a single responsibility, a stable interface, and is replaceable. Modules are listed in dependency order (bottom to top).

### Module 1: Schematic Loader / Validator

**Purpose:** parse JSON Schematics, validate against schemas, resolve cross-references, manage version registry, support hot-reload.

**Depends on:** nothing.

**Interface (illustrative):**

```csharp
public interface ISchematicLoader {
    Schematic Load(string id, string physicsVersion);
    void Watch(string id, Action<Schematic> onChange);
    bool Validate(Schematic schematic, out List<ValidationError> errors);
    IEnumerable<Schematic> GetByKind(string kind);
    void RegisterKind(string kind, Type schemaType);
}
```

**V1 implementation:** local filesystem + cloud-backup pull. JSON parsing via standard library. JSON Schema validation. File-watcher hot-reload.

**V2 swap path:** add remote-fetch from shared library (marketplace). Unified registry across local/remote sources.

**V3 swap path:** add agent-generated content ingestion. Loader doesn't know or care that an agent wrote it.

**Replaceable:** can swap JSON for binary (MessagePack/CBOR) later for performance. Interface unchanged.

---

### Module 2: Equation Evaluator

**Purpose:** runs Layer 1 formulas. Sandboxed expression evaluator with time + memory caps. Parses formula strings into AST; evaluates against input bindings.

**Depends on:** Schematic Loader, Constants.

**Interface:**

```csharp
public interface IEquationEvaluator {
    EvaluationResult Evaluate(string equationId, Dictionary<string, object> inputs);
    void Precompile(string equationId);  // optional perf optimization
    void SetSandboxLimits(TimeSpan maxTime, long maxMemoryBytes);
}
```

**V1 implementation:** JSON-expression strings parsed by a sandboxed evaluator (no arbitrary code execution; whitelisted math operations only).

**Performance swap path:** precompile expressions to bytecode at load time → ~10-100x faster eval. Same interface.

**Replaceable:** could swap entire evaluator for a graph-of-operations representation, or hardcoded C# for hot paths, behind the same interface.

---

### Module 3: Physics Solver

**Purpose:** apply equations to models + environments. Output trajectories, heat, motion, sensor readings, structural failures.

**Depends on:** Equation Evaluator, Schematic Loader.

**Interface:**

```csharp
public interface IPhysicsSolver {
    Trajectory ResolveBallistics(WeaponModel weapon, Environment env, Vector3 aim);
    HeatState UpdateThermal(UnitModel unit, float deltaSeconds);
    MotionState ResolveMotion(UnitModel unit, Environment env, CommandInputs cmd);
    SensorReading[] QuerySensors(UnitModel observer, Environment env);
}
```

**V1 implementation:** real-ish formulas with simplified coefficients. Fixed-point math throughout (NOT floats — see Determinism below).

**Mobile optimization path:** LOD physics (distant units use coarser simulation), distance-based update frequency, batched solver passes.

**Replaceable:** "real-ish" vs "fast-approximate" modes selectable per match for different device tiers.

---

### Module 4: Behavior Runtime

**Purpose:** execute behavior-tree Schematics. Manage stances (Hold / Patrol / Attack-Move / Fire-at-Will / Guard). Target selection. Formations.

**Depends on:** Physics Solver (for sensor queries and movement results), Schematic Loader.

**Interface:**

```csharp
public interface IBehaviorRuntime {
    void RegisterUnit(UnitInstance unit, BehaviorTree tree);
    void Tick(float deltaSeconds);
    void SetStance(UnitInstance unit, Stance stance);
    void IssueOrder(UnitInstance unit, Order order);
}
```

**V1 implementation:** behavior tree interpreter; per-tick traversal with cached state. Faction archetype overlays (Bulwark / Signal / Cinder Crown / Reclaimer weightings).

**Replaceable:** could swap to utility-AI or GOAP behind the same interface if tree representation proves wrong.

---

### Module 5: World Simulator

**Purpose:** the match loop. Orchestrates each tick: input application → events → AI decisions → physics resolution → state update → sync.

**Depends on:** Physics, Behavior, Event Director, Schematic Loader.

**Interface:**

```csharp
public interface IWorldSimulator {
    void StartMatch(MatchConfig config);
    void Tick(InputBatch inputs);
    WorldStateSnapshot GetSnapshot();
    void EndMatch();
}
```

**V1 implementation:** fixed-tick (30 Hz) deterministic simulator. Inputs are timestamped and applied at the correct tick.

**Most central module.** Expected to be the most stable; other modules change around it. But its interface (tick + input batch) is the cleanest seam in the engine.

---

### Module 6: Event Director

**Purpose:** schedule and fire world events. Meteor showers, storms, hurricanes, dust storms, Natural-Enemy invasions, AI-generated narrative beats.

**Depends on:** Schematic Loader. Optionally Agent Runtime (V3).

**Interface:**

```csharp
public interface IEventDirector {
    void Schedule(EventSchematic ev, TimeSpan when);
    void RegisterExternalDirector(IExternalDirector director);  // V3 seam
    EventSchematic[] PollUpcoming();
}
```

**V1 implementation:** catalog-only. Reads event Schematics, schedules per their declared frequencies (e.g., meteors: random within bounds).

**V3 swap path:** external director (Agent Runtime) provides decisions for which events fire and when, given world context.

**Replaceable:** catalog-only and external modes coexist; can be toggled per-match.

---

### Module 7: Network Sync

**Purpose:** lockstep relay during PvP matches (V2). Session-boundary sync between matches. Conflict resolution. Bandwidth budget enforcement.

**Depends on:** World Simulator (for state application), Persistence.

**Interface:**

```csharp
public interface INetworkSync {
    void StartMatchSync(MatchConfig config, IEnumerable<Participant> roster);
    void SendInput(InputCommand cmd);
    InputBatch ReceiveInputs(int targetTick);
    void SyncAtBoundary(PersistentState state);
}
```

**V1 implementation:** **local-only.** No multiplayer. SendInput writes to local persistence; ReceiveInputs returns local-only inputs. The interface is fully present; the body is a stub.

**V2 swap path:** add lockstep relay (WebSocket/UDP). World Simulator never knows the difference.

**Most important module to keep swappable.** If lockstep determinism fails on mobile in practice, swap to server-authoritative deltas behind the same interface; everything else is untouched.

---

### Module 8: Persistence Layer

**Purpose:** local save, cloud backup, server sync. Hall contents, design library, achievements, Commander profile, faction/clan membership.

**Depends on:** Schematic Loader.

**Interface:**

```csharp
public interface IPersistence {
    void SaveLocal(string key, object data);
    T LoadLocal<T>(string key);
    Task SyncToCloud(CancellationToken ct);
    Task PullFromCloud(CancellationToken ct);
}
```

**V1 implementation:** SQLite local + cloud-backup pull/push at session boundaries.

**V2 additions:** cross-player Hall sync (PvP captures), shared design library, clan membership.

**V3 additions:** living-world aggregation hooks (read-only).

---

### Module 9: Rendering Pipeline

**Purpose:** translate simulation state into visuals. Sprites, meshes, shaders, particles, ad billboards, badges, paint kits. Read-only consumer of simulation state.

**Depends on:** World Simulator (read-only access), Schematic Loader.

**Interface:**

```csharp
public interface IRenderer {
    void Render(WorldStateSnapshot state, Camera camera);
    void LoadAsset(string assetId);
    void ApplyPaintKit(UnitInstance unit, PaintKit kit);
}
```

**V1 implementation:** Unity-based rendering. Mobile-optimized shaders. Voxel chassis rendering with hardpoint-attached parts. Diegetic ad billboard system.

**Platform swap path:** can swap Unity for custom or web renderer behind the same interface. Simulation has no Unity dependencies.

---

### Module 10: UI / Input

**Purpose:** touch input handling, HUD, menus, Editor App. Translates player intent into commands for the World Simulator.

**Depends on:** Persistence, World Simulator (for command submission), Renderer.

**Interface:**

```csharp
public interface IUserInterface {
    void Initialize(IPersistence persistence, IWorldSimulator sim);
    void EmitCommand(Command cmd);
    void ShowScreen(ScreenId screen);
}
```

**V1 implementation:** Unity UI for mobile + tablet. Touch-first; two-thumb command language; strategic zoom. Editor App is a separate scene with chassis-sculpting + hardpoint-snapping tools.

**Platform notes:** the Editor App may evolve into a separate desktop/tablet app sharing the Schematic format; the in-game UI stays in the main app.

---

### Module 11: Agent Runtime (V3+)

**Purpose:** call AI services to generate content (Production-time and Runtime). Validate outputs against the constitution. Deploy generated Schematics through the Loader.

**Depends on:** Schematic Loader, Event Director.

**Interface:**

```csharp
public interface IAgentRuntime {
    Task<GeneratedContent> RequestScenario(WorldObservation observation);
    bool ValidateAgainstConstitution(Schematic content, out List<Violation> errors);
    Task DeployIfValid(GeneratedContent content);
}
```

**V1:** module does not exist (no AI agents in V1).
**V2:** still does not exist (PvP focus).
**V3:** introduced. Quality-gate against constitution is mandatory before deploy.

---

## Part 4: Module Interactions / Data Flow Scenarios

### Scenario 1: A match tick (30 times per second)

```
[Input batch] ──► World Sim ──► Event Director ──► (schedule/fire events)
                       │
                       ├──► Behavior Runtime ──► Physics (sensor queries)
                       │
                       ├──► Physics Solver ──► (resolve motion, ballistics, heat)
                       │
                       ├──► State update
                       │
                       └──► Renderer reads snapshot ──► frame
```

In V2 lockstep, the input batch is the combined inputs from all human participants for that tick, exchanged via Network Sync. Simulator is identical across all clients.

### Scenario 2: Session boundary sync

```
[Session ends]
       │
       ▼
World Sim hands final state to Persistence
       │
       ▼
Persistence saves locally
       │
       ▼
Network Sync uploads diff to cloud
       │
       ▼
On next session start: pull updates, apply, then start new match
```

V1: cloud is the player's own account backup. V2+: cloud also distributes shared content (others' Halls, designs, AI-generated scenarios).

### Scenario 3: Content update (CDN push)

```
Server publishes new Schematic ──► CDN cache
                                       │
                                       ▼
                                Client requests deltas at next session
                                       │
                                       ▼
                                Schematic Loader pulls
                                       │
                                       ▼
                                Validates against schema + constitution
                                       │
                                       ▼
                                Available immediately (hot-reload-safe)
```

Per the invariance rule, all content is additive. New Schematics never invalidate old; clients can be on different versions and still interoperate.

### Scenario 4: Player builds a unit in the Editor App

```
Player sculpts voxel chassis ──► chassis Schematic draft
                                       │
Player snaps parts to hardpoints ──► part references added
                                       │
                                       ▼
                                Editor validates (physics constitution)
                                       │
                                       ▼
                                Persistence saves locally
                                       │
                                       ▼
                                (Optional) Player publishes to shared library
                                       │
                                       ▼
                                Schematic uploaded; signature attached
```

### Scenario 5: Marketplace purchase (V2)

```
Player browses marketplace ──► UI queries shared library
                                       │
                                       ▼
                                Player clicks Buy ($0.25)
                                       │
                                       ▼
                                Payment processed (Stripe-like)
                                       │
                                       ▼
                                Schematic copied to buyer's Persistence
                                       │
                                       ▼
                                Creator credited
                                       │
                                       ▼
                                Buyer can build the unit immediately
```

### Scenario 6: AI agent generates content (V3)

```
World observation gathered ──► Agent Runtime
                                       │
                                       ▼
                                Scenario writer drafts arc
                                       │
                                       ▼
                                Content generator produces Schematics
                                       │
                                       ▼
                                Quality gate validates (constitution check)
                                       │
                                       ▼
                                Continuity agent integrates with existing lore
                                       │
                                       ▼
                                Human reviewer approves (V3 launch) / auto-deploys (V3 mature)
                                       │
                                       ▼
                                Schematic Loader ingests; pushed to relevant cohorts
```

---

## Part 5: Cross-Cutting Concerns

### Determinism

The constitution's promise of lockstep multiplayer depends on the simulation being bit-identical across all platforms. IEEE-754 floating-point math differs subtly across CPUs and can desync identical simulations after a few minutes of play.

**Mitigations:**
- **Fixed-point math** throughout physics solver. No raw floats in deterministic code paths.
- **Seeded PRNG** for any randomness; seed is part of synced match state.
- **Ordered operations** for any iteration over unordered collections (sort by stable ID).
- **No platform-specific math** (e.g., trigonometry libraries that differ across runtimes — use our own implementations or known-deterministic ones).
- **Determinism test suite** runs the same simulation on every supported platform; any divergence is a release blocker.

### Performance

Target: 30 fps on mid-range mobile (2020+ phones) with up to 200 units in a match.

**Strategies:**
- LOD physics: distant units use coarser physics ticks.
- Equation precompilation: parse formula strings once at load; evaluate against compiled AST.
- Batched updates: physics solver processes all units of a type in one pass.
- Rendering culling: only visible units drawn at full fidelity.
- Behavior tree caching: re-evaluate only when world state relevant to that tree changes.

**Bandwidth budget:** ~100 MB / active player / month is a design target. PvP match = 1-5 kbps lockstep inputs. Session-boundary sync = MB-scale diffs.

### Security

- **Sandboxed equation evaluator** — no arbitrary code; whitelisted math operations; time and memory caps.
- **Schematic validation** at load time rejects malformed or constitution-violating content.
- **Signed Schematics for PvP** — V2 requires Schematics in PvP matches to be signed by the platform or marketplace. Offline play permits unsigned (modding seam).
- **No untrusted code execution.** Modders extend via Schematics (data + sandboxed expressions), never via uploaded code.
- **Anti-cheat in lockstep:** all clients run identical simulation; if any client's reported state diverges from others, that client is flagged.

### Modder safety

Modders can extend via:
- New unit/part/weapon/structure Schematics
- New equation Schematics
- New environment Schematics
- New event Schematics
- New behavior tree Schematics
- New cosmetic identity assets (badges, flags, palettes)

Modders CANNOT:
- Replace existing Schematics (invariance rule).
- Execute arbitrary code on the engine.
- Bypass the constitution (validation catches it).
- Use unsigned content in PvP (V2+).

### Localization

- Schematic text fields (faction lore, narrative beats, UI strings) live in localization Schematics keyed by locale.
- AI-generated narrative content (V3) is generated per-locale or generated-then-translated.
- Editor App supports unicode for unit names, paint kit names, etc.

### Modular boundaries enforced

Every module talks only through its declared interface. Reaching into another module's internals is a code-review failure. Integration tests cover module boundaries; unit tests cover internals. Each module has multiple possible implementations behind one interface; selected by configuration.

---

## Part 6: Extension Seams (V1 → V2 → V3)

The architectural insurance policy. Every deferred feature has an extension point already built into V1.

| Deferred Feature (V2+) | V1 Seam |
|---|---|
| Lockstep PvP | Network Sync module exists as `local-only` stub; V2 swaps implementation |
| Matchmaking | Match model already supports `participant roster`; V1 fills with AI, V2 fills with humans |
| Cross-player content propagation | Schematic Loader handles any source; V1 loads local, V2 loads remote |
| Clans / alliances | Faction Schematic has `parent_faction` field; V1 leaves null; V2 populates |
| Runtime narrative AI | Event Director has `external_director` interface; V1 catalog-only; V3 catalog-or-agent |
| Living-world aggregate state | Persistence has unimplemented `aggregation` hook; V3 adds service |
| PvP Hall captures | Hall record format already has opponent-Commander metadata fields; V1 only writes faction defeats |
| PvP-toggle sanctuary | Match already has `pvp_open: bool` per Commander, hardcoded true (no PvP); V2 honors flag |
| Phase 2/3 content (Lunar, Reach) | New environments + new equations + new chassis are pure content; engine unchanged |
| Real-brand ads at scale | Ad-content Schematic format ships V1 with fictional analogues; V2 adds real-brand pipeline behind same interface |

**The pattern:** every V2/V3 feature is a content addition + an implementation swap inside an existing module interface. None require new modules or interface changes.

---

## Part 7: Technology Choices

### Engine: Unity (initial)

**Why:** mobile cross-platform support, mature toolchain, large community, asset-store ecosystem.

**Limits:** Unity-specific code only in Rendering and UI modules. Simulation, physics, AI, persistence, networking are all in pure C# with no Unity dependencies — so they can run in tests without Unity and can be ported to another engine if needed.

**Swap path:** if Unity proves wrong (cost, performance, philosophy), Rendering + UI modules are the boundary. ~15% of codebase touched, not 100%.

### Language: C# (primary)

**Why:** strong typing, mature ecosystem, performant on mobile via IL2CPP/Mono, good interop with Unity.

**Where:** all eleven engine modules + Schematic Loader + Editor App.

### Format: JSON (Schematics)

**Why:** human-readable (modder-friendly), tooling-rich, compresses well over the wire, native parser support everywhere.

**Tradeoff:** parse cost is real on mobile. Mitigation: parse once at load, cache parsed AST; potentially swap to a binary format (MessagePack) later if profiling demands it.

### Physics math: fixed-point library

**Why:** determinism for lockstep multiplayer.

**Implementation:** a well-tested fixed-point library (e.g., FixedMath.Net or custom). All physics solver math uses fixed-point types; no raw floats in deterministic code paths.

### Networking: WebSocket relay (V2)

**Why:** broad firewall traversal, mature libraries, good mobile support.

**Alternative:** UDP for lower latency where reliability isn't needed. May add later for ranked PvP.

### AI / LLM (V3): provider-agnostic

**Why:** the LLM landscape changes; we don't want lock-in.

**Implementation:** Agent Runtime module wraps multiple providers behind a single interface. Production-time agents can use one model; runtime can use another. Quality gates are the same regardless of provider.

### Database (server-side): PostgreSQL + S3-equivalent

**Why:** PostgreSQL handles relational player data (accounts, Halls, libraries); object storage handles SVG uploads and Schematic blobs. Both are commodity, well-understood, cost-efficient.

### CDN: standard (Cloudflare, Fastly, CloudFront)

**Why:** content delivery is small, deltas-only, doesn't justify exotic infrastructure.

---

## Open questions

- OPEN[2026-05-27]: equation expression format (JSON expression strings vs structured DSL vs compiled C#). Recommendation: JSON expressions with sandboxed evaluator + optional precompile. blocks: `docs/schematics.md` patch.
- OPEN[2026-05-27]: fixed-point math library choice. Need evaluation of FixedMath.Net vs custom vs alternatives. blocks: engine prototype M1.
- OPEN[2026-05-27]: Unity vs alternative engine final choice. Recommendation: Unity for V1 unless prototype reveals show-stopper. blocks: engine prototype M1.
- OPEN[2026-05-27]: AI provider for V3 agents. Defer until V3 planning; the abstraction layer doesn't force the choice now.
- OPEN[2026-05-27]: per-match unit-design cap (8-12 proposed). blocks: `docs/monetization.md`.
- OPEN[2026-05-27]: marketplace earn-path time equivalence (5-20h proposed). blocks: `docs/monetization.md`.

## Cross-references

- [DESIGN.md](../DESIGN.md) — design constitution and locked decisions
- [docs/roadmap.md](roadmap.md) — phases and milestones aligned to this architecture
- [docs/schematics.md](schematics.md) — data format spec (Schematic Loader's contract)
- [docs/physics.md](physics.md) — environments and equation catalog (Layers 1-2)
- [docs/economy.md](economy.md) — resource model (Layer 3 economic inputs)
- [docs/factions.md](factions.md) — faction identity (Layer 3 model archetypes)
- [docs/infrastructure.md](infrastructure.md) — runtime infrastructure (server-side)
- [docs/engine-architecture.md](engine-architecture.md) — deeper per-module specifications (future doc)
- [docs/risks.md](risks.md) — risk register
- [pitch/PITCH.md](../pitch/PITCH.md) — external/business view of this architecture
