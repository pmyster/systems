/**
 * /sim/systems/weaponFireSystem.ts — Phase 1 Week 3
 *
 * Per-tick weapon state machine. For each WeaponInstance:
 *
 *   Idle    → if WeaponTarget valid + heat below hysteresis floor:
 *             enter Charging, reset timer.
 *   Charging→ tick timer; once ≥ charge_time_ms enter Bursting,
 *             reset burst counter.
 *   Bursting→ fire ONE shot (emit projectile spawn + weapon_fired
 *             event), add heat, increment burst counter. If counter
 *             < burst_count enter BurstWait with timer=0; else enter
 *             Cooldown.
 *   BurstWait→ tick timer; once ≥ burst_delay_ms (or fire_rate_ms
 *             fallback) re-enter Bursting.
 *   Cooldown→ tick timer; once ≥ cooldown_ms return to Idle.
 *
 * Thermal:
 *   - Heat dissipates every tick: heat -= cool_rate * dt (floored 0).
 *   - Hysteresis: enter overheat-lock when heat > 70% of capacity;
 *     clear lock when heat falls below 60%. While locked the state
 *     machine refuses to leave Cooldown (or to enter Charging from
 *     Idle).
 *
 * Per-hardpoint geometry:
 *   This system DOES NOT know where the muzzle is in world space. The
 *   render side computes that from the owning unit's Rotation +
 *   authored hardpoint local_position when consuming the
 *   weapon_fired event. We pass a callback that returns
 *   `(muzzleX, muzzleY, muzzleZ)` from `(ownerEid, hardpointIdx)`.
 *   In tests the callback can be a stub returning the owner's
 *   Position untransformed.
 *
 * Projectile schema lookup:
 *   We need the authored ProjectileSchematic to compute spawn
 *   velocity, muzzle velocity, and max range. The callback returns
 *   `ProjectileSchematic | undefined`; an undefined return means the
 *   weapon can't fire this tick (logged once per weapon-id pair).
 *
 * Sim-purity: typed-array reads, no clocks, no Math.random. The
 * callbacks must be pure too — render-side passes thin wrappers over
 * Three.js but the contract here is "given this eid + idx, return
 * these numbers".
 */

import { query, hasComponent } from "bitecs";

import type { ProjectileSchematic } from "../../types/projectile";
import type { SimEventLog } from "../events";
import {
  Dead,
  Health,
  OwnerEid,
  Position,
  ProjectileTypeId,
  Rotation,
  TeamId,
  WeaponHardpointIdx,
  WeaponHeat,
  WeaponInstanceTag,
  WeaponOverheatLock,
  WeaponStateValue,
  WeaponTarget,
  WeaponThermalSpec,
  WeaponTiming,
  WeaponTimingSpec,
  NO_ENTITY,
  NO_PROJECTILE_TYPE,
  type SimWorld,
} from "../world";

/**
 * Resolves (ownerEid, hardpointIdx) → world-space muzzle (x,y,z) +
 * forward direction (unit vector, XZ plane).
 *
 * Render-side implementation uses THREE.Quaternion to transform the
 * authored local_position by the unit's world rotation; tests can
 * return `{ x: owner.x, y: owner.y, z: owner.z, fx: 0, fz: 1 }` for
 * simplicity.
 */
export type MuzzleResolver = (
  ownerEid: number,
  hardpointIdx: number,
) => { x: number; y: number; z: number; fx: number; fz: number };

/** Resolves a numeric typeId → authored ProjectileSchematic. */
export type ProjectileLookup = (
  typeId: number,
) => ProjectileSchematic | undefined;

/**
 * One pending projectile spawn produced this tick. The
 * projectileSpawnSystem reads this queue and materialises entities.
 */
export interface PendingProjectileSpawn {
  readonly ownerEid: number;
  readonly weaponEid: number;
  readonly hardpointIdx: number;
  readonly teamId: number;
  readonly targetEid: number;
  readonly projectileTypeId: number;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly rangeM: number;
}

const HYST_HIGH = 0.7; // engage overheat-lock above this fraction of capacity
const HYST_LOW = 0.6; // release lock below this fraction

const WEAPON_QUERY = [
  WeaponInstanceTag,
  WeaponTiming,
  WeaponTimingSpec,
  WeaponHeat,
  WeaponThermalSpec,
  WeaponTarget,
  OwnerEid,
  ProjectileTypeId,
  WeaponHardpointIdx,
  WeaponOverheatLock,
];

export function weaponFireSystem(
  world: SimWorld,
  dtSec: number,
  events: SimEventLog,
  resolveMuzzle: MuzzleResolver,
  lookupProjectile: ProjectileLookup,
  pendingSpawns: PendingProjectileSpawn[],
  currentTick: number,
): void {
  const dtMs = dtSec * 1000;
  const weapons = query(world, WEAPON_QUERY);
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i];
    const owner = OwnerEid.value[w];
    if (owner === NO_ENTITY) continue;
    if (hasComponent(world, owner, Dead)) continue;
    if (Health.current[owner] <= 0) continue;

    // -------- Heat dissipation --------------------------------------
    const cap = WeaponThermalSpec.capacityMj[w];
    const cool = WeaponThermalSpec.coolRateMjs[w];
    let heat = WeaponHeat.currentMj[w];
    heat = Math.max(0, heat - cool * dtSec);
    WeaponHeat.currentMj[w] = heat;

    // -------- Hysteresis lock ---------------------------------------
    let locked = WeaponOverheatLock.value[w] !== 0;
    if (!locked && cap > 0 && heat > HYST_HIGH * cap) {
      locked = true;
    } else if (locked && (cap <= 0 || heat < HYST_LOW * cap)) {
      locked = false;
    }
    WeaponOverheatLock.value[w] = locked ? 1 : 0;

    const target = WeaponTarget.value[w];
    const targetValid =
      target !== NO_ENTITY &&
      !hasComponent(world, target, Dead) &&
      Health.current[target] > 0;

    const state = WeaponTiming.state[w];
    let timer = WeaponTiming.timerMs[w] + dtMs;
    let burstShots = WeaponTiming.burstShotsFired[w];

    const chargeMs = WeaponTimingSpec.chargeTimeMs[w];
    const fireRateMs = WeaponTimingSpec.fireRateMs[w];
    const burstCount = Math.max(1, WeaponTimingSpec.burstCount[w]);
    const burstDelayMs = WeaponTimingSpec.burstDelayMs[w] > 0
      ? WeaponTimingSpec.burstDelayMs[w]
      : fireRateMs;
    const cooldownMs = WeaponTimingSpec.cooldownMs[w];

    switch (state) {
      case WeaponStateValue.Idle: {
        if (!targetValid || locked) {
          WeaponTiming.timerMs[w] = 0;
          break;
        }
        // Enter Charging.
        WeaponTiming.state[w] = WeaponStateValue.Charging;
        WeaponTiming.timerMs[w] = 0;
        WeaponTiming.burstShotsFired[w] = 0;
        break;
      }
      case WeaponStateValue.Charging: {
        if (!targetValid) {
          // Target lost mid-charge — back to idle, lose the charge.
          WeaponTiming.state[w] = WeaponStateValue.Idle;
          WeaponTiming.timerMs[w] = 0;
          break;
        }
        if (timer >= chargeMs) {
          // Fall through to Bursting (fire one shot THIS tick).
          WeaponTiming.state[w] = WeaponStateValue.Bursting;
          WeaponTiming.timerMs[w] = 0;
          WeaponTiming.burstShotsFired[w] = 0;
          tryFire(
            world,
            w,
            owner,
            target,
            events,
            resolveMuzzle,
            lookupProjectile,
            pendingSpawns,
            currentTick,
          );
          burstShots = WeaponTiming.burstShotsFired[w];
          // After firing one shot decide whether to BurstWait or
          // Cooldown.
          if (burstShots >= burstCount) {
            WeaponTiming.state[w] = WeaponStateValue.Cooldown;
            WeaponTiming.timerMs[w] = 0;
          } else {
            WeaponTiming.state[w] = WeaponStateValue.BurstWait;
            WeaponTiming.timerMs[w] = 0;
          }
        } else {
          WeaponTiming.timerMs[w] = timer;
        }
        break;
      }
      case WeaponStateValue.Bursting: {
        // We only spend ONE tick in this state — used as a transient
        // marker so the editor / debug overlay can show "shot fired
        // this tick". Re-enter immediately:
        if (burstShots >= burstCount) {
          WeaponTiming.state[w] = WeaponStateValue.Cooldown;
          WeaponTiming.timerMs[w] = 0;
        } else {
          WeaponTiming.state[w] = WeaponStateValue.BurstWait;
          WeaponTiming.timerMs[w] = 0;
        }
        break;
      }
      case WeaponStateValue.BurstWait: {
        if (!targetValid) {
          WeaponTiming.state[w] = WeaponStateValue.Idle;
          WeaponTiming.timerMs[w] = 0;
          WeaponTiming.burstShotsFired[w] = 0;
          break;
        }
        if (timer >= burstDelayMs) {
          // Fire next burst shot.
          tryFire(
            world,
            w,
            owner,
            target,
            events,
            resolveMuzzle,
            lookupProjectile,
            pendingSpawns,
            currentTick,
          );
          burstShots = WeaponTiming.burstShotsFired[w];
          if (burstShots >= burstCount) {
            WeaponTiming.state[w] = WeaponStateValue.Cooldown;
            WeaponTiming.timerMs[w] = 0;
          } else {
            WeaponTiming.state[w] = WeaponStateValue.BurstWait;
            WeaponTiming.timerMs[w] = 0;
          }
        } else {
          WeaponTiming.timerMs[w] = timer;
        }
        break;
      }
      case WeaponStateValue.Cooldown: {
        if (timer >= cooldownMs) {
          // Lock prevents re-entering Charging until heat dissipates.
          WeaponTiming.state[w] = WeaponStateValue.Idle;
          WeaponTiming.timerMs[w] = 0;
          WeaponTiming.burstShotsFired[w] = 0;
        } else {
          WeaponTiming.timerMs[w] = timer;
        }
        break;
      }
      default: {
        // Loud over silent: unknown state collapses back to Idle.
        console.warn(
          `[weaponFireSystem] unknown weapon state ${state} on eid ${w}; resetting to Idle.`,
        );
        WeaponTiming.state[w] = WeaponStateValue.Idle;
        WeaponTiming.timerMs[w] = 0;
        WeaponTiming.burstShotsFired[w] = 0;
        break;
      }
    }
  }
}

// One-time warn dedup so we don't spam every tick when a weapon can't
// fire because its projectile id never loaded.
const warnedMissingProjectile = new Set<number>();
export function _resetWeaponFireWarnings(): void {
  warnedMissingProjectile.clear();
}

function tryFire(
  world: SimWorld,
  w: number,
  owner: number,
  target: number,
  events: SimEventLog,
  resolveMuzzle: MuzzleResolver,
  lookupProjectile: ProjectileLookup,
  pendingSpawns: PendingProjectileSpawn[],
  currentTick: number,
): void {
  const ptid = ProjectileTypeId.value[w];
  if (ptid === NO_PROJECTILE_TYPE) {
    if (!warnedMissingProjectile.has(w)) {
      console.warn(
        `[weaponFireSystem] weapon eid ${w} has NO_PROJECTILE_TYPE; cannot fire.`,
      );
      warnedMissingProjectile.add(w);
    }
    return;
  }
  const schematic = lookupProjectile(ptid);
  if (!schematic) {
    if (!warnedMissingProjectile.has(w)) {
      console.warn(
        `[weaponFireSystem] weapon eid ${w} has unknown ProjectileTypeId ${ptid}; cannot fire.`,
      );
      warnedMissingProjectile.add(w);
    }
    return;
  }

  // Compute muzzle world position + forward direction via callback.
  const idx = WeaponHardpointIdx.value[w];
  const muzzle = resolveMuzzle(owner, idx);

  // Override direction to AIM at the current target (XZ plane). The
  // mesh hardpoint orientation is the spawn frame; aim is a separate
  // override so the weapon actually engages even if the rig hasn't
  // slewed yet. v1: instant aim.
  const tx = Position.x[target];
  const tz = Position.z[target];
  let dirX = tx - muzzle.x;
  let dirZ = tz - muzzle.z;
  const dlen = Math.hypot(dirX, dirZ);
  if (dlen < 0.001) {
    dirX = muzzle.fx;
    dirZ = muzzle.fz;
  } else {
    dirX /= dlen;
    dirZ /= dlen;
  }

  // Authored "effective range" — bonded to weapon range component.
  // Used by impactSystem for falloff.
  const rangeM = projectileMaxRange(schematic);

  // Add heat from this shot.
  WeaponHeat.currentMj[w] += WeaponThermalSpec.heatPerShotMj[w];

  // Increment burst counter.
  WeaponTiming.burstShotsFired[w] = WeaponTiming.burstShotsFired[w] + 1;

  // Emit a weapon_fired event for render-side muzzle flash.
  events.push({
    kind: "weapon_fired",
    tick: currentTick,
    weaponEid: w,
    ownerEid: owner,
    hardpointIdx: idx,
    x: muzzle.x,
    y: muzzle.y,
    z: muzzle.z,
  });

  // Queue a projectile spawn for the projectileSpawnSystem.
  pendingSpawns.push({
    ownerEid: owner,
    weaponEid: w,
    hardpointIdx: idx,
    teamId: TeamId.value[owner],
    targetEid: target,
    projectileTypeId: ptid,
    originX: muzzle.x,
    originY: muzzle.y,
    originZ: muzzle.z,
    dirX,
    dirZ,
    rangeM,
  });
  void world;
  void Rotation; // hint: we may use Rotation in a more refined aim model
}

/**
 * Derive the projectile's max effective range (m). Mirrors a slice of
 * derive-projectile.ts. Stays in /sim so impactSystem + weaponFireSystem
 * can both compute it without crossing layers.
 */
export function projectileMaxRange(p: ProjectileSchematic): number {
  switch (p.delivery_params.kind) {
    case "ballistic":
      // Ballistic: range ~ muzzle_velocity × ballistic_coefficient × 2
      // capped at 800m for the MVP scale. Tuned so mk01-vs-mk01 at 60m
      // is well inside range.
      return Math.min(
        800,
        p.delivery_params.muzzle_velocity_mps *
          Math.max(0.1, p.delivery_params.ballistic_coefficient ?? 0.5) *
          2,
      );
    case "beam":
      // Beam range is dominated by divergence — at 1 km a 0.2 mrad
      // beam spreads to a 0.2m spot. Pragmatic cap 400m for MVP.
      return 400;
    case "guided": {
      // Range ~ thrust / drag-proxy × burn — keep simple. MVP cap.
      return Math.min(600, 200 + p.delivery_params.thrust_n / 30);
    }
    case "dropped":
      return 50;
    case "placed":
      return 5;
    default: {
      const _exh: never = p.delivery_params;
      void _exh;
      return 100;
    }
  }
}
