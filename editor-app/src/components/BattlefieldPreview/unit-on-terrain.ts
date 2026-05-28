/**
 * Compose a unit mesh (from the shared voxel renderer) with the
 * Battlefield Preview's terrain.
 *
 * Responsibilities:
 *   - Build the unit mesh via `buildUnitMesh` from the shared lib.
 *   - Drop it on the terrain's centre at the surface height.
 *   - Provide a tear-down path that disposes the mesh's GPU
 *     resources via `disposeUnitMesh`.
 *
 * This module never mutates the unit Schematic — per the brief, the
 * preview is a pure visualiser.
 *
 * The unit is mounted under a parent group so changing the active
 * unit only swaps the parent's single child, leaving the rest of the
 * scene undisturbed. The parent group also receives the position
 * (terrain-anchored), so the swap doesn't have to re-query the
 * heightmap unless the centre point changes.
 */

import * as THREE from "three";

import {
  MAP_SIZE_M,
  buildUnitMesh,
  disposeUnitMesh,
} from "../../lib";
import type { UnitSchematic } from "../../types";

import type { TerrainHandle } from "./terrain";

/** Handle for the preview's "active unit" slot. */
export interface UnitOnTerrainHandle {
  /** Parent group anchored to the unit's world position on terrain. */
  readonly parent: THREE.Group;
  /**
   * The currently mounted unit mesh, or null when the active unit is
   * empty (no voxel data).
   */
  current: THREE.Group | null;
  /** Replace the active unit. Disposes the previous mesh first. */
  setUnit(unit: UnitSchematic): void;
  /** Tear down all GPU resources owned by the slot. */
  dispose(): void;
}

/**
 * Anchor the slot at the map centre's surface height. The unit
 * group's pivot is at its bounding-box centre (XZ) and base (Y) — see
 * `buildUnitMesh` recentre logic — so positioning the parent at the
 * terrain height lands the unit's feet on the surface.
 */
function anchorPosition(terrain: TerrainHandle): THREE.Vector3 {
  const cx = MAP_SIZE_M / 2;
  const cz = MAP_SIZE_M / 2;
  return new THREE.Vector3(cx, terrain.getHeight(cx, cz), cz);
}

/**
 * Build the slot, mount any voxel data the unit ships with, and attach
 * the parent group to the scene. The returned handle is the only legal
 * way to swap or dispose the unit.
 */
export function createUnitOnTerrain(
  scene: THREE.Scene,
  terrain: TerrainHandle,
  unit: UnitSchematic,
): UnitOnTerrainHandle {
  const parent = new THREE.Group();
  parent.name = "BattlefieldUnitSlot";
  const anchor = anchorPosition(terrain);
  parent.position.copy(anchor);
  scene.add(parent);

  const handle: UnitOnTerrainHandle = {
    parent,
    current: null,
    setUnit(next: UnitSchematic) {
      if (handle.current) {
        parent.remove(handle.current);
        disposeUnitMesh(handle.current);
        handle.current = null;
      }
      const voxels = next.chassis.voxel_data;
      if (!voxels || voxels.voxels.length === 0) {
        // Empty unit: nothing to render. The terrain still shows so
        // the operator sees the preview is "live" and waiting on data.
        return;
      }
      const faction = next.faction ?? "neutral";
      const mesh = buildUnitMesh(voxels, faction, {
        meta: {
          kind: next.kind,
          id: next.id,
          physics_version: next.physics_version,
          name: next.name,
          faction: next.faction,
          description: next.description,
          designer: next.designer,
        },
      });
      parent.add(mesh);
      handle.current = mesh;
    },
    dispose() {
      if (handle.current) {
        parent.remove(handle.current);
        disposeUnitMesh(handle.current);
        handle.current = null;
      }
      scene.remove(parent);
    },
  };

  // Initial mount.
  handle.setUnit(unit);
  return handle;
}
