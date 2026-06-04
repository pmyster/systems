/**
 * heightmapSampler — Phase 1 Week 5 (Terrain Occlusion)
 *
 * Shared bilinear sampler for the loaded heightmap.
 *
 * Originally inlined in `GameRuntime.tsx` for the spawn/grounding paths,
 * extracted here so that `projectileSystem`'s NEW terrain-occlusion path
 * uses the SAME code as unit-spawn height lookup. Two samplers drifting
 * would produce visible Z-fighting / "projectile hits 0.3m above the
 * ground" bugs. One source of truth.
 *
 * Two sampler variants:
 *
 *   makeClampedHeightSampler — used for unit/building SPAWN. Out-of-bounds
 *     queries clamp to the map edge so a spawn at (-1, -1) lands on the
 *     nearest valid cell instead of returning a sentinel. The original
 *     behaviour, preserved verbatim so spawn-path is byte-identical.
 *
 *   makeProjectileHeightSampler — used for the COMBAT BINDING. Returns
 *     `null` when (x, z) is outside the map. The sim's projectileSystem
 *     treats `null` as "no terrain here" and lets the projectile continue
 *     unaffected (with a once-per-match warn). This matches the brief:
 *     a projectile that flies off the map is an edge-case bug surfacing
 *     mechanism, not a silent collision.
 *
 * Sim-purity: the sampler RESULT is consumed inside /sim via the combat
 * binding callback. This file lives under /runtime (not /sim) so it
 * doesn't itself need to be sim-pure — but it must remain pure-functional
 * (no Date.now, no Math.random, no DOM) so the binding is deterministic.
 * Hand-written check: this file uses only typed-array reads + arithmetic.
 */

import type { LoadedMap } from "./mapLoader";

/**
 * A sampler that clamps out-of-bounds queries to the map edge. Always
 * returns a finite number. Used by MatchSpawner and resampleGroundedY.
 */
export type ClampedHeightSampler = (worldX: number, worldZ: number) => number;

/**
 * A sampler that returns `null` for out-of-bounds queries. Used by the
 * combat-binding terrain-collision check — the sim wants to distinguish
 * "I'm above terrain at this (x, z)" from "I'm off the map entirely".
 */
export type ProjectileHeightSampler = (
  worldX: number,
  worldZ: number,
) => number | null;

const DEFAULT_TILE_SIZE_M = 1;

/**
 * Build the spawn-path sampler. Identical math to the previous inline
 * version in GameRuntime — clamps to edge so spawn never NaN-explodes.
 */
export function makeClampedHeightSampler(map: LoadedMap): ClampedHeightSampler {
  const tileM = map.manifest.terrain.tileSizeM ?? DEFAULT_TILE_SIZE_M;
  const widthPx = map.manifest.terrain.widthPx;
  const heightPx = map.manifest.terrain.heightPx;
  const heightmap = map.heightmap;
  return (worldX: number, worldZ: number): number => {
    const fx = Math.max(0, Math.min(widthPx - 1, worldX / tileM));
    const fz = Math.max(0, Math.min(heightPx - 1, worldZ / tileM));
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fz);
    const c1 = Math.min(widthPx - 1, c0 + 1);
    const r1 = Math.min(heightPx - 1, r0 + 1);
    const tx = fx - c0;
    const tz = fz - r0;
    const h00 = heightmap[r0 * widthPx + c0];
    const h10 = heightmap[r0 * widthPx + c1];
    const h01 = heightmap[r1 * widthPx + c0];
    const h11 = heightmap[r1 * widthPx + c1];
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  };
}

/**
 * Build the projectile-path sampler. Same bilinear math BUT returns
 * `null` when (worldX, worldZ) falls outside the map AABB. The sim
 * decides what to do with `null` (current policy: treat as "no terrain"
 * + warn-once). Loud-over-silent: a projectile flying off the map is a
 * surfaced edge-case bug, not a silent collision at the cell edge.
 */
export function makeProjectileHeightSampler(
  map: LoadedMap,
): ProjectileHeightSampler {
  const tileM = map.manifest.terrain.tileSizeM ?? DEFAULT_TILE_SIZE_M;
  const widthPx = map.manifest.terrain.widthPx;
  const heightPx = map.manifest.terrain.heightPx;
  const heightmap = map.heightmap;
  const widthM = (widthPx - 1) * tileM;
  const depthM = (heightPx - 1) * tileM;
  return (worldX: number, worldZ: number): number | null => {
    if (worldX < 0 || worldZ < 0 || worldX > widthM || worldZ > depthM) {
      return null;
    }
    const fx = worldX / tileM;
    const fz = worldZ / tileM;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fz);
    const c1 = Math.min(widthPx - 1, c0 + 1);
    const r1 = Math.min(heightPx - 1, r0 + 1);
    const tx = fx - c0;
    const tz = fz - r0;
    const h00 = heightmap[r0 * widthPx + c0];
    const h10 = heightmap[r0 * widthPx + c1];
    const h01 = heightmap[r1 * widthPx + c0];
    const h11 = heightmap[r1 * widthPx + c1];
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  };
}
