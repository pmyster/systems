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
import {
  ScanRange,
  MovementSpeed,
  MovementTarget,
  AAFiringArc,
  BunkerHealRange,
  WallNoFire,
} from "../../sim/world";
import { removeComponent } from "bitecs";
import { isWeapon } from "../../types/part";
import type { UnitSchematic, BuildingChassisClass } from "../../types/unit";
import { isBuildingChassis } from "../../types/unit";
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
import { addComponent } from "bitecs";
import type { BuildingPlacement } from "../BuildingPlacement";
import { FACTION_NEUTRAL } from "../BuildingPlacement";

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
  //
  // Phase 2 Stage 1: BUILDING types are registered with the renderer
  // (so the placed-buildings spawn path can draw them) but are EXCLUDED
  // from the team-cluster grid below — placed buildings come from
  // `spawnPlacedBuildings`, not from this default 1-per-type grid.
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
    // Buildings get rendered but not grid-spawned — see header note. We
    // keep them out of renderableTypes so the team-cluster pass below
    // doesn't accidentally instantiate one in the unit formation.
    if (schematicIsBuilding(type, schematics)) continue;
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

// ---------------------------------------------------------------------------
// Phase 2 Stage 1 — building helpers + placed-buildings spawn path.
// ---------------------------------------------------------------------------

/**
 * Is this unit type a building? Looks up the schematic to get the
 * chassis_class. Returns false if the schematic isn't found (defensive —
 * an unregistered schematic shouldn't be in the registry, but if it
 * somehow is, default to "not a building" so the legacy path doesn't
 * silently lose a unit).
 */
function schematicIsBuilding(
  type: UnitTypeEntry,
  schematics: readonly LoadedSchematic[] | undefined,
): boolean {
  if (!schematics) return false;
  const s = schematics.find((x) => x.unit.id === type.schematicId);
  if (!s) return false;
  return isBuildingChassis(s.unit.chassis.chassis_class);
}

/**
 * Tunable per-chassis-class building behavior knobs.
 *
 * These constants live here (not in the schematic) because they describe
 * a CHASSIS-CLASS behavior, not an authored unit-instance behavior. A
 * future change can promote any of these to a schematic field; until
 * then a single source of truth keeps the four building variants
 * coherent.
 *
 * Per CLAUDE.md "adaptive over specific": when a 5th building class
 * lands, add ONE entry here + the chassis case in proceduralMeshes.ts;
 * the rest of MatchSpawner picks it up automatically because the
 * dispatch uses object lookup, not a hardcoded switch.
 */
interface BuildingBehaviorTuning {
  /** AA towers — pitch arc gate for target acquisition (radians). */
  readonly aaPitchMinRad?: number;
  readonly aaPitchMaxRad?: number;
  /** Bunkers — heal radius (m) + heal per tick (MJ). */
  readonly bunkerRadiusM?: number;
  readonly bunkerHealPerTickMj?: number;
}

const BUILDING_TUNING: Readonly<
  Record<BuildingChassisClass, BuildingBehaviorTuning>
> = {
  building_turret: {},
  building_wall: {},
  // ~20° above horizontal (0.349 rad). Stage 1: with no flying units
  // present this means AA acquires nothing — see header note in
  // /sim/systems/targetAcquisitionSystem.ts for the post-Flying-tag swap.
  building_aa: { aaPitchMinRad: 0.349, aaPitchMaxRad: 1.484 },
  // 12 m radius, 1 MJ/tick (= 30 MJ/sec at 30 Hz). Tunable here.
  building_bunker: { bunkerRadiusM: 12, bunkerHealPerTickMj: 1 },
};

/**
 * Resolve a building chassis class to the registered schematic + type
 * entry. Buildings are matched by chassis class because the placement
 * UI only knows the class — the user picked "Turret", not a specific
 * authored schematic. Returns null if no schematic of this class is
 * registered (loud-over-silent in the caller).
 *
 * If multiple schematics share a chassis class (e.g. two turret variants
 * authored), the FIRST registered wins. Stage 1 ships one per class so
 * this is unambiguous. Stage 2's in-match build mode will widen this to
 * a variant picker.
 */
function findBuildingSchematic(
  chassis: BuildingChassisClass,
  registry: UnitTypeRegistry,
  schematics: readonly LoadedSchematic[],
): { type: UnitTypeEntry; schematic: UnitSchematic } | null {
  for (const s of schematics) {
    if (s.unit.chassis.chassis_class === chassis) {
      const type = registry.bySchematic(s.unit.id);
      if (type) return { type, schematic: s.unit };
    }
  }
  return null;
}

/**
 * Spawn every placed building from the Match Setup placement step.
 *
 * Per-placement flow:
 *   1. Look up the matching schematic by chassis_class. Loud-warn + skip
 *      if no schematic registered (the user placed a turret without
 *      picking the turret schematic in Phase 3 — surface it).
 *   2. spawnUnit at (x, heightAt(x,z), z) with the authored faction.
 *   3. Remove MovementSpeed → movementSystem early-exits (buildings
 *      don't move). MovementTarget stays at hasTarget=0.
 *   4. Stamp chassis-class-specific components: AAFiringArc for AA,
 *      BunkerHealRange for bunkers, WallNoFire tag for walls. Turrets
 *      get no extra component (they fight via the standard hardpoint
 *      pipeline).
 *   5. For armed buildings (turret, AA), spawn weapon instances using
 *      the same logic spawnInitialUnits does — single shared code path.
 *      Walls + bunkers skip this entirely (loud-warn if author put a
 *      hardpoint on a wall).
 *
 * Once per match: if AA buildings exist and no flying targets are
 * present (Stage 1 = always), push a single startup info-level log
 * line so the owner sees "AA towers idle by design — no aircraft yet".
 *
 * Returns total entities spawned.
 */
export function spawnPlacedBuildings(
  world: SimWorld,
  registry: UnitTypeRegistry,
  prefabBank: PrefabBank,
  renderer: InstancedUnitRenderer,
  placements: readonly BuildingPlacement[],
  heightAt: HeightSampler,
  schematics: readonly LoadedSchematic[],
  projectileRegistry: ProjectileRegistry,
  diagnostics?: LoadDiagnostics,
): number {
  if (placements.length === 0) return 0;

  // Make sure every building chassis used by placements is registered
  // with the renderer (in case spawnInitialUnits hasn't run yet or
  // skipped it). Idempotent — the renderer no-ops a second register.
  for (const p of placements) {
    const found = findBuildingSchematic(p.chassis_class, registry, schematics);
    if (!found) continue;
    const meshRef = found.type.meshRef;
    if (!meshRef) continue;
    const prefab = prefabBank.get(meshRef);
    if (!prefab) continue;
    renderer.register(found.type.typeId, prefab, DEFAULT_MAX_INSTANCES_PER_TYPE);
  }

  let total = 0;
  let anyAA = false;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const found = findBuildingSchematic(p.chassis_class, registry, schematics);
    if (!found) {
      const msg = `placement #${i} chassis "${p.chassis_class}" — no schematic of that class registered; skipping. Pick the corresponding building schematic in the Units step.`;
      if (diagnostics) diagnostics.add({ source: "MatchSpawner", message: msg });
      else console.warn(`[MatchSpawner] ${msg}`);
      continue;
    }
    const { type, schematic } = found;

    // Compose yaw → quaternion around Y.
    const halfYaw = p.rotation_y * 0.5;
    const qy = Math.sin(halfYaw);
    const qw = Math.cos(halfYaw);

    const wx = p.position_xz[0];
    const wz = p.position_xz[1];
    const wy = heightAt(wx, wz);

    const eid = spawnUnit(world, {
      typeId: type.typeId,
      x: wx,
      y: wy,
      z: wz,
      qx: 0,
      qy,
      qz: 0,
      qw,
      maxHealth: type.maxHealth,
      teamId: p.faction,
    });
    total++;

    // Buildings don't move — remove MovementSpeed so movementSystem
    // early-exits. (spawnUnit always stamps a default speed; this is
    // the surgical override for buildings.)
    removeComponent(world, eid, MovementSpeed);
    // Also clear MovementTarget hasTarget — defensive, in case a
    // future system writes to it before checking the speed.
    MovementTarget.hasTarget[eid] = 0;

    // Stamp chassis-class behavior components.
    const tuning = BUILDING_TUNING[p.chassis_class];
    switch (p.chassis_class) {
      case "building_aa": {
        addComponent(world, eid, AAFiringArc);
        AAFiringArc.pitchMinRad[eid] = tuning.aaPitchMinRad ?? 0.349;
        AAFiringArc.pitchMaxRad[eid] = tuning.aaPitchMaxRad ?? 1.484;
        anyAA = true;
        break;
      }
      case "building_bunker": {
        addComponent(world, eid, BunkerHealRange);
        BunkerHealRange.radiusM[eid] = tuning.bunkerRadiusM ?? 12;
        BunkerHealRange.healPerTickMj[eid] = tuning.bunkerHealPerTickMj ?? 1;
        break;
      }
      case "building_wall": {
        addComponent(world, eid, WallNoFire);
        // Loud-over-silent: if author accidentally put a hardpoint on
        // a wall, surface it — walls don't shoot. We DO NOT spawn the
        // weapon instance below; the warning is enough.
        if (schematic.hardpoints && schematic.hardpoints.length > 0) {
          const msg = `wall schematic "${schematic.id}" has ${schematic.hardpoints.length} hardpoint(s); walls do not shoot. Hardpoints ignored.`;
          if (diagnostics) diagnostics.add({ source: "MatchSpawner", message: msg });
          else console.warn(`[MatchSpawner] ${msg}`);
        }
        break;
      }
      case "building_turret": {
        // No extra component — turrets fight via the standard
        // hardpoint + weapon-instance pipeline below.
        break;
      }
    }

    // Spawn weapon instances for armed buildings (turret, AA). Walls +
    // bunkers skip the weapon pass entirely.
    if (p.chassis_class === "building_wall" || p.chassis_class === "building_bunker") {
      continue;
    }
    const hardpoints = schematic.hardpoints ?? [];
    let unitMaxRange = 0;
    for (let h = 0; h < hardpoints.length; h++) {
      const hp = hardpoints[h];
      const partId = hp.weapon_part_id;
      if (!partId) continue;
      const part = (schematic.parts ?? []).find((q) => q.id === partId);
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
        ownerEid: eid,
        hardpointIdx: h,
        projectileTypeId: projTypeId,
        chargeTimeMs: part.charge_time_ms ?? 0,
        fireRateMs: part.fire_rate_ms ?? 0,
        burstCount: part.burst_count ?? 1,
        burstDelayMs: part.burst_delay_ms ?? part.fire_rate_ms ?? 0,
        cooldownMs: part.cooldown_ms ?? 600,
        thermalCapMj: part.barrel_thermal_capacity_MJ ?? 50,
        heatPerShotMj: part.per_shot_heat_MJ ?? 0,
        coolRateMjs: part.cooling_rate_MJs ?? 1,
        rangeM,
      });
    }
    // Buildings get longer scan: 1.5× weapon range (vs 1.2× for mobile
    // units) so they engage from full distance — they're not mobile,
    // so a tight scan radius would feel sluggish.
    if (unitMaxRange > 0) {
      ScanRange.value[eid] = Math.max(80, unitMaxRange * 1.5);
    }
  }

  // Loud-warn-once if AA towers were spawned but Stage 1 has no flying
  // targets in the world (always, for now). Helps the owner understand
  // why the AA never fires.
  if (anyAA) {
    const msg = `Stage 1 — ${placements.filter((p) => p.chassis_class === "building_aa").length} AA tower(s) placed but no flying units exist; AA will stay Idle. Working as designed until aircraft chassis classes land.`;
    if (diagnostics) diagnostics.add({ source: "MatchSpawner", message: msg });
    else console.info(`[MatchSpawner] ${msg}`);
  }

  // Suppress unused-warn for FACTION_NEUTRAL since Stage 1 doesn't use
  // it but downstream stages will and the import is intentional.
  void FACTION_NEUTRAL;
  return total;
}
