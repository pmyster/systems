/**
 * MatchSpawner — Phase 1 Week 1C
 *
 * Orchestrates the initial unit-spawn pass after a MatchData has loaded.
 *
 * Responsibilities:
 *   1. Register every unit type in the `UnitTypeRegistry` with the
 *      `InstancedUnitRenderer` (one InstancedMesh per type, capacity 256).
 *   2. For each type, spawn `perTypeCount` ECS entities in a tidy grid
 *      offset from the map's origin so the dev can see each group
 *      side-by-side.
 *   3. Sample terrain height under each spawn position so units sit on
 *      the ground rather than at y = 0.
 *
 * Not in scope (deferred to later weeks per the brief):
 *   - Spawn-point-driven placement (using `map.spawnPoints[]`) — that
 *     lands in Week 2 once selection/commands are live.
 *   - Multi-team spawning — Week 2.
 *   - Variable counts per type — Week 2.
 *
 * Architectural rule: this file is allowed to touch Three.js + the
 * runtime layer because it lives under `/runtime`, NOT `/sim`. The
 * actual entity creation happens in `/sim/spawn.ts` (pure). This file
 * is the only place that knows about both the type registry AND the
 * prefab bank — the seam between "data we loaded from disk" and
 * "components we wrote into bitECS".
 */

import { spawnUnit } from "../../sim/spawn";
import type { SimWorld } from "../../sim/world";
import type {
  UnitTypeEntry,
  UnitTypeRegistry,
} from "../UnitTypeRegistry";
import type { PrefabBank } from "../loader/prefabBank";
import {
  type InstancedUnitRenderer,
  DEFAULT_MAX_INSTANCES_PER_TYPE,
} from "../scene/InstancedUnitRenderer";

export interface SpawnPlan {
  /** How many entities per registered unit type. Week 1C default = 5. */
  readonly perTypeCount: number;
  /** Team / faction tag stamped onto every entity. Week 1C default = 0. */
  readonly teamId: number;
  /** Spawn origin (map center) in world meters. */
  readonly originX: number;
  readonly originZ: number;
  /** Grid spacing between adjacent entities of the same type, in meters. */
  readonly spacingM?: number;
}

const DEFAULT_SPACING_M = 6.0;

/**
 * Sample callback the spawner uses to plant each entity on the ground.
 * Returning a constant Y is legal (the units float at that height) —
 * the runtime passes a bilinear heightmap sampler from `RuntimeTerrain`.
 */
export type HeightSampler = (worldX: number, worldZ: number) => number;

/**
 * Spawn the initial wave: register each type with the renderer, then
 * place `plan.perTypeCount` entities of each type in a small grid near
 * the spawn origin. Types are arranged side-by-side along X so the dev
 * sees each group as a distinct cluster.
 *
 * Returns the total number of entities spawned (for HUD + debug logs).
 *
 * Loud-over-silent:
 *   - A type with no `meshRef` (authored without a mesh_asset) is
 *     skipped with a console.warn — that unit cannot render so spawning
 *     it would create invisible entities.
 *   - A type whose prefab failed to load (already warned by MatchLoader)
 *     is also skipped here, with a follow-up warn so the cause→effect
 *     chain is visible in the dev console.
 */
export function spawnInitialUnits(
  world: SimWorld,
  registry: UnitTypeRegistry,
  prefabBank: PrefabBank,
  renderer: InstancedUnitRenderer,
  plan: SpawnPlan,
  heightAt: HeightSampler,
): number {
  const spacingM = plan.spacingM ?? DEFAULT_SPACING_M;
  const allTypes = registry.all();
  if (allTypes.length === 0) return 0;

  // -------------------------------------------------------------------
  // Phase 1: register every type with the renderer. Skip types missing
  // a mesh or whose prefab didn't load. The result is the SUBSET of
  // types that are actually renderable.
  // -------------------------------------------------------------------
  const renderableTypes: UnitTypeEntry[] = [];
  for (const type of allTypes) {
    if (!type.meshRef) {
      console.warn(
        `[MatchSpawner] unit type "${type.schematicId}" has no mesh_asset; skipping spawn.`,
      );
      continue;
    }
    const prefab = prefabBank.get(type.meshRef);
    if (!prefab) {
      console.warn(
        `[MatchSpawner] no prefab cached for unit type "${type.schematicId}"; skipping spawn.`,
      );
      continue;
    }
    renderer.register(type.typeId, prefab, DEFAULT_MAX_INSTANCES_PER_TYPE);
    renderableTypes.push(type);
  }
  if (renderableTypes.length === 0) return 0;

  // -------------------------------------------------------------------
  // Phase 2: spawn entities. Each type's instances form a small square
  // grid centred on a per-type X offset; groups march along X so the
  // dev can pan the camera and see each cluster separately.
  // -------------------------------------------------------------------
  let total = 0;
  const colsPerRow = Math.max(1, Math.ceil(Math.sqrt(plan.perTypeCount)));
  // Width of one type's grid + a one-cell gap before the next type.
  const groupStrideM = spacingM * (colsPerRow + 1);

  for (let typeIdx = 0; typeIdx < renderableTypes.length; typeIdx++) {
    const type = renderableTypes[typeIdx];
    // Centre the strip of groups on origin: types are laid out along X.
    const groupOffsetX =
      (typeIdx - (renderableTypes.length - 1) / 2) * groupStrideM;

    for (let i = 0; i < plan.perTypeCount; i++) {
      const row = Math.floor(i / colsPerRow);
      const col = i % colsPerRow;
      // Centre the per-type grid on its group origin.
      const localX = (col - (colsPerRow - 1) / 2) * spacingM;
      const localZ = (row - (colsPerRow - 1) / 2) * spacingM;
      const worldX = plan.originX + groupOffsetX + localX;
      const worldZ = plan.originZ + localZ;
      const worldY = heightAt(worldX, worldZ);

      spawnUnit(world, {
        typeId: type.typeId,
        x: worldX,
        y: worldY,
        z: worldZ,
        // Quaternion identity — units face their authored forward.
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        maxHealth: type.maxHealth,
        teamId: plan.teamId,
      });
      total++;
    }
  }
  return total;
}
