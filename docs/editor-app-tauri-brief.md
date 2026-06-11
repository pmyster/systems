# Editor App — Tauri v0.1 Implementation Brief

## TL;DR

- **Child of Light Editor** is a native Windows desktop app that lets a player author a complete unit Schematic — voxel chassis + parts + attributes — in a single unified workspace and export it as a JSON file the future game engine can load.
- Built on **Tauri 2.x** (Rust backend, WebView2 frontend), **React 18 + TypeScript**, **Three.js**, **Zod**, **Vite**. Roughly **5 MB installer**.
- **Three-pane split workspace:** voxel sculptor (left) | attribute form (center) | battlefield preview (right). All three panes bind to a single unit-state object; edits propagate instantly.
- Replaces the three current browser prototypes (`tools/editor/`, `tools/voxel-editor/`, `tools/battlefield-viewer/`) by lifting their working logic into one shell.
- **Phased delivery:** v0.1 (scaffold + edit + save) → v0.2 (validation + live preview + autosave) → v0.3 (polish + installer + detachable panels). Targeting one week per phase.
- This brief is the implementation contract for [docs/editor-app.md](editor-app.md); it does not change that doc's design — it scopes the first shippable build.

## Scope

This document owns:
- The v0.1 / v0.2 / v0.3 implementation plan for the Editor App on Windows desktop.
- The technology choices for the first native build (Tauri, React, Three.js, Zod, Vite).
- The three-pane workspace contract.
- File-operation behavior (Open / Save / Save As / autosave / `physics_version` bump).
- The cut line for v0.1 (what is in vs deferred).

This document does NOT own:
- The Editor App's vision, hybrid-model design, or long-term phase plan — those belong to [docs/editor-app.md](editor-app.md).
- The Schematic format itself — that belongs to [docs/schematics.md](schematics.md) and `schemas/`.
- The engine's Schematic loader — that belongs to [docs/architecture.md](architecture.md) (Module 1).
- The detailed source-code lift map from the three prototypes — that lives in `docs/editor-app-tauri-lift-map.md` (separate work item).
- Marketplace, cloud sync, collaboration, animation, or part-library browser — explicit non-goals for v0.1.

## Prerequisites

- [DESIGN.md](../DESIGN.md) — pillars and locked decisions; in particular Principle 2 (Derived-stat discipline) and Principle 4 (Invariance: amend, never alter).
- [docs/editor-app.md](editor-app.md) — the spec this brief implements against.
- [docs/architecture.md](architecture.md) — engine module decomposition; the editor produces Schematics consumed by Module 1.
- [docs/schematics.md](schematics.md) — Schematic format, ID rules, `physics_version` field, voxel `sparse_grid_v1` encoding.
- [schemas/unit.schema.json](../schemas/unit.schema.json) — the unit schema Zod validates against.
- [schemas/part.schema.json](../schemas/part.schema.json) — the part schema referenced from unit parts.
- [tools/editor/index.html](../tools/editor/index.html) — form-based prototype to be folded into the center pane.
- [tools/voxel-editor/index.html](../tools/voxel-editor/index.html) — voxel-sculpting prototype to be folded into the left pane.
- [tools/battlefield-viewer/index.html](../tools/battlefield-viewer/index.html) — battlefield renderer to be folded into the right pane.

---

## Goal

Deliver a native Windows desktop application — **Child of Light Editor** — that lets a player author a complete unit Schematic (voxel chassis + parts + attributes) in a **single unified workspace** and export it as a JSON file the future game engine can consume directly.

This replaces three separate browser prototypes the user juggles today (form editor, voxel editor, battlefield viewer) with one cohesive tool. The same JSON the editor saves is what the engine's Schematic Loader (Module 1) reads at runtime; the editor and engine speak the same format, per the architecture's core promise.

The editor is the modder seam. The constitution's modder-safety guarantees (Principle 2: physical inputs only; Principle 4: amend never alter) are enforced *in the editor* before the file ever reaches the engine.

---

## Architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Native shell | **Tauri 2.x** | Rust backend, WebView2 frontend on Windows. ~5 MB installer vs ~150 MB Electron. Native filesystem APIs without a browser sandbox. |
| Frontend framework | **React 18 + TypeScript** | Mature, fits the three-pane component model, strict typing keeps the unit-state object honest. |
| 3D rendering | **Three.js** | Already in use across all three prototypes. Same engine renders voxel sculpting (left) and battlefield preview (right) — single mental model. |
| Schema validation | **Zod** | Runtime validation of the in-memory unit object against `schemas/unit.schema.json`. Catches constitution violations before save. |
| Frontend build | **Vite** | Fast HMR during development; integrates cleanly inside the Tauri shell. |

Tauri is the right shell because:
- Native Windows filesystem APIs (no browser File System Access API limits).
- WebView2 means the same Three.js + React code that runs in the prototypes runs in the app — minimal porting overhead.
- Small installer footprint matches a creative tool a player installs once and keeps.
- Rust backend gives a clean future seam for native-speed operations (large voxel grids, future asset packing) without rewriting the frontend.

The simulation has no Tauri or Rust dependencies — the editor is a pure content-authoring tool. It produces JSON; the engine reads JSON. The two never share runtime.

---

## UI Layout — Three-Pane Split Workspace

The workspace is a single window with three panes side-by-side. All three bind to one **unit-state object** held in memory. Any change in any pane mutates that object and the other two panes re-render from it.

### Left pane — Voxel chassis sculptor

- Three.js scene with orbit camera, grid floor, and the current voxel chassis.
- Voxel placement uses the `sparse_grid_v1` encoding from [docs/schematics.md](schematics.md): a list of `[x, y, z, material_id]` entries written directly to the unit's `voxel_data` block.
- Color palette UI for choosing voxel material/color class (team-primary / team-secondary / team-accent / fixed) per [docs/architecture.md](architecture.md) Module 9.
- Tools: place, erase, fill, pick. Mirror-X toggle for symmetric building.
- Lifts from [tools/voxel-editor/index.html](../tools/voxel-editor/index.html).

### Center pane — Attribute form

- Scrollable form binding to the unit-state object's non-voxel fields.
- Sections: chassis (mass, engine, drivetrain, fuel), parts (weapons, sensors, defense, utility, mobility-aux, communications), costs, derived-stat readout.
- **Physical inputs only.** Per Principle 2 of [DESIGN.md](../DESIGN.md), the form accepts `mass_kg`, `engine_kW`, `propellant_energy_MJ`, `barrel_thermal_capacity_MJ`, etc. — never raw speed, range, damage, or cooldown. The derived-stat readout is informational, computed from the inputs using the prototype's simplified equations; the real engine will compute them precisely at load time.
- Lifts from [tools/editor/index.html](../tools/editor/index.html).

### Right pane — Battlefield preview

- Top-down 3D scene with procedural terrain (heightmap, vertex-colored).
- The current unit, built from `voxel_data` in real time, sits on the terrain.
- Fixed-axis TA-style camera per [docs/architecture.md](architecture.md) Module 9 rendering rules: pan + strategic zoom, locked azimuth, tilt-clamped pitch.
- Updates instantly when the left pane sculpts or the center pane edits.
- Lifts from [tools/battlefield-viewer/index.html](../tools/battlefield-viewer/index.html).

### Pane behavior

- All three panes share a single unit-state object (React context or equivalent). One source of truth.
- Edits in any pane propagate to the other two in the same render cycle — no save-to-disk round-trip.
- Panes are resizable via drag handles between them.
- **Detachable panels to a second monitor are deferred to v0.3.** In v0.1 the layout is fixed-side-by-side in one window.

---

## File Operations

The editor uses Tauri's native filesystem APIs (not browser File System Access) for all disk I/O.

| Action | Behavior |
|---|---|
| **Open** | Native open-file dialog. Reads JSON, parses, validates against `unit.schema.json` via Zod, loads into the unit-state object. Validation errors block load and surface to the user. |
| **Save** (Ctrl+S) | If the file has a path, writes canonical JSON to it. If new, falls through to Save As. Validation runs before write — invalid content cannot be saved over a valid file. |
| **Save As** | Native save-file dialog. Writes canonical JSON to the chosen path. |
| **Autosave** | Every 60 seconds, writes the current unit-state object to a hidden `.autosave` file next to the working file (or to a default app-data location if the file is unsaved). Survives crashes. Not loaded automatically; restored via an explicit "Recover" menu action. |
| **Bump physics_version** | A dedicated menu action that explicitly increments the unit's `physics_version` field. This is a separate user action — never automatic — so the player consciously opts into a version change per Principle 4 (Invariance: amend, never alter). Saved units carry their original `physics_version` forever otherwise. |

Canonical JSON output:
- Stable key order (matches `unit.schema.json` field order).
- 2-space indentation.
- Trailing newline.
- UTF-8, no BOM.

The on-disk format is exactly what the engine's Schematic Loader (Module 1) will read. There is no editor-only format; the editor IS the authoring tool for the engine's content.

---

## Code Reuse

The three prototypes contain working logic for every pane the v0.1 editor needs. The brief's strategy is **lift, don't rewrite**.

| Prototype | Provides | Maps to |
|---|---|---|
| [tools/voxel-editor/index.html](../tools/voxel-editor/index.html) | Three.js voxel placement, sparse grid encoding, color palette, mirror tools | Left pane |
| [tools/editor/index.html](../tools/editor/index.html) | Form-based unit editing, derived-stat preview equations, JSON serialization | Center pane |
| [tools/battlefield-viewer/index.html](../tools/battlefield-viewer/index.html) | Top-down 3D scene, procedural terrain, voxel-mesh instancing, TA-style camera | Right pane |

The detailed file-by-file source mapping — which function in which prototype becomes which React component or hook — lives in `docs/editor-app-tauri-lift-map.md` (a companion document, tracked as a separate work item). That doc is the source of truth for the porting effort; this brief stays at the architectural level.

---

## Phased Delivery

Each phase is sized for roughly **one week** of focused work. Phases are cumulative — v0.2 includes everything v0.1 shipped, plus its own additions.

### v0.1 — Scaffold, layout, basic editing, save/load

Target: one week.

- Tauri project scaffold; React + Vite frontend in `src/`; Rust backend in `src-tauri/`.
- Three-pane layout with resizable splits.
- Voxel placement (left pane) — place, erase, color-pick. Basic palette.
- Attribute form (center pane) — chassis fields and at least one weapon part section.
- Battlefield preview (right pane) — renders the current voxel chassis on a flat ground plane (procedural terrain comes in v0.2).
- File menu: New, Open, Save, Save As. Native dialogs. JSON read/write.
- No schema validation yet (that's v0.2). Files saved must be valid by construction.

**Definition of done:** a user can open the app, sculpt a small voxel chassis, fill in mass/engine/one weapon, save the file, close the app, reopen the file, and see the same unit.

### v0.2 — Validation, live battlefield preview, autosave

Target: one week.

- Zod schema bindings generated from `schemas/unit.schema.json` and `schemas/part.schema.json`.
- Validation runs on every save; invalid content blocks the write and surfaces a clear error list.
- Battlefield preview gains procedural terrain (heightmap, vertex coloring) and TA-style camera per [docs/architecture.md](architecture.md) Module 9.
- Autosave to `.autosave` every 60 seconds. Recover-from-autosave menu action.
- Explicit "Bump physics_version" menu action.
- Derived-stat readout in the center pane (mirrors the existing prototype's preview equations).

**Definition of done:** every save produces a schema-valid file; the battlefield preview shows the unit on terrain in real time as the player edits; a crash mid-edit can be recovered from the autosave.

### v0.3 — Polish, shortcuts, installer, detachable panels

Target: one week.

- Native Windows menu bar (File / Edit / View / Help).
- Keyboard shortcuts: Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+Shift+S, undo/redo, tool switching.
- Windows installer (MSI or NSIS) with custom app icon.
- Detachable panels — any pane can be torn off into its own window, useful on a second monitor.
- Application icon, About dialog, version string.
- Crash reporting hook (local log file; no telemetry in v0.1-v0.3).

**Definition of done:** the editor installs cleanly on a fresh Windows machine, looks like a native app, and a player with two monitors can dock the battlefield preview on the second screen.

---

## Non-Goals (v0.1)

These are explicitly *out of scope* for the v0.1 editor. Each has a future home; none belongs in the first shippable build.

- **No marketplace integration.** Deferred to V2 of the game per [docs/editor-app.md](editor-app.md).
- **No cloud sync.** Files live on local disk. The user moves them manually if they want them elsewhere.
- **No collaboration features.** Single-user, single-file at a time.
- **No animation or scripting layer.** Child of Light's equivalent of TA's COB scripts comes much later in the engine roadmap — the editor will not author them in v0.1-v0.3.
- **No part library browser.** Parts are authored inline in the center pane as form sections. A browsable library of stock or community parts is a later phase per [docs/editor-app.md](editor-app.md).
- **No hardpoint placement UI.** v0.1 treats parts as a flat list on the unit. Hardpoint snapping per [docs/editor-app.md](editor-app.md)'s hybrid model is a later phase, blocked on the hardpoint-rules open question in that doc.

---

## Open questions

- OPEN[2026-05-27]: voxel grid resolution and per-unit voxel budget for the left pane. Inherits the open question already tracked in [docs/editor-app.md](editor-app.md); the brief does not resolve it. blocks: v0.1 voxel-pane sizing.
- OPEN[2026-05-27]: undo/redo granularity — per-voxel-action vs per-form-field vs unified timeline. Recommendation: unified timeline scoped to v0.3. blocks: v0.3 polish phase.
- OPEN[2026-05-27]: Zod schemas hand-authored to match the JSON Schemas, or generated from `schemas/*.schema.json` at build time? Recommendation: generated, so the editor cannot drift from the engine's contract. blocks: v0.2 validation work.
- OPEN[2026-05-27]: how the editor renders the procedural terrain in the right pane — pulled from a stock environment Schematic, or synthesized in-editor? Recommendation: synthesized in v0.2 (no Schematic dependency), swap to a real environment Schematic when [docs/physics.md](physics.md) ships its catalog. blocks: v0.2 battlefield-preview work.

## Cross-references

- [docs/editor-app.md](editor-app.md) — the parent spec this brief implements.
- [DESIGN.md](../DESIGN.md) — Principle 2 (Derived-stat discipline), Principle 4 (Invariance: amend, never alter).
- [docs/schematics.md](schematics.md) — Schematic format, ID rules, `sparse_grid_v1` voxel encoding, `physics_version` field.
- [docs/architecture.md](architecture.md) — engine modules (the editor produces input for Module 1 Schematic Loader; the right-pane renderer mirrors Module 9's TA-style camera rules).
- [schemas/unit.schema.json](../schemas/unit.schema.json) — the unit schema Zod validates against.
- [schemas/part.schema.json](../schemas/part.schema.json) — the part schema referenced from unit parts.
- [tools/editor/index.html](../tools/editor/index.html) — form prototype, source for the center pane.
- [tools/voxel-editor/index.html](../tools/voxel-editor/index.html) — voxel prototype, source for the left pane.
- [tools/battlefield-viewer/index.html](../tools/battlefield-viewer/index.html) — viewer prototype, source for the right pane.
