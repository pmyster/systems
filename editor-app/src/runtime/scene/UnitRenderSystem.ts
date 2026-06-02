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

import { query } from "bitecs";

import {
  Position,
  Rotation,
  UnitTypeId,
  Renderable,
  type SimWorld,
} from "../../sim/world";
import type { InstancedUnitRenderer } from "./InstancedUnitRenderer";

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
): void {
  const ents = query(world, RENDER_QUERY_TERMS);
  if (ents.length === 0) return;

  // Bucket entities by typeId. A Map<number, number[]> is fine for the
  // small entity counts Phase 1 targets; a typed-array pool would be the
  // next step if profiling shows GC pressure.
  const byType = new Map<number, number[]>();
  for (let i = 0; i < ents.length; i++) {
    const eid = ents[i];
    const tid = UnitTypeId.value[eid];
    let arr = byType.get(tid);
    if (!arr) {
      arr = [];
      byType.set(tid, arr);
    }
    arr.push(eid);
  }

  // Per-type flat-array build + sync.
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
  }
}
