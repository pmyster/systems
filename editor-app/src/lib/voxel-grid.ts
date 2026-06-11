/**
 * Pure functions for editing and serializing the sparse_grid_v1 voxel
 * format described in docs/schematics.md.
 *
 * The editor's *runtime* state is a Map<string, MaterialId> keyed by
 * "x,y,z" — see VoxelMap in src/types/voxel.ts. The on-disk format is
 * the VoxelGrid object. This module owns the bidirectional conversion
 * plus the elementary edit ops (add/remove/has).
 *
 * Design notes:
 *  - Per the lift map, the editor keeps ONE source of truth for voxel
 *    state. The Three.js scene is rebuilt from the VoxelMap by an
 *    effect — there is no parallel `voxelMeshes` Map. Rendering lives
 *    in src/lib/voxel-renderer.ts.
 *  - Functions taking a VoxelMap return a new VoxelMap (immutable
 *    semantics). Callers wanting in-place mutation can use the
 *    Mutable* variants where provided.
 *  - Mirror-X is *not* baked in here; addVoxelMirrored is the
 *    convenience wrapper that calls addVoxel twice for a given mirror
 *    axis. Keeps the primitive op simple.
 *
 * Lift sources:
 *  - tools/voxel-editor/index.html lines 313-373 (add/remove/clear)
 *  - tools/voxel-editor/index.html lines 607-666 (export/load JSON)
 *  - tools/battlefield-viewer/index.html lines 547-555 (mass mirror)
 */

import {
  CELL_SIZE_M,
  CELL_VOLUME_M3,
  GRID_SIZE,
  MATERIALS,
  MATERIAL_BY_ID,
} from "./constants";
import type {
  BoundingBox,
  Hardpoint,
  MaterialId,
  MutableVoxelMap,
  SerializedVoxel,
  VoxelGrid,
  VoxelMap,
  VoxelMaterialMap,
} from "../types/voxel";

// ---------------------------------------------------------------------------
// Key helpers.
// ---------------------------------------------------------------------------

/** Stringify a coord into the canonical "x,y,z" Map key. */
export function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Parse a "x,y,z" Map key back to a numeric triple. */
export function parseKey(k: string): readonly [number, number, number] {
  const parts = k.split(",");
  if (parts.length !== 3) {
    throw new Error(`Invalid voxel key '${k}'`);
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`Invalid voxel key '${k}'`);
  }
  return [x, y, z] as const;
}

/** Bounds-check a coord against the grid (default GRID_SIZE^3). */
export function inBounds(
  x: number,
  y: number,
  z: number,
  gridSize: number = GRID_SIZE,
): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    z >= 0 &&
    x < gridSize &&
    y < gridSize &&
    z < gridSize
  );
}

/** Mirror an x-coord around the grid's center line. */
export function mirrorX(x: number, gridSize: number = GRID_SIZE): number {
  return gridSize - 1 - x;
}

// ---------------------------------------------------------------------------
// Primitive ops (immutable).
// ---------------------------------------------------------------------------

/** True if the map has a voxel at (x, y, z). */
export function hasVoxel(grid: VoxelMap, x: number, y: number, z: number): boolean {
  return grid.has(key(x, y, z));
}

/**
 * Return a new VoxelMap with the (x, y, z) cell set to `material`.
 * Bounds-checks. No-op (returns the same map reference) if out of
 * bounds.
 */
export function addVoxel(
  grid: VoxelMap,
  x: number,
  y: number,
  z: number,
  material: MaterialId,
): VoxelMap {
  if (!inBounds(x, y, z)) return grid;
  const out: MutableVoxelMap = new Map(grid);
  out.set(key(x, y, z), material);
  return out;
}

/**
 * Return a new VoxelMap with the (x, y, z) cell removed. No-op if
 * no voxel exists there.
 */
export function removeVoxel(
  grid: VoxelMap,
  x: number,
  y: number,
  z: number,
): VoxelMap {
  const k = key(x, y, z);
  if (!grid.has(k)) return grid;
  const out: MutableVoxelMap = new Map(grid);
  out.delete(k);
  return out;
}

/**
 * Place a voxel and its X-mirror in one call. Useful for symmetric
 * sculpting; matches the prototype's `mirrorX` branch.
 */
export function addVoxelMirrored(
  grid: VoxelMap,
  x: number,
  y: number,
  z: number,
  material: MaterialId,
): VoxelMap {
  const after = addVoxel(grid, x, y, z, material);
  const mx = mirrorX(x);
  if (mx === x) return after;
  return addVoxel(after, mx, y, z, material);
}

/** Remove a voxel and its X-mirror in one call. */
export function removeVoxelMirrored(
  grid: VoxelMap,
  x: number,
  y: number,
  z: number,
): VoxelMap {
  const after = removeVoxel(grid, x, y, z);
  const mx = mirrorX(x);
  if (mx === x) return after;
  return removeVoxel(after, mx, y, z);
}

/** Build a VoxelMap from a list of voxel entries. */
export function fromArray(entries: Iterable<SerializedVoxel>): VoxelMap {
  const out: MutableVoxelMap = new Map();
  for (const [x, y, z, mat] of entries) {
    if (!inBounds(x, y, z)) continue;
    if (!MATERIAL_BY_ID[mat]) continue;
    out.set(key(x, y, z), mat);
  }
  return out;
}

/** Dump a VoxelMap as a sorted list of voxel entries. Sort is stable
 *  across runs so canonical-JSON output is deterministic. */
export function toArray(grid: VoxelMap): readonly SerializedVoxel[] {
  const out: SerializedVoxel[] = [];
  for (const [k, mat] of grid.entries()) {
    const [x, y, z] = parseKey(k);
    out.push([x, y, z, mat]);
  }
  out.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return 0;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Bounding box / mass / hardpoints — derivations.
// ---------------------------------------------------------------------------

/** Tight AABB of the populated cells. Returns null for an empty map. */
export function computeBoundingBox(grid: VoxelMap): BoundingBox | null {
  if (grid.size === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const k of grid.keys()) {
    const [x, y, z] = parseKey(k);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Build the per-material spec table written into a sparse_grid_v1
 * payload. Mirrors the prototype's exportJSON inline catalog (tools/
 * voxel-editor/index.html lines 613-621).
 */
export function buildMaterialMap(): VoxelMaterialMap {
  const out: Record<string, VoxelMaterialMap[string]> = {};
  for (const m of MATERIALS) {
    out[m.id] = {
      density_kg_m3: m.density,
      color_class: m.team === "fixed" ? "fixed" : (`team-${m.team}` as const),
      color_hex: "#" + m.color.toString(16).padStart(6, "0"),
      cell_size_m: CELL_SIZE_M,
    };
  }
  return out;
}

/**
 * Extract hardpoint entries from a VoxelMap. Every cell with the
 * `hardpoint` material becomes a Hardpoint with facing 'y+'.
 *
 * NOTE: facing is hard-coded to 'y+' per the prototype. The lift map's
 * OPEN[2026-05-27] asks whether facing should be inferred from
 * neighbor occupancy or chosen by the user. Resolve before V1.
 */
export function extractHardpoints(grid: VoxelMap): readonly Hardpoint[] {
  const out: Hardpoint[] = [];
  let id = 1;
  for (const [k, mat] of grid.entries()) {
    if (mat !== "hardpoint") continue;
    const [x, y, z] = parseKey(k);
    out.push({ id: id++, position: [x, y, z], facing: "y+" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialization (sparse_grid_v1).
// ---------------------------------------------------------------------------

/**
 * Serialize a VoxelMap to the on-disk sparse_grid_v1 shape.
 *
 * Field order matches the prototype (format, grid_size, cell_size_m,
 * bounding_box, derived_mass_kg, voxel_count, voxels, materials,
 * hardpoints) so canonical-JSON diffs stay clean.
 */
export function serialize(grid: VoxelMap): VoxelGrid {
  const voxels = toArray(grid);
  const bounding_box = computeBoundingBox(grid);
  // Mass derivation lives in voxel-stats.ts; mirror the cheap version
  // here so this module has no inbound import cycles.
  let mass = 0;
  for (const [, mat] of grid.entries()) {
    const m = MATERIAL_BY_ID[mat];
    if (m) mass += m.density * CELL_VOLUME_M3;
  }
  return {
    format: "sparse_grid_v1",
    grid_size: [GRID_SIZE, GRID_SIZE, GRID_SIZE],
    cell_size_m: CELL_SIZE_M,
    bounding_box,
    derived_mass_kg: Math.round(mass),
    voxel_count: voxels.length,
    voxels,
    materials: buildMaterialMap(),
    hardpoints: extractHardpoints(grid),
  };
}

/**
 * Parse a sparse_grid_v1 payload back into the editor's runtime
 * VoxelMap. Invalid entries (bad material id, out-of-bounds) are
 * silently dropped — matches the prototype's loadJSON behavior.
 *
 * Throws if the input is not recognizable as sparse_grid_v1.
 */
export function deserialize(data: VoxelGrid): VoxelMap {
  if (!data || data.format !== "sparse_grid_v1") {
    throw new Error(
      `Unsupported voxel format: expected 'sparse_grid_v1', got '${data?.format ?? "undefined"}'`,
    );
  }
  if (!Array.isArray(data.voxels)) {
    throw new Error("sparse_grid_v1 payload missing 'voxels' array");
  }
  return fromArray(data.voxels);
}

/** True if `value` looks structurally like a sparse_grid_v1 payload. */
export function isVoxelGrid(value: unknown): value is VoxelGrid {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v["format"] === "sparse_grid_v1" && Array.isArray(v["voxels"]);
}
