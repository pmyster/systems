/**
 * targetAcquisitionSystem tests — Phase 1 Week 3.
 *
 * The strategy: stand up a fresh world, spawn unit + weapon entities,
 * set their fields, run the system, assert the WeaponTarget /
 * TargetOf values match the spec.
 */

import { describe, it, expect } from "vitest";

import { createSimWorld } from "../world";
import { spawnUnit, spawnWeaponInstance } from "../spawn";
import {
  Health,
  Position,
  ScanRange,
  Stance,
  StanceValue,
  TargetOf,
  WeaponTarget,
  NO_ENTITY,
} from "../world";
import { targetAcquisitionSystem } from "./targetAcquisitionSystem";

function spawnUnitAt(
  world: ReturnType<typeof createSimWorld>,
  x: number,
  z: number,
  team: number,
): number {
  return spawnUnit(world, {
    typeId: 0,
    x,
    y: 0,
    z,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    maxHealth: 100,
    teamId: team,
  });
}

function spawnWeapon(world: ReturnType<typeof createSimWorld>, owner: number): number {
  return spawnWeaponInstance(world, {
    ownerEid: owner,
    hardpointIdx: 0,
    projectileTypeId: 0,
    chargeTimeMs: 0,
    fireRateMs: 0,
    burstCount: 1,
    burstDelayMs: 0,
    cooldownMs: 100,
    thermalCapMj: 50,
    heatPerShotMj: 3,
    coolRateMjs: 2,
    rangeM: 100,
  });
}

describe("targetAcquisitionSystem", () => {
  it("acquires an opposing-team enemy in range", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(enemy);
    expect(TargetOf.value[me]).toBe(enemy);
  });

  it("does not acquire an enemy outside scan range", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    spawnUnitAt(world, 200, 0, 1);
    ScanRange.value[me] = 50;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
    expect(TargetOf.value[me]).toBe(NO_ENTITY);
  });

  it("does not target a teammate", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    spawnUnitAt(world, 20, 0, 0); // same team
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
  });

  it("HoldFire clears WeaponTarget", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[me] = 80;
    Stance.value[me] = StanceValue.HoldFire;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
    void enemy;
  });

  it("clears target when current target dies", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const enemy = spawnUnitAt(world, 30, 0, 1);
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);
    expect(WeaponTarget.value[w]).toBe(enemy);

    // Kill the enemy.
    Health.current[enemy] = 0;
    targetAcquisitionSystem(world);
    expect(WeaponTarget.value[w]).toBe(NO_ENTITY);
    expect(TargetOf.value[me]).toBe(NO_ENTITY);
  });

  it("prefers the closer of two enemies (proximity weight dominates at equal health)", () => {
    const world = createSimWorld();
    const me = spawnUnitAt(world, 0, 0, 0);
    const w = spawnWeapon(world, me);
    const far = spawnUnitAt(world, 70, 0, 1);
    const near = spawnUnitAt(world, 20, 0, 1);
    ScanRange.value[me] = 80;

    targetAcquisitionSystem(world);

    expect(WeaponTarget.value[w]).toBe(near);
    void far;
  });
});

// Suppress accidental ScanRange unused lint
void Position;
