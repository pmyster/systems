/**
 * PathFollowController — Phase 1 Week 2
 *
 * Render-side path queue manager. Lives next to the navmesh because
 * pathfinding (`navMeshQuery.computePath`) is a /runtime concept —
 * the sim has no idea about recast and stays pure.
 *
 * Lifecycle of one move command:
 *   1. CommandController calls `requestMove(eids, targetWorldPoint)`.
 *   2. For each eid: compute a path with NavMeshQuery → store the
 *      list of waypoints in `paths[eid]` and write the FIRST waypoint
 *      into MovementTarget (so movement starts this very tick).
 *   3. Each frame `pollArrivals()` checks every tracked entity: if
 *      `MovementTarget.hasTarget === 0` AND there are more waypoints
 *      queued, pop the next one into MovementTarget. If no more
 *      waypoints, remove the entity from tracking.
 *
 * Why the queue lives render-side (not in ECS):
 *   - Paths are NOT part of replay-canonical sim state (Week 4
 *     hardens that). Keeping them out of ECS means the sim's
 *     determinism contract is unchanged.
 *   - Path queue is per-command churn: every move command replaces
 *     the queue. Encoding that in ECS components would require an
 *     unbounded waypoint count or a ring buffer with brittle math.
 *     A plain `Map<eid, Vec3[]>` here is clearer and cheaper.
 *
 * Crowd avoidance:
 *   For Week 2 MVP we run pure computePath + walk waypoints. The
 *   `Crowd` instance is constructed and held by NavMeshHandle but
 *   NOT yet wired — Crowd integration is its own slice (Week 2 follow-up
 *   or Week 4) because it changes the contract between
 *   render-pos-write and sim-pos-write. The brief acknowledges this
 *   in the "what's NOT in this slice" list.
 *
 * Coordinate convention: the navmesh is baked from the same terrain
 * mesh the sim's spawn positions reference, so world units match 1:1.
 */

import * as THREE from "three";

import { MovementTarget, type SimWorld } from "../../sim/world";
import { Position } from "../../sim/world";
import type { NavMeshHandle } from "./NavMeshBaker";

/** Per-entity remaining waypoint queue. Index 0 = next to consume. */
interface PathState {
  readonly waypoints: THREE.Vector3[];
  index: number;
}

export class PathFollowController {
  private readonly world: SimWorld;
  private readonly navHandle: NavMeshHandle;
  private readonly active = new Map<number, PathState>();

  constructor(world: SimWorld, navHandle: NavMeshHandle) {
    this.world = world;
    this.navHandle = navHandle;
  }

  /**
   * Plan paths from each entity's current Position to `target`. Writes
   * the first waypoint into MovementTarget so movement starts this tick.
   *
   * Returns the number of entities for which a path was successfully
   * planned.
   */
  requestMove(entityIds: readonly number[], target: THREE.Vector3): number {
    let planned = 0;
    for (let i = 0; i < entityIds.length; i++) {
      const eid = entityIds[i];
      const start = {
        x: Position.x[eid],
        y: Position.y[eid],
        z: Position.z[eid],
      };
      const end = { x: target.x, y: target.y, z: target.z };

      const result = this.navHandle.query.computePath(start, end);
      if (!result.success || result.path.length === 0) {
        // Loud-over-silent: pathfinding failure on a baked navmesh is
        // usually "target is outside the walkable area" — surface it
        // so the dev can see WHY a unit didn't move.
        console.warn(
          `[PathFollowController] computePath failed for eid=${eid}: ${result.error?.name ?? "no path"}`,
        );
        continue;
      }

      // recast returns the start point as the first entry. Drop it —
      // we're already there.
      const wps: THREE.Vector3[] = [];
      for (let p = 1; p < result.path.length; p++) {
        const pt = result.path[p];
        wps.push(new THREE.Vector3(pt.x, pt.y, pt.z));
      }
      // If the path was just [start], we've effectively arrived; treat
      // it as a single-waypoint move toward the requested target so
      // the unit at least snaps onto the navmesh point we asked for.
      if (wps.length === 0) {
        wps.push(new THREE.Vector3(target.x, target.y, target.z));
      }

      this.active.set(eid, { waypoints: wps, index: 0 });
      // Write the first waypoint into MovementTarget so the sim
      // movementSystem starts walking this tick.
      const first = wps[0];
      MovementTarget.x[eid] = first.x;
      MovementTarget.y[eid] = 0;
      MovementTarget.z[eid] = first.z;
      MovementTarget.hasTarget[eid] = 1;
      planned++;
    }
    return planned;
  }

  /**
   * Cancel any in-flight path for these entities and clear their sim
   * MovementTarget. Used by S → stop and by re-planning when a new
   * move command supersedes the old one (requestMove handles the
   * replace by overwriting `active[eid]`).
   */
  cancel(entityIds: readonly number[]): void {
    for (let i = 0; i < entityIds.length; i++) {
      const eid = entityIds[i];
      this.active.delete(eid);
      MovementTarget.hasTarget[eid] = 0;
    }
  }

  /**
   * Each frame, check tracked entities for arrival (sim transitioned
   * MovementTarget.hasTarget 1 → 0). On arrival, pop the next waypoint
   * if any; otherwise drop the entry.
   */
  pollArrivals(): void {
    if (this.active.size === 0) return;
    // Snapshot keys to avoid iterating while mutating the Map.
    const eids = Array.from(this.active.keys());
    for (let i = 0; i < eids.length; i++) {
      const eid = eids[i];
      const state = this.active.get(eid);
      if (!state) continue;
      if (MovementTarget.hasTarget[eid] !== 0) continue;

      // The current waypoint was reached. Advance.
      state.index += 1;
      if (state.index >= state.waypoints.length) {
        this.active.delete(eid);
        continue;
      }
      const next = state.waypoints[state.index];
      MovementTarget.x[eid] = next.x;
      MovementTarget.y[eid] = 0;
      MovementTarget.z[eid] = next.z;
      MovementTarget.hasTarget[eid] = 1;
    }
    void this.world; // SimWorld held for symmetry; component reads above are direct typed-array.
  }

  /** Drop every tracked path. Used on match teardown. */
  dispose(): void {
    this.active.clear();
  }
}
