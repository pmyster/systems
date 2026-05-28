/**
 * Canonical voxel-stats computations.
 *
 * Consolidates two near-duplicate implementations from the prototypes:
 *  - tools/voxel-editor/index.html lines 376-396 (`updateStats`)
 *  - tools/battlefield-viewer/index.html lines 547-555 (`computeMass`)
 *
 * Per DESIGN.md Principle 2, mass is *derived* from physical inputs
 * (voxel count × per-material density × cell volume). The Schematic
 * never stores the result as the source of truth; library code calls
 * this function on demand.
 *
 * Two input shapes are supported:
 *   - VoxelMap         (editor runtime state)
 *   - VoxelGrid        (sparse_grid_v1 payload, with its own
 *                       per-material density table)
 *
 * The second form is what the battlefield renderer / engine see —
 * they get density from the payload's `materials` table, not from
 * the editor's static catalog. This makes the function robust to
 * mod content that introduces unknown material ids.
 */

import { CELL_VOLUME_M3, MATERIAL_BY_ID } from "./constants";
import { computeBoundingBox } from "./voxel-grid";
import type {
  VoxelGrid,
  VoxelMap,
  VoxelStats,
} from "../types/voxel";

// ---------------------------------------------------------------------------
// Mass.
// ---------------------------------------------------------------------------

/** Mass of a VoxelMap using the editor's static MATERIALS catalog. */
export function computeMapMass(grid: VoxelMap): number {
  let mass = 0;
  for (const mat of grid.values()) {
    const m = MATERIAL_BY_ID[mat];
    if (m) mass += m.density * CELL_VOLUME_M3;
  }
  return mass;
}

/**
 * Mass of a sparse_grid_v1 payload using the payload's own density
 * table. Falls back to the static catalog for any material id not
 * declared in the payload — this keeps loaded files renderable even
 * if their density block is missing.
 */
export function computeGridMass(grid: VoxelGrid): number {
  let mass = 0;
  const cellVol = (grid.cell_size_m ?? 0) ** 3 || CELL_VOLUME_M3;
  for (const v of grid.voxels) {
    const matId = v[3];
    const spec = grid.materials?.[matId];
    const density =
      spec?.density_kg_m3 ?? MATERIAL_BY_ID[matId]?.density ?? 0;
    mass += density * cellVol;
  }
  return mass;
}

// ---------------------------------------------------------------------------
// Combined stats.
// ---------------------------------------------------------------------------

/**
 * Full stats panel for a VoxelMap — count, mass, bounding box.
 * Mirrors the data the prototype's stats readout showed.
 */
export function computeVoxelStats(grid: VoxelMap): VoxelStats {
  return {
    voxelCount: grid.size,
    massKg: computeMapMass(grid),
    boundingBox: computeBoundingBox(grid),
  };
}

/**
 * Same as computeVoxelStats but for a serialized VoxelGrid. Useful
 * for showing a loaded file's stats without first deserializing.
 */
export function computeGridStats(grid: VoxelGrid): VoxelStats {
  return {
    voxelCount: grid.voxels.length,
    massKg: computeGridMass(grid),
    boundingBox: grid.bounding_box,
  };
}
