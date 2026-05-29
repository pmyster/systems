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
import {
  applySkin,
  deepCloneGroup,
  removeSkin,
  type AppliedSkin,
} from "../MeshWorkspace/box-projection";
import type { UnitSchematic } from "../../types";

import type { TerrainHandle } from "./terrain";

/**
 * Target footprint (largest dimension, meters) for a mesh-first unit dropped
 * on the battlefield. Mesh sources arrive in arbitrary units, so we normalise
 * the largest bbox dimension to this size before anchoring.
 */
const TARGET_UNIT_SIZE_M = 8;

/** Handle for the preview's "active unit" slot. */
export interface UnitOnTerrainHandle {
  /** Parent group anchored to the unit's world position on terrain. */
  readonly parent: THREE.Group;
  /**
   * The currently mounted unit mesh, or null when the active unit is
   * empty (no voxel data).
   */
  current: THREE.Group | null;
  /** Replace the active unit (voxel fallback). Disposes the previous mount first. */
  setUnit(unit: UnitSchematic): void;
  /**
   * Mount a mesh-first unit: a deep clone of `meshSource` (independent
   * geometry + materials), recentred + scaled + anchored on the terrain, and
   * optionally wrapped with a box-projected `skinImage`. Passing a null
   * `meshSource` clears the slot (terrain stays visible). Clears any prior
   * mount (voxel or mesh) first — one slot, one visible thing.
   */
  setMeshUnit(meshSource: THREE.Group | null, skinImage: HTMLImageElement | null): void;
  /** Tear down all GPU resources owned by the slot. */
  dispose(): void;
}

/**
 * Dispose all geometries + materials owned by a deep-cloned mesh group, then
 * detach it from its parent. Only call on clones this module created — never
 * on the master mesh owned by MeshWorkspace.
 */
function disposeMeshClone(clone: THREE.Group): void {
  clone.traverse((node: THREE.Object3D) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node.geometry && typeof node.geometry.dispose === "function") {
      node.geometry.dispose();
    }
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      // Defensive: a material reference can be left in a non-disposable
      // state (e.g. a userData blob restored after a hot-reload). Never let
      // a bad material crash the whole teardown.
      if (mat && typeof (mat as THREE.Material).dispose === "function") {
        (mat as THREE.Material).dispose();
      }
    }
  });
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

  // Mesh-first mode bookkeeping. At most one of `handle.current` (voxel) or
  // `currentMeshClone` (mesh) is mounted at a time — clearMounted enforces it.
  let currentMeshClone: THREE.Group | null = null;
  let currentSkin: AppliedSkin | null = null;

  /**
   * Tear down whatever is currently mounted — voxel mesh OR mesh clone (+ its
   * skin) — leaving the parent empty. The single teardown path used by
   * setUnit, setMeshUnit, and dispose so no mode leaks across a swap.
   */
  function clearMounted(): void {
    if (handle.current) {
      parent.remove(handle.current);
      disposeUnitMesh(handle.current);
      handle.current = null;
    }
    if (currentMeshClone) {
      removeSkin(currentMeshClone, currentSkin);
      currentSkin = null;
      parent.remove(currentMeshClone);
      disposeMeshClone(currentMeshClone);
      currentMeshClone = null;
    }
  }

  const handle: UnitOnTerrainHandle = {
    parent,
    current: null,
    setUnit(next: UnitSchematic) {
      clearMounted();
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
    setMeshUnit(meshSource: THREE.Group | null, skinImage: HTMLImageElement | null) {
      clearMounted();
      if (meshSource === null) {
        // No mesh: leave the slot empty; terrain stays visible.
        return;
      }

      // Independent deep clone — the master mesh is parented to the left-pane
      // scene and must never be re-parented or disposed from here.
      const cloneGroup = deepCloneGroup(meshSource);

      // Scale so the largest bbox dimension hits the target battlefield size.
      const preBox = new THREE.Box3().setFromObject(cloneGroup);
      const preSize = preBox.getSize(new THREE.Vector3());
      const maxDim = Math.max(preSize.x, preSize.y, preSize.z);
      const s = TARGET_UNIT_SIZE_M / Math.max(maxDim, 1e-4);
      cloneGroup.scale.setScalar(s);

      // Recompute the post-scale bbox, then offset so the group is centred on
      // XZ and its base (min.y) rests at y=0 within the terrain-anchored parent.
      const postBox = new THREE.Box3().setFromObject(cloneGroup);
      const center = postBox.getCenter(new THREE.Vector3());
      cloneGroup.position.x -= center.x;
      cloneGroup.position.z -= center.z;
      cloneGroup.position.y -= postBox.min.y;

      // Parent FIRST, refresh world matrices, THEN skin. The box-projection
      // shader samples by WORLD position, so applySkin's bounding box must be
      // measured after the clone inherits the terrain anchor's offset (~map
      // centre). Skinning before parenting measures the box at the origin, and
      // the projection then slides off into edge-clamp streaks once the anchor
      // shifts the mesh. (The left-pane MeshViewer is immune only because its
      // mesh sits near the origin.)
      parent.add(cloneGroup);
      parent.updateMatrixWorld(true);
      currentSkin = skinImage !== null ? applySkin(cloneGroup, skinImage) : null;
      currentMeshClone = cloneGroup;
    },
    dispose() {
      clearMounted();
      scene.remove(parent);
    },
  };

  // Initial mount.
  handle.setUnit(unit);
  return handle;
}
