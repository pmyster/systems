/**
 * /sim/spawn.ts — Phase 1 Week 1C
 *
 * Pure, headless entity factory for the sim. Allocates one bitECS entity
 * and stamps the foundational components every unit needs (Position,
 * Rotation, Health, TeamId, UnitTypeId, Renderable).
 *
 * Why "pure"?
 *   This file lives under `/sim` so it must pass `npm run check:sim-purity`:
 *   NO wall-clock reads (Date.now, performance.now), NO Math.random.
 *   Determinism contract — two SimRunners with the same seed + the same
 *   spawn calls in the same order produce identical worlds. Position +
 *   quaternion arrive as numbers from the caller; the caller is the one
 *   responsible for any randomness (and only via SimRandom).
 *
 * Single-entity granularity:
 *   `spawnUnit` creates ONE entity. Multi-spawn orchestration (loops over
 *   plans, registry lookups, prefab registration with the renderer) lives
 *   one layer up in `/runtime/spawning/MatchSpawner.ts` — that layer knows
 *   about Three.js and the type registry, so it cannot live in `/sim`.
 *
 * Component set chosen here (and not more) because these are the six
 * components every unit needs on day one. Velocity / Path / Target /
 * SelectionTag etc. land when the system that consumes them lands — per
 * the "data shape follows the consumer, not the speculation" rule.
 */

import { addEntity, addComponent } from "bitecs";

import {
  Position,
  Rotation,
  Health,
  TeamId,
  UnitTypeId,
  Renderable,
  MovementTarget,
  MovementSpeed,
  Stance,
  StanceValue,
  TargetOf,
  ScanRange,
  LeashOrigin,
  OwnerEid,
  WeaponHardpointIdx,
  WeaponTiming,
  WeaponTimingSpec,
  WeaponHeat,
  WeaponThermalSpec,
  WeaponOverheatLock,
  WeaponTarget,
  WeaponRange,
  WeaponInstanceTag,
  WeaponStateValue,
  ProjectileTypeId,
  NO_ENTITY,
  NO_PROJECTILE_TYPE,
  type SimWorld,
} from "./world";

/**
 * Default per-entity walk speed in m/sec. Picked as a "feels right"
 * RTS pace for the Week 2 MVP — fast enough that the dev can verify
 * pathing on a 128 m map within a few seconds, slow enough that
 * crowd avoidance is visibly doing work. Real values land per-unit
 * via the schematic in Week 3.
 */
const DEFAULT_MOVEMENT_SPEED_M_PER_SEC = 5;

/**
 * bitECS 0.4 next-API note:
 *   `addComponent(world, eid, component)` — entity id is the SECOND arg.
 *   The 0.3 legacy API had `(world, component, eid)`. We're on 0.4.
 *   The component schema arrays (e.g. `Position.x`) are still ArrayLike
 *   in shape but typed in this codebase via `bitecs-legacy.d.ts` as
 *   `ArrayLike<number> & { [i: number]: number }` — assignable like a
 *   plain typed-array slot.
 */

export interface SpawnParams {
  /** Index into the runtime UnitTypeRegistry. ui16-bounded. */
  readonly typeId: number;
  /** World-space spawn position in meters (Y is up). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Orientation as a unit quaternion (x, y, z, w). Identity = (0,0,0,1). */
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  /** Health.current + Health.max are both seeded to this value. */
  readonly maxHealth: number;
  /** Team / faction tag (0..255). */
  readonly teamId: number;
}

/**
 * Spawn ONE entity with the foundational component set. Returns the new
 * entity id so the caller can hold a reference (e.g. for spawn-point logs
 * or test assertions).
 *
 * Component ordering matches `world.ts` definition order — purely a
 * readability convention, not a determinism requirement (bitECS storage
 * is SoA and per-component, so add order doesn't affect layout).
 */
export function spawnUnit(world: SimWorld, p: SpawnParams): number {
  const eid = addEntity(world);

  addComponent(world, eid, Position);
  Position.x[eid] = p.x;
  Position.y[eid] = p.y;
  Position.z[eid] = p.z;

  addComponent(world, eid, Rotation);
  Rotation.x[eid] = p.qx;
  Rotation.y[eid] = p.qy;
  Rotation.z[eid] = p.qz;
  Rotation.w[eid] = p.qw;

  addComponent(world, eid, Health);
  Health.current[eid] = p.maxHealth;
  Health.max[eid] = p.maxHealth;

  addComponent(world, eid, TeamId);
  TeamId.value[eid] = p.teamId;

  addComponent(world, eid, UnitTypeId);
  UnitTypeId.value[eid] = p.typeId;

  // Tag component — empty schema. Marks this entity as a candidate for
  // the InstancedUnitRenderer sync each frame.
  addComponent(world, eid, Renderable);

  // ------------------------------------------------------------------
  // Week 2 — movement + stance scaffolding.
  //
  // Stamp MovementTarget with hasTarget=0 so the movementSystem can
  // unconditionally read it without a "does this entity have a target?"
  // hasComponent check on the hot path. MovementSpeed defaults to the
  // module constant; per-unit speed override lands when the schematic
  // ships a movement.speed_m_per_sec field. Stance defaults to
  // Defensive — the safest BAR-style behavior (return fire, leash on
  // 0.5× scan range), matches the brief.
  // ------------------------------------------------------------------
  addComponent(world, eid, MovementTarget);
  MovementTarget.x[eid] = 0;
  MovementTarget.y[eid] = 0;
  MovementTarget.z[eid] = 0;
  MovementTarget.hasTarget[eid] = 0;

  addComponent(world, eid, MovementSpeed);
  MovementSpeed.value[eid] = DEFAULT_MOVEMENT_SPEED_M_PER_SEC;

  addComponent(world, eid, Stance);
  Stance.value[eid] = StanceValue.Defensive;

  // ------------------------------------------------------------------
  // Week 3 — combat-acquisition scaffolding.
  //
  // TargetOf is NO_ENTITY (=0) until the targetAcquisitionSystem
  // assigns one. ScanRange defaults to a "feels-right" 80m so the
  // mk01-vs-mk01 fight at the spawn distance (60m apart) acquires on
  // tick 0 — keeps the 30-second engagement readable. Real values get
  // overridden by MatchSpawner after looking up the unit's weapons.
  //
  // LeashOrigin pins where pursuit decisions get measured from. We
  // stamp it to the spawn position so a unit ordered to attack a
  // distant enemy doesn't infinitely chase it across the map.
  // ------------------------------------------------------------------
  addComponent(world, eid, TargetOf);
  TargetOf.value[eid] = NO_ENTITY;

  addComponent(world, eid, ScanRange);
  ScanRange.value[eid] = 80;

  addComponent(world, eid, LeashOrigin);
  LeashOrigin.x[eid] = p.x;
  LeashOrigin.z[eid] = p.z;

  return eid;
}

/**
 * Parameters for spawning ONE weapon-instance entity attached to a
 * unit. Per A.3, units with N hardpoints get N weapon entities —
 * each runs its own state machine and acquires its own target. The
 * caller (MatchSpawner) reads the authored hardpoint + weapon part
 * and translates the fields here.
 */
export interface SpawnWeaponParams {
  readonly ownerEid: number;
  /** Index into the unit schematic's `hardpoints[]` array. */
  readonly hardpointIdx: number;
  /** Numeric id from the ProjectileRegistry. NO_PROJECTILE_TYPE = inert. */
  readonly projectileTypeId: number;
  /** From WeaponPart.charge_time_ms ?? 0. */
  readonly chargeTimeMs: number;
  /** From WeaponPart.fire_rate_ms ?? 0. */
  readonly fireRateMs: number;
  /** From WeaponPart.burst_count ?? 1. */
  readonly burstCount: number;
  /** From WeaponPart.burst_delay_ms ?? fire_rate_ms ?? 0. */
  readonly burstDelayMs: number;
  /** From WeaponPart.cooldown_ms ?? 0. */
  readonly cooldownMs: number;
  /** From WeaponPart.barrel_thermal_capacity_MJ ?? 50. */
  readonly thermalCapMj: number;
  /** From WeaponPart.per_shot_heat_MJ ?? 0. */
  readonly heatPerShotMj: number;
  /** From WeaponPart.cooling_rate_MJs ?? 1. */
  readonly coolRateMjs: number;
  /** Derived effective range in meters. */
  readonly rangeM: number;
}

/**
 * Spawn one weapon-instance entity. Returns the new eid for tests +
 * MatchSpawner logging. The weapon-instance entity carries NO
 * Position/Rotation of its own — the render-side reads the owning
 * unit's Position + the authored hardpoint local_position to place
 * muzzle flashes + projectile origins.
 */
export function spawnWeaponInstance(
  world: SimWorld,
  p: SpawnWeaponParams,
): number {
  const eid = addEntity(world);

  addComponent(world, eid, WeaponInstanceTag);

  addComponent(world, eid, OwnerEid);
  OwnerEid.value[eid] = p.ownerEid;

  addComponent(world, eid, WeaponHardpointIdx);
  WeaponHardpointIdx.value[eid] = p.hardpointIdx;

  addComponent(world, eid, WeaponTiming);
  WeaponTiming.state[eid] = WeaponStateValue.Idle;
  WeaponTiming.timerMs[eid] = 0;
  WeaponTiming.burstShotsFired[eid] = 0;

  addComponent(world, eid, WeaponTimingSpec);
  WeaponTimingSpec.chargeTimeMs[eid] = p.chargeTimeMs;
  WeaponTimingSpec.fireRateMs[eid] = p.fireRateMs;
  WeaponTimingSpec.burstCount[eid] = Math.max(1, p.burstCount);
  WeaponTimingSpec.burstDelayMs[eid] = p.burstDelayMs;
  WeaponTimingSpec.cooldownMs[eid] = p.cooldownMs;

  addComponent(world, eid, WeaponHeat);
  WeaponHeat.currentMj[eid] = 0;

  addComponent(world, eid, WeaponThermalSpec);
  WeaponThermalSpec.capacityMj[eid] = p.thermalCapMj;
  WeaponThermalSpec.heatPerShotMj[eid] = p.heatPerShotMj;
  WeaponThermalSpec.coolRateMjs[eid] = p.coolRateMjs;

  addComponent(world, eid, WeaponOverheatLock);
  WeaponOverheatLock.value[eid] = 0;

  addComponent(world, eid, WeaponTarget);
  WeaponTarget.value[eid] = NO_ENTITY;

  addComponent(world, eid, WeaponRange);
  WeaponRange.value[eid] = p.rangeM;

  addComponent(world, eid, ProjectileTypeId);
  ProjectileTypeId.value[eid] =
    p.projectileTypeId >= 0 && p.projectileTypeId < NO_PROJECTILE_TYPE
      ? p.projectileTypeId
      : NO_PROJECTILE_TYPE;

  return eid;
}
