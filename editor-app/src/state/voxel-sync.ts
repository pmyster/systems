/**
 * Voxel-sync helpers — convert between the editor's live edit state
 * (a `VoxelMap` keyed by "x,y,z") and the on-disk `VoxelGrid`
 * (`sparse_grid_v1` payload that lives at `unit.chassis.voxel_data`).
 *
 * The store keeps `voxels: VoxelMap` as the canonical live state for
 * sculpting (cheap to edit, supports immutable spread). On save we
 * serialize that map into a `VoxelGrid` and embed it under
 * `unit.chassis.voxel_data`. On load we read `unit.chassis.voxel_data`
 * back into a `VoxelMap` so the sculptor sees the loaded geometry.
 *
 * Per docs/editor-app-tauri-brief.md and docs/editor-app-tauri-lift-map.md
 * the sparse_grid_v1 format owns the canonical serialization in
 * src/lib/voxel-grid.ts; this module is a thin adapter on top.
 */

import { deserialize, serialize } from "../lib/voxel-grid";
import type { UnitChassis, UnitSchematic } from "../types/unit";
import type { VoxelGrid, VoxelMap } from "../types/voxel";

/**
 * Embed the current voxel map into a unit's chassis.voxel_data as a
 * serialized `sparse_grid_v1` payload. Returns a new immutable unit;
 * the caller is responsible for replacing the unit in store state.
 *
 * If `voxels` is empty, the field is removed entirely (an empty grid
 * is meaningless and clutters the diff).
 */
export function embedVoxelsIntoUnit(
  unit: UnitSchematic,
  voxels: VoxelMap,
): UnitSchematic {
  const nextChassis: UnitChassis = embedVoxelsIntoChassis(unit.chassis, voxels);
  return { ...unit, chassis: nextChassis };
}

/**
 * Embed `voxels` into a chassis. Pure; returns a new chassis.
 */
export function embedVoxelsIntoChassis(
  chassis: UnitChassis,
  voxels: VoxelMap,
): UnitChassis {
  if (voxels.size === 0) {
    if (chassis.voxel_data === undefined) return chassis;
    // Drop the field entirely when no voxels are present.
    const { voxel_data: _omit, ...rest } = chassis;
    void _omit;
    return rest;
  }
  const grid: VoxelGrid = serialize(voxels);
  return { ...chassis, voxel_data: grid };
}

/**
 * Extract a runtime `VoxelMap` from a loaded unit's chassis.voxel_data.
 * Returns an empty map if the unit has no voxel chassis.
 *
 * Throws via `deserialize` if `voxel_data` is present but not a valid
 * sparse_grid_v1 payload — the caller (the loader) should catch and
 * surface as a validation error.
 */
export function extractVoxelsFromUnit(unit: UnitSchematic): VoxelMap {
  const grid = unit.chassis.voxel_data;
  if (!grid) return new Map<string, never>() as VoxelMap;
  return deserialize(grid);
}
