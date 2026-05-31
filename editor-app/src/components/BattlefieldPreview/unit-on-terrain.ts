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
import type { MeshHardpoint, MuzzleForwardAxis, RigEntry, UnitSchematic } from "../../types";

import type { TerrainHandle } from "./terrain";

/**
 * Target footprint (largest dimension, meters) for a mesh-first unit dropped
 * on the battlefield. Mesh sources arrive in arbitrary units, so we normalise
 * the largest bbox dimension to this size before anchoring.
 */
const TARGET_UNIT_SIZE_M = 8;

// ---------------------------------------------------------------------------
// Debug instrumentation: rotation-chain visibility.
// We need to see EXACTLY where the rotation chain breaks between the rig
// animation and the hardpoint's world transform. The eulerDeg helper is a
// tiny throwaway that converts a Quaternion to a `[x, y, z]` Euler-XYZ
// triple in degrees, formatted to 1 decimal place. The throttle map keeps
// per-rig tick logs from flooding the console — only log when at least one
// Euler axis has moved more than 0.1° since the previous logged frame.
// ---------------------------------------------------------------------------
const scratchEuler = new THREE.Euler();
function eulerDeg(quat: THREE.Quaternion): string[] {
  scratchEuler.setFromQuaternion(quat, "XYZ");
  return [
    ((scratchEuler.x * 180) / Math.PI).toFixed(1),
    ((scratchEuler.y * 180) / Math.PI).toFixed(1),
    ((scratchEuler.z * 180) / Math.PI).toFixed(1),
  ];
}
const rigTickLastLoggedEuler = new Map<string, [number, number, number]>();

/** Default sweep rate (deg/s) when a reactive rig omits `rate_dps`. */
const DEFAULT_YAW_RATE_DPS = 30;
const DEFAULT_PITCH_RATE_DPS = 15;
/** Default auto-aim slew rate (deg/s) when a reactive muzzle rig omits `rate_dps`. */
const DEFAULT_AIM_RATE_DPS = 360;

// ---------------------------------------------------------------------------
// Scratch allocations for the per-frame auto-aim path. Declared at module
// scope and REUSED every frame to avoid GC churn during the render loop —
// the rig tick runs at ~60Hz with multiple rigs per unit, so even small
// per-frame allocations compound into visible jank.
// ---------------------------------------------------------------------------
const scratchParentQuat = new THREE.Quaternion();
const scratchParentQuatInv = new THREE.Quaternion();
const scratchMuzzlePos = new THREE.Vector3();
const scratchDirWorld = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchAimUp = new THREE.Vector3(0, 1, 0);
const scratchAimLateral = new THREE.Vector3(-1, 0, 0);
const scratchYawQ = new THREE.Quaternion();
const scratchPitchQ = new THREE.Quaternion();
const scratchRot = new THREE.Quaternion();
const scratchOffset = new THREE.Vector3();

/**
 * Precomputed quaternions that rotate the chosen muzzle-forward axis to +Z.
 * Applying one of these to a vector in the rig's local frame normalises the
 * "forward" axis to +Z so we can extract yaw = atan2(x, z), pitch = atan2(y, hyp).
 * Built once at module init — never reallocated.
 */
const FORWARD_TO_Z: Record<MuzzleForwardAxis, THREE.Quaternion> = {
  "+z": new THREE.Quaternion(),
  "-z": new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
  "+x": new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  "-x": new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  "+y": new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  "-y": new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
};

/**
 * One-time-per-rig warning bookkeeping. The Set holds rig animators we've
 * already warned about so a degenerate rig (e.g. parent node missing) doesn't
 * spam the console every frame. Cleared implicitly when the unit is swapped —
 * animators are garbage-collected with the old clone, freeing the WeakSet
 * entries.
 */
const aimWarnedRigs = new WeakSet<RigAnimator>();

/** Shortest signed-angle delta from `from` to `to` (radians), wrapping ±π. */
function shortestAngleDeltaRad(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Per-node animation state for a reactive rig. Drives a ping-pong sweep of the
 * authored yaw/pitch arcs on the mesh clone, layered on top of the node's
 * captured rest pose (`baseQuat`) so authoring offsets survive.
 */
interface RigAnimator {
  /** Rig id from the schematic — surfaced in warnings, identity for the WeakSet. */
  readonly rigId: string;
  /**
   * Authored parent_rig id (or null if none). Used by auto-aim to walk UP
   * the rig chain from a muzzle to its yaw-bearing and pitch-bearing
   * ancestors — the parent of the bearer in turn defines the local frame
   * the desired angle is measured in.
   */
  readonly parentRigId: string | null;
  readonly node: THREE.Object3D;
  /**
   * Auto-aim parent: the node whose world quaternion defines the rig's
   * parent-local frame for muzzle aiming. Resolved at mount time from
   * `rig.parent_rig` (if set and present) or the mounted root otherwise.
   * Null only when neither could be resolved — auto-aim then no-ops and
   * we warn once.
   */
  readonly aimParent: THREE.Object3D | null;
  /** Local axis on the rig node that points OUT of the barrel. Default "+z". */
  readonly muzzleForward: MuzzleForwardAxis;
  /** True when the rig is `motion === "reactive"` AND `muzzle === true`. */
  readonly isReactiveMuzzle: boolean;
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
  /**
   * Per-frame auto-aim plan, written by the PLAN pass of tickRig when this
   * animator is a yaw/pitch bearer for some reactive-muzzle rig in the
   * unit. Read + cleared by the APPLY pass. Null/undefined means "no aim
   * for this rig this frame — run default ping-pong instead."
   *
   * Stored in RADIANS to avoid round-tripping deg↔rad during the slew.
   * Already clamped to the bearer's authored arc and `invert`-adjusted.
   */
  aimDesiredYawRad: number | null;
  aimDesiredPitchRad: number | null;
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
    hardpoints?: readonly MeshHardpoint[],
    chassisScale?: number,
    chassisLengthM?: number,
  ): void;
  /** Advance rig animations (reactive yaw/pitch ping-pong). Call once per frame. */
  tickRig(dt: number): void;
  /**
   * Set the world-space aim target for reactive muzzle rigs. When set,
   * reactive rigs with `muzzle === true` slew their yaw/pitch toward the
   * target each frame, clamped to authored arcs at the authored `rate_dps`.
   * Pass null to clear — the rig then resumes its default ping-pong sweep.
   */
  setAimTarget(target: readonly [number, number, number] | null): void;
  /**
   * Synchronously snap every reactive muzzle rig to the CURRENT aim target
   * (computed in the same way as `tickRig`), bypassing the rate-limited
   * slew. Used by Fire so the first projectile spawns from the on-target
   * pose without a one-frame visual lag. No-op when no aim target is set
   * or when no reactive muzzle rigs are mounted.
   */
  snapAimToTarget(): void;
  /**
   * Compute the Fire-Test muzzle AIM — spawn position AND firing direction —
   * in world space. Two paths:
   *
   *   - `rig`: if the unit declares a rig with `muzzle === true` AND its
   *     `target_node` resolves to a live node in the mounted mesh, the
   *     spawn is the node's animated world position and the direction is
   *     the node's local `muzzle_forward` axis transformed to world space.
   *     Rotating the turret aims the future shot.
   *
   *   - `bbox`: legacy fallback — spawn = top-front of the mounted unit's
   *     bbox, direction = south (-Z). Used when no muzzle rig is declared,
   *     when the muzzle rig's node isn't in the mesh (a console warning is
   *     emitted), or when the mesh has no usable bbox.
   *
   * Returns null only when nothing at all is mounted under the slot.
   * Callers fall back to a fixed spawn AND log a warning, so a silent drop
   * never goes unseen.
   */
  getMuzzleAim(unit: UnitSchematic): MuzzleAim | null;
  /**
   * Compute the Fire-Test aim from a specific named hardpoint. Returns
   * the hardpoint's world position and world +Z direction (Three.js
   * `getWorldDirection()` convention). Returns null if no hardpoint with
   * that id is currently mounted; the first lookup of an unknown id logs
   * a one-time warning so a stale request doesn't go silently unseen.
   */
  getHardpointAim(id: string): MuzzleAim | null;
  /** List the ids of all hardpoints currently mounted on this unit. */
  listHardpointIds(): string[];
  /**
   * Re-synchronise the mounted hardpoint Object3Ds against the document.
   *
   * Hardpoint Object3Ds are mounted once per unit (see setMeshUnit /
   * setUnit), but the user can edit their `local_position`,
   * `local_quaternion`, or `parent_rig_id` in the form at any time. Those
   * edits change `unit.hardpoints[i]` in React state but do NOT
   * re-trigger the unit's mount — so without this call the mounted
   * Object3D would drift from the document's truth and a fire test would
   * fire from stale coordinates.
   *
   * Implementation: detach every current hardpoint Object3D from the
   * scene, then re-run the full mount logic (which neutralises rig
   * parents to their rest pose, places under unit root, then
   * `attach()`-es into the rig — preserving the documented invariant).
   * Object3D refs in `hardpointsById` are replaced; callers must look
   * up by id each call (getHardpointAim does this already).
   *
   * No-op when nothing is mounted yet. Safe to call every frame, but
   * the intended trigger is a React useEffect on `unit.hardpoints`.
   */
  updateHardpointData(hardpoints: readonly MeshHardpoint[]): void;
  /** Tear down all GPU resources owned by the slot. */
  dispose(): void;
}

/**
 * Result of `getMuzzleAim`. The Fire-Test scene uses BOTH `position`
 * (where the projectile spawns) and `direction` (where it flies). The
 * `source` field is informational — useful for HUD/diagnostics so the
 * operator can see at a glance whether they're firing from a rigged
 * muzzle or the legacy bbox fallback.
 */
export interface MuzzleAim {
  /** World-space spawn position. */
  readonly position: readonly [number, number, number];
  /** World-space firing direction (unit vector). */
  readonly direction: readonly [number, number, number];
  /**
   * Provenance of this aim:
   *   - "hardpoint" — derived from a MeshHardpoint's world transform.
   *   - "rig"      — derived from a muzzle-tagged rig + muzzle_forward axis.
   *   - "bbox"     — legacy fallback (top-front of bbox, firing south).
   */
  readonly source: "hardpoint" | "rig" | "bbox";
}

/** Map a `MuzzleForwardAxis` label to its local unit vector. */
function muzzleForwardLocal(axis: MuzzleForwardAxis): THREE.Vector3 {
  switch (axis) {
    case "+x":
      return new THREE.Vector3(1, 0, 0);
    case "-x":
      return new THREE.Vector3(-1, 0, 0);
    case "+y":
      return new THREE.Vector3(0, 1, 0);
    case "-y":
      return new THREE.Vector3(0, -1, 0);
    case "+z":
      return new THREE.Vector3(0, 0, 1);
    case "-z":
      return new THREE.Vector3(0, 0, -1);
    default: {
      // Loud-over-silent: an unrecognised axis label should never reach
      // here (the type is a closed union, the Zod schema is a closed
      // enum), but if it ever did we'd rather fall through to +z and
      // surface the issue than crash.
      const _exh: never = axis;
      void _exh;
      return new THREE.Vector3(0, 0, 1);
    }
  }
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

  // World-space aim target for reactive muzzle rigs. Null = no auto-aim;
  // rigs fall back to their authored ping-pong sweep. Held as a Vector3
  // (not a tuple) so the per-frame tick can read it without re-wrapping.
  let aimTargetWorld: THREE.Vector3 | null = null;

  // ---- Hardpoint mounting ------------------------------------------------
  // Active hardpoints, keyed by id. Each is an Object3D parented under
  // either its `parent_rig_id`'s rig node (so rig animation propagates
  // through the scene graph) or under the mounted unit root when no rig
  // is specified. World transforms are read fresh per fire (the rig tick
  // refreshes matrices before we ever ask for `getWorldPosition`).
  let hardpointsById: Map<string, THREE.Object3D> = new Map();
  // Cached rig parent map + rest poses for the current mount — needed by
  // updateHardpointData() so it can re-mount individual hardpoints under
  // the same rig hierarchy without rebuilding the whole unit. Cleared by
  // clearMounted(). Read-only after setMeshUnit/setUnit completes.
  let mountedUnitRoot: THREE.Object3D | null = null;
  let mountedRigNodeById: ReadonlyMap<string, THREE.Object3D> = new Map();
  let mountedRestQuatByNode: ReadonlyMap<THREE.Object3D, THREE.Quaternion> =
    new Map();
  // One-time-per-id warning set for missing hardpoint lookups (loud-over-silent
  // without spamming the console each frame).
  const hardpointMissWarned: Set<string> = new Set();
  const scratchHpPos = new THREE.Vector3();
  const scratchHpDir = new THREE.Vector3();

  /**
   * Hierarchy-aware auto-aim plan derived from a reactive-muzzle rig.
   *
   * Real turrets put yaw on the BODY rig and pitch on the BARREL rig; the
   * MUZZLE is a leaf marker on the barrel tip with no arcs of its own. So
   * "aim the muzzle at T" means: find the lowest ancestor with a yaw arc,
   * find the lowest ancestor with a pitch arc, and write the desired angles
   * into THOSE bearers (not into the muzzle itself — the muzzle inherits
   * its world pose through the chain).
   *
   * Yaw and pitch may live on the same rig (single-axis gimbal: yawBearer
   * === pitchBearer) or on different rigs (standard turret topology). Both
   * cases fall out naturally — each bearer is solved in ITS parent's local
   * frame, independently.
   */
  interface AimPlan {
    /** Lowest ancestor (or self) carrying a yaw arc, null if none. */
    yawBearer: RigAnimator | null;
    /** Desired yaw in radians, clamped + invert-adjusted, null when yawBearer is null. */
    yawDesiredRad: number | null;
    /** Lowest ancestor (or self) carrying a pitch arc, null if none. */
    pitchBearer: RigAnimator | null;
    /** Desired pitch in radians, clamped + invert-adjusted, null when pitchBearer is null. */
    pitchDesiredRad: number | null;
  }

  /**
   * Cached id→animator lookup so the bearer walk is O(depth) instead of
   * O(rigCount × depth) per frame. Rebuilt at mount time alongside
   * `rigAnimators`.
   */
  let animatorById: Map<string, RigAnimator> = new Map();
  /**
   * Cached id→RigEntry lookup covering ALL rigs in the unit, including
   * passthrough rigs that have no animator (no arcs, no muzzle flag).
   * This is what findBearer walks — the animator map alone breaks the
   * chain at any rig that doesn't happen to be animated, which silently
   * hides bearers further upstream.
   *
   * Rebuilt at mount time; cleared by clearMounted.
   */
  let rigEntryById: Map<string, RigEntry> = new Map();
  /**
   * One-time-per-rig set tracking findBearer warnings that have already
   * been emitted, so a re-aimed frame doesn't spam the console. Distinct
   * from `aimWarnedRigs` (which tracks computeAimPlan-level warnings).
   * Cleared at mount.
   */
  const bearerArcWithoutAnimatorWarned: Set<string> = new Set();

  /**
   * Walk UP the parent_rig chain from `start`, returning the first animator
   * whose rig declares the requested axis. Returns null if no rig in the
   * chain declares the axis. The walk starts AT `start` itself — a rig
   * that is both the muzzle and its own yaw/pitch bearer (gimbal) is
   * handled.
   *
   * IMPORTANT: the walk traverses `RigEntry.parent_rig` (the schema
   * field), NOT the animator map. Passive rigs (no arcs, no muzzle flag)
   * have no animator — but they may still appear as intermediate links
   * in the chain. Walking via the animator map alone would break the
   * chain at every passthrough rig and hide bearers further upstream.
   *
   * For each rig in the walk that DECLARES the requested arc:
   *   - If it also has an animator, return that animator.
   *   - If it has the arc but no animator, surface a one-time warning
   *     (the rig has the arc data but the system never built an
   *     animator for it — likely because it's missing the muzzle flag
   *     or the reactive motion class) and continue walking. This
   *     ensures the arc-with-no-animator case is loud-over-silent.
   *
   * Returns null only when no rig with the arc exists anywhere in the
   * parent chain.
   */
  function findBearer(
    start: RigAnimator,
    axis: "yaw" | "pitch",
  ): RigAnimator | null {
    let curId: string | null = start.rigId;
    const seen = new Set<string>();
    while (curId !== null) {
      if (seen.has(curId)) return null; // cycle guard (declared chain bad)
      seen.add(curId);
      const entry: RigEntry | null = rigEntryById.get(curId) ?? null;
      if (entry === null) {
        // Loud-over-silent: a chain references a rig id that isn't in
        // the unit. The mount walk already filtered missing parent_rig
        // links, so reaching here implies a runtime mismatch.
        // eslint-disable-next-line no-console
        console.warn(
          `[FireTest auto-aim] findBearer chain reached unknown rig id ` +
            `"${curId}" while looking for ${axis} bearer — chain broken.`,
        );
        return null;
      }
      const hasArc = axis === "yaw" ? entry.yaw != null : entry.pitch != null;
      if (hasArc) {
        const anim = animatorById.get(curId) ?? null;
        if (anim !== null) {
          // Normal hit: arc declared AND animator present — we can
          // write desired angles to it.
          return anim;
        }
        // Arc declared but no animator. Warn ONCE per rig+axis and keep
        // walking — there may be another bearer further up. If there
        // isn't, the null return below surfaces the genuine "no bearer"
        // case.
        const warnKey = `${curId}:${axis}`;
        if (!bearerArcWithoutAnimatorWarned.has(warnKey)) {
          bearerArcWithoutAnimatorWarned.add(warnKey);
          // eslint-disable-next-line no-console
          console.warn(
            `[FireTest auto-aim] rig "${curId}" declares a ${axis} arc but ` +
              `has no animator (likely passive motion or no muzzle flag on ` +
              `the chain). Auto-aim cannot write to it; continuing the walk ` +
              `for an animated bearer further upstream.`,
          );
        }
      }
      // Climb to the parent. RigEntry.parent_rig is the data-driven link
      // — walk it whether or not the parent itself has an animator. This
      // is the key fix vs the old animator-map walk.
      const pid: string | undefined = entry.parent_rig;
      curId = pid !== undefined ? pid : null;
    }
    return null;
  }

  /**
   * Build the per-frame aim plan for a reactive-muzzle rig. Standard
   * turret math:
   *
   *   1. Find yaw + pitch bearers by walking up parent_rig.
   *   2. Compute world-space (target − muzzle), normalised.
   *   3. For each bearer: rotate dirWorld into the BEARER's PARENT-local
   *      frame (so the body's yaw is removed for the yaw solve; the
   *      barrel's parent — which itself contains the body — already
   *      includes the current body yaw for the pitch solve).
   *   4. Pre-rotate by FORWARD_TO_Z so the rig's authored muzzle_forward
   *      axis maps to +Z, then yaw = atan2(x, z), pitch = atan2(y, hyp).
   *   5. Apply invert + clamp.
   *
   * One pass is correct for the standard hierarchy because the pitch
   * bearer's parent's world quaternion already INCLUDES the yaw bearer's
   * current rotation — the pitch solve naturally accounts for the body
   * yaw at this frame.
   *
   * Loud-over-silent: warns ONCE per muzzle rig if either bearer is
   * missing or no aim parent is resolvable for the bearer.
   */
  function computeAimPlan(a: RigAnimator): AimPlan {
    const plan: AimPlan = {
      yawBearer: null,
      yawDesiredRad: null,
      pitchBearer: null,
      pitchDesiredRad: null,
    };
    if (aimTargetWorld === null) return plan;

    const yawBearer = findBearer(a, "yaw");
    const pitchBearer = findBearer(a, "pitch");

    if (yawBearer === null && !aimWarnedRigs.has(a)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[FireTest auto-aim] muzzle rig "${a.rigId}" has no yaw bearer in ` +
          `its parent chain — yaw aim will not move.`,
      );
    }
    if (pitchBearer === null && !aimWarnedRigs.has(a)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[FireTest auto-aim] muzzle rig "${a.rigId}" has no pitch bearer in ` +
          `its parent chain — pitch aim will not move.`,
      );
    }
    if (yawBearer === null && pitchBearer === null) {
      aimWarnedRigs.add(a);
      return plan;
    }
    aimWarnedRigs.add(a);

    // Refresh world matrices once for the muzzle + every bearer's parent
    // node we're about to read from. The muzzle's world position is the
    // RAY ORIGIN for both yaw and pitch solves (we're aiming the muzzle at
    // T, not the bearer at T — those positions differ in a 2-rig turret).
    a.node.updateMatrixWorld(true);
    a.node.getWorldPosition(scratchMuzzlePos);

    scratchDirWorld.copy(aimTargetWorld).sub(scratchMuzzlePos);
    const len2 = scratchDirWorld.lengthSq();
    if (len2 < 1e-10) return plan; // target coincides with muzzle — can't aim
    scratchDirWorld.multiplyScalar(1 / Math.sqrt(len2));

    // ----- Yaw solve --------------------------------------------------
    if (yawBearer !== null && yawBearer.yaw !== null) {
      const parentNode = yawBearer.aimParent;
      if (parentNode !== null) {
        parentNode.updateMatrixWorld(true);
        parentNode.getWorldQuaternion(scratchParentQuat);
        scratchParentQuatInv.copy(scratchParentQuat).invert();
        scratchDir.copy(scratchDirWorld).applyQuaternion(scratchParentQuatInv);
        scratchDir.applyQuaternion(FORWARD_TO_Z[a.muzzleForward]);

        let yRad = Math.atan2(scratchDir.x, scratchDir.z);
        if (yawBearer.yaw.invert) yRad = -yRad;
        const yDeg = THREE.MathUtils.clamp(
          THREE.MathUtils.radToDeg(yRad),
          yawBearer.yaw.minDeg,
          yawBearer.yaw.maxDeg,
        );
        plan.yawBearer = yawBearer;
        plan.yawDesiredRad = THREE.MathUtils.degToRad(yDeg);
      }
    }

    // ----- Pitch solve ------------------------------------------------
    if (pitchBearer !== null && pitchBearer.pitch !== null) {
      const parentNode = pitchBearer.aimParent;
      if (parentNode !== null) {
        parentNode.updateMatrixWorld(true);
        parentNode.getWorldQuaternion(scratchParentQuat);
        scratchParentQuatInv.copy(scratchParentQuat).invert();
        scratchDir.copy(scratchDirWorld).applyQuaternion(scratchParentQuatInv);
        scratchDir.applyQuaternion(FORWARD_TO_Z[a.muzzleForward]);

        let pRad = Math.atan2(
          scratchDir.y,
          Math.sqrt(scratchDir.x * scratchDir.x + scratchDir.z * scratchDir.z),
        );
        if (pitchBearer.pitch.invert) pRad = -pRad;
        const pDeg = THREE.MathUtils.clamp(
          THREE.MathUtils.radToDeg(pRad),
          pitchBearer.pitch.minDeg,
          pitchBearer.pitch.maxDeg,
        );
        plan.pitchBearer = pitchBearer;
        plan.pitchDesiredRad = THREE.MathUtils.degToRad(pDeg);
      }
    }

    return plan;
  }

  /**
   * Apply the animator's current yawAngle / pitchAngle to the rig node's
   * local pose, composed against the captured rest pose and rotated about
   * the authored pivot. Shared by both branches of tickRig (ping-pong and
   * auto-aim) so the rest-pose composition stays identical.
   */
  function applyRigPose(a: RigAnimator): void {
    const yawSign = a.yaw?.invert ? -1 : 1;
    const pitchSign = a.pitch?.invert ? -1 : 1;
    scratchYawQ.setFromAxisAngle(
      scratchAimUp,
      THREE.MathUtils.degToRad(a.yawAngle * yawSign),
    );
    scratchPitchQ.setFromAxisAngle(
      scratchAimLateral,
      THREE.MathUtils.degToRad(a.pitchAngle * pitchSign),
    );
    scratchRot.copy(scratchYawQ).multiply(scratchPitchQ);
    scratchOffset.copy(a.basePos).sub(a.pivot).applyQuaternion(scratchRot);
    a.node.position.copy(a.pivot).add(scratchOffset);
    a.node.quaternion.copy(scratchRot).multiply(a.baseQuat);
  }

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
    // Aim target is cleared with the unit swap — the caller (BattlefieldPreview)
    // re-pushes a fresh target after the new unit mounts.
    aimTargetWorld = null;
    rigAnimators = [];
    animatorById = new Map();
    rigEntryById = new Map();
    bearerArcWithoutAnimatorWarned.clear();
    for (const fan of yawFans) {
      parent.remove(fan);
      fan.geometry.dispose();
      const mats = Array.isArray(fan.material) ? fan.material : [fan.material];
      for (const mat of mats) mat.dispose();
    }
    yawFans = [];
    // Detach every hardpoint Object3D from its scene parent. The Object3Ds
    // themselves carry no GPU resources (no geometry/material) — they're
    // pure transform nodes — so removing the parent reference is enough.
    for (const obj of hardpointsById.values()) {
      if (obj.parent) obj.parent.remove(obj);
    }
    hardpointsById = new Map();
    hardpointMissWarned.clear();
    mountedUnitRoot = null;
    mountedRigNodeById = new Map();
    mountedRestQuatByNode = new Map();
    // Debug instrumentation: clear the per-rig throttle map so a freshly
    // mounted unit doesn't inherit stale "last logged" Eulers from the
    // previous mount (would cause the first frames after swap to look
    // unchanged and silently skip the log).
    rigTickLastLoggedEuler.clear();
  }

  /**
   * Build hardpoint Object3Ds and parent them under the appropriate node:
   *   - parent_rig_id !== null AND that rig is mounted → rig node.
   *   - parent_rig_id !== null BUT rig not in mesh    → warn once + unit root.
   *   - parent_rig_id === null                        → unit root.
   *
   * `unitRoot` is the mounted clone or voxel mesh — whichever is live this
   * slot. `rigNodeById` maps rig.id → its node in the clone (built by the
   * caller during setMeshUnit). On the voxel path there are no rigs, so
   * every hardpoint parents to the voxel mesh root.
   *
   * REST-POSE INVARIANT: hardpoints must be attached while every rig node
   * that's a candidate parent is at its TRUE REST POSE — the mesh's
   * authored rotation captured as `baseQuat` on each rig animator at
   * mount time. NOT identity: a rig node's authored mesh-root rotation
   * is `baseQuat`, not the identity quaternion, so neutralising to
   * identity would compute the hardpoint's local-relative-to-rig against
   * a pose that doesn't match the mesh's natural rest. The hardpoint's
   * world position would then drift away from where the arrow appears
   * in the Mesh Workspace as soon as the rig animates.
   *
   * Why `applyRigPose` is consistent with this: it writes
   * `node.quaternion = sweepRot × baseQuat`. At "angles = 0",
   * `sweepRot = identity`, so the rig's local rotation IS `baseQuat`.
   * That is the rest pose the hardpoint's local-relative-to-rig must be
   * baked against, so a subsequent `applyRigPose(angles=0)` reproduces
   * the world transform captured at attach time.
   *
   * Implementation: before the attach loop, snapshot every candidate
   * rig parent's current local quaternion, copy `baseQuat` from the
   * matching rig animator into it, refresh world matrices; run the
   * attach loop; then restore every saved quaternion and refresh
   * world matrices again. Passing `restQuatByNode` (built once by the
   * caller from `rigAnimators`) keeps the lookup O(1).
   *
   * Rigs with no animator entry (passive, no axes, not muzzle) won't
   * appear in `restQuatByNode` — leave their local quaternion alone in
   * that case and surface a one-time warning. Hardcoding identity for
   * the unknown case is exactly the silent-drop pattern we're avoiding.
   */
  function mountHardpoints(
    unitRoot: THREE.Object3D,
    hardpoints: readonly MeshHardpoint[],
    rigNodeById: ReadonlyMap<string, THREE.Object3D>,
    restQuatByNode: ReadonlyMap<THREE.Object3D, THREE.Quaternion>,
  ): void {
    // ----- Rest-pose snapshot ------------------------------------------
    // Collect every rig node that any hardpoint in this batch will
    // re-parent to. We only need to neutralise those — passive rig nodes
    // with no hardpoint attaching under them can stay in whatever local
    // pose they were in. Using a Set keeps the work O(unique parents)
    // even when many hardpoints share one rig parent.
    const restParents = new Set<THREE.Object3D>();
    for (const h of hardpoints) {
      if (h.parent_rig_id === null) continue;
      const node = rigNodeById.get(h.parent_rig_id) ?? null;
      if (node !== null) restParents.add(node);
    }
    // Save current local quaternions, then copy the rig's authored REST
    // POSE (baseQuat) from the matching animator. Falls through with a
    // warning when the rig has no animator (passive/non-arc/non-muzzle
    // rig — no baseQuat was captured). Allocates one Quaternion per
    // unique rig parent — this runs ONCE per unit mount, never per
    // frame, so it does not violate the no-per-frame-alloc rule.
    const savedQuats = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const node of restParents) {
      savedQuats.set(node, node.quaternion.clone());
      const rest = restQuatByNode.get(node);
      if (rest !== undefined) {
        node.quaternion.copy(rest);
      } else {
        // Loud-over-silent: a rig node with no captured rest pose is
        // either passive or had no arcs/muzzle at mount. Leave its
        // quaternion alone — the attach will bake whatever pose it
        // currently has — and surface the case so it's not invisible.
        // eslint-disable-next-line no-console
        console.warn(
          `[Hardpoint] rig parent node "${node.name}" has no captured ` +
            `rest pose (no rig animator) — attaching against the node's ` +
            `current local rotation. If the hardpoint drifts after rig ` +
            `animation, declare the rig as reactive with arcs or a muzzle ` +
            `flag so its baseQuat is captured.`,
        );
      }
    }
    if (restParents.size > 0) {
      unitRoot.updateMatrixWorld(true);
    }

    const seenIds = new Set<string>();
    for (const h of hardpoints) {
      if (seenIds.has(h.id)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Hardpoint] duplicate id "${h.id}" — the second occurrence is ` +
            `ignored. Rename in the Mesh Hardpoint section to fix.`,
        );
        continue;
      }
      seenIds.add(h.id);

      // Resolve the rig parent (if any) BEFORE creating the hardpoint. The
      // authored local_position / local_quaternion are in MESH-ROOT space
      // (that's where the arrow lives in the Mesh Workspace), so we must
      // first place the hardpoint as a child of unitRoot for those numbers
      // to land at the intended world position. Only AFTER that do we
      // re-parent to the rig node via Object3D.attach(), which preserves
      // world transform — so the hardpoint stays put at its authored spot
      // but now inherits the rig's animation.
      let rigParentNode: THREE.Object3D | null = null;
      if (h.parent_rig_id !== null) {
        const node = rigNodeById.get(h.parent_rig_id) ?? null;
        if (node !== null) {
          rigParentNode = node;
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[Hardpoint] "${h.id}" — parent rig "${h.parent_rig_id}" not ` +
              `found in mesh; falling back to unit root.`,
          );
        }
      }

      const obj = new THREE.Object3D();
      obj.name = `Hardpoint:${h.id}`;
      obj.position.set(
        h.local_position[0],
        h.local_position[1],
        h.local_position[2],
      );
      obj.quaternion.set(
        h.local_quaternion[0],
        h.local_quaternion[1],
        h.local_quaternion[2],
        h.local_quaternion[3],
      );
      // Step 1: park the hardpoint under the mesh root so the authored
      // mesh-local numbers resolve to the right world transform.
      unitRoot.add(obj);
      if (rigParentNode !== null) {
        // Step 2: refresh world matrices so obj.matrixWorld reflects the
        // mesh-local placement before re-parenting. The rig parents are
        // currently at identity local rotation (see rest-pose snapshot
        // above), so this captures the hardpoint's world transform AT
        // REST POSE.
        unitRoot.updateMatrixWorld(true);
        // Step 3: attach() re-parents while preserving world transform —
        // the hardpoint stays at the SAME world position+rotation but
        // becomes a child of the rig node. Because the rig is at identity
        // local rotation here, the hardpoint's resulting local-relative-
        // to-rig is its true rest-pose offset; subsequent applyRigPose
        // calls then rotate the rig (and the hardpoint with it) correctly.
        rigParentNode.attach(obj);
        // eslint-disable-next-line no-console
        console.log(`[Hardpoint mount] id="${h.id}" parent_rig="${h.parent_rig_id}" rig.local Euler=`, eulerDeg(rigParentNode.quaternion), `hp.local pos=`, obj.position.toArray().map((v: number) => v.toFixed(3)), `hp.local Euler=`, eulerDeg(obj.quaternion), `hp.world pos=`, obj.getWorldPosition(new THREE.Vector3()).toArray().map((v: number) => v.toFixed(3)), `hp.world Euler=`, eulerDeg(obj.getWorldQuaternion(new THREE.Quaternion())));
      }
      hardpointsById.set(h.id, obj);
    }

    // ----- Restore rest-pose snapshot ----------------------------------
    // Put every neutralised rig node back to whatever local quaternion it
    // had before — typically the captured `baseQuat` the animator system
    // will compose against. Refresh world matrices so any caller reading
    // a node's worldQuaternion immediately after sees the restored pose,
    // not the transient identity.
    for (const [node, q] of savedQuats) {
      node.quaternion.copy(q);
    }
    if (restParents.size > 0) {
      unitRoot.updateMatrixWorld(true);
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
      // Apply the optional chassis.scale knob to the voxel mesh root. Voxel
      // meshes already arrive in true world meters (no normalization scale
      // exists for them) so we set the scalar directly rather than folding
      // it into another factor. Default 1 when omitted (backwards compat).
      const voxelChassisScale = next.chassis.scale ?? 1;
      if (voxelChassisScale > 0 && voxelChassisScale !== 1) {
        mesh.scale.setScalar(voxelChassisScale);
      }
      parent.add(mesh);
      handle.current = mesh;

      // Voxel path: no rigs to parent under, so every hardpoint lands on
      // the mesh root. The empty rigNodeById map triggers the unit-root
      // fallback path (with a one-time warning per missing rig id). The
      // empty restQuatByNode map is consistent — no rigs, no rest poses.
      mountedUnitRoot = mesh;
      mountedRigNodeById = new Map();
      mountedRestQuatByNode = new Map();
      mountHardpoints(mesh, next.hardpoints ?? [], new Map(), new Map());
    },
    setMeshUnit(
      meshSource: THREE.Group | null,
      skinImage: HTMLImageElement | null,
      rig: readonly RigEntry[],
      hardpoints: readonly MeshHardpoint[] = [],
      chassisScaleFactor: number = 1,
      chassisLengthM: number | undefined = undefined,
    ) {
      clearMounted();
      if (meshSource === null) {
        // No mesh: leave the slot empty; terrain stays visible.
        return;
      }

      // Independent deep clone — the master mesh is parented to the left-pane
      // scene and must never be re-parented or disposed from here.
      const cloneGroup = deepCloneGroup(meshSource);

      // POST-OPTION-C scale chain. After the mesh-loader's normaliseGroup,
      // the clone root carries scale (1,1,1) — the normalize factor has been
      // baked into geometry vertices, so every coordinate downstream is in
      // world meters. Two designer-facing scale knobs live ON TOP:
      //
      //   1. chassis.length_m (preferred). Direct: rendered longest bbox dim
      //      in meters. The runtime divides by the mesh-loader's
      //      `normalizedSizeM` (default 8m) to get the multiplier we apply
      //      to the already-unit-scaled clone root.
      //   2. chassis.scale (legacy). Multiplicative: the chassis is rendered
      //      at `scale × normalizedSizeM` meters. Kept for backwards compat;
      //      ignored when length_m is set.
      //
      // No re-reading of `cloneGroup.scale` is needed any more — it's (1,1,1)
      // by construction. Setting the effective scale directly is the right
      // move post-bake.
      const normalizedSize =
        typeof cloneGroup.userData.normalizedSizeM === "number" &&
        cloneGroup.userData.normalizedSizeM > 0
          ? cloneGroup.userData.normalizedSizeM
          : TARGET_UNIT_SIZE_M;
      let effectiveScale: number;
      if (typeof chassisLengthM === "number" && chassisLengthM > 0) {
        effectiveScale = chassisLengthM / normalizedSize;
      } else if (chassisScaleFactor > 0) {
        effectiveScale = chassisScaleFactor;
      } else {
        effectiveScale = 1;
      }
      cloneGroup.scale.setScalar(effectiveScale);

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
        // A reactive rig contributes either authored arcs (yaw/pitch) OR a
        // muzzle flag (in which case it drives the aim plan even with no
        // arcs of its own — see hierarchy-aware auto-aim). Skip anything
        // with neither: nothing to do for it this frame.
        if (!entry.yaw && !entry.pitch && entry.muzzle !== true) continue;

        const targetNodeMaybe = nodeByRigId.get(entry.id) ?? null;
        if (targetNodeMaybe === null) continue;
        const targetNode: THREE.Object3D = targetNodeMaybe;

        // Resolve the auto-aim parent: parent_rig's node if declared and
        // present, otherwise the mounted clone root. Loud-over-silent: if
        // parent_rig is declared but missing, warn once at mount and fall
        // back to the clone root (a degenerate but visible aim).
        const isReactiveMuzzle = entry.muzzle === true;
        let aimParent: THREE.Object3D | null = cloneGroup;
        if (entry.parent_rig) {
          const declared = nodeByRigId.get(entry.parent_rig) ?? null;
          if (declared !== null) {
            aimParent = declared;
          } else if (isReactiveMuzzle) {
            // eslint-disable-next-line no-console
            console.warn(
              `[FireTest auto-aim] muzzle rig "${entry.id}" — declared ` +
                `parent_rig "${entry.parent_rig}" not in mesh; falling back ` +
                `to mounted root for parent-local frame.`,
            );
          }
        }

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
          rigId: entry.id,
          parentRigId: entry.parent_rig ?? null,
          node: targetNode,
          aimParent,
          muzzleForward: entry.muzzle_forward ?? "+z",
          isReactiveMuzzle,
          baseQuat: targetNode.quaternion.clone(),
          basePos: targetNode.position.clone(),
          pivot: pivotLocal,
          yaw: yawState,
          pitch: pitchState,
          yawAngle: yawState ? (yawState.minDeg + yawState.maxDeg) / 2 : 0,
          yawDir: 1,
          pitchAngle: pitchState ? (pitchState.minDeg + pitchState.maxDeg) / 2 : 0,
          pitchDir: 1,
          aimDesiredYawRad: null,
          aimDesiredPitchRad: null,
        });

        if (yawState) {
          const fan = makeYawFan(yawState.minDeg, yawState.maxDeg, fanRadius);
          parent.add(fan);
          yawFans.push(fan);
        }
      }

      // Index animators by rig id for the auto-aim apply pass. Built
      // once per mount so the per-frame plan pass doesn't pay a linear
      // scan per ancestor lookup.
      animatorById = new Map();
      for (const a of rigAnimators) animatorById.set(a.rigId, a);
      // Index ALL rig entries by id (including passthrough rigs that
      // have no animator). findBearer walks via parent_rig in the
      // schema so passive intermediates don't break the chain.
      rigEntryById = new Map();
      for (const entry of rig) rigEntryById.set(entry.id, entry);

      // Mount hardpoints LAST so they parent into the fully-built rig
      // hierarchy. nodeByRigId resolves each parent_rig_id to its mesh
      // node; misses fall back to the clone root (with a warn).
      // restQuatByNode lets mountHardpoints neutralise each candidate
      // rig parent to its TRUE REST POSE (baseQuat) — not identity —
      // so the hardpoint's attached local-relative-to-rig matches the
      // pose `applyRigPose(angles=0)` reproduces every frame.
      const restQuatByNode = new Map<THREE.Object3D, THREE.Quaternion>();
      for (const a of rigAnimators) restQuatByNode.set(a.node, a.baseQuat);
      // Cache the mount context so updateHardpointData() can re-mount
      // individual hardpoints under the same rig hierarchy without a
      // full unit rebuild.
      mountedUnitRoot = cloneGroup;
      mountedRigNodeById = nodeByRigId;
      mountedRestQuatByNode = restQuatByNode;
      mountHardpoints(cloneGroup, hardpoints, nodeByRigId, restQuatByNode);
    },
    tickRig(dt: number) {
      if (rigAnimators.length === 0) return; // no-op when nothing is rigged

      // ----- Pass 0: clear stale aim plans ----------------------------
      // A non-aim frame must not leak last frame's desired angles into
      // the apply pass — that would silently freeze a bearer at its
      // last-known target after the user clears the aim. Loud-over-silent:
      // null is the explicit "no aim this frame" signal the apply pass
      // pattern-matches on.
      for (const a of rigAnimators) {
        a.aimDesiredYawRad = null;
        a.aimDesiredPitchRad = null;
      }

      // ----- Pass 1: plan ---------------------------------------------
      // For each reactive-muzzle rig, walk the chain, solve yaw/pitch for
      // the BEARERS (not the muzzle itself), and stash the desired
      // radians on the bearer animators. A muzzle that is ALSO its own
      // bearer (gimbal) lands in the same slot — the apply pass treats
      // it uniformly. The plan pass refreshes parent world quaternions
      // BEFORE the apply pass writes new local poses; correct because we
      // want this frame's desired angle derived from the CURRENT bearer
      // state, then slew TOWARD it in the apply pass.
      if (aimTargetWorld !== null) {
        for (const a of rigAnimators) {
          if (!a.isReactiveMuzzle) continue;
          const plan = computeAimPlan(a);
          if (plan.yawBearer !== null && plan.yawDesiredRad !== null) {
            plan.yawBearer.aimDesiredYawRad = plan.yawDesiredRad;
          }
          if (plan.pitchBearer !== null && plan.pitchDesiredRad !== null) {
            plan.pitchBearer.aimDesiredPitchRad = plan.pitchDesiredRad;
          }
        }
      }

      // ----- Pass 2: apply --------------------------------------------
      // For each rig, slew toward any planned aim angle on that axis,
      // otherwise run the authored ping-pong on that axis. Each axis
      // is independent: a bearer might receive yaw aim but no pitch aim
      // (e.g. yaw on this rig, pitch on a descendant) — in that case
      // pitch falls back to ping-pong. Axes without arcs are skipped.
      for (const a of rigAnimators) {
        let touchedThisFrame = false;

        // Yaw axis
        if (a.yaw) {
          if (a.aimDesiredYawRad !== null) {
            // Shortest-angle slew (so +170° aiming at -170° rotates 20°
            // through ±180° instead of 340° the long way around).
            const curRad = THREE.MathUtils.degToRad(a.yawAngle);
            const tgtRad = a.aimDesiredYawRad;
            const deltaRad = shortestAngleDeltaRad(curRad, tgtRad);
            const rateDps = a.yaw.rateDps > 0 ? a.yaw.rateDps : DEFAULT_AIM_RATE_DPS;
            const maxStepRad = THREE.MathUtils.degToRad(rateDps) * dt;
            const stepRad =
              Math.abs(deltaRad) <= maxStepRad
                ? deltaRad
                : Math.sign(deltaRad) * maxStepRad;
            let nextDeg = a.yawAngle + THREE.MathUtils.radToDeg(stepRad);
            nextDeg = THREE.MathUtils.clamp(nextDeg, a.yaw.minDeg, a.yaw.maxDeg);
            a.yawAngle = nextDeg;
            touchedThisFrame = true;
          } else {
            // Ping-pong sweep when nothing is aiming through this rig.
            a.yawAngle += a.yawDir * a.yaw.rateDps * dt;
            if (a.yawAngle >= a.yaw.maxDeg) {
              a.yawAngle = a.yaw.maxDeg;
              a.yawDir = -1;
            } else if (a.yawAngle <= a.yaw.minDeg) {
              a.yawAngle = a.yaw.minDeg;
              a.yawDir = 1;
            }
            touchedThisFrame = true;
          }
        }

        // Pitch axis
        if (a.pitch) {
          if (a.aimDesiredPitchRad !== null) {
            const curRad = THREE.MathUtils.degToRad(a.pitchAngle);
            const tgtRad = a.aimDesiredPitchRad;
            const deltaRad = shortestAngleDeltaRad(curRad, tgtRad);
            const rateDps =
              a.pitch.rateDps > 0 ? a.pitch.rateDps : DEFAULT_AIM_RATE_DPS;
            const maxStepRad = THREE.MathUtils.degToRad(rateDps) * dt;
            const stepRad =
              Math.abs(deltaRad) <= maxStepRad
                ? deltaRad
                : Math.sign(deltaRad) * maxStepRad;
            let nextDeg = a.pitchAngle + THREE.MathUtils.radToDeg(stepRad);
            nextDeg = THREE.MathUtils.clamp(
              nextDeg,
              a.pitch.minDeg,
              a.pitch.maxDeg,
            );
            a.pitchAngle = nextDeg;
            touchedThisFrame = true;
          } else {
            a.pitchAngle += a.pitchDir * a.pitch.rateDps * dt;
            if (a.pitchAngle >= a.pitch.maxDeg) {
              a.pitchAngle = a.pitch.maxDeg;
              a.pitchDir = -1;
            } else if (a.pitchAngle <= a.pitch.minDeg) {
              a.pitchAngle = a.pitch.minDeg;
              a.pitchDir = 1;
            }
            touchedThisFrame = true;
          }
        }

        // Only write a local pose when the rig actually has at least one
        // axis to animate. A leaf muzzle marker with NO yaw/pitch arcs of
        // its own MUST NOT have applyRigPose called on it — its world
        // pose is inherited from the chain (body yaw + barrel pitch), and
        // overwriting its local quaternion with identity-from-zero-angles
        // would silently un-aim the shot.
        if (touchedThisFrame) {
          applyRigPose(a);

          // ---- Debug instrumentation: per-rig tick log ----------------
          // Log only for rigs that are interesting to the hardpoint chain:
          // a muzzle-tagged rig OR a rig with a hardpoint as a child. The
          // throttle map ensures we only emit when at least one Euler
          // axis has moved > 0.1° since the previous logged frame.
          let hasHardpointChild = false;
          for (const child of a.node.children) {
            if (child.name.startsWith("Hardpoint:")) {
              hasHardpointChild = true;
              break;
            }
          }
          if (a.isReactiveMuzzle || hasHardpointChild) {
            const localStrs = eulerDeg(a.node.quaternion);
            const lx = parseFloat(localStrs[0]);
            const ly = parseFloat(localStrs[1]);
            const lz = parseFloat(localStrs[2]);
            const last = rigTickLastLoggedEuler.get(a.rigId);
            const moved =
              last === undefined ||
              Math.abs(lx - last[0]) > 0.1 ||
              Math.abs(ly - last[1]) > 0.1 ||
              Math.abs(lz - last[2]) > 0.1;
            if (moved) {
              rigTickLastLoggedEuler.set(a.rigId, [lx, ly, lz]);
              a.node.updateMatrixWorld(true);
              // eslint-disable-next-line no-console
              console.log(`[RigTick] rig "${a.rigId}" target_node="${a.node.name}" local Euler(deg)=`, localStrs, `world Euler(deg)=`, eulerDeg(a.node.getWorldQuaternion(new THREE.Quaternion())));
            }
          }
        }
      }
    },
    setAimTarget(target: readonly [number, number, number] | null) {
      if (target === null) {
        aimTargetWorld = null;
        return;
      }
      if (aimTargetWorld === null) {
        aimTargetWorld = new THREE.Vector3(target[0], target[1], target[2]);
      } else {
        aimTargetWorld.set(target[0], target[1], target[2]);
      }
    },
    snapAimToTarget() {
      if (aimTargetWorld === null) return;
      if (rigAnimators.length === 0) return;

      // Mirror the two-pass tickRig flow at zero rate (instant slew):
      // plan into bearers, then apply. We touch ONLY the bearers (not
      // every animator), so non-aim rigs keep their current sweep state
      // — Fire test shouldn't visibly nudge unrelated moving parts.
      const touchedBearers: RigAnimator[] = [];
      for (const a of rigAnimators) {
        if (!a.isReactiveMuzzle) continue;
        const plan = computeAimPlan(a);
        if (plan.yawBearer !== null && plan.yawDesiredRad !== null) {
          plan.yawBearer.yawAngle = THREE.MathUtils.radToDeg(plan.yawDesiredRad);
          touchedBearers.push(plan.yawBearer);
        }
        if (plan.pitchBearer !== null && plan.pitchDesiredRad !== null) {
          plan.pitchBearer.pitchAngle = THREE.MathUtils.radToDeg(
            plan.pitchDesiredRad,
          );
          touchedBearers.push(plan.pitchBearer);
        }
      }
      for (const b of touchedBearers) applyRigPose(b);

      // Refresh world matrices so a subsequent getMuzzleAim() reads the
      // snapped pose, not the pre-snap one. The muzzle itself is a leaf:
      // its world transform updates when we walk the matrix down from
      // each bearer through to it.
      parent.updateMatrixWorld(true);
    },
    getHardpointAim(id: string): MuzzleAim | null {
      const obj = hardpointsById.get(id) ?? null;
      if (obj === null) {
        if (!hardpointMissWarned.has(id)) {
          hardpointMissWarned.add(id);
          // eslint-disable-next-line no-console
          console.warn(
            `[Hardpoint] getHardpointAim("${id}") — id not mounted; ` +
              `available: [${[...hardpointsById.keys()].join(", ")}]`,
          );
        }
        return null;
      }
      // World matrices may be stale if the rig tick or a re-parent
      // happened this frame — refresh from the slot's root down before
      // reading the hardpoint's world transform.
      parent.updateMatrixWorld(true);
      obj.getWorldPosition(scratchHpPos);
      // Three.js convention: getWorldDirection returns the +Z axis in world
      // space. Matches the artist's authoring intent (the arrow points along
      // local +Z), so no axis-guessing band-aid is needed.
      obj.getWorldDirection(scratchHpDir);
      // getWorldDirection returns a normalised vector; copy out the
      // components so the returned tuple doesn't alias the scratch.
      const direction: [string, string, string] = [
        scratchHpDir.x.toFixed(3),
        scratchHpDir.y.toFixed(3),
        scratchHpDir.z.toFixed(3),
      ];
      const hpParent: THREE.Object3D | null = obj.parent;
      // eslint-disable-next-line no-console
      console.log(`[Hardpoint getAim] id="${id}" hp.parent.world Euler=`, hpParent !== null ? eulerDeg(hpParent.getWorldQuaternion(new THREE.Quaternion())) : ["<no parent>"], `hp.local Euler=`, eulerDeg(obj.quaternion), `hp.world Euler=`, eulerDeg(obj.getWorldQuaternion(new THREE.Quaternion())), `direction=`, direction);
      return {
        position: [scratchHpPos.x, scratchHpPos.y, scratchHpPos.z],
        direction: [scratchHpDir.x, scratchHpDir.y, scratchHpDir.z],
        source: "hardpoint",
      };
    },
    listHardpointIds(): string[] {
      return [...hardpointsById.keys()];
    },
    updateHardpointData(hardpoints: readonly MeshHardpoint[]) {
      // No mount yet (called before setUnit/setMeshUnit). Loud-over-silent
      // is the rule, but this case is expected at React-mount time: the
      // useEffect that drives this fires once on initial mount before
      // setMeshUnit has had a chance to run. Skip quietly.
      if (mountedUnitRoot === null) return;
      // Detach every existing hardpoint Object3D from its scene parent
      // BEFORE rebuilding. mountHardpoints repopulates `hardpointsById`
      // with fresh Object3Ds; leaving the old ones parented would leak
      // stale transform nodes into the rig hierarchy.
      for (const obj of hardpointsById.values()) {
        if (obj.parent) obj.parent.remove(obj);
      }
      hardpointsById = new Map();
      // Re-mount with the live hardpoint array. This re-runs the
      // rest-pose neutralisation + attach() dance per hardpoint, so
      // edited local_position/local_quaternion/parent_rig_id all
      // land correctly under the same rig hierarchy.
      mountHardpoints(
        mountedUnitRoot,
        hardpoints,
        mountedRigNodeById,
        mountedRestQuatByNode,
      );
    },
    getMuzzleAim(unit: UnitSchematic): MuzzleAim | null {
      // Pick whichever mount is live; both live under `parent`. Mesh
      // mounts go through `currentMeshClone`; voxel mounts through
      // `handle.current`.
      const mounted: THREE.Object3D | null = currentMeshClone ?? handle.current;
      if (!mounted) return null;
      // World matrices may be stale if a rig tick or recent re-parent
      // happened this frame — refresh before measuring or reading any
      // animated node's world transform.
      parent.updateMatrixWorld(true);

      // ----- Rig path ----------------------------------------------------
      // Scan the unit's rig entries for a single muzzle-tagged rig. The
      // authoring UI enforces at-most-one, but be defensive — take the
      // first match. If the target_node isn't in the mounted mesh, log a
      // loud warning and fall through to the bbox path instead of
      // silently dropping the user's authoring intent.
      const muzzleRig = (unit.rig ?? []).find((r) => r.muzzle === true) ?? null;
      if (muzzleRig) {
        const node = mounted.getObjectByName(muzzleRig.target_node) ?? null;
        if (node === null) {
          // eslint-disable-next-line no-console
          console.warn(
            `[FireTest] muzzle rig "${muzzleRig.id}" target_node ` +
              `"${muzzleRig.target_node}" not in mesh — falling back to bbox`,
          );
        } else {
          node.updateMatrixWorld(true);
          const worldPos = node.getWorldPosition(new THREE.Vector3());
          const worldQuat = node.getWorldQuaternion(new THREE.Quaternion());
          const localAxis = muzzleForwardLocal(muzzleRig.muzzle_forward ?? "+z");
          const worldDir = localAxis.applyQuaternion(worldQuat).normalize();
          return {
            position: [worldPos.x, worldPos.y, worldPos.z],
            direction: [worldDir.x, worldDir.y, worldDir.z],
            source: "rig",
          };
        }
      }

      // ----- Bbox fallback ----------------------------------------------
      // Legacy behaviour: top-front of the bbox, firing south (-Z).
      const box = new THREE.Box3().setFromObject(mounted);
      if (box.isEmpty()) return null;
      // x: horizontal centre. y: just below the topmost point — where a
      // turret muzzle would naturally sit. z: front face of the unit. The
      // scene fires toward -Z, so the "front" is the lesser Z, with a
      // small inset (+0.5) so the spawn point doesn't poke through the
      // hull surface.
      const x = (box.min.x + box.max.x) / 2;
      const y = box.max.y - 0.3;
      const z = box.min.z + 0.5;
      return {
        position: [x, y, z],
        direction: [0, 0, -1],
        source: "bbox",
      };
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
