/**
 * UnitRenderSystem — Phase 1 Week 1C
 *
 * Each frame, walk every `Renderable` entity in the ECS, bucket by
 * `UnitTypeId`, and bulk-write per-type Float32Arrays into the
 * `InstancedUnitRenderer`. The renderer in turn stamps one
 * `InstancedMesh.instanceMatrix` per type — 50 tanks become ONE draw
 * call.
 *
 * Why bucket-by-type per frame (not per-spawn)?
 *   Buckets are tiny and rebuilt cheaply. A per-spawn map of typeId →
 *   eid[] would have to track destroy events too (dead entities falling
 *   out of the query) — that's two more data structures and a sync
 *   contract to maintain. The bitECS `defineQuery` is already an
 *   indexed view; iterating it once per frame and shoving the results
 *   into temporary buckets is O(n) and trivially correct.
 *
 *   This will get re-evaluated when the entity count crosses a few
 *   thousand (Week 4 polish slice). At that point a typed-array bucket
 *   per type with eid index lists becomes worth the complexity. For
 *   Phase 1 (≤ ~100 units) the simple loop is fast enough.
 *
 * Hot-path discipline:
 *   The Float32Arrays are allocated fresh each call. Switching to a
 *   pool is a known follow-up — but for ≤ 256 units the allocation
 *   cost is below the noise floor of WebGL upload. Profile before
 *   optimizing.
 */

import { hasComponent, query } from "bitecs";
import type * as THREE from "three";

import {
  Dead,
  Position,
  ProjectileTag,
  Rotation,
  TeamId,
  UnitTypeId,
  Renderable,
  WeaponInstanceTag,
  type SimWorld,
} from "../../sim/world";
import type { InstancedUnitRenderer } from "./InstancedUnitRenderer";

/** Per-team RGB tint (multiplicative). Team 0 blue, team 1 red. */
const TEAM_TINTS: readonly { r: number; g: number; b: number }[] = [
  { r: 0.6, g: 0.85, b: 1.2 }, // team 0 → cool blue tint
  { r: 1.4, g: 0.65, b: 0.5 }, // team 1 → warm red tint
  { r: 1.0, g: 1.0, b: 1.0 }, // team 2+ neutral
];

const DEAD_TINT = { r: 0.25, g: 0.25, b: 0.25 };

function tintFor(teamId: number): { r: number; g: number; b: number } {
  return TEAM_TINTS[teamId] ?? TEAM_TINTS[TEAM_TINTS.length - 1];
}

/**
 * Maps (InstancedMesh, instanceId) → entityId so the SelectionController
 * can resolve raycast hits back to the ECS. Rebuilt each frame from the
 * same bucketing pass that drives the sync to avoid duplicating work.
 *
 * Why a class instead of a bare Map?
 *   - Encapsulates the "(typeId, slot) → eid" lookup so SelectionController
 *     doesn't need to know about the bucketing convention.
 *   - Provides a `lookup(InstancedMesh, instanceId)` shape that matches
 *     what THREE.Raycaster gives us.
 *   - Owns the inverse map for "find which slot this eid sits in"
 *     (Week 3 selection-ring renderer wants this).
 */
export class InstanceIndex {
  /** typeId → ordered array of eids; eids[slot] = eid. */
  private readonly slotToEid = new Map<number, number[]>();
  /** Reverse: eid → { typeId, slot } for quick "where is this entity?" */
  private readonly eidLocation = new Map<number, { typeId: number; slot: number }>();

  /** Called by UnitRenderSystem after writing instanceMatrix for one type. */
  setType(typeId: number, eids: readonly number[]): void {
    // Defensive copy — bitECS query arrays are live views.
    const list = eids.slice();
    this.slotToEid.set(typeId, list);
    for (let i = 0; i < list.length; i++) {
      this.eidLocation.set(list[i], { typeId, slot: i });
    }
  }

  /** Clear ALL stale per-frame state. Called at the START of each sync. */
  clear(): void {
    this.slotToEid.clear();
    this.eidLocation.clear();
  }

  /**
   * Map (mesh, instanceId) → eid by reading mesh.name (which the
   * renderer stamps as `UnitType_${typeId}` on register). Returns null
   * if the hit doesn't correspond to a tracked instance — defensive
   * against debug overlays sneaking into the raycast result.
   */
  lookup(mesh: THREE.InstancedMesh, instanceId: number): number | null {
    const name = mesh.name;
    if (!name.startsWith("UnitType_")) return null;
    const typeId = Number(name.slice("UnitType_".length));
    if (!Number.isInteger(typeId)) return null;
    const slots = this.slotToEid.get(typeId);
    if (!slots || instanceId < 0 || instanceId >= slots.length) return null;
    return slots[instanceId];
  }

  /** Where does this eid currently render? Used by selection-ring overlay. */
  locationOf(eid: number): { typeId: number; slot: number } | null {
    return this.eidLocation.get(eid) ?? null;
  }
}

/**
 * bitECS 0.4 query terms — passed each frame to `query(world, [...])`
 * which returns a Uint32Array view of matching entity ids. bitECS
 * memoises the underlying SparseSet keyed on the term list identity, so
 * holding this array stable at module scope reuses the same internal
 * Query across every frame.
 */
const RENDER_QUERY_TERMS = [Renderable, Position, Rotation, UnitTypeId];

/**
 * Run one frame's ECS→InstancedMesh sync.
 *
 * Steps:
 *   1. Query Renderable entities.
 *   2. Bucket by `UnitTypeId.value[eid]`.
 *   3. For each bucket, build a flat `Float32Array(3 * n)` of positions
 *      and `Float32Array(4 * n)` of quaternions and call
 *      `renderer.sync(typeId, positions, rotations, n)`.
 *
 * Entities whose `UnitTypeId` isn't registered with the renderer get a
 * single console.warn from `InstancedUnitRenderer.sync` (loud-over-silent
 * — the asymmetry surfaces). Buckets with zero entities are skipped
 * silently because a registered type with no live instances is a normal
 * resting state (everything died, nothing spawned yet, etc.).
 */
export function runUnitRenderSystem(
  world: SimWorld,
  renderer: InstancedUnitRenderer,
  index?: InstanceIndex,
): void {
  if (index) index.clear();
  const ents = query(world, RENDER_QUERY_TERMS);
  if (ents.length === 0) return;

  // Bucket entities by typeId. A Map<number, number[]> is fine for the
  // small entity counts Phase 1 targets; a typed-array pool would be the
  // next step if profiling shows GC pressure.
  //
  // Skip projectile + weapon-instance entities — they're Renderable but
  // not units. Projectiles render via ProjectileRenderer; weapon
  // instances have no visual of their own.
  const byType = new Map<number, number[]>();
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    if (hasComponent(world, eid, ProjectileTag)) continue;
    if (hasComponent(world, eid, WeaponInstanceTag)) continue;
    const tid = UnitTypeId.value[eid];
    let arr = byType.get(tid);
    if (!arr) {
      arr = [];
      byType.set(tid, arr);
    }
    arr.push(eid);
  }

  // Per-type flat-array build + sync. The slot index within `eids` IS
  // the InstancedMesh slot — Week 2 selection raycasts depend on this
  // invariant (UnitType_${typeId} mesh, instanceId == slot).
  for (const [tid, eids] of byType) {
    const count = eids.length;
    const positions = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const eid = eids[i];
      positions[i * 3 + 0] = Position.x[eid];
      positions[i * 3 + 1] = Position.y[eid];
      positions[i * 3 + 2] = Position.z[eid];
      rotations[i * 4 + 0] = Rotation.x[eid];
      rotations[i * 4 + 1] = Rotation.y[eid];
      rotations[i * 4 + 2] = Rotation.z[eid];
      rotations[i * 4 + 3] = Rotation.w[eid];
    }
    renderer.sync(tid, positions, rotations, count);
    if (index) index.setType(tid, eids);
    // Per-instance team / dead tint. Slot order matches eids order.
    for (let i = 0; i < count; i++) {
      const eid = eids[i];
      if (hasComponent(world, eid, Dead)) {
        renderer.setColorAt(tid, i, DEAD_TINT.r, DEAD_TINT.g, DEAD_TINT.b);
        continue;
      }
      const t = tintFor(TeamId.value[eid]);
      renderer.setColorAt(tid, i, t.r, t.g, t.b);
    }
  }
}
