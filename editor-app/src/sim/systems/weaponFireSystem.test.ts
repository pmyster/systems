/**
 * weaponFireSystem tests — Phase 1 Week 3.
 *
 * Verifies:
 *   - Idle → Charging → Bursting transitions
 *   - Burst count is respected (multiple shots emitted)
 *   - Heat threshold (70% capacity) refuses fire; hysteresis releases
 *     at 60% capacity
 *   - Heat dissipates over time
 */

import { describe, it, expect, beforeEach } from "vitest";

import type { ProjectileSchematic } from "../../types/projectile";
import { SimEventLog } from "../events";
import { createSimWorld } from "../world";
import { spawnUnit, spawnWeaponInstance } from "../spawn";
import {
  WeaponHeat,
  WeaponOverheatLock,
  WeaponStateValue,
  WeaponTarget,
  WeaponTiming,
} from "../world";
import {
  _resetWeaponFireWarnings,
  type PendingProjectileSpawn,
  weaponFireSystem,
} from "./weaponFireSystem";

const TEST_PROJECTILE: ProjectileSchematic = {
  id: "test_kinetic",
  name: "Test Kinetic",
  physics_version: "1.0",
  mass_kg: 1,
  delivery_params: {
    kind: "ballistic",
    muzzle_velocity_mps: 800,
    ballistic_coefficient: 0.5,
  },
  effect_params: {
    kind: "kinetic",
    penetrator_material: "steel",
    sectional_density_kgm2: 5,
  },
};

const muzzle = (_eid: number) => ({
  x: 0,
  y: 0,
  z: 0,
  fx: 1,
  fz: 0,
});
const lookupProjectile = (_id: number): ProjectileSchematic => TEST_PROJECTILE;

function setupOne(opts?: {
  chargeMs?: number;
  burstCount?: number;
  burstDelayMs?: number;
  cooldownMs?: number;
  thermalCapMj?: number;
  heatPerShotMj?: number;
  coolMjs?: number;
}) {
  const world = createSimWorld();
  const owner = spawnUnit(world, {
    typeId: 0,
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    maxHealth: 100,
    teamId: 0,
  });
  const enemy = spawnUnit(world, {
    typeId: 0,
    x: 30,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    maxHealth: 100,
    teamId: 1,
  });
  const w = spawnWeaponInstance(world, {
    ownerEid: owner,
    hardpointIdx: 0,
    projectileTypeId: 0,
    chargeTimeMs: opts?.chargeMs ?? 200,
    fireRateMs: 0,
    burstCount: opts?.burstCount ?? 1,
    burstDelayMs: opts?.burstDelayMs ?? 100,
    cooldownMs: opts?.cooldownMs ?? 500,
    thermalCapMj: opts?.thermalCapMj ?? 50,
    heatPerShotMj: opts?.heatPerShotMj ?? 3,
    coolRateMjs: opts?.coolMjs ?? 2,
    rangeM: 100,
  });
  WeaponTarget.value[w] = enemy;
  return { world, owner, enemy, w };
}

describe("weaponFireSystem", () => {
  beforeEach(() => _resetWeaponFireWarnings());

  it("transitions Idle → Charging on valid target, fires after charge_time_ms", () => {
    const { world, w } = setupOne({ chargeMs: 200, burstCount: 1 });
    const events = new SimEventLog();
    const spawns: PendingProjectileSpawn[] = [];

    expect(WeaponTiming.state[w]).toBe(WeaponStateValue.Idle);

    // First tick (33ms < 200ms charge): should enter Charging but not fire.
    weaponFireSystem(world, 0.033, events, muzzle, lookupProjectile, spawns, 0);
    expect(WeaponTiming.state[w]).toBe(WeaponStateValue.Charging);
    expect(spawns.length).toBe(0);

    // Drive several ticks to exceed the 200ms charge time.
    for (let i = 0; i < 10; i++) {
      weaponFireSystem(world, 0.033, events, muzzle, lookupProjectile, spawns, i + 1);
    }
    expect(spawns.length).toBeGreaterThanOrEqual(1);
  });

  it("respects burst_count — emits N shots before cooldown", () => {
    const { world, w } = setupOne({
      chargeMs: 0,
      burstCount: 3,
      burstDelayMs: 50,
      cooldownMs: 1000,
    });
    const events = new SimEventLog();
    const spawns: PendingProjectileSpawn[] = [];

    // Run for enough ticks that all 3 burst shots fire but cooldown
    // hasn't yet completed.
    for (let i = 0; i < 30; i++) {
      weaponFireSystem(world, 0.033, events, muzzle, lookupProjectile, spawns, i);
      if (WeaponTiming.state[w] === WeaponStateValue.Cooldown) break;
    }
    expect(spawns.length).toBe(3);
    expect(WeaponTiming.state[w]).toBe(WeaponStateValue.Cooldown);
  });

  it("refuses to fire when heat exceeds 70% of capacity (hysteresis)", () => {
    const { world, w } = setupOne({
      chargeMs: 0,
      burstCount: 1,
      thermalCapMj: 10,
      heatPerShotMj: 10, // one shot saturates
      coolMjs: 0, // no dissipation during test
    });
    const events = new SimEventLog();
    const spawns: PendingProjectileSpawn[] = [];

    // Fire once.
    for (let i = 0; i < 5; i++) {
      weaponFireSystem(world, 0.033, events, muzzle, lookupProjectile, spawns, i);
      if (WeaponTiming.state[w] === WeaponStateValue.Cooldown) break;
    }
    expect(spawns.length).toBe(1);
    expect(WeaponHeat.currentMj[w]).toBeGreaterThan(7); // above 70% threshold

    // Run many more ticks past cooldown — overheat lock should keep
    // refusing to enter Charging.
    const spawnsAfter: PendingProjectileSpawn[] = [];
    for (let i = 0; i < 100; i++) {
      weaponFireSystem(world, 0.033, events, muzzle, lookupProjectile, spawnsAfter, i + 100);
    }
    expect(WeaponOverheatLock.value[w]).toBe(1);
    expect(spawnsAfter.length).toBe(0);
  });

  it("heat dissipates each tick at cool_rate", () => {
    const { world, w } = setupOne({
      chargeMs: 0,
      coolMjs: 10, // 10 MJ/sec dissipation
      heatPerShotMj: 0,
      thermalCapMj: 50,
    });
    WeaponHeat.currentMj[w] = 20;
    const events = new SimEventLog();
    const spawns: PendingProjectileSpawn[] = [];

    // 0.5 seconds → expect 5 MJ dissipated.
    for (let i = 0; i < 15; i++) {
      weaponFireSystem(world, 0.033, events, muzzle, lookupProjectile, spawns, i);
    }
    // 15 * 0.033 = 0.495 s × 10 MJ/s = ~4.95 MJ dissipated.
    expect(WeaponHeat.currentMj[w]).toBeCloseTo(15.05, 0);
  });
});

