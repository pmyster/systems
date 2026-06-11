# ADR 0001 — Map Editor Coordinate System

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Phee (CPS Systems) + engineering
- **Related:** ADR 0002 (Map Project Directory Format), `docs/editor-app-tauri-lift-map.md`

## Context

The Map Editor sits at the seam of several systems that all need to agree on a
single coordinate convention:

- The Three.js editor renderer (where the brush, gizmos, and camera live)
- The future physics-runtime that consumes the saved map
- The future pathfinding/navmesh bake step
- The on-disk save format (which must be portable across the above)
- The Unit editor's existing Three.js scene (Y-up by convention) — we don't
  want a different "up" in Map vs Unit, or every artist that crosses tools
  will be confused

Coordinate-system drift is one of the cheapest mistakes to prevent up front
and one of the most expensive to fix after thousands of authored assets exist.
This ADR locks the convention before any map data is written.

## Decision

| Property | Value |
|---|---|
| Up axis | **Y-up** (Three.js native; matches Unit editor) |
| Tile size | **1.0 m per tile** |
| Heightmap pixel pitch | **1.0 m per pixel** (a 129×129 heightmap = 128 m × 128 m map area) |
| World units | **1 world unit = 1 meter** (no conversion ratios — `position.x = 5` means 5 meters east of origin) |
| Heightmap value semantics | Each pixel stores the **world-Y height in meters** of that vertex (Float32). `heightmap[0, 0]` is the vertex at world position `(0, h, 0)`. |
| Coordinate origin | World `(0, 0, 0)` = south-west corner of the map. **+X = east, +Z = south.** Heightmap pixel `(0, 0)` lives at the SW corner. |

Y-up + (+X east, +Z south) means the heightmap, viewed as a 2D image with
`(0,0)` top-left, has its top-left pixel at the **SW** corner of the world
when the camera looks down (-Y). This is the convention Three.js'
`PlaneGeometry` uses after a `-π/2` X rotation, so no extra flips are needed.

### Why heightmap stores world-Y height directly (not normalized 0..1)

Float32 raw heights mean:

1. No re-quantization on every read (renderer, bake, runtime all read the same numbers).
2. No "max height" magic constant to drift across systems.
3. Negative heights (water, trenches) work without offsets.
4. 129×129×4 bytes = 66,564 bytes — trivial size; no need for compression
   complexity at this density.

## Consumers

| Consumer | What it does with this convention |
|---|---|
| `TerrainMesh.ts` (Week 1 Day 2) | Builds `PlaneGeometry(width, depth, w-1, h-1)`, rotates -π/2 X, writes per-vertex Y from heightmap. |
| Brush hit-testing (Day 3) | Raycasts against terrain mesh; converts world hit `(x, _, z)` → heightmap pixel index via `worldToHeightmap`. |
| Save format (Day 4) | `manifest.json` carries a `CoordinateSystemSnapshot` so a future "open old map" flow can detect drift. |
| Future navmesh bake | Reads walkability grid in same coord frame; tile index = `(floor(x), floor(z))`. |
| Future runtime / game engine | Loads heightmap as-is; expects same SW origin and +X east / +Z south. |

## Consequences

- All numeric coordinate constants live in `editor-app/src/map/coords/constants.ts`.
  Code MUST import from there — never sprinkle `1.0`, `129`, `128` literals
  through map code. The constants file is the single source of truth.
- The Zod manifest schema embeds a `CoordinateSystemSnapshot` on every saved
  map. If a future ADR changes any of these values, old maps still know what
  frame they were authored in.
- Up-axis change in the future = breaking change requiring a migration step.
  We do not anticipate this.

## Open follow-ups

- **Chunked terrain** (Week 2–3) will need a `CHUNK_SIZE_PX` constant added
  here. Likely 32 or 64. Defer until we have a real performance signal.
- **Sub-tile precision** for unit positions is already supported (positions
  are floats); no ADR change needed.
- **Above-ground vs underground (multi-floor maps)** is not in scope for
  v1; would require either a stack of heightmaps or a true voxel
  representation. Park as a known limitation.
