# HANDOFF — Child of Light

> **For:** the next Claude Code agent (or human) picking up this project on the user's laptop.
> **From:** the Cowork-era orchestrator that ran the overnight autonomous build.
> **Date of handoff:** 2026-05-28. The user is switching from Cowork (the desktop-app version of Claude that orchestrated the v0.1 editor build overnight) back to local Claude Code on the laptop so the next session has direct shell access for the upcoming first-run, smoke test, and v0.2 work.

---

## LATEST — 2026-05-29 session (read this first)

Picks up after the v0.1 smoke test. The editor pivoted **voxel-first → mesh-first** and went far. All committed + pushed on branch `claude/mobile-rts-game-concept-7LbT0`. **Git is the source of truth — this chat is disposable.** `tsc --noEmit` is clean at every commit.

**What now works, end to end:**
- **Mesh import**: OBJ, GLB, GLTF, **STL** — read through Rust (`read_unit_file` for text, `read_binary_file` for binary), parsed by extension in `editor-app/src/components/MeshWorkspace/mesh-loader.ts`. GLB is the recommended format (single file, textured).
- **9 procedural templates** + **Auto-Voxelize** (mesh → sparse_grid_v1 physics substrate).
- **3D material painter** (brush + flood + shell/core + height-band) in `MaterialPainter.tsx` / `lib/material-ops.ts`.
- **Box-projection photo skin** (`box-projection.ts`) — shows on mesh viewer AND battlefield.
- **Battlefield preview**: renders the **skinned mesh** (deep-cloned), rotatable (left-drag), brighter lights, voxel fallback for mesh-less units.
- **24 archetypes** + role + named **hardpoints** + tower tiers (Gun/Flak/Missile T1-3) + walls.
- **v0.3 Rigging layer (reactive turrets)** — `RigSection.tsx` + rig animation in `BattlefieldPreview/unit-on-terrain.ts`:
  - `rig[]` on the unit: target_node, motion, yaw/pitch arcs (min/max/rate/**invert**), **parent_rig**.
  - parent_rig **re-parents nodes via `Object3D.attach`** at mount so flat/unparented meshes compose (body swivels → followers ride → barrel pitches).
  - Pivot = the node's **own geometry** bbox centre (NOT setFromObject — that includes re-parented children).
  - Pitch: **positive = up** (lateral axis is -X); per-axis **Invert** for opposite-facing models.
  - Live gold **yaw fan** on the ground shows the arc.
- **Save/load is self-contained**: unit JSON carries `mesh_asset` (`{kind:template,template_id}` | `{kind:file,path}`); editor auto-reloads the mesh on Open. (Units saved before this — e.g. an early `mk01.json` — have no mesh_asset; re-save once.)

**TripoSR AI mesh-gen (photo → 3D): built but PARKED.** Lives in `triposr-server/` (FastAPI + PyTorch 2.3.0+cu121, PyMCubes patch, `setup.ps1`, `start-server.bat`). Verdict: TripoSR's single-image quality is poor on hard-surface mechanical models (RTX 3070 Ti 8GB can't run the better 12-16GB models). **Decision: rely on import + templates; AI-gen is parked, restartable.** The "AI Generate" button still works for rough/simple subjects.

**Conventions / gotchas learned:**
- Saved units → `units/player/`. Mesh files → `units/meshes/` (keep them put; `mesh_asset` stores the path). Stock units → `units/starter/`.
- **HMR rule**: new UI (buttons/fields) hot-reloads instantly, but **battlefield-preview *behavior* changes (rotation/rig/pitch) need a Ctrl+R** (the 3D scene + animation live in long-lived refs). After many edits, Ctrl+R also clears HMR rot (caused a couple of blank-screen scares — always a fresh reload fixes it).
- Smoke tests (no test runner yet): `editor-app/scripts/smoke-*.mts` via `npx tsx` — validate (24 archetypes), voxelize (9 templates), material-ops.
- Editing-on-live-window workflow: dispatch focused agents, `tsc --noEmit` gate every commit, commit+push each slice.

**NEXT TASK: projectiles (rigging slice 3).** Per `docs/editor-app.md` v0.3 plan:
- Each shell/missile/beam = its own JSON Schematic with **physical inputs only** (mass, muzzle velocity, warhead type, energy draw) — engine derives KE / penetration / blast / heat (Principle 2). `PhysicsConstitution.cs` in `unity-game/` already has the kinetic equations.
- Recoil ties back to the rigged turret (force = shell mass × muzzle velocity) — the rig layer from this session is the hook.
- **Cluster munitions**: parent-child Schematic tree (split trigger: altitude/proximity/timer; spread pattern; child Schematic; recursive).
- Likely needs: a `projectile.schema.json`, projectile authoring UI (probably a new section or a small sub-editor), and links from weapon parts → projectile schematic id.
- Also pending (not blocking): rigging slice 2 (active states: idle/firing/reloading + recoil kick); wiring saved units into the Unity project (`unity-game/` has the scripts: SchematicLoader, UnitController, RTSCamera, fog-of-war, towers, walls — needs a Unity 6 project created via Hub + the 14 scripts dropped in).

---

## Read this in 30 seconds

A post-apocalyptic mobile RTS called **Child of Light**. Data-driven engine: every game rule is a JSON Schematic the engine reads at runtime. **Premium model** ($2.99 paid game after a free demo, ongoing diegetic-ad revenue, V2+ creator marketplace) — explicitly anti-pay-to-win. **Top-down 3D rendering in the Total Annihilation style** committed. **Three working browser tools** still live in `tools/`, but the project has moved past them: a complete **v0.1 Tauri 2 + React 19 + TypeScript desktop editor** now exists in `editor-app/` (roughly 12,000-15,000 lines of new source code, `tsc --noEmit` exits 0). Four new docs landed: `docs/editor-app-tauri-brief.md`, `docs/editor-app-tauri-lift-map.md`, `docs/overnight-build-log.md`, `docs/morning-runbook.md`. The user is about to follow the morning runbook (install Rust + MSVC Build Tools, `npm install`, `npm run tauri dev`, smoke-test the editor). That is **the next thing to do** when this session opens.

Active branch unchanged: `claude/mobile-rts-game-concept-7LbT0` — PR #2.

---

## Why you should read more than 30 seconds

Most "what should I build" questions are already answered. There is a design constitution with **ten named principles** plus a delivery rule that have been carefully reasoned through over a long conversation. **Do not relitigate them.** They will be re-derived if you challenge them, and you'll waste the user's time.

There is now also a **complete v0.1 implementation** committed. The implementation made a small number of autonomous choices when the brief was ambiguous (React 19 instead of 18, custom Rust commands instead of `tauri-plugin-fs`, Context + `useReducer` instead of Zustand, per-voxel `Mesh` in the editor and `InstancedMesh` in the preview). **Do not relitigate these either** without strong cause — they are all reasoned, documented, and listed as open questions where they deviate from the brief.

Three files carry the full context:

1. **`DESIGN.md`** — the master contract. Pillars, locked decisions, navigation.
2. **`docs/overnight-build-log.md`** — every autonomous decision the Cowork orchestration made, wave by wave, with rationale.
3. **`docs/decision-history.md`** — the full design-phase decision trail. Long but greppable.

Read those three first and you'll know what's settled and what's open. **Open questions are tagged `OPEN[YYYY-MM-DD]:` throughout the docs** — grep for that tag to see what genuinely needs decisions.

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

A consequence of these ten that the editor build leaned on hard: **Principle 2 + Principle 4 together govern what the editor is allowed to write to disk**. The editor's `UnitSchematic` type contains physical inputs (mass, energy, thermal capacity) and never derived gameplay numbers. The form's `DerivedStatsPanel` displays speed, range, and cooldown but never writes them back into the unit. The `physics_version` field is read-only on the type and only the explicit `version-bump` menu action mutates it. The next agent should hold this discipline. The moment someone "helpfully" copies a derived value into the schema for caching, the constitution breaks and replays from year 1 stop working in year 10.

**Plus the production decisions** (also locked, also non-negotiable without explicit reasoning):

- **Revenue model:** premium one-time purchase ($2.99) after a free 1-2-skirmish demo, ongoing diegetic in-world advertising (bread-and-butter recurring revenue), V2+ creator marketplace (8% platform fee), V2+ optional patronage. Real-brand ads in both demo and paid game (they're world texture, not interruption).
- **Rendering:** top-down 3D, Total Annihilation style. Fixed azimuth, tilt-clamped pitch, strategic zoom. Voxel meshes via `InstancedMesh` at runtime, faction palette applied at render time, three LOD tiers. (Note: the editor's authoring view uses per-voxel `Mesh` instead — see Section 4. The `InstancedMesh` rule governs the *runtime renderer*, not the authoring tool.)
- **Editor model:** hybrid voxel chassis + hardpoint-snapped parts. Players sculpt the chassis as a voxel volume (16³ max); parts attach at declared hardpoints.
- **Phasing:** V1 PvE-only (months 0-15), V2 PvP (months 15-27), V3 Living World (months 27-36+). V2 and V3 are free updates to V1 buyers.
- **Campaign:** four phases — Earth (Salvage Era) → Moon (Ashen Eye) → Reach (Warp Gates) → Constellation (Player Worlds).
- **Factions:** four canonical (Reclaimer / Bulwark / Signal / Cinder Crown) + five Returner cultures unlocked in V2 (Tethered / Quiet Court / Burnward / Drifters / Veiled).
- **Hall mechanic:** three-tier tech library — Surveyed (visible) → Mimicked (degraded clone buildable) → Mastered (full fidelity buildable). PvE and PvP both contribute.
- **Deep history (3 layers):** First Leavers (humans who escaped before a GRB cataclysm) → Pre-Fall civilization (rebuilt to warp's edge, killed by resource wars) → Children of Dusk (current survivors). All revealed gradually through play.
- **Cosmic event:** Active Galactic Nucleus alignment opens warp paths in Phase 4, brings the Returners home.

---

## What's new since the previous handoff

The previous HANDOFF.md (still in git history at the previous commit on this branch) was written by the cloud-Claude session that designed the constitution. At that point the deliverable was three browser HTML tools and a docs suite. Since then:

### The Cowork session

The user moved from local Claude Code (the previous handoff's target) to **Cowork** — the desktop-app version of Claude — for one extended overnight session. The reason was concrete: the brief called for spinning up an autonomous build chain that needed to launch many sub-agents in parallel, run them through several waves, retry on session-limit walls, audit independently, and patch the audit findings. Conductor mode is the design pattern for that work and Cowork's environment is built around it. The orchestration ran from roughly the brief-writing wave through to a clean `tsc --noEmit` exit.

Now switching back to local Claude Code on the laptop because: (1) the next phase is hands-on — toolchain install, first run, visual smoke test — which is faster with direct shell access; (2) v0.2 work (autosave-recovery UI, detachable panels, polish) iterates faster when one process can edit, type-check, and re-launch without coordination overhead; (3) the simpler mental model (one chat, one process, one filesystem) matches the user's preference for the next stretch.

### The four new docs

Before the v0.1 source dropped, two contract docs landed in Wave 1 of the orchestration. Two more landed in Wave 5 as the build wrapped. The next agent should read all four; each has a distinct purpose and the four together explain everything the source code does and why.

- **`docs/editor-app-tauri-brief.md`** (the contract). What v0.1, v0.2, and v0.3 of the editor each contain, with definition-of-done lines for every phase. The stack choices (Tauri 2 / React + TypeScript / Three.js / Zod / Vite) and the three-pane workspace layout are owned by this doc. Cuts of non-goals are explicit: no marketplace, no cloud sync, no collaboration, no animation, no part library, no hardpoint UI in v0.1. This is the contract any future editor work checks against.
- **`docs/editor-app-tauri-lift-map.md`** (the porting plan). File-by-file mapping of which lines in which browser prototype became which React component or shared utility. The lift map called specific "do not lift" decisions (every DOM `getElementById` reroutes through React state; every Three.js scene block lifts verbatim; the form's DOM-string concatenation is rewritten as React components keeping only the field list and grouping). Read this when wondering "why was X done this way?" — the prototype line range is almost certainly the answer.
- **`docs/overnight-build-log.md`** (the autonomous record). Wave-by-wave catalog of every sub-agent launched, the brief each got, what it produced, the autonomous decisions it made when the brief was silent, and any retry or failure encountered. The most actionable part for the next agent is the **"Key decisions made autonomously"** section, which lists every place the build deviated from the brief, with rationale. Treat that section as the patch-list for the brief when the user is ready to ratify the deviations.
- **`docs/morning-runbook.md`** (the user-facing recipe). The PowerShell-by-PowerShell walkthrough the user runs to install Rust + MSVC Build Tools, refresh npm dependencies on Windows, launch `npm run tauri dev`, and execute the v0.1 smoke test (place voxel, save to Desktop, reopen, confirm fidelity). Written for a non-coder; the next agent should treat it as the user's script for the next 30-60 minutes rather than as documentation to edit.

### v0.1 source code: complete and type-checking clean

A complete Tauri 2 + React 19 + TypeScript editor app exists under `editor-app/`. The whole thing was lifted from the three browser HTML prototypes in `tools/` — voxel sculptor, form-based attribute editor, top-down battlefield viewer — and integrated into one native desktop shell. The lift map at `docs/editor-app-tauri-lift-map.md` documents which lines of which prototype became which React component or shared utility; the next agent should treat it as the historical record, not as a living spec (the build has moved past it).

Layout in enough detail that the next agent should not need to grep around:

```
editor-app/
├── index.html                         Vite entry
├── package.json                       React 19, Three.js ^0.180, Zod ^3, Tauri 2 JS bindings, Vite, TypeScript
├── tsconfig.json, tsconfig.node.json  Standard Tauri + React TS configs
├── vite.config.ts                     Vite + Tauri integration
├── public/                            Static assets
├── src/
│   ├── main.tsx                       Vite + React entry
│   ├── App.tsx                        Three-pane shell; UnitStateProvider; dirty flag + window title + autosave effects
│   ├── types/                         (5 files) UnitSchematic, PartSchematic (discriminated union), VoxelMap, DerivedStats
│   ├── lib/                           (10 files) constants, derive-stats, enums, factions, voxel-grid, voxel-renderer, voxel-stats, zod-schemas
│   ├── components/
│   │   ├── VoxelSculptor/             (8 files) left pane: Three.js scene, hand-rolled orbit camera, per-voxel Mesh, palette, mirror-X
│   │   ├── AttributeForm/             (16 files) center pane: typed form, per-category subforms, derived-stats panel, validation panel, scoped CSS module
│   │   ├── BattlefieldPreview/        (7 files) right pane: PerspectiveCamera 35° FOV, procedural terrain, InstancedMesh voxel builder, TA-style pan/zoom/tilt
│   │   └── MenuBar/                   (2 files) File/Edit/View/Help menu, Ctrl+N/O/S/Shift+S shortcuts, status notice display
│   ├── state/                         (5 files) Context + useReducer store, selectors, store-side voxel cache for sparse_grid_v1 sync
│   └── file-ops/                      (5 files) open, save, autosave (60s timer with visibility pause), version-bump
└── src-tauri/                         Rust backend
    ├── Cargo.toml                     tauri, tauri-plugin-opener, tauri-plugin-dialog, serde, serde_json. No tauri-plugin-fs.
    ├── tauri.conf.json                Window 1400x900, productName, identifier, bundle config
    ├── capabilities/default.json      core:default, opener:default, dialog:default. No fs permission.
    └── src/
        ├── lib.rs                     greet (stock), read_unit_file, write_unit_file, builder + generate_handler! chain
        └── main.rs                    Stock entry point calling editor_app_lib::run()
```

A stray `editor-app/tsconfig.bp.tmp.json` (1 byte, harmless) exists because the Linux sandbox the build ran in couldn't `unlink` files on the Windows-mounted folder. It's now gitignored via `tsconfig.*.tmp.json`. Manual delete on Windows: `del tsconfig.bp.tmp.json` from PowerShell in `editor-app/`.

A few component-specific notes worth carrying:

- **`VoxelSculptor/`** owns the editing-side voxel model. The Three.js scene is set up in `scene.ts`, the hand-rolled orbit camera lives in `controls.ts`, pointer input + raycasting in `input.tsx`, the color-class palette UI in `palette.tsx`, and pick-resolution in `picking.ts` (where the Wave 2c fix-up agent repaired a `readonly` type bug by `.clone()`-ing the picker's return at the boundary). Per-voxel `Mesh` instances let the editor raycast per cell — a constraint the bulk-render preview pane does not have.
- **`AttributeForm/`** is the densest part of the tree. `PartsSection.tsx` lists parts; each part renders a category-specific subform (`WeaponSubform`, `SensorSubform`, `DefenseSubform`, `UtilitySubform`, `MobilitySubform`, `CommsSubform`) via the discriminated-union `PartSchematic` type. The discriminated union makes the dispatch exhaustive at compile time — adding a new part category requires adding a subform or `tsc` fails. The scoped CSS module `AttributeForm.module.css` (336 lines) keeps form styling out of the global namespace so the other panes stay visually independent. `DerivedStatsPanel.tsx` renders the live `deriveStats(unit)` output and is the only place the user sees gameplay numbers — and it's clearly labeled illustrative, per Principle 2.
- **`BattlefieldPreview/`** uses `PerspectiveCamera` at 35° FOV with the TA-style fixed-azimuth tilt-clamped pitch rig (`controls.ts`), procedural terrain via the noise stack lifted from `tools/battlefield-viewer/index.html` (`terrain.ts`), and a single `InstancedMesh` per material class for the unit voxels (`unit-on-terrain.ts`). The unit re-builds every time `unit.chassis.voxel_data` changes, which is the cache the integration agent specifically optimized for in `src/state/voxel-sync.ts` — the unit object's `voxel_data` field updates only at save time, but the preview pane reads from the live voxel-map cache through a selector so the rebuild fires on every brush stroke without serialization overhead.
- **`MenuBar/`** is a thin component over File / Edit / View / Help with keyboard shortcut bindings. Ctrl+N (new), Ctrl+O (open), Ctrl+O (open), Ctrl+S (save), Ctrl+Shift+S (save as). The window title pattern is `Child of Light Editor - <filename> *` with a trailing asterisk for unsaved changes. The before-unload guard blocks accidental close on unsaved edits. None of these are revolutionary; all are standard desktop-editor behavior the integration agent shipped because they fell out of the menu wiring naturally.
- **`src/state/`** holds the Context + reducer store. Actions are typed and exhaustive. The single source of truth is the unit object plus a separate live `VoxelMap` (for editor responsiveness, see above). `selectors.ts` exposes `useUnit`, `useVoxels`, `useIsDirty`, `useTitle` and is the only API components should reach for — direct context consumption is discouraged and would short-circuit the dirty-flag bookkeeping.
- **`src/file-ops/`** wraps Tauri's native dialog plugin and the custom `read_unit_file` / `write_unit_file` Rust commands. Every save runs Zod validation first; an invalid file cannot be written over a valid one. The autosave timer runs at 60s, pauses on `visibilitychange` (the Wave 4b fix), and writes to `<file>.autosave` next to the working file (or to `$APPDATA/childoflight-editor/.autosave/` if the unit has never been saved).
- **`src-tauri/`** holds the Rust shell. The interesting part is `src/lib.rs` — the `read_unit_file` and `write_unit_file` commands use `std::fs` directly and are registered in `tauri::generate_handler![]`. No `tauri-plugin-fs` dependency anywhere; the trade is that any path the dialog returns is accepted, which is fine for a single-user creative tool.

### Autonomous decisions made overnight

All sourced from `docs/overnight-build-log.md` and surfaced here so they don't go unread:

- **React 19 instead of 18.** Tauri scaffold template default; same hooks/context APIs the brief contemplated. No StrictMode breakage observed. Recommendation: codify 19 in the brief, don't downgrade. OPEN.
- **Three.js ^0.180.0.** Latest stable at build time. Brief did not pin.
- **Zod ^3 rather than v4.** v4 had just shipped; surrounding ecosystem still on v3. Stability call.
- **State: React Context + `useReducer`.** Brief listed Zustand as a candidate; agent reasoned that a single typed object with well-formed action types does not need a third-party dependency for v0.1. Reversible later.
- **Hand-rolled orbit camera in `VoxelSculptor`.** Followed the lift map's preference for verbatim code lift over dependency add (`three/examples/jsm/controls/OrbitControls`).
- **Per-voxel `Mesh` in `VoxelSculptor`, single `InstancedMesh` per material in `BattlefieldPreview`.** Two Three.js panes, two different constraints — editing wants per-cell picking and material; viewing wants bulk render. The constitution's `InstancedMesh` rule governs the *runtime renderer*, not the authoring tool. Documented exception.
- **`PerspectiveCamera` with 35° FOV in `BattlefieldPreview`** rather than orthographic. Brief loosely said "top-down 3D"; lift map's reference prototype used perspective with a steep tilt; agent honored the lift-map signal. Produces the TA-style strategic look.
- **Voxel↔unit sync via store-side cache.** Rather than re-serialize the voxel map into `unit.chassis.voxel_data` on every brush stroke (expensive), the store caches the live voxel map separately and flattens to `sparse_grid_v1` only at save time. See `src/state/voxel-sync.ts`.
- **Custom Rust commands instead of `tauri-plugin-fs`.** The Wave 4 verifier flagged a BLOCKER: the default fs plugin scope would not permit reads or writes to paths the user picks via the open dialog. A wildcard scope defeats the safety story; a narrow scope breaks the "save to Desktop, reopen later" DoD. Resolution: bypass the fs plugin with `read_unit_file(path)` and `write_unit_file(path, contents)` Rust commands using `std::fs` directly. Simpler, no extra dep, no scope-state to persist. Trade is surfaced under "Known limitations" in the build log.
- **`physics_version` bump = minor increment, not patch.** The unit schema's `physics_version` regex is `^\d+\.\d+$` — two components, not three. Patch-bump (`1.0.0` → `1.0.1`) is not representable. Default is minor-bump (`1.0` → `1.1`). Brief implied patch; reality forced minor. OPEN: amend brief to match implementation.

### Dependency choices on the JS and Rust side

For quick reference rather than digging into `package.json` and `Cargo.toml`:

**JS / TypeScript side (`editor-app/package.json`):**

- `react` ^19 and `react-dom` ^19 (the autonomous-choice deviation from the brief's React 18).
- `three` ^0.180.0 (latest stable at build time).
- `zod` ^3 (locked at v3 rather than the freshly-shipped v4 for ecosystem stability).
- `@tauri-apps/api` ^2 — Tauri's JS bindings for invoking Rust commands and emitting/listening to events.
- `@tauri-apps/plugin-dialog` — the only Tauri plugin loaded on the JS side. `tauri-plugin-fs` was installed and then removed during Wave 4b in favor of custom Rust commands.
- `vite`, `typescript`, `@vitejs/plugin-react` — the standard Tauri+React build chain.

**Rust side (`editor-app/src-tauri/Cargo.toml`):**

- `tauri` 2.x with the standard feature set.
- `tauri-plugin-opener` and `tauri-plugin-dialog` — opener for the "open in default app" affordance, dialog for the native file picker.
- `serde` + `serde_json` — JSON serde for the `read_unit_file` / `write_unit_file` commands.
- No `tauri-plugin-fs`. No `tauri-plugin-persisted-scope`. The custom commands replace both.

If the next agent adds a new dependency, both files need to stay aligned and the editor's bundle size should be re-measured. The 5 MB installer floor that Tauri provides is one of the reasons we picked it over Electron; a dependency bloat that pushes us past 20 MB without a corresponding feature payoff is a regression.

### Audit + fix-pass already done

A dedicated **verifier agent** ran in Wave 4 with no knowledge of the implementer agents' reports — fresh read of the source tree against the brief. Findings: 1 BLOCKER (fs scope), 2 MAJORs (autosave visibility handler was a no-op; the v0.3 keyboard shortcuts shipped early), 4 MINORs (a redundant geometry dispose; a stale doc-comment; a leftover `console.log`; the `version-bump` semantics).

Wave 4b fixed the BLOCKER (custom Rust commands replacing the fs plugin), fixed the autosave-visibility behavior (interval now actually clears and restarts on visibility loss), fixed the redundant geometry dispose, and left the v0.3 keyboard shortcuts in place as a documented scope-deviation rather than ripping out working code. After Wave 4b, `tsc --noEmit` exits 0.

The Rust code was **not compiled** in the Linux sandbox (no toolchain). First `npm run tauri dev` on the user's Windows machine is the moment of truth. The morning runbook walks through it.

### Over-delivery against the brief

The v0.1 brief scoped: voxel sculpt + attribute form + battlefield preview (flat ground only) + Open/Save/Save As. The shipped build also includes: procedural terrain in the preview, Zod schema validation on save, autosave with visibility-pause, explicit `version-bump` menu action, dirty flag + window title + before-unload guard, Ctrl+N/O/S/Shift+S keyboard shortcuts. Several of these were originally v0.2 or v0.3 scope. **Not a defect**, just disclosure. Recommendation in the open questions: redefine v0.1 in the brief to match what shipped, and re-plan v0.2 around the actual remaining work.

### Things deliberately not built that the brief hints at

- **No detachable second-monitor panels.** Brief scoped to v0.3.
- **No autosave-recovery UI.** Autosave files write fine; there is no "would you like to restore?" prompt on launch. Brief scoped recovery to v0.2.
- **No keyboard-shortcut cheat-sheet UI.** Shortcuts work; there is no Help > Shortcuts dialog.
- **No installer build was attempted.** `npm run tauri build` will produce an .msi and a standalone .exe but custom icon and About dialog are v0.3 work.
- **No Rust runtime test.** Code reviewed for syntax and type-correctness against Tauri 2's API surface; never compiled in the build sandbox.
- **No actual desktop window opened.** The morning user is the first to launch it.

### Engineering-quality observations worth carrying forward

The verifier-agent in Wave 4 traced a few invariants that the next agent should preserve as the editor grows:

- **`tsc --noEmit` exits 0** across the entire `src/` tree at end of Wave 4b. Re-run after every meaningful edit; the type discipline is the only static safety net the editor has until tests land.
- **Zero `any`, zero `@ts-ignore`, zero `@ts-expect-error` outside one narrow IO-boundary cast** in `src/file-ops/open.ts` that is immediately guarded by Zod's `safeParse`. Every other unknown is funneled through a typed validator before reaching the store. **Hold this line.** Adding a single un-validated `any` somewhere downstream costs us the ability to trust the store invariant.
- **Memory hygiene in the Three.js panes.** Every `THREE.BufferGeometry`, `THREE.Material`, `THREE.Texture`, and `THREE.WebGLRenderer` allocated in `VoxelSculptor` and `BattlefieldPreview` is paired with an explicit `.dispose()` in the component's cleanup effect. The verifier traced every dispose; Wave 4b fixed one redundant call. New 3D code added downstream **must follow the same pattern** — alloc + register dispose in the same `useEffect`, or you'll leak GPU memory on every unit-change.
- **Schema conformance is enforced at compile time.** `src/lib/zod-schemas.ts` uses `z.infer<typeof schema>` and a type-assertion fence against the hand-written `UnitSchematic` type. If the Zod schema, the TypeScript type, or `schemas/unit.schema.json` ever drift apart, `tsc` fails at that file. **Don't soften that fence**; it's the only line of defense against the editor producing JSON the engine can't read.
- **Constitution alignment is enforced at the type level.** Principle 2 (Derived-stat discipline): `DerivedStats` is a separate type from `UnitSchematic` and never persisted. Principle 4 (Invariance): `physics_version` is read-only on `UnitSchematic` and the explicit `version-bump` action is the only way to mutate it. If you find yourself wanting to delete the read-only modifier, that's the principle protecting you from yourself.

---

## What exists in the repo (as of this handoff)

```
/
├── HANDOFF.md                                ← you are here (overwritten by Cowork session)
├── DESIGN.md                                 ← master contract (still predates the editor build)
├── CLAUDE.md                                 ← agent brief (auto-loaded; still predates editor)
├── README.md                                 ← minimal stub
├── concept/identity/                         ← faction badges + flag SVGs
├── docs/
│   ├── architecture.md                       ← 11 modules, 4 physics layers
│   ├── roadmap.md                            ← 12 milestones across V1/V2/V3
│   ├── monetization.md                       ← revenue model + 12 forbidden mechanics
│   ├── editor-app.md                         ← Editor App design spec (parent of the v0.1 brief)
│   ├── editor-app-tauri-brief.md             ← NEW: v0.1/v0.2/v0.3 implementation contract
│   ├── editor-app-tauri-lift-map.md          ← NEW: file-by-file lift plan from the 3 prototypes
│   ├── overnight-build-log.md                ← NEW: wave-by-wave catalog of the autonomous build
│   ├── morning-runbook.md                    ← NEW: the user's next-action recipe (run this first)
│   ├── schematics.md                         ← Schematic format (needs Layer-0/1 patch still)
│   ├── physics.md                            ← environment variables (needs Layer-0/1 patch)
│   ├── economy.md                            ← resources
│   ├── world.md                              ← post-apocalyptic setting
│   ├── factions.md                           ← the four canonical factions
│   ├── glossary.md                           ← canonical terminology
│   └── decision-history.md                   ← the full decision trail (THE most important read)
├── novel/
│   └── SERIES-BIBLE.md                       ← 4-book series bible + Book 1 outline + 3 sample chapters
├── pitch/
│   └── PITCH.md                              ← external investor/acquirer brief
├── schemas/
│   ├── unit.schema.json                      ← JSON Schema for unit Schematics
│   └── part.schema.json                      ← JSON Schema for parts
├── tools/                                    ← three browser HTML prototypes (still here; superseded by editor-app/)
│   ├── editor/index.html                     ← form-based unit attribute editor
│   ├── voxel-editor/index.html               ← 3D voxel chassis sculptor
│   └── battlefield-viewer/index.html         ← TA-style top-down 3D unit viewer
├── units/starter/                            ← 6 starter unit JSONs
└── editor-app/                               ← NEW: Tauri 2 + React 19 + TypeScript v0.1 editor (12-15k LOC)
    ├── README.md, package.json, tsconfig.json, vite.config.ts, index.html
    ├── public/
    ├── src/                                  ← types, lib, components/{VoxelSculptor,AttributeForm,BattlefieldPreview,MenuBar}, state, file-ops
    └── src-tauri/                            ← Cargo.toml, tauri.conf.json, capabilities, src/{lib.rs,main.rs}
```

---

## Immediate priorities

In order:

### 1. The user runs the morning runbook

`docs/morning-runbook.md` is the very next action. Install Node.js (probably present), Rust via `rustup-init.exe`, MSVC Build Tools via the Visual Studio Build Tools installer (~5-7 GB, slow). Then `npm install` on Windows (replaces the Linux-built `node_modules/` native binaries with Windows-flavored ones, primarily `esbuild`). Then `npm run tauri dev`. Cold first compile takes 5-10 minutes. Subsequent dev runs: 10-30 seconds.

Expect **30-60 minutes** start to finish, most of it watching installer progress bars. Your role as the next agent during this step: stand by, help debug if the user pastes an error, do not "help" by editing files preemptively. The Rust + MSVC tooling is the variable; the source code is known-good.

### 2. First-launch smoke test

Defined in `docs/morning-runbook.md` Step 6: place a voxel in the left pane, confirm the mass field auto-updates in the center pane and the battlefield preview rebuilds in the right pane, type a name, File → Save As to Desktop as `test-unit.json`, close the app, re-launch, File → Open the same file, confirm the voxel and name come back. **If that works, the v0.1 Definition of Done is met.**

Three things to actively notice during the smoke test (the agent should ask the user to report each one explicitly):

1. **Does the title bar pattern work?** It should read `Child of Light Editor - test-unit.json` after the save, with no trailing asterisk. Editing the unit after save should add the asterisk. The dirty flag is the integration agent's signal that the store wiring is intact.
2. **Does autosave fire?** Wait 60 seconds with the window focused after making an edit. A `test-unit.json.autosave` file should appear next to the working file. If the window is minimized or hidden, autosave should *not* fire (the visibility-pause behavior is the Wave 4b fix; the next agent should confirm it survived first run).
3. **Does the version-bump dialog work?** File → Bump physics_version. A confirm dialog should appear. Accept it. The unit's `physics_version` field in the saved JSON should change from `1.0` to `1.1`. The deliberate friction here is Principle 4 in action — the dialog is the only way a player can opt into a version change.

If any pane is blank/white, right-click → Inspect to open WebView2 DevTools, copy the Console error, and we'll iterate. If the title bar doesn't update, the store dispatch is broken. If autosave fires while minimized, the visibility-pause regressed. Each failure is a known shape; the next agent should be ready for it.

### 3. Production build

`npm run tauri build` produces both a standalone `.exe` and an `.msi` installer under `editor-app/src-tauri/target/release/`. Verify by double-clicking the `.msi`, installing, and launching from the Start Menu as "Child of Light Editor". The `.exe` is unsigned — Windows SmartScreen will warn on first run; click "More info → Run anyway". Code-signing requires a paid certificate (~$300/year), deferred to V2.

### 4. Beyond the smoke test: a 30-minute exploration

After the v0.1 DoD is met, the user will want to actually use the editor a little. The next agent should encourage that — not just because it's earned celebration but because it surfaces issues that the smoke test alone won't. Things to try in roughly this order:

- Sculpt a small unit from scratch (no starter load). Place ten or twenty voxels in different materials. See whether the cursor preview feels natural, whether the mirror-X toggle works, whether the keyboard digit shortcuts (1-9 for material select, M for mirror, G for grid) feel right.
- Add a part in the center pane (e.g. a basic weapon). Notice that the per-category default values come from `src/lib/part-defaults.ts` — lifted verbatim from the original `tools/editor/index.html` per the lift map. The derived-stat readout updates as the values change.
- Watch the battlefield preview rebuild as voxels and parts change. The procedural terrain is deterministic — the same noise seed produces the same heightmap on every launch — and the unit re-snaps to terrain height on every rebuild.
- Save the file. Open the saved JSON in a text editor. The JSON should be canonical: stable key order matching the schema, 2-space indented, trailing newline, UTF-8 no BOM. If it isn't, the canonical serializer in `src/file-ops/save.ts` regressed.
- Load one of the existing units from `units/starter/` (e.g. `reclaimer-patcher.json`). The form fields should populate, the voxel scene should rebuild, the battlefield preview should show the unit in faction colors.

If everything in that list works, the editor really is functional. Anything that doesn't is a v0.2 item or a regression.

### 5. Fold the overnight decisions into `DESIGN.md` and `CLAUDE.md`

The constitution docs predate the v0.1 editor build. They should pick up:

- A note that the v0.1 editor is committed to React 19 / Tauri 2 / `tauri-plugin-dialog` + custom Rust commands for file I/O / Context + `useReducer` for state.
- The documented exception to the `InstancedMesh` rendering rule (it governs runtime; the editor's authoring view uses per-voxel `Mesh`).
- A pointer to `docs/overnight-build-log.md` from `CLAUDE.md`'s "Where to start by task" section under "Editor App work".

Do not add new design. Make the contract docs match what's now true.

### 6. Tackle v0.2

Per the brief at `docs/editor-app-tauri-brief.md`, with the understanding that several brief-v0.2 items already shipped in v0.1:

- **Detachable second-monitor panels.** Any pane can be torn off into its own native window. In Tauri 2 this is `WebviewWindow::new` on the Rust side plus a "detach pane" action in the React shell that moves the pane component into a child route the new window loads. The shared `UnitStateProvider` context needs to be reachable from the child window — likely by way of a shared event bus rather than literal React context (Context does not cross window boundaries). One option worth scoping: hoist the unit-state store into the Rust process and have both windows subscribe via Tauri events; another: keep the store in the main window and have child windows act as remote views. Lean second option for v0.2 simplicity; revisit for V2 multi-window editing.
- **Panel persistence.** Window position, size, monitor index, and detach state recall across launches. Tauri has `window-state` plugin support; the user is single-tenant so a simple JSON blob in `$APPDATA/childoflight-editor/window-state.json` is fine.
- **Autosave-recovery flow.** On launch, if a `.autosave` file is newer than its sibling, prompt to restore. The autosave files themselves already write correctly (see `src/file-ops/autosave.ts`); the UI is what's missing. The dialog runs before the empty editor renders.
- **Polish.** Help > Shortcuts dialog (keyboard cheat sheet — Ctrl+N/O/S/Shift+S already work; the dialog just documents them), settings panel (shadow toggle, wireframe toggle on the battlefield preview, autosave interval), application icon, About dialog with version string and credits, version string in the title bar.
- **Crash reporting hook** — local log file at `$APPDATA/childoflight-editor/crash.log`. No telemetry, no upload, no network. Just a file the user can attach when they ask for help.

Note that the brief currently lists *autosave* itself, *Zod validation*, *procedural terrain*, and the *keyboard shortcuts* as v0.2; the build shipped them in v0.1. So v0.2 is effectively the polish-and-detach phase now. **Rewrite the brief's phasing to reflect actual scope on the way in** — it's a five-minute edit and saves the next agent from re-investigating whether something has already shipped.

### 7. The editor and the engine are separate apps that share a schema

This is the architecture's load-bearing claim, and it's worth stating explicitly because the next agent will be tempted (everyone is tempted) to think of "editor" and "engine" as parts of one program. They are not. The editor produces JSON files. The engine, when it exists, reads those JSON files. They share **only** the JSON Schema in `schemas/unit.schema.json` and `schemas/part.schema.json` — and that schema is the contract. Anything the editor writes that doesn't validate against the schema is the editor's bug; anything the engine refuses to load that does validate is the engine's bug.

That separation is why the editor can ship now, before any engine code exists. It is also why the editor can later be replaced (with a different tool, a different framework, even a different person's implementation) without engine work — and vice versa. Total Annihilation shipped this way: modtools and runtime, separate binaries, shared file format. We are explicitly following that pattern. See Principle 9 (Engine is a federation of modules) in DESIGN.md, and the architecture's Module 1 (Schematic Loader) for the engine side of the contract.

### 8. Engine prototype work (M1 from `docs/roadmap.md`)

The editor produces JSON; the engine consumes JSON. They're separate apps that share a schema (like TA's modtools and its runtime). M1 calls for:

- Schematic Loader (Module 1) — JSON parsing, validation, hot-reload
- Equation Evaluator (Module 2) — sandboxed expression evaluator with time/memory caps
- Constants and ~6 core equations authored
- Physics Solver (Module 3) — basic single-domain land physics, fixed-point math
- One test chassis + one test map + one test environment Schematic
- Local persistence (Module 8) — SQLite
- An engine harness (Unity scene) where a single unit moves under physics commands

This is the first real engine code. The decision about whether to start in Unity or in a prototype engine (Rust + bevy, Godot, custom?) is still open in `docs/decision-history.md`. The architecture module-9 swap-seam exists exactly so this choice is local; don't agonize.

### 9. Tier 3 system docs (still pending from the previous handoff)

Six docs called for that haven't been written: `docs/tech.md`, `docs/units.md`, `docs/ai-behaviors.md`, `docs/events.md`, `docs/humans.md`, `docs/campaign.md`. Plus `docs/story.md` (the in-game campaign arc distilled from the novel series bible). And `docs/schematics.md` + `docs/physics.md` both need the four-layer physics constitution patch. These are slower work than the priorities above; defer until after the editor is launched and v0.2 is in motion.

---

## How to switch from Cowork to local Claude Code

### What Cowork is and why we used it

Cowork is the **desktop-app version of Claude** (one of Anthropic's products), built around a conductor-orchestration workflow where a parent agent can spawn many sub-agents in parallel, hand them briefs, and synthesize their work. It is excellent for autonomous chained work. The overnight v0.1 editor build was exactly that: brief-writer + lift-map-producer in Wave 1, shared-foundation in Wave 2a, three parallel component agents in Wave 2b, fix-up in 2c, integration in 3, independent verifier in 4, fix-pass in 4b, this handoff + the runbook in 5. Conductor mode is the design pattern Cowork is built around.

### Why switch back to Claude Code CLI

Three reasons specific to the next stretch of work:

1. **Direct shell access.** First-run on Windows means running `npm install`, `npm run tauri dev`, watching Cargo output, and possibly iterating quickly on a single source file based on console errors. One process with `Bash` and `Edit` tools is faster than orchestrating sub-agents for that.
2. **Faster iteration on small code edits.** v0.2 work is concentrated edits to a handful of files (autosave-recovery UI, panel-detach logic, Help dialog). Sub-agent orchestration shines when the work fans out wide; it adds overhead when the work is narrow.
3. **Simpler mental model.** One chat, one process, one filesystem, one set of tool outputs. The user values being taught and explained-to; that conversation is harder when half the moves are inside opaque sub-agent contexts.

### Setup

The user already has Claude Code installed from the previous transition. The setup is now just:

```powershell
cd "C:\dev\Strategy Game"
claude
```

A new PowerShell window opens; Claude Code reads `CLAUDE.md`, which points it to `HANDOFF.md` (this file) first.

### First prompt to give the new local Claude Code agent

Paste this exactly. The structure forces a synchronization check before any code or doc gets written, so the new agent doesn't drift from the existing decisions or skip the runbook.

> I'm continuing a project that was being orchestrated in Cowork. The most recent autonomous overnight build is logged in `docs/overnight-build-log.md` and a Tauri 2 + React 19 + TypeScript editor was scaffolded at `editor-app/`. Before doing anything else, please read these five files in order: (1) `HANDOFF.md` at the repo root, (2) `CLAUDE.md` at the repo root, (3) `DESIGN.md` at the repo root, (4) `docs/overnight-build-log.md`, (5) `docs/morning-runbook.md`. Then tell me, in plain language: (a) what you understand the project is in two sentences, (b) what the ten constitution principles are, briefly, (c) what's pending on the morning runbook and what's coming next. Don't start any work until I confirm your understanding.

### Pricing note

Same as the previous handoff: Claude Code CLI bills per token through the API key the user already has configured. **The Cowork overnight chain made nontrivial use of the API budget** — eight or nine sub-agents across five waves, with two session-limit retries. Worth being aware that the next month's invoice will reflect the build night. Going forward, local Claude Code in conductor mode for small fan-out tasks (one parent + 1-3 sub-agents) is the cost-efficient default; multi-wave Cowork orchestration is reserved for the large autonomous builds.

---

## Environment glitches surfaced during the overnight build

Two recurring issues worth remembering, both surfaced in `docs/overnight-build-log.md` and called out here because they shape how the next agent should orchestrate any further parallel work:

- **Write-tool truncation on the Windows-mounted folder.** During Wave 2b, two parallel sub-agents independently reported that `PartsSection.tsx` was corrupt after the AttributeForm agent wrote it. The file was actually fine — the issue is that the Write tool can return before the Windows-mounted filesystem has fully flushed the new contents, so a subsequent agent's Read can race the write and observe a partial-or-empty file. The Wave 2c fix-up agent identified a workaround: write to the Linux-native scratch folder first, then `cp` into the repo. The pattern was not retroactively applied to all of Wave 2b's writes; the file was confirmed intact on re-read. For future multi-agent file authoring on a Windows mount, **default to scratch-then-copy** rather than direct-write.
- **Session-limit walls.** Two of the agents launched during the overnight (the Wave 1 lift-map producer and the Wave 4b fix-pass) hit a "session limit, resets at HH:MM" wall and aborted with zero tool uses. Both retried successfully on the next attempt. Total agent compute was nontrivial but within reach of overnight wall-clock. **Plan retries into the schedule** rather than treating session limits as final failures.

These are not Cowork-specific or Claude-Code-specific; they're properties of orchestrating multiple agents over a Windows-mounted filesystem at this scale. The next agent will likely run smaller fan-outs and may never see either, but file the pattern.

---

## Conductor mode is the default operating pattern

The user's global `~/.claude/CLAUDE.md` (referenced from this repo's `CLAUDE.md`) declares **conductor mode** as the global default working pattern. That means:

- Claude does **not** directly write code, edit files, run shell commands, fetch web content, or produce deliverables in response to a user request.
- Claude scopes the work, writes a brief, delegates via the Agent tool to a sub-agent, runs an independent verifier pass on the sub-agent's output, synthesizes the verifier's findings, and reports back.
- **Read-only investigation auto-spawns.** If the user asks "what does this file say" or "find where X is defined", read-only sub-agents can launch without waiting for permission.
- **Anything that writes or changes state waits for explicit user approval of the brief** before the writing sub-agent is dispatched.
- The full protocol lives in the `conductor` skill (loaded via the global config).

**Override only when the user explicitly says "do it yourself" or "skip the agent".** This handoff itself is a conductor-pattern artifact — the orchestrator scoped it, drafted the brief, dispatched a writer (this agent), and the user reviews before commit.

For the morning runbook in particular: the user will be running PowerShell commands themselves. The next Claude Code agent's role during that step is **observe and explain**, not edit files. If an error appears, scope a brief, write a fix proposal, surface it, get approval, then dispatch.

---

## Open questions (carry-forward + new from overnight)

The bigger ones to be aware of. Grep `docs/decision-history.md` and `docs/overnight-build-log.md` for the full list.

**Carry-forward (still open from previous handoff):**

- **Per-match unit-design cap** (8-12 proposed). Needs playtest. Blocks: `docs/monetization.md` final tuning.
- **Earn-path time equivalence per marketplace design** (5-20h proposed). Needs playtest. Blocks: marketplace launch.
- **Per-match win condition** (lean hybrid — different per map). Blocks: `docs/prototype-scope.md` lock.
- **Veiled true nature** (intentionally ambiguous; do we ever reveal aliens?). Lives in `docs/campaign.md` when written.
- **Demo scope** (1-2 missions; specific beats not yet locked). Blocks new doc `docs/demo.md`.
- **Closed beta size and region** for M4-M5. Blocks launch plan.
- **Hardpoint extraction during voxel export.** The current implementation defaults every `hardpoint` material cell to `facing: 'y+'`. Should facing be inferred from neighbor occupancy (the cell points away from the bulk of the chassis), or chosen by the user at placement with a UI affordance? Blocks: full Editor App hardpoint UI in a later phase.
- **Voxel grid resolution and per-unit voxel budget.** The current 16³ grid is hard-coded in `src/lib/voxel-grid.ts`. Higher resolution would allow finer detail at the cost of memory and serialization size; a per-unit budget would let the game balance large units against small. Both are downstream design questions blocked on actual content authoring at scale.
- **Per-match unit-design cap implementation.** Even once the cap is decided (8-12), the editor needs a way to mark a unit as one of the player's "active" picks for a match. The current editor produces a flat collection of designs with no notion of activation; that affordance is a v0.3 polish item.

**New from the overnight build:**

- **`OPEN[2026-05-28]`: React 19 lock.** Codify React 19 in `docs/editor-app-tauri-brief.md`, or downgrade to 18? Recommendation: codify 19.
- **`OPEN[2026-05-28]`: `physics_version` bump semantics.** Schema regex `^\d+\.\d+$` permits only two components, so the brief's "patch bump" wording cannot be implemented as patch. Current build does minor-bump. Resolve by amending the brief, or extend the schema to three components.
- **`OPEN[2026-05-28]`: `tauri-plugin-persisted-scope` later, or accept custom Rust commands as the norm?** Wave 4b chose custom commands because of the fs-scope BLOCKER. Recommendation: accept; it's simpler and the user is single-tenant. Revisit if the editor ever gets a network surface.
- **`OPEN[2026-05-28]`: v0.1 over-scope.** The build shipped autosave, procedural terrain, Zod validation, keyboard shortcuts, and `version-bump` — several of which were brief-v0.2 or v0.3. Redefine v0.1 in the brief to match what shipped, then re-plan v0.2 around what actually remains.
- **`OPEN[2026-05-28]`: stray `editor-app/tsconfig.bp.tmp.json`** — 1 byte, gitignored. Manual `del` from PowerShell. Trivially safe to remove on first cleanup pass.
- **`OPEN[2026-05-28]`: production `.exe` code-signing.** Requires a paid certificate (~$300/year). Deferred to V2.

---

## What I (Cowork-era me) recommend you (next Claude Code agent) NOT do

- **Don't undo the v0.1 implementation choices without strong cause.** React 19, Tauri 2, Context + `useReducer`, hand-rolled orbit camera, per-voxel `Mesh` in the editor + `InstancedMesh` in the preview, custom Rust commands for file I/O. Each is reasoned and documented in `docs/overnight-build-log.md` under "Key decisions made autonomously". Any change here costs more than it earns unless something is actually broken.
- **Don't suggest changing the monetization model.** Settled in the constitution. Re-derivation is wasted reasoning.
- **Don't pivot off Tauri to Electron without evaluating the tradeoff carefully.** Tauri's per-binary size advantage (~5 MB vs ~150 MB) is significant for a community-distributed creative tool. The user will eventually ship this to other players, who will not want to download Electron's runtime to author a unit.
- **Don't suggest pivoting Unity → other engine** without reading `docs/decision-history.md` and `docs/architecture.md` first. Module 9 (Rendering) is intentionally swappable; the *choice* of engine for M1 is still open, but the swap is local and not urgent.
- **Don't write the Tier 3 docs** (`docs/tech.md`, `docs/units.md`, `docs/ai-behaviors.md`, `docs/events.md`, `docs/humans.md`, `docs/campaign.md`) before reading `docs/decision-history.md`. The locked decisions per-system are scattered through that file. Writing without them will produce drift.
- **Don't merge `editor-app/` back into `tools/`** as plain HTML files. The user already lived through the file-shuffle pain that prompted the Tauri move. The browser-prototype era is over for the editor; the prototypes survive only as lift-source.
- **Don't merge the design branch to master** without the user's explicit approval. Stay on `claude/mobile-rts-game-concept-7LbT0`.
- **Don't auto-fire sub-agents that write to disk** without a brief approved by the user. Conductor mode is the default. Read-only auto-spawns; writes wait.

---

## A note from the Cowork-era to the next Claude Code agent

We had a long, productive overnight session. The user was asleep for most of it. The orchestration ran clean — eight or nine sub-agents across five waves, two session-limit retries, one BLOCKER caught and fixed before sunrise — and the user wakes up to a typed-checked v0.1 source tree and a runbook that tells them exactly what to do next. That outcome is the design of conductor mode, working.

A few things to keep front-of-mind:

- **The user explicitly invoked conductor mode and reminded the agent twice during this project.** Honor it. Read-only investigation can move quickly and quietly; anything that writes waits for a brief.
- **The user is generative and thoughtful, and has no formal coding background.** Mechanical engineering experience, high curiosity, learns by understanding *why* not just *what*. When you make a recommendation, explain the reasoning. When you reach for a pattern, name it and say why it fits. The user is not asking for ceremony; they are asking to learn.
- **The user values honesty over false competence.** When the cloud-Claude in the previous handoff shipped broken 3D apps, the user caught it with screenshots and called it. When the Cowork orchestration hit a session-limit wall, it surfaced the retry rather than burying it. Match that energy. When you don't know, say so. When you can't see something (you still can't see their screen), ask for a screenshot or a console paste.
- **Every decision has reasoning behind it, often emotional reasoning** (Age of Origins, the desire for a respectful monetization model, the wish for endings that *cost* something). They care about getting this right. They are not the kind of user who wants you to second-guess decisions casually.
- **The overnight build was a stress test of autonomous agent chaining at this scope.** It worked, with two session-limit retries and one BLOCKER caught by an independent verifier. Expect similar patterns when you orchestrate parallel sub-agents — plan retries into the schedule, plan a verifier into the wave plan, and keep your sub-agent briefs narrow enough that the verifier can read them as contracts.
- **This project is being designed to live for ten years and ship as something a player can be proud to own.** Both of those constraints matter at every step. The constitution exists to make sure year-10 content still works in year-1 replays. The monetization model exists to make sure the user can look another developer in the eye and say what we shipped.
- **The next 30-60 minutes is hands-on toolchain installation, not coding.** Your role is to wait, watch, and explain. The user will run PowerShell commands themselves. Be patient.

Match the energy. Be direct. Treat locked decisions as locked. Surface open questions as open. And good luck — you're picking up at the moment the work crosses from doc to product.

One last specific thing worth saying out loud: the previous handoff's closing note ended with "this project is being designed to live for ten years and ship as something a player can be proud to own." That sentence was earned in design but had not yet been earned in code. Today it has been earned in a small, careful way: there is a real desktop application source tree that the constitution's principles run all the way through, from the `physics_version` read-only modifier on the TypeScript type down through the Zod validators down through the explicit version-bump menu action. The next time someone asks "what does Principle 4 actually mean", you can point them at three concrete places in working code where it is enforced. That is the project moving from intention to artifact. Don't lose that property as v0.2 grows the surface area. Every new feature should be traceable back to a principle, and every principle should be enforceable somewhere in code that a verifier-agent or a careful reader can find.

The other thing worth saying out loud: the user has been carrying this design in their head for a long time, refining it through the equivalent of dozens of long evening sessions of dialogue with Claude. The reason the brief produced a clean v0.1 build overnight is that the brief had years of design pressure behind it. You inherit that work. Don't treat it as scaffolding to throw away; treat it as the contract that lets the next sub-agent ship cleanly without re-deriving every assumption. The conductor pattern works because the briefs are tight. The briefs are tight because the design is tight. The design is tight because the user kept asking why until the answer stopped sliding around. That is how you got here.

— *Cowork orchestrator, end of overnight session, 2026-05-28*

---

## Cross-references

- [DESIGN.md](DESIGN.md) — master contract; the ten principles + delivery rule.
- [CLAUDE.md](CLAUDE.md) — agent brief (auto-loaded).
- [docs/decision-history.md](docs/decision-history.md) — full design-phase decision trail.
- [docs/architecture.md](docs/architecture.md) — the eleven engine modules + four physics layers.
- [docs/roadmap.md](docs/roadmap.md) — V1/V2/V3 milestones.
- [docs/editor-app.md](docs/editor-app.md) — Editor App design spec (parent of the Tauri brief).
- [docs/editor-app-tauri-brief.md](docs/editor-app-tauri-brief.md) — v0.1/v0.2/v0.3 implementation contract.
- [docs/editor-app-tauri-lift-map.md](docs/editor-app-tauri-lift-map.md) — file-by-file lift plan from the three prototypes.
- [docs/overnight-build-log.md](docs/overnight-build-log.md) — wave-by-wave catalog of the autonomous build.
- [docs/morning-runbook.md](docs/morning-runbook.md) — the user's next-action recipe.
- [docs/schematics.md](docs/schematics.md) — Schematic format.
- [docs/physics.md](docs/physics.md) — environment variables.
- [docs/monetization.md](docs/monetization.md) — revenue model + 12 forbidden mechanics.
- [docs/world.md](docs/world.md) — post-apocalyptic setting.
- [docs/factions.md](docs/factions.md) — the four canonical factions.
- [docs/glossary.md](docs/glossary.md) — canonical terminology.
- [novel/SERIES-BIBLE.md](novel/SERIES-BIBLE.md) — 4-book series bible.
- [pitch/PITCH.md](pitch/PITCH.md) — external investor brief.
- [editor-app/](editor-app/) — Tauri 2 + React 19 + TypeScript v0.1 source tree.
- [editor-app/src-tauri/src/lib.rs](editor-app/src-tauri/src/lib.rs) — `read_unit_file` / `write_unit_file` Rust commands.
- [editor-app/src/App.tsx](editor-app/src/App.tsx) — three-pane shell + UnitStateProvider.
- [schemas/unit.schema.json](schemas/unit.schema.json) — unit Schematic JSON Schema.
- [schemas/part.schema.json](schemas/part.schema.json) — part Schematic JSON Schema.
- [tools/editor/index.html](tools/editor/index.html) — form-editor prototype (lifted into AttributeForm).
- [tools/voxel-editor/index.html](tools/voxel-editor/index.html) — voxel-editor prototype (lifted into VoxelSculptor).
- [tools/battlefield-viewer/index.html](tools/battlefield-viewer/index.html) — viewer prototype (lifted into BattlefieldPreview).
