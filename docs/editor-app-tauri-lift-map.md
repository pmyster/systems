# Editor App — Tauri Lift Map

## TL;DR

- Three browser HTML prototypes already exist; the new Tauri + React + TS Editor App must absorb their best ideas without dragging in vanilla-JS DOM patterns.
- Lift the **Three.js scene/camera/lighting/raycaster/voxel-data scaffolding** from `tools/voxel-editor/index.html` into `VoxelSculptor` more or less verbatim, but reroute every `document.getElementById` mutation and global-let state through React state.
- Lift the **derived-stat formulas, JSON shape, and field defaults** from `tools/editor/index.html` into `AttributeForm` and a shared `src/lib/derived-stats.ts`. Throw away the form-DOM rendering — React rebuilds that from typed schema-driven controls.
- Lift the **terrain noise generator, camera pan/zoom/tilt rig, faction palette, instanced voxel mesh builder, and unit-movement tick** from `tools/battlefield-viewer/index.html` into `BattlefieldPreview`.
- Drop every prototype's standalone HTML chrome (header, file-input shim, Three.js CDN bootstrap, error overlay). Tauri ships its own window, native dialogs, and bundled `three` package.
- Shared library code: TypeScript types derived from `schemas/unit.schema.json` and `schemas/part.schema.json`, a `sparse_grid_v1` serializer, a derived-stat calculator, the materials catalog, and the faction palette.

## Scope

This document maps **lines of code in the three existing prototypes** to **slots in the three new React components**, so three implementer sub-agents can work in parallel. It is a planning document; no code lives here.

In scope:

- Per-prototype inventory of Three.js scene plumbing, data model, interaction handlers, render loop, and helpers.
- Explicit "do not lift" calls — usually because Tauri / React / shared-state replaces the original pattern.
- Consolidated mapping table the implementer agents will read directly.
- `src/lib/` shared-utility inventory.

Not in scope:

- Choosing the React state container (Zustand vs. Jotai vs. Redux). That belongs in the parent brief.
- Writing the TypeScript types themselves. Names and shapes are sketched; actual emission is a separate task.
- File-system / dialog wiring (Tauri `dialog` plugin). The lift map calls out *what* the old code did with files; the agent that wires Tauri APIs owns the *how*.
- The full Editor App vision (hardpoint snapping rules, voxel-budget enforcement). Those are still `OPEN` in `docs/editor-app.md`.

## Prerequisites

- `CLAUDE.md` — doc convention.
- `DESIGN.md` — Principle 2 (Derived-stat discipline) and Principle 4 (Invariance / `physics_version`) define what the AttributeForm must enforce and what the derived-stat calculator must respect.
- `docs/schematics.md` — the `sparse_grid_v1` voxel format, Schematic ID rules, and JSON Schema validation pipeline.
- `docs/editor-app.md` — the parent design doc for the editor; "What the prototype does NOT do (yet)" lists exactly the gaps the Tauri rewrite is meant to close.
- `schemas/unit.schema.json` and `schemas/part.schema.json` — the JSON Schemas the new `AttributeForm` outputs against and `src/lib/types.ts` is derived from.

---

## Prototype 1 — `tools/editor/index.html` (form-based attribute editor)

**Target component:** `AttributeForm` (center pane).

**File length:** 817 lines. Single self-contained HTML file with embedded `<style>` and one `<script>` block (lines 301-813).

### 1. Three.js scene setup

None. This prototype is form + JSON-preview only — no canvas, no Three.js. Skip.

### 2. Geometry / data model

This is the heart of what to lift. The Unit Schematic JS object is constructed in `buildSchematic()`.

- **Lines 305-308** — `state` object: `parts[]`, `tags[]`. Replace with React state (one `unit` object plus derived selectors). Keep the shape; throw away the global `const`.
- **Lines 314-356** — `addPart(category)` — per-category default fields. **Lift the per-category default tables verbatim** into `src/lib/part-defaults.ts`. These tables (lines 324-352) are the only place in the codebase that knows the sensible starting values for a new weapon / sensor / defense / utility / mobility-aux / communications part. Worth preserving exactly.
- **Lines 467-507** — `buildSchematic()` — the canonical mapping from form fields to the Unit JSON. The field list (and ordering) **is** the contract with `schemas/unit.schema.json`. Lift the field list into TypeScript types and a `toSchematic(unit: UnitState): UnitSchematic` function in `src/lib/serialize.ts`. Note that `physics_version: '1.0'` is hard-coded on line 474 — leave it hard-coded but route it through a shared constant so the Invariance principle stays grep-able.
- **Lines 716-727** — `newUnit()` defaults — the canonical "blank unit" payload. Lift into `src/lib/defaults.ts` as `BLANK_UNIT`.

### 3. Interaction handlers

All raw-DOM. Every one of these needs to be **rewritten** as React event handlers wired into controlled inputs. The *logic* of each handler is trivial; the *binding* is what changes.

- **Lines 314-356** `addPart` — becomes `dispatch({ type: 'addPart', category })`.
- **Lines 358-362** `removePart` — becomes `dispatch({ type: 'removePart', idx })`.
- **Lines 364-368** `updatePart(idx, field, value, isNumber)` — becomes a controlled input's `onChange` that dispatches a typed update.
- **Lines 441-462** `addTag` / `removeTag` / `renderTags` — becomes a `<TagInput value={tags} onChange={...} options={COMPATIBILITY_TAGS} />` component.
- **Lines 751-806** `loadFile` / `loadUnit` — the FileReader plumbing is **dropped**. Replace with the Tauri `@tauri-apps/plugin-dialog` `open()` + `fs.readTextFile()` pattern. `loadUnit` itself (lines 767-806) is the JSON-into-state mapping and **does** lift, refactored to return a `UnitState` rather than poke `document.getElementById`.
- **Line 145** `<input type="file" id="file-input">` and lines 143-148 `<button onclick="...">` — drop entirely; Tauri menu bar / dialog plugin replaces them.

### 4. Render loop

There is no per-frame loop; `render()` (lines 698-706) re-renders the JSON preview and derived stats whenever an input changes. React's render cycle replaces this entirely. Drop the function.

### 5. Utility helpers worth lifting

- **Lines 513-615** `deriveStats(u)` — **the prize of this file**. Simplified versions of the engine's equations for speed, power balance, fuel range, battery endurance, solar charge, armor, shields, mass, and per-weapon muzzle velocity / range / impact / cooldown. Lift verbatim into `src/lib/derived-stats.ts` as a pure function `deriveStats(unit: UnitState): DerivedStats`. **Constitution check:** per Principle 2, these are illustrative — they must never write back into the Schematic. Make `DerivedStats` a separate type from `UnitState` and never persist it.
- **Lines 689-693** `formatDuration(s)` — tiny helper, lift verbatim into `src/lib/format.ts`.
- **Lines 617-687** `renderDerived(stats, u)` — the *layout* of the derived-stat readout. Don't lift the DOM-string concatenation; lift the *grouping* (Mobility, Energy, Defense, Weapons) into the structure of a `<DerivedStatsPanel>` React component.
- **Lines 156-275** — the form HTML itself: enum lists for `chassis_class` (lines 184-194), `energy_source` (lines 202-208), `armor_material` (lines 218-222), `compatibility_tags` (lines 230-244), faction (lines 162-173), part categories (lines 254-260). **Lift the enum value lists**, ideally generated from `schemas/unit.schema.json` at build time, into `src/lib/enums.ts`. Drop the markup.

### 6. What NOT to lift

- The entire `<style>` block (lines 7-136). The new app gets its theme from a shared design-system module.
- The `<header>` chrome (lines 140-149) — Tauri window + menu.
- The custom `<input type="file">` hidden-input + `<button onclick="document.getElementById('file-input').click()">` pattern (lines 144-145) — Tauri native dialogs.
- The `download` blob-URL trick in `saveJSON` (lines 737-749) — Tauri `dialog.save()` + `fs.writeTextFile()`.
- The triple-pane CSS grid (lines 50-66) — the new app's three-pane layout is owned by the parent `EditorApp` component, not by the form pane.
- Every `oninput="render()"` and `onchange="render()"` inline handler — React controlled inputs replace the pattern.
- The `partCounter` module-global (line 313). Use a UUID generator or array index.

### 7. What needs significant rewriting

- All `document.getElementById(...).value` reads (lines 467-468 plus ~60 call sites in `buildSchematic` and `loadUnit`) — every one becomes a React state read.
- `renderPartsList()` (lines 370-377) and `renderPartForm(p, idx)` (lines 379-436) — the string-templated form-section generator. React replaces this with a `<PartForm part={part} onChange={...} />` component, one per part, dispatched by `part.category`.
- `renderTags()` (lines 451-462) and the inline `<select onchange="addTag(this.value); this.value=''; render()">` (lines 230-244) — becomes a typed `<TagInput>`.
- The `<pre class="json" id="json-output">` live JSON preview (line 285, populated line 701) — keep the *concept* of a live preview pane but render via a syntax-highlighting React component (e.g. `react-json-view` or a simple `<pre>` of `JSON.stringify(unit, null, 2)`).

---

## Prototype 2 — `tools/voxel-editor/index.html` (3D voxel sculptor)

**Target component:** `VoxelSculptor` (left pane).

**File length:** 731 lines. Single self-contained HTML; `<script>` block at lines 188-728.

### 1. Three.js scene setup

The cleanest lift in the codebase. Almost everything here is portable.

- **Lines 222-232** — scene, camera (`PerspectiveCamera(50, 1, 0.1, 1000)`), renderer (`WebGLRenderer({ antialias: true })`, `PCFSoftShadowMap`). Lift verbatim into the `VoxelSculptor` mount effect (`useEffect(() => { ... }, [])`).
- **Lines 234-247** — custom orbit camera (`camTarget`, `camAzimuth`, `camElevation`, `camDistance`, `updateCameraOrbit()`). Lift verbatim. **OPEN[2026-05-27]: Should the Tauri build adopt Three.js `OrbitControls` from the `three/examples` import path now that we have a bundler, or keep the hand-rolled orbit?** The hand-rolled version is ~12 lines and has no dependency footprint — lean on keeping it.
- **Lines 250-268** — three-light rig (ambient + sun w/ shadow camera bounds + rim). Lift verbatim.
- **Lines 270-299** — ground plane, grid helper, build-region wireframe, mirror plane indicator. All lift verbatim. The constants `GRID_SIZE = 16` and `CELL_SIZE_M = 0.5` (lines 207-209) should live in `src/lib/voxel-constants.ts` because they're also referenced by the Battlefield Preview's voxel renderer.
- **Lines 301-309** — cursor preview mesh + edges. Lift verbatim.

### 2. Geometry / data model

- **Line 198-206** — the `MATERIALS` catalog (six materials: armor, hull, accent, glass, engine, hardpoint, each with id/name/color/density/team/desc). **Lift verbatim** into `src/lib/materials.ts`. This is *also* used by the Battlefield Preview's color-class resolution — see Prototype 3, lines 334-338.
- **Line 207-209** — `CELL_SIZE_M`, `CELL_VOLUME_M3`, `GRID_SIZE` constants. Lift into `src/lib/voxel-constants.ts`.
- **Lines 213-217** — voxel storage: a `Map<string, { material: string }>` keyed by `"x,y,z"`, plus a parallel `Map<string, Mesh>`. Lift the data structure; consider replacing the string-keyed Map with `Map<number, MaterialId>` keyed by `(z*16+y)*16+x` for performance. **OPEN[2026-05-27]: do we keep the dual-Map (state + mesh) split, or move to instanced rendering as in Battlefield Preview?** Lean instanced — it scales better and matches the export format.
- **Lines 314-315** — `key(x,y,z)` and `inBounds(x,y,z)` helpers. Lift into `src/lib/voxel-grid.ts`.
- **Lines 317-345** — `addVoxel` (with `mirrorX` recursion). Lift logic; rewrite to dispatch a React-state update plus a side-effect that mutates the Three.js scene. The mirror-X branch (lines 340-343) is exactly the kind of game logic worth preserving as a unit-testable helper.
- **Lines 347-363** — `removeVoxel`. Same treatment.
- **Lines 365-374** — `clearAll`. Same treatment.
- **Lines 607-652** — `exportJSON()` — produces the `sparse_grid_v1` payload (format header, grid_size, cell_size, bounding box, derived mass, voxel count, voxels array `[x,y,z,materialId]`, materials catalog with `color_class`/`color_hex`/`density_kg_m3`, hardpoints array). **This is the canonical serializer for the format defined in `docs/schematics.md`.** Lift into `src/lib/voxel-serialize.ts` as `serializeVoxelGrid(grid: VoxelGrid): SparseGridV1`. Hardpoint extraction (lines 631-635) is naive — every `hardpoint` material cell becomes a hardpoint with `facing: 'y+'`. **OPEN[2026-05-27]: hardpoint facing — is it always `y+`, or do we infer it from neighbor occupancy?** Resolve before V1.
- **Lines 654-666** — `loadJSON(data)`. Lift as the inverse of `serializeVoxelGrid`.

### 3. Interaction handlers

- **Lines 401-415** — `getIntersect(event)` raycaster against voxel meshes + ground. Lift into a `useRaycast` hook or a plain helper. Note the dependency on `renderer.domElement.getBoundingClientRect()` — in React the bounding rect comes from a ref.
- **Lines 417-435** — `handleClick(event, action)` — add vs. remove logic that uses the face normal of the hit voxel to determine where to place the new one (line 422-424). **Lift verbatim** — this is the magic that makes voxel placement feel natural.
- **Lines 437-462** — `updateCursor(event)` — preview cursor placement. Lift verbatim.
- **Lines 467-521** — combined pointer-down / pointer-move / pointer-up / wheel handlers that distinguish click from drag (lines 484-486) and route left-drag to orbit, middle-drag to pan, click to add/remove. **Lift verbatim** as the contract between the canvas DOM events and the orbit/voxel logic. In React, wire these via `useEffect` that attaches/detaches listeners on the renderer's canvas ref.
- **Lines 590-602** — keyboard handlers: digit keys 1-9 select material; `M` toggles mirror; `G` toggles grid. Lift the key map verbatim. Wire via `useEffect(window addEventListener 'keydown')` guarded by an input-focus check (line 591 already does this).

### 4. Render loop

- **Lines 539-543** — `animate()` is a vanilla `requestAnimationFrame(animate); renderer.render(scene, camera)` loop. **Lift verbatim** into a `useEffect` that starts/stops the RAF. Cancel on unmount.

### 5. Utility helpers worth lifting

- **Lines 376-396** — `updateStats()` computes voxel count, total mass (sum of `density × cell_volume`), and bounding box. Lift into `src/lib/voxel-stats.ts` as `computeVoxelStats(grid: VoxelGrid): VoxelStats`. The Battlefield Preview's `computeMass` (lines 547-555 of prototype 3) is a near-duplicate — collapse them into one shared helper.
- **Lines 547-571** — `renderPalette()` + `selectMaterial(id)`. Don't lift the DOM-build; lift the *behavior* — a palette grid that highlights the active material and updates the cursor color. React component.
- **Lines 526-533** — `onResize()` handler. Lift verbatim; wire via `ResizeObserver` on the canvas-container ref.

### 6. What NOT to lift

- The entire `<style>` block (lines 7-109).
- The `<header>` (lines 113-122) and toolbar buttons — Tauri menu / shared toolbar.
- The Three.js CDN `<script>` tag (lines 184-186) and the `if (typeof THREE === 'undefined')` guard (lines 189-193) — npm `three` is a hard dependency in the Tauri bundle.
- The `#error-overlay` (lines 171-182) — same reason.
- The hidden `<input type="file" id="file-input">` + `<button id="btn-load">` shim (lines 119-120, 682-693) — Tauri dialogs.
- The `<download>` blob trick (lines 668-680) — Tauri `fs.writeTextFile`.
- `seedStarterUnit()` (lines 698-725) — useful as test fixture, but the new app loads real `units/starter/*.json` files via Tauri. Move the seed array into `tools/voxel-editor/fixtures.ts` if it's still useful for storybook / tests.
- The `console.log('Voxel editor loaded successfully. THREE.js version: ...')` (line 727).

### 7. What needs significant rewriting

- Every `document.getElementById(...)` access in the stats / palette / cursor-position readout (~12 call sites across the script). Each becomes a React state binding plus a `useEffect` that pokes the Three.js scene.
- The mutable module-globals `voxels`, `voxelMeshes`, `selectedMaterial`, `mirrorX` (lines 214-217). The voxel data lives in React state (the source of truth); the meshes live in a Three.js scene managed by `useEffect`. They must be kept in sync — the rule is: dispatch updates voxel state, the effect reconciles the scene.
- The dual `voxels` Map + `voxelMeshes` Map sync (lines 313-363) — this is exactly the kind of double-bookkeeping React hates. **Recommend:** state is `Map<string, MaterialId>`; the effect rebuilds an `InstancedMesh` (or one per material) from that map. Adopt the Battlefield Preview's instanced approach.

---

## Prototype 3 — `tools/battlefield-viewer/index.html` (TA-style top-down 3D viewer)

**Target component:** `BattlefieldPreview` (right pane).

**File length:** 862 lines. Single self-contained HTML; `<script>` block at lines 162-859.

### 1. Three.js scene setup

- **Lines 218-230** — scene with fog (`Fog(0x1a1d28, 80, 220)`), `PerspectiveCamera(35, 1, 0.5, 600)`, `WebGLRenderer({ antialias: true })`, shadow map, optional `ACESFilmicToneMapping`. Lift verbatim. The narrow FOV (35°) is intentional — gives the strategic top-down look.
- **Lines 232-251** — hemi + sun (1.4 intensity, large shadow camera bounds) + fill lighting. Lift verbatim.
- **Lines 168-175** — top-of-file constants: `MAP_SIZE = 128`, `CELL_SIZE_M = 0.5`, `VOXEL_SCALE`, `TERRAIN_AMP`, `CAM_PITCH_MIN/MAX/DEFAULT`, `ZOOM_MIN/MAX/DEFAULT`. Lift into `src/lib/battlefield-constants.ts`.
- **Lines 302-318** — camera rig: `camTarget`, `camPitch`, `camZoom`, fixed `camAzimuth = -Math.PI / 4`, and `updateCamera()` that resolves the camera position from pitch + zoom + azimuth around the target. **Lift verbatim** — this is the TA-style camera and it's good.

### 2. Geometry / data model

- **Lines 177-188** — `FACTION_PALETTES` map (primary/secondary/accent hex per faction). **Lift verbatim** into `src/lib/faction-palettes.ts`. Also referenced by the Voxel Sculptor whenever the preview wants to show what a finished unit looks like in faction colors.
- **Lines 254-290** — terrain mesh construction with per-vertex colors from a four-octave fbm noise function. Lift verbatim into a `buildTerrainMesh()` helper. The mesh is generated once at mount.
- **Lines 292-300** — `getTerrainHeight(wx, wz)` query function that matches the mesh-generation formula (lines 264-267). Lift verbatim; consider extracting `noiseHeight(x, z)` so both the mesh build and the runtime query call the same code.
- **Lines 320-321** — `units[]` array and `selectedUnits` Set. In React these become `unitsRef.current` (the live Three.js group list) plus a `selectedIds: Set<string>` in React state.
- **Lines 323-397** — `createVoxelMesh(voxelData, faction, unitMeta)` — **the most important lift in this prototype.** It:
  - Resolves `color_class: 'team-primary' | 'team-secondary' | 'team-accent'` against the faction palette (lines 334-338),
  - Falls back to `color_hex` for fixed materials (line 337),
  - Buckets voxels by color+matId (lines 339-342),
  - Emits one `InstancedMesh` per bucket (lines 345-369),
  - Re-centers the group on its bounding box (lines 372-389).

  **Lift verbatim** into `src/lib/voxel-renderer.ts` as `buildUnitMesh(voxelData: SparseGridV1, faction: FactionId, opts?: { meta?: UnitMeta }): THREE.Group`. The Voxel Sculptor should call this same function when it wants to render a preview in faction colors instead of raw material colors.
- **Lines 399-408** — `createSelectionRing()` — a ring mesh added under selected units. Lift verbatim.
- **Lines 410-419** — `placeUnit(unitGroup, x, z)` — drops the group on terrain at the queried height, attaches a ring. Lift; in React, mount-time effect pushes units into the scene.
- **Lines 437** — `range(a, b)` helper. Lift into `src/lib/util.ts`.
- **Lines 439-545** — `STARTER_RECLAIMER`, `STARTER_BULWARK`, `STARTER_SIGNAL`, `STARTER_CINDER` — hard-coded `sparse_grid_v1` fixtures for four faction starter units. **Drop** as part of the runtime; the new app loads `units/starter/*.json` from disk. Keep them as test fixtures in `src/lib/fixtures/starter-units.ts` so the preview pane has something to show on first launch when no unit is loaded.
- **Lines 547-555** — `computeMass(voxelData)`. **Duplicate of** Voxel Editor's mass calc (prototype 2 lines 378-383). Consolidate in `src/lib/voxel-stats.ts`.

### 3. Interaction handlers

The Battlefield Viewer's interaction model (pan / zoom / pitch / click-select / drag-select / right-click deselect / shift-add) is much richer than the Voxel Editor's. Some of this is *not needed* in the embedded preview pane — the user mostly just wants to orbit, zoom, and see the active unit on terrain. Be selective.

- **Lines 581-586** — `screenToNDC(clientX, clientY)`. Lift verbatim into `src/lib/raycast-helpers.ts`.
- **Lines 588-602** — `pickUnit(clientX, clientY)` — raycaster into instanced unit meshes, walks parent chain to find the unit group. Lift verbatim.
- **Lines 604-609** — `pickTerrain(clientX, clientY)`. Lift verbatim.
- **Lines 611-624** — pointer-down: middle = pan, left = candidate select-or-move, right = deselect. **Lift the camera logic; drop the unit-select logic** for the embedded preview (the preview shows the unit being edited, not a battlefield with many units to command). If we later add a "battlefield context" mode (multiple test units placed for visualization) we can re-add it.
- **Lines 626-649** — pointer-move: pan vs. selection-box drag. **Lift the pan branch; drop the selection-box branch.**
- **Lines 651-707** — pointer-up: resolves selection-box OR click-pick OR terrain-click-to-move. **Drop most of this for the preview.** If we keep one feature, it's "click terrain to test-walk the unit there" — wired against the movement tick (lines 823-842) — but flag this as optional.
- **Lines 709-713** — wheel zoom. Lift verbatim.
- **Lines 569-574** — keydown handler for WASD pan and Q/E pitch and `I` for inspect. Lift the WASD+QE camera bindings; **drop** the `I` inspector (the AttributeForm IS the inspector).
- **Lines 805-822** — per-frame WASD pan + QE pitch driver inside `tick()`. Lift verbatim into the render-loop hook.

### 4. Render loop

- **Lines 805-856** — `tick()` is one combined loop: dt computation, WASD+QE camera step, unit movement step (lines 823-842), FPS counter, render. **Lift the structure verbatim**, but split into composable pieces in React: a single `useEffect` starts the RAF; the per-frame work pulls from refs (`unitsRef`, `keysRef`, `camRef`). The movement step (lines 823-842) is only relevant if the "click-terrain-to-walk" feature survives — see above.
- **Lines 802-803** + **844-850** — FPS counter (sample over 500ms). Lift into `src/lib/fps-meter.ts` or a tiny `useFps()` hook.

### 5. Utility helpers worth lifting

- **Lines 190-216** — `hash2(x, y)`, `smoothNoise(x, y)`, `fbm(x, y)` — the deterministic noise stack used for terrain. **Lift verbatim** into `src/lib/noise.ts`. It is the *only* place these are defined in the codebase and the formulas are tuned. Worth keeping byte-identical so terrain is reproducible across the codebase if anyone else needs procedural noise.
- **Lines 547-555** `computeMass`. See above — consolidate.
- **Lines 421-435** `setSelection(newSelection)`. Only worth lifting if the embedded preview keeps a selection notion. Likely drop.
- **Lines 757-776** — shadow-toggle and wireframe-toggle buttons. **Lift the behavior** (good debug knobs) into the preview pane's settings panel.

### 6. What NOT to lift

- The entire HUD (`.hud-title`, `.hud-stats`, `.hud-help`, `.hud-actions`, `.selection-box`, `.unit-info`) — lines 99-144. Replace with React HUD components, and most of it isn't needed in the embedded preview anyway.
- The Three.js CDN `<script>` + error overlay (lines 146-160).
- The hidden file input + Load Voxel JSON button (lines 128-130, 732-755) — Tauri dialogs replace this; in the preview the unit being shown is driven by shared state, not file load.
- The Spawn Unit button (line 127) and the `STARTERS` rotation (lines 715-730) — preview shows the unit you're editing, not random spawns. Move the rotation into test fixtures only.
- The `showInspector()` function (lines 778-790) — the AttributeForm IS the inspector.
- The `console.log('Battlefield viewer loaded. THREE.js version: ...')` (line 858).

### 7. What needs significant rewriting

- `units[]` global array → `unitsRef.current` (a `useRef<Group[]>([])`) plus a derived selector for which one is the active edit subject.
- `selectedUnits` Set + the `setSelection`/ring-visibility coupling — likely drop entirely. If we keep multi-unit display, surface "active unit" as a single React-state ID and let an effect toggle the ring.
- Click-to-move (lines 686-698) — in the preview this is at best a debug feature. Either drop or gate behind a settings toggle.
- The four hard-coded `STARTER_*` constants (lines 439-545) — move into `src/lib/fixtures/` and load them like any other JSON file.
- The browser-window-bound `onResize()` (lines 792-800) — must become a `ResizeObserver` on the container ref so the preview resizes with its pane, not the window.
- File-load logic (lines 732-755) that infers faction from filename — drop. Faction comes from the unit Schematic's `faction` field, which `AttributeForm` owns.

---

## Consolidated mapping table

Format: **Source (file + line range)** | **Lifts into (component + file path inside `src/`)** | **Treatment**.

| Source | Lifts into | Treatment |
|---|---|---|
| `tools/editor/index.html` 305-308 (state shape) | `AttributeForm` (`src/components/AttributeForm/state.ts`) | refactor to React state |
| `tools/editor/index.html` 314-356 (addPart defaults) | shared (`src/lib/part-defaults.ts`) | verbatim (logic), drop DOM tie-ins |
| `tools/editor/index.html` 358-368 (remove/update part) | `AttributeForm` (`src/components/AttributeForm/AttributeForm.tsx`) | refactor to React event handlers |
| `tools/editor/index.html` 379-436 (renderPartForm) | `AttributeForm` (`src/components/AttributeForm/PartForm.tsx`) | rewrite from scratch as typed React component, keep field list |
| `tools/editor/index.html` 441-462 (tags) | `AttributeForm` (`src/components/AttributeForm/TagInput.tsx`) | rewrite as React component |
| `tools/editor/index.html` 467-507 (buildSchematic) | shared (`src/lib/serialize.ts`) | refactor: pure function `unitStateToSchematic(state): UnitSchematic` |
| `tools/editor/index.html` 513-615 (deriveStats) | shared (`src/lib/derived-stats.ts`) | verbatim (logic), add TS types |
| `tools/editor/index.html` 617-687 (renderDerived) | `AttributeForm` (`src/components/AttributeForm/DerivedStatsPanel.tsx`) | rewrite as React; keep grouping |
| `tools/editor/index.html` 689-693 (formatDuration) | shared (`src/lib/format.ts`) | verbatim |
| `tools/editor/index.html` 716-727 (newUnit defaults) | shared (`src/lib/defaults.ts`) | verbatim as `BLANK_UNIT` |
| `tools/editor/index.html` 737-806 (save/load) | drop / replace with Tauri dialog plugin | drop file plumbing; lift `loadUnit` body (767-806) as pure mapper |
| `tools/editor/index.html` 162-260 (enum lists in markup) | shared (`src/lib/enums.ts`) | extract values (ideally generated from `schemas/unit.schema.json`); drop markup |
| `tools/voxel-editor/index.html` 198-205 (MATERIALS) | shared (`src/lib/materials.ts`) | verbatim |
| `tools/voxel-editor/index.html` 207-209 (constants) | shared (`src/lib/voxel-constants.ts`) | verbatim |
| `tools/voxel-editor/index.html` 222-247 (scene + orbit cam) | `VoxelSculptor` (`src/components/VoxelSculptor/scene.ts`) | verbatim into mount effect |
| `tools/voxel-editor/index.html` 250-268 (lighting) | `VoxelSculptor` (`src/components/VoxelSculptor/scene.ts`) | verbatim |
| `tools/voxel-editor/index.html` 270-309 (ground, grid, region, mirror, cursor) | `VoxelSculptor` (`src/components/VoxelSculptor/scene.ts`) | verbatim |
| `tools/voxel-editor/index.html` 313-373 (addVoxel/removeVoxel/clearAll) | `VoxelSculptor` (`src/components/VoxelSculptor/voxel-ops.ts`) | refactor: pure-ish reducers acting on `Map<string, MaterialId>` |
| `tools/voxel-editor/index.html` 376-396 (updateStats) | shared (`src/lib/voxel-stats.ts`) | verbatim (logic) — collapse with prototype 3's `computeMass` |
| `tools/voxel-editor/index.html` 401-462 (raycast / cursor) | `VoxelSculptor` (`src/components/VoxelSculptor/picking.ts`) | verbatim |
| `tools/voxel-editor/index.html` 467-521 (pointer + wheel) | `VoxelSculptor` (`src/components/VoxelSculptor/input.ts`) | verbatim, wire via useEffect |
| `tools/voxel-editor/index.html` 526-543 (resize + animate) | `VoxelSculptor` (`src/components/VoxelSculptor/loop.ts`) | verbatim; wrap in hooks |
| `tools/voxel-editor/index.html` 590-602 (keydown) | `VoxelSculptor` (`src/components/VoxelSculptor/keys.ts`) | verbatim, wire via useEffect |
| `tools/voxel-editor/index.html` 607-666 (export/load JSON) | shared (`src/lib/voxel-serialize.ts`) | verbatim as `serializeVoxelGrid` / `parseVoxelGrid` |
| `tools/voxel-editor/index.html` 698-725 (seedStarterUnit) | test fixtures (`src/lib/fixtures/voxel-fixtures.ts`) | optional; lift only if useful for tests |
| `tools/voxel-editor/index.html` 547-571 (palette UI) | `VoxelSculptor` (`src/components/VoxelSculptor/Palette.tsx`) | rewrite as React |
| `tools/battlefield-viewer/index.html` 168-188 (constants + palettes) | shared (`src/lib/battlefield-constants.ts`, `src/lib/faction-palettes.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 190-216 (noise) | shared (`src/lib/noise.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 218-251 (scene + lighting) | `BattlefieldPreview` (`src/components/BattlefieldPreview/scene.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 254-300 (terrain mesh + height query) | `BattlefieldPreview` (`src/components/BattlefieldPreview/terrain.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 302-318 (TA camera rig) | `BattlefieldPreview` (`src/components/BattlefieldPreview/camera.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 323-419 (createVoxelMesh, ring, placeUnit) | shared (`src/lib/voxel-renderer.ts`) | verbatim — also used by VoxelSculptor for faction-colored preview |
| `tools/battlefield-viewer/index.html` 437 (range helper) | shared (`src/lib/util.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 439-545 (STARTER_* fixtures) | test fixtures (`src/lib/fixtures/starter-units.ts`) | move to fixtures only; runtime loads JSON from disk |
| `tools/battlefield-viewer/index.html` 547-555 (computeMass) | shared (`src/lib/voxel-stats.ts`) | merge with voxel-editor counterpart |
| `tools/battlefield-viewer/index.html` 569-574, 805-822 (WASD/QE camera) | `BattlefieldPreview` (`src/components/BattlefieldPreview/input.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 581-609 (NDC + raycast helpers) | shared (`src/lib/raycast-helpers.ts`) | verbatim |
| `tools/battlefield-viewer/index.html` 611-713 (pointer interactions) | `BattlefieldPreview` (`src/components/BattlefieldPreview/input.ts`) | lift pan + zoom only; drop selection / box-select / spawn-unit |
| `tools/battlefield-viewer/index.html` 757-776 (shadow/wireframe toggles) | `BattlefieldPreview` (`src/components/BattlefieldPreview/Settings.tsx`) | rewrite as React toggles |
| `tools/battlefield-viewer/index.html` 802-856 (tick + FPS) | `BattlefieldPreview` (`src/components/BattlefieldPreview/loop.ts`) | verbatim; movement step optional |
| All three: CDN `<script>`, error overlay, `<style>`, `<header>`, file input/blob-save plumbing | — | drop |

---

## Shared utilities (`src/lib/`)

Everything below is used by two or more of the three components and belongs in shared library code, not inside any one component folder.

### Types

- **`src/lib/types.ts`** — TypeScript types for `UnitSchematic`, `PartSchematic`, `ChassisData`, `Costs`, `Evolution`, plus the `UnitState` editor-side shape (the form's working copy before serialization). Recommend deriving from `schemas/unit.schema.json` and `schemas/part.schema.json` using `json-schema-to-typescript` at build time so they never drift.
- **`src/lib/voxel-types.ts`** — `MaterialId`, `VoxelCell`, `VoxelGrid`, `SparseGridV1`, `Hardpoint`. These match the format from `tools/voxel-editor/index.html` lines 607-652.

### Constants

- **`src/lib/voxel-constants.ts`** — `CELL_SIZE_M = 0.5`, `CELL_VOLUME_M3`, `GRID_SIZE = 16`. (From prototype 2 lines 207-209.)
- **`src/lib/battlefield-constants.ts`** — `MAP_SIZE = 128`, `TERRAIN_AMP`, `CAM_PITCH_*`, `ZOOM_*`. (From prototype 3 lines 168-175.)
- **`src/lib/materials.ts`** — `MATERIALS` array of six (armor, hull, accent, glass, engine, hardpoint). (From prototype 2 lines 198-205.)
- **`src/lib/faction-palettes.ts`** — `FACTION_PALETTES` map for all ten factions. (From prototype 3 lines 177-188.)
- **`src/lib/enums.ts`** — enum value lists for chassis classes, energy sources, armor materials, compatibility tags, weapon types, sensor modalities, utility functions, comms types, part categories. Should be generated from JSON Schema at build time; the prototype's hard-coded lists (prototype 1 lines 162-260, prototype 1 lines 383-421) are the reference.
- **`src/lib/defaults.ts`** — `BLANK_UNIT`, `BLANK_PART_BY_CATEGORY`. (From prototype 1 lines 314-356 and 716-727.)
- **`src/lib/part-defaults.ts`** — per-category default field sets so `addPart('weapon')` yields a sensible starter. (From prototype 1 lines 324-352.)

### Pure functions

- **`src/lib/derived-stats.ts`** — `deriveStats(unit: UnitState): DerivedStats`. (From prototype 1 lines 513-615.) **Per DESIGN.md Principle 2, this must never write back into the Schematic — it is illustrative only.**
- **`src/lib/voxel-stats.ts`** — `computeVoxelStats(grid: VoxelGrid): { voxelCount, massKg, boundingBox }`. (Consolidates prototype 2 lines 376-396 and prototype 3 lines 547-555.)
- **`src/lib/voxel-serialize.ts`** — `serializeVoxelGrid(grid) → SparseGridV1` and `parseVoxelGrid(SparseGridV1) → grid`. (From prototype 2 lines 607-666.) Output must match `docs/schematics.md` `sparse_grid_v1`.
- **`src/lib/serialize.ts`** — `unitStateToSchematic(state) → UnitSchematic` and inverse. (From prototype 1 lines 467-507 and 767-806.) Output must validate against `schemas/unit.schema.json`.
- **`src/lib/noise.ts`** — `hash2`, `smoothNoise`, `fbm`. (From prototype 3 lines 190-216.)
- **`src/lib/voxel-grid.ts`** — `key(x,y,z)`, `parseKey(k)`, `inBounds(x,y,z, gridSize)`, `mirrorX(x, gridSize)`. (From prototype 2 lines 314-315 and 340-343.)
- **`src/lib/voxel-renderer.ts`** — `buildUnitMesh(voxelData, faction, opts?): THREE.Group` that resolves material color classes against the faction palette, buckets by material, builds one `InstancedMesh` per bucket, re-centers. (From prototype 3 lines 323-397.) Used by both `VoxelSculptor` (faction-colored preview mode) and `BattlefieldPreview` (everything).
- **`src/lib/raycast-helpers.ts`** — `screenToNDC(canvas, clientX, clientY)`, voxel-vs-ground raycast helpers shared between sculptor and preview. (From prototype 2 lines 401-415 and prototype 3 lines 581-609.)
- **`src/lib/format.ts`** — `formatDuration(seconds)` and friends. (From prototype 1 lines 689-693.)
- **`src/lib/util.ts`** — `range(a, b)` and any other one-liners. (From prototype 3 line 437.)

### Fixtures (tests only, not runtime)

- **`src/lib/fixtures/starter-units.ts`** — the four `STARTER_*` sparse-grid blobs from prototype 3 lines 439-545.
- **`src/lib/fixtures/voxel-fixtures.ts`** — the `seedStarterUnit` tank from prototype 2 lines 698-725.

---

## Suggested file structure (`editor-app/src/`)

The brief is silent on whether types and hooks live under `lib/` or as siblings. This layout extracts them — implementer agents should follow it unless the parent brief overrides.

```
editor-app/
  src-tauri/                       (Rust shell — owned by a separate agent, not this lift map)
  src/
    main.tsx                       Vite + React entry
    App.tsx                        Three-pane split shell; holds the unit-state context provider
    types/
      unit.ts                      UnitSchematic, ChassisData, Costs, Evolution (generated from schemas/unit.schema.json)
      part.ts                      PartSchematic, category-discriminated unions (generated from schemas/part.schema.json)
      voxel.ts                     MaterialId, VoxelGrid, SparseGridV1, Hardpoint
      derived.ts                   DerivedStats (output of derived-stats.ts; distinct from UnitSchematic per Principle 2)
      editor-state.ts              UnitState (working copy in the form), selection state, file metadata
    lib/
      voxel-constants.ts           CELL_SIZE_M, CELL_VOLUME_M3, GRID_SIZE
      battlefield-constants.ts     MAP_SIZE, TERRAIN_AMP, CAM_PITCH_*, ZOOM_*
      materials.ts                 MATERIALS catalog (6 entries)
      faction-palettes.ts          FACTION_PALETTES (10 factions)
      enums.ts                     chassis classes, energy sources, armor materials, tags, weapon types, sensor modalities, utility functions, comms types, part categories (generated from schemas/)
      defaults.ts                  BLANK_UNIT
      part-defaults.ts             BLANK_PART_BY_CATEGORY
      noise.ts                     hash2, smoothNoise, fbm (deterministic terrain noise)
      util.ts                      range(a, b), other one-liners
      format.ts                    formatDuration
      voxel-grid.ts                key, parseKey, inBounds, mirrorX
      voxel-stats.ts               computeVoxelStats (collapsed from prototypes 2 + 3)
      voxel-serialize.ts           serializeVoxelGrid / parseVoxelGrid (sparse_grid_v1)
      voxel-renderer.ts            buildUnitMesh(voxelData, faction, opts?) — used by both 3D panes
      raycast-helpers.ts           screenToNDC, intersection helpers
      derived-stats.ts             deriveStats(unit) — pure, never mutates state, never persisted
      serialize.ts                 unitStateToSchematic, schematicToUnitState
      fixtures/
        starter-units.ts           4 sparse-grid fixtures from battlefield viewer
        voxel-fixtures.ts          seedStarterUnit tank from voxel editor
    hooks/
      useUnitState.ts              Reads/writes the shared unit-state context (active unit, dirty flag, file path)
      useThreeScene.ts             Generic Three.js mount/unmount + RAF loop, scoped to a container ref
      useResizeObserver.ts         ResizeObserver wrapper for canvas containers (replaces window-bound onResize)
      useKeyboard.ts               Window keydown/keyup with input-focus guard (replaces every keydown handler in the prototypes)
      useFps.ts                    Sampled FPS counter (from battlefield viewer lines 802-803, 844-850)
      useTauriFile.ts              Wraps @tauri-apps/plugin-dialog open/save and @tauri-apps/plugin-fs read/write
    components/
      AttributeForm/
        AttributeForm.tsx          Top-level center pane
        MetaSection.tsx            id / name / faction / designer / description
        ChassisSection.tsx         mass, engine, drivetrain, fuel, armor, hardpoints, thermal, tags
        PartsSection.tsx           Add-part dropdown + list of PartForm
        PartForm.tsx               One per part; dispatches on category
        TagInput.tsx               Tag chips (replaces prototype 1 lines 230-244)
        CostsSection.tsx           per-resource cost inputs
        DerivedStatsPanel.tsx      Mobility / Energy / Defense / Weapons groupings
        JsonPreview.tsx            Live JSON view of the current Schematic
      VoxelSculptor/
        VoxelSculptor.tsx          Left-pane shell; mounts the Three.js scene
        scene.ts                   Scene, lights, ground, grid, region wireframe, mirror plane, cursor
        voxel-ops.ts               addVoxel / removeVoxel / clearAll reducers acting on the grid Map
        picking.ts                 getIntersect, cursor positioning
        input.ts                   Pointer (orbit/pan/click) + wheel handlers wired through useEffect
        keys.ts                    1-9 material select, M mirror, G grid toggle
        loop.ts                    RAF + resize wiring
        Palette.tsx                Material swatch grid
        Toolbar.tsx                Mirror, clear, visibility toggles
        StatsReadout.tsx           Voxel count, mass, bounding box
      BattlefieldPreview/
        BattlefieldPreview.tsx     Right-pane shell
        scene.ts                   Scene, fog, hemi/sun/fill lights
        terrain.ts                 buildTerrainMesh + getTerrainHeight
        camera.ts                  TA-style fixed-azimuth rig (camTarget, camPitch, camZoom, updateCamera)
        input.ts                   Middle-drag pan, wheel zoom, WASD/QE camera step (selection logic dropped)
        loop.ts                    tick(): camera step + (optional) unit movement + FPS sample + render
        Settings.tsx               Shadow + wireframe debug toggles
        Hud.tsx                    Lightweight stats overlay
```

Notes for the implementer agents:

- The three pane components each *consume* `useUnitState`. None of them owns the active unit's state directly. `App.tsx` provides the context.
- `hooks/useThreeScene.ts` is the place to centralize the prototype's repeated mount-effect boilerplate (renderer construction, RAF, dispose). If it grows brittle, each component can fall back to its own mount effect — but try the shared hook first.
- The `lib/voxel-renderer.ts` function is the single source of truth for "render a unit on a scene." Both 3D panes call it. Do not duplicate.
- Types under `types/` are imported by both `lib/` and `components/`. Don't define types inside component folders — they leak too easily.

---

## Open questions

- OPEN[2026-05-27]: Adopt `three/examples/jsm/controls/OrbitControls` in `VoxelSculptor` now that we have a bundler, or keep the hand-rolled orbit at prototype 2 lines 234-247? Lean keep — fewer dependencies, twelve lines, already debugged.
- OPEN[2026-05-27]: Voxel sculptor storage — keep the dual `voxels` + `voxelMeshes` Map (prototype 2 lines 214-217) or move to a single `Map<MaterialId, InstancedMesh>` driven from React state? Lean instanced, matching the export format and prototype 3's renderer.
- OPEN[2026-05-27]: Hardpoint extraction during voxel export (prototype 2 lines 631-635) defaults `facing: 'y+'`. Should facing be inferred from neighbor occupancy, or chosen by the user at placement? blocks: full Editor App hardpoint UI.
- OPEN[2026-05-27]: Should `BattlefieldPreview` keep the click-to-walk feature (prototype 3 lines 686-698) as a unit-validation aid, or strip down to "render the active unit on terrain" only? Lean keep behind a settings toggle — it's good for sanity-checking the unit's `speed` derivation.
- OPEN[2026-05-27]: Generate `src/lib/enums.ts` from `schemas/unit.schema.json` at build time, or maintain by hand? Strong lean generate — Principle 4 (Invariance) means the schemas are the contract; hand-maintained mirrors drift.
- OPEN[2026-05-27]: Three.js bundling strategy under Tauri — pinned `[email protected]` (matching the prototypes) or current stable? blocks: implementer agents' `package.json`.
- OPEN[2026-05-27]: Where does the "active unit" shared state live — Zustand store, Jotai atoms, or React context? The parent brief should resolve. blocks: how each component imports and dispatches.
- OPEN[2026-05-27]: Top-level layout — split `types/`, `hooks/`, `lib/`, `components/` as siblings under `src/` (recommended above) or fold types and hooks into `lib/`? The split keeps imports shorter and prevents `lib/` from sprawling, but doubles the number of top-level folders. Lean keep the split.

## Cross-references

- [tools/editor/index.html](../tools/editor/index.html) — prototype 1, form-based attribute editor.
- [tools/voxel-editor/index.html](../tools/voxel-editor/index.html) — prototype 2, 3D voxel sculptor.
- [tools/battlefield-viewer/index.html](../tools/battlefield-viewer/index.html) — prototype 3, TA-style battlefield viewer.
- [docs/editor-app-tauri-brief.md](editor-app-tauri-brief.md) — parent brief (the doc that spawned the three implementer agents and this lift map).
- [docs/editor-app.md](editor-app.md) — Editor App design doc and prototype status.
- [DESIGN.md](../DESIGN.md) — master contract; Principle 2 (Derived-stat discipline) and Principle 4 (Invariance) constrain the lift.
- [docs/schematics.md](schematics.md) — `sparse_grid_v1` voxel format and Schematic validation pipeline.
- [schemas/unit.schema.json](../schemas/unit.schema.json) — target output schema for `AttributeForm`.
- [schemas/part.schema.json](../schemas/part.schema.json) — target output schema for parts.
