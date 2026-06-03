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

import { spawnUnit, spawnWeaponInstance } from "../../sim/spawn";
import type { SimWorld } from "../../sim/world";
import { ScanRange } from "../../sim/world";
import { isWeapon } from "../../types/part";
import type { UnitSchematic } from "../../types/unit";
import { projectileMaxRange } from "../../sim/systems/weaponFireSystem";
import type {
  UnitTypeEntry,
  UnitTypeRegistry,
} from "../UnitTypeRegistry";
import type { PrefabBank } from "../loader/prefabBank";
import type { LoadDiagnostics } from "../loader/LoadDiagnostics";
import {
  NO_PROJECTILE_TYPE,
  type ProjectileRegistry,
} from "../ProjectileRegistry";
import type { LoadedSchematic } from "../loader/schematicLoader";
import {
  type InstancedUnitRenderer,
  DEFAULT_MAX_INSTANCES_PER_TYPE,
} from "../scene/InstancedUnitRenderer";

export interface SpawnPlan {
  /**
   * How many entities per registered unit type. With many types
   * picked (e.g. 32), keep this at 1 so the team's total stays in
   * the dozens — the spawner packs all units into a single square
   * grid per team. Larger values multiply the team total
   * (types × perTypeCount) and the grid grows accordingly.
   */
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
  /**
   * Phase 1 Week 3 — projectile registry + the original schematics so
   * we can resolve weapon part fields + projectile_id at spawn time.
   * Optional for backwards compatibility with the pre-Week-3 callers
   * (tests, legacy code paths). When omitted, no weapon-instance
   * entities are created — units spawn but cannot fire.
   */
  projectileRegistry?: ProjectileRegistry,
  schematics?: readonly LoadedSchematic[],
  /** Initial facing yaw radians (rotation around Y axis). 0 = +Z forward. */
  facingYawRad?: number,
  /**
   * Optional diagnostics collector — same one MatchLoader threads
   * through the load chain. Spawn-time skips (no mesh_asset, prefab
   * missing) push here so the HUD's "Load warnings" chip surfaces the
   * cause→effect chain (e.g. "prefab failed → spawner skipped → 0
   * entities") instead of the user seeing only the empty result.
   * Optional for the existing test bed.
   */
  diagnostics?: LoadDiagnostics,
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
      const msg = `unit type "${type.schematicId}" has no mesh_asset; skipping spawn.`;
      if (diagnostics) diagnostics.add({ source: "MatchSpawner", message: msg });
      else console.warn(`[MatchSpawner] ${msg}`);
      continue;
    }
    const prefab = prefabBank.get(type.meshRef);
    if (!prefab) {
      const msg = `no prefab cached for unit type "${type.schematicId}"; skipping spawn (see prior prefabBank warning for the underlying cause).`;
      if (diagnostics) diagnostics.add({ source: "MatchSpawner", message: msg });
      else console.warn(`[MatchSpawner] ${msg}`);
      continue;
    }
    renderer.register(type.typeId, prefab, DEFAULT_MAX_INSTANCES_PER_TYPE);
    renderableTypes.push(type);
  }
  if (renderableTypes.length === 0) {
    // The cause-chain ended in zero renderable types — every type was
    // skipped above. Push a SUMMARY entry so the HUD chip shows a
    // top-level "everyone got skipped" line in addition to the
    // per-type detail. Without this, the user sees "0 entities" and
    // the per-type lines might scroll past in long-warning cases.
    if (diagnostics) {
      diagnostics.add({
        source: "MatchSpawner",
        message: `all ${allTypes.length} unit type(s) were skipped at spawn time — nothing will render. See preceding entries for per-type causes.`,
      });
    }
    return 0;
  }

  // -------------------------------------------------------------------
  // Phase 2: spawn entities. All units across all types are arranged
  // into ONE square grid per team, centred on (originX, originZ).
  // This keeps the formation compact when the type count is large
  // (32 types × 1 = 64 units → 8×8 block) instead of a long off-map
  // stripe of per-type sub-grids. Side-by-side debugging of types is
  // no longer the dominant use case now that two teams engage; cluster
  // combat reads better with everyone tucked together.
  // -------------------------------------------------------------------
  let total = 0;
  const totalUnits = renderableTypes.length * plan.perTypeCount;
  const cols = Math.max(1, Math.ceil(Math.sqrt(totalUnits)));

  // Loud-over-silent: large formations chew framerate. Warn at 100+
  // so the dev sees "yep, expected" instead of guessing why FPS tanked.
  if (totalUnits > 100) {
    console.warn(
      `[MatchSpawner] team ${plan.teamId}: spawning ${totalUnits} units (${renderableTypes.length} types × ${plan.perTypeCount}) in a ${cols}-wide grid — FPS may drop with many fragmented sub-meshes per unit.`,
    );
  }

  // Build a quick id → schematic lookup for the optional weapon-spawn
  // pass. Done once outside the inner loops.
  const schematicById = new Map<string, UnitSchematic>();
  if (schematics) {
    for (const s of schematics) schematicById.set(s.unit.id, s.unit);
  }

  // Pre-compute facing quaternion (yaw around Y). q = (0, sin(y/2), 0, cos(y/2))
  const yaw = facingYawRad ?? 0;
  const halfYaw = yaw * 0.5;
  const qx0 = 0;
  const qy0 = Math.sin(halfYaw);
  const qz0 = 0;
  const qw0 = Math.cos(halfYaw);

  // Flatten the (type, instance) pairs into a single index `g` that
  // walks across the unified team grid. Each type still gets exactly
  // `perTypeCount` slots — they're just interleaved across the block
  // instead of getting their own strip.
  let g = 0;
  for (let typeIdx = 0; typeIdx < renderableTypes.length; typeIdx++) {
    const type = renderableTypes[typeIdx];
    const schematic = schematicById.get(type.schematicId);

    for (let i = 0; i < plan.perTypeCount; i++) {
      const row = Math.floor(g / cols);
      const col = g % cols;
      g++;
      // Centre the whole team's grid on (originX, originZ). Row/col
      // are mapped into local meters and added to the team origin.
      const localX = (col - (cols - 1) / 2) * spacingM;
      const localZ = (row - (cols - 1) / 2) * spacingM;
      const worldX = plan.originX + localX;
      const worldZ = plan.originZ + localZ;
      const worldY = heightAt(worldX, worldZ);

      const ownerEid = spawnUnit(world, {
        typeId: type.typeId,
        x: worldX,
        y: worldY,
        z: worldZ,
        qx: qx0,
        qy: qy0,
        qz: qz0,
        qw: qw0,
        maxHealth: type.maxHealth,
        teamId: plan.teamId,
      });
      total++;

      // ----------------------------------------------------------
      // Week 3: spawn per-hardpoint weapon instances.
      // ----------------------------------------------------------
      if (schematic && projectileRegistry) {
        const hardpoints = schematic.hardpoints ?? [];
        let unitMaxRange = 0;
        for (let h = 0; h < hardpoints.length; h++) {
          const hp = hardpoints[h];
          const partId = hp.weapon_part_id;
          if (!partId) continue;
          const part = (schematic.parts ?? []).find(
            (p) => p.id === partId,
          );
          if (!part || !isWeapon(part)) continue;
          const projId = part.projectile_id;
          let projTypeId: number = NO_PROJECTILE_TYPE;
          let rangeM = 0;
          if (projId && projId.length > 0) {
            const entry = projectileRegistry.bySchematic(projId);
            if (entry) {
              projTypeId = entry.typeId;
              rangeM = projectileMaxRange(entry.schematic);
              unitMaxRange = Math.max(unitMaxRange, rangeM);
            }
          }
          spawnWeaponInstance(world, {
            ownerEid,
            hardpointIdx: h,
            projectileTypeId: projTypeId,
            chargeTimeMs: part.charge_time_ms ?? 0,
            fireRateMs: part.fire_rate_ms ?? 0,
            burstCount: part.burst_count ?? 1,
            burstDelayMs: part.burst_delay_ms ?? part.fire_rate_ms ?? 0,
            cooldownMs: part.cooldown_ms ?? 600, // default ~0.6s
            thermalCapMj: part.barrel_thermal_capacity_MJ ?? 50,
            heatPerShotMj: part.per_shot_heat_MJ ?? 0,
            coolRateMjs: part.cooling_rate_MJs ?? 1,
            rangeM,
          });
        }
        // Override ScanRange — give each unit a scan slightly larger
        // than its weapon range so it can acquire just outside firing
        // distance and close to engage. Floor at 60m so even a
        // melee unit can find someone.
        if (unitMaxRange > 0) {
          ScanRange.value[ownerEid] = Math.max(60, unitMaxRange * 1.2);
        }
      }
    }
  }
  return total;
}
