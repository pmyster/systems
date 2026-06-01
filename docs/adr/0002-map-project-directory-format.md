# ADR 0002 — Map Project Directory Format

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Phee (CPS Systems) + engineering
- **Related:** ADR 0001 (Coordinate System), `docs/editor-app-tauri-lift-map.md`

## Context

The Unit editor stores each unit as a single JSON file (`units/player/*.json`).
That works because a unit is small (a few KB) and humans benefit from git
diffs on every field.

Maps are different:

- A 129×129 Float32 heightmap is ~65 KB raw, but base64-encoded into JSON is
  ~88 KB of noise that ruins diff readability.
- Future layers (splatmap PNG, instance buffer, lightmap, navmesh bake) push
  per-map size to multiple MB.
- A single giant JSON blob parses slowly and forces a full re-write on every
  autosave (60s cadence). Sidecar binary files allow us to only touch what
  changed.

We need a **hybrid container**: a small human-diffable manifest + adjacent
binary sidecars in a known directory layout.

## Decision

A **map project is a directory**, not a file. Its on-disk layout is:

```
<project-dir>/
  manifest.json         (Zod-validated; human-diffable; small)
  heightmap.r32         (raw little-endian Float32 grid; 129*129*4 = 66,564 bytes for default size)
  .bak/                 (rolling backups of manifest.json + heightmap.r32; up to 10 generations)
  .autosave/            (60-second autosave snapshots — separate from .bak so a crash + reopen never blows away true saves; full integration lands Week 2)

  (later weeks add:)
  splatmap.png          (terrain blend layers; 4-channel PNG)
  instances.bin         (compact per-instance buffer for static prop placements)
  navmesh.bin           (baked navigation mesh)
  lighting/             (precomputed sky / sun probes if we ever go there)
```

### manifest.json

Contains, at minimum:

- `schemaVersion` (integer; starts at 1)
- `name`, `metadata` (author, theme, dimensions, timestamps)
- `coordinateSystem`: a snapshot of ADR 0001 values so a map authored under
  v1 can still be loaded after a future coord-system ADR
- `terrain`: { `sidecar: "heightmap.r32"`, dimensions, tile size }
- `objects[]`: placed instances (id, prefabId, transform, properties)
- `spawnPoints[]`: gameplay anchors

### Atomic save protocol

For every write (manifest or sidecar):

1. Write to `<file>.tmp` in the same directory
2. `fsync` the tmp file
3. Rename `<file>.tmp` over the original (POSIX rename is atomic; on Windows
   NTFS `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` is atomic too)
4. If the rename fails on Windows with `ERROR_ACCESS_DENIED` (5), wait 50 ms
   and retry once — Windows file locks from indexers can flap briefly

This is the standard "tmp + rename" dance. It guarantees the original is
never half-written.

### Schema versioning + migrations

- `schemaVersion: 1` ships in Week 1.
- A migration scaffold lives at `editor-app/src/map/schema/migrations.ts`
  from Day 1. Every load goes through `migrate(rawParsed)` even when no
  migration is needed yet — wiring it now means future v1→v2 is a code
  change in one file, not a load-path archaeology dig.

### Two-state-pattern coexistence

This ADR also documents a deliberate divergence in client state-management:

- **Unit editor** uses `React.Context + useReducer` (existing, ~10k LOC).
  It will not be migrated.
- **Map editor** uses **Zustand** (introduced Week 1) for the map document
  store, command bus, and ephemeral UI state.

Rationale:

1. Migrating the Unit editor's reducer is high risk and zero payoff — it
   already works.
2. The Map editor has different access patterns (high-frequency brush
   strokes, command-bus undo/redo, multiple subsystems reading slices of
   the same big document). Zustand's selector + transient subscriber model
   fits this better and avoids React re-render storms.
3. Scope-isolated: Zustand stores live under `editor-app/src/map/...` and
   `editor-app/src/state/appMode.ts`. No Unit code imports from there.
4. The cost is one extra dependency (zustand v5, ~3 KB gzipped) and two
   state patterns in the same repo, which is documented here and in the
   Unit and Map provider files.

## Consequences

- The Tauri `save_map` / `load_map` Rust handlers (Day 4) operate on a
  **directory path**, not a file path. The "Save As..." dialog uses
  Tauri's directory picker.
- Git: a map is a directory, so a `.gitignore` rule scoped to `.autosave/`
  inside any project dir keeps autosaves out of source control. `.bak/`
  is opt-in: small teams may want it tracked, larger ones won't.
- Backwards compatibility: there is none — v1 is the first format. Any
  pre-existing demo maps must be recreated.
- Tools that thought "a map = a file" must be updated. Today that's only
  the editor; no external tools exist yet.

## Open follow-ups

- **Chunked terrain** (Week 2–3) may introduce `chunks/<x>_<z>.r32` files
  inside the project dir instead of a single heightmap. The directory
  format accommodates this naturally; no ADR change needed.
- **Asset references**: if maps reference shared mesh/material assets,
  we need a project-relative vs library-relative path policy. Defer.
- **Crash-safe autosave**: full design lands Week 2 along with the
  autosave-recovery banner (deferred from Week 1 per Phee's call).
