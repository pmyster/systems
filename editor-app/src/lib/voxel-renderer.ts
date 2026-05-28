/**
 * Three.js mesh builder for a unit's voxel chassis.
 *
 * Lifted from tools/battlefield-viewer/index.html lines 323-397
 * (`createVoxelMesh`). Same algorithm, with typed inputs and one
 * extra entry point (`buildSelectionRing`) lifted from lines 399-408.
 *
 * Both the Voxel Sculptor (when it wants to show a faction-colored
 * preview) and the Battlefield Preview call this function. There is
 * exactly one rendering implementation; do not duplicate it inside
 * either component.
 *
 * Per the lift map, we keep the prototype's instanced-mesh approach —
 * one InstancedMesh per color/material bucket, recentered onto its
 * bounding box.
 *
 * Pure function: takes data, returns a brand-new THREE.Group. Does not
 * mount it anywhere; the caller adds it to the scene. The returned
 * group's children are owned by the caller — disposing the group
 * (group.children.forEach(c => c.geometry?.dispose() && c.material?.dispose()))
 * is the caller's responsibility on unmount.
 */

import * as THREE from "three";

import { VOXEL_SCALE } from "./constants";
import { getFactionPalette, type FactionPalette } from "./factions";
import type { Faction, UnitMeta } from "../types/unit";
import type { VoxelGrid, VoxelMaterialSpec } from "../types/voxel";

// ---------------------------------------------------------------------------
// Options.
// ---------------------------------------------------------------------------

export interface BuildUnitMeshOptions {
  /** Optional unit meta attached to userData (used for picking + HUD). */
  readonly meta?: UnitMeta;
  /**
   * Re-center the group on its bounding box (default true). The
   * battlefield viewer uses this so the unit drops on its centroid.
   * The sculptor's faction-color preview may prefer to leave the
   * geometry at grid origin to match the un-rendered cursor.
   */
  readonly recenter?: boolean;
  /**
   * Per-cell edge length in world units. Defaults to VOXEL_SCALE.
   * Exposed so a future "zoom factor" or external scaling can be
   * applied without touching cell geometry.
   */
  readonly cellSize?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** Resolve a sparse_grid material spec into a renderer color. */
function resolveColor(spec: VoxelMaterialSpec | undefined, palette: FactionPalette): number {
  if (!spec) return 0xaaaaaa;
  switch (spec.color_class) {
    case "team-primary":
      return palette.primary;
    case "team-secondary":
      return palette.secondary;
    case "team-accent":
      return palette.accent;
    case "fixed":
    default:
      if (spec.color_hex) {
        return parseInt(spec.color_hex.replace("#", ""), 16);
      }
      return 0xaaaaaa;
  }
}

interface Bucket {
  readonly color: number;
  readonly matId: string;
  readonly positions: Array<readonly [number, number, number]>;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Build a renderable group for one unit. Returns a THREE.Group with
 * one InstancedMesh child per color/material bucket.
 *
 * The group's `userData` carries:
 *   - `isUnit: true`
 *   - `faction`, `voxelData`, `meta`
 *   - `target: null` and `speed` (for unit-movement preview tick)
 *   - `selected: false`
 */
export function buildUnitMesh(
  voxelData: VoxelGrid,
  faction: Faction,
  opts: BuildUnitMeshOptions = {},
): THREE.Group {
  const { meta, recenter = true, cellSize = VOXEL_SCALE } = opts;
  const group = new THREE.Group();
  const palette = getFactionPalette(faction);
  const materials = voxelData.materials ?? {};

  // Bucket voxels by (color, material id).
  const byColor = new Map<string, Bucket>();
  for (const [x, y, z, matId] of voxelData.voxels) {
    const spec = materials[matId];
    const color = resolveColor(spec, palette);
    const k = `${color}_${matId}`;
    let bucket = byColor.get(k);
    if (!bucket) {
      bucket = { color, matId, positions: [] };
      byColor.set(k, bucket);
    }
    bucket.positions.push([x, y, z]);
  }

  // Build one InstancedMesh per bucket.
  const cubeGeom = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
  const dummy = new THREE.Object3D();
  for (const { color, matId, positions } of byColor.values()) {
    const isEngine = matId === "engine";
    const isHardpoint = matId === "hardpoint";
    const isGlass = matId === "glass";
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: isGlass ? 0.2 : matId === "armor" ? 0.55 : 0.75,
      metalness: matId === "armor" ? 0.4 : matId === "hull" ? 0.2 : 0.1,
      transparent: isGlass,
      opacity: isGlass ? 0.6 : 1.0,
      emissive: isEngine ? 0x551a0c : isHardpoint ? 0x4a3a1c : 0x000000,
      emissiveIntensity: isEngine ? 0.7 : isHardpoint ? 0.5 : 0,
    });
    const inst = new THREE.InstancedMesh(cubeGeom, mat, positions.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    positions.forEach(([x, y, z], i) => {
      dummy.position.set(x * cellSize, y * cellSize, z * cellSize);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // Re-center on bounding box (so the group's origin sits at the
  // centroid in XZ and the bottom in Y — easier to drop on terrain).
  if (recenter && group.children.length > 0) {
    const box = new THREE.Box3().setFromObject(group);
    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    const baseY = box.min.y;
    const tmp = new THREE.Object3D();
    for (const child of group.children) {
      if (!(child instanceof THREE.InstancedMesh)) continue;
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, tmp.matrix);
        tmp.matrix.decompose(tmp.position, tmp.quaternion, tmp.scale);
        tmp.position.x -= centerX;
        tmp.position.z -= centerZ;
        tmp.position.y -= baseY;
        tmp.updateMatrix();
        child.setMatrixAt(i, tmp.matrix);
      }
      child.instanceMatrix.needsUpdate = true;
    }
  }

  group.userData = {
    isUnit: true,
    faction,
    voxelData,
    meta: meta ?? {},
    target: null,
    speed: 6, // default walk speed for the preview tick; tune later.
    selected: false,
  };
  return group;
}

/**
 * Selection ring used by the battlefield preview when a unit is the
 * active edit subject. Lifted from
 * tools/battlefield-viewer/index.html lines 399-408.
 */
export function buildSelectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.0, 32),
    new THREE.MeshBasicMaterial({
      color: 0xc9a55c,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  return ring;
}

/**
 * Dispose all GPU resources owned by a unit group. Call on unmount
 * before removing the group from the scene to avoid leaks.
 *
 * `buildUnitMesh` reuses a single shared `BoxGeometry` across every
 * InstancedMesh child, so a naive `node.geometry.dispose()` per
 * traversal would call dispose on the same buffer N times. Three.js's
 * dispose IS idempotent, but the redundant work (and the redundant
 * `dispose` event dispatch) is wasteful — we track unique geometries
 * and unique materials in Sets and dispose each exactly once.
 */
export function disposeUnitMesh(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  group.traverse((node) => {
    if (
      node instanceof THREE.InstancedMesh ||
      node instanceof THREE.Mesh
    ) {
      geometries.add(node.geometry);
      const mat = node.material;
      if (Array.isArray(mat)) {
        for (const m of mat) materials.add(m);
      } else {
        materials.add(mat);
      }
    }
  });

  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}
