/**
 * NavMeshBaker — Phase 1 Week 2
 *
 * Bakes a Detour-compatible navmesh from a Three.js terrain mesh using
 * recast-navigation-js 0.43.x. The wasm runtime is initialised once
 * per session; calls to `bakeNavMesh` after that are synchronous in
 * spirit (recast runs in-thread; for a 128×128 heightfield the bake
 * is well under 100ms).
 *
 * API names verified against the installed `@recast-navigation/core@0.43.1`:
 *   - `init()`: returns a Promise resolved once the wasm module is ready.
 *   - `threeToSoloNavMesh([mesh], config)` from `@recast-navigation/three`:
 *     extracts geometry from the Three mesh + bakes a solo navmesh.
 *   - `NavMeshQuery` constructor: `new NavMeshQuery(navMesh, params?)`.
 *   - `Crowd` constructor: `new Crowd(navMesh, { maxAgents, maxAgentRadius })`.
 *
 * Returned handle is the only thing the rest of the runtime ever sees
 * — the controller doesn't need to know about recast internals.
 *
 * Disposal:
 *   `dispose()` destroys the Crowd, NavMeshQuery, and NavMesh in that
 *   order — Crowd holds a NavMesh ref so it goes first.
 *
 * Loud-over-silent: a generate failure surfaces as a thrown Error
 * with the recast `error` string. The caller (GameRuntime) is
 * expected to catch and log so the "navmesh building" overlay can
 * show a useful diagnostic instead of an indefinite spinner.
 */

import * as THREE from "three";
import { init as initRecast, NavMeshQuery, Crowd, type NavMesh } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";

/** Defaults aimed at small-mass units on a 128 m map. Tune per unit later. */
const DEFAULT_NAV_CONFIG = {
  cs: 0.5,
  ch: 0.5,
  walkableSlopeAngle: 45,
  walkableHeight: 2,
  walkableClimb: 1,
  walkableRadius: 0.5,
  maxEdgeLen: 12,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
} as const;

/** Crowd defaults — capacity sized for Phase 1's ≤ ~100 entities. */
const DEFAULT_CROWD_PARAMS = {
  maxAgents: 256,
  maxAgentRadius: 1.0,
} as const;

let recastReadyPromise: Promise<void> | null = null;

/**
 * Ensure the recast wasm module is initialised. Idempotent across
 * calls — the first call kicks the wasm load, subsequent calls await
 * the same promise.
 */
export function ensureRecastReady(): Promise<void> {
  if (recastReadyPromise === null) {
    recastReadyPromise = initRecast();
  }
  return recastReadyPromise;
}

export interface NavMeshHandle {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  readonly crowd: Crowd;
  dispose(): void;
}

/**
 * Bake a navmesh from a terrain mesh.
 *
 * `terrainMesh` should be the RuntimeTerrain's `mesh` — a single
 * THREE.Mesh with PlaneGeometry that's been heightmap-displaced.
 * The recast extractor reads its geometry positions/indices via
 * the @recast-navigation/three integration.
 */
export async function bakeNavMesh(terrainMesh: THREE.Mesh): Promise<NavMeshHandle> {
  await ensureRecastReady();

  const result = threeToSoloNavMesh([terrainMesh], { ...DEFAULT_NAV_CONFIG });
  if (!result.success) {
    throw new Error(
      `[NavMeshBaker] threeToSoloNavMesh failed: ${result.error ?? "unknown error"}`,
    );
  }
  const navMesh = result.navMesh;
  const query = new NavMeshQuery(navMesh);
  const crowd = new Crowd(navMesh, {
    maxAgents: DEFAULT_CROWD_PARAMS.maxAgents,
    maxAgentRadius: DEFAULT_CROWD_PARAMS.maxAgentRadius,
  });

  return {
    navMesh,
    query,
    crowd,
    dispose() {
      // Disposal order matters: Crowd holds NavMesh; NavMeshQuery holds
      // NavMesh; navmesh last. The library's destroy() methods are
      // idempotent w.r.t. each other; we still play it safe.
      crowd.destroy();
      query.destroy();
      navMesh.destroy();
    },
  };
}
