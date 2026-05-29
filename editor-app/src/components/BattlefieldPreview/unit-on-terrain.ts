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
import type { RigEntry, UnitSchematic } from "../../types";

import type { TerrainHandle } from "./terrain";

/**
 * Target footprint (largest dimension, meters) for a mesh-first unit dropped
 * on the battlefield. Mesh sources arrive in arbitrary units, so we normalise
 * the largest bbox dimension to this size before anchoring.
 */
const TARGET_UNIT_SIZE_M = 8;

/** Default sweep rate (deg/s) when a reactive rig omits `rate_dps`. */
const DEFAULT_YAW_RATE_DPS = 30;
const DEFAULT_PITCH_RATE_DPS = 15;

/**
 * Per-node animation state for a reactive rig. Drives a ping-pong sweep of the
 * authored yaw/pitch arcs on the mesh clone, layered on top of the node's
 * captured rest pose (`baseQuat`) so authoring offsets survive.
 */
interface RigAnimator {
  readonly node: THREE.Object3D;
  /** Node's local quaternion at mount time — the rest pose to compose against. */
  readonly baseQuat: THREE.Quaternion;
  /** Node's local position at mount time (parent space) — the orbit start point. */
  readonly basePos: THREE.Vector3;
  /**
   * Pivot the node rotates about, in PARENT-local space (the node's bbox
   * centre by default). Rotating about this instead of the node's local
   * origin keeps the part spinning in place rather than orbiting (0,0,0).
   */
  readonly pivot: THREE.Vector3;
  readonly yaw: {
    readonly minDeg: number;
    readonly maxDeg: number;
    readonly rateDps: number;
    readonly invert: boolean;
  } | null;
  readonly pitch: {
    readonly minDeg: number;
    readonly maxDeg: number;
    readonly rateDps: number;
    readonly invert: boolean;
  } | null;
  /** Current sweep angles (deg) + travel direction (+1/-1). */
  yawAngle: number;
  yawDir: number;
  pitchAngle: number;
  pitchDir: number;
}

/**
 * A flat translucent sector laid on the ground, centred at the unit footprint,
 * spanning a reactive rig's yaw min→max so the operator can see the arc the
 * turret sweeps. Added under the terrain-anchored parent (not the scaled
 * clone) so it stays in true world units.
 */
function makeYawFan(minDeg: number, maxDeg: number, radius: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const a0 = THREE.MathUtils.degToRad(minDeg);
  const a1 = THREE.MathUtils.degToRad(maxDeg);
  const seg = 32;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    shape.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  shape.lineTo(0, 0);
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xc9a55c,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // lay flat on the ground (XZ plane)
  mesh.position.y = 0.05; // just above the terrain anchor
  return mesh;
}

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
  setMeshUnit(
    meshSource: THREE.Group | null,
    skinImage: HTMLImageElement | null,
    rig: readonly RigEntry[],
  ): void;
  /** Advance rig animations (reactive yaw/pitch ping-pong). Call once per frame. */
  tickRig(dt: number): void;
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

  // Reactive-rig animation state for the current mesh clone. Empty when the
  // mounted unit has no reactive rigs (tickRig then no-ops). Yaw fans are
  // tracked separately so they can be detached + GPU-disposed on a swap.
  let rigAnimators: RigAnimator[] = [];
  let yawFans: THREE.Mesh[] = [];

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
    // Drop rig state and tear down any yaw fans (own geometry + material).
    rigAnimators = [];
    for (const fan of yawFans) {
      parent.remove(fan);
      fan.geometry.dispose();
      const mats = Array.isArray(fan.material) ? fan.material : [fan.material];
      for (const mat of mats) mat.dispose();
    }
    yawFans = [];
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
    setMeshUnit(
      meshSource: THREE.Group | null,
      skinImage: HTMLImageElement | null,
      rig: readonly RigEntry[],
    ) {
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

      // Build a map of rig id -> its node in the clone, so parent_rig can
      // re-attach flat parts into a hierarchy (the body's swivel then carries
      // its followers via the scene graph; the barrel adds its own pitch on top).
      const nodeByRigId = new Map<string, THREE.Object3D>();
      for (const entry of rig) {
        let n: THREE.Object3D | null = null;
        cloneGroup.traverse((o) => {
          if (o.name === entry.target_node) n = o;
        });
        if (n !== null) nodeByRigId.set(entry.id, n);
      }
      // Re-parent each child under its parent_rig's node. THREE's attach()
      // preserves world transform, so the parts don't jump. Guard self,
      // missing nodes, and cycles (skip if the prospective parent is a
      // descendant of the child — that would create a degenerate graph).
      for (const entry of rig) {
        if (!entry.parent_rig) continue;
        const child = nodeByRigId.get(entry.id);
        const parentNode = nodeByRigId.get(entry.parent_rig);
        if (!child || !parentNode || child === parentNode) continue;
        // Cycle guard: walk parentNode's ancestor chain; if we reach child,
        // attaching would loop the graph back on itself — skip it.
        let ancestor: THREE.Object3D | null = parentNode.parent;
        let wouldCycle = false;
        while (ancestor !== null) {
          if (ancestor === child) {
            wouldCycle = true;
            break;
          }
          ancestor = ancestor.parent;
        }
        if (wouldCycle) continue;
        parentNode.attach(child);
      }
      cloneGroup.updateMatrixWorld(true);

      // Build reactive-rig animators + their ground fans. Reactive rigs sweep
      // on their own; passive/active rigs are driven elsewhere (or not at all)
      // and are intentionally skipped here.
      const fanRadius = TARGET_UNIT_SIZE_M * 0.9;
      for (const entry of rig) {
        if (entry.motion !== "reactive") continue;
        if (!entry.yaw && !entry.pitch) continue;

        let node: THREE.Object3D | null = null;
        cloneGroup.traverse((n: THREE.Object3D) => {
          if (n.name === entry.target_node) node = n;
        });
        if (node === null) continue;
        const targetNode: THREE.Object3D = node;

        const yawState =
          entry.yaw != null
            ? {
                minDeg: entry.yaw.min_deg,
                maxDeg: entry.yaw.max_deg,
                rateDps: entry.yaw.rate_dps ?? DEFAULT_YAW_RATE_DPS,
                invert: entry.yaw.invert ?? false,
              }
            : null;
        const pitchState =
          entry.pitch != null
            ? {
                minDeg: entry.pitch.min_deg,
                maxDeg: entry.pitch.max_deg,
                rateDps: entry.pitch.rate_dps ?? DEFAULT_PITCH_RATE_DPS,
                invert: entry.pitch.invert ?? false,
              }
            : null;

        // Pivot = the node's OWN geometry centre, in its PARENT's local space
        // (same space as node.position). Use the node's own geometry, NOT
        // setFromObject(node): once parent_rig re-attaches followers, that
        // would include all the children and place the pivot at the whole
        // assembly's centre — making the part orbit a far point instead of
        // spinning in place. geometry.boundingBox is in node-local space;
        // node.matrix (local→parent) maps its centre into parent space.
        let pivotLocal: THREE.Vector3;
        if (targetNode instanceof THREE.Mesh && targetNode.geometry) {
          targetNode.geometry.computeBoundingBox();
          const bb = targetNode.geometry.boundingBox;
          if (bb) {
            targetNode.updateMatrix();
            pivotLocal = bb
              .getCenter(new THREE.Vector3())
              .applyMatrix4(targetNode.matrix);
          } else {
            pivotLocal = targetNode.position.clone();
          }
        } else {
          // Group / no geometry: fall back to the node's own origin.
          pivotLocal = targetNode.position.clone();
        }

        rigAnimators.push({
          node: targetNode,
          baseQuat: targetNode.quaternion.clone(),
          basePos: targetNode.position.clone(),
          pivot: pivotLocal,
          yaw: yawState,
          pitch: pitchState,
          yawAngle: yawState ? (yawState.minDeg + yawState.maxDeg) / 2 : 0,
          yawDir: 1,
          pitchAngle: pitchState ? (pitchState.minDeg + pitchState.maxDeg) / 2 : 0,
          pitchDir: 1,
        });

        if (yawState) {
          const fan = makeYawFan(yawState.minDeg, yawState.maxDeg, fanRadius);
          parent.add(fan);
          yawFans.push(fan);
        }
      }
    },
    tickRig(dt: number) {
      if (rigAnimators.length === 0) return; // no-op when nothing is rigged
      const up = new THREE.Vector3(0, 1, 0);
      // Lateral is -X so that POSITIVE pitch elevates the barrel (up) — the
      // intuitive convention. Pitch direction is ultimately model-dependent
      // (barrels are authored facing different ways); a model that elevates
      // the wrong way can be corrected with a negative pitch range.
      const lateral = new THREE.Vector3(-1, 0, 0);
      for (const a of rigAnimators) {
        if (a.yaw) {
          a.yawAngle += a.yawDir * a.yaw.rateDps * dt;
          if (a.yawAngle >= a.yaw.maxDeg) {
            a.yawAngle = a.yaw.maxDeg;
            a.yawDir = -1;
          } else if (a.yawAngle <= a.yaw.minDeg) {
            a.yawAngle = a.yaw.minDeg;
            a.yawDir = 1;
          }
        }
        if (a.pitch) {
          a.pitchAngle += a.pitchDir * a.pitch.rateDps * dt;
          if (a.pitchAngle >= a.pitch.maxDeg) {
            a.pitchAngle = a.pitch.maxDeg;
            a.pitchDir = -1;
          } else if (a.pitchAngle <= a.pitch.minDeg) {
            a.pitchAngle = a.pitch.minDeg;
            a.pitchDir = 1;
          }
        }
        // Build the combined rotation in PARENT space (yaw about up, pitch
        // about lateral), then RIGIDLY rotate the node about its pivot:
        //   newPos  = pivot + rot · (basePos − pivot)
        //   newQuat = rot · baseQuat
        // Rotating the position too (not just the orientation) is what keeps
        // the part spinning in place instead of orbiting the model origin.
        // The ping-pong above sweeps yawAngle/pitchAngle through the authored
        // positive ranges; `invert` flips the SIGN of the angle fed into the
        // rotation so a model authored facing the opposite way reverses without
        // needing negative ranges. Layered on top of the lateral = (-1,0,0)
        // convention, never replacing it.
        const yawSign = a.yaw?.invert ? -1 : 1;
        const pitchSign = a.pitch?.invert ? -1 : 1;
        const yawQ = new THREE.Quaternion().setFromAxisAngle(
          up,
          THREE.MathUtils.degToRad(a.yawAngle * yawSign),
        );
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(
          lateral,
          THREE.MathUtils.degToRad(a.pitchAngle * pitchSign),
        );
        const rot = yawQ.clone().multiply(pitchQ);
        const offset = a.basePos.clone().sub(a.pivot).applyQuaternion(rot);
        a.node.position.copy(a.pivot).add(offset);
        a.node.quaternion.copy(rot).multiply(a.baseQuat);
      }
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
